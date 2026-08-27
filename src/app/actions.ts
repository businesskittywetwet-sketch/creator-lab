"use server";

import { revalidatePath } from "next/cache";
import { db } from "@/db";
import { channels } from "@/db/schema";
import { eq } from "drizzle-orm";
import * as engine from "@/engine";
import { seedDatabase } from "@/db/seed";
import { requireUserId } from "@/lib/supabase/server";

export type ActionState = { ok: boolean; error?: string };

function slugify(name: string): string {
  return name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/(^-|-$)/g, "");
}

/* ------------------------------ channels -------------------------- */

function channelInputFrom(formData: FormData) {
  const platforms = formData
    .getAll("platforms")
    .map((p) => String(p).trim())
    .filter(Boolean);
  return {
    name: String(formData.get("name") ?? "").trim(),
    niche: String(formData.get("niche") ?? "").trim(),
    description: String(formData.get("description") ?? "").trim(),
    contentStyle: String(formData.get("contentStyle") ?? "").trim(),
    targetAudience: String(formData.get("targetAudience") ?? "").trim(),
    postingFrequency: String(formData.get("postingFrequency") ?? "").trim(),
    preferredLength: String(formData.get("preferredLength") ?? "").trim(),
    voiceTone: String(formData.get("voiceTone") ?? "").trim(),
    color: String(formData.get("color") ?? "#C6F135"),
    targetPlatforms: platforms.length ? platforms : ["youtube"],
  };
}

export async function createChannel(
  _prev: ActionState,
  formData: FormData,
): Promise<ActionState> {
  try {
    const input = channelInputFrom(formData);
    if (!input.name) return { ok: false, error: "Channel name is required." };
    const userId = await requireUserId();
    const slug = `${slugify(input.name)}-${Math.random().toString(36).slice(2, 6)}`;
    await db.insert(channels).values({ ...input, slug, userId });
    revalidatePath("/channels");
    revalidatePath("/overview");
    return { ok: true };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : "Failed to create channel." };
  }
}

export async function updateChannel(
  _prev: ActionState,
  formData: FormData,
): Promise<ActionState> {
  try {
    const id = String(formData.get("id") ?? "");
    if (!id) return { ok: false, error: "Missing channel id." };
    const input = channelInputFrom(formData);
    if (!input.name) return { ok: false, error: "Channel name is required." };
    await db.update(channels).set(input).where(eq(channels.id, id));
    revalidatePath("/channels");
    revalidatePath("/overview");
    return { ok: true };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : "Failed to update channel." };
  }
}

export async function toggleChannel(id: string, currentlyActive: boolean) {
  await db.update(channels).set({ active: !currentlyActive }).where(eq(channels.id, id));
  revalidatePath("/channels");
  revalidatePath("/overview");
}

export async function deleteChannel(id: string) {
  await db.delete(channels).where(eq(channels.id, id));
  revalidatePath("/channels");
  revalidatePath("/overview");
}

/* ------------------------------ content --------------------------- */

export async function moveContent(id: string, direction: 1 | -1) {
  await engine.moveContent(id, direction);
  revalidatePath("/queue");
  revalidatePath("/overview");
  revalidatePath("/published");
}

export async function advanceStoryToContent(storyId: string) {
  // Promote a discovered story into the pipeline at "selected".
  const { stories, content } = await import("@/db/schema");
  const userId = await requireUserId();
  const [story] = await db.select().from(stories).where(eq(stories.id, storyId));
  if (!story || !story.channelId) return;
  await db.insert(content).values({
    userId,
    channelId: story.channelId,
    storyId: story.id,
    title: story.title,
    stage: "selected",
    score: story.score,
    assignedAgents: ["story-judge"],
    scheduledAt: null,
  });
  await db.update(stories).set({ status: "selected" }).where(eq(stories.id, storyId));
  revalidatePath("/stories");
  revalidatePath("/queue");
  revalidatePath("/overview");
}

/* ------------------------------ automation ------------------------ */

export async function toggleAutomation(enabled: boolean) {
  await engine.setAutomationEnabled(enabled);
  revalidatePath("/automation");
  revalidatePath("/overview");
}

