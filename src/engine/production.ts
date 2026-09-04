import { db } from "@/db";
import {
  agentRuns,
  agents,
  aiUsage,
  automationJobs,
  channelProductionSettings,
  channels,
  content,
  contentDrafts,
  draftRevisions,
  productionAssets,
  productionJobs,
  productionSteps,
  stories,
  type ScriptSection,
  type VisualShot,
} from "@/db/schema";
import { and, asc, desc, eq, inArray, isNull, sql } from "drizzle-orm";
import {
  activeSteps,
  DEFAULT_REQUIRED_STEPS,
  productionStepDef,
  PRODUCTION_STEPS,
  PRODUCTION_STEP_ORDER,
} from "@/lib/production-steps";
import {
  evaluateQuality,
  executeStep,
  composeNarrationPlan,
  productionProviderLabel,
  type ProductionSettings,
  type StepContext,
} from "@/lib/services/production";
import {
  buildCaptionCues,
  generateNarration,
  generateSceneImage,
  mediaProviderSummary,
  renderVideo,
  writeCaptionFiles,
  type GenerationMode,
} from "@/lib/services/media";

/* ------------------------------------------------------------------ */
/*  CONTENT PRODUCTION ENGINE                                          */
/*                                                                     */
/*  Drives a greenlit story to a reviewable, playable draft. Every     */
/*  step persists input, output, provider, generation mode, timing,    */
/*  errors and retry count. Media steps produce real files on disk.    */
/* ------------------------------------------------------------------ */

/* --------------------- per-channel configuration ------------------- */

function parseDurationSec(preferredLength: string, fallback = 55): number {
  const text = preferredLength.toLowerCase();
  const minMatch = text.match(/(\d+)\s*(?:–|-|to)?\s*(\d+)?\s*min/);
  if (minMatch) {
    const a = Number(minMatch[1]);
    const b = minMatch[2] ? Number(minMatch[2]) : a;
    return Math.round(((a + b) / 2) * 60);
  }
  const secMatch = text.match(/(\d+)\s*(?:–|-|to)?\s*(\d+)?\s*s/);
  if (secMatch) {
    const a = Number(secMatch[1]);
    const b = secMatch[2] ? Number(secMatch[2]) : a;
    return Math.round((a + b) / 2);
  }
  return fallback;
}

export async function ensureProductionSettings(channelId: string) {
  const [existing] = await db
    .select()
    .from(channelProductionSettings)
    .where(eq(channelProductionSettings.channelId, channelId));
  if (existing) return existing;

  const [ch] = await db.select().from(channels).where(eq(channels.id, channelId));
  const durationSec = ch ? parseDurationSec(ch.preferredLength) : 55;
  const isLong = durationSec > 180;
  const wordTarget = Math.max(60, Math.round((durationSec / 60) * 150));
  const [created] = await db
    .insert(channelProductionSettings)
    .values({
      channelId,
      format: isLong ? "Long-form" : "Short",
      targetDurationSec: durationSec,
      scriptWordTarget: wordTarget,
      tone: ch?.voiceTone || "Wry, deadpan narrator",
      hookStyle: "curiosity",
      ctaStyle: "Follow for more stories like this",
      visualStyle: ch?.contentStyle || "Archival footage with kinetic captions",
      narrationVoice: ch ? `${ch.slug}-primary` : "default",
      researchDepth: isLong ? 6 : 4,
      sectionCount: isLong ? 6 : 5,
      minWordCount: Math.round(wordTarget * 0.65),
      maxWordCount: Math.round(wordTarget * 1.45),
      requiredSteps: DEFAULT_REQUIRED_STEPS,
    })
    .onConflictDoNothing()
    .returning();
  if (created) return created;
  const [again] = await db
    .select()
    .from(channelProductionSettings)
    .where(eq(channelProductionSettings.channelId, channelId));
  return again;
}

export type ProductionSettingsInput = Partial<ProductionSettings> & { requiredSteps: string[] };

export async function updateProductionSettings(channelId: string, input: ProductionSettingsInput) {
  await ensureProductionSettings(channelId);
  await db
    .update(channelProductionSettings)
    .set({ ...input, updatedAt: new Date() })
    .where(eq(channelProductionSettings.channelId, channelId));
}

/* --------------------------- job creation -------------------------- */

/** Idempotently create a production job (+ step rows) for a content item. */
export async function createProductionJob(contentId: string): Promise<string | null> {
  const [item] = await db.select().from(content).where(eq(content.id, contentId));
  if (!item) return null;

  const settings = await ensureProductionSettings(item.channelId);
  const steps = activeSteps(settings?.requiredSteps ?? DEFAULT_REQUIRED_STEPS);

  // Race-safe: the DB unique constraint on content_id is the arbiter.
  const [job] = await db
    .insert(productionJobs)
    .values({
      contentId,
      channelId: item.channelId,
      status: "queued",
      currentStep: steps[0]?.key ?? "research",
      totalSteps: steps.length,
      provider: productionProviderLabel(),
    })
    .onConflictDoNothing({ target: productionJobs.contentId })
    .returning();

  if (!job) {
    const [existing] = await db
      .select({ id: productionJobs.id })
      .from(productionJobs)
      .where(eq(productionJobs.contentId, contentId));
    return existing?.id ?? null;
  }

  await db.insert(productionSteps).values(
    steps.map((s, i) => ({
      jobId: job.id,
      stepKey: s.key,
      label: s.label,
      agentSlug: s.agentSlug,
      position: i,
      status: "pending",
    })),
  );

  await db
    .insert(contentDrafts)
    .values({ contentId, jobId: job.id, version: 1, status: "in_progress", title: item.title })
    .onConflictDoNothing();

  console.log(`[production] job created for content ${contentId} (${steps.length} steps)`);
  return job.id;
}

