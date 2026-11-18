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

export interface HourBucket extends MoodSplit {
  start: number;
}

/** An hour with fewer scored reactions than this has no reliable mood; it shows volume only. */
export const MIN_PER_HOUR = 3;

const engagement = (r: Reaction) => (r.likes ?? 0) + (r.comments ?? 0) + (r.views ?? 0) / 100;

export interface SentimentSummary {
  overall: MoodSplit;
  byPlatform: ({ platform: ReactionPlatform } & MoodSplit)[];
  byTopic: ({ topic: Topic } & MoodSplit)[];
  /** Hourly buckets for the last 24 hours, oldest first. */
  hours: HourBucket[];
  /** Scored reactions with no usable timestamp or older than the window. */
  outsideWindow: number;
  loudestLove: Reaction[];
  loudestGripes: Reaction[];
}

export function summarize(reactions: Reaction[], now: number, hours = 24): SentimentSummary {
  const scored = reactions.filter((r) => r.mood !== null);

  const hourMs = 60 * 60 * 1000;
  const end = Math.ceil(now / hourMs) * hourMs;
  const start = end - hours * hourMs;
  const buckets: Reaction[][] = Array.from({ length: hours }, () => []);
  let outsideWindow = 0;
  for (const r of scored) {
    const t = r.createdAt ? Date.parse(r.createdAt) : Number.NaN;
    if (!Number.isFinite(t) || t < start || t >= end) {
      outsideWindow += 1;
      continue;
    }
    buckets[Math.floor((t - start) / hourMs)].push(r);
  }

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
    hours: buckets.map((items, i) => ({ start: start + i * hourMs, ...split(items) })),
    outsideWindow,
    loudestLove: loud((r) => r.mood === "positive" || r.mood === "very-positive"),
    loudestGripes: loud((r) => r.mood === "negative" || r.mood === "very-negative"),
  };
}

export const MOOD_ORDER = MOODS;
