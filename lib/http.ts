import { withSession } from "./session.ts";

/** A redirect whose headers stay mutable, so cookies set during the request are attached. */
export const redirect = (url: URL | string, status = 302) =>
  new Response(null, { status, headers: { Location: String(url), "Cache-Control": "no-store" } });

export const json = (body: unknown, status = 200) =>
  Response.json(body, { status, headers: { "Cache-Control": "no-store" } });

/** Run a route handler with the visitor's session; turn setup errors into a readable JSON error. */
export async function handle(fn: () => Promise<Response>): Promise<Response> {
  try {
    return await withSession(fn);
  } catch (error) {
    console.error(error);
    return json({ error: error instanceof Error ? error.message : "Server error" }, 500);
  }
}
