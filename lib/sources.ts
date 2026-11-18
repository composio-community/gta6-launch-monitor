import { authStatus, SignInRequiredError } from "./composio-mcp.ts";
import { cacheTtlMs, ERROR_BACKOFF_MS, FORCE_FLOOR_MS, GAME, socialTtlMs } from "./config.ts";
import { BudgetExceededError, budgetStatus, describeError, readCardPage, runInstant, type CardPage, type OffloadSpec } from "./instant.ts";
import { parseKickMarkdown } from "./parse/kick.ts";
import {
  parseInstagramReactions,
  parseLinkedInReactions,
  parseRedditReactions,
  parseTopVideos,
  parseXReactions,
  parseYouTubeComments,
  type VideoRef,
} from "./parse/reactions.ts";
import { parseInstagramHashtag, parseLinkedInSearch, parseRedditSearch, parseXSearch } from "./parse/social.ts";
import { parseTwitchMarkdown } from "./parse/twitch.ts";
import { findString, unwrapJson } from "./parse/util.ts";
import { parseScrapeCreatorsYouTube } from "./parse/youtube.ts";
import { scoreSome, scoringStatus, withScores } from "./scoring.ts";
import { configError, session } from "./session.ts";
import type { LiveStream, Reaction, Section, SocialPost, SourceId, SourceStatus, StreamsPayload } from "./types.ts";

interface Parsed {
  streams: LiveStream[];
  posts: SocialPost[];
  reactions: Reaction[];
}

/** How a source loads its next page. */
type MoreSpec =
  /** The tool returns a cursor; pass it back as `param`. */
  | { kind: "cursor"; param: string; read: (data: unknown) => string | null; maxPages?: number }
  /** The first response was offloaded to the sandbox; read the next slice of that file. */
  | { kind: "sandbox"; spec: { cards: { key: string; end: string } } }
  /** No paging at all; scrape other views of the same listing instead. */
  | { kind: "variants"; variants: { label: string; url: string }[] }
  /** Work through a list found by the seed step: the next page is the next item. */
  | { kind: "queue" };

/** A first step whose result decides what the source's own tool is run on (e.g. which videos). */
interface Seed {
  tool: string;
  reserveUsd: number;
  args: () => Record<string, unknown>;
  read: (data: unknown) => VideoRef[];
  /** Items fetched on the first page. */
  firstPage: number;
  argsFor: (item: VideoRef) => Record<string, unknown>;
  parseFor: (data: unknown, item: VideoRef) => Parsed;
}

interface Source {
  id: SourceId;
  section: Section;
  /** Composio tool slug. */
  tool: string;
  /**
   * Upper bound reserved against the spend cap before the call. The charge
   * Composio reports replaces it; if none is reported, this is what is counted.
   */
  reserveUsd: number;
  ttlMs: () => number;
  /** Built per call so the scrape URLs can carry a cache buster. */
  args: () => Record<string, unknown>;
  /** Keys to read back when Composio offloads a large response to its sandbox. */
  offload: OffloadSpec;
  parse: (data: unknown) => Parsed;
  more: MoreSpec;
  seed?: Seed;
}

const streams = (streams: LiveStream[]): Parsed => ({ streams, posts: [], reactions: [] });
const posts = (posts: SocialPost[]): Parsed => ({ streams: [], posts, reactions: [] });
const reactions = (reactions: Reaction[]): Parsed => ({ streams: [], posts: [], reactions });
const EMPTY: Parsed = { streams: [], posts: [], reactions: [] };

function markdownOf(data: unknown): string {
  const markdown = typeof data === "string" ? data : findString(data, "markdown");
  if (!markdown) throw new Error("Scrape returned no page text");
  return markdown;
}

/** First non-empty cursor stored under any of `keys`. */
const cursorAt =
  (...keys: string[]) =>
  (data: unknown): string | null => {
    const body = unwrapJson(data);
    for (const key of keys) {
      const value = findString(body, key);
      if (value) return value;
    }
    return null;
  };

/**
 * Firecrawl caches pages for days and this tool exposes no max-age option, so
 * each scrape gets a throwaway query parameter. Twitch and Kick ignore it.
 */
function cacheBusted(url: string): string {
  const u = new URL(url);
  u.searchParams.set("_cb", Math.floor(Date.now() / 1000).toString(36));
  return u.toString();
}

