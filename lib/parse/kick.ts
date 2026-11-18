import type { LiveStream } from "../types.ts";
import { handleFromUrl, LANGUAGE_NAMES, parseCount, unescapeMd } from "./util.ts";

const HOST = /(^|\.)kick\.com$/i;

/**
 * Parse Firecrawl's markdown of a Kick category page (scraped with includeTags
 * on the livestream cards). Every card ends with its category line, which is
 * what the cards are split on:
 *
 *   [![](https://web.kick.com/api/v1/channels/ID/thumbnail.jpeg)\\ \\ 197.3K](https://kick.com/handle)
 *   [![Name](profile_image...)](https://kick.com/handle)
 *   [Name](https://kick.com/handle "Name")
 *   [**Title**](https://kick.com/handle "Full title")
 *   [Grand Theft Auto VI (GTA)](https://kick.com/category/...) Turkish18+
 *
 * The text may be cut off mid-card (it is read in a bounded slice); a card
 * without its category line is dropped.
 */
export function parseKickMarkdown(markdown: string): LiveStream[] {
  const out = new Map<string, LiveStream>();
  const categoryLine = /\[[^\]]*\]\(https:\/\/kick\.com\/category\/[^)\s]+\)([^\n]*)/g;

  let start = 0;
  for (const match of markdown.matchAll(categoryLine)) {
    const card = markdown.slice(start, match.index);
    start = (match.index ?? 0) + match[0].length;

    const links = [...card.matchAll(/\]\((https:\/\/kick\.com\/[^)\s"]+)/g)].map((m) => m[1]);
    const handle = links.map((l) => handleFromUrl(l, HOST)).find((h): h is string => h !== null);
    if (!handle) continue;
    const key = handle.toLowerCase();
    if (out.has(key)) continue;

    // The viewer count closes the thumbnail link label: "...\\ 197.3K](https://kick.com/handle)".
    const viewersText = card.match(/(\d[\d.,]*\s*[KkMm]?)\]\(https:\/\/kick\.com\//)?.[1];

    const avatarMatch = card.match(/!\[([^\]]*)\]\((https:\/\/[^)\s]*(?:profile_image|\/images\/user\/)[^)\s]*)\)/);
    const nameMatch = card.match(/\n\[([^\]*!][^\]]*)\]\(https:\/\/kick\.com\/[^)\s]+ "([^"]*)"\)/);
    const channel = unescapeMd(avatarMatch?.[1]) || unescapeMd(nameMatch?.[1]) || handle;

    // Prefer the quoted link title: the bold label can be truncated, the title attribute is not.
    const titleMatch = card.match(/\[\*\*([\s\S]*?)\*\*\]\(https:\/\/kick\.com\/[^)\s]+(?: "([^"]*)")?\)/);
    const title = unescapeMd(titleMatch?.[2] || titleMatch?.[1]);

    const thumb = card.match(/\((https:\/\/[^)\s]*\/thumbnail\.[a-z]+)\)/)?.[1] ?? null;

    const langRaw = unescapeMd(match[1]).replace(/18\+/g, "").trim();
    const language = langRaw && LANGUAGE_NAMES.has(langRaw.toLowerCase()) ? langRaw : null;
    const tags = /18\+/.test(match[1]) ? ["18+"] : [];

    out.set(key, {
      id: `kick:${key}`,
      platform: "kick",
      channel,
      handle,
      title: title || `${channel} is live`,
      viewers: parseCount(viewersText),
      url: `https://kick.com/${handle}`,
      thumbnail: thumb,
      avatar: avatarMatch?.[2] ?? null,
      language,
      tags,
    });
  }

  return [...out.values()];
}
