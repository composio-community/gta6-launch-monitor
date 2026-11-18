import { callComposio, SignInRequiredError } from "./composio-mcp.ts";
import { budgetCapUsd } from "./config.ts";
import { addReserved, reserved, session, updateSession } from "./session.ts";
import { unwrapJson } from "./parse/util.ts";
import type { BudgetStatus } from "./types.ts";

/**
 * Composio Instant runs a tool on Composio's own provider account and charges
 * the signed-in user's Composio wallet per call, so this app needs no Firecrawl
 * or ScrapeCreators keys. Calls go through Composio Connect's
 * COMPOSIO_MULTI_EXECUTE_TOOL. Instant has no built-in dollar cap, so the cap is
 * enforced here, per visitor: every call reserves its published rate before it
 * runs, and the running total is kept in the visitor's session cookie.
 */

const toMicros = (usd: number) => Math.round(usd * 1_000_000);

export class BudgetExceededError extends Error {
  constructor() {
    super("Instant spend cap reached");
    this.name = "BudgetExceededError";
  }
}

export function budgetStatus(): BudgetStatus {
  const s = session();
  return {
    spentUsd: s.spentMicros / 1_000_000,
    capUsd: budgetCapUsd(),
    calls: s.calls,
    estimated: s.estimated,
  };
}

function charge(micros: number, estimated: boolean, counted: boolean) {
  updateSession((s) => ({
    ...s,
    spentMicros: s.spentMicros + micros,
    calls: s.calls + (counted ? 1 : 0),
    estimated: s.estimated || estimated,
  }));
}

/** A charge may arrive as a number, a decimal string, or an object holding one. */
export function parseCharge(value: unknown, depth = 0): number | null {
  if (typeof value === "number") return Number.isFinite(value) && value >= 0 ? value : null;
  if (typeof value === "string") {
    const n = Number.parseFloat(value.replace(/^\$/, ""));
    return Number.isFinite(n) && n >= 0 ? n : null;
  }
  if (value && typeof value === "object" && depth < 3) {
    const record = value as Record<string, unknown>;
    for (const key of ["amount", "usd", "total", "charge", "value", "cost"]) {
      if (key in record) {
        const n = parseCharge(record[key], depth + 1);
        if (n !== null) return n;
      }
    }
  }
  return null;
}

type Rec = Record<string, unknown>;
const isRec = (v: unknown): v is Rec => v !== null && typeof v === "object" && !Array.isArray(v);

/** Depth-first search for the first value stored under any of `keys`. */
function findKey(value: unknown, keys: string[], depth = 0): unknown {
  if (depth > 6 || value === null || typeof value !== "object") return undefined;
  if (Array.isArray(value)) {
    for (const item of value) {
      const hit = findKey(item, keys, depth + 1);
      if (hit !== undefined) return hit;
    }
    return undefined;
  }
  for (const key of keys) if (key in value) return (value as Rec)[key];
  for (const child of Object.values(value)) {
    const hit = findKey(child, keys, depth + 1);
    if (hit !== undefined) return hit;
  }
  return undefined;
}

export interface ToolOutcome {
  ok: boolean;
  data: unknown;
  error: string | null;
  charge: number | null;
  /**
   * Set when the response was too large to return inline: Composio saved it in
   * the remote sandbox and sent only a preview. The path is the saved file.
   */
  offloadedPath: string | null;
}

/**
 * Read one tool's outcome out of a COMPOSIO_MULTI_EXECUTE_TOOL result. The MCP
 * result is text content holding JSON; inside it each requested tool has an
 * entry with its own success flag, data and error.
 */