export async function ensureProductionJobsForSelected(): Promise<number> {
  const rows = await db
    .select({ id: content.id })
    .from(content)
    .leftJoin(productionJobs, eq(productionJobs.contentId, content.id))
    .where(and(eq(content.stage, "selected"), isNull(productionJobs.id)));
  let created = 0;
  for (const r of rows) if (await createProductionJob(r.id)) created += 1;
  return created;
}

/* ------------------------------ helpers ---------------------------- */

export type RunResult = {
  jobId: string;
  status: string;
  stepsRun: number;
  stepsFailed: number;
  provider: string;
  errors: string[];
};

async function recordUsage(row: typeof aiUsage.$inferInsert) {
  await db.insert(aiUsage).values(row);
}

/** Authoritative progress: count successful/skipped step rows. */
async function syncProgress(jobId: string) {
  const rows = await db.select().from(productionSteps).where(eq(productionSteps.jobId, jobId));
  const done = rows.filter((s) => s.status === "success" || s.status === "skipped").length;
  await db
    .update(productionJobs)
    .set({ completedSteps: done, totalSteps: rows.length, updatedAt: new Date() })
    .where(eq(productionJobs.id, jobId));
  return done;
}

async function buildContext(
  job: typeof productionJobs.$inferSelect,
  prior: Record<string, Record<string, unknown>>,
  revisionNote?: string,
): Promise<StepContext> {
  const [item] = await db.select().from(content).where(eq(content.id, job.contentId));
  const [ch] = await db.select().from(channels).where(eq(channels.id, job.channelId));
  const s = await ensureProductionSettings(job.channelId);
  const story = item?.storyId
    ? (await db.select().from(stories).where(eq(stories.id, item.storyId)))[0]
    : undefined;

  return {
    story: {
      title: story?.title ?? item?.title ?? "Untitled",
      summary: story?.summary ?? item?.hook ?? "",
      sourceName: story?.sourceName ?? "internal",
      sourceUrl: story?.sourceUrl ?? "",
    },
    channel: {
      name: ch?.name ?? "Channel",
      niche: ch?.niche ?? "",
      targetAudience: ch?.targetAudience ?? "",
      voiceTone: ch?.voiceTone ?? "",
    },
    settings: {
      format: s?.format ?? "Short",
      targetDurationSec: s?.targetDurationSec ?? 55,
      scriptWordTarget: s?.scriptWordTarget ?? 140,
      tone: s?.tone ?? "Wry, deadpan narrator",
      hookStyle: s?.hookStyle ?? "curiosity",
      ctaStyle: s?.ctaStyle ?? "Follow for more",
      visualStyle: s?.visualStyle ?? "Archival footage",
      narrationVoice: s?.narrationVoice ?? "default",
      researchDepth: s?.researchDepth ?? 4,
      sectionCount: s?.sectionCount ?? 5,
      writingStyle: s?.writingStyle ?? "Punchy, concrete, no filler",
      pacing: s?.pacing ?? "fast",
      minWordCount: s?.minWordCount ?? 90,
      maxWordCount: s?.maxWordCount ?? 200,
      language: s?.language ?? "en",
      captionStyle: s?.captionStyle ?? "bold-centered",
      wordsPerCue: s?.wordsPerCue ?? 4,
      speakingRate: s?.speakingRate ?? 150,
      musicCue: s?.musicCue ?? "",
    },
    prior,
    revisionNote,
  };
}

async function applyToDraft(jobId: string, stepKey: string, output: Record<string, unknown>) {
  const patch: Partial<typeof contentDrafts.$inferInsert> = { updatedAt: new Date() };
  if (stepKey === "research") patch.researchBrief = output;
  if (stepKey === "fact_check") patch.factCheck = output;
  if (stepKey === "concept") {
    patch.concept = String(output.angle ?? "");
    patch.angle = String(output.angle ?? "");
    patch.hook = String(output.hook ?? "");
    patch.concepts = (output.concepts as Record<string, unknown>[]) ?? [];
    if (output.workingTitle) patch.title = String(output.workingTitle);
  }
  if (stepKey === "script") {
    patch.sections = (output.sections as ScriptSection[]) ?? [];
    patch.scriptBody = String(output.scriptBody ?? "");
    patch.cta = String(output.cta ?? "");
    patch.wordCount = Number(output.wordCount ?? 0);
    patch.estimatedDurationSec = Number(output.estimatedDurationSec ?? 0);
    if (output.hook) patch.hook = String(output.hook);
  }
  if (stepKey === "visual_plan") patch.visualPlan = (output.shots as VisualShot[]) ?? [];
  if (stepKey === "narration") {
    patch.narrationPlan = output;
    if (output.audioUrl) patch.audioUrl = String(output.audioUrl);
  }
  if (stepKey === "captions") patch.captions = output;
  if (stepKey === "assembly") {
    patch.assemblyPlan = output;
    if (output.videoUrl) patch.videoUrl = String(output.videoUrl);
  }
  if (stepKey === "quality_check") {
    patch.qcReport = output;
    patch.qcScore = Number(output.score ?? 0);
  }
  await db.update(contentDrafts).set(patch).where(eq(contentDrafts.jobId, jobId));
}

/* ------------------------- media step runners ---------------------- */

