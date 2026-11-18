import { handle, json } from "@/lib/http";
import { getStreams, isSourceId, loadMore } from "@/lib/sources";
import type { Section } from "@/lib/types";

export const maxDuration = 60;

/**
 * Load the next page of the named feeds, then return the full payload.
 * POST because it spends money: nothing should prefetch or cache it.
 */
export async function POST(request: Request) {
  let body: { sources?: unknown; sections?: unknown };
  try {
    body = (await request.json()) as typeof body;
  } catch {
    return json({ error: "Body must be JSON: { sources: [...] }" }, 400);
  }
  const ids = body.sources;
  if (!Array.isArray(ids) || ids.length === 0 || !ids.every(isSourceId)) {
    return json({ error: "sources must be a non-empty list of feed ids" }, 400);
  }
  const sections: Section[] = Array.isArray(body.sections)
    ? body.sections.filter((s): s is Section => s === "streamers" || s === "reactions")
    : ["streamers"];
  return handle(async () => {
    await loadMore([...new Set(ids)]);
    return json(await getStreams({ force: false, snapshot: false, sections }));
  });
}
