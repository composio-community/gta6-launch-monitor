import type { Reaction, ReactionPlatform, SocialPost } from "../types.ts";
import { parseInstagramHashtag, parseLinkedInSearch, parseRedditSearch, parseXSearch } from "./social.ts";
import { cleanText, findArray, unwrapJson } from "./util.ts";

type Rec = Record<string, unknown>;
const rec = (v: unknown): Rec | null => (v !== null && typeof v === "object" && !Array.isArray(v) ? (v as Rec) : null);
const str = (v: unknown): string | null => (typeof v === "string" && v.trim().length > 0 ? v.trim() : null);
const num = (v: unknown): number | null => (typeof v === "number" && Number.isFinite(v) ? v : null);

/** A post from the social parsers, as an unscored reaction. */
function fromPost(post: SocialPost, platform: ReactionPlatform = post.platform): Reaction {
  return {
    id: `react-${post.id}`,
    platform,
    kind: "post",
    author: post.author,
    handle: post.handle,
    avatar: post.avatar,
    context: post.context,
    text: post.text,
    url: post.url,
    createdAt: post.createdAt,
    likes: post.likes,
    comments: post.comments,
    views: post.views,
    sentiment: null,
    mood: null,
    topic: null,
  };
}

/** The response shapes match the social radar's tools, so their parsers are reused. */
export const parseXReactions = (data: unknown) => parseXSearch(data).map((p) => fromPost(p));
export const parseRedditReactions = (data: unknown) => parseRedditSearch(data).map((p) => fromPost(p));
export const parseInstagramReactions = (data: unknown) => parseInstagramHashtag(data).map((p) => fromPost(p));
export const parseLinkedInReactions = (data: unknown) => parseLinkedInSearch(data).map((p) => fromPost(p));

/** "3 hours ago", "2 days ago (edited)" -> an approximate ISO time. */
export function relativeTimeToIso(text: string | null, now = Date.now()): string | null {
  const m = text?.match(/(\d+)\s*(second|minute|hour|day|week|month|year)s?\s+ago/i);
  if (!m) return null;
  const unit = { second: 1, minute: 60, hour: 3600, day: 86400, week: 604800, month: 2629800, year: 31557600 }[
    m[2].toLowerCase() as "second"
  ];
  return new Date(now - Number(m[1]) * unit * 1000).toISOString();
}

export interface VideoRef {
  url: string;
  title: string;
}

const ABOUT_GTA6 = /\bgta ?(6|vi)\b|grand theft auto (6|vi)\b/i;

/** Today's most-watched GTA VI uploads from a ScrapeCreators YouTube search, live streams excluded. */
export function parseTopVideos(data: unknown, max = 10): VideoRef[] {
  const videos = findArray(unwrapJson(data), "videos") ?? [];
  const out: VideoRef[] = [];
  for (const raw of videos) {
    const v = rec(raw);
    const url = str(v?.url);
    const title = cleanText(str(v?.title));
    if (!v || !url || !title || !ABOUT_GTA6.test(title)) continue;
    const badges = Array.isArray(v.badges) ? v.badges.map(String) : [];
    if (/watching/i.test(str(v.viewCountText) ?? "") || badges.some((b) => /^live/i.test(b))) continue;
    if (!out.some((o) => o.url === url)) out.push({ url, title });
    if (out.length >= max) break;
  }
  return out;
}

/** GETANYAPI_YOUTUBE_VIDEO_COMMENTS: output.data.comments[]. */
export function parseYouTubeComments(data: unknown, video: VideoRef, now = Date.now()): Reaction[] {
  const comments = findArray(unwrapJson(data), "comments") ?? [];
  return comments.flatMap((raw) => {
    const c = rec(raw);
    const id = str(c?.id);
    const text = cleanText(str(c?.text));
    if (!c || !id || !text) return [];
    const author = str(c.author);
    return [
      {
        id: `react-youtube:${id}`,
        platform: "youtube" as const,
        kind: "comment" as const,
        author: author ?? "YouTube viewer",
        handle: author?.startsWith("@") ? author : null,
        avatar: str(c.authorAvatarUrl),
        context: `on “${video.title}”`,
        text,
        url: `${video.url}${video.url.includes("?") ? "&" : "?"}lc=${encodeURIComponent(id)}`,
        createdAt: relativeTimeToIso(str(c.publishedTime), now),
        likes: num(c.likes),
        comments: num(c.replies),
        views: null,
        sentiment: null,
        mood: null,
        topic: null,
      },
    ];
  });
}
