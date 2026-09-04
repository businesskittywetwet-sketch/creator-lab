import { db } from "@/db";
import {
  agents,
  automationJobs,
  channels,
  content,
  publishingJobs,
} from "@/db/schema";
import { and, desc, eq } from "drizzle-orm";
import { nextStage, prevStage, STAGE_ORDER } from "@/lib/pipeline";
import { runScoutCycle } from "./scout";

/* ------------------------------------------------------------------ */
/*  ENGINE — operational facade. UI code calls these functions and     */
/*  nothing else: engine functions own all state transitions, so the   */
/*  internals can later be swapped for a real job runner (Inngest,     */
/*  Trigger, Temporal) without touching pages or components.           */
/* ------------------------------------------------------------------ */

export {
  getAutomationSettings,
  setAutomationEnabled,
  updateAutomationConfig,
  type AutomationConfigInput,
} from "./settings";
export {
  runScoutCycle,
  processDueAutomationJobs,
  runScheduledScoutIfDue,
  ensureDefaultSources,
  type ScoutStats,
  type ScoutTrigger,
} from "./scout";
export {
  createProductionJob,
  ensureProductionJobsForSelected,
  ensureProductionSettings,
  updateProductionSettings,
  runProductionJob,
  retryProductionJob,
  approveDraft,
  rejectDraft,
  requestDraftChanges,
  inferRevisionTarget,
  advanceProductionQueue,
  latestProductionRun,
  mediaProviderSummary,
  saveDraftEdits,
  restoreDraftRevision,
  EDITABLE_FIELDS,
  type RunResult,
  type ApproveResult,
  type ProductionSettingsInput,
  type DraftEditInput,
} from "./production";
export {
  ensureChannelStrategy,
  updateChannelStrategy,
  syncAccountsForChannel,
  refreshAllAccounts,
  preflight,
  createPublishJobsForContent,
  schedulePublishJob,
  cancelPublishJob,
  dispatchPublishJob,
  retryPublish,
  processDuePublishJobs,
  publishJobCounts,
  type StrategyInput,
  type DispatchResult,
  type Preflight,
} from "./publishing";
export {
  buildYouTubeMetadata,
  saveYouTubeSettings,
  createThumbnail,
  thumbnailCandidates,
  selectThumbnail,
  youtubeAccountStatus,
  disconnectYouTube,
  maintainTokens,
  refreshYouTubeAnalytics,
  youtubeLatestMetrics,
  type YtSettingsInput,
  type YtRefreshReport,
} from "./youtube";
export {
  syncPostMetrics,
  computePerformanceSignals,
  computeInsights,
  type Insight,
  judgeSignalsFor,
  latestMetrics,
  getSignals,
  type SignalRow,
  type SyncReport,
} from "./analytics";
export {
  enqueue, claimJob, completeJob, failJob, heartbeat, setProgress,
  reclaimExpiredLeases, reapDeadWorkers, pauseJob, resumeJob, cancelJob,
  retryJob, setPriority, queueStats, listJobs, jobTimeline, activeWorkers,
  classifyError, backoffMs, logEvent, PRIORITY, LEASE_MS,
  PermanentJobError, TransientJobError,
  type JobType, type JobStatus, type WorkRow,
} from "./queue";
export {
  workerTick, runOneJob, makeWorkerId, registerWorker, workerHeartbeat,
  stopWorker, enqueuePendingProduction, enqueueDuePublishing,
  type RunOutcome,
} from "./worker";
export {
  createNiche, updateNiche, setNicheStatus, duplicateNiche, deleteNiche,
  addSource, updateSource, removeSource, listNiches, getNiche,
  nichesDueForScout, markNicheScouted, adoptLegacyChannels,
  DEFAULT_JUDGE_WEIGHTS, type NicheInput, type SourceInput,
} from "./niches";
export {
  notify,
  markAllRead,
  markRead,
  unreadCount,
  recentNotifications,
  scanAttention,
  syncNotifications,
  type AttentionItem,
} from "./notifications";

/* ---------------------------- job control ------------------------- */