export async function saveAutomationConfig(
  _prev: ActionState,
  formData: FormData,
): Promise<ActionState> {
  try {
    await engine.updateAutomationConfig({
      discoveryIntervalHours: Number(formData.get("discoveryIntervalHours") ?? 6),
      publishWindowStart: String(formData.get("publishWindowStart") ?? "09:00"),
      publishWindowEnd: String(formData.get("publishWindowEnd") ?? "21:00"),
      dailyPublishCap: Number(formData.get("dailyPublishCap") ?? 8),
      maxConcurrentJobs: Number(formData.get("maxConcurrentJobs") ?? 3),
      autoRetry: formData.get("autoRetry") === "on",
      timezone: String(formData.get("timezone") ?? "UTC"),
      judgeThreshold: Number(formData.get("judgeThreshold") ?? 72),
      scoutMaxStoriesPerRun: Number(formData.get("scoutMaxStoriesPerRun") ?? 20),
      retryDelayMinutes: Number(formData.get("retryDelayMinutes") ?? 15),
    });
    revalidatePath("/automation");
    return { ok: true };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : "Failed to save." };
  }
}

export async function runDiscoveryNow() {
  try {
    await engine.runScoutCycle("manual");
  } catch (err) {
    console.error("scout cycle failed", err);
  }
  revalidatePath("/automation");
  revalidatePath("/stories");
  revalidatePath("/overview");
  revalidatePath("/agents");
  revalidatePath("/queue");
}

export async function retryAutomationJob(id: string) {
  await engine.retryAutomationJob(id);
  revalidatePath("/automation");
  revalidatePath("/overview");
}

export async function retryPublishingJob(id: string) {
  await engine.retryPublishingJob(id);
  revalidatePath("/automation");
  revalidatePath("/queue");
  revalidatePath("/published");
}

/* ------------------------------ agents ---------------------------- */

export async function setAgentStatus(id: string, status: string) {
  await engine.setAgentStatus(id, status);
  revalidatePath("/agents");
  revalidatePath("/overview");
}

/* ---------------------------- production -------------------------- */

function revalidateProduction() {
  revalidatePath("/production");
  revalidatePath("/queue");
  revalidatePath("/overview");
  revalidatePath("/agents");
}

export async function runProductionJobAction(jobId: string) {
  try {
    await engine.runProductionJob(jobId, { trigger: "manual" });
  } catch (err) {
    console.error("production run failed", err);
  }
  revalidateProduction();
  revalidatePath(`/production/${jobId}`);
}

export async function retryProductionJobAction(jobId: string) {
  try {
    await engine.retryProductionJob(jobId);
  } catch (err) {
    console.error("production retry failed", err);
  }
  revalidateProduction();
  revalidatePath(`/production/${jobId}`);
}

export async function advanceProductionQueueAction() {
  try {
    await engine.advanceProductionQueue(3, "manual");
  } catch (err) {
    console.error("production queue failed", err);
  }
  revalidateProduction();
}

export async function approveDraftAction(
  jobId: string,
  formData?: FormData,
): Promise<ActionState> {
  const notes = formData ? String(formData.get("notes") ?? "") : "";
  const override = formData ? formData.get("override") === "true" : false;
  const res = await engine.approveDraft(jobId, notes || undefined, { override });
  revalidateProduction();
  revalidatePath(`/production/${jobId}`);
  return res.ok ? { ok: true } : { ok: false, error: res.error };
}

export async function rejectDraftAction(jobId: string, formData: FormData) {
  const notes = String(formData.get("notes") ?? "").trim();
  await engine.rejectDraft(jobId, notes || "Rejected by operator");
  revalidateProduction();
  revalidatePath(`/production/${jobId}`);
}

export async function requestChangesAction(jobId: string, formData: FormData) {
  const notes = String(formData.get("notes") ?? "").trim();
  const target = String(formData.get("targetStep") ?? "auto");
  await engine.requestDraftChanges(jobId, notes || "Changes requested by operator", target);
  revalidateProduction();
  revalidatePath(`/production/${jobId}`);
}