/** Card-only markdown keeps the response small enough to come back inline. */
const scrapeArgs = (url: string, includeTags: string[]) => ({
  url: cacheBusted(url),
  formats: ["markdown"],
  onlyMainContent: false,
  includeTags,
  waitFor: 6000,
  timeout: 45000,
});

const twitchUrl = (sort: string) => `https://www.twitch.tv/directory/category/${GAME.twitchSlug}?sort=${sort}`;

/** Each Kick card ends with its category line; pages are cut there. Python regex. */
const KICK_CARD_END = String.raw`\[[^\]]*\]\(https://kick\.com/category/[^)\s]+\)[^\n]*`;

export const SOURCES: Source[] = [
  {
    id: "twitch",
    section: "streamers",
    tool: "FIRECRAWL_SCRAPE",
    reserveUsd: 0.003,
    ttlMs: cacheTtlMs,
    args: () => scrapeArgs(twitchUrl("VIEWER_COUNT"), ["article"]),
    offload: { keys: ["markdown"] },
    parse: (data) => streams(parseTwitchMarkdown(markdownOf(data))),
    // Instant's Firecrawl can't scroll (no browser actions), so a scrape only
    // sees the first ~30 cards. Other sort orders show different streams.
    more: {
      kind: "variants",
      variants: [
        { label: "Recently started streams", url: twitchUrl("RECENT") },
        { label: "Smallest streams", url: twitchUrl("VIEWER_COUNT_ASC") },
      ],
    },
  },
  {
    id: "kick",
    section: "streamers",
    tool: "FIRECRAWL_SCRAPE",
    reserveUsd: 0.003,
    ttlMs: cacheTtlMs,
    args: () => scrapeArgs(GAME.kickCategoryUrl, ['[data-testid="livestream-results-card"]']),
    // Kick renders hundreds of cards, so the response is always offloaded.
    // Pages are read from that saved file: no extra charge.
    offload: { cards: { key: "markdown", end: KICK_CARD_END } },
    parse: (data) => streams(parseKickMarkdown(markdownOf(data))),
    more: { kind: "sandbox", spec: { cards: { key: "markdown", end: KICK_CARD_END } } },
  },
  {
    id: "youtube",
    section: "streamers",
    tool: "SCRAPECREATORS_SEARCH_YOUTUBE",
    reserveUsd: 0.001,
    ttlMs: cacheTtlMs,
    args: () => ({ query: GAME.youtubeQuery, upload_date: "today", sort_by: "relevance" }),
    offload: { keys: ["lives", "videos", "next_cursor"] },
    parse: (data) => streams(parseScrapeCreatorsYouTube(data)),
    more: { kind: "cursor", param: "next_cursor", read: cursorAt("next_cursor", "continuationToken") },
  },
  {
    id: "x",
    section: "streamers",
    tool: "GETANYAPI_TWITTER_SEARCH",
    reserveUsd: 0.005,
    ttlMs: socialTtlMs,
    args: () => ({ query: GAME.xQuery, limit: 20, max_cost_usd: "0.005" }),
    offload: { keys: ["items", "nextCursor"] },
    parse: (data) => posts(parseXSearch(data)),
    more: { kind: "cursor", param: "cursor", read: cursorAt("nextCursor") },
  },
  {
    id: "reddit",
    section: "streamers",
    tool: "SCRAPECREATORS_SEARCH_REDDIT",
    reserveUsd: 0.001,
    ttlMs: socialTtlMs,
    args: () => ({ query: GAME.redditQuery, trim: true }),
    offload: { keys: ["items", "next_cursor"] },
    parse: (data) => posts(parseRedditSearch(data)),
    more: { kind: "cursor", param: "next_cursor", read: cursorAt("next_cursor") },
  },
  {
    id: "instagram",
    section: "streamers",
    tool: "GETANYAPI_INSTAGRAM_HASHTAG_RECENT_POSTS",
    reserveUsd: 0.005,
    ttlMs: socialTtlMs,
    args: () => ({ hashtag: GAME.instagramHashtag, max_cost_usd: "0.005", response_max_items: 30 }),
    offload: { keys: ["posts", "nextCursor"] },
    parse: (data) => posts(parseInstagramHashtag(data)),
    more: { kind: "cursor", param: "cursor", read: cursorAt("nextCursor") },
  },
  {
    id: "linkedin",
    section: "streamers",
    tool: "SCRAPECREATORS_SEARCH_LINKEDIN_POSTS",
    reserveUsd: 0.001,
    ttlMs: socialTtlMs,
    args: () => ({ query: GAME.linkedinQuery }),
    offload: { keys: ["items", "next_cursor"] },
    parse: (data) => posts(parseLinkedInSearch(data)),
    // The tool documents at most 11 pages.
    more: { kind: "cursor", param: "next_cursor", read: cursorAt("next_cursor"), maxPages: 11 },
  },

  // ---------- Reactions: what people say about the game itself ----------
  {
    id: "react-x",
    section: "reactions",
    tool: "GETANYAPI_TWITTER_SEARCH",
    reserveUsd: 0.005,
    ttlMs: socialTtlMs,
    args: () => ({ query: xReactionQuery(), limit: 20, max_cost_usd: "0.005" }),
    offload: { keys: ["items", "nextCursor"] },
    parse: (data) => reactions(parseXReactions(data)),
    more: { kind: "cursor", param: "cursor", read: cursorAt("nextCursor") },
  },
  {
    id: "react-reddit",
    section: "reactions",
    tool: "SCRAPECREATORS_LIST_REDDIT_SUBREDDIT_POSTS",
    reserveUsd: 0.001,
    ttlMs: socialTtlMs,
    args: () => ({ subreddit: GAME.reactionSubreddit, trim: true }),
    offload: { keys: ["items", "next_cursor"] },
    parse: (data) => reactions(parseRedditReactions(data)),
    more: { kind: "cursor", param: "next_cursor", read: cursorAt("next_cursor") },
  },
  {
    id: "react-youtube",
    section: "reactions",
    tool: "GETANYAPI_YOUTUBE_VIDEO_COMMENTS",
    reserveUsd: 0.005,
    ttlMs: socialTtlMs,
    args: () => ({}),
    offload: { keys: ["comments", "nextCursor"] },
    parse: () => EMPTY,
    // Comments from today's top GTA VI uploads: two on the first page, then one video per page.
    seed: {
      tool: "SCRAPECREATORS_SEARCH_YOUTUBE",
      reserveUsd: 0.001,
      args: () => ({ query: GAME.reactionVideoQuery, upload_date: "today", sort_by: "popular", content_type: "videos" }),
      read: (data) => parseTopVideos(data),
      firstPage: 2,
      argsFor: (video) => ({ url: video.url, max_cost_usd: "0.005" }),
      parseFor: (data, video) => reactions(parseYouTubeComments(data, video)),
    },
    more: { kind: "queue" },
  },
  {
    id: "react-instagram",
    section: "reactions",
    tool: "GETANYAPI_INSTAGRAM_HASHTAG_TOP_POSTS",
    reserveUsd: 0.005,
    ttlMs: socialTtlMs,
    args: () => ({ hashtag: GAME.reactionHashtag, max_cost_usd: "0.005", response_max_items: 30 }),
    offload: { keys: ["posts", "nextCursor"] },
    parse: (data) => reactions(parseInstagramReactions(data)),
    more: { kind: "cursor", param: "cursor", read: cursorAt("nextCursor") },
  },
  {
    id: "react-linkedin",
    section: "reactions",
    tool: "SCRAPECREATORS_SEARCH_LINKEDIN_POSTS",
    reserveUsd: 0.001,
    ttlMs: socialTtlMs,
    args: () => ({ query: GAME.reactionQuery }),
    offload: { keys: ["items", "next_cursor"] },
    parse: (data) => reactions(parseLinkedInReactions(data)),
    more: { kind: "cursor", param: "next_cursor", read: cursorAt("next_cursor"), maxPages: 11 },
  },
];

