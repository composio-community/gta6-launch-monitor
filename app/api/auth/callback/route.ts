import { finishSignIn } from "@/lib/composio-mcp";
import { handle, redirect } from "@/lib/http";

export const maxDuration = 30;

export async function GET(request: Request) {
  const url = new URL(request.url);
  return handle(async () => {
    try {
      await finishSignIn(url.origin, url.searchParams);
    } catch (error) {
      // finishSignIn stores the message in the session; the page shows it.
      console.error("Composio sign-in failed:", error);
    }
    return redirect(new URL("/", url.origin));
  });
}
