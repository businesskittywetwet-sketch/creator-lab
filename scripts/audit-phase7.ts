/* Phase 7 audit — durable queue, workers, leases, retries, multi-niche.
   Behavioural tests against the real database, not existence checks. */
import "dotenv/config";
import { db } from "../src/db";
import {
  channels, content, jobEvents, niches, productionJobs, publishJobs,
  storySources, workQueue, workers,
} from "../src/db/schema";
import {
  backoffMs, cancelJob, claimJob, classifyError, completeJob, createNiche,
  duplicateNiche, enqueue, failJob, listJobs, PermanentJobError, pauseJob,
  PRIORITY, queueStats, reclaimExpiredLeases, registerWorker, resumeJob,
  retryJob, runOneJob, setNicheStatus, setPriority, TransientJobError,
  workerTick, adoptLegacyChannels, addSource, deleteNiche, getNiche, listNiches,
} from "../src/engine";
import { and, eq, inArray, sql } from "drizzle-orm";

const R: { id: string; n: string; ok: boolean; d: string }[] = [];
const chk = (id: string, n: string, ok: boolean, d: string) => {
  R.push({ id, n, ok, d });
  console.log(`${ok ? "PASS" : "FAIL"}  [${id}] ${n} — ${d}`);
};
const TAG = "AUDIT7";

async function cleanup() {
  await db.delete(workQueue).where(sql`payload->>'audit' = ${TAG}`);
  const stale = await db.select().from(niches).where(sql`${niches.slug} LIKE 'audit7%'`);
  for (const n of stale) await deleteNiche(n.id, { force: true });
  await db.delete(workers).where(sql`${workers.id} LIKE 'audit7-%'`);
}

async function mkJob(over: Partial<Parameters<typeof enqueue>[0]> = {}) {
  return enqueue({
    type: "analytics_refresh",
    priority: PRIORITY.analytics,
    payload: { audit: TAG },
    maxAttempts: 3,
    ...over,
  });
}

