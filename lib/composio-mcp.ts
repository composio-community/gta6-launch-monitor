import { randomBytes } from "node:crypto";
import {
  auth,
  Client,
  StreamableHTTPClientTransport,
  UnauthorizedError,
  type OAuthClientProvider,
  type OAuthDiscoveryState,
  type StoredOAuthClientInformation,
  type StoredOAuthTokens,
} from "@modelcontextprotocol/client";
import {
  hasSession,
  PENDING_TTL_MS,
  pendingSignIns,
  resetSession,
  session,
  updatePending,
  updateSession,
  type AuthState,
  type PendingSignIn,
} from "./session.ts";

/**
 * Signs each visitor in to Composio Connect, the hosted MCP server, with their
 * own Composio account (OAuth with PKCE and dynamic client registration), then
 * calls its meta-tools on their behalf. No Composio API key is involved, and
 * one visitor's sign-in is never used for another: tokens live in the
 * visitor's encrypted cookie (see session.ts).
 */

export const MCP_URL = new URL("https://connect.composio.dev/mcp");
const SCOPE = "openid profile email offline_access";
const MAX_PENDING = 5;

export class SignInRequiredError extends Error {
  constructor(message = "Sign in to Composio to load live data") {
    super(message);
    this.name = "SignInRequiredError";
  }
}

// ---------- OAuth provider ----------

class SessionProvider implements OAuthClientProvider {
  /** Set by redirectToAuthorization during an interactive sign-in. */
  authorizationUrl: URL | null = null;
  /** Generated while starting a sign-in; stored once the redirect URL exists. */
  started: { state?: string; codeVerifier?: string; discovery?: OAuthDiscoveryState } = {};
  private readonly redirect: string;
  /** False for tool calls: they must never start a browser flow. */
  private readonly interactive: boolean;
  /** The pending sign-in this provider completes, when handling a callback. */
  private readonly pending: PendingSignIn | null;
  /**
   * Last session seen. A cached connection may touch the provider outside a
   * request (a stream reconnecting); it then reads this copy instead of failing.
   */
  private last: AuthState;

  constructor(redirect: string, interactive: boolean, pending: PendingSignIn | null = null) {
    this.redirect = redirect;
    this.interactive = interactive;
    this.pending = pending;
    this.last = session();
  }

  private current(): AuthState {
    if (hasSession()) this.last = session();
    return this.last;
  }

  get redirectUrl() {
    return this.redirect;
  }

  get clientMetadata(): OAuthClientProvider["clientMetadata"] {
    return {
      client_name: "GTA VI Launch Monitor",
      redirect_uris: [this.redirect],
      grant_types: ["authorization_code", "refresh_token"],
      response_types: ["code"],
      token_endpoint_auth_method: "none",
      scope: SCOPE,
    };
  }

  state() {
    this.started.state = randomBytes(18).toString("base64url");
    return this.started.state;
  }

  clientInformation() {
    const s = this.current();
    return s.redirectUrl === this.redirect ? s.client : undefined;
  }

  saveClientInformation(info: StoredOAuthClientInformation) {
    if (hasSession()) updateSession((s) => ({ ...s, client: info, redirectUrl: this.redirect }));
  }

  tokens() {
    const s = this.current();
    return s.redirectUrl === this.redirect ? s.tokens : undefined;
  }

  saveTokens(tokens: StoredOAuthTokens) {
    // A refresh outside a request can't reach the cookie; the next request refreshes again.
    if (!hasSession()) return;
    // The ID token is only read for the name and email; keeping it would roughly double the cookie.
    const { id_token: idToken, ...kept } = tokens as StoredOAuthTokens & { id_token?: unknown };
    updateSession((s) => ({
      ...s,
      tokens: kept as StoredOAuthTokens,
      account: idToken ? decodeIdToken(idToken) : s.account,
      redirectUrl: this.redirect,
      lastError: null,
    }));
  }

  redirectToAuthorization(url: URL) {
    if (!this.interactive) throw new SignInRequiredError("Your Composio sign-in expired. Sign in again.");
    this.authorizationUrl = url;
  }

  saveCodeVerifier(codeVerifier: string) {
    this.started.codeVerifier = codeVerifier;
  }

  codeVerifier() {
    const verifier = this.pending?.codeVerifier ?? this.started.codeVerifier;
    if (!verifier) throw new Error("No sign-in in progress. Start again.");
    return verifier;
  }

  saveDiscoveryState(discovery: OAuthDiscoveryState) {
    this.started.discovery = discovery;
  }

  discoveryState() {
    return this.pending?.discovery ?? this.started.discovery;
  }

  invalidateCredentials(scope: "all" | "client" | "tokens" | "verifier" | "discovery") {
    if (scope === "verifier" || scope === "discovery" || !hasSession()) return; // held per sign-in
    updateSession((s) => ({
      ...s,
      client: scope === "all" || scope === "client" ? undefined : s.client,
      tokens: scope === "all" || scope === "tokens" ? undefined : s.tokens,
    }));
  }
}

const callbackUrl = (origin: string) => `${origin}/api/auth/callback`;

function prunePending(pending: Record<string, PendingSignIn>): Record<string, PendingSignIn> {
  const now = Date.now();
  return Object.fromEntries(
    Object.entries(pending)
      .filter(([, p]) => now - p.createdAt < PENDING_TTL_MS)
      .sort((a, b) => b[1].createdAt - a[1].createdAt)
      .slice(0, MAX_PENDING),
  );
}

// ---------- Sign in / out ----------

