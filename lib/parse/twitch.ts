import type { LiveStream } from "../types.ts";
import { handleFromUrl, LANGUAGE_NAMES, parseCount, unescapeMd } from "./util.ts";

const HOST = /(^|\.)twitch\.tv$/i;

/**
 * Parse Firecrawl's markdown of a Twitch category directory (scraped with
 * includeTags ["article"]). Each card starts with a bold title link:
 *
 *   [**TITLE** \\ \\ DisplayName \\ \\ Verified](https://www.twitch.tv/handle)
 *   Tag lines, one per paragraph (the language is one of them)
 *   [![handle](avatar)](https://www.twitch.tv/handle/videos)
 *   [![TITLE - handle](preview)\\ \\ LIVE \\ \\ 576K viewers](https://www.twitch.tv/handle)
 */
export function parseTwitchMarkdown(markdown: string): LiveStream[] {
  const out = new Map<string, LiveStream>();
  const chunks = markdown.split(/\n(?=\[\*\*)/);

  for (const chunk of chunks) {
    const head = chunk.match(/^\[\*\*([\s\S]+?)\*\*([\s\S]*?)\]\((https:\/\/[^)\s]+)\)/);
    if (!head) continue;
    const handle = handleFromUrl(head[3], HOST);
    if (!handle) continue;
    const key = handle.toLowerCase();
    if (out.has(key)) continue;

    const title = unescapeMd(head[1]);
    // Label lines after the title: display name, then badges such as "Verified".
    const labelLines = head[2]
      .split(/\\\\?\n/)
      .map((line) => unescapeMd(line))
      .filter(Boolean);
    const channel = labelLines.find((line) => !/^(verified|partner)$/i.test(line)) ?? handle;

    const rest = chunk.slice(head[0].length);
    const tagBlock = rest.split(/\n\[!\[/)[0] ?? "";
    const tags: string[] = [];
    let language: string | null = null;
    for (const para of tagBlock.split(/\n\s*\n/)) {
      const tag = unescapeMd(para);
      if (!tag || tag.length > 40 || tag.startsWith("[")) continue;
      if (LANGUAGE_NAMES.has(tag.toLowerCase())) language ??= tag;
      else if (!tags.includes(tag)) tags.push(tag);
    }

    const avatar = rest.match(/\((https:\/\/[^)\s]*(?:jtv_user_pictures|profile_image)[^)\s]*)\)/)?.[1] ?? null;
    const thumb = rest.match(/\((https:\/\/[^)\s]*previews-ttv[^)\s]*)\)/)?.[1] ?? null;
    const viewersText = rest.match(/(\d[\d.,]*\s*[KkMm]?)\s+viewers?/)?.[1];

    out.set(key, {
      id: `twitch:${key}`,
      platform: "twitch",
      channel,
      handle,
      title: title || `${channel} is live`,
      viewers: parseCount(viewersText),
      url: `https://www.twitch.tv/${handle}`,
      thumbnail: thumb ?? `https://static-cdn.jtvnw.net/previews-ttv/live_user_${key}-640x360.jpg`,
      avatar,
      language,
      tags: tags.slice(0, 4),
    });
  }

  return [...out.values()];
}
