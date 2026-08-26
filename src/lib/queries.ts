import { db } from "@/db";
import {
  agentRuns,
  agents,
  aiUsage,
  analyticsSnapshots,
  automationJobs,
  automationSettings,
  channelProductionSettings,
  channelStrategy,
  draftRevisions,
  notifications,
  performanceSignals,
  postMetrics,
  productionAssets,
  publishAccounts,
  publishAttempts,
  publishJobs,
  publishedPosts,
  channels,
  content,
  contentDrafts,
  productionJobs,
  productionSteps,
  publishingJobs,
  stories,
  storyEvaluations,
  storySources,
} from "@/db/schema";
import { asc, desc, eq, inArray, sql } from "drizzle-orm";
import { STAGE_ORDER } from "@/lib/pipeline";

/* ------------------------------------------------------------------ */
/*  Read layer for pages. Every function degrades gracefully if the    */
/*  database hasn't been migrated yet (returns empty structures so     */
/*  pages render designed empty states instead of crashing).           */
/* ------------------------------------------------------------------ */

async function safe<T>(fn: () => Promise<T>, fallback: T): Promise<T> {
  try {
    return await fn();
  } catch (err) {
    console.error("[queries] database read failed:", err instanceof Error ? err.message : err);
    return fallback;
  }
}

export type ChannelRow = typeof channels.$inferSelect;
export type ContentRow = typeof content.$inferSelect;
export type StoryRow = typeof stories.$inferSelect;
export type AgentRow = typeof agents.$inferSelect;
export type PubJobRow = typeof publishingJobs.$inferSelect;
export type AutoJobRow = typeof automationJobs.$inferSelect;
export type SnapshotRow = typeof analyticsSnapshots.$inferSelect;
export type SettingsRow = typeof automationSettings.$inferSelect;

export type ContentWithChannel = ContentRow & {
  channelName: string;
  channelSlug: string;
  channelColor: string;
};

export type StoryWithChannel = StoryRow & { channelName: string | null; channelColor: string | null };

/* ----------------------------- helpers ---------------------------- */

function dayKey(d: Date): string {
  return d.toISOString().slice(0, 10);
}

export function lastNDays(n: number): string[] {
  const out: string[] = [];
  for (let i = n - 1; i >= 0; i--) {
    const d = new Date();
    d.setDate(d.getDate() - i);
    out.push(dayKey(d));
  }
  return out;
}

export function dayLabel(key: string): string {
  const d = new Date(`${key}T00:00:00`);
  return d.toLocaleDateString("en-US", { month: "short", day: "numeric" });
}

/** Per-day views gained, from cumulative snapshots. */
export function dailyViewsSeries(snaps: SnapshotRow[], days: string[]) {
  const bySeries = new Map<string, SnapshotRow[]>();
  for (const s of snaps) {
    const k = `${s.contentId}|${s.platform}`;
    if (!bySeries.has(k)) bySeries.set(k, []);
    bySeries.get(k)!.push(s);
  }
  const perDay = new Map<string, number>(days.map((d) => [d, 0]));
  for (const rows of bySeries.values()) {
    rows.sort((a, b) => +new Date(a.capturedAt) - +new Date(b.capturedAt));
    let prev = rows[0]?.views ?? 0;
    for (const r of rows) {
      const k = dayKey(new Date(r.capturedAt));
      if (perDay.has(k)) perDay.set(k, (perDay.get(k) ?? 0) + Math.max(0, r.views - prev));
      prev = r.views;
    }
  }
  return days.map((d) => ({ key: d, label: dayLabel(d), views: perDay.get(d) ?? 0 }));
}

/** Latest cumulative totals summed across all series. */
export function latestTotals(snaps: SnapshotRow[]) {
  const latest = new Map<string, SnapshotRow>();
  for (const s of snaps) {
    const k = `${s.contentId}|${s.platform}`;
    const cur = latest.get(k);
    if (!cur || +new Date(s.capturedAt) > +new Date(cur.capturedAt)) latest.set(k, s);
  }
  let views = 0, likes = 0, comments = 0, shares = 0, watch = 0;
  for (const r of latest.values()) {
    views += r.views; likes += r.likes; comments += r.comments; shares += r.shares; watch += r.watchMinutes;
  }
  return { views, likes, comments, shares, watch };
}

/* ---------------------------- channels ---------------------------- */

export async function getChannels(): Promise<ChannelRow[]> {
  return safe(
    () => db.select().from(channels).orderBy(channels.createdAt),
    [],
  );
}

