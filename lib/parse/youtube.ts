import type { LiveStream } from "../types.ts";
import { cleanText, findArray, parseCount, unwrapJson } from "./util.ts";

type Rec = Record<string, unknown>;

const str = (v: unknown): string | null => (typeof v === "string" && v.length > 0 ? v : null);
const rec = (v: unknown): Rec | null => (v !== null && typeof v === "object" && !Array.isArray(v) ? (v as Rec) : null);

function videoId(item: Rec): string | null {
  const id = str(item.id) ?? str(item.videoId);
  if (id) return id;
  const url = str(item.url) ?? str(item.link);
  return url?.match(/[?&]v=([\w-]{6,})/)?.[1] ?? null;
}

/**
 * A finished stream. YouTube keeps these in the `lives` array, still typed
 * "live", but they read "Streamed 16 minutes ago", have a length, and count
 * total views instead of people watching.
 */
function hasEnded(item: Rec, viewText: string): boolean {
  return (
    /^streamed\b/i.test(str(item.publishedTimeText) ?? "") ||
    (typeof item.lengthSeconds === "number" && item.lengthSeconds > 0) ||
    /\bviews?\b/i.test(viewText)
  );
}

/**
 * Read a ScrapeCreators YouTube search response. A result is live only when
 * YouTube shows a LIVE badge or an "N watching" count and nothing says it has
 * ended; the `lives` array and the item's type are not enough on their own.
 */
function readYouTube(data: unknown): { live: LiveStream[]; ended: string[] } {
  const body = unwrapJson(data);
  const items = [...(findArray(body, "lives") ?? []), ...(findArray(body, "videos") ?? [])];
  const out = new Map<string, LiveStream>();
  const ended = new Set<string>();

  for (const raw of items) {
    const item = rec(raw);
    if (!item) continue;
    const id = videoId(item);
    if (!id || out.has(id)) continue;

    const viewText = str(item.viewCountText) ?? "";
    const badges = Array.isArray(item.badges) ? item.badges.map((b) => String(b)) : [];
    const watching = /watching/i.test(viewText);
    if (hasEnded(item, viewText)) {
      ended.add(`youtube:${id}`);
      continue;
    }
    if (!watching && !badges.some((b) => /^live/i.test(b))) continue;

    const channel = rec(item.channel);
    const handle = str(channel?.handle);
    // Only "N watching" is a count of people there now.
    const viewers = watching ? (typeof item.viewCountInt === "number" ? item.viewCountInt : parseCount(viewText)) : null;

    out.set(id, {
      id: `youtube:${id}`,
      platform: "youtube",
      channel: cleanText(str(channel?.title) ?? str(channel?.name)) || "YouTube channel",
      handle: handle && !handle.startsWith("channel/") ? handle : null,
      title: cleanText(str(item.title)) || "Live stream",
      viewers,
      url: str(item.url) ?? `https://www.youtube.com/watch?v=${id}`,
      thumbnail: str(item.thumbnail),
      avatar: str(channel?.thumbnail),
      language: null,
      tags: [],
    });
  }
  return { live: [...out.values()], ended: [...ended] };
}

/** Streams that are live right now. */
export const parseScrapeCreatorsYouTube = (data: unknown): LiveStream[] => readYouTube(data).live;

/** Ids of streams the search reports as finished, so they can be dropped from the board at once. */
export const parseEndedYouTube = (data: unknown): string[] => readYouTube(data).ended;
