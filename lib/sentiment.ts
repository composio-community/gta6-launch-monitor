import { MOODS, REACTION_PLATFORMS, TOPICS, type Mood, type Reaction, type ReactionPlatform, type Topic } from "./types.ts";

export interface MoodSplit {
  counts: Record<Mood, number>;
  /** Scored reactions in this group. */
  total: number;
  /** % positive minus % negative, -100 to +100. null when there is nothing scored. */
  net: number | null;
}

const zero = (): Record<Mood, number> => ({ "very-negative": 0, negative: 0, neutral: 0, positive: 0, "very-positive": 0 });

export function split(reactions: Reaction[]): MoodSplit {
  const counts = zero();
  let total = 0;
  for (const r of reactions) {
    if (!r.mood) continue;
    counts[r.mood] += 1;
    total += 1;
  }
  const pos = counts.positive + counts["very-positive"];
  const neg = counts.negative + counts["very-negative"];
  return { counts, total, net: total === 0 ? null : Math.round(((pos - neg) / total) * 100) };
}

/** Plain words for a net score. */
export function verdict(net: number | null): string {
  if (net === null) return "No data yet";
  if (net >= 50) return "Hyped";
  if (net >= 20) return "Positive";
  if (net > -20) return "Mixed";
  if (net > -50) return "Negative";
  return "Furious";
}

export const MOOD_LABEL: Record<Mood, string> = {
  "very-negative": "Very negative",
  negative: "Negative",
  neutral: "Neutral",
  positive: "Positive",
  "very-positive": "Very positive",
};

export const TOPIC_LABEL = Object.fromEntries(TOPICS.map((t) => [t.id, t.label])) as Record<Topic, string>;

export interface TimeBucket extends MoodSplit {
  start: number;
  end: number;
}

export interface Timeline {
  buckets: TimeBucket[];
  bucketMs: number;
  /** Scored reactions with no usable timestamp or older than the window. */
  outside: number;
}

const MINUTE = 60_000;
/** Candidate bucket sizes: the smallest that fits the span in at most 24 columns wins. */
const BUCKET_STEPS = [15, 30, 60, 120, 180].map((m) => m * MINUTE);

/**
 * Buckets sized to the data. The window starts at the earliest scored reaction
 * in the last `maxSpanMs` (at least two hours back) and ends now, so a burst of
 * posts from the last few hours fills the chart instead of hugging one edge of
 * a mostly empty day.
 */
export function timeline(scored: Reaction[], now: number, maxSpanMs = 24 * 60 * MINUTE): Timeline {
  const inWindow = scored.filter((r) => {
    const t = r.createdAt ? Date.parse(r.createdAt) : Number.NaN;
    return Number.isFinite(t) && t <= now && t >= now - maxSpanMs;
  });
  const outside = scored.length - inWindow.length;
  if (inWindow.length === 0) return { buckets: [], bucketMs: 60 * MINUTE, outside };
  const earliest = Math.min(...inWindow.map((r) => Date.parse(r.createdAt as string)));
  const span = Math.max(2 * 60 * MINUTE, now - earliest);
  const bucketMs = BUCKET_STEPS.find((step) => span / step <= 24) ?? BUCKET_STEPS[BUCKET_STEPS.length - 1];
  const start = Math.floor(Math.min(earliest, now - 2 * 60 * MINUTE) / bucketMs) * bucketMs;
  const count = Math.max(1, Math.ceil((now - start) / bucketMs));
  const groups: Reaction[][] = Array.from({ length: count }, () => []);
  for (const r of inWindow) {
    const i = Math.min(count - 1, Math.floor((Date.parse(r.createdAt as string) - start) / bucketMs));
    groups[i].push(r);
  }
  return {
    buckets: groups.map((items, i) => ({ start: start + i * bucketMs, end: start + (i + 1) * bucketMs, ...split(items) })),
    bucketMs,
    outside,
  };
}

const engagement = (r: Reaction) => (r.likes ?? 0) + (r.comments ?? 0) + (r.views ?? 0) / 100;

export interface SentimentSummary {
  overall: MoodSplit;
  byPlatform: ({ platform: ReactionPlatform } & MoodSplit)[];
  byTopic: ({ topic: Topic } & MoodSplit)[];
  timeline: Timeline;
  loudestLove: Reaction[];
  loudestGripes: Reaction[];
}

export function summarize(reactions: Reaction[], now: number): SentimentSummary {
  const scored = reactions.filter((r) => r.mood !== null);
  const loud = (keep: (r: Reaction) => boolean) =>
    scored
      .filter(keep)
      .sort((a, b) => engagement(b) - engagement(a))
      .slice(0, 3);

  return {
    overall: split(scored),
    byPlatform: REACTION_PLATFORMS.map((platform) => ({ platform, ...split(scored.filter((r) => r.platform === platform)) })),
    byTopic: TOPICS.map((t) => ({ topic: t.id, ...split(scored.filter((r) => r.topic === t.id)) }))
      .filter((t) => t.total > 0)
      .sort((a, b) => b.total - a.total),
    timeline: timeline(scored, now),
    loudestLove: loud((r) => r.mood === "positive" || r.mood === "very-positive"),
    loudestGripes: loud((r) => r.mood === "negative" || r.mood === "very-negative"),
  };
}

export const MOOD_ORDER = MOODS;