type MediaStepResult = { output: Record<string, unknown>; provider: string; mode: GenerationMode };

async function runVisualAssets(jobId: string, ctx: StepContext): Promise<MediaStepResult> {
  const shots = (ctx.prior.visual_plan?.shots as Record<string, unknown>[] | undefined) ?? [];
  if (shots.length === 0) throw new Error("visual_assets requires a visual plan with shots");

  const vertical = String(ctx.prior.visual_plan?.aspectRatio ?? "9:16") !== "16:9";
  const width = vertical ? 1080 : 1920;
  const height = vertical ? 1920 : 1080;
  const [ch] = await db.select().from(channels).where(eq(channels.id, (await db.select().from(productionJobs).where(eq(productionJobs.id, jobId)))[0].channelId));
  const accent = ch?.color ?? "#C6F135";

  // clear previous assets for this step so retries don't accumulate
  await db.delete(productionAssets).where(and(eq(productionAssets.jobId, jobId), eq(productionAssets.kind, "image")));

  let generated = 0;
  let realAi = 0;
  const results: Record<string, unknown>[] = [];
  for (let i = 0; i < shots.length; i++) {
    const shot = shots[i];
    const sceneNumber = Number(shot.sceneNumber ?? i + 1);
    const started = Date.now();
    const res = await generateSceneImage(
      jobId,
      {
        sceneNumber,
        prompt: String(shot.aiPrompt ?? shot.description ?? ""),
        overlayText: String(shot.overlayText ?? shot.section ?? ""),
        narration: String(shot.narrationSegment ?? ""),
        heading: String(shot.section ?? ""),
      },
      { width, height, accent, channel: ctx.channel.name, total: shots.length },
    );
    await db.insert(productionAssets).values({
      jobId,
      stepKey: "visual_assets",
      kind: "image",
      sceneNumber,
      prompt: String(shot.aiPrompt ?? shot.description ?? ""),
      provider: res.provider,
      model: res.model,
      status: res.status,
      url: res.url ?? null,
      filePath: res.filePath ?? null,
      mimeType: res.mimeType ?? "",
      bytes: res.bytes ?? null,
      error: res.error ?? null,
      metadata: { mode: res.mode, durationSec: Number(shot.durationSec ?? 5) },
    });
    await recordUsage({
      jobId,
      stepKey: "visual_assets",
      kind: "image",
      provider: res.provider,
      model: res.model,
      generations: res.status === "generated" ? 1 : 0,
      costMicroUsd: res.costMicroUsd ?? 0,
      durationMs: Date.now() - started,
      success: res.status === "generated",
    });
    if (res.status === "generated") generated += 1;
    if (res.mode === "real_ai") realAi += 1;
    results.push({ sceneNumber, status: res.status, provider: res.provider, url: res.url, error: res.error });
  }

  if (generated === 0) throw new Error("No scene images could be produced");

  return {
    output: {
      scenes: results,
      generated,
      expected: shots.length,
      realAiCount: realAi,
      note:
        realAi === 0
          ? "Images rendered locally (no image-generation API configured) — these are template frames, not AI imagery."
          : `${realAi}/${shots.length} scenes generated by an AI image provider.`,
    },
    provider: results[0]?.provider ? String(results[0].provider) : "local-svg",
    mode: realAi === shots.length ? "real_ai" : realAi > 0 ? "fallback" : "fallback",
  };
}

async function runNarration(jobId: string, ctx: StepContext): Promise<MediaStepResult> {
  const sections = (ctx.prior.script?.sections as ScriptSection[] | undefined) ?? [];
  const text = sections.map((s) => s.narration).join("\n\n");
  const plan = composeNarrationPlan(ctx);
  if (!text.trim()) throw new Error("narration requires a script");

  const started = Date.now();
  const res = await generateNarration(jobId, text, {
    voice: ctx.settings.narrationVoice,
    speed: ctx.settings.pacing === "fast" ? 1.1 : ctx.settings.pacing === "slow" ? 0.9 : 1,
    style: ctx.settings.tone,
    language: ctx.settings.language,
  });

  await db.delete(productionAssets).where(and(eq(productionAssets.jobId, jobId), eq(productionAssets.kind, "audio")));
  await db.insert(productionAssets).values({
    jobId,
    stepKey: "narration",
    kind: "audio",
    prompt: text.slice(0, 500),
    provider: res.provider,
    model: res.model,
    status: res.status,
    url: res.url ?? null,
    filePath: res.filePath ?? null,
    mimeType: res.mimeType ?? "",
    bytes: res.bytes ?? null,
    durationSec: res.durationSec ?? null,
    error: res.error ?? null,
    metadata: { mode: res.mode },
  });
  await recordUsage({
    jobId,
    stepKey: "narration",
    kind: "audio",
    provider: res.provider,
    model: res.model,
    generations: res.status === "generated" ? 1 : 0,
    costMicroUsd: res.costMicroUsd ?? 0,
    durationMs: Date.now() - started,
    success: res.status === "generated",
  });

  if (res.status === "failed") throw new Error(res.error ?? "narration failed");

  return {
    output: {
      ...plan,
      status: res.status,
      audioUrl: res.url ?? null,
      durationSec: res.durationSec ?? null,
      provider: res.provider,
      unavailableReason: res.status === "unavailable" ? res.error : null,
    },
    provider: res.provider,
    mode: res.mode,
  };
}