/** Returns the Composio authorization URL to send the browser to, or null when already signed in. */
export async function startSignIn(origin: string): Promise<URL | null> {
  const provider = new SessionProvider(callbackUrl(origin), true);
  const result = await auth(provider, { serverUrl: MCP_URL, scope: SCOPE });
  if (result === "AUTHORIZED") return null;
  const { state, codeVerifier, discovery } = provider.started;
  if (!provider.authorizationUrl || !state || !codeVerifier) throw new Error("Composio did not return a sign-in page");
  updateSession((s) => ({ ...s, lastError: null }));
  updatePending((p) => prunePending({ ...p, [state]: { createdAt: Date.now(), codeVerifier, discovery } }));
  return provider.authorizationUrl;
}

export async function finishSignIn(origin: string, params: URLSearchParams): Promise<void> {
  const state = params.get("state") ?? "";
  try {
    const error = params.get("error");
    if (error) throw new Error(params.get("error_description") || `Composio sign-in failed: ${error}`);
    // Several sign-ins can be open at once (two tabs, a retry); each callback finds its own.
    const pending = prunePending(pendingSignIns())[state];
    if (!pending) throw new Error("That sign-in link expired or was not started in this browser. Try again.");
    const code = params.get("code");
    if (!code) throw new Error("Composio returned no authorization code");

    const provider = new SessionProvider(callbackUrl(origin), true, pending);
    const result = await auth(provider, { serverUrl: MCP_URL, authorizationCode: code, iss: params.get("iss") ?? undefined, scope: SCOPE });
    if (result !== "AUTHORIZED") throw new Error("Composio did not finish the sign-in");
    updatePending(() => ({}));
    updateSession((s) => ({ ...s, lastError: null }));
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    updatePending((p) => {
      const next = prunePending(p);
      delete next[state];
      return next;
    });
    updateSession((s) => ({ ...s, lastError: message }));
    throw error;
  }
}

export function signOut(): void {
  closeClient(session().sid);
  resetSession();
  updatePending(() => ({}));
}

// ---------- Status ----------

export interface ComposioAccount {
  name: string | null;
  email: string | null;
}

function decodeIdToken(token: unknown): ComposioAccount | null {
  if (typeof token !== "string") return null;
  try {
    const payload = JSON.parse(Buffer.from(token.split(".")[1] ?? "", "base64url").toString("utf8")) as Record<string, unknown>;
    const pick = (key: string) => (typeof payload[key] === "string" ? (payload[key] as string) : null);
    return { name: pick("name") ?? pick("preferred_username"), email: pick("email") };
  } catch {
    return null;
  }
}

export function authStatus(): { signedIn: boolean; account: ComposioAccount | null; error: string | null; sid: string } {
  const s = session();
  const signedIn = Boolean(s.tokens && s.redirectUrl);
  const account = signedIn ? (s.account ?? null) : null;
  return { signedIn, account, error: s.lastError, sid: s.sid };
}

// ---------- Tool calls ----------

/** One MCP connection per signed-in visitor, kept while the server instance is warm. */
interface Connection {
  client: Promise<Client>;
  lastUsed: number;
}
const MAX_CONNECTIONS = 100;
const IDLE_MS = 10 * 60 * 1000;
const KEY = "__composioMcp_v2";
const globalStore = globalThis as typeof globalThis & { [KEY]?: Map<string, Connection> };
const connections: Map<string, Connection> = (globalStore[KEY] ??= new Map<string, Connection>());

function closeClient(sid: string) {
  const conn = connections.get(sid);
  connections.delete(sid);
  conn?.client.then((c) => c.close()).catch(() => undefined);
}

function sweep() {
  const now = Date.now();
  for (const [sid, conn] of connections) if (now - conn.lastUsed > IDLE_MS) closeClient(sid);
  while (connections.size > MAX_CONNECTIONS) {
    const oldest = [...connections.entries()].sort((a, b) => a[1].lastUsed - b[1].lastUsed)[0];
    closeClient(oldest[0]);
  }
}

function client(): Promise<Client> {
  const s = session();
  if (!s.tokens || !s.redirectUrl) throw new SignInRequiredError();
  let conn = connections.get(s.sid);
  if (!conn) {
    sweep();
    const provider = new SessionProvider(s.redirectUrl, false);
    const transport = new StreamableHTTPClientTransport(MCP_URL, { authProvider: provider });
    const mcp = new Client({ name: "gta6-launch-monitor", version: "0.1.0" });
    const connecting = mcp.connect(transport).then(() => mcp);
    conn = { client: connecting, lastUsed: Date.now() };
    connections.set(s.sid, conn);
    const sid = s.sid;
    connecting.catch(() => {
      if (connections.get(sid)?.client === connecting) connections.delete(sid);
    });
  }
  conn.lastUsed = Date.now();
  return conn.client;
}

function onFailure(error: unknown): never {
  closeClient(session().sid);
  if (error instanceof UnauthorizedError || error instanceof SignInRequiredError) {
    const message = "Your Composio sign-in expired. Sign in again.";
    updateSession((s) => ({ ...s, tokens: undefined, lastError: message }));
    throw new SignInRequiredError(message);
  }
  throw error;
}

/** Call one Composio Connect tool (a meta-tool such as COMPOSIO_MULTI_EXECUTE_TOOL) as the current visitor. */
export async function callComposio(name: string, args: Record<string, unknown>, timeoutMs = 90_000) {
  try {
    const mcp = await client();
    return await mcp.callTool({ name, arguments: args }, { timeout: timeoutMs });
  } catch (error) {
    return onFailure(error);
  }
}
