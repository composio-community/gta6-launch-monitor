import { authStatus, signOut } from "@/lib/composio-mcp";
import { handle, redirect } from "@/lib/http";
import { dropVisitorCache } from "@/lib/sources";

export async function POST(request: Request) {
  const origin = new URL(request.url).origin;
  return handle(async () => {
    dropVisitorCache(authStatus().sid);
    signOut();
    // 303 so the browser follows with a GET.
    return redirect(new URL("/", origin), 303);
  });
}