export async function getChannelStats() {
  return safe(async () => {
    const contentRows = await db.select().from(content);
    const snaps = await db.select().from(analyticsSnapshots);
    const byChannel = new Map<string, { total: number; published: number; inPipeline: number }>();
    for (const c of contentRows) {
      const cur = byChannel.get(c.channelId) ?? { total: 0, published: 0, inPipeline: 0 };
      cur.total += 1;
      if (c.stage === "published") cur.published += 1;
      else cur.inPipeline += 1;
      byChannel.set(c.channelId, cur);
    }
    const viewsByChannel = new Map<string, number>();
    const latestSnap = new Map<string, SnapshotRow>();
    for (const s of snaps) {
      const k = `${s.contentId}|${s.platform}`;
      const cur = latestSnap.get(k);
      if (!cur || +new Date(s.capturedAt) > +new Date(cur.capturedAt)) latestSnap.set(k, s);
    }
    for (const r of latestSnap.values()) {
      if (!r.channelId) continue;
      viewsByChannel.set(r.channelId, (viewsByChannel.get(r.channelId) ?? 0) + r.views);
    }
    return { byChannel, viewsByChannel };
  }, { byChannel: new Map<string, { total: number; published: number; inPipeline: number }>(), viewsByChannel: new Map<string, number>() });
}

/* ----------------------------- content ---------------------------- */

export async function getContentWithChannel(): Promise<ContentWithChannel[]> {
  return safe(async () => {
    const rows = await db
      .select({
        c: content,
        channelName: channels.name,
        channelSlug: channels.slug,
        channelColor: channels.color,
      })
      .from(content)
      .leftJoin(channels, eq(content.channelId, channels.id))
      .orderBy(desc(content.updatedAt));
    return rows.map((r) => ({
      ...r.c,
      channelName: r.channelName ?? "Unassigned",
      channelSlug: r.channelSlug ?? "—",
      channelColor: r.channelColor ?? "#8b93a7",
    }));
  }, []);
}

export async function getStoriesWithChannel(): Promise<StoryWithChannel[]> {
  return safe(async () => {
    const rows = await db
      .select({
        s: stories,
        channelName: channels.name,
        channelColor: channels.color,
      })
      .from(stories)
      .leftJoin(channels, eq(stories.channelId, channels.id))
      .orderBy(desc(stories.createdAt));
    return rows.map((r) => ({ ...r.s, channelName: r.channelName, channelColor: r.channelColor }));
  }, []);
}

/* ------------------------------ agents ---------------------------- */

export async function getAgents(): Promise<AgentRow[]> {
  return safe(
    () => db.select().from(agents).orderBy(agents.successRate),
    [],
  );
}

/* ---------------------------- publishing -------------------------- */

export async function getPublishingJobs(): Promise<PubJobRow[]> {
  return safe(
    () => db.select().from(publishingJobs).orderBy(desc(publishingJobs.createdAt)),
    [],
  );
}

/* ---------------------------- automation -------------------------- */

export async function getAutomationJobs(limit = 60): Promise<AutoJobRow[]> {
  return safe(
    () => db.select().from(automationJobs).orderBy(desc(automationJobs.createdAt)).limit(limit),
    [],
  );
}

export async function getSettings(): Promise<SettingsRow | null> {
  return safe(async () => {
    const rows = await db.select().from(automationSettings).limit(1);
    return rows[0] ?? null;
  }, null);
}

/* ---------------------------- production --------------------------- */

export type ProductionJobRow = typeof productionJobs.$inferSelect;
export type ProductionStepRow = typeof productionSteps.$inferSelect;
export type ContentDraftRow = typeof contentDrafts.$inferSelect;

export type ProductionJobView = ProductionJobRow & {
  contentTitle: string;
  channelName: string;
  channelColor: string;
  steps: ProductionStepRow[];
  draftStatus: string | null;
  qcScore: number | null;
  wordCount: number | null;
  estimatedDurationSec: number | null;
};

