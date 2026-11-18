/** Platforms with live streams. */
export type Platform = "twitch" | "kick" | "youtube";
export const PLATFORMS: Platform[] = ["twitch", "kick", "youtube"];

/** Platforms where creators post about their streams. */
export type SocialPlatform = "x" | "reddit" | "instagram" | "linkedin";
export const SOCIAL_PLATFORMS: SocialPlatform[] = ["x", "reddit", "instagram", "linkedin"];

/** Platforms reactions are collected from. */
export type ReactionPlatform = "x" | "reddit" | "youtube" | "instagram" | "linkedin";
export const REACTION_PLATFORMS: ReactionPlatform[] = ["x", "reddit", "youtube", "instagram", "linkedin"];

/** Reaction feeds have their own ids: same platforms as the social radar, different searches. */
export type ReactionSourceId = `react-${ReactionPlatform}`;
export const reactionSourceId = (p: ReactionPlatform): ReactionSourceId => `react-${p}`;

export type SourceId = Platform | SocialPlatform | ReactionSourceId;

/** Parts of the app that load data. A section's feeds are only fetched once its tab has been opened. */
export type Section = "streamers" | "reactions";

export const TOPICS = [
  { id: "gameplay", label: "Gameplay", hint: "missions, driving, combat, open world, activities" },
  { id: "story", label: "Story & characters", hint: "Jason, Lucia, plot, writing, cast, voice acting" },
  { id: "visuals", label: "Graphics & world", hint: "graphics, Vice City, Leonida, detail, physics" },
  { id: "performance", label: "Performance & bugs", hint: "frame rate, crashes, bugs, servers, download, install" },
  { id: "price", label: "Price & editions", hint: "price, editions, PC port, platforms, cloud gaming" },
  { id: "streams", label: "Streams & creators", hint: "streamers, watch parties, reactions, clips, giveaways" },
  { id: "hype", label: "Hype & launch", hint: "excitement, the wait, launch moment, memes, sales records" },
  { id: "other", label: "Other", hint: "anything else, or not about GTA VI" },
] as const;
export type Topic = (typeof TOPICS)[number]["id"];

/** Five-step mood, from the sentiment score. */
export type Mood = "very-negative" | "negative" | "neutral" | "positive" | "very-positive";
export const MOODS: Mood[] = ["very-negative", "negative", "neutral", "positive", "very-positive"];

export interface Reaction {
  /** Stable key: `${platform}:${post or comment id}` */
  id: string;
  platform: ReactionPlatform;
  kind: "post" | "comment";
  author: string;
  handle: string | null;
  avatar: string | null;
  /** Where it was said, e.g. "r/GTA6" or the video a comment is on. */
  context: string | null;
  text: string;
  url: string;
  createdAt: string | null;
  likes: number | null;
  comments: number | null;
  views: number | null;
  /** -2 (very negative) to +2 (very positive). null until scored. */
  sentiment: number | null;
  mood: Mood | null;
  topic: Topic | null;
}

export interface ScoringStatus {
  scored: number;
  /** Loaded reactions not scored yet. */
  pending: number;
  running: boolean;
  /** Composio tool used for scoring. */
  tool: string;
  lastChargeUsd: number | null;
  error: string | null;
}

export interface LiveStream {
  /** Stable key: `${platform}:${handle or video id}` */
  id: string;
  platform: Platform;
  /** Display name of the channel. */
  channel: string;
  /** URL-safe handle when the platform has one. */
  handle: string | null;
  title: string;
  /** Concurrent viewers. null when the source did not report a number. */
  viewers: number | null;
  url: string;
  thumbnail: string | null;
  avatar: string | null;
  /** Language as the platform labels it, e.g. "English", "Português". */
  language: string | null;
  tags: string[];
}

export interface SocialPost {
  /** Stable key: `${platform}:${post id}` */
  id: string;
  platform: SocialPlatform;
  author: string;
  /** @handle, u/name, or null. */
  handle: string | null;
  avatar: string | null;
  /** Where it was posted, e.g. "r/GTA6". */
  context: string | null;
  text: string;
  url: string;
  createdAt: string | null;
  likes: number | null;
  comments: number | null;
  views: number | null;
  /** The post says the author is streaming, or links to a stream. */
  goingLive: boolean;
}

export type SourceState =
  | "live" // fetched through Composio Instant on this request
  | "cached" // served from the in-memory cache, no Instant call made
  | "error" // the Instant call or the parse failed
  | "budget" // skipped because the spend cap is reached
  | "signed-out" // not signed in to Composio
  | "idle"; // its tab has not been opened, so nothing was fetched

export interface SourceStatus {
  source: SourceId;
  state: SourceState;
  /** Composio tool slug used for this source. */
  tool: string;
  count: number;
  /** Charge for the most recent real call, in USD. null when none was reported. */
  lastChargeUsd: number | null;
  /** True when the charge is the published rate, not a figure Composio returned. */
  chargeEstimated: boolean;
  fetchedAt: string | null;
  error: string | null;
  /** Another page can be loaded. */
  hasMore: boolean;
  /** Pages loaded so far, including the first. */
  pages: number;
  /** Expected cost of the next page in USD: 0 when it is read from data already paid for. */
  moreCostUsd: number | null;
  /** What "Load more" fetches next, in a few words. */
  moreLabel: string | null;
}

export interface BudgetStatus {
  spentUsd: number;
  capUsd: number;
  calls: number;
  /** True when at least one charge was estimated from the published rate. */
  estimated: boolean;
}

export interface StreamsPayload {
  /** Signed in to Composio Connect (the MCP server). */
  signedIn: boolean;
  account: { name: string | null; email: string | null } | null;
  /** Last sign-in failure, if any. */
  authError: string | null;
  /** Sections whose feeds were refreshed for this payload. */
  sections: Section[];
  streams: LiveStream[];
  posts: SocialPost[];
  reactions: Reaction[];
  scoring: ScoringStatus;
  sources: SourceStatus[];
  budget: BudgetStatus;
  generatedAt: string;
}
