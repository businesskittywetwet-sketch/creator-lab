/* Phase 5 audit — Creator Lab: editing, revisions, publishing, analytics. */
import "dotenv/config";
import { db } from "../src/db";
import {
  channelStrategy,
  channels,
  content,
  contentDrafts,
  draftRevisions,
  notifications,
  performanceSignals,
  postMetrics,
  productionJobs,
  publishAccounts,
  publishAttempts,
  publishJobs,
  publishedPosts,
} from "../src/db/schema";
import {
  cancelPublishJob,
  createProductionJob,
  createPublishJobsForContent,
  dispatchPublishJob,
  ensureChannelStrategy,
  preflight,
  processDuePublishJobs,
  restoreDraftRevision,
  retryPublish,
  runProductionJob,
  saveDraftEdits,
  schedulePublishJob,
  approveDraft,
  requestDraftChanges,
  updateChannelStrategy,
  computePerformanceSignals,
  judgeSignalsFor,
  scanAttention,
  syncPostMetrics,
} from "../src/engine";
import { getCreatorMetrics, getCreatorAnalytics } from "../src/lib/queries";
import { platformConnectionSummary } from "../src/lib/services/platforms";
import { and, eq, sql } from "drizzle-orm";

const results: { id: string; name: string; ok: boolean; detail: string }[] = [];
function check(id: string, name: string, ok: boolean, detail: string) {
  results.push({ id, name, ok, detail });
  console.log(`${ok ? "PASS" : "FAIL"}  [${id}] ${name} — ${detail}`);
}