/** Popular posts about the game since yesterday (UTC): reactions, not stream announcements. */
function xReactionQuery(): string {
  const since = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString().slice(0, 10);
  return `${GAME.xReactionQuery} since:${since}`;
}

const SOURCE_BY_ID = new Map(SOURCES.map((s) => [s.id, s]));
export const isSourceId = (id: unknown): id is SourceId => typeof id === "string" && SOURCE_BY_ID.has(id as SourceId);

/** A stream that no refresh has returned for this long has probably ended. */
const STREAM_KEEP_MS = 10 * 60 * 1000;
/** Cap per source, so paging can't grow memory without bound. */
const MAX_ITEMS = 600;

interface CacheEntry {
  streams: Map<string, LiveStream>;
  /** Stream id -> last time a fetch returned it. */
  seen: Map<string, number>;
  posts: Map<string, SocialPost>;
  reactions: Map<string, Reaction>;
  /** Items found by a seed step and not read yet, worked through one per page. */
  queue: VideoRef[];
  /** Seed items already read, so a refresh's new search doesn't queue them again. */
  seenItems: Set<string>;
  /** State of the last first-page fetch. */
  status: SourceStatus;
  attemptedAt: number;
  ok: boolean;
  pages: number;
  hasMore: boolean;
  /** Where the next page starts. */
  cursor: string | null;
  sandboxFile: string | null;
  sandboxNext: number;
  variant: number;
  /** Serializes refreshes and page loads on one source. */
  lock: Promise<unknown>;
  refreshing: Promise<void> | null;
}