export async function getProductionJobs(): Promise<ProductionJobView[]> {
  return safe(async () => {
    const rows = await db
      .select({
        job: productionJobs,
        contentTitle: content.title,
        channelName: channels.name,
        channelColor: channels.color,
      })
      .from(productionJobs)
      .leftJoin(content, eq(productionJobs.contentId, content.id))
      .leftJoin(channels, eq(productionJobs.channelId, channels.id))
      .orderBy(desc(productionJobs.updatedAt));
    if (rows.length === 0) return [];

    const jobIds = rows.map((r) => r.job.id);
    const allSteps = await db
      .select()
      .from(productionSteps)
      .where(inArray(productionSteps.jobId, jobIds))
      .orderBy(asc(productionSteps.position));
    const drafts = await db
      .select()
      .from(contentDrafts)
      .where(inArray(contentDrafts.jobId, jobIds));

    const stepsByJob = new Map<string, ProductionStepRow[]>();
    for (const s of allSteps) {
      if (!stepsByJob.has(s.jobId)) stepsByJob.set(s.jobId, []);
      stepsByJob.get(s.jobId)!.push(s);
    }
    const draftByJob = new Map(drafts.filter((d) => d.jobId).map((d) => [d.jobId!, d]));

    return rows.map((r) => {
      const draft = draftByJob.get(r.job.id);
      return {
        ...r.job,
        contentTitle: r.contentTitle ?? "Untitled",
        channelName: r.channelName ?? "Unassigned",
        channelColor: r.channelColor ?? "#8b93a7",
        steps: stepsByJob.get(r.job.id) ?? [],
        draftStatus: draft?.status ?? null,
        qcScore: draft?.qcScore ?? null,
        wordCount: draft?.wordCount ?? null,
        estimatedDurationSec: draft?.estimatedDurationSec ?? null,
      };
    });
  }, []);
}

export type AssetRow = typeof productionAssets.$inferSelect;
export type UsageRow = typeof aiUsage.$inferSelect;
export type RevisionRow = typeof draftRevisions.$inferSelect;

export type CostSummary = {
  totalMicroUsd: number;
  byKind: { kind: string; costMicroUsd: number; calls: number }[];
  tokens: number;
  generations: number;
  failures: number;
};

function summarizeUsage(rows: UsageRow[]): CostSummary {
  const byKind = new Map<string, { costMicroUsd: number; calls: number }>();
  let tokens = 0;
  let generations = 0;
  let failures = 0;
  for (const r of rows) {
    const cur = byKind.get(r.kind) ?? { costMicroUsd: 0, calls: 0 };
    cur.costMicroUsd += r.costMicroUsd;
    cur.calls += 1;
    byKind.set(r.kind, cur);
    tokens += r.promptTokens + r.completionTokens;
    generations += r.generations;
    if (!r.success) failures += 1;
  }
  return {
    totalMicroUsd: rows.reduce((a, r) => a + r.costMicroUsd, 0),
    byKind: Array.from(byKind.entries()).map(([kind, v]) => ({ kind, ...v })),
    tokens,
    generations,
    failures,
  };
}

export async function getJobCost(jobId: string): Promise<CostSummary> {
  return safe(async () => {
    const rows = await db.select().from(aiUsage).where(eq(aiUsage.jobId, jobId));
    return summarizeUsage(rows);
  }, { totalMicroUsd: 0, byKind: [], tokens: 0, generations: 0, failures: 0 });
}

export async function getGlobalCost(): Promise<CostSummary & { perVideoMicroUsd: number; jobs: number }> {
  return safe(async () => {
    const rows = await db.select().from(aiUsage);
    const jobs = await db
      .select({ id: productionJobs.id })
      .from(productionJobs)
      .where(inArray(productionJobs.status, ["completed", "awaiting_review"]));
    const s = summarizeUsage(rows);
    return {
      ...s,
      jobs: jobs.length,
      perVideoMicroUsd: jobs.length ? Math.round(s.totalMicroUsd / jobs.length) : 0,
    };
  }, { totalMicroUsd: 0, byKind: [], tokens: 0, generations: 0, failures: 0, perVideoMicroUsd: 0, jobs: 0 });
}

export async function getProductionJobDetail(jobId: string): Promise<{
  job: ProductionJobView;
  draft: ContentDraftRow | null;
  assets: AssetRow[];
  usage: CostSummary;
  revisions: RevisionRow[];
} | null> {
  return safe(async () => {
    const [row] = await db
      .select({
        job: productionJobs,
        contentTitle: content.title,
        channelName: channels.name,
        channelColor: channels.color,
      })
      .from(productionJobs)
      .leftJoin(content, eq(productionJobs.contentId, content.id))
      .leftJoin(channels, eq(productionJobs.channelId, channels.id))
      .where(eq(productionJobs.id, jobId));
    if (!row) return null;

    const steps = await db
      .select()
      .from(productionSteps)
      .where(eq(productionSteps.jobId, jobId))
      .orderBy(asc(productionSteps.position));
    const [draft] = await db
      .select()
      .from(contentDrafts)
      .where(eq(contentDrafts.jobId, jobId));

    const assets = await db
      .select()
      .from(productionAssets)
      .where(eq(productionAssets.jobId, jobId))
      .orderBy(asc(productionAssets.sceneNumber));
    const usageRows = await db.select().from(aiUsage).where(eq(aiUsage.jobId, jobId));
    const revisions = await db
      .select()
      .from(draftRevisions)
      .where(eq(draftRevisions.jobId, jobId))
      .orderBy(desc(draftRevisions.revision));

    return {
      job: {
        ...row.job,
        contentTitle: row.contentTitle ?? "Untitled",
        channelName: row.channelName ?? "Unassigned",
        channelColor: row.channelColor ?? "#8b93a7",
        steps,
        draftStatus: draft?.status ?? null,
        qcScore: draft?.qcScore ?? null,
        wordCount: draft?.wordCount ?? null,
        estimatedDurationSec: draft?.estimatedDurationSec ?? null,
      },
      draft: draft ?? null,
      assets,
      usage: summarizeUsage(usageRows),
      revisions,
    };
  }, null);
}

