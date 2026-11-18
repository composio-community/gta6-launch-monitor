import { BudgetExceededError, describeError, runInstant } from "./instant.ts";
import { findArray } from "./parse/util.ts";
import { session } from "./session.ts";
import { TOPICS, type Mood, type Reaction, type ScoringStatus, type Topic } from "./types.ts";

/**
 * Sentiment and topic for each reaction, from OPENAI_CREATE_DECISION through
 * Composio Instant. One call answers up to 200 typed questions about one shared
 * text, so a batch of reactions goes in as a numbered list with two questions
 * each: a 5-level score and a topic choice. Input tokens are billed (about
 * $0.0007 per batch of 15 on Nov 18, 2026); output is free.
 *
 * Scoring runs inside requests, a few batches at a time, so nothing depends on
 * work continuing after a response (serverless hosts stop it). The page polls
 * again while reactions are pending, and each poll scores the next few batches.
 * Scores describe public posts, not people, so they are shared between visitors;
 * the visitor whose request scores a batch pays for it.
 */

export const SCORING_TOOL = "OPENAI_CREATE_DECISION";
const MODEL = "gpt-6-luna";
/** Larger batches (40 items, 80 questions) came back as "invalid decision response" on Nov 18, 2026. */
const BATCH = 15;
/** Batches scored per call to scoreSome, in parallel. Each feed gets its own call as soon as it lands. */
const BATCHES_PER_CALL = 3;
/** A reaction that failed this many times is left unscored instead of being retried forever. */
const MAX_ATTEMPTS = 2;
/** Upper bound reserved against the spend cap per batch. */
const RESERVE_USD = 0.01;
const MAX_TEXT = 420;
const MAX_REMEMBERED = 50_000;

export interface Score {
  sentiment: number;
  topic: Topic;
}

interface ScoringState {
  scores: Map<string, Score>;
  attempts: Map<string, number>;
  /** Reactions in a batch right now, so overlapping requests don't pay to score them twice. */
  inFlight: Set<string>;
  /** Per visitor: their last batch's charge and error. */
  byVisitor: Map<string, { lastChargeUsd: number | null; error: string | null }>;
}

// Kept on globalThis so dev hot reloads don't drop it. Bump the key when the shape changes.
const KEY = "__gtaScoring_v5";
const globalStore = globalThis as typeof globalThis & { [KEY]?: ScoringState };
const state: ScoringState = (globalStore[KEY] ??= {
  scores: new Map(),
  attempts: new Map(),
  inFlight: new Set(),
  byVisitor: new Map(),
});

export function moodOf(sentiment: number): Mood {
  if (sentiment <= -1.25) return "very-negative";
  if (sentiment <= -0.4) return "negative";
  if (sentiment < 0.4) return "neutral";
  if (sentiment < 1.25) return "positive";
  return "very-positive";
}

const LEVELS = [
  { label: "very negative", description: "angry, disappointed, mocking the game" },
  { label: "negative", description: "complaints, doubts, criticism" },
  { label: "neutral", description: "information, news, questions, stream announcements" },
  { label: "positive", description: "likes it, excited, impressed" },
  { label: "very positive", description: "loves it, ecstatic, masterpiece" },
];

/** Links and long whitespace cost tokens and carry no sentiment. */
const compact = (text: string) =>
  text
    .replace(/https?:\/\/\S+/g, "")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, MAX_TEXT);

export function buildDecision(batch: Reaction[]) {
  const input = [
    "Posts and comments about the video game Grand Theft Auto VI (GTA 6), collected on its launch day.",
    "",
    ...batch.map((r, i) => `[${i + 1}] (${r.platform}${r.kind === "comment" ? " comment" : ""}) ${compact(r.text)}`),
  ].join("\n");
  const questions = batch.flatMap((_, i) => [
    {
      type: "score",
      name: `s${i + 1}`,
      instructions: `Sentiment toward GTA VI (the game, its launch, Rockstar) expressed in item [${i + 1}]. Judge the writer's attitude, in any language. Sarcasm counts as what it means.`,
      levels: LEVELS,
    },
    {
      type: "choice",
      name: `t${i + 1}`,
      instructions: `Main topic of item [${i + 1}]. Choose off-topic when the item is not about GTA VI at all, even if it mentions another game or GTA 5.`,
      choices: TOPICS.map((t) => ({ value: t.id, description: t.hint })),
    },
  ]);
  return { model: MODEL, input, questions, prompt_cache_key: "gta6-launch-sentiment" };
}

const TOPIC_IDS = new Set<string>(TOPICS.map((t) => t.id));

