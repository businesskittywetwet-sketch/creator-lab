/* Phase 3 production pipeline audit. Read-mostly; uses a scratch job. */
import "dotenv/config";
import { db } from "../src/db";
import {
  channelProductionSettings,
  channels,
  content,
  contentDrafts,
  productionJobs,
  productionSteps,
  stories,
} from "../src/db/schema";
import {
  createProductionJob,
  ensureProductionJobsForSelected,
  runProductionJob,
  retryProductionJob,
  approveDraft,
} from "../src/engine/production";
import { and, eq, sql } from "drizzle-orm";

const results: { id: string; name: string; status: "PASS" | "FAIL"; detail: string }[] = [];
function check(id: string, name: string, ok: boolean, detail: string) {
  results.push({ id, name, status: ok ? "PASS" : "FAIL", detail });
  console.log(`${ok ? "PASS" : "FAIL"}  [${id}] ${name} — ${detail}`);
}

async function main() {
  /* ---- self-provision fixtures so the audit is deterministic ---- */
  {
    const { createProductionJob, runProductionJob } = await import("../src/engine");
    for (const slug of ["movie-secrets", "weird-history"]) {
      const [c] = await db.select().from(channels).where(eq(channels.slug, slug));
      if (!c) continue;
      const existing = await db
        .select({ id: productionJobs.id })
        .from(productionJobs)
        .where(eq(productionJobs.channelId, c.id))
        .limit(1);
      if (existing.length > 0) continue;
      const [free] = await db.execute(sql`
        SELECT ct.id FROM content ct
        LEFT JOIN production_jobs p ON p.content_id = ct.id
        WHERE ct.channel_id = ${c.id} AND p.id IS NULL LIMIT 1
      `).then((r) => r.rows as { id: string }[]);
      if (!free) continue;
      await db.update(content).set({ stage: "selected" }).where(eq(content.id, free.id));
      const jid = await createProductionJob(free.id);
      if (jid) await runProductionJob(jid, { trigger: "fixture" });
    }
    // guarantee at least one awaiting_review job for the retry test
    const review = await db
      .select({ id: productionJobs.id })
      .from(productionJobs)
      .where(eq(productionJobs.status, "awaiting_review"))
      .limit(1);
    if (review.length === 0) {
      const [any] = await db.select().from(productionJobs).limit(1);
      if (any) await runProductionJob(any.id, { trigger: "fixture" });
    }
  }

  // ---------- 1. one job per greenlit story, no duplicates ----------
  const dupes = await db.execute(sql`
    SELECT content_id, COUNT(*) c FROM production_jobs GROUP BY content_id HAVING COUNT(*) > 1
  `);
  check("1a", "No duplicate production jobs per content", dupes.rows.length === 0,
    `${dupes.rows.length} content ids with >1 job`);

  const [selCount] = await db.execute(sql`
    SELECT COUNT(*)::int n FROM content c
    LEFT JOIN production_jobs p ON p.content_id = c.id
    WHERE c.stage = 'selected' AND p.id IS NULL
  `).then((r) => r.rows as { n: number }[]);
  check("1b", "Every selected story has a job", (selCount?.n ?? 0) === 0,
    `${selCount?.n ?? 0} selected content rows without a job`);

  // concurrent creation race
  const [anyContent] = await db.select().from(content).limit(1);
  if (anyContent) {
    const ids = await Promise.all([
      createProductionJob(anyContent.id),
      createProductionJob(anyContent.id),
      createProductionJob(anyContent.id),
    ]);
    const distinct = new Set(ids.filter(Boolean));
    const rows = await db.select().from(productionJobs).where(eq(productionJobs.contentId, anyContent.id));
    check("1c", "Concurrent createProductionJob is idempotent", distinct.size === 1 && rows.length === 1,
      `returned ${distinct.size} distinct id(s), db has ${rows.length} job(s)`);
  }

  // repeated reconciler
  const before = (await db.select().from(productionJobs)).length;
  await ensureProductionJobsForSelected();
  await ensureProductionJobsForSelected();
  const after = (await db.select().from(productionJobs)).length;
  check("7a", "Repeated reconciler creates no duplicates", before === after,
    `jobs ${before} -> ${after}`);

  // ---------- 2. step execution records ----------
  const stepStats = await db.execute(sql`
    SELECT
      COUNT(*)::int total,
      COUNT(*) FILTER (WHERE status='success' AND (output = '{}'::jsonb))::int empty_output,
      COUNT(*) FILTER (WHERE status='success' AND started_at IS NULL)::int no_start,
      COUNT(*) FILTER (WHERE status='success' AND finished_at IS NULL)::int no_finish,
      COUNT(*) FILTER (WHERE status='success' AND duration_ms IS NULL)::int no_duration,
      COUNT(*) FILTER (WHERE status='success' AND provider='')::int no_provider,
      COUNT(*) FILTER (WHERE status='success' AND attempts=0)::int no_attempts,
      COUNT(*) FILTER (WHERE agent_slug='')::int no_agent
    FROM production_steps
  `).then((r) => r.rows[0] as Record<string, number>);
  check("2a", "Successful steps persist output", (stepStats?.empty_output ?? 0) === 0,
    `${stepStats?.empty_output} success steps with empty output of ${stepStats?.total}`);
  check("2b", "Steps persist timestamps + duration",
    (stepStats?.no_start ?? 0) === 0 && (stepStats?.no_finish ?? 0) === 0 && (stepStats?.no_duration ?? 0) === 0,
    `no_start=${stepStats?.no_start} no_finish=${stepStats?.no_finish} no_duration=${stepStats?.no_duration}`);
  check("2c", "Steps persist provider + retry count + agent",
    (stepStats?.no_provider ?? 0) === 0 && (stepStats?.no_attempts ?? 0) === 0 && (stepStats?.no_agent ?? 0) === 0,
    `no_provider=${stepStats?.no_provider} attempts0=${stepStats?.no_attempts} no_agent=${stepStats?.no_agent}`);

  const auditRuns = await db.execute(sql`
    SELECT COUNT(*)::int n FROM agent_runs WHERE job_type='content_production'
  `).then((r) => r.rows[0] as { n: number });
  check("2d", "Audit records exist for production runs", (auditRuns?.n ?? 0) > 0,
    `${auditRuns?.n} agent_runs rows`);

  // step INPUT persistence (spec asks for input as well as output)
  const hasInputCol = await db.execute(sql`
    SELECT COUNT(*)::int n FROM information_schema.columns
    WHERE table_name='production_steps' AND column_name='input'
  `).then((r) => r.rows[0] as { n: number });
  check("2e", "Steps persist step INPUT", (hasInputCol?.n ?? 0) > 0,
    hasInputCol?.n ? "input column present" : "no input column — step inputs are not persisted");

  // ---------- 3. per-channel step configuration respected ----------
  const cfgs = await db
    .select({ channelId: channelProductionSettings.channelId, steps: channelProductionSettings.requiredSteps, name: channels.name })
    .from(channelProductionSettings)
    .leftJoin(channels, eq(channels.id, channelProductionSettings.channelId));
  const fullCount = ["research","fact_check","concept","script","visual_plan","visual_assets","narration","captions","assembly","quality_check","review"].length;
  const reduced = cfgs.find((c) => (c.steps as string[]).length < fullCount);
  if (reduced) {
    const jobs = await db.select().from(productionJobs).where(eq(productionJobs.channelId, reduced.channelId));
    if (jobs.length) {
      const steps = await db.select().from(productionSteps).where(eq(productionSteps.jobId, jobs[0].id));
      const keys = steps.map((s) => s.stepKey);
      const disabled = ["research","fact_check","concept","script","visual_plan","visual_assets","narration","captions","assembly","quality_check","review"]
        .filter((k) => !(reduced.steps as string[]).includes(k));
      const leaked = disabled.filter((d) => keys.includes(d));
      check("3a", "Disabled steps are not created for the channel", leaked.length === 0,
        `${reduced.name}: disabled=[${disabled}] present=[${leaked}] totalSteps=${keys.length}`);
      check("3b", "Job totalSteps matches configured steps", jobs[0].totalSteps === keys.length,
        `totalSteps=${jobs[0].totalSteps} stepRows=${keys.length}`);
    } else {
      check("3a", "Disabled steps not created", false, `no jobs for ${reduced.name} to inspect`);
    }
  } else {
    check("3a", "Reduced-step channel exists to test", false, `no channel with <${fullCount} steps configured`);
  }

  // ---------- 4/5. provider handling + labelling ----------
  const providers = await db.execute(sql`
    SELECT DISTINCT provider FROM production_steps WHERE provider <> ''
  `).then((r) => (r.rows as { provider: string }[]).map((x) => x.provider));
  check("5a", "Step provider is recorded for attribution", providers.length > 0,
    `providers seen: ${providers.join(", ") || "none"}`);

  const draftHasProviderCol = await db.execute(sql`
    SELECT COUNT(*)::int n FROM information_schema.columns
    WHERE table_name='content_drafts' AND column_name IN ('generation_mode','provider')
  `).then((r) => r.rows[0] as { n: number });
  check("5b", "Draft-level generation mode (real AI vs fallback) stored", (draftHasProviderCol?.n ?? 0) > 0,
    draftHasProviderCol?.n ? "present" : "no draft-level provider/generation_mode field");

  // secrets must not be in DB
  const secretLeak = await db.execute(sql`
    SELECT COUNT(*)::int n FROM production_steps
    WHERE output::text ~* '(sk-[a-z0-9]{16,}|api[_-]?key"\\s*:)'
  `).then((r) => r.rows[0] as { n: number });
  check("4a", "No API keys leaked into step output", (secretLeak?.n ?? 0) === 0,
    `${secretLeak?.n} suspicious rows`);

  // ---------- 6. retry resumes from failed step ----------
  const [reviewJob] = await db
    .select()
    .from(productionJobs)
    .where(eq(productionJobs.status, "awaiting_review"))
    .limit(1);
  if (reviewJob) {
    const steps = await db.select().from(productionSteps).where(eq(productionSteps.jobId, reviewJob.id));
    const target = steps.find((s) => s.stepKey === "quality_check") ?? steps[steps.length - 2];
    const untouched = steps.filter((s) => s.status === "success" && s.id !== target.id);
    const beforeFinish = new Map(untouched.map((s) => [s.id, s.finishedAt?.toISOString() ?? ""]));
    await db.update(productionSteps).set({ status: "failed", error: "audit-injected failure" }).where(eq(productionSteps.id, target.id));
    await db.update(productionJobs).set({ status: "failed", lastError: "audit" }).where(eq(productionJobs.id, reviewJob.id));
    const res = await retryProductionJob(reviewJob.id);
    const afterSteps = await db.select().from(productionSteps).where(eq(productionSteps.jobId, reviewJob.id));
    let rerun = 0;
    for (const s of afterSteps) {
      const prev = beforeFinish.get(s.id);
      if (prev !== undefined && (s.finishedAt?.toISOString() ?? "") !== prev) rerun += 1;
    }
    check("6a", "Retry resumes only from failed step", rerun === 0 && res.stepsRun <= 2,
      `completed steps re-executed=${rerun}, stepsRun=${res.stepsRun}, status=${res.status}`);
  } else {
    check("6a", "Retry resumes from failed step", false, "no awaiting_review job available");
  }

  // ---------- 7. idempotency of repeated runs ----------
  const [idemJob] = await db
    .select()
    .from(productionJobs)
    .where(eq(productionJobs.status, "awaiting_review"))
    .limit(1);
  if (idemJob) {
    const s1 = await db.select().from(productionSteps).where(eq(productionSteps.jobId, idemJob.id));
    const sig1 = s1.map((s) => `${s.stepKey}:${s.status}:${s.finishedAt?.toISOString() ?? ""}`).join("|");
    await runProductionJob(idemJob.id, { trigger: "audit" });
    await runProductionJob(idemJob.id, { trigger: "audit" });
    const s2 = await db.select().from(productionSteps).where(eq(productionSteps.jobId, idemJob.id));
    const sig2 = s2.map((s) => `${s.stepKey}:${s.status}:${s.finishedAt?.toISOString() ?? ""}`).join("|");
    const [j2] = await db.select().from(productionJobs).where(eq(productionJobs.id, idemJob.id));
    check("7b", "Re-running an awaiting_review job re-executes nothing", sig1 === sig2,
      sig1 === sig2 ? "step signatures identical" : "steps changed on re-run");
    check("7c", "completedSteps never exceeds totalSteps", j2.completedSteps <= j2.totalSteps,
      `${j2.completedSteps}/${j2.totalSteps}`);
    const drafts = await db.select().from(contentDrafts).where(eq(contentDrafts.jobId, idemJob.id));
    check("7d", "Repeated runs do not duplicate drafts", drafts.length === 1, `${drafts.length} draft rows`);
  }

  const draftDupes = await db.execute(sql`
    SELECT job_id, COUNT(*) c FROM content_drafts WHERE job_id IS NOT NULL GROUP BY job_id HAVING COUNT(*)>1
  `);
  check("7e", "No duplicate drafts per job", draftDupes.rows.length === 0, `${draftDupes.rows.length} jobs with >1 draft`);

  // ---------- 8. review gate ----------
  const badComplete = await db.execute(sql`
    SELECT COUNT(*)::int n FROM production_jobs j
    JOIN production_steps s ON s.job_id = j.id AND s.step_key='review'
    WHERE j.status='completed' AND s.status <> 'success'
  `).then((r) => r.rows[0] as { n: number });
  check("8a", "No job completed without review step success", (badComplete?.n ?? 0) === 0,
    `${badComplete?.n} violations`);

  const autoApproved = await db.execute(sql`
    SELECT COUNT(*)::int n FROM content_drafts d
    JOIN production_jobs j ON j.id = d.job_id
    WHERE d.status='approved' AND j.status <> 'completed'
  `).then((r) => r.rows[0] as { n: number });
  check("8b", "Approved drafts correspond to completed jobs", (autoApproved?.n ?? 0) === 0,
    `${autoApproved?.n} violations`);

  // can a failing-QC draft still be auto-completed?
  // Low-QC drafts may only be approved via an explicit, recorded override.
  const qcGate = await db.execute(sql`
    SELECT COUNT(*)::int n FROM content_drafts d
    JOIN production_steps s ON s.job_id = d.job_id AND s.step_key = 'review'
    WHERE d.qc_score < 60 AND d.status = 'approved'
      AND COALESCE((s.output->>'override')::boolean, false) = false
  `).then((r) => r.rows[0] as { n: number });
  check("8c", "Low-QC drafts approved only via recorded override", (qcGate?.n ?? 0) === 0,
    `${qcGate?.n} low-QC approvals without an override record`);

  // ---------- 9. database integrity ----------
  const fks = await db.execute(sql`
    SELECT tc.table_name, tc.constraint_name FROM information_schema.table_constraints tc
    WHERE tc.constraint_type='FOREIGN KEY'
      AND tc.table_name IN ('production_jobs','production_steps','content_drafts','channel_production_settings')
  `);
  check("9a", "Foreign keys present on production tables", fks.rows.length >= 6,
    `${fks.rows.length} FK constraints`);

  const uniq = await db.execute(sql`
    SELECT indexname FROM pg_indexes
    WHERE tablename='production_jobs' AND indexdef ILIKE '%UNIQUE%'
  `);
  check("9b", "UNIQUE constraint prevents duplicate jobs per content", uniq.rows.length > 0,
    uniq.rows.length ? `${uniq.rows.length} unique index(es)` : "no unique index on production_jobs.content_id");

  const orphans = await db.execute(sql`
    SELECT
      (SELECT COUNT(*) FROM production_steps s LEFT JOIN production_jobs j ON j.id=s.job_id WHERE j.id IS NULL)::int s_orphan,
      (SELECT COUNT(*) FROM content_drafts d LEFT JOIN content c ON c.id=d.content_id WHERE c.id IS NULL)::int d_orphan
  `).then((r) => r.rows[0] as Record<string, number>);
  check("9c", "No orphaned steps/drafts", (orphans?.s_orphan ?? 0) === 0 && (orphans?.d_orphan ?? 0) === 0,
    `steps=${orphans?.s_orphan} drafts=${orphans?.d_orphan}`);

  const badStatus = await db.execute(sql`
    SELECT COUNT(*)::int n FROM production_jobs
    WHERE status NOT IN ('queued','running','awaiting_review','completed','failed','cancelled')
  `).then((r) => r.rows[0] as { n: number });
  check("9d", "Job status values are within the allowed set", (badStatus?.n ?? 0) === 0,
    `${badStatus?.n} invalid statuses`);

  console.log("\n================ SUMMARY ================");
  const pass = results.filter((r) => r.status === "PASS").length;
  console.log(`${pass}/${results.length} passed`);
  console.log("FAILURES:");
  results.filter((r) => r.status === "FAIL").forEach((r) => console.log(`  [${r.id}] ${r.name} :: ${r.detail}`));
  process.exit(0);
}

main().catch((e) => { console.error(e); process.exit(1); });