export async function getProductionSettingsMap(): Promise<
  Map<string, typeof channelProductionSettings.$inferSelect>
> {
  return safe(async () => {
    const rows = await db.select().from(channelProductionSettings);
    return new Map(rows.map((r) => [r.channelId, r]));
  }, new Map());
}

export type StoryCounts = {
  discovered: number;
  selected: number;
  rejected: number;
  used: number;
  total: number;
};

export type EvalBreakdown = {
  provider: string;
  recommendation: string;
  overall: number;
  dims: { label: string; value: number }[];
};

/** Latest judge evaluation per story (DISTINCT ON story_id). */
export async function getLatestEvaluations(): Promise<Map<string, EvalBreakdown>> {
  return safe(async () => {
    const res = await db.execute(sql`
      SELECT DISTINCT ON (story_id)
        story_id, provider, recommendation, overall,
        viral_potential, entertainment_value, channel_relevance,
        visual_potential, originality, evergreen_potential, source_reliability
      FROM story_evaluations
      ORDER BY story_id, created_at DESC
    `);
    const map = new Map<string, EvalBreakdown>();
    for (const r of res.rows as Record<string, unknown>[]) {
      map.set(String(r.story_id), {
        provider: String(r.provider),
        recommendation: String(r.recommendation),
        overall: Number(r.overall),
        dims: [
          { label: "Viral", value: Number(r.viral_potential) },
          { label: "Entertain", value: Number(r.entertainment_value) },
          { label: "Relevance", value: Number(r.channel_relevance) },
          { label: "Visual", value: Number(r.visual_potential) },
          { label: "Original", value: Number(r.originality) },
          { label: "Evergreen", value: Number(r.evergreen_potential) },
          { label: "Source", value: Number(r.source_reliability) },
        ],
      });
    }
    return map;
  }, new Map<string, EvalBreakdown>());
}

export async function getScoutTelemetry(): Promise<{
  lastRun: (typeof agentRuns.$inferSelect) | null;
  counts: StoryCounts;
  sources: (typeof storySources.$inferSelect)[];
}> {
  const empty: {
    lastRun: (typeof agentRuns.$inferSelect) | null;
    counts: StoryCounts;
    sources: (typeof storySources.$inferSelect)[];
  } = {
    lastRun: null,
    counts: { discovered: 0, selected: 0, rejected: 0, used: 0, total: 0 },
    sources: [],
  };
  return safe(async () => {
    const [lastRun] = await db
      .select()
      .from(agentRuns)
      .where(eq(agentRuns.agentSlug, "story-scout"))
      .orderBy(desc(agentRuns.createdAt))
      .limit(1);
    const storyRows = await db.select({ status: stories.status }).from(stories);
    const counts: StoryCounts = { discovered: 0, selected: 0, rejected: 0, used: 0, total: storyRows.length };
    for (const r of storyRows) {
      if (r.status === "discovered") counts.discovered += 1;
      else if (r.status === "selected") counts.selected += 1;
      else if (r.status === "rejected") counts.rejected += 1;
      else if (r.status === "used") counts.used += 1;
    }
    const sources = await db.select().from(storySources).orderBy(storySources.createdAt);
    return { lastRun: lastRun ?? null, counts, sources };
  }, empty);
}

/* ---------------------------- analytics --------------------------- */

export async function getSnapshots(): Promise<SnapshotRow[]> {
  return safe(() => db.select().from(analyticsSnapshots), []);
}

/* ---------------------------- overview ---------------------------- */