export async function retryAutomationJob(id: string) {
  const [job] = await db
    .select()
    .from(automationJobs)
    .where(eq(automationJobs.id, id));
  if (!job) return;

  // Discovery failures re-run the real scout pipeline.
  if (job.type === "story_discovery" || job.type === "story_evaluation") {
    await db
      .update(automationJobs)
      .set({ status: "success", lastError: null, payload: { retried: true }, finishedAt: new Date() })
      .where(eq(automationJobs.id, id));
    await runScoutCycle("retry");
    return;
  }

  await db
    .update(automationJobs)
    .set({
      status: "success",
      attempts: job.attempts + 1,
      lastError: null,
      startedAt: new Date(),
      finishedAt: new Date(),
      durationMs: 1400 + Math.floor(Math.random() * 3200),
    })
    .where(eq(automationJobs.id, id));
}

export async function retryPublishingJob(id: string) {
  const [job] = await db
    .select()
    .from(publishingJobs)
    .where(eq(publishingJobs.id, id));
  if (!job) return;
  await db
    .update(publishingJobs)
    .set({
      status: "published",
      attempts: job.attempts + 1,
      lastError: null,
      publishedAt: new Date(),
      externalUrl: `https://${job.platform}.example.com/v/${Math.random()
        .toString(36)
        .slice(2, 9)}`,
    })
    .where(eq(publishingJobs.id, id));
  await db
    .update(content)
    .set({ stage: "published", publishedAt: new Date(), updatedAt: new Date() })
    .where(eq(content.id, job.contentId));
}

/* ------------------------------ agents ---------------------------- */

export async function setAgentStatus(id: string, status: string) {
  await db
    .update(agents)
    .set({
      status,
      currentTask: status === "paused" || status === "idle" ? null : undefined,
    })
    .where(eq(agents.id, id));
}

/* ------------------------------ content --------------------------- */

export async function moveContent(id: string, direction: 1 | -1) {
  const [item] = await db.select().from(content).where(eq(content.id, id));
  if (!item) return;
  const target = direction === 1 ? nextStage(item.stage) : prevStage(item.stage);
  if (target === item.stage) return;

  const patch: Partial<typeof content.$inferInsert> = {
    stage: target,
    updatedAt: new Date(),
  };
  if (target === "scheduled") {
    patch.scheduledAt = new Date(Date.now() + 3 * 3600_000);
  }
  if (target === "published") {
    patch.publishedAt = new Date();
  }
  await db.update(content).set(patch).where(eq(content.id, id));

  if (target === "scheduled") {
    const [channel] = await db
      .select()
      .from(channels)
      .where(eq(channels.id, item.channelId));
    const existing = await db
      .select()
      .from(publishingJobs)
      .where(eq(publishingJobs.contentId, id));
    if (existing.length === 0 && channel) {
      for (const platform of channel.targetPlatforms) {
        await db.insert(publishingJobs).values({
          contentId: id,
          platform,
          status: "queued",
          scheduledAt: patch.scheduledAt,
        });
      }
    }
  }

  if (target === "published") {
    await db
      .update(publishingJobs)
      .set({ status: "published", publishedAt: new Date() })
      .where(
        and(
          eq(publishingJobs.contentId, id),
          eq(publishingJobs.status, "queued"),
        ),
      );
  }
}

/* ----------------------- pipeline snapshot ------------------------ */

export async function stageCounts(): Promise<Record<string, number>> {
  const rows = await db.select({ stage: content.stage }).from(content);
  const counts: Record<string, number> = Object.fromEntries(
    STAGE_ORDER.map((s) => [s, 0]),
  );
  for (const r of rows) counts[r.stage] = (counts[r.stage] ?? 0) + 1;
  return counts;
}

export async function recentJobs(limit = 8) {
  return db
    .select()
    .from(automationJobs)
    .orderBy(desc(automationJobs.createdAt))
    .limit(limit);
}

export async function runningJobsCount(): Promise<number> {
  const rows = await db
    .select({ id: automationJobs.id })
    .from(automationJobs)
    .where(eq(automationJobs.status, "running"));
  return rows.length;
}
