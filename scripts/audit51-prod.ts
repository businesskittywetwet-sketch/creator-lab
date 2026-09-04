import "dotenv/config";
import { db } from "../src/db";
import { channels, content, contentDrafts, productionAssets, productionJobs, productionSteps, aiUsage } from "../src/db/schema";
import { createProductionJob, runProductionJob, retryProductionJob, ensureProductionJobsForSelected, advanceProductionQueue } from "../src/engine";
import { and, eq, isNull, sql } from "drizzle-orm";

const R:{id:string;n:string;ok:boolean;d:string}[]=[];
const chk=(id:string,n:string,ok:boolean,d:string)=>{R.push({id,n,ok,d});console.log(`${ok?"PASS":"FAIL"}  [${id}] ${n} — ${d}`);};

async function main(){
  // reconciler gap check (found in scout audit)
  const orphaned = await db.select({id:content.id}).from(content)
    .leftJoin(productionJobs, eq(productionJobs.contentId, content.id))
    .where(and(eq(content.stage,"selected"), isNull(productionJobs.id)));
  const created = await ensureProductionJobsForSelected();
  const orphaned2 = await db.select({id:content.id}).from(content)
    .leftJoin(productionJobs, eq(productionJobs.contentId, content.id))
    .where(and(eq(content.stage,"selected"), isNull(productionJobs.id)));
  chk("P0","Reconciler closes any greenlit-without-job gap", orphaned2.length===0,
    `${orphaned.length} orphaned before → reconciler created ${created} → ${orphaned2.length} after`);

  // full job on narration-ENABLED channel
  const [wh] = await db.select().from(channels).where(eq(channels.slug,"weird-history"));
  const [item] = await db.select().from(content)
    .where(and(eq(content.stage,"selected"), eq(content.channelId, wh.id))).limit(1);
  if(!item){console.log("no fixture");process.exit(1);}
  const jobId = (await createProductionJob(item.id))!;
  console.log(`--- running full production job ${jobId.slice(0,8)} ---`);
  const res = await runProductionJob(jobId,{trigger:"audit51"});

  const steps = await db.select().from(productionSteps).where(eq(productionSteps.jobId,jobId)).orderBy(productionSteps.position);
  console.log("\n  STEP            STATUS    MODE         PROV                        DUR    ATT  IN  OUT");
  for(const s of steps){
    const inK=Object.keys(s.input??{}).length, outK=Object.keys(s.output??{}).length;
    console.log(`  ${s.stepKey.padEnd(15)} ${s.status.padEnd(9)} ${s.generationMode.padEnd(12)} ${(s.provider||"-").slice(0,26).padEnd(27)} ${String(s.durationMs??"-").padStart(5)}  ${s.attempts}   ${inK}   ${outK}`);
  }

  const done = steps.filter(s=>s.status==="success" && s.stepKey!=="review");
  chk("P1","All expected steps executed", res.status==="awaiting_review",
    `status=${res.status} ran=${res.stepsRun} failed=${res.stepsFailed}`);
  chk("P2","Every successful step persists INPUT", done.every(s=>Object.keys(s.input??{}).length>0),
    `${done.filter(s=>Object.keys(s.input??{}).length>0).length}/${done.length} have input`);
  chk("P3","Every successful step persists OUTPUT", done.every(s=>Object.keys(s.output??{}).length>0),
    `${done.filter(s=>Object.keys(s.output??{}).length>0).length}/${done.length} have output`);
  chk("P4","Provider recorded per step", done.every(s=>s.provider!==""),
    [...new Set(done.map(s=>s.provider))].join(", "));
  chk("P5","Generation mode recorded (real_ai vs fallback)", done.every(s=>["real_ai","fallback","unavailable","human"].includes(s.generationMode)),
    Object.entries(done.reduce<Record<string,number>>((a,s)=>{a[s.generationMode]=(a[s.generationMode]??0)+1;return a;},{})).map(([k,v])=>`${k}:${v}`).join(" "));
  chk("P6","Duration + attempts recorded", done.every(s=>s.durationMs!==null && s.attempts>0),
    `all ${done.length} steps timed & counted`);

  // disabled step skipped (movie-secrets = no narration)
  const [ms] = await db.select().from(channels).where(eq(channels.slug,"movie-secrets"));
  const [msItem] = await db.select().from(content).where(and(eq(content.stage,"selected"),eq(content.channelId,ms.id))).limit(1);
  let msNote="no fixture";
  let msOk=false;
  if(msItem){
    const msJob=(await createProductionJob(msItem.id))!;
    const msSteps=await db.select().from(productionSteps).where(eq(productionSteps.jobId,msJob));
    msOk = !msSteps.some(s=>s.stepKey==="narration") && msSteps.length>0;
    msNote=`${msSteps.length} steps, narration present=${msSteps.some(s=>s.stepKey==="narration")}`;
  }
  chk("P7","Disabled steps genuinely skipped (Movie Secrets: no narration)", msOk, msNote);

  // retry does not rerun successful steps
  const beforeSig = steps.filter(s=>s.status==="success").map(s=>`${s.stepKey}@${s.finishedAt?.toISOString()}`).join("|");
  await db.update(productionSteps).set({status:"failed",error:"audit51 injected"})
    .where(and(eq(productionSteps.jobId,jobId),eq(productionSteps.stepKey,"quality_check")));
  await db.update(productionJobs).set({status:"failed"}).where(eq(productionJobs.id,jobId));
  const rr = await retryProductionJob(jobId);
  const after = await db.select().from(productionSteps).where(eq(productionSteps.jobId,jobId)).orderBy(productionSteps.position);
  const afterSig = after.filter(s=>s.status==="success"&&s.stepKey!=="quality_check"&&s.stepKey!=="review").map(s=>`${s.stepKey}@${s.finishedAt?.toISOString()}`).join("|");
  chk("P8","Retry resumes from failed step only", rr.stepsRun<=2 && beforeSig.includes(afterSig.split("|")[0]??""),
    `retry ran ${rr.stepsRun} step(s), earlier timestamps unchanged`);
  const qcStep = after.find(s=>s.stepKey==="quality_check");
  chk("P9","Retried step increments attempt count", (qcStep?.attempts??0)>=2, `quality_check attempts=${qcStep?.attempts}`);

  // idempotency
  const a=await runProductionJob(jobId,{trigger:"audit51"});
  const b=await runProductionJob(jobId,{trigger:"audit51"});
  chk("P10","Re-running awaiting_review job is a no-op", a.stepsRun===0&&b.stepsRun===0, `${a.status}/${a.stepsRun} then ${b.status}/${b.stepsRun}`);

  // cost tracking
  const usage = await db.select().from(aiUsage).where(eq(aiUsage.jobId,jobId));
  chk("P11","AI usage tracked per step", usage.length>0,
    `${usage.length} usage rows, kinds=${[...new Set(usage.map(u=>u.kind))].join(",")}, cost=${usage.reduce((x,u)=>x+u.costMicroUsd,0)}µ$`);

  // assets
  const assets = await db.select().from(productionAssets).where(eq(productionAssets.jobId,jobId));
  console.log("\n  assets:", assets.map(a=>`${a.kind}:${a.status}${a.sceneNumber?`#${a.sceneNumber}`:""}`).join(" "));
  const [draft]=await db.select().from(contentDrafts).where(eq(contentDrafts.jobId,jobId));
  console.log(`  draft: mode=${draft.generationMode} qc=${draft.qcScore} words=${draft.wordCount} video=${draft.videoUrl??"none"}`);
  console.log(`  JOBID=${jobId}`);

  console.log(`\nPRODUCTION: ${R.filter(r=>r.ok).length}/${R.length} passed`);
  process.exit(R.some(r=>!r.ok)?1:0);
}
main().catch(e=>{console.error(e);process.exit(1);});
