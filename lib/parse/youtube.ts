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
 * Parse a ScrapeCreators YouTube search response into live streams.
 * Live results arrive in a `lives` array; YouTube also mixes live videos into
 * `videos`, marked with a LIVE badge or an "N watching" view count.
 */
export function parseScrapeCreatorsYouTube(data: unknown): LiveStream[] {
  const body = unwrapJson(data);
  const lives = findArray(body, "lives") ?? [];
  const videos = findArray(body, "videos") ?? [];
  const out = new Map<string, LiveStream>();

  const add = (raw: unknown, knownLive: boolean) => {
    const item = rec(raw);
    if (!item) return;
    const id = videoId(item);
    if (!id || out.has(id)) return;

    const viewText = str(item.viewCountText) ?? "";
    const badges = Array.isArray(item.badges) ? item.badges.map((b) => String(b)) : [];
    const isLive = knownLive || /watching/i.test(viewText) || badges.some((b) => /^live/i.test(b));
    if (!isLive) return;

    const channel = rec(item.channel);
    const handle = str(channel?.handle);
    const viewers = typeof item.viewCountInt === "number" ? item.viewCountInt : parseCount(viewText);

    out.set(id, {
      id: `youtube:${id}`,
      platform: "youtube",
      channel: cleanText(str(channel?.title) ?? str(channel?.name)) || "YouTube channel",
      handle: handle && !handle.startsWith("channel/") ? handle : null,
      title: cleanText(str(item.title)) || "Live stream",
      viewers,
      url: str(item.url) ?? `https://www.youtube.com/watch?v=${id}`,
      thumbnail: str(item.thumbnail) ?? `https://i.ytimg.com/vi/${id}/hqdefault.jpg`,
      avatar: str(channel?.thumbnail),
      language: null,
      tags: [],
    });
  };

  for (const item of lives) add(item, true);
  for (const item of videos) add(item, false);
  return [...out.values()];
}
