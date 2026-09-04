import { db } from "@/db";
import { productionJobs, publishJobs, workers, workQueue } from "@/db/schema";
import { eq, sql } from "drizzle-orm";
import { hostname } from "node:os";
import {
  claimJob,
  completeJob,
  failJob,
  heartbeat,
  logEvent,
  PermanentJobError,
  PRIORITY,
  reapDeadWorkers,
  reclaimExpiredLeases,
  setProgress,
  TransientJobError,
  enqueue,
  type JobType,
  type WorkRow,
} from "./queue";
import { runProductionJob } from "./production";
import { dispatchPublishJob, preflight } from "./publishing";
import { runScoutCycle } from "./scout";
import { computePerformanceSignals, syncPostMetrics } from "./analytics";
import { refreshYouTubeAnalytics } from "./youtube";
import { notify } from "./notifications";

/* ------------------------------------------------------------------ */
/*  WORKER RUNTIME                                                     */
/*                                                                     */
/*  Workers claim leased jobs from work_queue and execute them by      */
/*  delegating to the EXISTING Phase 3-6 engines. No pipeline logic is */
/*  duplicated here — this layer only owns durability, leasing,        */
/*  retry, concurrency and observability.                              */
/* ------------------------------------------------------------------ */

export type HandlerCtx = {
  job: WorkRow;
  workerId: string;
  /** persist an honest progress label (percent only when measurable) */
  progress: (label: string, bp?: number | null, step?: string) => Promise<void>;
  /** true once an operator requested cancellation mid-flight */
  cancelRequested: () => Promise<boolean>;
};

export type Handler = (ctx: HandlerCtx) => Promise<Record<string, unknown>>;

/* ---------------------------- handlers ----------------------------- */

const handlers: Record<JobType, Handler> = {
  /* --- discovery: reuses runScoutCycle unchanged --- */
  async scout_cycle({ job, progress }) {
    await progress("Contacting sources…", null, "scout");
    const nicheId = job.niche_id ?? undefined;
    const stats = await runScoutCycle("schedule", nicheId ? { nicheId } : {});
    if (!stats.ok && stats.errors.length) {
      // A cycle that fully failed is usually transient (network).
      throw new TransientJobError(stats.errors[0]);
    }
    return {
      inserted: stats.inserted,
      judged: stats.judged,
      selected: stats.selected,
      sourcesFailed: stats.sourcesFailed,
    };
  },

  /* --- production: drives the existing 11-step engine --- */
  async production_step({ job, progress, cancelRequested }) {
    const productionJobId = job.production_job_id;
    if (!productionJobId) throw new PermanentJobError("Job has no production_job_id");

    await progress("Running production pipeline…", null, "production");
    const result = await runProductionJob(productionJobId, { trigger: "worker" });

    if (await cancelRequested()) {
      return { status: result.status, cancelledAfterStep: true, stepsRun: result.stepsRun };
    }
    if (result.status === "failed") {
      const msg = result.errors[0] ?? "production step failed";
      throw new Error(msg); // classified by the queue
    }

    // Still work left (e.g. more steps pending) → chain another job.
    if (result.status === "running" || result.status === "queued") {
      await enqueue({
        type: "production_step",
        priority: PRIORITY.production,
        nicheId: job.niche_id,
        channelId: job.channel_id,
        contentId: job.content_id,
        productionJobId,
        dedupeKey: `production:${productionJobId}`,
        currentStep: "production",
      });
    }
    return { status: result.status, stepsRun: result.stepsRun, provider: result.provider };
  },

  /* --- render: assembly runs inside the production engine --- */
  async render({ job, progress }) {
    const productionJobId = job.production_job_id;
    if (!productionJobId) throw new PermanentJobError("Render job has no production_job_id");
    // FFmpeg gives no reliable percentage for this pipeline, so we expose
    // an honest state rather than inventing a number.
    await progress("Rendering video…", null, "assembly");
    const result = await runProductionJob(productionJobId, { trigger: "worker-render" });
    if (result.status === "failed") throw new Error(result.errors[0] ?? "render failed");
    return { status: result.status, stepsRun: result.stepsRun };
  },

  /* --- publish: reuses dispatchPublishJob (idempotent by design) --- */
  async publish({ job, progress }) {
    const publishJobId = job.publish_job_id;
    if (!publishJobId) throw new PermanentJobError("Publish job has no publish_job_id");

    const [pj] = await db.select().from(publishJobs).where(eq(publishJobs.id, publishJobId));
    if (!pj) throw new PermanentJobError("Publish job no longer exists");
    // Idempotency: a crashed worker must not re-upload.
    if (pj.status === "published" || pj.platformPostId) {
      return { alreadyPublished: true, platformPostId: pj.platformPostId };
    }

    await progress("Checking preflight…", null, "preflight");
    const pf = await preflight(publishJobId);
    if (!pf.ok) throw new PermanentJobError(pf.reasons[0] ?? "preflight blocked");

    await progress("Uploading to platform…", null, "upload");
    const res = await dispatchPublishJob(publishJobId, { trigger: "worker" });
    if (!res.ok) {
      if (res.status === "blocked") throw new PermanentJobError(res.reason ?? "blocked");
      throw new Error(res.reason ?? "publish failed");
    }
    await progress("Verifying publication…", null, "verify");
    return { platformUrl: res.platformUrl, status: res.status };
  },

  /* --- analytics: real platform data only --- */
  async analytics_refresh({ progress }) {
    await progress("Refreshing platform analytics…", null, "analytics");
    const yt = await refreshYouTubeAnalytics();
    const generic = await syncPostMetrics();
    const signals = await computePerformanceSignals();
    return {
      youtubeRefreshed: yt.refreshed,
      genericSynced: generic.synced,
      signals: signals.length,
    };
  },
};

