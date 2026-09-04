/* Verification harness: exercises the review gate and retry recovery. */
import "dotenv/config";
import { db } from "../src/db";
import { productionJobs, productionSteps, contentDrafts } from "../src/db/schema";
import { approveDraft, retryProductionJob } from "../src/engine/production";
import { eq } from "drizzle-orm";

async function main() {
  const [job] = await db
    .select()
    .from(productionJobs)
    .where(eq(productionJobs.status, "awaiting_review"))
    .limit(1);
  if (!job) {
    console.log("no job awaiting review");
    process.exit(0);
  }
  console.log("approving job", job.id.slice(0, 8), "status:", job.status);
  await approveDraft(job.id, "Approved in automated verification");
  const [after] = await db.select().from(productionJobs).where(eq(productionJobs.id, job.id));
  const [d] = await db.select().from(contentDrafts).where(eq(contentDrafts.jobId, job.id));
  console.log(`-> job: ${after.status} ${after.completedSteps}/${after.totalSteps} | draft: ${d.status}`);

  const [job2] = await db
    .select()
    .from(productionJobs)
    .where(eq(productionJobs.status, "awaiting_review"))
    .limit(1);
  if (job2) {
    await db
      .update(productionSteps)
      .set({ status: "failed", error: "simulated transient provider outage" })
      .where(eq(productionSteps.jobId, job2.id));
    await db
      .update(productionJobs)
      .set({ status: "failed", lastError: "simulated" })
      .where(eq(productionJobs.id, job2.id));
    console.log("injected failure into job", job2.id.slice(0, 8));
    const res = await retryProductionJob(job2.id);
    console.log(`-> retry: ${res.status} stepsRun=${res.stepsRun} failed=${res.stepsFailed}`);
  }
  process.exit(0);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