export async function getOverviewData() {
  const [channelRows, contentRows, agentRows, jobRows, storyRows, snapRows, settings] =
    await Promise.all([
      getChannels(),
      getContentWithChannel(),
      getAgents(),
      getAutomationJobs(20),
      getStoriesWithChannel(),
      getSnapshots(),
      getSettings(),
    ]);

  const byStage: Record<string, ContentWithChannel[]> = Object.fromEntries(
    STAGE_ORDER.map((s) => [s, []]),
  );
  for (const c of contentRows) (byStage[c.stage] ??= []).push(c);

  const weekAgo = Date.now() - 7 * 86400_000;
  const publishedThisWeek = contentRows.filter(
    (c) => c.publishedAt && +new Date(c.publishedAt) >= weekAgo,
  ).length;

  const discoveredStories = storyRows.filter((s) => s.status === "discovered");
  const avgScore = storyRows.length
    ? Math.round(storyRows.reduce((a, s) => a + s.score, 0) / storyRows.length)
    : 0;

  const days = lastNDays(14);
  const series = dailyViewsSeries(snapRows, days);
  const totals = latestTotals(snapRows);
  const engagement = totals.views
    ? ((totals.likes + totals.comments + totals.shares) / totals.views) * 100
    : 0;

  const upcoming = contentRows
    .filter((c) => c.scheduledAt && +new Date(c.scheduledAt) > Date.now())
    .sort((a, b) => +new Date(a.scheduledAt!) - +new Date(b.scheduledAt!))
    .slice(0, 5);

  const activeAgents = agentRows.filter((a) => a.status === "running").length;
  const failedJobs = jobRows.filter((j) => j.status === "failed").length;

  return {
    channels: channelRows,
    contentRows,
    byStage,
    agents: agentRows,
    jobRows,
    settings,
    pipelineCount: contentRows.filter((c) => c.stage !== "published").length,
    publishedThisWeek,
    discoveredCount: discoveredStories.length,
    avgScore,
    series,
    totals,
    engagement,
    upcoming,
    activeAgents,
    failedJobs,
  };
}

/* ==================================================================== */
/*  PHASE 5 — Creator Lab queries                                       */
/* ==================================================================== */

export type PublishJobView = typeof publishJobs.$inferSelect & {
  channelName: string;
  channelColor: string;
  contentTitle: string;
  accountStatus: string | null;
  thumbUrl: string | null;
  videoUrl: string | null;
};

export async function getPublishJobs(): Promise<PublishJobView[]> {
  return safe(async () => {
    const rows = await db
      .select({
        j: publishJobs,
        channelName: channels.name,
        channelColor: channels.color,
        contentTitle: content.title,
        accountStatus: publishAccounts.status,
      })
      .from(publishJobs)
      .leftJoin(channels, eq(publishJobs.channelId, channels.id))
      .leftJoin(content, eq(publishJobs.contentId, content.id))
      .leftJoin(publishAccounts, eq(publishJobs.accountId, publishAccounts.id))
      .orderBy(desc(publishJobs.updatedAt));
    if (rows.length === 0) return [];

    const contentIds = Array.from(new Set(rows.map((r) => r.j.contentId)));
    const assets = await db
      .select({ a: productionAssets, contentId: productionJobs.contentId })
      .from(productionAssets)
      .innerJoin(productionJobs, eq(productionAssets.jobId, productionJobs.id))
      .where(inArray(productionJobs.contentId, contentIds));
    const thumbByContent = new Map<string, string>();
    const videoByContent = new Map<string, string>();
    for (const { a, contentId } of assets) {
      if (a.status !== "generated" || !a.url) continue;
      if (a.kind === "image" && !thumbByContent.has(contentId)) thumbByContent.set(contentId, a.url);
      if (a.kind === "video") videoByContent.set(contentId, a.url);
    }

    return rows.map((r) => ({
      ...r.j,
      channelName: r.channelName ?? "Unassigned",
      channelColor: r.channelColor ?? "#8b93a7",
      contentTitle: r.contentTitle ?? r.j.title,
      accountStatus: r.accountStatus ?? null,
      thumbUrl: thumbByContent.get(r.j.contentId) ?? null,
      videoUrl: videoByContent.get(r.j.contentId) ?? null,
    }));
  }, []);
}

export async function getPublishAttempts(jobId: string) {
  return safe(
    () =>
      db
        .select()
        .from(publishAttempts)
        .where(eq(publishAttempts.jobId, jobId))
        .orderBy(desc(publishAttempts.createdAt)),
    [],
  );
}

export async function getPublishAccounts() {
  return safe(
    () =>
      db
        .select({ a: publishAccounts, channelName: channels.name, channelColor: channels.color })
        .from(publishAccounts)
        .leftJoin(channels, eq(publishAccounts.channelId, channels.id)),
    [],
  );
}

export async function getChannelStrategies() {
  return safe(async () => {
    const rows = await db.select().from(channelStrategy);
    return new Map(rows.map((r) => [r.channelId, r]));
  }, new Map<string, typeof channelStrategy.$inferSelect>());
}