/* --------------------------- registration -------------------------- */

export function makeWorkerId(): string {
  return `w-${process.pid}-${Math.random().toString(36).slice(2, 8)}`;
}

export async function registerWorker(workerId: string, concurrency: number) {
  await db
    .insert(workers)
    .values({
      id: workerId,
      hostname: hostname(),
      status: "idle",
      concurrency,
      lastHeartbeatAt: new Date(),
    })
    .onConflictDoUpdate({
      target: workers.id,
      set: { status: "idle", lastHeartbeatAt: new Date(), concurrency },
    });
}

export async function workerHeartbeat(workerId: string, activeJobs: number) {
  await db
    .update(workers)
    .set({
      lastHeartbeatAt: new Date(),
      activeJobs,
      status: activeJobs > 0 ? "busy" : "idle",
    })
    .where(eq(workers.id, workerId));
}

export async function stopWorker(workerId: string) {
  await db
    .update(workers)
    .set({ status: "stopped", activeJobs: 0, lastHeartbeatAt: new Date() })
    .where(eq(workers.id, workerId));
}

/* ------------------------- single job runner ----------------------- */

export type RunOutcome = {
  jobId: string;
  type: string;
  ok: boolean;
  retrying?: boolean;
  error?: string;
  detail?: Record<string, unknown>;
};

/** Claim and execute one job. Returns null when the queue is empty. */
export async function runOneJob(
  workerId: string,
  types?: JobType[],
): Promise<RunOutcome | null> {
  const job = await claimJob(workerId, types);
  if (!job) return null;

  const started = Date.now();
  let hb: NodeJS.Timeout | undefined;

  const ctx: HandlerCtx = {
    job,
    workerId,
    progress: async (label, bp, step) => {
      await setProgress(job.id, label, bp ?? null, step);
      await heartbeat(job.id, workerId, label);
    },
    cancelRequested: async () => {
      const [row] = await db
        .select({ c: workQueue.cancelRequested })
        .from(workQueue)
        .where(eq(workQueue.id, job.id));
      return Boolean(row?.c);
    },
  };

  try {
    await logEvent({
      jobId: job.id,
      event: "started",
      workerId,
      attempt: job.attempts,
      step: job.current_step ?? "",
    });
    // Keep the lease alive during long operations (render/upload).
    hb = setInterval(() => void heartbeat(job.id, workerId).catch(() => {}), 15_000);

    const handler = handlers[job.type];
    if (!handler) throw new PermanentJobError(`No handler for job type "${job.type}"`);

    const detail = await handler(ctx);
    clearInterval(hb);

    // Honour a cancellation that arrived mid-flight.
    if (await ctx.cancelRequested()) {
      await db
        .update(workQueue)
        .set({
          status: "cancelled",
          progressLabel: "Cancelled after safe checkpoint",
          completedAt: new Date(),
          workerId: null,
          leaseExpiresAt: null,
          dedupeKey: null,
          updatedAt: new Date(),
        })
        .where(eq(workQueue.id, job.id));
      await logEvent({ jobId: job.id, event: "cancelled", workerId, result: "after_checkpoint" });
      await bumpWorker(workerId, false);
      return { jobId: job.id, type: job.type, ok: true, detail: { cancelled: true } };
    }

    await completeJob(job.id, workerId, detail, Date.now() - started);
    await bumpWorker(workerId, false);
    return { jobId: job.id, type: job.type, ok: true, detail };
  } catch (err) {
    if (hb) clearInterval(hb);
    const res = await failJob(job.id, workerId, err, {
      attempt: job.attempts,
      maxAttempts: job.max_attempts,
      durationMs: Date.now() - started,
    });
    await bumpWorker(workerId, true);

    // Notify only on final failure — never on every retry (no spam).
    if (!res.retrying) {
      await notify({
        severity: "error",
        category: "worker",
        title: `Job failed · ${job.type.replace(/_/g, " ")}`,
        body: res.message.slice(0, 160),
        href: "/workers",
        dedupeKey: `jobfail:${job.id}`,
      });
    }
    return { jobId: job.id, type: job.type, ok: false, retrying: res.retrying, error: res.message };
  }
}