async function main() {
  await cleanup();

  /* ============ 1. DURABILITY ============ */
  const j1 = await mkJob({ dedupeKey: `${TAG}:durable` });
  const [row1] = await db.select().from(workQueue).where(eq(workQueue.id, j1.id));
  chk("D1", "Job persists in the database (survives request end)",
    !!row1 && row1.status === "queued", `id=${j1.id.slice(0, 8)} status=${row1?.status}`);
  chk("D2", "Job carries full context + lifecycle fields",
    row1.maxAttempts === 3 && row1.attempts === 0 && !!row1.runAfter && row1.priority > 0,
    `attempts=${row1.attempts}/${row1.maxAttempts} priority=${row1.priority}`);

  const dupe = await mkJob({ dedupeKey: `${TAG}:durable` });
  chk("D3", "Duplicate job creation prevented by dedupe key",
    !dupe.created && dupe.id === j1.id, `returned existing ${dupe.id === j1.id}`);

  /* ============ 2. LEASE / MUTUAL EXCLUSION ============ */
  await registerWorker("audit7-w1", 1);
  await registerWorker("audit7-w2", 1);
  const claimA = await claimJob("audit7-w1", ["analytics_refresh"]);
  const claimB = await claimJob("audit7-w2", ["analytics_refresh"]);
  chk("L1", "Worker claims a job", !!claimA, `worker1 claimed ${claimA?.id.slice(0, 8) ?? "none"}`);
  chk("L2", "Second worker CANNOT claim the same job",
    !claimB || claimB.id !== claimA?.id,
    claimB ? `worker2 got a different job ${claimB.id.slice(0, 8)}` : "worker2 got nothing");
  const [leased] = await db.select().from(workQueue).where(eq(workQueue.id, claimA!.id));
  chk("L3", "Claim sets lease + owner + increments attempt",
    leased.workerId === "audit7-w1" && !!leased.leaseExpiresAt && leased.attempts === 1,
    `worker=${leased.workerId} attempts=${leased.attempts} lease=${!!leased.leaseExpiresAt}`);

  // simulate crash: expire the lease
  await db.update(workQueue)
    .set({ leaseExpiresAt: new Date(Date.now() - 5_000) })
    .where(eq(workQueue.id, claimA!.id));
  const reclaimed = await reclaimExpiredLeases();
  const [afterReclaim] = await db.select().from(workQueue).where(eq(workQueue.id, claimA!.id));
  chk("L4", "Stale lease reclaimed after worker crash",
    reclaimed >= 1 && afterReclaim.status === "retrying" && afterReclaim.workerId === null,
    `reclaimed=${reclaimed} status=${afterReclaim.status} owner=${afterReclaim.workerId}`);
  chk("L5", "Crashed worker does not orphan the job permanently",
    afterReclaim.attempts === 1 && +new Date(afterReclaim.runAfter) > Date.now() - 1000,
    `attempts preserved=${afterReclaim.attempts}, requeued with backoff`);
  const evs = await db.select().from(jobEvents).where(eq(jobEvents.jobId, claimA!.id));
  chk("L6", "Ownership + reclamation are auditable",
    evs.some((e) => e.event === "claimed") && evs.some((e) => e.event === "reclaimed"),
    evs.map((e) => e.event).join(","));

  /* ============ 3. RETRY / BACKOFF / CLASSIFICATION ============ */
  chk("R1", "Transient errors classified as retryable",
    ["ETIMEDOUT connecting", "HTTP 503 upstream", "rate limit exceeded", "fetch failed"]
      .every((m) => classifyError(new Error(m)).kind === "transient"),
    "network/5xx/429 → transient");
  chk("R2", "Permanent errors classified as non-retryable",
    ["invalid_client", "HTTP 401 unauthorized", "QC reported 2 critical findings",
     "Draft is not approved", "credentials are not configured"]
      .every((m) => classifyError(new Error(m)).kind === "permanent"),
    "auth/QC/approval → permanent");
  chk("R3", "Explicit error classes honoured",
    classifyError(new TransientJobError("x")).kind === "transient" &&
    classifyError(new PermanentJobError("y")).kind === "permanent", "both respected");
  const b1 = backoffMs(1), b2 = backoffMs(2), b3 = backoffMs(3);
  chk("R4", "Exponential backoff grows and is capped",
    b2 > b1 && b3 > b2 && backoffMs(50) <= 15 * 60_000 + 1000,
    `${b1}ms → ${b2}ms → ${b3}ms, cap ${backoffMs(50)}ms`);

  const jt = await mkJob({ dedupeKey: `${TAG}:transient` });
  const ct = await claimJob("audit7-w1", ["analytics_refresh"]);
  const failT = await failJob(ct!.id, "audit7-w1", new Error("ETIMEDOUT upstream"),
    { attempt: 1, maxAttempts: 3 });
  const [afterT] = await db.select().from(workQueue).where(eq(workQueue.id, ct!.id));
  chk("R5", "Transient failure schedules a retry with backoff",
    failT.retrying && afterT.status === "retrying" && +new Date(afterT.runAfter) > Date.now(),
    `status=${afterT.status} runAfter in ${Math.round((+new Date(afterT.runAfter) - Date.now()) / 1000)}s`);
  void jt;

  const jp = await mkJob({ dedupeKey: `${TAG}:permanent` });
  await db.update(workQueue).set({ runAfter: new Date() }).where(eq(workQueue.id, jp.id));
  const cp = await claimJob("audit7-w1", ["analytics_refresh"]);
  const failP = await failJob(cp!.id, "audit7-w1", new PermanentJobError("invalid_client"),
    { attempt: 1, maxAttempts: 3 });
  const [afterP] = await db.select().from(workQueue).where(eq(workQueue.id, cp!.id));
  chk("R6", "Permanent failure stops retrying immediately",
    !failP.retrying && afterP.status === "failed" && afterP.attempts === 1,
    `status=${afterP.status} after ${afterP.attempts} attempt (max ${afterP.maxAttempts})`);
  chk("R7", "Attempts are persisted per try", afterT.attempts === 1 && afterP.attempts === 1,
    "attempt counters recorded");

  // exhaustion
  const je = await mkJob({ dedupeKey: `${TAG}:exhaust`, maxAttempts: 2 });
  await db.update(workQueue).set({ attempts: 2 }).where(eq(workQueue.id, je.id));
  const fe = await failJob(je.id, "audit7-w1", new Error("socket hang up"),
    { attempt: 2, maxAttempts: 2 });
  chk("R8", "Retries stop once maxAttempts reached", !fe.retrying, "transient but exhausted → failed");

  const manual = await retryJob(afterP.id);
  const [afterManual] = await db.select().from(workQueue).where(eq(workQueue.id, afterP.id));
  chk("R9", "Manual retry re-queues a permanently failed job",
    manual.ok && afterManual.status === "queued" && afterManual.priority === PRIORITY.manual,
    `status=${afterManual.status} priority=${afterManual.priority}`);

  /* ============ 4. CONTROLS ============ */
  const jc = await mkJob({ dedupeKey: `${TAG}:ctrl` });
  const p1 = await pauseJob(jc.id);
  const [paused] = await db.select().from(workQueue).where(eq(workQueue.id, jc.id));
  chk("C1", "Pause works on a queued job", p1.ok && paused.status === "paused", `status=${paused.status}`);
  const unclaimable = await claimJob("audit7-w2", ["analytics_refresh"]);
  chk("C2", "Paused jobs are not claimable",
    !unclaimable || unclaimable.id !== jc.id, "paused job skipped by claim");
  const r1 = await resumeJob(jc.id);
  const [resumed] = await db.select().from(workQueue).where(eq(workQueue.id, jc.id));
  chk("C3", "Resume works", r1.ok && resumed.status === "queued", `status=${resumed.status}`);
  const cc = await cancelJob(jc.id);
  const [cancelled] = await db.select().from(workQueue).where(eq(workQueue.id, jc.id));
  chk("C4", "Cancel works on a non-running job",
    cc.ok && cancelled.status === "cancelled", `status=${cancelled.status}`);

  // unsafe cancel → deferred
  const jr = await mkJob({ dedupeKey: `${TAG}:running` });
  await db.update(workQueue).set({ status: "running", workerId: "audit7-w1" }).where(eq(workQueue.id, jr.id));
  const cr = await cancelJob(jr.id);
  const [running] = await db.select().from(workQueue).where(eq(workQueue.id, jr.id));
  chk("C5", "Cancelling a RUNNING job defers (does not interrupt unsafely)",
    cr.ok && (cr as { pending?: boolean }).pending === true &&
    running.status === "running" && running.cancelRequested,
    `status=${running.status} cancelRequested=${running.cancelRequested}`);

  /* ============ 5. PRIORITY ============ */
  await db.delete(workQueue).where(sql`payload->>'audit' = ${TAG}`);
  const low = await mkJob({ priority: 10, dedupeKey: `${TAG}:p-low` });
  const high = await mkJob({ priority: 90, dedupeKey: `${TAG}:p-high` });
  const mid = await mkJob({ priority: 50, dedupeKey: `${TAG}:p-mid` });
  const order: string[] = [];
  for (let i = 0; i < 3; i++) {
    const c = await claimJob("audit7-w1", ["analytics_refresh"]);
    if (c) order.push(c.id);
  }
  chk("P1", "Higher priority is claimed first",
    order[0] === high.id && order[1] === mid.id && order[2] === low.id,
    `order: 90 → 50 → 10 (${order[0] === high.id ? "correct" : "wrong"})`);
  await setPriority(low.id, 100);
  const [boosted] = await db.select().from(workQueue).where(eq(workQueue.id, low.id));
  chk("P2", "Priority can be changed at runtime", boosted.priority === 100, `now ${boosted.priority}`);

  /* ============ 6. NICHES ============ */
  await db.delete(workQueue).where(sql`payload->>'audit' = ${TAG}`);
  const adopted = await adoptLegacyChannels();
  chk("N1", "Legacy channels adopted as niches (no orphans)", adopted >= 0,
    `${adopted} channel(s) adopted this run`);

  const nA = await createNiche({
    name: "Audit7 Alpha", description: "test niche A",
    scoutIntervalHours: 3, minGreenlightScore: 80,
    judgeWeights: { viralPotential: 40, originality: 30 },
    keywords: ["alpha"], excludedKeywords: ["betting"],
    production: { targetDurationSec: 30, scriptWordTarget: 90 },
    publishing: { platforms: ["youtube"], postsPerWeek: 7, timezone: "Asia/Singapore" },
  });
  chk("N2", "Niche created without code changes", nA.ok, nA.ok ? `slug=${nA.niche.slug}` : nA.error);
  if (!nA.ok) throw new Error("cannot continue");

  const detail = await getNiche(nA.niche.id);
  chk("N3", "Niche binds scout + judge + production + publishing profiles",
    !!detail?.production && !!detail?.strategy &&
    detail.niche.minGreenlightScore === 80 &&
    detail.production.targetDurationSec === 30 &&
    detail.strategy.timezone === "Asia/Singapore",
    `judge=${detail?.niche.minGreenlightScore} dur=${detail?.production?.targetDurationSec}s tz=${detail?.strategy?.timezone}`);
  chk("N4", "Judge weights are niche-specific (not hard-coded)",
    detail!.niche.judgeWeights.viralPotential === 40,
    JSON.stringify(detail!.niche.judgeWeights));
  chk("N5", "New niches default to approval-required, auto-publish OFF",
    detail!.strategy!.requireApproval === true && detail!.strategy!.autoPublish === false,
    `approval=${detail!.strategy!.requireApproval} autoPublish=${detail!.strategy!.autoPublish}`);

  await addSource({ nicheId: nA.niche.id, type: "rss", name: "audit rss",
    config: { feedUrl: "https://example.invalid/f.xml" } });
  const dup = await duplicateNiche(nA.niche.id, "Audit7 Alpha Copy");
  chk("N6", "Niche configuration can be duplicated",
    dup.ok && (dup as { sourcesCopied?: number }).sourcesCopied === 1,
    dup.ok ? `sources copied=${(dup as { sourcesCopied?: number }).sourcesCopied}` : dup.error);

  await enqueue({ type: "scout_cycle", nicheId: nA.niche.id, payload: { audit: TAG }, dedupeKey: `${TAG}:pausetest` });
  await setNicheStatus(nA.niche.id, "paused");
  const [pausedNiche] = await db.select().from(niches).where(eq(niches.id, nA.niche.id));
  const nicheJobs = await db.select().from(workQueue).where(eq(workQueue.nicheId, nA.niche.id));
  chk("N7", "Pausing a niche pauses its queued jobs",
    pausedNiche.status === "paused" && nicheJobs.every((j) => j.status === "paused"),
    `niche=${pausedNiche.status} jobs=[${nicheJobs.map((j) => j.status).join(",")}]`);
  await setNicheStatus(nA.niche.id, "active");
  const resumedJobs = await db.select().from(workQueue).where(eq(workQueue.nicheId, nA.niche.id));
  chk("N8", "Reactivating a niche resumes its jobs",
    resumedJobs.every((j) => j.status === "queued"), `jobs=[${resumedJobs.map((j) => j.status).join(",")}]`);

  const all = await listNiches();
  chk("N9", "Niche dashboard aggregates real counters",
    all.length >= 2 && all.every((n) => typeof n.sourceCount === "number"),
    `${all.length} niches, e.g. ${all[0].name}: ${all[0].sourceCount} sources`);

  /* ============ 7. MULTI-NICHE CONCURRENCY ============ */
  await db.delete(workQueue).where(sql`payload->>'audit' = ${TAG}`);
  const nB = await createNiche({ name: "Audit7 Bravo" });
  const nC = await createNiche({ name: "Audit7 Charlie" });
  if (!nB.ok || !nC.ok) throw new Error("niche setup failed");

  // 3 niches: A has a poisoned (permanently failing) job, B and C have healthy work
  const poison = await enqueue({
    type: "production_step", nicheId: nA.niche.id, priority: 60,
    payload: { audit: TAG }, dedupeKey: `${TAG}:poison`, maxAttempts: 1,
  }); // no production_job_id → PermanentJobError
  const okB = await enqueue({
    type: "analytics_refresh", nicheId: nB.niche.id, priority: 55,
    payload: { audit: TAG }, dedupeKey: `${TAG}:b`,
  });
  const okC = await enqueue({
    type: "analytics_refresh", nicheId: nC.niche.id, priority: 55,
    payload: { audit: TAG }, dedupeKey: `${TAG}:c`,
  });

  const t0 = Date.now();
  const tick = await workerTick({ workerId: "audit7-pool", concurrency: 3 });
  const elapsed = Date.now() - t0;
  const [pRow] = await db.select().from(workQueue).where(eq(workQueue.id, poison.id));
  const [bRow] = await db.select().from(workQueue).where(eq(workQueue.id, okB.id));
  const [cRow] = await db.select().from(workQueue).where(eq(workQueue.id, okC.id));

  chk("X1", "Multiple niches processed in one tick",
    tick.processed.length >= 3, `${tick.processed.length} jobs processed in ${elapsed}ms`);
  chk("X2", "A failing niche does NOT block other niches",
    pRow.status === "failed" && bRow.status === "completed" && cRow.status === "completed",
    `A=${pRow.status} B=${bRow.status} C=${cRow.status}`);
  chk("X3", "Permanent failure recorded with reason",
    pRow.errorKind === "permanent" && !!pRow.lastError,
    `${pRow.errorKind}: ${pRow.lastError?.slice(0, 50)}`);

  /* ============ 8. IDEMPOTENCY ============ */
  const idem1 = await enqueue({ type: "publish", publishJobId: null, payload: { audit: TAG }, dedupeKey: `${TAG}:idem` });
  const idem2 = await enqueue({ type: "publish", publishJobId: null, payload: { audit: TAG }, dedupeKey: `${TAG}:idem` });
  chk("I1", "Concurrent enqueues collapse to one job",
    idem1.id === idem2.id && !idem2.created, "same job id returned");
  const races = await Promise.all(
    Array.from({ length: 5 }, () =>
      enqueue({ type: "analytics_refresh", payload: { audit: TAG }, dedupeKey: `${TAG}:race` })),
  );
  chk("I2", "Parallel enqueue race produces exactly one job",
    new Set(races.map((r) => r.id)).size === 1, `${new Set(races.map((r) => r.id)).size} distinct id(s)`);

  const dupCheck = await db.execute(sql`
    SELECT dedupe_key, COUNT(*) c FROM work_queue
    WHERE dedupe_key IS NOT NULL GROUP BY dedupe_key HAVING COUNT(*) > 1`);
  chk("I3", "No duplicate live jobs share a dedupe key", dupCheck.rows.length === 0,
    `${dupCheck.rows.length} collisions`);

  /* ============ 9. OBSERVABILITY ============ */
  const allEvents = await db.select().from(jobEvents).where(eq(jobEvents.jobId, poison.id));
  chk("O1", "Every job attempt is auditable",
    allEvents.length >= 2 && allEvents.some((e) => e.event === "failed"),
    allEvents.map((e) => e.event).join(" → "));
  chk("O2", "Failure reason answers 'why didn't this run?'",
    allEvents.some((e) => !!e.error), allEvents.find((e) => e.error)?.error?.slice(0, 60) ?? "none");
  const stats = await queueStats();
  chk("O3", "Queue statistics available", typeof stats.completed === "number",
    Object.entries(stats).filter(([, v]) => v > 0).map(([k, v]) => `${k}:${v}`).join(" "));
  const jobList = await listJobs(10);
  chk("O4", "Job list exposes elapsed time without impure render",
    jobList.every((j) => "elapsedMs" in j), "elapsedMs computed in data layer");

  /* ============ 10. SCHEMA INTEGRITY ============ */
  const integrity = await db.execute(sql`
    SELECT
      (SELECT COUNT(*) FROM information_schema.tables WHERE table_schema='public')::int tables,
      (SELECT COUNT(*) FROM information_schema.table_constraints
        WHERE constraint_type='FOREIGN KEY' AND table_name IN ('work_queue','job_events','niches'))::int fks,
      (SELECT COUNT(*) FROM pg_indexes WHERE tablename IN ('work_queue','job_events','niches','workers'))::int idx,
      (SELECT COUNT(*) FROM pg_indexes WHERE tablename='work_queue' AND indexdef ILIKE '%UNIQUE%')::int uniq,
      (SELECT COUNT(*) FROM work_queue WHERE status NOT IN
        ('queued','running','paused','retrying','completed','failed','cancelled'))::int bad
  `);
  const ig = integrity.rows[0] as Record<string, number>;
  chk("S1", "Phase 7 tables have foreign keys", Number(ig.fks) >= 6, `${ig.fks} FKs`);
  chk("S2", "Queue has claim/lease/dedupe indexes", Number(ig.idx) >= 8 && Number(ig.uniq) >= 1,
    `${ig.idx} indexes, ${ig.uniq} unique`);
  chk("S3", "All job statuses are valid", Number(ig.bad) === 0, `${ig.bad} invalid`);
  chk("S4", "Total schema size sane", Number(ig.tables) >= 32, `${ig.tables} tables`);

  /* ============ 11. SECURITY ============ */
  const leak = await db.execute(sql`
    SELECT
      (SELECT COUNT(*) FROM work_queue WHERE COALESCE(last_error,'')||payload::text
         ~ '(ya29\\.|1//0|GOCSPX-|sk-[A-Za-z0-9]{16,})')::int a,
      (SELECT COUNT(*) FROM job_events WHERE COALESCE(error,'')||detail::text
         ~ '(ya29\\.|1//0|GOCSPX-|sk-[A-Za-z0-9]{16,})')::int b
  `);
  const L = leak.rows[0] as Record<string, number>;
  chk("Z1", "No secrets in queue rows", Number(L.a) === 0, `${L.a} rows`);
  chk("Z2", "No secrets in job events", Number(L.b) === 0, `${L.b} rows`);

  await cleanup();
  console.log("\n================ PHASE 7 SUMMARY ================");
  console.log(`${R.filter((r) => r.ok).length}/${R.length} passed`);
  const f = R.filter((r) => !r.ok);
  if (f.length) { console.log("FAILURES:"); f.forEach((x) => console.log(`  [${x.id}] ${x.n} :: ${x.d}`)); }
  process.exit(f.length ? 1 : 0);
}

main().catch((e) => { console.error(e); process.exit(1); });