export type CreatorMetrics = {
  storiesDiscovered: number;
  storiesGreenlit: number;
  jobsRunning: number;
  awaitingReview: number;
  approved: number;
  scheduled: number;
  published: number;
  failed: number;
  videosProduced: number;
  totalCostMicroUsd: number;
  avgProductionMs: number;
  avgQcScore: number;
};

export async function getCreatorMetrics(): Promise<CreatorMetrics> {
  const empty: CreatorMetrics = {
    storiesDiscovered: 0, storiesGreenlit: 0, jobsRunning: 0, awaitingReview: 0,
    approved: 0, scheduled: 0, published: 0, failed: 0, videosProduced: 0,
    totalCostMicroUsd: 0, avgProductionMs: 0, avgQcScore: 0,
  };
  return safe(async () => {
    const res = await db.execute(sql`
      SELECT
        (SELECT COUNT(*) FROM stories WHERE status='discovered')::int stories_discovered,
        (SELECT COUNT(*) FROM stories WHERE status='selected')::int stories_greenlit,
        (SELECT COUNT(*) FROM production_jobs WHERE status IN ('queued','running'))::int jobs_running,
        (SELECT COUNT(*) FROM production_jobs WHERE status='awaiting_review')::int awaiting_review,
        (SELECT COUNT(*) FROM content_drafts WHERE status='approved')::int approved,
        (SELECT COUNT(*) FROM publish_jobs WHERE status='scheduled')::int scheduled,
        (SELECT COUNT(*) FROM publish_jobs WHERE status='published')::int published,
        (SELECT COUNT(*) FROM production_jobs WHERE status='failed')::int failed,
        (SELECT COUNT(*) FROM production_assets WHERE kind='video' AND status='generated')::int videos_produced,
        (SELECT COALESCE(SUM(cost_micro_usd),0) FROM ai_usage)::int total_cost,
        (SELECT COALESCE(AVG(EXTRACT(EPOCH FROM (completed_at - started_at))*1000),0)
           FROM production_jobs WHERE completed_at IS NOT NULL AND started_at IS NOT NULL)::int avg_ms,
        (SELECT COALESCE(AVG(qc_score),0) FROM content_drafts WHERE qc_score > 0)::int avg_qc
    `);
    const r = res.rows[0] as Record<string, number>;
    return {
      storiesDiscovered: Number(r.stories_discovered ?? 0),
      storiesGreenlit: Number(r.stories_greenlit ?? 0),
      jobsRunning: Number(r.jobs_running ?? 0),
      awaitingReview: Number(r.awaiting_review ?? 0),
      approved: Number(r.approved ?? 0),
      scheduled: Number(r.scheduled ?? 0),
      published: Number(r.published ?? 0),
      failed: Number(r.failed ?? 0),
      videosProduced: Number(r.videos_produced ?? 0),
      totalCostMicroUsd: Number(r.total_cost ?? 0),
      avgProductionMs: Number(r.avg_ms ?? 0),
      avgQcScore: Number(r.avg_qc ?? 0),
    };
  }, empty);
}

export type CreatorAnalytics = {
  hasData: boolean;
  totalViews: number;
  totalEngagements: number;
  avgViews: number;
  engagementRateBp: number;
  completionRateBp: number | null;
  followersGained: number;
  videoCount: number;
  topVideos: { title: string; channel: string; views: number; engagements: number }[];
  rankings: Record<string, { label: string; sampleSize: number; avgViews: number; adjustment: number; confidence: string }[]>;
};