export async function saveProductionSettings(
  _prev: ActionState,
  formData: FormData,
): Promise<ActionState> {
  try {
    const channelId = String(formData.get("channelId") ?? "");
    if (!channelId) return { ok: false, error: "Missing channel." };
    const requiredSteps = formData.getAll("requiredSteps").map((s) => String(s));
    await engine.updateProductionSettings(channelId, {
      format: String(formData.get("format") ?? "Short"),
      targetDurationSec: Number(formData.get("targetDurationSec") ?? 55),
      scriptWordTarget: Number(formData.get("scriptWordTarget") ?? 140),
      tone: String(formData.get("tone") ?? ""),
      hookStyle: String(formData.get("hookStyle") ?? ""),
      ctaStyle: String(formData.get("ctaStyle") ?? ""),
      visualStyle: String(formData.get("visualStyle") ?? ""),
      narrationVoice: String(formData.get("narrationVoice") ?? "default"),
      researchDepth: Number(formData.get("researchDepth") ?? 4),
      sectionCount: Number(formData.get("sectionCount") ?? 4),
      writingStyle: String(formData.get("writingStyle") ?? "Punchy, concrete, no filler"),
      pacing: String(formData.get("pacing") ?? "fast"),
      minWordCount: Number(formData.get("minWordCount") ?? 90),
      maxWordCount: Number(formData.get("maxWordCount") ?? 200),
      language: String(formData.get("language") ?? "en"),
      captionStyle: String(formData.get("captionStyle") ?? "bold-centered"),
      wordsPerCue: Number(formData.get("wordsPerCue") ?? 4),
      speakingRate: Number(formData.get("speakingRate") ?? 150),
      musicCue: String(formData.get("musicCue") ?? ""),
      requiredSteps,
    });
    revalidatePath("/channels");
    revalidateProduction();
    return { ok: true };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : "Failed to save." };
  }
}

/* ------------------------------ system ---------------------------- */

export async function reseedDatabase(): Promise<void> {
  await seedDatabase();
  revalidatePath("/");
}

/* ==================================================================== */
/*  PHASE 5 — draft editing, publishing, analytics, notifications       */
/* ==================================================================== */

function revalidatePublishing() {
  revalidatePath("/publishing");
  revalidatePath("/calendar");
  revalidatePath("/overview");
  revalidatePath("/creator-analytics");
}

export async function saveDraftEditsAction(
  jobId: string,
  formData: FormData,
): Promise<ActionState> {
  const raw = String(formData.get("hashtags") ?? "");
  const hashtags = raw
    .split(/[\s,]+/)
    .map((t) => t.trim().replace(/^#/, ""))
    .filter(Boolean);
  const res = await engine.saveDraftEdits(jobId, {
    title: String(formData.get("title") ?? ""),
    hook: String(formData.get("hook") ?? ""),
    scriptBody: String(formData.get("scriptBody") ?? ""),
    cta: String(formData.get("cta") ?? ""),
    socialCaption: String(formData.get("socialCaption") ?? ""),
    description: String(formData.get("description") ?? ""),
    hashtags,
  });
  revalidatePath(`/production/${jobId}`);
  revalidateProduction();
  return res.ok
    ? { ok: true, error: res.changed.length ? undefined : "No changes to save." }
    : { ok: false, error: res.error };
}

export async function restoreRevisionAction(jobId: string, revisionId: string) {
  await engine.restoreDraftRevision(jobId, revisionId);
  revalidatePath(`/production/${jobId}`);
  revalidateProduction();
}

export async function preparePublishJobsAction(contentId: string): Promise<ActionState> {
  try {
    const res = await engine.createPublishJobsForContent(contentId);
    revalidatePublishing();
    if (res.created === 0) {
      return { ok: false, error: res.skipped[0] ?? "No publish jobs were created." };
    }
    return { ok: true };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : "Failed." };
  }
}

export async function publishNowAction(jobId: string): Promise<ActionState> {
  const res = await engine.dispatchPublishJob(jobId, { trigger: "manual" });
  revalidatePublishing();
  return res.ok ? { ok: true } : { ok: false, error: res.reason };
}

export async function retryPublishAction(jobId: string): Promise<ActionState> {
  const res = await engine.retryPublish(jobId);
  revalidatePublishing();
  return res.ok ? { ok: true } : { ok: false, error: res.reason };
}

export async function schedulePublishAction(
  jobId: string,
  formData: FormData,
): Promise<ActionState> {
  try {
    const when = String(formData.get("scheduledAt") ?? "");
    if (!when) return { ok: false, error: "Pick a date and time." };
    await engine.schedulePublishJob(jobId, new Date(when));
    revalidatePublishing();
    return { ok: true };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : "Invalid schedule." };
  }
}

