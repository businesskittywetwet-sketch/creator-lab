import { db } from "@/db";
import { jobEvents, workQueue, workers } from "@/db/schema";
import { and, asc, desc, eq, inArray, isNotNull, lt, or, sql } from "drizzle-orm";
import { redact } from "@/lib/crypto";

/* ------------------------------------------------------------------ */
/*  DURABLE WORK QUEUE                                                 */
/*                                                                     */
/*  Single source of truth for asynchronous work. Jobs live in the     */
/*  database, so they survive request termination, server restarts     */
/*  and worker crashes. Claiming uses SELECT ... FOR UPDATE SKIP       */
/*  LOCKED so two workers can never take the same row.                 */
/* ------------------------------------------------------------------ */

export type JobType =
  | "scout_cycle"
  | "production_step"
  | "render"
  | "publish"
  | "analytics_refresh";

export type JobStatus =
  | "queued"
  | "running"
  | "paused"
  | "retrying"
  | "completed"
  | "failed"
  | "cancelled";

/** Priority bands — higher runs first. */
export const PRIORITY = {
  manual: 100,
  publish: 75,
  production: 50,
  render: 45,
  scout: 25,
  analytics: 10,
} as const;

export const LEASE_MS = 60_000;
const BASE_BACKOFF_MS = 5_000;
const MAX_BACKOFF_MS = 15 * 60_000;

/* ---------------------------- error model -------------------------- */

export class PermanentJobError extends Error {
  readonly permanent = true;
}
export class TransientJobError extends Error {
  readonly permanent = false;
}

const PERMANENT_PATTERNS = [
  /invalid[_ ]?client/i,
  /invalid[_ ]?grant/i,
  /unauthorized|401/,
  /forbidden|403/,
  /not found|404/,
  /credentials? (are )?(not )?(configured|missing|required)/i,
  /reconnect required/i,
  /qc reported .* critical/i,
  /not approved/i,
  /rejected/i,
  /already published/i,
  /quota ?exceeded.*daily/i,
  /no adapter registered/i,
  /not implemented/i,
];

const TRANSIENT_PATTERNS = [
  /timeout|timed out/i,
  /etimedout|econnreset|econnrefused|enotfound|eai_again/i,
  /network|fetch failed|socket hang up/i,
  /rate ?limit|too many requests|429/,
  /temporar/i,
  /5\d\d\b/,
  /worker (crash|stall)/i,
  /lease expired/i,
];

/**
 * Classify a failure. Defaults to transient only when the message
 * clearly looks transient — anything unrecognised is treated as
 * permanent so we never loop forever on a real bug.
 */
export function classifyError(err: unknown): { kind: "transient" | "permanent"; message: string } {
  if (err instanceof PermanentJobError) return { kind: "permanent", message: redact(err.message) };
  if (err instanceof TransientJobError) return { kind: "transient", message: redact(err.message) };
  const msg = redact(err instanceof Error ? err.message : String(err));
  if (PERMANENT_PATTERNS.some((re) => re.test(msg))) return { kind: "permanent", message: msg };
  if (TRANSIENT_PATTERNS.some((re) => re.test(msg))) return { kind: "transient", message: msg };
  return { kind: "permanent", message: msg };
}

/** Exponential backoff with jitter, capped. */
export function backoffMs(attempt: number): number {
  const raw = BASE_BACKOFF_MS * 2 ** Math.max(0, attempt - 1);
  const capped = Math.min(MAX_BACKOFF_MS, raw);
  return capped + Math.floor(Math.random() * 1000);
}

/* ----------------------------- events ------------------------------ */