async function runCaptions(jobId: string, ctx: StepContext): Promise<MediaStepResult> {
  const sections = (ctx.prior.script?.sections as ScriptSection[] | undefined) ?? [];
  if (sections.length === 0) throw new Error("captions require a script");
  const cues = buildCaptionCues(sections, ctx.settings.wordsPerCue);
  const { srtPath, vttPath, vttUrl } = await writeCaptionFiles(jobId, cues);

  await db.delete(productionAssets).where(and(eq(productionAssets.jobId, jobId), eq(productionAssets.kind, "captions")));
  await db.insert(productionAssets).values({
    jobId,
    stepKey: "captions",
    kind: "captions",
    provider: "local-timing",
    model: "cue-splitter-v1",
    status: "generated",
    url: vttUrl,
    filePath: vttPath,
    mimeType: "text/vtt",
    metadata: { cues: cues.length, style: ctx.settings.captionStyle, srtPath },
  });

  return {
    output: {
      cueCount: cues.length,
      style: ctx.settings.captionStyle,
      wordsPerCue: ctx.settings.wordsPerCue,
      vttUrl,
      srtPath,
      cues: cues.slice(0, 40),
    },
    provider: "local-timing:cue-splitter-v1",
    mode: "fallback",
  };
}

async function runAssembly(jobId: string, ctx: StepContext): Promise<MediaStepResult> {
  const images = await db
    .select()
    .from(productionAssets)
    .where(and(eq(productionAssets.jobId, jobId), eq(productionAssets.kind, "image")))
    .orderBy(asc(productionAssets.sceneNumber));
  const usable = images.filter((i) => i.status === "generated" && i.filePath);
  if (usable.length === 0) throw new Error("assembly requires generated scene images");

  const [audio] = await db
    .select()
    .from(productionAssets)
    .where(and(eq(productionAssets.jobId, jobId), eq(productionAssets.kind, "audio")));
  const [caps] = await db
    .select()
    .from(productionAssets)
    .where(and(eq(productionAssets.jobId, jobId), eq(productionAssets.kind, "captions")));

  const sections = (ctx.prior.script?.sections as ScriptSection[] | undefined) ?? [];
  const scenes = usable.map((img, i) => ({
    filePath: img.filePath!,
    durationSec: Number((img.metadata as Record<string, unknown>)?.durationSec ?? sections[i]?.durationSec ?? 5),
  }));

  const vertical = String(ctx.prior.visual_plan?.aspectRatio ?? "9:16") !== "16:9";
  const started = Date.now();
  const res = await renderVideo(jobId, scenes, {
    width: vertical ? 1080 : 1920,
    height: vertical ? 1920 : 1080,
    audioPath: audio?.status === "generated" ? audio.filePath ?? undefined : undefined,
    srtPath: (caps?.metadata as Record<string, unknown>)?.srtPath as string | undefined,
  });

  await db.delete(productionAssets).where(and(eq(productionAssets.jobId, jobId), eq(productionAssets.kind, "video")));
  await db.insert(productionAssets).values({
    jobId,
    stepKey: "assembly",
    kind: "video",
    provider: res.provider,
    model: res.model,
    status: res.status,
    url: res.url ?? null,
    filePath: res.filePath ?? null,
    mimeType: res.mimeType ?? "",
    bytes: res.bytes ?? null,
    durationSec: res.durationSec ?? null,
    error: res.error ?? null,
    metadata: { scenes: scenes.length, hasAudio: audio?.status === "generated", burnedCaptions: Boolean(caps) },
  });
  await recordUsage({
    jobId,
    stepKey: "assembly",
    kind: "video",
    provider: res.provider,
    model: res.model,
    generations: res.status === "generated" ? 1 : 0,
    costMicroUsd: res.costMicroUsd ?? 0,
    durationMs: Date.now() - started,
    success: res.status === "generated",
  });

  if (res.status !== "generated") throw new Error(res.error ?? "video render failed");

  return {
    output: {
      videoUrl: res.url,
      durationSec: res.durationSec,
      bytes: res.bytes,
      scenes: scenes.length,
      hasNarration: audio?.status === "generated",
      burnedCaptions: Boolean(caps),
      renderer: `${res.provider}:${res.model}`,
      musicCue: ctx.settings.musicCue || null,
      aspectRatio: vertical ? "9:16" : "16:9",
    },
    provider: `${res.provider}:${res.model}`,
    mode: "real_ai",
  };
}

async function runQualityCheck(jobId: string, ctx: StepContext): Promise<MediaStepResult> {
  const assets = await db.select().from(productionAssets).where(eq(productionAssets.jobId, jobId));
  const shots = (ctx.prior.visual_plan?.shots as unknown[] | undefined) ?? [];
  const report = evaluateQuality({
    ctx,
    assets: {
      images: assets.filter((a) => a.kind === "image" && a.status === "generated").length,
      imagesExpected: shots.length,
      audio: assets.some((a) => a.kind === "audio" && a.status === "generated"),
      captions: assets.some((a) => a.kind === "captions" && a.status === "generated"),
      video: assets.some((a) => a.kind === "video" && a.status === "generated"),
    },
  });
  return { output: report, provider: "qc-evaluator:v2", mode: "fallback" };
}

/* --------------------------- job execution ------------------------- */

