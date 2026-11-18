import { GAME } from "../config.ts";
import type { SocialPlatform, SocialPost } from "../types.ts";
import { cleanText, findArray, unwrapJson } from "./util.ts";

type Rec = Record<string, unknown>;
const rec = (v: unknown): Rec | null => (v !== null && typeof v === "object" && !Array.isArray(v) ? (v as Rec) : null);
const str = (v: unknown): string | null => (typeof v === "string" && v.trim().length > 0 ? v.trim() : null);
const num = (v: unknown): number | null => (typeof v === "number" && Number.isFinite(v) ? v : null);

/** Unix seconds, unix milliseconds, or an ISO string, to ISO. */
function toIso(v: unknown): string | null {
  if (typeof v === "number" && Number.isFinite(v) && v > 0) return new Date(v < 1e12 ? v * 1000 : v).toISOString();
  if (typeof v === "string" && !Number.isNaN(Date.parse(v))) return new Date(v).toISOString();
  return null;
}

/**
 * Strong signals: the writer says they are live or posts a stream link. These
 * count even in a question ("I'm live, who's watching?").
 */
const GOING_LIVE_STRONG = new RegExp(
  [
    String.raw`\b(live now|going live|now live|(just |has |have )?went live|goes live|is live|i'?m live|we'?re live|we are live|streaming now|on stream right now)\b`,
    // First person streaming is an announcement even when it ends in a question ("I'm streaming tonight, join?").
    String.raw`\b(i'?m|i am|we'?re|we are) (going to be |gonna be )?streaming\b`,
    // Spanish, Portuguese, French
    String.raw`\b(ao vivo|en vivo|en directo|en direct|na live)\b`,
    // "Twitch: https://..." link lists
    String.raw`\b(twitch|kick|youtube|yt)\s*:\s*https?:`,
    // Stream links that survived link shortening. youtu.be is left out: it is mostly ordinary videos.
    String.raw`twitch\.tv\/|kick\.com\/|youtube\.com\/live\b`,
  ].join("|"),
  "i",
);

/**
 * Weaker signals: talk of streaming that announces a stream in a statement,
 * but is usually someone asking for advice in a question ("best settings for
 * streaming GTA 6?"). These only count when the post is not a question.
 */
const GOING_LIVE_WEAK = new RegExp(
  [
    String.raw`\b(on stream|watch (me |us )?live|check (me|us) out live)\b`,
    String.raw`\bjoin (my|the|our) (gta ?(6|vi) )?(live ?)?stream\b`,
    String.raw`\blive ?stream(ing)? (gta ?(6|vi)|now|tonight|today)\b`,
    String.raw`\b(be|am|are) streaming\b`,
    String.raw`\bstreaming (gta|everything|it|live|tonight|today|all)\b`,
    String.raw`\bstream (tonight|today|starts|at \d|à \d|a las \d|ce soir)`,
    // The word "live" plus a platform name: "live only on Twitch"
    String.raw`\blive\b.*\b(twitch|kick|youtube)\b|\b(twitch|kick|youtube)\b.*\blive\b`,
  ].join("|"),
  "i",
);

const isQuestion = (text: string) => text.includes("?");

export const isGoingLive = (text: string) => GOING_LIVE_STRONG.test(text) || (!isQuestion(text) && GOING_LIVE_WEAK.test(text));

function post(platform: SocialPlatform, fields: Omit<SocialPost, "platform" | "goingLive" | "id"> & { rawId: string }): SocialPost {
  const { rawId, ...rest } = fields;
  return { ...rest, id: `${platform}:${rawId}`, platform, goingLive: isGoingLive(fields.text) };
}

/**
 * GETANYAPI_TWITTER_SEARCH: output.data.items[]. Posts whose own text doesn't
 * name the game are dropped (see GAME.mention).
 */
