/* Phase 4 end-to-end: greenlit story → playable video draft. */
import "dotenv/config";
import { db } from "../src/db";
import { content, contentDrafts, productionAssets, productionJobs, productionSteps, channelProductionSettings, channels } from "../src/db/schema";
import { advanceProductionQueue, runProductionJob, retryProductionJob, requestDraftChanges, approveDraft, createProductionJob } from "../src/engine/production";
import { mediaProviderSummary } from "../src/lib/services/media";
import { productionProviderLabel } from "../src/lib/services/production";
import { and, eq } from "drizzle-orm";

const log = (...a: unknown[]) => console.log(...a);

async function main() {
  log("PROVIDERS:", JSON.stringify({ text: productionProviderLabel(), ...mediaProviderSummary() }));

  // Pick a greenlit story on a channel with narration ENABLED (Weird History)
  const [wh] = await db.select().from(channels).where(eq(channels.slug, "weird-history"));
  const [item] = await db.select().from(content)
    .where(and(eq(content.stage, "selected"), eq(content.channelId, wh.id))).limit(1);
  if (!item) { log("no selected content for weird-history"); process.exit(1); }
  const jobId = await createProductionJob(item.id);
  log("\n=== TEST 1: full production ===");
  log("job", jobId?.slice(0,8), "title:", item.title.slice(0,70));
  const r1 = await runProductionJob(jobId!, { trigger: "e2e" });
  log("result:", r1.status, "steps", r1.stepsRun, "failed", r1.stepsFailed, r1.errors);

  const steps = await db.select().from(productionSteps).where(eq(productionSteps.jobId, jobId!));
  for (const s of steps.sort((a,b)=>a.position-b.position))
    log(`  ${s.stepKey.padEnd(14)} ${s.status.padEnd(8)} ${s.generationMode.padEnd(10)} ${s.provider}`);

  const assets = await db.select().from(productionAssets).where(eq(productionAssets.jobId, jobId!));
  log("assets:", assets.map(a=>`${a.kind}:${a.status}${a.sceneNumber?`#${a.sceneNumber}`:""}`).join(" "));
  const vid = assets.find(a=>a.kind==="video");
  log("VIDEO:", vid?.status, vid?.url, vid?.bytes, "bytes", vid?.durationSec, "s", vid?.error ?? "");
  const [d1] = await db.select().from(contentDrafts).where(eq(contentDrafts.jobId, jobId!));
  log("draft:", d1.status, "mode:", d1.generationMode, "qc:", d1.qcScore, "words:", d1.wordCount);
  log("qc blocks approval:", (d1.qcReport as any)?.blocksApproval, "criticals:", (d1.qcReport as any)?.criticalCount);

  log("\n=== TEST 2: approval blocked by critical QC ===");
  const blocked = await approveDraft(jobId!);
  log("approve without override →", JSON.stringify(blocked));

  log("\n=== TEST 3: revision request (hook is weak) ===");
  const rev = await requestDraftChanges(jobId!, "The hook is weak", "auto");
  log("revision:", JSON.stringify(rev));
  const afterRev = await db.select().from(productionSteps).where(eq(productionSteps.jobId, jobId!));
  const preserved = afterRev.filter(s=>s.status==="success").map(s=>s.stepKey);
  const reset = afterRev.filter(s=>s.status==="pending").map(s=>s.stepKey);
  log("preserved:", preserved.join(","));
  log("reset:", reset.join(","));
  const r2 = await runProductionJob(jobId!, { trigger: "revision" });
  log("re-run:", r2.status, "steps executed:", r2.stepsRun);

  log("\n=== TEST 4: failure injection + targeted retry ===");
  await db.update(productionSteps).set({ status:"failed", error:"injected provider outage" })
    .where(and(eq(productionSteps.jobId, jobId!), eq(productionSteps.stepKey,"assembly")));
  await db.update(productionJobs).set({ status:"failed" }).where(eq(productionJobs.id, jobId!));
  const before = (await db.select().from(productionSteps).where(eq(productionSteps.jobId, jobId!)))
    .filter(s=>s.status==="success").map(s=>`${s.stepKey}@${s.finishedAt?.toISOString()}`).join("|");
  const r3 = await retryProductionJob(jobId!);
  const after = (await db.select().from(productionSteps).where(eq(productionSteps.jobId, jobId!)))
    .filter(s=>s.status==="success" && s.stepKey!=="assembly").map(s=>`${s.stepKey}@${s.finishedAt?.toISOString()}`).join("|");
  log("retry:", r3.status, "steps run:", r3.stepsRun, "| earlier steps untouched:", before.includes(after.split("|")[0] ?? ""));

  log("\n=== TEST 5: approve with override ===");
  const ok = await approveDraft(jobId!, "Reviewed in E2E", { override: true });
  const [j5] = await db.select().from(productionJobs).where(eq(productionJobs.id, jobId!));
  const [d5] = await db.select().from(contentDrafts).where(eq(contentDrafts.jobId, jobId!));
  log("approve →", JSON.stringify(ok), "| job:", j5.status, `${j5.completedSteps}/${j5.totalSteps}`, "| draft:", d5.status);

  log("\n=== TEST 6: narration-disabled niche (Movie Secrets) ===");
  const [ms] = await db.select().from(channels).where(eq(channels.slug, "movie-secrets"));
  const [msItem] = await db.select().from(content)
    .where(and(eq(content.stage,"selected"), eq(content.channelId, ms.id))).limit(1);
  if (msItem) {
    const msJob = await createProductionJob(msItem.id);
    const rms = await runProductionJob(msJob!, { trigger: "e2e" });
    const msSteps = await db.select().from(productionSteps).where(eq(productionSteps.jobId, msJob!));
    log("job", msJob?.slice(0,8), rms.status, "steps:", msSteps.map(s=>s.stepKey).join(","));
    log("narration present:", msSteps.some(s=>s.stepKey==="narration"));
    const msAssets = await db.select().from(productionAssets).where(eq(productionAssets.jobId, msJob!));
    log("video:", msAssets.find(a=>a.kind==="video")?.status, msAssets.find(a=>a.kind==="video")?.url ?? "");
  } else log("no selected movie-secrets content");

  log("\n=== TEST 7: repeated cron, no duplicates ===");
  const c1 = (await db.select().from(productionJobs)).length;
  await advanceProductionQueue(2, "cron");
  await advanceProductionQueue(2, "cron");
  const c2 = (await db.select().from(productionJobs)).length;
  const dupes = await db.execute(`SELECT content_id, COUNT(*) FROM production_jobs GROUP BY content_id HAVING COUNT(*)>1` as never);
  log("jobs before/after:", c1, c2, "| duplicate content_ids:", (dupes as any).rows.length);

  process.exit(0);
}
main().catch((e)=>{ console.error(e); process.exit(1); });