export async function runProductionJob(
  jobId: string,
  opts: { maxSteps?: number; trigger?: string } = {},
): Promise<RunResult> {
  const { maxSteps = 20, trigger = "manual" } = opts;
  const [job] = await db.select().from(productionJobs).where(eq(productionJobs.id, jobId));
  if (!job)
    return { jobId, status: "missing", stepsRun: 0, stepsFailed: 0, provider: "", errors: ["job not found"] };

  const result: RunResult = {
    jobId,
    status: job.status,
    stepsRun: 0,
    stepsFailed: 0,
    provider: productionProviderLabel(),
    errors: [],
  };
  if (job.status === "completed" || job.status === "cancelled") return { ...result, status: job.status };

  const [run] = await db
    .insert(agentRuns)
    .values({ agentSlug: "video-director", jobType: "content_production", trigger })
    .returning();

  await db
    .update(productionJobs)
    .set({
      status: "running",
      startedAt: job.startedAt ?? new Date(),
      attempts: job.attempts + 1,
      provider: result.provider,
      lastError: null,
      updatedAt: new Date(),
    })
    .where(eq(productionJobs.id, jobId));

  const stepRows = await db
    .select()
    .from(productionSteps)
    .where(eq(productionSteps.jobId, jobId))
    .orderBy(asc(productionSteps.position));
  const prior: Record<string, Record<string, unknown>> = {};
  for (const s of stepRows) if (s.status === "success") prior[s.stepKey] = s.output;

  const [draftRow] = await db.select().from(contentDrafts).where(eq(contentDrafts.jobId, jobId));
  const revisionNote = draftRow?.status === "changes_requested" ? draftRow.reviewNotes ?? undefined : undefined;

  let finalStatus = "running";
  const modes: GenerationMode[] = [];

  for (const step of stepRows) {
    if (result.stepsRun >= maxSteps) break;
    if (step.status === "success" || step.status === "skipped") continue;

    const def = productionStepDef(step.stepKey);

    if (step.stepKey === "review") {
      await db
        .update(productionSteps)
        .set({ status: "running", startedAt: new Date() })
        .where(eq(productionSteps.id, step.id));
      await db
        .update(contentDrafts)
        .set({ status: "ready_for_review", updatedAt: new Date() })
        .where(eq(contentDrafts.jobId, jobId));
      finalStatus = "awaiting_review";
      break;
    }

    const startedAt = Date.now();
    const ctx = await buildContext(job, prior, revisionNote);
    const stepInput = {
      story: ctx.story,
      settings: ctx.settings,
      consumes: Object.keys(prior),
      revisionNote: ctx.revisionNote ?? null,
    };

    await db
      .update(productionSteps)
      .set({
        status: "running",
        startedAt: new Date(),
        attempts: step.attempts + 1,
        input: stepInput,
        error: null,
      })
      .where(eq(productionSteps.id, step.id));
    await db
      .update(productionJobs)
      .set({ currentStep: step.stepKey, updatedAt: new Date() })
      .where(eq(productionJobs.id, jobId));
    await db
      .update(content)
      .set({ stage: def.contentStage, updatedAt: new Date() })
      .where(eq(content.id, job.contentId));
    await db
      .update(agents)
      .set({ status: "running", currentTask: `${def.label} — job ${jobId.slice(0, 8)}` })
      .where(eq(agents.slug, def.agentSlug));

    try {
      let output: Record<string, unknown>;
      let provider: string;
      let mode: GenerationMode;

      if (step.stepKey === "visual_assets") ({ output, provider, mode } = await runVisualAssets(jobId, ctx));
      else if (step.stepKey === "narration") ({ output, provider, mode } = await runNarration(jobId, ctx));
      else if (step.stepKey === "captions") ({ output, provider, mode } = await runCaptions(jobId, ctx));
      else if (step.stepKey === "assembly") ({ output, provider, mode } = await runAssembly(jobId, ctx));
      else if (step.stepKey === "quality_check") ({ output, provider, mode } = await runQualityCheck(jobId, ctx));
      else {
        const res = await executeStep(step.stepKey, ctx);
        output = res.output;
        provider = res.provider;
        mode = res.mode;
        if (res.usage) {
          await recordUsage({
            jobId,
            stepKey: step.stepKey,
            kind: "text",
            provider: provider.split(":")[0],
            model: provider.split(":")[1] ?? "",
            promptTokens: res.usage.promptTokens,
            completionTokens: res.usage.completionTokens,
            costMicroUsd: res.usage.costMicroUsd,
            durationMs: Date.now() - startedAt,
            success: true,
          });
        }
      }

      prior[step.stepKey] = output;
      modes.push(mode);

      await db
        .update(productionSteps)
        .set({
          status: "success",
          output,
          provider,
          generationMode: mode,
          finishedAt: new Date(),
          durationMs: Date.now() - startedAt,
          error: null,
        })
        .where(eq(productionSteps.id, step.id));

      await applyToDraft(jobId, step.stepKey, output);
      await syncProgress(jobId);

      await db
        .update(agents)
        .set({
          status: "idle",
          currentTask: null,
          lastTask: `${def.label} complete — ${ctx.story.title.slice(0, 50)}`,
          lastTaskStatus: "success",
          lastRunAt: new Date(),
          totalRuns: sql`${agents.totalRuns} + 1`,
        })
        .where(eq(agents.slug, def.agentSlug));

      result.stepsRun += 1;
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      result.stepsFailed += 1;
      result.errors.push(`${step.stepKey}: ${message}`);
      await db
        .update(productionSteps)
        .set({
          status: "failed",
          generationMode: "failed",
          error: message.slice(0, 500),
          finishedAt: new Date(),
          durationMs: Date.now() - startedAt,
        })
        .where(eq(productionSteps.id, step.id));
      await db
        .update(agents)
        .set({
          status: "error",
          currentTask: null,
          lastTask: `${def.label} failed — ${message.slice(0, 70)}`,
          lastTaskStatus: "failure",
          lastRunAt: new Date(),
          failedRuns: sql`${agents.failedRuns} + 1`,
        })
        .where(eq(agents.slug, def.agentSlug));
      finalStatus = "failed";
      break;
    }
  }

  if (finalStatus === "running") {
    const remaining = await db
      .select({ id: productionSteps.id })
      .from(productionSteps)
      .where(
        and(
          eq(productionSteps.jobId, jobId),
          inArray(productionSteps.status, ["pending", "running", "failed"]),
        ),
      );
    finalStatus = remaining.length === 0 ? "completed" : "running";
  }

  await syncProgress(jobId);

  // Draft-level generation mode: real_ai only if no fallback was used.
  const allSteps = await db.select().from(productionSteps).where(eq(productionSteps.jobId, jobId));
  const done = allSteps.filter((s) => s.status === "success" && s.stepKey !== "review");
  const anyReal = done.some((s) => s.generationMode === "real_ai");
  const anyFallback = done.some((s) => s.generationMode === "fallback");
  const draftMode = anyReal && anyFallback ? "mixed" : anyReal ? "real_ai" : "fallback";

  await db
    .update(contentDrafts)
    .set({ generationMode: draftMode, provider: productionProviderLabel(), updatedAt: new Date() })
    .where(eq(contentDrafts.jobId, jobId));

  await db
    .update(productionJobs)
    .set({
      status: finalStatus,
      lastError: result.errors[0]?.slice(0, 500) ?? null,
      completedAt: finalStatus === "completed" ? new Date() : null,
      updatedAt: new Date(),
    })
    .where(eq(productionJobs.id, jobId));

  if (finalStatus === "completed") {
    await db
      .update(contentDrafts)
      .set({ status: "ready_for_review", updatedAt: new Date() })
      .where(eq(contentDrafts.jobId, jobId));
  }

  await db
    .update(agentRuns)
    .set({
      status: finalStatus === "failed" ? "failed" : "success",
      finishedAt: new Date(),
      durationMs: Date.now() - +new Date(run.startedAt),
      stats: { jobId, stepsRun: result.stepsRun, stepsFailed: result.stepsFailed, status: finalStatus, draftMode },
      error: result.errors[0] ?? null,
    })
    .where(eq(agentRuns.id, run.id));

  await db.insert(automationJobs).values({
    type: "content_production",
    label: `Production · job ${jobId.slice(0, 8)} → ${finalStatus.replace(/_/g, " ")}`,
    status: finalStatus === "failed" ? "failed" : "success",
    trigger,
    attempts: job.attempts + 1,
    scheduledAt: new Date(),
    startedAt: new Date(),
    finishedAt: new Date(),
    lastError: result.errors[0]?.slice(0, 400) ?? null,
    payload: { jobId, stepsRun: result.stepsRun, stepsFailed: result.stepsFailed, draftMode },
  });

  result.status = finalStatus;
  console.log(
    `[production] job ${jobId.slice(0, 8)} → ${finalStatus} (ran ${result.stepsRun}, failed ${result.stepsFailed}, mode ${draftMode})`,
  );
  return result;
}