export async function cancelPublishAction(jobId: string) {
  await engine.cancelPublishJob(jobId);
  revalidatePublishing();
}

export async function refreshAccountsAction() {
  await engine.refreshAllAccounts();
  revalidatePublishing();
}

export async function saveChannelStrategyAction(
  _prev: ActionState,
  formData: FormData,
): Promise<ActionState> {
  try {
    const channelId = String(formData.get("channelId") ?? "");
    if (!channelId) return { ok: false, error: "Missing channel." };
    const windows = String(formData.get("postingWindows") ?? "")
      .split(",").map((s) => s.trim()).filter(Boolean);
    const tags = String(formData.get("defaultHashtags") ?? "")
      .split(/[\s,]+/).map((s) => s.trim().replace(/^#/, "")).filter(Boolean);
    await engine.updateChannelStrategy(channelId, {
      postsPerWeek: Number(formData.get("postsPerWeek") ?? 5),
      postingWindows: windows.length ? windows : ["09:00", "18:00"],
      timezone: String(formData.get("timezone") ?? "UTC"),
      platforms: formData.getAll("platforms").map(String),
      hashtagStrategy: String(formData.get("hashtagStrategy") ?? ""),
      defaultHashtags: tags,
      requireApproval: formData.get("requireApproval") === "on",
      autoPublish: formData.get("autoPublish") === "on",
      minQcScore: Number(formData.get("minQcScore") ?? 60),
    });
    await engine.syncAccountsForChannel(channelId);
    revalidatePath("/channels");
    revalidatePublishing();
    return { ok: true };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : "Failed to save." };
  }
}

export async function syncAnalyticsAction(): Promise<ActionState> {
  try {
    const report = await engine.syncPostMetrics();
    await engine.computePerformanceSignals();
    revalidatePath("/creator-analytics");
    revalidatePath("/overview");
    if (report.synced === 0 && report.posts === 0) {
      return { ok: false, error: "No published posts yet — nothing to sync." };
    }
    if (report.synced === 0) {
      return { ok: false, error: report.reasons[0] ?? "No connected platform returned metrics." };
    }
    return { ok: true };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : "Sync failed." };
  }
}

export async function markNotificationsReadAction() {
  await engine.markAllRead();
  revalidatePath("/overview");
}

/* ==================================================================== */
/*  PHASE 6 — YouTube publishing + analytics                            */
/* ==================================================================== */

export async function disconnectYouTubeAction(channelId: string): Promise<ActionState> {
  const res = await engine.disconnectYouTube(channelId);
  revalidatePublishing();
  revalidatePath("/channels");
  return res.ok ? { ok: true } : { ok: false, error: res.detail };
}

export async function generateYouTubeMetadataAction(jobId: string): Promise<ActionState> {
  const res = await engine.buildYouTubeMetadata(jobId, { force: true });
  revalidatePath(`/production/${jobId}`);
  return res.ok ? { ok: true } : { ok: false, error: res.error };
}

