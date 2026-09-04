import { processDueAutomationJobs, runScoutCycle, runScheduledScoutIfDue } from "@/engine";
import type { NextRequest } from "next/server";

export const dynamic = "force-dynamic";
export const maxDuration = 120;

/* Scheduler entry point for the Story Scout. Point any external cron  */
/* (Vercel Cron, cron-job.org, GitHub Actions…) at this endpoint. The  */
/* engine itself decides whether a run is due based on the interval    */
/* configured in the Automation page. `?force=1` overrides the gate.   */

function authorized(req: NextRequest): boolean {
  const secret = process.env.CRON_SECRET;
  // Fail closed in production: an unset secret must not mean "open to all".
  if (!secret) return process.env.NODE_ENV !== "production"; // dev mode — no secret configured
  const header = req.headers.get("authorization");
  const alt = req.headers.get("x-cron-secret") ?? req.nextUrl.searchParams.get("secret");
  return header === `Bearer ${secret}` || alt === secret;
}

async function handle(req: NextRequest) {
  if (!authorized(req)) {
    return Response.json({ ok: false, error: "unauthorized" }, { status: 401 });
  }
  try {
    // 1. consume due queued jobs (auto-retries become real runs here)
    await processDueAutomationJobs();
    // 2. interval-gated scheduled cycle
    const forced = req.nextUrl.searchParams.get("force") === "1";
    const stats = forced ? await runScoutCycle("schedule") : await runScheduledScoutIfDue();
    return Response.json(
      {
        ok: stats ? stats.ok : true,
        skipped: stats === null && !forced,
        cycle: stats,
      },
      { status: stats && !stats.ok ? 500 : 200 },
    );
  } catch (err) {
    console.error("[cron/scout] fatal", err);
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
