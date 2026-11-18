import { handle, json } from "@/lib/http";
import { getStreams } from "@/lib/sources";
import type { Section } from "@/lib/types";

/** The first load of a section runs several tool calls and a round of scoring. */
export const maxDuration = 60;

const SECTIONS: Section[] = ["streamers", "reactions"];

export async function GET(request: Request) {
  const params = new URL(request.url).searchParams;
  const sections = (params.get("sections") ?? "streamers").split(",").filter((s): s is Section => (SECTIONS as string[]).includes(s));
  return handle(async () =>
    json(await getStreams({ force: params.get("force") === "1", sections })),
  );
}
