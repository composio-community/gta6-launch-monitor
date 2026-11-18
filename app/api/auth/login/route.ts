import { startSignIn } from "@/lib/composio-mcp";
import { handle, redirect } from "@/lib/http";
import { configError, updateSession } from "@/lib/session";

export const maxDuration = 30;

export async function GET(request: Request) {
  const origin = new URL(request.url).origin;
  // Without a session secret nothing can be stored; the page explains what to set.
  if (configError()) return redirect(new URL("/", origin));
  return handle(async () => {
    try {
      const url = await startSignIn(origin);
      return redirect(url ?? new URL("/", origin));
    } catch (error) {
      console.error("Composio sign-in could not start:", error);
      const message = error instanceof Error ? error.message : String(error);
      updateSession((s) => ({ ...s, lastError: `Sign-in could not start: ${message}` }));
      return redirect(new URL("/", origin));
    }
  });
}
