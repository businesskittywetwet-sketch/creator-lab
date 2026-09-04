import "dotenv/config";
import { db } from "../src/db";
import { contentDrafts, productionAssets, productionJobs, productionSteps } from "../src/db/schema";
import { approveDraft, requestDraftChanges, retryProductionJob, createProductionJob, runProductionJob } from "../src/engine/production";
import { and, eq } from "drizzle-orm";
const log=(...a:unknown[])=>console.log(...a);

async function main(){
  const [job] = await db.select().from(productionJobs).where(eq(productionJobs.status,"awaiting_review")).limit(1);
  const [d] = await db.select().from(contentDrafts).where(eq(contentDrafts.jobId, job.id));
  const qc = d.qcReport as Record<string, unknown>;
  log(`job ${job.id.slice(0,8)} | draft mode=${d.generationMode} qc=${d.qcScore} blocks=${qc.blocksApproval} criticals=${qc.criticalCount}`);
  log("qc findings:", JSON.stringify((qc.findings as unknown[])?.slice(0,4)));

  log("\n[GATE] approve without override:");
  log("  →", JSON.stringify(await approveDraft(job.id)));

  log("\n[REVISION] 'The hook is weak':");
  const r = await requestDraftChanges(job.id, "The hook is weak", "auto");
  log("  target:", r.targetStep, "revision:", r.revision);
  let steps = await db.select().from(productionSteps).where(eq(productionSteps.jobId, job.id));
  log("  preserved:", steps.filter(s=>s.status==="success").map(s=>s.stepKey).join(","));
  log("  reset:", steps.filter(s=>s.status==="pending").map(s=>s.stepKey).join(","));

  log("\n[REVISION] 'The visuals dont match the script':");
  const r2 = await requestDraftChanges(job.id, "The visuals dont match the script", "auto");
  log("  target:", r2.targetStep, "revision:", r2.revision);

  log("\n[RETRY] inject failure at captions, retry:");
  await db.update(productionSteps).set({status:"success"}).where(and(eq(productionSteps.jobId,job.id),eq(productionSteps.stepKey,"research")));
  await db.update(productionSteps).set({status:"failed",error:"injected"}).where(and(eq(productionSteps.jobId,job.id),eq(productionSteps.stepKey,"captions")));
  const before = (await db.select().from(productionSteps).where(eq(productionSteps.jobId,job.id))).filter(s=>s.status==="success").length;
  const rr = await retryProductionJob(job.id);
  const after = (await db.select().from(productionSteps).where(eq(productionSteps.jobId,job.id))).filter(s=>s.status==="success").length;
  log(`  status=${rr.status} stepsRun=${rr.stepsRun} success ${before}→${after}`);

  log("\n[OVERRIDE] approve with override:");
  log("  →", JSON.stringify(await approveDraft(job.id,"E2E override",{override:true})));
  const [j2]=await db.select().from(productionJobs).where(eq(productionJobs.id,job.id));
  const [d2]=await db.select().from(contentDrafts).where(eq(contentDrafts.jobId,job.id));
  const [rev]=await db.select().from(productionSteps).where(and(eq(productionSteps.jobId,job.id),eq(productionSteps.stepKey,"review")));
  log(`  job=${j2.status} ${j2.completedSteps}/${j2.totalSteps} draft=${d2.status} reviewStep=${rev.status}/${rev.generationMode}/${rev.provider} dur=${rev.durationMs}ms`);

  log("\n[IDEMPOTENCY] repeated runs on completed job:");
  const a=await runProductionJob(job.id,{trigger:"idem"});
  const b=await runProductionJob(job.id,{trigger:"idem"});
  log(`  ${a.status}/${a.stepsRun} then ${b.status}/${b.stepsRun}`);
  const dupJobs = await db.execute(`SELECT content_id,COUNT(*) FROM production_jobs GROUP BY content_id HAVING COUNT(*)>1` as never);
  const dupDrafts = await db.execute(`SELECT job_id,COUNT(*) FROM content_drafts WHERE job_id IS NOT NULL GROUP BY job_id HAVING COUNT(*)>1` as never);
  log(`  duplicate jobs=${(dupJobs as any).rows.length} duplicate drafts=${(dupDrafts as any).rows.length}`);
  process.exit(0);
}
main().catch(e=>{console.error(e);process.exit(1);});
