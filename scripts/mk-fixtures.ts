import "dotenv/config";
import { db } from "../src/db";
import { channels, content } from "../src/db/schema";
import { createProductionJob, runProductionJob } from "../src/engine";
import { and, eq } from "drizzle-orm";
async function main() {
  for (const slug of ["movie-secrets", "dark-mysteries"]) {
    const [ch] = await db.select().from(channels).where(eq(channels.slug, slug));
    const [item] = await db.select().from(content)
      .where(and(eq(content.stage, "selected"), eq(content.channelId, ch.id))).limit(1);
    if (!item) { console.log(slug, "no selected content"); continue; }
    const id = await createProductionJob(item.id);
    const r = await runProductionJob(id!, { trigger: "fixture" });
    console.log(slug, "->", r.status, r.stepsRun, "steps");
  }
  process.exit(0);
}
main().catch(e => { console.error(e); process.exit(1); });