export async function getCreatorAnalytics(): Promise<CreatorAnalytics> {
  const empty: CreatorAnalytics = {
    hasData: false, totalViews: 0, totalEngagements: 0, avgViews: 0,
    engagementRateBp: 0, completionRateBp: null, followersGained: 0, videoCount: 0,
    topVideos: [], rankings: {},
  };
  return safe(async () => {
    const [{ n }] = await db
      .select({ n: sql<number>`count(*)::int` })
      .from(postMetrics);
    if (!n) return empty;

    const res = await db.execute(sql`
      SELECT DISTINCT ON (post_id, platform)
        post_id, content_id, platform,
        COALESCE(views,0) v, COALESCE(likes,0) l, COALESCE(comments,0) c,
        COALESCE(shares,0) s, COALESCE(followers_gained,0) f, completion_rate_bp cr
      FROM post_metrics ORDER BY post_id, platform, measured_at DESC
    `);
    const rows = res.rows as Record<string, unknown>[];
    let views = 0, eng = 0, followers = 0;
    const crs: number[] = [];
    const perContent = new Map<string, { views: number; eng: number }>();
    for (const r of rows) {
      const v = Number(r.v ?? 0);
      const e = Number(r.l ?? 0) + Number(r.c ?? 0) + Number(r.s ?? 0);
      views += v; eng += e; followers += Number(r.f ?? 0);
      if (r.cr != null) crs.push(Number(r.cr));
      const cid = r.content_id ? String(r.content_id) : null;
      if (cid) {
        const cur = perContent.get(cid) ?? { views: 0, eng: 0 };
        cur.views += v; cur.eng += e;
        perContent.set(cid, cur);
      }
    }

    const contentRows = await db
      .select({ id: content.id, title: content.title, channel: channels.name })
      .from(content)
      .leftJoin(channels, eq(content.channelId, channels.id));
    const byId = new Map(contentRows.map((c) => [c.id, c]));
    const topVideos = Array.from(perContent.entries())
      .map(([id, m]) => ({
        title: byId.get(id)?.title ?? "Untitled",
        channel: byId.get(id)?.channel ?? "—",
        views: m.views,
        engagements: m.eng,
      }))
      .sort((a, b) => b.views - a.views)
      .slice(0, 10);

    const signals = await db.select().from(performanceSignals);
    const rankings: CreatorAnalytics["rankings"] = {};
    for (const s of signals) {
      (rankings[s.dimension] ??= []).push({
        label: s.label,
        sampleSize: s.sampleSize,
        avgViews: s.avgViews,
        adjustment: s.adjustment,
        confidence: s.confidence,
      });
    }
    for (const k of Object.keys(rankings)) {
      rankings[k].sort((a, b) => b.avgViews - a.avgViews);
      rankings[k] = rankings[k].slice(0, 8);
    }

    return {
      hasData: true,
      totalViews: views,
      totalEngagements: eng,
      avgViews: perContent.size ? Math.round(views / perContent.size) : 0,
      engagementRateBp: views ? Math.round((eng / views) * 10000) : 0,
      completionRateBp: crs.length ? Math.round(crs.reduce((a, b) => a + b, 0) / crs.length) : null,
      followersGained: followers,
      videoCount: perContent.size,
      topVideos,
      rankings,
    };
  }, empty);
}

export async function getPerformanceSignals() {
  return safe(
    () =>
      db
        .select()
        .from(performanceSignals)
        .orderBy(desc(performanceSignals.sampleSize), desc(performanceSignals.avgViews)),
    [],
  );
}

export async function getNotifications(limit = 25) {
  return safe(
    () => db.select().from(notifications).orderBy(desc(notifications.createdAt)).limit(limit),
    [],
  );
}

/* ==================================================================== */
/*  PHASE 6 — YouTube                                                   */
/* ==================================================================== */

export async function getYouTubeAccounts() {
  return safe(async () => {
    const { accountStateFor } = await import("@/lib/services/platforms");
    const rows = await db.select().from(channels).orderBy(channels.createdAt);
    const out: {
      channelId: string;
      channelName: string;
      channelColor: string;
      state: string;
      detail: string;
      displayName: string;
      handle: string;
      needsReconnect: boolean;
      expiresAt: string | null;
    }[] = [];
    for (const ch of rows) {
      const st = await accountStateFor("youtube", ch.id);
      out.push({
        channelId: ch.id,
        channelName: ch.name,
        channelColor: ch.color,
        state: st?.state ?? "not_connected",
        detail: st?.detail ?? "",
        displayName: st?.displayName ?? "",
        handle: st?.handle ?? "",
        needsReconnect: st?.needsReconnect ?? false,
        expiresAt: st?.expiresAt ?? null,
      });
    }
    return out;
  }, []);
}

export type YouTubeAnalytics = {
  hasData: boolean;
  videos: number;
  views: number;
  likes: number;
  comments: number;
  shares: number;
  watchTimeSec: number;
  avgViewDurationSec: number | null;
  avgViewPercentageBp: number | null;
  ctrBp: number | null;
  impressions: number | null;
  subsGained: number;
  subsLost: number;
  top: { title: string; url: string; views: number; retentionBp: number | null }[];
  series: { date: string; views: number }[];
  snapshots: number;
};