export async function logEvent(input: {
  jobId: string;
  event: string;
  workerId?: string | null;
  attempt?: number;
  step?: string;
  provider?: string;
  durationMs?: number | null;
  result?: string;
  error?: string | null;
  retryReason?: string | null;
  detail?: Record<string, unknown>;
}) {
  try {
    await db.insert(jobEvents).values({
      jobId: input.jobId,
      workerId: input.workerId ?? null,
      attempt: input.attempt ?? 1,
      step: input.step ?? "",
      event: input.event,
      provider: input.provider ?? "",
      durationMs: input.durationMs ?? null,
      result: input.result ?? "",
      error: input.error ? redact(input.error).slice(0, 800) : null,
      retryReason: input.retryReason ?? null,
      detail: input.detail ?? {},
    });
  } catch (err) {
    console.warn("[queue] event log failed:", err instanceof Error ? err.message : err);
  }
}

/* --------------------------- enqueueing ---------------------------- */

export type EnqueueInput = {
  type: JobType;
  priority?: number;
  nicheId?: string | null;
  channelId?: string | null;
  contentId?: string | null;
  productionJobId?: string | null;
  publishJobId?: string | null;
  payload?: Record<string, unknown>;
  dedupeKey?: string | null;
  maxAttempts?: number;
  runAfter?: Date;
  currentStep?: string;
};

const LIVE: JobStatus[] = ["queued", "running", "paused", "retrying"];

/**
 * Enqueue a job. If `dedupeKey` matches an existing LIVE job the
 * existing job is returned instead of creating a duplicate.
 */
export async function enqueue(input: EnqueueInput): Promise<{ id: string; created: boolean }> {
  if (input.dedupeKey) {
    const [existing] = await db
      .select()
      .from(workQueue)
      .where(and(eq(workQueue.dedupeKey, input.dedupeKey), inArray(workQueue.status, LIVE)))
      .limit(1);
    if (existing) return { id: existing.id, created: false };
    // A terminal job may still hold the unique key — free it.
    await db
      .update(workQueue)
      .set({ dedupeKey: null })
      .where(eq(workQueue.dedupeKey, input.dedupeKey));
  }

  try {
    const [row] = await db
      .insert(workQueue)
      .values({
        type: input.type,
        status: "queued",
        priority: input.priority ?? PRIORITY.production,
        nicheId: input.nicheId ?? null,
        channelId: input.channelId ?? null,
        contentId: input.contentId ?? null,
        productionJobId: input.productionJobId ?? null,
        publishJobId: input.publishJobId ?? null,
        payload: input.payload ?? {},
        dedupeKey: input.dedupeKey ?? null,
        maxAttempts: input.maxAttempts ?? 3,
        runAfter: input.runAfter ?? new Date(),
        currentStep: input.currentStep ?? "",
        progressLabel: "Queued",
      })
      .returning();
    await logEvent({ jobId: row.id, event: "queued", step: row.currentStep, detail: { type: row.type } });
    return { id: row.id, created: true };
  } catch (err) {
    // Unique dedupe collision from a concurrent enqueue — return the winner.
    if (input.dedupeKey) {
      const [existing] = await db
        .select()
        .from(workQueue)
        .where(eq(workQueue.dedupeKey, input.dedupeKey))
        .limit(1);
      if (existing) return { id: existing.id, created: false };
    }
    throw err;
  }
}

/* ------------------------------ claim ------------------------------ */

/**
 * Atomically claim the highest-priority runnable job.
 *
 * `FOR UPDATE SKIP LOCKED` guarantees two concurrent workers select
 * disjoint rows; the status guard makes the transition idempotent.
 */
export async function claimJob(workerId: string, types?: JobType[]): Promise<WorkRow | null> {
  const typeFilter = types?.length
    ? sql`AND type IN (${sql.join(types.map((t) => sql`${t}`), sql`, `)})`
    : sql``;

  const res = await db.execute(sql`
    WITH claimed AS (
      SELECT id FROM work_queue
      WHERE status IN ('queued','retrying')
        AND run_after <= now()
        AND cancel_requested = false
        ${typeFilter}
      ORDER BY priority DESC, run_after ASC, created_at ASC
      FOR UPDATE SKIP LOCKED
      LIMIT 1
    )
    UPDATE work_queue q
    SET status = 'running',
        worker_id = ${workerId},
        attempts = q.attempts + 1,
        lease_expires_at = now() + interval '${sql.raw(String(Math.round(LEASE_MS / 1000)))} seconds',
        heartbeat_at = now(),
        started_at = COALESCE(q.started_at, now()),
        progress_label = 'Starting',
        updated_at = now()
    FROM claimed
    WHERE q.id = claimed.id
    RETURNING q.*
  `);
  const row = (res.rows as unknown as WorkRow[])[0];
  if (!row) return null;
  await logEvent({
    jobId: row.id,
    event: "claimed",
    workerId,
    attempt: Number(row.attempts),
    step: row.current_step ?? "",
    detail: { type: row.type, priority: row.priority },
  });
  return row;
}