export function readMultiExecute(result: { content?: unknown; structuredContent?: unknown; isError?: unknown }): ToolOutcome {
  const texts = Array.isArray(result.content)
    ? result.content.filter((c): c is { type: "text"; text: string } => isRec(c) && c.type === "text" && typeof c.text === "string")
    : [];
  const body = result.structuredContent ?? unwrapJson(texts.map((c) => c.text).join(""));
  const rawText = texts.map((c) => c.text).join(" ");

  if (result.isError === true && !isRec(body)) {
    return { ok: false, data: null, error: rawText || "Composio returned an error", charge: null, offloadedPath: null };
  }

  const results = findKey(body, ["results"]);
  const entry: unknown = Array.isArray(results) && results.length > 0 ? results[0] : body;
  const response = isRec(entry) && isRec(entry.response) ? entry.response : entry;

  const successful = isRec(response) ? (response.successful ?? response.success) : undefined;
  const error = isRec(response) ? (response.error ?? (isRec(entry) ? entry.error : undefined)) : undefined;
  const errorText = typeof error === "string" && error.length > 0 ? error : isRec(error) ? JSON.stringify(error) : null;
  const ok = successful === false ? false : successful === true ? true : result.isError !== true && !errorText;
  const data = isRec(response) && "data" in response ? response.data : response;
  const charge = parseCharge(findKey(body, ["instant_charge", "instantCharge"]));

  const fileInfo = findKey(body, ["remote_file_info"]);
  const filePath = isRec(fileInfo) && typeof fileInfo.file_path === "string" ? fileInfo.file_path : null;
  const offloaded = isRec(response) && !("data" in response) && "data_preview" in response;

  return {
    ok,
    data: offloaded ? null : unwrapJson(data),
    error: ok ? null : errorText || rawText.slice(0, 300) || "Tool failed",
    charge,
    offloadedPath: offloaded ? filePath : null,
  };
}

/**
 * What to read back from an offloaded response:
 * - `keys`: the named keys, trimmed to fit inline;
 * - `cards`: one page of cards from a markdown field, split after each match of
 *   `end` (a Python regex), starting at card `offset`. Used to page through a
 *   big scrape without paying for it again.
 */
export type OffloadSpec = { keys: string[] } | { cards: { key: string; end: string } };

/** A page of cards read from an offloaded markdown field. */
export interface CardPage {
  markdown: string;
  /** Cards in the whole saved response. */
  total: number;
  /** Offset of the first card not yet read. */
  next: number;
}

/**
 * Runs in Composio's remote sandbox. Finds each key anywhere in the saved
 * response and prints them as one JSON object, halving lists and trimming
 * strings until the output fits under the ~40KB inline limit of remote bash.
 * No single quotes in here: it is passed to the shell in single quotes.
 */
const EXTRACT_PY = `
import json, sys
path, keys = sys.argv[1], json.loads(sys.argv[2])
LIMIT = 34000
doc = json.load(open(path))
def find(o, key, depth=0):
    if depth > 9:
        return None
    if isinstance(o, dict):
        if key in o and isinstance(o[key], (str, list)):
            return o[key]
        for v in o.values():
            r = find(v, key, depth + 1)
            if r is not None:
                return r
    elif isinstance(o, list):
        for v in o:
            r = find(v, key, depth + 1)
            if r is not None:
                return r
    return None
out = {}
for k in keys:
    v = find(doc, k)
    if v is not None:
        out[k] = v
dump = lambda o: json.dumps(o, ensure_ascii=False)
s = dump(out)
while len(s) > LIMIT:
    shrunk = False
    for k, v in list(out.items()):
        if isinstance(v, list) and len(v) > 1:
            out[k] = v[: max(1, len(v) // 2)]
            shrunk = True
        elif isinstance(v, str) and len(v) > 2000:
            out[k] = v[: int(len(v) * 0.8)]
            shrunk = True
    if not shrunk:
        break
    s = dump(out)
sys.stdout.write(s)
`;

/** Same rules as EXTRACT_PY. Raw text is capped below the inline limit because JSON escaping grows it. */
const CARDS_PY = `
import json, re, sys
path, key, card_end, offset = sys.argv[1], sys.argv[2], sys.argv[3], int(sys.argv[4])
LIMIT = 26000
doc = json.load(open(path))
def find(o, depth=0):
    if depth > 9:
        return None
    if isinstance(o, dict):
        if isinstance(o.get(key), str):
            return o[key]
        for v in o.values():
            r = find(v, depth + 1)
            if r is not None:
                return r
    elif isinstance(o, list):
        for v in o:
            r = find(v, depth + 1)
            if r is not None:
                return r
    return None
md = find(doc) or ""
cards, start = [], 0
for m in re.finditer(card_end, md):
    cards.append(md[start:m.end()])
    start = m.end()
out, size, i = [], 0, offset
while i < len(cards) and (not out or size + len(cards[i]) < LIMIT):
    out.append(cards[i])
    size += len(cards[i])
    i += 1
sys.stdout.write(json.dumps({"markdown": "".join(out), "total": len(cards), "next": i}, ensure_ascii=False))
`;

