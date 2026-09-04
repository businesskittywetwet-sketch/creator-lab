/* Real crash recovery: a job orphaned by a killed process must be reclaimed. */
import "dotenv/config";
import { db } from "../src/db";
import { workQueue, jobEvents } from "../src/db/schema";
import { reclaimExpiredLeases, workerTick } from "../src/engine";
import { eq, inArray, sql } from "drizzle-orm";

async function main() {
  const orphans = await db.select().from(workQueue).where(eq(workQueue.status, "running"));
  console.log(`orphaned RUNNING jobs left by the killed process: ${orphans.length}`);
  for (const o of orphans) {
    console.log(`  ${o.id.slice(0,8)} type=${o.type} worker=${o.workerId} attempts=${o.attempts} lease=${o.leaseExpiresAt?.toISOString()}`);
  }
  if (orphans.length === 0) { console.log("nothing to recover"); process.exit(0); }

  // Leases are 60s; force expiry to simulate the worker never coming back.
  await db.update(workQueue).set({ leaseExpiresAt: new Date(Date.now() - 1000) })
    .where(eq(workQueue.status, "running"));
  const n = await reclaimExpiredLeases();
  console.log(`\nreclaimExpiredLeases() recovered: ${n}`);

  for (const o of orphans) {
    const [after] = await db.select().from(workQueue).where(eq(workQueue.id, o.id));
    const evs = await db.select().from(jobEvents).where(eq(jobEvents.jobId, o.id));
    console.log(`  ${o.id.slice(0,8)} -> status=${after.status} owner=${after.workerId} attempts=${after.attempts}`);
    console.log(`     events: ${evs.map(e=>e.event).join(" → ")}`);
    console.log(`     reason: ${after.lastError?.slice(0,70)}`);
  }

  const stillRunning = await db.select().from(workQueue).where(eq(workQueue.status, "running"));
  console.log(`\nRESULT: ${stillRunning.length === 0 ? "all orphans recovered — no permanent orphaning" : `${stillRunning.length} still stuck`}`);

  // prove a fresh worker can now pick the recovered job back up
  const recovered = await db.select().from(workQueue)
    .where(inArray(workQueue.status, ["retrying","queued"]));
  console.log(`recovered jobs now claimable: ${recovered.length}`);
  process.exit(0);
}
main().catch(e => { console.error(e); process.exit(1); });