/**
 * Cached feed results and paging position, per signed-in visitor: each visitor
 * fetches with their own account, and "Load more" moves only their own feed.
 * In memory, so on a serverless host it lasts as long as the warm instance;
 * a cold instance simply fetches again.
 */
interface VisitorCache {
  entries: Map<SourceId, CacheEntry>;
  lastUsed: number;
}
const MAX_VISITORS = 200;
const VISITOR_IDLE_MS = 30 * 60 * 1000;

// Kept on globalThis so dev hot reloads don't drop it. Bump the version when
// CacheEntry changes shape, or entries from the old code will be read as new.
const CACHE_KEY = "__gtaSources_v5";
const globalStore = globalThis as typeof globalThis & { [CACHE_KEY]?: Map<string, VisitorCache> };
const visitors: Map<string, VisitorCache> = (globalStore[CACHE_KEY] ??= new Map<string, VisitorCache>());

function cacheFor(): Map<SourceId, CacheEntry> {
  const sid = session().sid;
  const now = Date.now();
  let v = visitors.get(sid);
  if (!v) {
    for (const [id, other] of visitors) if (now - other.lastUsed > VISITOR_IDLE_MS) visitors.delete(id);
    while (visitors.size >= MAX_VISITORS) {
      const oldest = [...visitors.entries()].sort((a, b) => a[1].lastUsed - b[1].lastUsed)[0];
      visitors.delete(oldest[0]);
    }
    v = { entries: new Map(), lastUsed: now };
    visitors.set(sid, v);
  }
  v.lastUsed = now;
  return v.entries;
}

/** Forget a visitor's cached feeds (on sign-out). */
export function dropVisitorCache(sid: string) {
  visitors.delete(sid);
}

function blankStatus(source: Source, state: SourceStatus["state"], error: string | null = null): SourceStatus {
  return {
    source: source.id,
    state,
    tool: source.tool,
    count: 0,
    lastChargeUsd: null,
    chargeEstimated: false,
    fetchedAt: null,
    error,
    hasMore: false,
    pages: 0,
    moreCostUsd: null,
    moreLabel: null,
  };
}

function entryFor(source: Source): CacheEntry {
  const cache = cacheFor();
  let entry = cache.get(source.id);
  if (!entry) {
    entry = {
      streams: new Map(),
      seen: new Map(),
      posts: new Map(),
      reactions: new Map(),
      queue: [],
      seenItems: new Set(),
      status: blankStatus(source, "cached"),
      attemptedAt: 0,
      ok: false,
      pages: 0,
      hasMore: false,
      cursor: null,
      sandboxFile: null,
      sandboxNext: 0,
      variant: 0,
      lock: Promise.resolve(),
      refreshing: null,
    };
    cache.set(source.id, entry);
  }
  return entry;
}

function withLock<T>(entry: CacheEntry, fn: () => Promise<T>): Promise<T> {
  const run = entry.lock.then(fn, fn);
  entry.lock = run.catch(() => undefined);
  return run;
}