/* ----------------------------- controls ---------------------------- */

export async function retryProductionJob(jobId: string): Promise<RunResult> {
  await db
    .update(productionSteps)
    .set({ status: "pending", error: null })
    .where(and(eq(productionSteps.jobId, jobId), eq(productionSteps.status, "failed")));
  await db
    .update(productionJobs)
    .set({ status: "queued", lastError: null, updatedAt: new Date() })
    .where(eq(productionJobs.id, jobId));
  return runProductionJob(jobId, { trigger: "retry" });
}

export type ApproveResult = { ok: boolean; error?: string };

/** Human sign-off. Blocked when QC reported a critical finding. */
export async function approveDraft(
  jobId: string,
  notes?: string,
  opts: { override?: boolean } = {},
): Promise<ApproveResult> {
  const [job] = await db.select().from(productionJobs).where(eq(productionJobs.id, jobId));
  if (!job) return { ok: false, error: "Job not found" };
  const [draft] = await db.select().from(contentDrafts).where(eq(contentDrafts.jobId, jobId));
  if (!draft) return { ok: false, error: "Draft not found" };

  // Gate 1: every non-review step must have finished successfully.
  const allSteps = await db.select().from(productionSteps).where(eq(productionSteps.jobId, jobId));
  const unfinished = allSteps.filter(
    (s) => s.stepKey !== "review" && s.status !== "success" && s.status !== "skipped",
  );
  if (unfinished.length > 0 && !opts.override) {
    return {
      ok: false,
      error: `Approval blocked: ${unfinished.length} step(s) not complete (${unfinished
        .map((s) => `${s.stepKey}:${s.status}`)
        .join(", ")}).`,
    };
  }

  // Gate 2: quality control must actually have run.
  const qcStep = allSteps.find((s) => s.stepKey === "quality_check");
  const qc = (draft.qcReport ?? {}) as Record<string, unknown>;
  if (qcStep && qcStep.status !== "success" && !opts.override) {
    return { ok: false, error: "Approval blocked: quality check has not completed." };
  }
  if (qcStep && Object.keys(qc).length === 0 && !opts.override) {
    return { ok: false, error: "Approval blocked: no QC report is attached to this draft." };
  }

  // Gate 3: QC critical findings block automatic approval.
  if (qc.blocksApproval === true && !opts.override) {
    return {
      ok: false,
      error: `Approval blocked: QC reported ${Number(qc.criticalCount ?? 0)} critical finding(s). Resolve them or approve with override.`,
    };
  }

  const reviewStep = allSteps.find((s) => s.stepKey === "review");
  if (reviewStep) {
    await db
      .update(productionSteps)
      .set({
        status: "success",
        provider: "human:operator",
        generationMode: "human",
        output: {
          approved: true,
          notes: notes ?? "",
          override: Boolean(opts.override),
          qcScore: draft.qcScore,
          at: new Date().toISOString(),
        },
        finishedAt: new Date(),
        durationMs: reviewStep.startedAt ? Date.now() - +new Date(reviewStep.startedAt) : 0,
        attempts: Math.max(1, reviewStep.attempts),
        error: null,
      })
      .where(eq(productionSteps.id, reviewStep.id));
  }

  await syncProgress(jobId);
  await db
    .update(productionJobs)
    .set({ status: "completed", completedAt: new Date(), updatedAt: new Date() })
    .where(eq(productionJobs.id, jobId));
  await db
    .update(contentDrafts)
    .set({ status: "approved", reviewNotes: notes ?? null, updatedAt: new Date() })
    .where(eq(contentDrafts.jobId, jobId));
  await db
    .update(content)
    .set({ stage: "qc", updatedAt: new Date() })
    .where(eq(content.id, job.contentId));
  return { ok: true };
}