export function parseXSearch(data: unknown): SocialPost[] {
  const items = findArray(unwrapJson(data), "items") ?? [];
  return items.flatMap((raw) => {
    const t = rec(raw);
    const id = str(t?.id);
    const text = cleanText(str(t?.text));
    if (!t || !id || !text || !GAME.mention.test(text)) return [];
    const username = str(t.authorUsername);
    return [
      post("x", {
        rawId: id,
        author: str(t.authorName) ?? username ?? "X user",
        handle: username ? `@${username}` : null,
        // "_normal" avatars are 48px; "_bigger" is 73px and sharper at our size.
        avatar: str(t.authorImage)?.replace("_normal.", "_bigger.") ?? null,
        context: null,
        text,
        url: str(t.url) ?? (username ? `https://x.com/${username}/status/${id}` : `https://x.com/i/web/status/${id}`),
        createdAt: toIso(t.createdUtc ?? t.createdAt),
        likes: num(t.likeCount),
        comments: num(t.replyCount),
        views: num(t.viewCount),
      }),
    ];
  });
}

/** SCRAPECREATORS_SEARCH_REDDIT: items[]. */
export function parseRedditSearch(data: unknown): SocialPost[] {
  const items = findArray(unwrapJson(data), "items") ?? [];
  return items.flatMap((raw) => {
    const p = rec(raw);
    const id = str(p?.id);
    if (!p || !id) return [];
    const title = cleanText(str(p.title));
    const body = cleanText(str(p.selftext) ?? str(p.body));
    const text = [title, body].filter(Boolean).join(" · ");
    if (!text) return [];
    const author = str(p.author);
    const subreddit = str(p.subreddit);
    const permalink = str(p.permalink);
    return [
      post("reddit", {
        rawId: id,
        author: author ? `u/${author}` : "Reddit user",
        handle: null,
        avatar: null,
        context: subreddit ? `r/${subreddit}` : null,
        text,
        url: str(p.url)?.startsWith("https://www.reddit.com/")
          ? (str(p.url) as string)
          : permalink
            ? `https://www.reddit.com${permalink}`
            : (str(p.url) ?? "https://www.reddit.com"),
        createdAt: toIso(p.created_utc ?? p.created),
        likes: num(p.score) ?? num(p.ups),
        comments: num(p.num_comments),
        views: null,
      }),
    ];
  });
}

/** SCRAPECREATORS_SEARCH_LINKEDIN_POSTS: items[] with an author object. */
export function parseLinkedInSearch(data: unknown): SocialPost[] {
  const items = findArray(unwrapJson(data), "items") ?? [];
  return items.flatMap((raw) => {
    const p = rec(raw);
    const url = str(p?.url);
    const text = cleanText(str(p?.description) ?? str(p?.text) ?? str(p?.headline));
    if (!p || !url || !text) return [];
    const author = rec(p.author);
    return [
      post("linkedin", {
        rawId: url.replace(/^https?:\/\/[^/]+/, ""),
        author: str(author?.name) ?? "LinkedIn member",
        handle: null,
        avatar: str(author?.image),
        context: null,
        text,
        url,
        createdAt: toIso(p.date_published ?? p.datePublished),
        likes: num(p.like_count),
        comments: num(p.comment_count),
        views: null,
      }),
    ];
  });
}

/** GETANYAPI_INSTAGRAM_HASHTAG_RECENT_POSTS: output.data.posts[]. */
export function parseInstagramHashtag(data: unknown): SocialPost[] {
  const items = findArray(unwrapJson(data), "posts") ?? [];
  return items.flatMap((raw) => {
    const p = rec(raw);
    const id = str(p?.id) ?? str(p?.shortcode);
    const text = cleanText(str(p?.caption));
    if (!p || !id || !text) return [];
    const username = str(p.username);
    const hidden = p.countsHidden === true;
    return [
      post("instagram", {
        rawId: id,
        author: str(p.displayName) ?? username ?? "Instagram user",
        handle: username ? `@${username}` : null,
        avatar: str(p.avatarUrl),
        context: null,
        text,
        url: str(p.url) ?? (str(p.shortcode) ? `https://www.instagram.com/p/${p.shortcode}/` : "https://www.instagram.com"),
        createdAt: toIso(p.createdUtc ?? p.takenAt),
        likes: hidden ? null : (num(p.likes) ?? num(p.likeCount)),
        comments: num(p.comments) ?? num(p.commentCount),
        views: num(p.views) ?? num(p.playCount),
      }),
    ];
  });
}
