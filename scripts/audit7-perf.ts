/* Phase 7 concurrency test: 3 niches, real production/render/publish jobs,
   plus a failing job — verify no cross-niche blocking. */
import "dotenv/config";
import { db } from "../src/db";
import { channels, content, niches, productionJobs, publishJobs, workQueue } from "../src/db/schema";
import {
  adoptLegacyChannels, createProductionJob, enqueue, listNiches, PRIORITY,
  queueStats, workerTick, deleteNiche,
} from "../src/engine";
import { and, eq, inArray, isNull, sql } from "drizzle-orm";

const TAG = "PERF7";
const log = (...a: unknown[]) => console.log(...a);

async function main() {
  await db.delete(workQueue).where(sql`payload->>'audit' = ${TAG}`);
  await adoptLegacyChannels();
  const all = await listNiches();
  const active = all.filter((n) => n.status === "active" && n.channelId).slice(0, 3);
  log(`niches under test: ${active.map((n) => n.name).join(", ")}`);
  if (active.length < 3) { log("need 3 niches"); process.exit(1); }

  // build real production jobs across niches
  const created: { niche: string; jobId: string; kind: string }[] = [];
  for (const n of active) {
    // two fast jobs per niche to prove parallel scheduling cheaply
    for (let k = 0; k < 2; k++) {
      const q = await enqueue({
        type: "analytics_refresh", priority: PRIORITY.production,
        nicheId: n.id, channelId: n.channelId,
        payload: { audit: TAG }, dedupeKey: `${TAG}:fast:${n.id}:${k}`,
      });
      created.push({ niche: n.name, jobId: q.id, kind: "analytics" });
    }
    const free = await db.execute(sql`
      SELECT ct.id FROM content ct LEFT JOIN production_jobs p ON p.content_id = ct.id
      WHERE ct.channel_id = ${n.channelId} AND p.id IS NULL LIMIT 1`);
    for (const r of free.rows as { id: string }[]) {
      const pj = await createProductionJob(r.id);
      if (!pj) continue;
      const q = await enqueue({
        type: "production_step", priority: PRIORITY.production,
        nicheId: n.id, channelId: n.channelId, contentId: r.id, productionJobId: pj,
        payload: { audit: TAG }, dedupeKey: `${TAG}:prod:${pj}`,
      });
      created.push({ niche: n.name, jobId: q.id, kind: "production" });
    }
  }

  // a render job, a publish job and a guaranteed-failing job
  const anyPub = (await db.select().from(publishJobs).limit(1))[0];
  if (anyPub) {
    const q = await enqueue({ type: "publish", priority: PRIORITY.publish, nicheId: active[1].id,
      publishJobId: anyPub.id, payload: { audit: TAG }, dedupeKey: `${TAG}:publish` });
    created.push({ niche: active[1].name, jobId: q.id, kind: "publish" });
  }
  const bad = await enqueue({ type: "production_step", priority: 60, nicheId: active[2].id,
    payload: { audit: TAG }, dedupeKey: `${TAG}:failing`, maxAttempts: 1 });
  created.push({ niche: active[2].name, jobId: bad.id, kind: "failing" });

  log(`\nqueued ${created.length} jobs:`);
  for (const c of created) log(`  ${c.kind.padEnd(11)} ${c.niche}`);
  log(`before: ${JSON.stringify(await queueStats())}`);

  // Drain the queue across ticks (each tick is bounded by concurrency).
  const t0 = Date.now();
  let ticks = 0;
  const outcomes: { ok: boolean; type: string; error?: string; detail?: unknown }[] = [];
  for (let i = 0; i < 8; i++) {
    const tick = await workerTick({ workerId: `perf7-pool-${i}`, concurrency: 4 });
    ticks += 1;
    outcomes.push(...tick.processed);
    if (tick.processed.length === 0) break;
    const remaining = await db.select().from(workQueue)
      .where(and(sql`payload->>'audit' = ${TAG}`, inArray(workQueue.status, ["queued", "retrying"])));
    if (remaining.length === 0) break;
  }
  const elapsed = Date.now() - t0;

  log(`\nprocessed ${outcomes.length} job(s) across ${ticks} tick(s) in ${elapsed}ms (concurrency 4)`);
  for (const p of outcomes) {
    log(`  ${p.ok ? "OK  " : "FAIL"} ${p.type.padEnd(16)} ${p.error ? p.error.slice(0, 60) : JSON.stringify(p.detail ?? {}).slice(0, 70)}`);
  }

  // per-niche outcome
  log("\nper-niche outcomes:");
  for (const n of active) {
    const rows = await db.select().from(workQueue)
      .where(and(eq(workQueue.nicheId, n.id), sql`payload->>'audit' = ${TAG}`));
    const tally = rows.reduce<Record<string, number>>((a, r) => { a[r.status] = (a[r.status] ?? 0) + 1; return a; }, {});
    log(`  ${n.name.padEnd(22)} ${JSON.stringify(tally)}`);
  }

  // No-blocking proof: the niche containing the failing job must not
  // prevent OTHER niches from reaching a terminal state.
  const failedNiche = active[2].id;
  const others = await db.select().from(workQueue)
    .where(and(sql`payload->>'audit' = ${TAG}`, sql`niche_id <> ${failedNiche}`));
  const unfinished = others.filter((r) => !["completed", "failed", "cancelled"].includes(r.status));
  const nichesProgressed = new Set(
    others.filter((r) => r.status === "completed").map((r) => r.nicheId),
  ).size;
  log(`\nunrelated-niche jobs: ${others.length} total, ${unfinished.length} unfinished`);
  log(`distinct unrelated niches that completed work: ${nichesProgressed}`);
  log(`VERDICT: ${unfinished.length === 0 && nichesProgressed >= 2 ? "NO cross-niche blocking" : "POSSIBLE BLOCKING"}`);
  log(`after: ${JSON.stringify(await queueStats())}`);

  await db.delete(workQueue).where(sql`payload->>'audit' = ${TAG}`);
  process.exit(0);
}
main().catch((e) => { console.error(e); process.exit(1); });