/** Map the decision answers back onto the batch. Score levels are 0-4; stored as -2..+2. */
export function readDecision(data: unknown, batch: Reaction[]): Map<string, Score> {
  const answers = findArray(data, "answers") ?? [];
  const byName = new Map<string, Record<string, unknown>>();
  for (const a of answers) {
    if (a && typeof a === "object" && typeof (a as { name?: unknown }).name === "string") {
      byName.set((a as { name: string }).name, a as Record<string, unknown>);
    }
  }
  const out = new Map<string, Score>();
  batch.forEach((r, i) => {
    const s = byName.get(`s${i + 1}`)?.score;
    const t = byName.get(`t${i + 1}`)?.choice;
    if (typeof s !== "number" || !Number.isFinite(s)) return;
    const topic = typeof t === "string" && TOPIC_IDS.has(t) ? (t as Topic) : "other";
    out.set(r.id, { sentiment: Math.max(-2, Math.min(2, s - 2)), topic });
  });
  return out;
}

function remember(id: string, score: Score) {
  state.scores.set(id, score);
  if (state.scores.size > MAX_REMEMBERED) {
    // Maps keep insertion order: drop the oldest tenth.
    let drop = Math.floor(MAX_REMEMBERED / 10);
    for (const key of state.scores.keys()) {
      if (drop-- <= 0) break;
      state.scores.delete(key);
      state.attempts.delete(key);
    }
  }
}

const visitor = () => {
  const sid = session().sid;
  let v = state.byVisitor.get(sid);
  if (!v) {
    v = { lastChargeUsd: null, error: null };
    state.byVisitor.set(sid, v);
    if (state.byVisitor.size > 500) state.byVisitor.delete(state.byVisitor.keys().next().value as string);
  }
  return v;
};

async function scoreBatch(batch: Reaction[]): Promise<void> {
  for (const r of batch) {
    state.attempts.set(r.id, (state.attempts.get(r.id) ?? 0) + 1);
    state.inFlight.add(r.id);
  }
  try {
    const result = await runInstant(SCORING_TOOL, buildDecision(batch), RESERVE_USD);
    const scores = readDecision(result.data, batch);
    if (scores.size === 0) throw new Error("Scoring returned no answers");
    for (const [id, score] of scores) remember(id, score);
    visitor().lastChargeUsd = result.chargeUsd;
  } finally {
    for (const r of batch) state.inFlight.delete(r.id);
  }
}

/** Score a batch; if it fails, try its two halves once each. */
async function scoreWithRetry(batch: Reaction[]): Promise<void> {
  try {
    await scoreBatch(batch);
    visitor().error = null;
  } catch (error) {
    visitor().error = describeError(error);
    if (error instanceof BudgetExceededError || /sign in/i.test(visitor().error ?? "") || batch.length <= 3) return;
    const retry = batch.filter((r) => (state.attempts.get(r.id) ?? 0) < MAX_ATTEMPTS);
    const half = Math.ceil(retry.length / 2);
    for (const part of [retry.slice(0, half), retry.slice(half)]) {
      if (part.length === 0) continue;
      try {
        await scoreBatch(part);
        visitor().error = null;
      } catch (err) {
        visitor().error = describeError(err);
        if (err instanceof BudgetExceededError) return;
      }
    }
  }
}

const unscored = (r: Reaction) => !state.scores.has(r.id) && (state.attempts.get(r.id) ?? 0) < MAX_ATTEMPTS;
const needsScore = (r: Reaction) => unscored(r) && !state.inFlight.has(r.id);

/** Score up to a few batches of the reactions that have no score yet and aren't being scored already. */
export async function scoreSome(reactions: Iterable<Reaction>): Promise<void> {
  const todo = [...reactions].filter(needsScore).slice(0, BATCH * BATCHES_PER_CALL);
  const batches: Reaction[][] = [];
  for (let i = 0; i < todo.length; i += BATCH) batches.push(todo.slice(i, i + BATCH));
  await Promise.all(batches.map(scoreWithRetry));
}

/** Attach stored scores. */
export function withScores(reactions: Reaction[]): Reaction[] {
  return reactions.map((r) => {
    const score = state.scores.get(r.id);
    if (!score) return r;
    return { ...r, sentiment: Math.round(score.sentiment * 100) / 100, mood: moodOf(score.sentiment), topic: score.topic };
  });
}

export function scoringStatus(reactions: Reaction[]): ScoringStatus {
  const scored = reactions.filter((r) => r.sentiment !== null).length;
  // Reactions that failed every attempt are not "pending": nothing more will happen to them.
  const pending = reactions.filter((r) => r.sentiment === null && unscored(r)).length;
  const v = visitor();
  return {
    scored,
    pending,
    running: false,
    tool: SCORING_TOOL,
    lastChargeUsd: v.lastChargeUsd,
    error: v.error,
  };
}