/** Raw row shape returned by the SQL claim (snake_case). */
export type WorkRow = {
  id: string;
  type: JobType;
  status: JobStatus;
  priority: number;
  niche_id: string | null;
  channel_id: string | null;
  content_id: string | null;
  production_job_id: string | null;
  publish_job_id: string | null;
  payload: Record<string, unknown>;
  dedupe_key: string | null;
  current_step: string | null;
  attempts: number;
  max_attempts: number;
  cancel_requested: boolean;
};

/* --------------------------- lease upkeep -------------------------- */

export async function heartbeat(jobId: string, workerId: string, progressLabel?: string) {
  await db
    .update(workQueue)
    .set({
      heartbeatAt: new Date(),
      leaseExpiresAt: new Date(Date.now() + LEASE_MS),
      ...(progressLabel ? { progressLabel } : {}),
      updatedAt: new Date(),
    })
    .where(and(eq(workQueue.id, jobId), eq(workQueue.workerId, workerId)));
}

export async function setProgress(
  jobId: string,
  label: string,
  bp?: number | null,
  step?: string,
) {
  await db
    .update(workQueue)
    .set({
      progressLabel: label,
      // Only store a percentage when it is genuinely measurable.
      progressBp: bp ?? null,
      ...(step ? { currentStep: step } : {}),
      updatedAt: new Date(),
    })
    .where(eq(workQueue.id, jobId));
}

/**
 * Reclaim jobs whose lease expired (crashed / stalled worker).
 * The job returns to the queue with its attempt count intact.
 */
export async function reclaimExpiredLeases(): Promise<number> {
  const stale = await db
    .select()
    .from(workQueue)
    .where(
      and(
        eq(workQueue.status, "running"),
        isNotNull(workQueue.leaseExpiresAt),
        lt(workQueue.leaseExpiresAt, new Date()),
      ),
    );
  for (const job of stale) {
    const exhausted = job.attempts >= job.maxAttempts;
    await db
      .update(workQueue)
      .set({
        status: exhausted ? "failed" : "retrying",
        workerId: null,
        leaseExpiresAt: null,
        lastError: `Lease expired — worker ${job.workerId ?? "unknown"} stalled or crashed.`,
        errorKind: "transient",
        runAfter: new Date(Date.now() + backoffMs(job.attempts)),
        progressLabel: exhausted ? "Failed (worker lost)" : "Requeued after worker loss",
        completedAt: exhausted ? new Date() : null,
        updatedAt: new Date(),
      })
      .where(and(eq(workQueue.id, job.id), eq(workQueue.status, "running")));
    await logEvent({
      jobId: job.id,
      event: exhausted ? "failed" : "reclaimed",
      workerId: job.workerId,
      attempt: job.attempts,
      error: "lease expired",
      retryReason: exhausted ? null : "worker lease expired",
    });
  }
  return stale.length;
}

/** Mark workers that stopped heartbeating as stopped. */
export async function reapDeadWorkers(maxAgeMs = 3 * LEASE_MS): Promise<number> {
  const cutoff = new Date(Date.now() - maxAgeMs);
  const rows = await db
    .update(workers)
    .set({ status: "stopped", activeJobs: 0 })
    .where(and(lt(workers.lastHeartbeatAt, cutoff), eq(workers.status, "busy")))
    .returning();
  return rows.length;
}

