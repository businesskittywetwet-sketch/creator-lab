import {
  computePerformanceSignals,
  maintainTokens,
  processDuePublishJobs,
  refreshYouTubeAnalytics,
  syncNotifications,
  syncPostMetrics,
} from "@/engine";
import type { NextRequest } from "next/server";

export const dynamic = "force-dynamic";
export const maxDuration = 300;

/* Publishing + analytics tick. Dispatches due scheduled jobs (only for
   channels with auto-publish explicitly enabled), refreshes metrics from
   connected platforms, recomputes performance signals and notifications. */

function authorized(req: NextRequest): boolean {
  const secret = process.env.CRON_SECRET;
  // Fail closed in production: an unset secret must not mean "open to all".
  if (!secret) return process.env.NODE_ENV !== "production";
  const header = req.headers.get("authorization");
  const alt = req.headers.get("x-cron-secret") ?? req.nextUrl.searchParams.get("secret");
  return header === `Bearer ${secret}` || alt === secret;
}

async function handle(req: NextRequest) {
  if (!authorized(req)) {
    return Response.json({ ok: false, error: "unauthorized" }, { status: 401 });
  }
  try {
    // 1. OAuth maintenance — surface revoked grants before we try to use them
    const tokens = await maintainTokens();
    // 2. dispatch due scheduled jobs (auto-publish gated per channel)
    const dispatched = await processDuePublishJobs(5);
    // 3. real platform analytics, then generic adapters
    const youtube = await refreshYouTubeAnalytics();
    const metrics = await syncPostMetrics();
    // 4. recompute the feedback layer
    const signals = await computePerformanceSignals();
    await syncNotifications();
    return Response.json({
      ok: true,
      tokens,
      dispatched,
      youtube,
      metrics,
      signalsComputed: signals.length,
    });
  } catch (err) {
    console.error("[cron/publishing] fatal", err);
    return Response.json(
      { ok: false, error: err instanceof Error ? err.message : "unknown" },
      { status: 500 },
    );
  }
}

export async function GET(req: NextRequest) {
  return handle(req);
}
export async function POST(req: NextRequest) {
  return handle(req);
}