function merge(entry: CacheEntry, parsed: Parsed) {
  const now = Date.now();
  for (const s of parsed.streams) {
    entry.streams.set(s.id, s);
    entry.seen.set(s.id, now);
  }
  for (const p of parsed.posts) entry.posts.set(p.id, p);
  for (const r of parsed.reactions) entry.reactions.set(r.id, r);

  for (const [id, seenAt] of entry.seen) {
    if (now - seenAt > STREAM_KEEP_MS) {
      entry.seen.delete(id);
      entry.streams.delete(id);
    }
  }
  if (entry.posts.size > MAX_ITEMS) {
    const newestFirst = [...entry.posts.values()].sort((a, b) => Date.parse(b.createdAt ?? "0") - Date.parse(a.createdAt ?? "0"));
    entry.posts = new Map(newestFirst.slice(0, MAX_ITEMS).map((p) => [p.id, p]));
  }
  if (entry.reactions.size > MAX_ITEMS) {
    const newestFirst = [...entry.reactions.values()].sort((a, b) => Date.parse(b.createdAt ?? "0") - Date.parse(a.createdAt ?? "0"));
    entry.reactions = new Map(newestFirst.slice(0, MAX_ITEMS).map((r) => [r.id, r]));
  }
  if (entry.streams.size > MAX_ITEMS) {
    const ranked = [...entry.streams.values()].sort((a, b) => (b.viewers ?? -1) - (a.viewers ?? -1));
    entry.streams = new Map(ranked.slice(0, MAX_ITEMS).map((s) => [s.id, s]));
  }
}

function snapshotOf(entry: CacheEntry): Parsed {
  return { streams: [...entry.streams.values()], posts: [...entry.posts.values()], reactions: [...entry.reactions.values()] };
}

function moreInfo(source: Source, entry: CacheEntry): Pick<SourceStatus, "moreCostUsd" | "moreLabel"> {
  if (!entry.hasMore) return { moreCostUsd: null, moreLabel: null };
  const more = source.more;
  if (more.kind === "sandbox") return { moreCostUsd: 0, moreLabel: "Next streams from the saved page" };
  const cost = entry.status.lastChargeUsd ?? source.reserveUsd;
  if (more.kind === "variants") return { moreCostUsd: cost, moreLabel: more.variants[entry.variant]?.label ?? null };
  if (more.kind === "queue") {
    const next = entry.queue[entry.variant];
    return { moreCostUsd: cost, moreLabel: next ? `Comments on “${next.title.slice(0, 48)}${next.title.length > 48 ? "…" : ""}”` : null };
  }
  return { moreCostUsd: cost, moreLabel: `Page ${entry.pages + 1}` };
}

function statusOf(source: Source, entry: CacheEntry, state = entry.status.state): SourceStatus {
  return {
    ...entry.status,
    state,
    count: entry.streams.size + entry.posts.size + entry.reactions.size,
    hasMore: entry.hasMore,
    pages: entry.pages,
    ...moreInfo(source, entry),
  };
}

function failureState(error: unknown): SourceStatus["state"] {
  if (error instanceof BudgetExceededError) return "budget";
  if (error instanceof SignInRequiredError) return "signed-out";
  return "error";
}

/** First page. Keeps pages loaded earlier; refreshed items replace their old copies. */
/** First page of a seeded source: run the seed, then the source's tool on the first few items. */
async function fetchSeeded(source: Source, seed: Seed, entry: CacheEntry): Promise<void> {
  const found = await runInstant(seed.tool, seed.args(), seed.reserveUsd, { keys: ["videos"] });
  const items = seed.read(found.data);
  if (items.length === 0) throw new Error("No matching items to read from");
  // The first page always re-reads the top items (their comments move fastest).
  const first = items.slice(0, seed.firstPage);
  const results = await Promise.all(first.map((item) => runInstant(source.tool, seed.argsFor(item), source.reserveUsd, source.offload)));
  results.forEach((result, i) => merge(entry, seed.parseFor(result.data, first[i])));
  for (const item of first) entry.seenItems.add(item.url);
  entry.queue = items.filter((item) => !entry.seenItems.has(item.url));
  entry.variant = 0;
  entry.hasMore = entry.queue.length > 0;
  entry.pages = Math.max(entry.pages, 1);
  entry.ok = true;
  const charge = found.chargeUsd + results.reduce((sum, r) => sum + r.chargeUsd, 0);
  entry.status = {
    ...blankStatus(source, "live"),
    lastChargeUsd: results[0]?.chargeUsd ?? charge,
    chargeEstimated: found.estimated || results.some((r) => r.estimated),
    fetchedAt: new Date().toISOString(),
  };
}