/* -------------------------- completion ----------------------------- */

export async function completeJob(
  jobId: string,
  workerId: string,
  detail: Record<string, unknown> = {},
  durationMs?: number,
) {
  await db
    .update(workQueue)
    .set({
      status: "completed",
      progressLabel: "Completed",
      progressBp: 10000,
      completedAt: new Date(),
      leaseExpiresAt: null,
      lastError: null,
      errorKind: null,
      dedupeKey: null, // free the key for future work on the same target
      updatedAt: new Date(),
    })
    .where(eq(workQueue.id, jobId));
  await logEvent({
    jobId,
    event: "succeeded",
    workerId,
    result: "ok",
    durationMs: durationMs ?? null,
    detail,
  });
}

export async function failJob(
  jobId: string,
  workerId: string,
  err: unknown,
  opts: { attempt: number; maxAttempts: number; durationMs?: number },
): Promise<{ retrying: boolean; kind: string; message: string }> {
  const { kind, message } = classifyError(err);
  const canRetry = kind === "transient" && opts.attempt < opts.maxAttempts;
  const delay = canRetry ? backoffMs(opts.attempt) : 0;

  await db
    .update(workQueue)
    .set({
      status: canRetry ? "retrying" : "failed",
      workerId: null,
      leaseExpiresAt: null,
      lastError: message.slice(0, 800),
      errorKind: kind,
      runAfter: canRetry ? new Date(Date.now() + delay) : new Date(),
      progressLabel: canRetry
        ? `Retrying in ${Math.round(delay / 1000)}s (attempt ${opts.attempt + 1}/${opts.maxAttempts})`
        : `Failed: ${kind}`,
      completedAt: canRetry ? null : new Date(),
      ...(canRetry ? {} : { dedupeKey: null }),
      updatedAt: new Date(),
    })
    .where(eq(workQueue.id, jobId));

  await logEvent({
    jobId,
    event: canRetry ? "retry_scheduled" : "failed",
    workerId,
    attempt: opts.attempt,
    error: message,
    durationMs: opts.durationMs ?? null,
    retryReason: canRetry ? `${kind} error, backoff ${delay}ms` : null,
    detail: { kind, attempt: opts.attempt, maxAttempts: opts.maxAttempts },
  });
  return { retrying: canRetry, kind, message };
}

/* ---------------------------- controls ----------------------------- */

export async function pauseJob(jobId: string) {
  const [job] = await db.select().from(workQueue).where(eq(workQueue.id, jobId));
  if (!job) return { ok: false, error: "Job not found" };
  if (job.status === "running") {
    // Do not interrupt a critical operation — defer the pause.
    await db
      .update(workQueue)
      .set({ cancelRequested: false, progressLabel: "Pause requested (finishing current step)", updatedAt: new Date() })
      .where(eq(workQueue.id, jobId));
    await logEvent({ jobId, event: "paused", result: "deferred" });
    return { ok: true, deferred: true };
  }
  if (!["queued", "retrying"].includes(job.status))
    return { ok: false, error: `Cannot pause a ${job.status} job` };
  await db
    .update(workQueue)
    .set({ status: "paused", progressLabel: "Paused", updatedAt: new Date() })
    .where(eq(workQueue.id, jobId));
  await logEvent({ jobId, event: "paused" });
  return { ok: true, deferred: false };
}

export async function resumeJob(jobId: string) {
  const [job] = await db.select().from(workQueue).where(eq(workQueue.id, jobId));
  if (!job) return { ok: false, error: "Job not found" };
  if (job.status !== "paused") return { ok: false, error: `Job is ${job.status}, not paused` };
  await db
    .update(workQueue)
    .set({ status: "queued", runAfter: new Date(), progressLabel: "Queued", updatedAt: new Date() })
    .where(eq(workQueue.id, jobId));
  await logEvent({ jobId, event: "resumed" });
  return { ok: true };
}

