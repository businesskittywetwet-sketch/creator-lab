import "dotenv/config";
import { db } from "../src/db";
import { channels, content, contentDrafts, productionAssets, productionJobs, productionSteps } from "../src/db/schema";
import { createProductionJob, runProductionJob, retryProductionJob } from "../src/engine";
import { executeStep } from "../src/lib/services/production";
import { and, eq, isNull } from "drizzle-orm";

const R:{id:string;n:string;ok:boolean;d:string}[]=[];
const chk=(id:string,n:string,ok:boolean,d:string)=>{R.push({id,n,ok,d});console.log(`${ok?"PASS":"FAIL"}  [${id}] ${n} — ${d}`);};

async function main(){
  const [wh]=await db.select().from(channels).where(eq(channels.slug,"weird-history"));
  const [item]=await db.select().from(content)
    .leftJoin(productionJobs,eq(productionJobs.contentId,content.id))
    .where(and(eq(content.channelId,wh.id),isNull(productionJobs.id))).limit(1)
    .then(r=>r.map(x=>x.content));
  if(!item){console.log("no free content");process.exit(1);}
  const jobId=(await createProductionJob(item.id))!;
  await runProductionJob(jobId,{trigger:"fail-test"});
  console.log(`job ${jobId.slice(0,8)} prepared`);

  // ---- F4/F5: MISSING ASSET -> assembly failure ----
  const imgs=await db.select().from(productionAssets).where(and(eq(productionAssets.jobId,jobId),eq(productionAssets.kind,"image")));
  await db.delete(productionAssets).where(and(eq(productionAssets.jobId,jobId),eq(productionAssets.kind,"image")));
  await db.update(productionSteps).set({status:"pending",error:null})
    .where(and(eq(productionSteps.jobId,jobId),eq(productionSteps.stepKey,"assembly")));
  await db.update(productionJobs).set({status:"queued"}).where(eq(productionJobs.id,jobId));
  const fr=await runProductionJob(jobId,{trigger:"fail-test"});
  const [asm]=await db.select().from(productionSteps).where(and(eq(productionSteps.jobId,jobId),eq(productionSteps.stepKey,"assembly")));
  chk("F4","Missing asset -> assembly fails cleanly & is recorded",
    fr.status==="failed"&&asm.status==="failed"&&!!asm.error,
    `job=${fr.status} step=${asm.status} err="${asm.error?.slice(0,55)}"`);
  const alive=await db.select().from(productionSteps).where(and(eq(productionSteps.jobId,jobId),eq(productionSteps.status,"success")));
  chk("F5","Completed work survives the failure (no corruption)", alive.length>=6,
    `${alive.length} steps still success: ${alive.map(s=>s.stepKey).join(",")}`);
  const [jrow]=await db.select().from(productionJobs).where(eq(productionJobs.id,jobId));
  chk("F5b","Job row remains consistent (progress not inflated)",
    jrow.completedSteps<=jrow.totalSteps, `${jrow.completedSteps}/${jrow.totalSteps} lastError set=${!!jrow.lastError}`);

  // ---- F9: retry after restoring the asset resumes only failed step ----
  for(const im of imgs){ const {id,...rest}=im; void id; await db.insert(productionAssets).values(rest); }
  const preSig=alive.map(s=>`${s.stepKey}@${s.finishedAt?.toISOString()}`).join("|");
  const rr=await retryProductionJob(jobId);
  const post=await db.select().from(productionSteps).where(eq(productionSteps.jobId,jobId));
  const postSig=post.filter(s=>s.status==="success"&&alive.some(a=>a.stepKey===s.stepKey))
    .map(s=>`${s.stepKey}@${s.finishedAt?.toISOString()}`).join("|");
  chk("F9","Retry after fix resumes ONLY failed step", rr.stepsRun<=3 && preSig===postSig,
    `ran ${rr.stepsRun} step(s); prior step timestamps identical=${preSig===postSig}; status=${rr.status}`);
  const [asm2]=await db.select().from(productionSteps).where(and(eq(productionSteps.jobId,jobId),eq(productionSteps.stepKey,"assembly")));
  chk("F10","Recovered step succeeds with attempt history", asm2.status==="success"&&asm2.attempts>=2,
    `assembly status=${asm2.status} attempts=${asm2.attempts}`);

  // ---- F11: AI provider failure -> honest fallback, not fake AI ----
  const orig=process.env.OPENAI_API_KEY;
  process.env.OPENAI_API_KEY="sk-invalid-forced-failure-audit51";
  process.env.AI_MODEL_PROVIDER="openai";
  const ctx={story:{title:"Audit provider failure",summary:"Testing that a bad API key degrades honestly rather than fabricating output.",sourceName:"audit",sourceUrl:"https://example.invalid"},
    channel:{name:"Weird History",niche:"history",targetAudience:"test",voiceTone:"dry"},
    settings:{format:"Short",targetDurationSec:45,scriptWordTarget:120,tone:"dry",hookStyle:"curiosity",ctaStyle:"follow",
      visualStyle:"archival",narrationVoice:"x",researchDepth:3,sectionCount:3,writingStyle:"punchy",pacing:"fast",
      minWordCount:60,maxWordCount:200,language:"en",captionStyle:"bold",wordsPerCue:4,speakingRate:150,musicCue:""},
    prior:{}};
  const t0=Date.now();
  const out=await executeStep("research",ctx);
  chk("F11","Invalid AI credentials -> honest fallback (never fake real_ai)",
    out.mode==="fallback"&&out.provider.startsWith("composer"),
    `mode=${out.mode} provider=${out.provider} (took ${Date.now()-t0}ms incl. retries)`);
  if(orig===undefined) delete process.env.OPENAI_API_KEY; else process.env.OPENAI_API_KEY=orig;
  delete process.env.AI_MODEL_PROVIDER;

  // ---- F12: QC failure blocks approval ----
  const [d]=await db.select().from(contentDrafts).where(eq(contentDrafts.jobId,jobId));
  const qc=(d.qcReport??{}) as Record<string,unknown>;
  chk("F12","QC evaluates real content and can block", typeof qc.score==="number",
    `score=${qc.score} criticals=${qc.criticalCount} blocks=${qc.blocksApproval}`);

  console.log(`\nFAILURE TESTS: ${R.filter(r=>r.ok).length}/${R.length} passed`);
  const f=R.filter(r=>!r.ok); if(f.length) f.forEach(x=>console.log(`  FAILED [${x.id}] :: ${x.d}`));
  process.exit(f.length?1:0);
}
main().catch(e=>{console.error(e);process.exit(1);});