async function fetchFirstPage(source: Source, entry: CacheEntry): Promise<void> {
  entry.attemptedAt = Date.now();
  if (source.seed) {
    try {
      await fetchSeeded(source, source.seed, entry);
    } catch (error) {
      entry.ok = false;
      entry.status = { ...entry.status, state: failureState(error), error: describeError(error) };
    }
    return;
  }
  try {
    const result = await runInstant(source.tool, source.args(), source.reserveUsd, source.offload);
    const parsed = source.parse(result.data);
    if (parsed.streams.length + parsed.posts.length === 0 && (source.id === "twitch" || source.id === "kick")) {
      // The call was charged but the page had no cards: blocked, or the layout changed.
      throw new Error("Page scraped but no stream cards were found");
    }
    merge(entry, parsed);

    const more = source.more;
    if (more.kind === "cursor") {
      // Once deeper pages are loaded, keep following them instead of restarting at page 2.
      if (entry.pages <= 1) {
        entry.cursor = more.read(result.data);
        entry.hasMore = entry.cursor !== null;
      }
    } else if (more.kind === "sandbox") {
      const page = result.data as Partial<CardPage>;
      entry.sandboxFile = result.offloadedPath;
      // A fresh scrape has a new file; carry on from where the reader got to.
      entry.sandboxNext = Math.max(entry.sandboxNext, page.next ?? 0);
      entry.hasMore = entry.sandboxFile !== null && typeof page.total === "number" && entry.sandboxNext < page.total;
    } else if (more.kind === "variants") {
      entry.hasMore = entry.variant < more.variants.length;
    }
    entry.pages = Math.max(entry.pages, 1);
    entry.ok = true;
    entry.status = {
      ...blankStatus(source, "live"),
      lastChargeUsd: result.chargeUsd,
      chargeEstimated: result.estimated,
      fetchedAt: new Date().toISOString(),
    };
  } catch (error) {
    entry.ok = false;
    // Keep showing what was loaded; only the status changes.
    entry.status = { ...entry.status, state: failureState(error), error: describeError(error) };
  }
}

/** The next page, appended to what is loaded. */
async function fetchNextPage(source: Source, entry: CacheEntry): Promise<void> {
  if (!entry.hasMore) return;
  const more = source.more;
  try {
    if (more.kind === "cursor") {
      if (!entry.cursor) return;
      const result = await runInstant(source.tool, { ...source.args(), [more.param]: entry.cursor }, source.reserveUsd, source.offload);
      merge(entry, source.parse(result.data));
      entry.pages += 1;
      const next = more.read(result.data);
      // A cursor that comes back unchanged would loop forever.
      entry.cursor = next && next !== entry.cursor ? next : null;
      entry.hasMore = entry.cursor !== null && (more.maxPages === undefined || entry.pages < more.maxPages);
      entry.status = { ...entry.status, lastChargeUsd: result.chargeUsd, chargeEstimated: result.estimated, error: null };
    } else if (more.kind === "sandbox") {
      if (!entry.sandboxFile) return;
      const page = await readCardPage(entry.sandboxFile, more.spec, entry.sandboxNext);
      merge(entry, source.parse(page.markdown));
      entry.pages += 1;
      entry.sandboxNext = page.next;
      entry.hasMore = page.next < page.total;
      entry.status = { ...entry.status, error: null };
    } else if (more.kind === "queue") {
      const item = entry.queue[entry.variant];
      if (!item || !source.seed) return;
      const result = await runInstant(source.tool, source.seed.argsFor(item), source.reserveUsd, source.offload);
      merge(entry, source.seed.parseFor(result.data, item));
      entry.seenItems.add(item.url);
      entry.pages += 1;
      entry.variant += 1;
      entry.hasMore = entry.variant < entry.queue.length;
      entry.status = { ...entry.status, lastChargeUsd: result.chargeUsd, chargeEstimated: result.estimated, error: null };
    } else {
      const variant = more.variants[entry.variant];
      if (!variant) return;
      const args = { ...source.args(), url: cacheBusted(variant.url) };
      const result = await runInstant(source.tool, args, source.reserveUsd, source.offload);
      merge(entry, source.parse(result.data));
      entry.pages += 1;
      entry.variant += 1;
      entry.hasMore = entry.variant < more.variants.length;
      entry.status = { ...entry.status, lastChargeUsd: result.chargeUsd, chargeEstimated: result.estimated, error: null };
    }
  } catch (error) {
    if (more.kind === "sandbox" && !(error instanceof BudgetExceededError) && !(error instanceof SignInRequiredError)) {
      // The sandbox file can be cleaned up; the next refresh brings a new one and resumes at the same offset.
      entry.sandboxFile = null;
      entry.hasMore = false;
      entry.status = { ...entry.status, error: "The saved Kick page expired. More will be available after the next refresh." };
      return;
    }
    entry.status = { ...entry.status, error: `Load more failed: ${describeError(error)}` };
  }
}