export async function saveYouTubeSettingsAction(
  jobId: string,
  formData: FormData,
): Promise<ActionState> {
  try {
    const tags = String(formData.get("tags") ?? "")
      .split(/[\s,]+/)
      .map((t) => t.trim().replace(/^#/, ""))
      .filter(Boolean);
    await engine.saveYouTubeSettings(jobId, {
      title: String(formData.get("title") ?? ""),
      description: String(formData.get("description") ?? ""),
      tags,
      categoryId: String(formData.get("categoryId") ?? "24"),
      privacy: String(formData.get("privacy") ?? "private"),
    });
    revalidatePath(`/production/${jobId}`);
    revalidatePublishing();
    return { ok: true };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : "Failed to save." };
  }
}

export async function generateThumbnailAction(jobId: string): Promise<ActionState> {
  const res = await engine.createThumbnail(jobId);
  revalidatePath(`/production/${jobId}`);
  return res.ok ? { ok: true } : { ok: false, error: res.error };
}

export async function selectThumbnailAction(
  jobId: string,
  assetId: string,
): Promise<ActionState> {
  const res = await engine.selectThumbnail(jobId, assetId);
  revalidatePath(`/production/${jobId}`);
  return res.ok ? { ok: true } : { ok: false, error: res.error };
}

export async function refreshYouTubeAnalyticsAction(): Promise<ActionState> {
  try {
    const report = await engine.refreshYouTubeAnalytics();
    await engine.computePerformanceSignals();
    revalidatePath("/creator-analytics");
    if (report.posts === 0) {
      return { ok: false, error: "No YouTube posts published yet — nothing to refresh." };
    }
    if (report.refreshed === 0) {
      return { ok: false, error: report.reasons[0] ?? "No metrics could be retrieved." };
    }
    return { ok: true };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : "Refresh failed." };
  }
}

/* ==================================================================== */
/*  PHASE 7 — niches, durable queue, workers                            */
/* ==================================================================== */

function revalidateOps() {
  revalidatePath("/niches");
  revalidatePath("/workers");
  revalidatePath("/overview");
}

export async function createNicheAction(
  _prev: ActionState,
  formData: FormData,
): Promise<ActionState> {
  try {
    const list = (k: string) =>
      String(formData.get(k) ?? "")
        .split(/[\n,]+/)
        .map((s) => s.trim())
        .filter(Boolean);
    const weights: Record<string, number> = {};
    for (const key of [
      "viralPotential", "entertainmentValue", "channelRelevance", "visualPotential",
      "originality", "evergreenPotential", "sourceReliability",
    ]) {
      const v = formData.get(`w_${key}`);
      if (v !== null) weights[key] = Number(v) || 0;
    }
    const res = await engine.createNiche({
      name: String(formData.get("name") ?? ""),
      description: String(formData.get("description") ?? ""),
      color: String(formData.get("color") ?? "#C6F135"),
      scoutIntervalHours: Number(formData.get("scoutIntervalHours") ?? 6),
      maxCandidatesPerCycle: Number(formData.get("maxCandidatesPerCycle") ?? 20),
      keywords: list("keywords"),
      excludedKeywords: list("excludedKeywords"),
      judgeWeights: Object.keys(weights).length ? weights : undefined,
      minGreenlightScore: Number(formData.get("minGreenlightScore") ?? 72),
      freshnessMaxAgeHours: Number(formData.get("freshnessMaxAgeHours") ?? 720),
      minSourceReliability: Number(formData.get("minSourceReliability") ?? 40),
      duplicateSensitivity: Number(formData.get("duplicateSensitivity") ?? 70),
      qualityThreshold: Number(formData.get("qualityThreshold") ?? 50),
      production: {
        format: String(formData.get("format") ?? "Short"),
        targetDurationSec: Number(formData.get("targetDurationSec") ?? 55),
        scriptWordTarget: Number(formData.get("scriptWordTarget") ?? 140),
        tone: String(formData.get("tone") ?? ""),
        visualStyle: String(formData.get("visualStyle") ?? ""),
        sectionCount: Number(formData.get("sectionCount") ?? 5),
      },
      publishing: {
        platforms: formData.getAll("platforms").map(String),
        postsPerWeek: Number(formData.get("postsPerWeek") ?? 5),
        postingWindows: list("postingWindows"),
        timezone: String(formData.get("timezone") ?? "UTC"),
        requireApproval: formData.get("requireApproval") !== "off",
        autoPublish: false,
        minQcScore: Number(formData.get("minQcScore") ?? 60),
        defaultHashtags: list("defaultHashtags"),
      },
    });
    if (!res.ok) return { ok: false, error: res.error };

    // Sources chosen in the wizard (JSON array of {type,name,config}).
    const raw = String(formData.get("sources") ?? "[]");
    try {
      const parsed = JSON.parse(raw) as { type: string; name: string; config: Record<string, unknown> }[];
      for (const s of parsed.slice(0, 20)) {
        await engine.addSource({
          nicheId: res.niche.id,
          type: s.type,
          name: s.name,
          config: s.config ?? {},
        });
      }
    } catch { /* sources are optional */ }

    revalidateOps();
    revalidatePath("/channels");
    return { ok: true };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : "Failed to create niche." };
  }
}