const shellQuote = (s: string) => `'${s.replace(/'/g, `'\\''`)}'`;

/** Run a Python snippet in Composio's remote sandbox and parse its JSON stdout. Free: no Instant charge. */
async function sandboxJson(code: string, args: string[]): Promise<unknown> {
  const command = ["python3", "-c", shellQuote(code), ...args.map(shellQuote)].join(" ");
  const result = await callComposio("COMPOSIO_REMOTE_BASH_TOOL", { command }, 120_000);
  const outcome = readMultiExecute(result);
  const stdout = isRec(outcome.data) && typeof outcome.data.stdout === "string" ? outcome.data.stdout : null;
  if (!outcome.ok || stdout === null) throw new Error(`Could not read the large response: ${outcome.error ?? "no output"}`);
  try {
    return JSON.parse(stdout);
  } catch {
    throw new Error("The large response could not be read back in one piece");
  }
}

function checkSandboxPath(filePath: string) {
  if (!/^\/mnt\/files\/[\w./-]+$/.test(filePath)) throw new Error("Unexpected sandbox file path");
}

/** Read the useful part of an offloaded response through COMPOSIO_REMOTE_BASH_TOOL. */
function readOffloaded(filePath: string, spec: OffloadSpec): Promise<unknown> {
  checkSandboxPath(filePath);
  if ("cards" in spec) return readCardPage(filePath, spec, 0);
  return sandboxJson(EXTRACT_PY, [filePath, JSON.stringify(spec.keys)]);
}

/** Read the page of cards starting at `offset` from an offloaded response. No Instant charge. */
export async function readCardPage(
  filePath: string,
  spec: { cards: { key: string; end: string } },
  offset: number,
): Promise<CardPage> {
  checkSandboxPath(filePath);
  const page = await sandboxJson(CARDS_PY, [filePath, spec.cards.key, spec.cards.end, String(offset)]);
  if (!isRec(page) || typeof page.markdown !== "string" || typeof page.total !== "number" || typeof page.next !== "number") {
    throw new Error("The saved page could not be read");
  }
  return { markdown: page.markdown, total: page.total, next: page.next };
}

export interface InstantResult {
  data: unknown;
  chargeUsd: number;
  /** True when Composio returned no charge and the published rate was assumed. */
  estimated: boolean;
  /** Sandbox file holding the full response, when it was too large to return inline. */
  offloadedPath: string | null;
}

/**
 * Run one tool through Composio Connect.
 * `rateUsd` is the tool's published Instant rate; it is reserved against the
 * cap before the call and replaced by the reported charge when there is one.
 */
export async function runInstant(
  slug: string,
  args: Record<string, unknown>,
  rateUsd: number,
  offload?: OffloadSpec,
): Promise<InstantResult> {
  const reserve = toMicros(rateUsd);
  const cap = toMicros(budgetCapUsd());
  if (session().spentMicros + reserved() + reserve > cap) throw new BudgetExceededError();

  addReserved(reserve);
  try {
    const result = await callComposio("COMPOSIO_MULTI_EXECUTE_TOOL", {
      tools: [{ tool_slug: slug, arguments: args }],
      sync_response_to_workbench: false,
    });
    const outcome = readMultiExecute(result);

    if (!outcome.ok) {
      // Failed calls are normally free; count a charge only when one is reported.
      if (outcome.charge) charge(toMicros(outcome.charge), false, false);
      throw new Error(outcome.error ?? `${slug} failed`);
    }

    // The tool ran and was charged, whether or not its output came back inline.
    const chargeUsd = outcome.charge ?? rateUsd;
    charge(toMicros(chargeUsd), outcome.charge === null, true);

    let data = outcome.data;
    if (outcome.offloadedPath) {
      if (!offload) throw new Error("Response was too large to return inline");
      // Remote bash is a Composio meta-tool, not an Instant tool: no wallet charge.
      data = await readOffloaded(outcome.offloadedPath, offload);
    }
    return { data, chargeUsd, estimated: outcome.charge === null, offloadedPath: outcome.offloadedPath };
  } finally {
    addReserved(-reserve);
  }
}

/** Turn an error into one short line for the UI. */
export function describeError(error: unknown): string {
  if (error instanceof BudgetExceededError || error instanceof SignInRequiredError) return error.message;
  const raw = error instanceof Error ? error.message : String(error);
  if (/WalletBalanceExhausted|\b402\b|insufficient (balance|funds)/i.test(raw)) {
    return "Your Composio wallet is empty. Add funds in Composio, then refresh.";
  }
  const line = raw.replace(/\s+/g, " ").trim();
  return line.length > 220 ? `${line.slice(0, 217)}...` : line || "Unknown error";
}