async function liveSource(source: Source, force: boolean): Promise<{ parsed: Parsed; status: SourceStatus }> {
  const entry = entryFor(source);
  const age = Date.now() - entry.attemptedAt;
  const window = force ? FORCE_FLOOR_MS : entry.ok ? source.ttlMs() : ERROR_BACKOFF_MS;

  if (age >= window || entry.refreshing) {
    if (!entry.refreshing) {
      entry.refreshing = withLock(entry, () => fetchFirstPage(source, entry)).finally(() => {
        entry.refreshing = null;
      });
    }
    await entry.refreshing;
    return { parsed: snapshotOf(entry), status: statusOf(source, entry) };
  }
  // No Instant call on this request: report a good result as cached, keep a failure as it was.
  return { parsed: snapshotOf(entry), status: statusOf(source, entry, entry.ok ? "cached" : entry.status.state) };
}

/** Load the next page of each named source that has one. */
export async function loadMore(ids: SourceId[]): Promise<void> {
  if (!(await authStatus()).signedIn) return;
  await Promise.all(
    ids.map(async (id) => {
      const source = SOURCE_BY_ID.get(id);
      const entry = cacheFor().get(id);
      if (!source || !entry || !entry.ok || !entry.hasMore) return;
      await withLock(entry, () => fetchNextPage(source, entry));
    }),
  );
}

/** A source whose tab is not open: show what is already loaded, fetch nothing. */
function idleSource(source: Source): { parsed: Parsed; status: SourceStatus } {
  const entry = cacheFor().get(source.id);
  if (!entry || entry.attemptedAt === 0) return { parsed: EMPTY, status: blankStatus(source, "idle") };
  return { parsed: snapshotOf(entry), status: statusOf(source, entry, entry.ok ? "cached" : entry.status.state) };
}

export async function getStreams(options: { force: boolean; sections?: Section[] }): Promise<StreamsPayload> {
  const sections: Section[] = options.sections?.length ? options.sections : ["streamers"];
  const before = await authStatus();
  let results: { parsed: Parsed; status: SourceStatus }[];

  if (!before.signedIn) {
    results = SOURCES.map((source) => ({ parsed: EMPTY, status: blankStatus(source, "signed-out") }));
  } else {
    const newestFirst = (items: Reaction[]) => [...items].sort((a, b) => Date.parse(b.createdAt ?? "0") - Date.parse(a.createdAt ?? "0"));
    results = await Promise.all(
      SOURCES.map(async (source) => {
        if (!sections.includes(source.section)) return idleSource(source);
        const result = await liveSource(source, options.force);
        // Score each reaction feed the moment it lands, alongside the feeds still loading,
        // instead of waiting for the slowest one.
        if (source.section === "reactions") await scoreSome(newestFirst(result.parsed.reactions));
        return result;
      }),
    );
    if (sections.includes("reactions")) {
      // One more pass over everything loaded: pages from "Load more", and leftovers past each feed's first batches.
      const cache = cacheFor();
      await scoreSome(newestFirst(SOURCES.filter((s) => s.section === "reactions").flatMap((s) => [...(cache.get(s.id)?.reactions.values() ?? [])])));
    }
  }

  // A call can find the sign-in expired, so read the status again afterwards.
  const auth = before.signedIn ? await authStatus() : before;

  const seen = new Set<string>();
  const unique = <T extends { id: string }>(items: T[]) => items.filter((i) => (seen.has(i.id) ? false : (seen.add(i.id), true)));
  const newestFirst = <T extends { createdAt: string | null }>(a: T, b: T) =>
    (b.createdAt ? Date.parse(b.createdAt) : 0) - (a.createdAt ? Date.parse(a.createdAt) : 0);

  const allReactions = withScores(unique(results.flatMap((r) => r.parsed.reactions))).sort(newestFirst);

  return {
    signedIn: auth.signedIn,
    account: auth.account,
    authError: configError() ?? auth.error,
    sections,
    streams: unique(results.flatMap((r) => r.parsed.streams)).sort((a, b) => (b.viewers ?? -1) - (a.viewers ?? -1)),
    posts: unique(results.flatMap((r) => r.parsed.posts)).sort(newestFirst),
    reactions: allReactions,
    scoring: scoringStatus(allReactions),
    sources: results.map((r) => r.status),
    budget: budgetStatus(),
    generatedAt: new Date().toISOString(),
  };
}
