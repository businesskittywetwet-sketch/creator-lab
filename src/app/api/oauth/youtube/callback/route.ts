import { redirect } from "next/navigation";
import type { NextRequest } from "next/server";
import {
  consumeState,
  exchangeCode,
  fetchIdentity,
  persistConnection,
  purgeExpiredStates,
} from "@/lib/services/youtube/oauth";
import { notify } from "@/engine/notifications";
import { syncAccountsForChannel } from "@/engine/publishing";
import { redact, redactUnknown } from "@/lib/crypto";

export const dynamic = "force-dynamic";

/* OAuth callback. Validates the CSRF state, exchanges the code for
   tokens, resolves the YouTube channel identity, and stores the tokens
   encrypted. No token or secret is ever written to a log or the URL. */

function back(req: NextRequest, to: string, params: Record<string, string>): never {
  const url = new URL(to, req.nextUrl.origin);
  for (const [k, v] of Object.entries(params)) url.searchParams.set(k, v);
  redirect(url.toString());
}

export async function GET(req: NextRequest) {
  const sp = req.nextUrl.searchParams;
  const error = sp.get("error");
  const code = sp.get("code");
  const state = sp.get("state") ?? "";

  // Validate state FIRST — before touching any user-supplied code.
  const check = await consumeState(state);
  const redirectTo = check.ok ? check.redirectTo : "/publishing";

  if (!check.ok) {
    console.warn(`[oauth/youtube] state rejected: ${check.reason}`);
    back(req, "/publishing", { oauth: "error", reason: check.reason });
  }
  if (error) {
    back(req, redirectTo, {
      oauth: "error",
      reason: `Authorization was denied (${redact(error)}).`,
    });
  }
  if (!code) {
    back(req, redirectTo, { oauth: "error", reason: "No authorization code returned." });
  }
  if (!check.channelId) {
    back(req, redirectTo, { oauth: "error", reason: "OAuth state has no channel context." });
  }

  try {
    const tokens = await exchangeCode(code);
    if (!tokens.refreshToken) {
      back(req, redirectTo, {
        oauth: "error",
        reason:
          "Google did not return a refresh token. Revoke Viboro's access in your Google account and reconnect.",
      });
    }
    const identity = await fetchIdentity(tokens.accessToken);
    await persistConnection(check.channelId, tokens, identity);
    await syncAccountsForChannel(check.channelId);
    await purgeExpiredStates();

    await notify({
      severity: "success",
      category: "publishing",
      title: "YouTube connected",
      body: `Authorized as ${identity.channelTitle}${identity.channelHandle ? ` (${identity.channelHandle})` : ""}.`,
      href: "/publishing",
      dedupeKey: `yt-connected:${check.channelId}:${identity.externalId}`,
    });

    back(req, redirectTo, { oauth: "connected", account: identity.channelTitle });
  } catch (err) {
    const reason = redactUnknown(err);
    console.error(`[oauth/youtube] callback failed: ${reason}`);
    await notify({
      severity: "error",
      category: "publishing",
      title: "YouTube connection failed",
      body: reason.slice(0, 160),
      href: "/publishing",
      dedupeKey: `yt-connect-fail:${Date.now()}`,
    });
    back(req, redirectTo, { oauth: "error", reason });
  }
}
