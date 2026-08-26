import { advanceProductionQueue } from "@/engine";
import type { NextRequest } from "next/server";

export const dynamic = "force-dynamic";
export const maxDuration = 300;

/* Production pipeline tick. Creates jobs for newly greenlit content    */
/* and advances pending jobs toward a completed draft. Safe to call     */
/* repeatedly — jobs resume from their first unfinished step.           */

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
    const limit = Number(req.nextUrl.searchParams.get("limit") ?? 3);
    const { created, ran } = await advanceProductionQueue(
      Number.isFinite(limit) ? Math.max(1, Math.min(10, limit)) : 3,
      "schedule",
    );
    const failed = ran.filter((r) => r.status === "failed").length;
    return Response.json({ ok: failed === 0, jobsCreated: created, ran }, { status: 200 });
  } catch (err) {
    console.error("[cron/production] fatal", err);
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
