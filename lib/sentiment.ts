import { MOODS, REACTION_PLATFORMS, TOPICS, type Mood, type Reaction, type ReactionPlatform, type Topic } from "./types.ts";

/**
 * Mood figures for a sample of reactions. Read them as a description of the
 * posts the feeds returned, not of public opinion: each feed samples its own
 * slice (popular posts, one subreddit, two videos' comments), every reaction
 * counts once whatever its likes, and the labels come from an AI model that
 * hasn't been checked against human labels.
 */

export interface MoodSplit {
  counts: Record<Mood, number>;
  /** Scored, on-topic reactions in this group. */
  total: number;
  /** % positive minus % negative, -100 to +100. null when there is nothing scored. */
  net: number | null;
}

const zero = (): Record<Mood, number> => ({ "very-negative": 0, negative: 0, neutral: 0, positive: 0, "very-positive": 0 });

/** Counts toward mood: scored, and about GTA VI. */
export const counts = (r: Reaction) => r.mood !== null && r.topic !== "off-topic";
export const isOffTopic = (r: Reaction) => r.topic === "off-topic";

export function split(reactions: Reaction[]): MoodSplit {
  const tally = zero();
  let total = 0;
  for (const r of reactions) {
    if (!counts(r)) continue;
    tally[r.mood as Mood] += 1;
    total += 1;
  }
  const pos = tally.positive + tally["very-positive"];
  const neg = tally.negative + tally["very-negative"];
  return { counts: tally, total, net: total === 0 ? null : Math.round(((pos - neg) / total) * 100) };
}

/** Below this many reactions a share swings on a handful of posts. */
export const SMALL_SAMPLE = 30;

/** Plain, hedged words for a net score. */
export function verdict(net: number | null): string {
  if (net === null) return "No data yet";
  if (net >= 50) return "Strongly positive";
  if (net >= 20) return "Leaning positive";
  if (net > -20) return "Mixed";
  if (net > -50) return "Leaning negative";
  return "Strongly negative";
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
  /** Counted reactions older than the window. */
  older: number;
  /** Counted reactions with no timestamp at all. */
  untimed: number;
  /** Counted reactions in the window whose time is approximate (YouTube's "3 hours ago"). */
  approximate: number;
}

const HOUR = 60 * 60_000;
/** Show at least this many hours, so a burst in the last hour still has context. */
const MIN_HOURS = 6;

/**
 * Fixed one-hour columns by when each reaction was posted, over the last 24
 * hours. The window starts at the first hour that has a reaction (and covers
 * at least six hours), so a quiet start of the day doesn't flatten the chart,
 * but a column always means the same span of time.
 */
export function timeline(reactions: Reaction[], now: number, maxHours = 24): Timeline {
  const counted = reactions.filter(counts);
  const times = counted.map((r) => (r.createdAt ? Date.parse(r.createdAt) : Number.NaN));
  const untimed = times.filter((t) => !Number.isFinite(t)).length;
  const end = Math.ceil(now / HOUR) * HOUR;
  const windowStart = end - maxHours * HOUR;
  const inWindow = counted.filter((_, i) => Number.isFinite(times[i]) && times[i] >= windowStart && times[i] <= now);
  const older = counted.length - untimed - inWindow.length;
  const approximate = inWindow.filter((r) => r.platform === "youtube" && r.kind === "comment").length;
  if (inWindow.length === 0) return { buckets: [], bucketMs: HOUR, older, untimed, approximate };

  const earliest = Math.min(...inWindow.map((r) => Date.parse(r.createdAt as string)));
  const start = Math.min(Math.floor(earliest / HOUR) * HOUR, end - MIN_HOURS * HOUR);
  const count = Math.round((end - start) / HOUR);
  const groups: Reaction[][] = Array.from({ length: count }, () => []);
  for (const r of inWindow) groups[Math.min(count - 1, Math.floor((Date.parse(r.createdAt as string) - start) / HOUR))].push(r);
  return {
    buckets: groups.map((items, i) => ({ start: start + i * HOUR, end: start + (i + 1) * HOUR, ...split(items) })),
    bucketMs: HOUR,
    older,
    untimed,
    approximate,
  };
}

const engagement = (r: Reaction) => (r.likes ?? 0) + (r.comments ?? 0) + (r.views ?? 0) / 100;

export interface Coverage {
  /** Reactions the feeds returned. */
  loaded: number;
  /** Scored and about GTA VI: the ones every mood figure is built from. */
  counted: number;
  /** Scored as not about GTA VI, and left out. */
  offTopic: number;
  /** Not scored yet, or scoring gave up on them. */
  unscored: number;
}

export interface SentimentSummary {
  coverage: Coverage;
  overall: MoodSplit;
  byPlatform: ({ platform: ReactionPlatform } & MoodSplit)[];
  byTopic: ({ topic: Topic } & MoodSplit)[];
  timeline: Timeline;
  loudestLove: Reaction[];
  loudestGripes: Reaction[];
}

export function summarize(reactions: Reaction[], now: number): SentimentSummary {
  const counted = reactions.filter(counts);
  const loud = (keep: (r: Reaction) => boolean) =>
    counted
      .filter(keep)
      .sort((a, b) => engagement(b) - engagement(a))
      .slice(0, 3);

  return {
    coverage: {
      loaded: reactions.length,
      counted: counted.length,
      offTopic: reactions.filter((r) => r.mood !== null && isOffTopic(r)).length,
      unscored: reactions.filter((r) => r.mood === null).length,
    },
    overall: split(counted),
    byPlatform: REACTION_PLATFORMS.map((platform) => ({ platform, ...split(counted.filter((r) => r.platform === platform)) })),
    byTopic: TOPICS.filter((t) => t.id !== "off-topic")
      .map((t) => ({ topic: t.id, ...split(counted.filter((r) => r.topic === t.id)) }))
      .filter((t) => t.total > 0)
      .sort((a, b) => b.total - a.total),
    timeline: timeline(counted, now),
    loudestLove: loud((r) => r.mood === "positive" || r.mood === "very-positive"),
    loudestGripes: loud((r) => r.mood === "negative" || r.mood === "very-negative"),
  };
}

export const MOOD_ORDER = MOODS;