async function bumpWorker(workerId: string, failed: boolean) {
  await db
    .update(workers)
    .set({
      jobsProcessed: sql`${workers.jobsProcessed} + 1`,
      jobsFailed: failed ? sql`${workers.jobsFailed} + 1` : sql`${workers.jobsFailed}`,
      lastHeartbeatAt: new Date(),
    })
    .where(eq(workers.id, workerId));
}

/* --------------------------- worker tick --------------------------- */

/**
 * Process up to `concurrency` jobs in parallel. Designed to be invoked
 * repeatedly by cron or a long-lived worker loop; each call is bounded
 * so it can safely run inside a request/serverless timeout.
 */
export async function workerTick(
  opts: { workerId?: string; concurrency?: number; types?: JobType[] } = {},
): Promise<{ workerId: string; reclaimed: number; processed: RunOutcome[] }> {
  const workerId = opts.workerId ?? makeWorkerId();
  const concurrency = Math.max(1, Math.min(8, opts.concurrency ?? 3));

  await registerWorker(workerId, concurrency);
  // Recover anything abandoned by a dead worker before claiming new work.
  const reclaimed = await reclaimExpiredLeases();
  await reapDeadWorkers();

  const processed: RunOutcome[] = [];
  const lanes = Array.from({ length: concurrency }, async () => {
    const out = await runOneJob(workerId, opts.types);
    if (out) processed.push(out);
  });
  await Promise.all(lanes);

  await workerHeartbeat(workerId, 0);
  await stopWorker(workerId);
  return { workerId, reclaimed, processed };
}

/* ----------------------- scheduling helpers ------------------------ */

/** Ensure queue jobs exist for production jobs that still need work. */
export async function enqueuePendingProduction(): Promise<number> {
  const pending = await db
    .select()
    .from(productionJobs)
    .where(sql`${productionJobs.status} IN ('queued','running')`)
    .limit(50);
  let created = 0;
  for (const pj of pending) {
    const res = await enqueue({
      type: "production_step",
      priority: PRIORITY.production,
      channelId: pj.channelId,
      contentId: pj.contentId,
      productionJobId: pj.id,
      dedupeKey: `production:${pj.id}`,
      currentStep: pj.currentStep,
    });
    if (res.created) created += 1;
  }
  return created;
}

/** Ensure queue jobs exist for scheduled publishes that are due. */
export async function enqueueDuePublishing(): Promise<number> {
  const due = await db
    .select()
    .from(publishJobs)
    .where(sql`${publishJobs.status} = 'scheduled' AND ${publishJobs.scheduledAt} <= now()`)
    .limit(25);
  let created = 0;
  for (const pj of due) {
    const res = await enqueue({
      type: "publish",
      priority: PRIORITY.publish,
      channelId: pj.channelId,
      contentId: pj.contentId,
      publishJobId: pj.id,
      dedupeKey: `publish:${pj.id}`,
      currentStep: "publish",
    });
    if (res.created) created += 1;
  }
  return created;
}

export { PRIORITY, enqueue };
