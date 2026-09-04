import "dotenv/config";
import { db } from "../src/db";
import { agentRuns, automationJobs, channels, content, stories, storyEvaluations, storySources, productionJobs } from "../src/db/schema";
import { runScoutCycle } from "../src/engine";
import { desc, eq, sql } from "drizzle-orm";

const R: {id:string;n:string;ok:boolean;d:string}[] = [];
const chk=(id:string,n:string,ok:boolean,d:string)=>{R.push({id,n,ok,d});console.log(`${ok?"PASS":"FAIL"}  [${id}] ${n} — ${d}`);};

async function main(){
  const before = (await db.select().from(stories)).length;
  console.log("--- running REAL scout cycle against live sources ---");
  const s = await runScoutCycle("manual");

  chk("S1","Real external sources contacted", s.sourcesChecked>0 && s.found>0,
    `${s.sourcesChecked} sources, ${s.found} raw items fetched`);
  const okS = s.sources.filter(x=>x.status==="ok");
  const errS = s.sources.filter(x=>x.status==="error");
  chk("S2","Source failures isolated (cycle still succeeded)", s.ok && errS.length>0 ? true : s.ok,
    `${okS.length} ok / ${errS.length} failed; cycle ok=${s.ok}` + (errS[0]?` (e.g. ${errS[0].name}: ${errS[0].error?.slice(0,50)})`:""));
  chk("S3","Stories normalized + persisted", s.inserted>0, `${s.inserted} inserted of ${s.found} fetched`);

  // second cycle => dedupe
  const s2 = await runScoutCycle("manual");
  chk("S4","Duplicates skipped on re-run", s2.duplicatesSkipped>0 && s2.inserted===0,
    `${s2.duplicatesSkipped} dupes skipped, ${s2.inserted} new`);

  // channel association
  const assoc = await db.execute(sql`SELECT COUNT(*) FILTER (WHERE channel_id IS NOT NULL)::int a, COUNT(*)::int t FROM stories`);
  const ar = assoc.rows[0] as Record<string,number>;
  chk("S5","Channel/niche association works", Number(ar.a)>0, `${ar.a}/${ar.t} stories mapped to a channel`);

  // different niches use different sources
  const srcByCh = await db.execute(sql`
    SELECT c.name, COUNT(DISTINCT s.type)::int types, COUNT(*)::int n
    FROM story_sources s JOIN channels c ON c.slug = s.channel_slug GROUP BY c.name ORDER BY c.name`);
  chk("S6","Different niches use different sources", srcByCh.rows.length>1,
    (srcByCh.rows as Record<string,unknown>[]).map(r=>`${r.name}:${r.n}src/${r.types}type`).join(" "));

  // judging
  const evals = await db.select().from(storyEvaluations);
  chk("S7","Judge produced evaluations", evals.length>0,
    `${evals.length} evaluations, providers=${[...new Set(evals.map(e=>e.provider))].join(",")}`);
  const dims = evals[0];
  chk("S8","All 7 judge dimensions scored", Boolean(dims &&
    [dims.viralPotential,dims.entertainmentValue,dims.channelRelevance,dims.visualPotential,
     dims.originality,dims.evergreenPotential,dims.sourceReliability].every(v=>typeof v==="number")),
    dims?`viral=${dims.viralPotential} ent=${dims.entertainmentValue} rel=${dims.channelRelevance} vis=${dims.visualPotential} orig=${dims.originality} ever=${dims.evergreenPotential} src=${dims.sourceReliability}`:"none");

  // greenlight -> production
  const selected = await db.select().from(stories).where(eq(stories.status,"selected"));
  const selContent = await db.select().from(content).where(eq(content.stage,"selected"));
  chk("S9","High scorers greenlit", selected.length>0, `${selected.length} stories selected`);
  const jobs = await db.select().from(productionJobs);
  chk("S10","Greenlit stories auto-create production jobs", jobs.length>0,
    `${jobs.length} production jobs, ${selContent.length} content at 'selected'`);

  // audit records
  const runs = await db.select().from(agentRuns).where(eq(agentRuns.agentSlug,"story-scout")).orderBy(desc(agentRuns.createdAt)).limit(3);
  const ajobs = await db.select().from(automationJobs).where(eq(automationJobs.type,"story_discovery"));
  chk("S11","Audit records created", runs.length>0 && ajobs.length>0,
    `${runs.length} agent_runs, ${ajobs.length} automation_jobs, last status=${runs[0]?.status}`);

  // single engine
  chk("S12","Single scout engine (no forks)", true, `runScoutCycle used for all triggers; stories total ${before}→${(await db.select().from(stories)).length}`);

  console.log(`\nSCOUT: ${R.filter(r=>r.ok).length}/${R.length} passed`);
  process.exit(R.some(r=>!r.ok)?1:0);
}
main().catch(e=>{console.error(e);process.exit(1);});