export async function rejectDraft(jobId: string, notes: string) {
  await db
    .update(productionJobs)
    .set({ status: "cancelled", updatedAt: new Date() })
    .where(eq(productionJobs.id, jobId));
  await db
    .update(contentDrafts)
    .set({ status: "rejected", reviewNotes: notes, updatedAt: new Date() })
    .where(eq(contentDrafts.jobId, jobId));
}

/** Map a free-text revision request to the earliest step to re-run. */
export function inferRevisionTarget(note: string): string {
  const n = note.toLowerCase();
  if (/(visual|shot|footage|image|b-roll|scene)/.test(n)) return "visual_plan";
  if (/(voice|narration|audio|vo\b|read)/.test(n)) return "narration";
  if (/(caption|subtitle)/.test(n)) return "captions";
  if (/(render|assembly|video|edit|timing)/.test(n)) return "assembly";
  if (/(hook|angle|concept|premise|idea)/.test(n)) return "concept";
  if (/(fact|accuracy|source|claim|verify)/.test(n)) return "research";
  return "script";
}

/**
 * Targeted revision: snapshot the current draft, then reset only the
 * target step and everything after it. Earlier work is preserved.
 */
export async function requestDraftChanges(jobId: string, notes: string, targetStepInput?: string) {
  const [draft] = await db.select().from(contentDrafts).where(eq(contentDrafts.jobId, jobId));
  const target = targetStepInput && targetStepInput !== "auto" ? targetStepInput : inferRevisionTarget(notes);
  const nextRevision = (draft?.revision ?? 0) + 1;

  if (draft) {
    await db.insert(draftRevisions).values({
      jobId,
      revision: nextRevision,
      targetStep: target,
      reason: notes,
      requestedBy: "operator",
      snapshot: {
        title: draft.title,
        hook: draft.hook,
        angle: draft.angle,
        sections: draft.sections,
        scriptBody: draft.scriptBody,
        visualPlan: draft.visualPlan,
        qcScore: draft.qcScore,
        qcReport: draft.qcReport,
        videoUrl: draft.videoUrl,
        audioUrl: draft.audioUrl,
        generationMode: draft.generationMode,
        savedAt: new Date().toISOString(),
      },
    });
  }

  const targetIdx = PRODUCTION_STEP_ORDER.indexOf(target as (typeof PRODUCTION_STEP_ORDER)[number]);
  const toReset = PRODUCTION_STEP_ORDER.filter((k, i) => i >= targetIdx || k === "review");

  await db
    .update(productionSteps)
    .set({ status: "pending", error: null })
    .where(and(eq(productionSteps.jobId, jobId), inArray(productionSteps.stepKey, [...toReset])));

  await db
    .update(contentDrafts)
    .set({
      status: "changes_requested",
      reviewNotes: notes,
      revision: nextRevision,
      updatedAt: new Date(),
    })
    .where(eq(contentDrafts.jobId, jobId));

  await syncProgress(jobId);
  await db
    .update(productionJobs)
    .set({ status: "queued", currentStep: target, updatedAt: new Date() })
    .where(eq(productionJobs.id, jobId));

  console.log(`[production] revision ${nextRevision} on job ${jobId.slice(0, 8)} → rewind to "${target}"`);
  return { revision: nextRevision, targetStep: target };
}

/* --------------------------- queue runner -------------------------- */

export async function advanceProductionQueue(
  limit = 3,
  trigger = "schedule",
): Promise<{ created: number; ran: RunResult[] }> {
  const created = await ensureProductionJobsForSelected();
  const pending = await db
    .select()
    .from(productionJobs)
    .where(inArray(productionJobs.status, ["queued", "running"]))
    .orderBy(asc(productionJobs.createdAt))
    .limit(limit);

  const ran: RunResult[] = [];
  for (const job of pending) {
    try {
      ran.push(await runProductionJob(job.id, { trigger }));
    } catch (err) {
      console.error(`[production] job ${job.id} crashed`, err);
      ran.push({
        jobId: job.id,
        status: "failed",
        stepsRun: 0,
        stepsFailed: 1,
        provider: productionProviderLabel(),
        errors: [err instanceof Error ? err.message : String(err)],
      });
    }
  }
  return { created, ran };
}

/* ------------------------------ reads ------------------------------ */