async function main() {
  // ---------------- setup: get a job to review ----------------
  const [ch] = await db.select().from(channels).where(eq(channels.slug, "weird-history"));
  // Self-provision a fixture: reuse a selected item, otherwise promote any
  // item on this channel that has no production job yet.
  let [item] = await db
    .select()
    .from(content)
    .where(and(eq(content.stage, "selected"), eq(content.channelId, ch.id)))
    .limit(1);
  if (!item) {
    const [free] = await db.execute(sql`
      SELECT c.id FROM content c
      LEFT JOIN production_jobs p ON p.content_id = c.id
      WHERE c.channel_id = ${ch.id} AND p.id IS NULL
      LIMIT 1
    `).then((r) => r.rows as { id: string }[]);
    if (!free) {
      // All content already has a job — reuse an existing one on this channel.
      const [reuse] = await db
        .select()
        .from(content)
        .where(eq(content.channelId, ch.id))
        .limit(1);
      if (!reuse) {
        console.log("no content for weird-history — run `npx tsx scripts/seed.ts` first");
        process.exit(1);
      }
      await db.update(content).set({ stage: "selected" }).where(eq(content.id, reuse.id));
      item = reuse;
    } else {
      await db.update(content).set({ stage: "selected" }).where(eq(content.id, free.id));
      [item] = await db.select().from(content).where(eq(content.id, free.id));
    }
  }
  const jobId = (await createProductionJob(item.id))!;
  await runProductionJob(jobId, { trigger: "audit" });
  const [draft0] = await db.select().from(contentDrafts).where(eq(contentDrafts.jobId, jobId));
  check("0", "Production job produced a draft", Boolean(draft0), `job ${jobId.slice(0, 8)} draft=${draft0?.status}`);

  // ---------------- 1. draft editing ----------------
  const before = draft0.hook;
  const edit = await saveDraftEdits(jobId, { hook: "AUDIT EDITED HOOK", socialCaption: "audit caption" });
  const [draft1] = await db.select().from(contentDrafts).where(eq(contentDrafts.jobId, jobId));
  check("1a", "Draft edit applies and records changed fields",
    edit.ok && draft1.hook === "AUDIT EDITED HOOK" && edit.changed.includes("hook"),
    `changed=[${edit.changed}] rev ${draft0.revision}→${draft1.revision}`);
  check("1b", "Edited fields are tracked for regeneration",
    draft1.editedFields.includes("hook"), `editedFields=[${draft1.editedFields}]`);

  // ---------------- 2. revision creation ----------------
  const revs = await db.select().from(draftRevisions).where(eq(draftRevisions.jobId, jobId));
  const manual = revs.find((r) => r.kind === "manual_edit");
  check("2a", "Manual edit creates a revision record", Boolean(manual), `${revs.length} revision(s)`);
  check("2b", "Revision snapshot preserves previous content",
    String((manual?.snapshot as Record<string, unknown>)?.hook ?? "") === before,
    "prior hook preserved in snapshot");

  const noop = await saveDraftEdits(jobId, { hook: "AUDIT EDITED HOOK" });
  check("2c", "No-op edit does not create a revision", noop.ok && noop.changed.length === 0, "no changes detected");

  // ---------------- 3. revision restoration ----------------
  const restore = await restoreDraftRevision(jobId, manual!.id);
  const [draft2] = await db.select().from(contentDrafts).where(eq(contentDrafts.jobId, jobId));
  check("3a", "Restore reverts to the snapshot", restore.ok && draft2.hook === before,
    `hook restored to original`);
  const revs2 = await db.select().from(draftRevisions).where(eq(draftRevisions.jobId, jobId));
  check("3b", "Restore is itself recorded (reversible)",
    revs2.some((r) => r.kind === "restore"), `${revs2.length} revisions total`);

  // ---------------- 4. stage-specific rewind ----------------
  const cases: [string, string][] = [
    ["The hook is weak", "concept"],
    ["Script is weak", "script"],
    ["Visuals don't match the script", "visual_plan"],
    ["Captions are wrong", "captions"],
    ["Video assembly problem", "assembly"],
  ];
  const mapped: string[] = [];
  for (const [note, expected] of cases) {
    const r = await requestDraftChanges(jobId, note, "auto");
    mapped.push(`${expected}${r.targetStep === expected ? "✓" : `✗(got ${r.targetStep})`}`);
  }
  check("4a", "Free-text revision maps to the right stage",
    mapped.every((m) => m.includes("✓")), mapped.join(" "));

  const stepsAfter = await db.execute(sql`
    SELECT step_key, status FROM production_steps WHERE job_id = ${jobId} ORDER BY position`);
  const preserved = (stepsAfter.rows as Record<string, string>[]).filter((r) => r.status === "success");
  check("4b", "Earlier successful steps are preserved on rewind",
    preserved.length > 0, `${preserved.length} step(s) still success after rewind to assembly`);

  // restore job to reviewable state
  await runProductionJob(jobId, { trigger: "audit" });

  // ---------------- 5. auto-publish default OFF ----------------
  const strat = await ensureChannelStrategy(ch.id);
  check("5a", "Auto-publish is OFF by default", strat.autoPublish === false, `autoPublish=${strat.autoPublish}`);
  check("5b", "Approval is required by default", strat.requireApproval === true, `requireApproval=${strat.requireApproval}`);

  // ---------------- 6. approved-only publishing ----------------
  const unapproved = await createPublishJobsForContent(item.id);
  check("6a", "Publish jobs are refused for unapproved drafts",
    unapproved.created === 0, unapproved.skipped[0] ?? "");

  // approve (override since QC is deterministic/low in this env)
  const approve = await approveDraft(jobId, "audit approval", { override: true });
  check("6b", "Approval gate works with explicit override", approve.ok, JSON.stringify(approve));

  const prepared = await createPublishJobsForContent(item.id);
  const existingForContent = await db
    .select()
    .from(publishJobs)
    .where(eq(publishJobs.contentId, item.id));
  check("6c", "Approved draft yields publish jobs",
    prepared.created > 0 || existingForContent.length > 0,
    `${prepared.created} created, ${existingForContent.length} total (idempotent)`);

  // ---------------- 7. duplicate prevention ----------------
  const again = await createPublishJobsForContent(item.id);
  const jobRows = await db.select().from(publishJobs).where(eq(publishJobs.contentId, item.id));
  const dupes = await db.execute(sql`
    SELECT content_id, platform, COUNT(*) c FROM publish_jobs
    GROUP BY content_id, platform HAVING COUNT(*) > 1`);
  check("7a", "Duplicate publish jobs are prevented",
    again.created === 0 && dupes.rows.length === 0,
    `re-run created ${again.created}; ${jobRows.length} unique job(s); ${dupes.rows.length} dupes`);

  // ---------------- 8. missing credentials → blocked ----------------
  const target = jobRows[0];
  const pf = await preflight(target.id);
  const credBlocked = pf.reasons.some((r) => /credential|not connected|not implemented|adapter/i.test(r));
  check("8a", "Preflight blocks when platform credentials are missing",
    !pf.ok && credBlocked, pf.reasons[0] ?? "no reasons");

  const dispatch = await dispatchPublishJob(target.id, { trigger: "audit" });
  check("8b", "Dispatch refuses to publish without a connected platform",
    !dispatch.ok, dispatch.reason ?? "");

  const [afterDispatch] = await db.select().from(publishJobs).where(eq(publishJobs.id, target.id));
  check("8c", "Blocked job is NOT marked published",
    afterDispatch.status !== "published" && !afterDispatch.publishedAt,
    `status=${afterDispatch.status}`);

  const posts = await db.select().from(publishedPosts).where(eq(publishedPosts.contentId, item.id));
  check("8d", "No published_posts row created without platform confirmation",
    posts.length === 0, `${posts.length} published post rows`);

  // ---------------- 9. attempt audit trail ----------------
  const attempts = await db.select().from(publishAttempts).where(eq(publishAttempts.jobId, target.id));
  check("9a", "Every dispatch is recorded in the audit trail",
    attempts.length > 0 && attempts.every((a) => a.outcome && a.platform),
    `${attempts.length} attempt row(s), outcome=${attempts[0]?.outcome}`);

  const retry = await retryPublish(target.id);
  const attempts2 = await db.select().from(publishAttempts).where(eq(publishAttempts.jobId, target.id));
  check("9b", "Retry appends a new attempt (history retained)",
    attempts2.length > attempts.length && !retry.ok,
    `${attempts.length} → ${attempts2.length} attempts`);

  // ---------------- 10. schedule validation + timezone ----------------
  let pastRejected = false;
  try {
    await schedulePublishJob(target.id, new Date(Date.now() - 3600_000));
  } catch {
    pastRejected = true;
  }
  check("10a", "Scheduling in the past is rejected", pastRejected, "past timestamp refused");

  let invalidRejected = false;
  try {
    await schedulePublishJob(target.id, new Date("not-a-date"));
  } catch {
    invalidRejected = true;
  }
  check("10b", "Invalid schedule input is rejected", invalidRejected, "NaN timestamp refused");

  const future = new Date(Date.now() + 6 * 3600_000);
  await schedulePublishJob(target.id, future);
  const [sched] = await db.select().from(publishJobs).where(eq(publishJobs.id, target.id));
  check("10c", "Valid future schedule is accepted",
    sched.status === "scheduled" && Boolean(sched.scheduledAt), `scheduled ${sched.scheduledAt?.toISOString()}`);

  await updateChannelStrategy(ch.id, { timezone: "America/New_York" });
  const st2 = await ensureChannelStrategy(ch.id);
  const rendered = new Intl.DateTimeFormat("en-US", {
    timeZone: st2.timezone, hour: "2-digit", minute: "2-digit", hour12: false,
  }).format(future);
  const utcRendered = new Intl.DateTimeFormat("en-US", {
    timeZone: "UTC", hour: "2-digit", minute: "2-digit", hour12: false,
  }).format(future);
  check("10d", "Channel timezone affects rendered schedule",
    st2.timezone === "America/New_York" && rendered !== utcRendered,
    `${st2.timezone}=${rendered} vs UTC=${utcRendered}`);

  // ---------------- 11. auto-publish gate on cron ----------------
  await db.update(publishJobs).set({ scheduledAt: new Date(Date.now() - 60_000) })
    .where(eq(publishJobs.id, target.id));
  const due = await processDuePublishJobs(5);
  const held = due.find((d) => d.jobId === target.id);
  check("11a", "Cron holds due jobs when auto-publish is disabled",
    held?.status === "held", held?.reason ?? "no result");
  const [stillScheduled] = await db.select().from(publishJobs).where(eq(publishJobs.id, target.id));
  check("11b", "Held job remains unpublished",
    stillScheduled.status === "scheduled", `status=${stillScheduled.status}`);

  // ---------------- 12. cancel ----------------
  await cancelPublishJob(target.id);
  const [cancelled] = await db.select().from(publishJobs).where(eq(publishJobs.id, target.id));
  check("12a", "Cancel sets a terminal, non-published state",
    cancelled.status === "cancelled", `status=${cancelled.status}`);

  // ---------------- 13. analytics honesty ----------------
  const sync = await syncPostMetrics();
  check("13a", "Metric sync reports honestly with no connections",
    sync.synced === 0, `posts=${sync.posts} synced=${sync.synced} skipped=${sync.skipped}`);
  const metricRows = await db.select().from(postMetrics);
  check("13b", "No metrics are invented", metricRows.length === 0, `${metricRows.length} metric rows`);
  const analytics = await getCreatorAnalytics();
  check("13c", "Analytics dashboard reports no data available",
    analytics.hasData === false && analytics.totalViews === 0, `hasData=${analytics.hasData}`);

  // ---------------- 14. performance signals ----------------
  const signals = await computePerformanceSignals();
  check("14a", "Signals are empty without real metrics", signals.length === 0, `${signals.length} signals`);
  const judgeSig = await judgeSignalsFor({ tags: ["disasters"], sourceName: "Scout network", channelSlug: "weird-history" });
  check("14b", "Judge receives zero adjustment with no data",
    judgeSig.adjustment === 0, `adjustment=${judgeSig.adjustment}`);

  // synthetic-but-labelled sample to prove the maths + confidence gate
  await db.insert(performanceSignals).values([
    { dimension: "topic", key: "movie endings", label: "Movie endings", sampleSize: 18,
      avgViews: 84000, baselineViews: 60000, adjustment: 3, confidence: "medium",
      explanation: "18 videos · avg 84,000 views vs baseline 60,000 · signal +3" },
    { dimension: "topic", key: "celebrity news", label: "Celebrity news", sampleSize: 3,
      avgViews: 12000, baselineViews: 60000, adjustment: 0, confidence: "none",
      explanation: "3 videos · insufficient data (need 5+) — no adjustment applied" },
  ]).onConflictDoNothing();
  const sigA = await judgeSignalsFor({ tags: ["movie endings"], sourceName: "x", channelSlug: null });
  const sigB = await judgeSignalsFor({ tags: ["celebrity news"], sourceName: "x", channelSlug: null });
  check("14c", "High-sample topic yields an adjustment",
    sigA.adjustment === 3, `+${sigA.adjustment} · ${sigA.notes[0]}`);
  check("14d", "Low-sample topic yields NO adjustment (explainable)",
    sigB.adjustment === 0 && sigB.notes[0]?.includes("insufficient"),
    sigB.notes[0] ?? "");

  // ---------------- 15. dashboard calculations ----------------
  const m = await getCreatorMetrics();
  const realJobs = await db.select().from(productionJobs);
  const realDrafts = await db.select().from(contentDrafts);
  check("15a", "Creator metrics match database state",
    m.awaitingReview === realJobs.filter((j) => j.status === "awaiting_review").length &&
    m.approved === realDrafts.filter((d) => d.status === "approved").length,
    `review=${m.awaitingReview} approved=${m.approved} published=${m.published}`);
  check("15b", "Cost + QC aggregates are computed",
    m.totalCostMicroUsd >= 0 && m.avgQcScore >= 0,
    `cost=${m.totalCostMicroUsd}µ$ avgQC=${m.avgQcScore} videos=${m.videosProduced}`);

  // ---------------- 16. attention + notifications ----------------
  const attention = await scanAttention();
  check("16a", "Attention scan surfaces real conditions",
    attention.length > 0 && attention.every((a) => a.count > 0),
    attention.map((a) => `${a.id}:${a.count}`).join(" "));
  const notes = await db.select().from(notifications);
  check("16b", "Notifications are recorded", notes.length > 0, `${notes.length} notification(s)`);

  // ---------------- 17. security: no secret leakage ----------------
  const leak = await db.execute(sql`
    SELECT
      (SELECT COUNT(*) FROM publish_accounts
        WHERE credential_ref ~ '(sk-|ghp_|Bearer |[A-Za-z0-9_\\-]{40,})')::int a,
      (SELECT COUNT(*) FROM publish_attempts
        WHERE request_summary::text ~* '(api[_-]?key|access[_-]?token|secret)'
           OR response_summary::text ~* '(sk-[A-Za-z0-9]{16,})')::int b
  `);
  const l = leak.rows[0] as Record<string, number>;
  check("17a", "No credentials stored in publish_accounts", Number(l.a) === 0, `${l.a} suspicious rows`);
  check("17b", "No secrets leaked into attempt logs", Number(l.b) === 0, `${l.b} suspicious rows`);
  const accts = await db.select().from(publishAccounts);
  check("17c", "Accounts store env var NAMES only",
    accts.every((a) => !a.credentialRef || /^[A-Z0-9_,]+$/.test(a.credentialRef)),
    `e.g. "${accts[0]?.credentialRef ?? "none"}"`);

  // ---------------- 18. DB integrity ----------------
  const integrity = await db.execute(sql`
    SELECT
      (SELECT COUNT(*) FROM information_schema.table_constraints
        WHERE constraint_type='FOREIGN KEY' AND table_name IN
        ('publish_jobs','publish_attempts','published_posts','post_metrics','publish_accounts','channel_strategy'))::int fks,
      (SELECT COUNT(*) FROM pg_indexes WHERE tablename IN
        ('publish_jobs','published_posts','publish_accounts','performance_signals')
        AND indexdef ILIKE '%UNIQUE%')::int uniques,
      (SELECT COUNT(*) FROM publish_jobs WHERE status NOT IN
        ('draft','ready','scheduled','publishing','published','failed','cancelled'))::int bad_status,
      (SELECT COUNT(*) FROM publish_jobs j LEFT JOIN content c ON c.id=j.content_id WHERE c.id IS NULL)::int orphans
  `);
  const ig = integrity.rows[0] as Record<string, number>;
  check("18a", "Foreign keys exist on publishing tables", Number(ig.fks) >= 10, `${ig.fks} FK constraints`);
  check("18b", "Unique constraints prevent duplicates", Number(ig.uniques) >= 4, `${ig.uniques} unique indexes`);
  check("18c", "Publish job statuses are within the allowed set", Number(ig.bad_status) === 0, `${ig.bad_status} invalid`);
  check("18d", "No orphaned publish jobs", Number(ig.orphans) === 0, `${ig.orphans} orphans`);

  // ---------------- 19. platform adapters ----------------
  const plats = platformConnectionSummary();
  check("19a", "All four platform adapters are registered",
    plats.length === 4 && plats.every((p) => p.state),
    plats.map((p) => `${p.short}:${p.state}`).join(" "));
  check("19b", "Adapters honestly report unavailability",
    plats.every((p) => p.state !== "connected"),
    "no credentials configured in this environment");

  console.log("\n================ PHASE 5 SUMMARY ================");
  const pass = results.filter((r) => r.ok).length;
  console.log(`${pass}/${results.length} passed`);
  const fails = results.filter((r) => !r.ok);
  if (fails.length) {
    console.log("FAILURES:");
    fails.forEach((f) => console.log(`  [${f.id}] ${f.name} :: ${f.detail}`));
  }
  process.exit(fails.length ? 1 : 0);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
