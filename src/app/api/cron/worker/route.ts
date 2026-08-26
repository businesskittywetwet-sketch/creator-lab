import type { NextRequest } from "next/server";
import {
  enqueue,
  enqueueDuePublishing,
  enqueuePendingProduction,
  markNicheScouted,
  nichesDueForScout,
  PRIORITY,
  workerTick,
} from "@/engine";

export const dynamic = "force-dynamic";
export const maxDuration = 300;

/* Worker tick. Drains the durable queue, reclaims leases abandoned by
   crashed workers, and enqueues due scheduled work. Safe to call from
   any external scheduler; every call is bounded so it cannot exceed a
   serverless timeout. Fails closed without CRON_SECRET in production. */

function authorized(req: NextRequest): boolean {
  const secret = process.env.CRON_SECRET;
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
    const concurrency = Math.max(
      1,
      Math.min(8, Number(req.nextUrl.searchParams.get("concurrency") ?? 3)),
    );

    /* 1. enqueue scheduled work (idempotent via dedupeKey) */
    const dueNiches = await nichesDueForScout();
    let scoutQueued = 0;
    for (const n of dueNiches) {
      const res = await enqueue({
        type: "scout_cycle",
        priority: PRIORITY.scout,
        nicheId: n.id,
        channelId: n.channelId,
        dedupeKey: `scout:${n.id}`,
        currentStep: "scout",
      });
      if (res.created) {
        scoutQueued += 1;
        await markNicheScouted(n.id);
      }
    }
    const productionQueued = await enqueuePendingProduction();
    const publishQueued = await enqueueDuePublishing();

    /* 2. drain the queue with bounded concurrency */
    const tick = await workerTick({ concurrency });

    return Response.json({
      ok: true,
      enqueued: { scout: scoutQueued, production: productionQueued, publish: publishQueued },
      worker: tick.workerId,
      reclaimed: tick.reclaimed,
      processed: tick.processed,
    });
  } catch (err) {
    console.error("[cron/worker] fatal", err);
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