export async function latestProductionRun() {
  const [row] = await db
    .select()
    .from(agentRuns)
    .where(eq(agentRuns.jobType, "content_production"))
    .orderBy(desc(agentRuns.createdAt))
    .limit(1);
  return row ?? null;
}

export { PRODUCTION_STEPS, mediaProviderSummary };

/* ------------------------------------------------------------------ */
/*  Operator draft editing (Phase 5)                                   */
/*                                                                     */
/*  Manual edits never silently overwrite generated content: each save */
/*  snapshots the prior draft into draft_revisions, records exactly    */
/*  which fields changed, and marks them as human-edited so later      */
/*  regeneration can respect them.                                     */
/* ------------------------------------------------------------------ */

export type DraftEditInput = {
  title?: string;
  hook?: string;
  scriptBody?: string;
  cta?: string;
  socialCaption?: string;
  description?: string;
  hashtags?: string[];
};

export const EDITABLE_FIELDS: (keyof DraftEditInput)[] = [
  "title",
  "hook",
  "scriptBody",
  "cta",
  "socialCaption",
  "description",
  "hashtags",
];

export async function saveDraftEdits(
  jobId: string,
  input: DraftEditInput,
  reason = "Manual operator edit",
): Promise<{ ok: boolean; changed: string[]; revision: number; error?: string }> {
  const [draft] = await db.select().from(contentDrafts).where(eq(contentDrafts.jobId, jobId));
  if (!draft) return { ok: false, changed: [], revision: 0, error: "Draft not found" };

  const changed: string[] = [];
  const patch: Partial<typeof contentDrafts.$inferInsert> = {};
  for (const field of EDITABLE_FIELDS) {
    const next = input[field];
    if (next === undefined) continue;
    const current = (draft as unknown as Record<string, unknown>)[field];
    const same =
      Array.isArray(next) && Array.isArray(current)
        ? JSON.stringify(next) === JSON.stringify(current)
        : String(next ?? "") === String(current ?? "");
    if (same) continue;
    changed.push(field);
    (patch as Record<string, unknown>)[field] = next;
  }
  if (changed.length === 0) return { ok: true, changed: [], revision: draft.revision };

  const nextRevision = draft.revision + 1;
  await db.insert(draftRevisions).values({
    jobId,
    revision: nextRevision,
    targetStep: "manual",
    kind: "manual_edit",
    changedFields: changed,
    reason,
    requestedBy: "operator",
    snapshot: {
      title: draft.title,
      hook: draft.hook,
      scriptBody: draft.scriptBody,
      cta: draft.cta,
      socialCaption: draft.socialCaption,
      description: draft.description,
      hashtags: draft.hashtags,
      sections: draft.sections,
      qcScore: draft.qcScore,
      generationMode: draft.generationMode,
      savedAt: new Date().toISOString(),
    },
  });

  const editedFields = Array.from(new Set([...(draft.editedFields ?? []), ...changed]));
  await db
    .update(contentDrafts)
    .set({ ...patch, editedFields, revision: nextRevision, updatedAt: new Date() })
    .where(eq(contentDrafts.jobId, jobId));

  console.log(`[production] draft edit on job ${jobId.slice(0, 8)}: ${changed.join(", ")}`);
  return { ok: true, changed, revision: nextRevision };
}

/** Restore a previous revision snapshot (itself recorded as a revision). */
export async function restoreDraftRevision(
  jobId: string,
  revisionId: string,
): Promise<{ ok: boolean; error?: string; revision?: number }> {
  const [rev] = await db.select().from(draftRevisions).where(eq(draftRevisions.id, revisionId));
  if (!rev || rev.jobId !== jobId) return { ok: false, error: "Revision not found for this job" };
  const [draft] = await db.select().from(contentDrafts).where(eq(contentDrafts.jobId, jobId));
  if (!draft) return { ok: false, error: "Draft not found" };

  const snap = rev.snapshot as Record<string, unknown>;
  const nextRevision = draft.revision + 1;

  // snapshot current state first so a restore is itself reversible
  await db.insert(draftRevisions).values({
    jobId,
    revision: nextRevision,
    targetStep: "manual",
    kind: "restore",
    changedFields: ["restored_from"],
    reason: `Restored revision v${rev.revision}`,
    requestedBy: "operator",
    snapshot: {
      title: draft.title,
      hook: draft.hook,
      scriptBody: draft.scriptBody,
      cta: draft.cta,
      socialCaption: draft.socialCaption,
      description: draft.description,
      hashtags: draft.hashtags,
      sections: draft.sections,
      qcScore: draft.qcScore,
      savedAt: new Date().toISOString(),
    },
  });

  const patch: Partial<typeof contentDrafts.$inferInsert> = { revision: nextRevision, updatedAt: new Date() };
  if (typeof snap.title === "string") patch.title = snap.title;
  if (typeof snap.hook === "string") patch.hook = snap.hook;
  if (typeof snap.scriptBody === "string") patch.scriptBody = snap.scriptBody;
  if (typeof snap.cta === "string") patch.cta = snap.cta;
  if (typeof snap.socialCaption === "string") patch.socialCaption = snap.socialCaption;
  if (typeof snap.description === "string") patch.description = snap.description;
  if (Array.isArray(snap.hashtags)) patch.hashtags = snap.hashtags as string[];
  if (Array.isArray(snap.sections)) patch.sections = snap.sections as ScriptSection[];

  await db.update(contentDrafts).set(patch).where(eq(contentDrafts.jobId, jobId));
  return { ok: true, revision: nextRevision };
}