export async function setNicheStatusAction(id: string, status: string): Promise<ActionState> {
  const res = await engine.setNicheStatus(id, status as "active" | "paused" | "archived");
  revalidateOps();
  return res.ok ? { ok: true } : { ok: false, error: res.error };
}

export async function duplicateNicheAction(id: string): Promise<ActionState> {
  const res = await engine.duplicateNiche(id);
  revalidateOps();
  return res.ok ? { ok: true } : { ok: false, error: res.error };
}

export async function deleteNicheAction(id: string): Promise<ActionState> {
  const res = await engine.deleteNiche(id);
  revalidateOps();
  return res.ok ? { ok: true, error: res.archived ? res.reason : undefined } : { ok: false, error: res.error };
}

export async function addSourceAction(
  _prev: ActionState,
  formData: FormData,
): Promise<ActionState> {
  try {
    const type = String(formData.get("type") ?? "rss");
    const cfgRaw = String(formData.get("config") ?? "").trim();
    let config: Record<string, unknown> = {};
    if (cfgRaw.startsWith("{")) config = JSON.parse(cfgRaw);
    else if (type === "rss") config = { feedUrl: cfgRaw, limit: 12 };
    else if (type === "googlenews") config = { query: cfgRaw, limit: 12 };
    else if (type === "reddit") config = { subreddit: cfgRaw, limit: 20, minScore: 50 };
    else if (type === "hackernews") config = { query: cfgRaw, limit: 12, minPoints: 30 };
    else config = { query: cfgRaw };

    const res = await engine.addSource({
      nicheId: String(formData.get("nicheId") ?? ""),
      type,
      name: String(formData.get("name") ?? cfgRaw).slice(0, 80),
      config,
      reliability: Number(formData.get("reliability") ?? 70),
      pollIntervalMinutes: Number(formData.get("pollIntervalMinutes") ?? 360),
    });
    revalidateOps();
    return res.ok ? { ok: true } : { ok: false, error: res.error };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : "Failed to add source." };
  }
}

export async function removeSourceAction(id: string) {
  await engine.removeSource(id);
  revalidateOps();
}

/* ------------------------------ jobs -------------------------------- */

export async function runWorkerAction(): Promise<ActionState> {
  try {
    await engine.enqueuePendingProduction();
    await engine.enqueueDuePublishing();
    const tick = await engine.workerTick({ concurrency: 3 });
    revalidateOps();
    return { ok: true, error: tick.processed.length ? undefined : "Queue was empty." };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : "Worker failed." };
  }
}

export async function pauseJobAction(id: string): Promise<ActionState> {
  const r = await engine.pauseJob(id);
  revalidateOps();
  return r.ok ? { ok: true } : { ok: false, error: r.error };
}
export async function resumeJobAction(id: string): Promise<ActionState> {
  const r = await engine.resumeJob(id);
  revalidateOps();
  return r.ok ? { ok: true } : { ok: false, error: r.error };
}
export async function cancelJobAction(id: string): Promise<ActionState> {
  const r = await engine.cancelJob(id);
  revalidateOps();
  return r.ok ? { ok: true } : { ok: false, error: r.error };
}
export async function retryJobAction(id: string): Promise<ActionState> {
  const r = await engine.retryJob(id);
  revalidateOps();
  return r.ok ? { ok: true } : { ok: false, error: r.error };
}
export async function setJobPriorityAction(id: string, priority: number) {
  await engine.setPriority(id, priority);
  revalidateOps();
}

export async function enqueueNicheScoutAction(nicheId: string): Promise<ActionState> {
  const { getNiche } = engine;
  const detail = await getNiche(nicheId);
  const res = await engine.enqueue({
    type: "scout_cycle",
    priority: engine.PRIORITY.manual,
    nicheId,
    channelId: detail?.niche.channelId ?? null,
    dedupeKey: `scout:${nicheId}`,
    currentStep: "scout",
  });
  revalidateOps();
  return { ok: true, error: res.created ? undefined : "A scout job is already queued for this niche." };
}
