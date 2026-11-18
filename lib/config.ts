/** What to watch. Change these to point the finder at a different game. */
export const GAME = {
  name: "Grand Theft Auto VI",
  /** Category slug in https://www.twitch.tv/directory/category/<slug>. */
  twitchSlug: "grand-theft-auto-vi",
  kickCategoryUrl: "https://kick.com/category/grand-theft-auto-vi",
  youtubeQuery: "GTA 6 live",
  /**
   * The game named in a post's own text. X search also matches the author's
   * name and handle, quoted posts and link previews, so X posts are kept only
   * when their text matches. "#GTA6Live" counts; "GTA Vice City" and "GTA 60fps" don't.
   */
  mention: /(?<![a-z0-9])(gta[\s-]?6(?!\d)|gta[\s-]?vi\b|grand\s+theft\s+auto\s+(6|vi)\b)/i,
  /** X advanced search: posts announcing a GTA VI stream, no replies. */
  xQuery: `(GTA6 OR "GTA 6" OR "GTA VI") ("live now" OR "going live" OR "im live" OR "i'm live" OR twitch.tv OR kick.com) -filter:replies`,
  redditQuery: "GTA 6 live stream",
  linkedinQuery: "GTA 6 live stream",
  instagramHashtag: "gta6live",

  // Reactions: what people say about the game, not who is streaming it.
  /** X advanced search for popular posts; a since: date is added per call. */
  xReactionQuery: `("GTA 6" OR GTA6 OR "GTA VI") -filter:replies -filter:retweets min_faves:25`,
  reactionSubreddit: "GTA6",
  /** YouTube search for today's most-watched uploads, whose comments are read. */
  reactionVideoQuery: "GTA 6",
  reactionHashtag: "gta6",
  reactionQuery: "GTA 6",
} as const;

function numberFromEnv(name: string, fallback: number, min: number): number {
  const raw = process.env[name];
  if (!raw) return fallback;
  const n = Number.parseFloat(raw);
  return Number.isFinite(n) && n >= min ? n : fallback;
}

/** Hard ceiling on Composio Instant spend for the life of the server process, in USD. */
export const budgetCapUsd = () => numberFromEnv("INSTANT_BUDGET_USD", 1, 0);

/** How long a stream source's result is reused before Instant is called again. */
export const cacheTtlMs = () => numberFromEnv("STREAMS_TTL_SECONDS", 120, 20) * 1000;

/** Social posts move slower than viewer counts, so they are refreshed less often. */
export const socialTtlMs = () => numberFromEnv("SOCIAL_TTL_SECONDS", 300, 60) * 1000;

/** A manual refresh may bypass the cache, but never more often than this. */
export const FORCE_FLOOR_MS = 20_000;

/** After a failed call, wait this long before trying that source again. */
export const ERROR_BACKOFF_MS = 30_000;
