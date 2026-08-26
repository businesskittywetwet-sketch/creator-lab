import { redirect } from "next/navigation";
import type { NextRequest } from "next/server";
import { createAuthUrl } from "@/lib/services/youtube/oauth";

export const dynamic = "force-dynamic";

/* Begin the YouTube OAuth flow for a specific Viboro channel.
   Generates a single-use CSRF state and redirects to Google. */

export async function GET(req: NextRequest) {
  const channelId = req.nextUrl.searchParams.get("channelId");
  const redirectTo = req.nextUrl.searchParams.get("redirectTo") ?? "/publishing";
  if (!channelId) {
    return Response.json({ ok: false, error: "channelId is required" }, { status: 400 });
  }
  const result = await createAuthUrl(channelId, redirectTo);
  if ("error" in result) {
    const url = new URL(redirectTo, req.nextUrl.origin);
    url.searchParams.set("oauth", "error");
    url.searchParams.set("reason", result.error);
    redirect(url.toString());
  }
  redirect(result.url);
}