export async function cancelJob(jobId: string) {
  const [job] = await db.select().from(workQueue).where(eq(workQueue.id, jobId));
  if (!job) return { ok: false, error: "Job not found" };
  if (["completed", "cancelled"].includes(job.status))
    return { ok: false, error: `Job already ${job.status}` };

  if (job.status === "running") {
    // Cancellation while uploading/rendering is unsafe — flag it and let
    // the worker stop at the next safe checkpoint.
    await db
      .update(workQueue)
      .set({
        cancelRequested: true,
        progressLabel: "Cancellation pending (finishing safely)",
        updatedAt: new Date(),
      })
      .where(eq(workQueue.id, jobId));
    await logEvent({ jobId, event: "cancelled", result: "pending" });
    return { ok: true, pending: true };
  }

  await db
    .update(workQueue)
    .set({
      status: "cancelled",
      progressLabel: "Cancelled",
      completedAt: new Date(),
      dedupeKey: null,
      updatedAt: new Date(),
    })
    .where(eq(workQueue.id, jobId));
  await logEvent({ jobId, event: "cancelled", result: "immediate" });
  return { ok: true, pending: false };
}

export async function retryJob(jobId: string) {
  const [job] = await db.select().from(workQueue).where(eq(workQueue.id, jobId));
  if (!job) return { ok: false, error: "Job not found" };
  if (!["failed", "cancelled"].includes(job.status))
    return { ok: false, error: `Only failed/cancelled jobs can be retried (is ${job.status})` };
  await db
    .update(workQueue)
    .set({
      status: "queued",
      runAfter: new Date(),
      lastError: null,
      errorKind: null,
      cancelRequested: false,
      completedAt: null,
      // Give the operator a fresh allowance rather than resetting history.
      maxAttempts: job.attempts + 3,
      progressLabel: "Queued (manual retry)",
      priority: PRIORITY.manual,
      updatedAt: new Date(),
    })
    .where(eq(workQueue.id, jobId));
  await logEvent({ jobId, event: "queued", result: "manual_retry", attempt: job.attempts });
  return { ok: true };
}

export async function setPriority(jobId: string, priority: number) {
  await db
    .update(workQueue)
    .set({ priority: Math.max(0, Math.min(100, priority)), updatedAt: new Date() })
    .where(eq(workQueue.id, jobId));
  return { ok: true };
}

/* ------------------------------ reads ------------------------------ */

export async function queueStats() {
  const rows = await db
    .select({ status: workQueue.status, n: sql<number>`count(*)::int` })
    .from(workQueue)
    .groupBy(workQueue.status);
  const base: Record<string, number> = {
    queued: 0, running: 0, paused: 0, retrying: 0, completed: 0, failed: 0, cancelled: 0,
  };
  for (const r of rows) base[r.status] = r.n;
  return base;
}

export async function listJobs(limit = 60) {
  const rows = await db
    .select()
    .from(workQueue)
    .orderBy(
      sql`CASE WHEN status IN ('running','retrying','queued','paused') THEN 0 ELSE 1 END`,
      desc(workQueue.priority),
      desc(workQueue.updatedAt),
    )
    .limit(limit);
  // Elapsed is computed here (data layer) so components stay pure.
  const now = Date.now();
  return rows.map((r) => ({
    ...r,
    elapsedMs: r.startedAt ? now - +new Date(r.startedAt) : null,
  }));
}

export async function jobTimeline(jobId: string, limit = 50) {
  return db
    .select()
    .from(jobEvents)
    .where(eq(jobEvents.jobId, jobId))
    .orderBy(asc(jobEvents.createdAt))
    .limit(limit);
}

export async function activeWorkers() {
  const cutoff = new Date(Date.now() - 3 * LEASE_MS);
  return db
    .select()
    .from(workers)
    .where(or(eq(workers.status, "busy"), eq(workers.status, "idle")))
    .orderBy(desc(workers.lastHeartbeatAt))
    .then((rows) =>
      rows.map((w) => ({ ...w, alive: +new Date(w.lastHeartbeatAt) > +cutoff })),
    );
}