export async function getYouTubeAnalytics(): Promise<YouTubeAnalytics> {
  const empty: YouTubeAnalytics = {
    hasData: false, videos: 0, views: 0, likes: 0, comments: 0, shares: 0,
    watchTimeSec: 0, avgViewDurationSec: null, avgViewPercentageBp: null,
    ctrBp: null, impressions: null, subsGained: 0, subsLost: 0,
    top: [], series: [], snapshots: 0,
  };
  return safe(async () => {
    const [{ n }] = await db
      .select({ n: sql<number>`count(*)::int` })
      .from(postMetrics)
      .where(eq(postMetrics.platform, "youtube"));
    if (!n) return empty;

    const latest = await db.execute(sql`
      SELECT DISTINCT ON (platform_post_id)
        platform_post_id, content_id,
        COALESCE(views,0) v, COALESCE(likes,0) l, COALESCE(comments,0) c, COALESCE(shares,0) s,
        COALESCE(watch_time_sec,0) w, avg_view_duration_sec avd, avg_view_percentage_bp avp,
        ctr_bp ctr, impressions imp,
        COALESCE(followers_gained,0) sg, COALESCE(followers_lost,0) sl
      FROM post_metrics WHERE platform='youtube'
      ORDER BY platform_post_id, measured_at DESC
    `);
    const rows = latest.rows as Record<string, unknown>[];
    const num = (v: unknown) => Number(v ?? 0);

    let views = 0, likes = 0, comments = 0, shares = 0, watch = 0, sg = 0, sl = 0;
    const avds: number[] = [], avps: number[] = [], ctrs: number[] = [], imps: number[] = [];
    for (const r of rows) {
      views += num(r.v); likes += num(r.l); comments += num(r.c); shares += num(r.s);
      watch += num(r.w); sg += num(r.sg); sl += num(r.sl);
      if (r.avd != null) avds.push(num(r.avd));
      if (r.avp != null) avps.push(num(r.avp));
      if (r.ctr != null) ctrs.push(num(r.ctr));
      if (r.imp != null) imps.push(num(r.imp));
    }
    const avg = (a: number[]) => (a.length ? Math.round(a.reduce((x, y) => x + y, 0) / a.length) : null);

    const posts = await db
      .select()
      .from(publishedPosts)
      .where(eq(publishedPosts.platform, "youtube"));
    const byId = new Map(posts.map((p) => [p.platformPostId, p]));
    const top = rows
      .map((r) => {
        const p = byId.get(String(r.platform_post_id));
        return {
          title: p?.title ?? String(r.platform_post_id),
          url: p?.platformUrl ?? `https://www.youtube.com/watch?v=${r.platform_post_id}`,
          views: num(r.v),
          retentionBp: r.avp == null ? null : num(r.avp),
        };
      })
      .sort((a, b) => b.views - a.views)
      .slice(0, 10);

    const hist = await db.execute(sql`
      SELECT to_char(measured_at,'YYYY-MM-DD') d, SUM(COALESCE(views,0))::int v
      FROM post_metrics WHERE platform='youtube'
      GROUP BY 1 ORDER BY 1 DESC LIMIT 30
    `);
    const series = (hist.rows as Record<string, unknown>[])
      .map((r) => ({ date: String(r.d), views: Number(r.v ?? 0) }))
      .reverse();

    return {
      hasData: true,
      videos: rows.length,
      views, likes, comments, shares,
      watchTimeSec: watch,
      avgViewDurationSec: avg(avds),
      avgViewPercentageBp: avg(avps),
      ctrBp: avg(ctrs),
      impressions: imps.length ? imps.reduce((a, b) => a + b, 0) : null,
      subsGained: sg, subsLost: sl,
      top, series, snapshots: n,
    };
  }, empty);
}

export async function getYouTubeJobConfig(jobId: string) {
  return safe(async () => {
    const [draft] = await db.select().from(contentDrafts).where(eq(contentDrafts.jobId, jobId));
    if (!draft) return null;
    const assets = await db
      .select()
      .from(productionAssets)
      .where(eq(productionAssets.jobId, jobId));
    const thumb = draft.thumbnailAssetId
      ? assets.find((a) => a.id === draft.thumbnailAssetId)
      : assets.find((a) => a.kind === "thumbnail");
    return {
      jobId,
      title: draft.youtubeTitle || draft.title,
      description: draft.youtubeDescription,
      tags: draft.youtubeTags,
      categoryId: draft.youtubeCategoryId,
      privacy: draft.youtubePrivacy,
      metadataMode: draft.metadataMode,
      thumbnailUrl: thumb?.url ?? null,
      thumbnailMode: thumb ? String((thumb.metadata as Record<string, unknown>)?.mode ?? "") : null,
      candidates: assets
        .filter((a) => (a.kind === "image" || a.kind === "thumbnail") && a.status === "generated" && a.url)
        .map((a) => ({ id: a.id, url: a.url!, kind: a.kind, sceneNumber: a.sceneNumber })),
    };
  }, null);
}
