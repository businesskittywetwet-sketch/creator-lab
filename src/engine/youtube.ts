import { db } from "@/db";
import {
  channels,
  content,
  contentDrafts,
  postMetrics,
  productionAssets,
  productionJobs,
  publishAccounts,
  publishJobs,
  publishedPosts,
  stories,
} from "@/db/schema";
import { and, desc, eq } from "drizzle-orm";
import { generateMetadata, composeMetadata, type YtMetadata } from "@/lib/services/youtube/metadata";
import { generateThumbnail } from "@/lib/services/media";
import { adapterFor } from "@/lib/services/platforms";
import { accountStatus, disconnect, getAccessToken } from "@/lib/services/youtube/oauth";
import { redactUnknown } from "@/lib/crypto";
import { notify } from "./notifications";

/* ------------------------------------------------------------------ */
/*  YouTube engine helpers — metadata, thumbnails, analytics refresh.  */
/*  Extends the Phase 5 publishing/analytics engines rather than       */
/*  duplicating them.                                                   */
/* ------------------------------------------------------------------ */

/* --------------------------- metadata ------------------------------ */

export async function buildYouTubeMetadata(
  jobId: string,
  opts: { force?: boolean } = {},
): Promise<{ ok: boolean; metadata?: YtMetadata; error?: string }> {
  const [draft] = await db.select().from(contentDrafts).where(eq(contentDrafts.jobId, jobId));
  if (!draft) return { ok: false, error: "Draft not found" };
  if (draft.youtubeTitle && !opts.force) {
    return {
      ok: true,
      metadata: {
        title: draft.youtubeTitle,
        description: draft.youtubeDescription,
        tags: draft.youtubeTags,
        categoryId: draft.youtubeCategoryId,
        mode: draft.metadataMode === "real_ai" ? "real_ai" : "fallback",
        provider: draft.provider,
      },
    };
  }

  const [job] = await db.select().from(productionJobs).where(eq(productionJobs.id, jobId));
  if (!job) return { ok: false, error: "Production job not found" };
  const [ch] = await db.select().from(channels).where(eq(channels.id, job.channelId));
  const [item] = await db.select().from(content).where(eq(content.id, job.contentId));
  const story = item?.storyId
    ? (await db.select().from(stories).where(eq(stories.id, item.storyId)))[0]
    : undefined;

  const meta = await generateMetadata({
    draftTitle: draft.title,
    hook: draft.hook,
    sections: draft.sections,
    cta: draft.cta,
    channelName: ch?.name ?? "Viboro",
    niche: ch?.niche ?? "",
    sourceName: story?.sourceName ?? "",
    sourceUrl: story?.sourceUrl ?? "",
    existingHashtags: draft.hashtags,
  });

  await db
    .update(contentDrafts)
    .set({
      youtubeTitle: meta.title,
      youtubeDescription: meta.description,
      youtubeTags: meta.tags,
      youtubeCategoryId: meta.categoryId,
      metadataMode: meta.mode,
      updatedAt: new Date(),
    })
    .where(eq(contentDrafts.jobId, jobId));

  return { ok: true, metadata: meta };
}

export type YtSettingsInput = {
  title?: string;
  description?: string;
  tags?: string[];
  categoryId?: string;
  privacy?: string;
  thumbnailAssetId?: string | null;
};

export async function saveYouTubeSettings(jobId: string, input: YtSettingsInput) {
  const patch: Partial<typeof contentDrafts.$inferInsert> = { updatedAt: new Date() };
  if (input.title !== undefined) patch.youtubeTitle = input.title.slice(0, 100);
  if (input.description !== undefined) patch.youtubeDescription = input.description.slice(0, 5000);
  if (input.tags !== undefined) patch.youtubeTags = input.tags.slice(0, 15);
  if (input.categoryId !== undefined) patch.youtubeCategoryId = input.categoryId;
  if (input.privacy !== undefined) patch.youtubePrivacy = input.privacy;
  if (input.thumbnailAssetId !== undefined) patch.thumbnailAssetId = input.thumbnailAssetId;
  await db.update(contentDrafts).set(patch).where(eq(contentDrafts.jobId, jobId));

  // Mirror onto any publish job that has not gone out yet.
  const [job] = await db.select().from(productionJobs).where(eq(productionJobs.id, jobId));
  if (job) {
    const jobPatch: Partial<typeof publishJobs.$inferInsert> = { updatedAt: new Date() };
    if (input.title !== undefined) jobPatch.title = input.title.slice(0, 100);
    if (input.description !== undefined) jobPatch.description = input.description.slice(0, 5000);
    if (input.tags !== undefined) jobPatch.hashtags = input.tags.slice(0, 15);
    if (input.privacy !== undefined) jobPatch.privacyStatus = input.privacy;
    if (input.categoryId !== undefined) jobPatch.categoryId = input.categoryId;
    if (input.thumbnailAssetId !== undefined) jobPatch.thumbnailAssetId = input.thumbnailAssetId;
    await db
      .update(publishJobs)
      .set(jobPatch)
      .where(
        and(
          eq(publishJobs.contentId, job.contentId),
          eq(publishJobs.platform, "youtube"),
          eq(publishJobs.status, "ready"),
        ),
      );
  }
}

/* --------------------------- thumbnail ----------------------------- */

export async function createThumbnail(
  jobId: string,
): Promise<{ ok: boolean; assetId?: string; url?: string; mode?: string; error?: string }> {
  const [job] = await db.select().from(productionJobs).where(eq(productionJobs.id, jobId));
  if (!job) return { ok: false, error: "Job not found" };
  const [draft] = await db.select().from(contentDrafts).where(eq(contentDrafts.jobId, jobId));
  const [ch] = await db.select().from(channels).where(eq(channels.id, job.channelId));

  const shots = (draft?.visualPlan ?? []) as { aiPrompt?: string; description?: string }[];
  const prompt =
    shots[0]?.aiPrompt ?? shots[0]?.description ?? draft?.hook ?? draft?.title ?? "thumbnail";

  const res = await generateThumbnail(jobId, {
    title: draft?.title ?? "",
    overlayText: (draft?.youtubeTitle || draft?.title || draft?.hook || "").slice(0, 70),
    accent: ch?.color ?? "#C6F135",
    channel: ch?.name ?? "Viboro",
    prompt,
  });
  if (res.status !== "generated") return { ok: false, error: res.error ?? "generation failed" };

  await db
    .delete(productionAssets)
    .where(and(eq(productionAssets.jobId, jobId), eq(productionAssets.kind, "thumbnail")));
  const [asset] = await db
    .insert(productionAssets)
    .values({
      jobId,
      stepKey: "thumbnail",
      kind: "thumbnail",
      prompt: prompt.slice(0, 500),
      provider: res.provider,
      model: res.model,
      status: "generated",
      url: res.url ?? null,
      filePath: res.filePath ?? null,
      mimeType: res.mimeType ?? "image/png",
      bytes: res.bytes ?? null,
      metadata: { mode: res.mode },
    })
    .returning();

  await saveYouTubeSettings(jobId, { thumbnailAssetId: asset.id });
  return { ok: true, assetId: asset.id, url: res.url, mode: res.mode };
}

/** Existing visual assets that can be promoted to a thumbnail. */
export async function thumbnailCandidates(jobId: string) {
  return db
    .select()
    .from(productionAssets)
    .where(eq(productionAssets.jobId, jobId))
    .orderBy(productionAssets.sceneNumber);
}

export async function selectThumbnail(jobId: string, assetId: string) {
  const [asset] = await db.select().from(productionAssets).where(eq(productionAssets.id, assetId));
  if (!asset || asset.jobId !== jobId) return { ok: false, error: "Asset not found for this job" };
  await saveYouTubeSettings(jobId, { thumbnailAssetId: assetId });
  return { ok: true };
}

/* --------------------------- connection ---------------------------- */

export async function youtubeAccountStatus(channelId: string) {
  return accountStatus(channelId);
}

export async function disconnectYouTube(channelId: string) {
  const res = await disconnect(channelId);
  await notify({
    severity: "warning",
    category: "publishing",
    title: "YouTube disconnected",
    body: res.detail,
    href: "/publishing",
    dedupeKey: `yt-disconnect:${channelId}:${Date.now()}`,
  });
  return res;
}

/**
 * Proactively verify stored authorizations. Marks revoked/expired grants
 * and raises a reconnect notification.
 */
export async function maintainTokens(): Promise<{ checked: number; expired: number }> {
  const accounts = await db
    .select()
    .from(publishAccounts)
    .where(eq(publishAccounts.platform, "youtube"));
  let expired = 0;
  for (const a of accounts) {
    if (!a.encryptedTokens || a.revokedAt) continue;
    if (!a.channelId) continue;
    const res = await getAccessToken(a.channelId);
    if (!res.ok && res.needsReconnect) {
      expired += 1;
      await notify({
        severity: "error",
        category: "publishing",
        title: "YouTube authorization expired",
        body: `${a.displayName || "YouTube account"} needs to be reconnected. ${res.reason}`.slice(0, 200),
        href: "/publishing",
        dedupeKey: `yt-expired:${a.channelId}:${new Date().toISOString().slice(0, 10)}`,
      });
    }
  }
  return { checked: accounts.length, expired };
}

/* --------------------------- analytics ----------------------------- */

export type YtRefreshReport = {
  posts: number;
  refreshed: number;
  skipped: number;
  reasons: string[];
};

/**
 * Pull real YouTube metrics for every published post and append a new
 * timestamped snapshot. Historical snapshots are never overwritten.
 */
export async function refreshYouTubeAnalytics(): Promise<YtRefreshReport> {
  const report: YtRefreshReport = { posts: 0, refreshed: 0, skipped: 0, reasons: [] };
  const posts = await db
    .select()
    .from(publishedPosts)
    .where(eq(publishedPosts.platform, "youtube"));
  report.posts = posts.length;
  if (posts.length === 0) return report;

  const adapter = adapterFor("youtube")!;
  for (const post of posts) {
    try {
      const metrics = await adapter.fetchMetrics(post.platformPostId, {
        channelId: post.channelId,
      });
      if (!metrics) {
        report.skipped += 1;
        report.reasons.push(`${post.platformPostId}: no metrics returned`);
        continue;
      }
      await db
        .insert(postMetrics)
        .values({
          postId: post.id,
          contentId: post.contentId,
          channelId: post.channelId,
          platform: "youtube",
          platformPostId: post.platformPostId,
          source: "youtube_api",
          measuredAt: new Date(),
          views: metrics.views,
          likes: metrics.likes,
          comments: metrics.comments,
          shares: metrics.shares,
          watchTimeSec: metrics.watchTimeSec,
          avgViewDurationSec: metrics.avgViewDurationSec,
          avgViewPercentageBp: metrics.avgViewPercentageBp,
          completionRateBp: metrics.avgViewPercentageBp,
          followersGained: metrics.followersGained,
          followersLost: metrics.followersLost,
          impressions: metrics.impressions,
          ctrBp: metrics.ctrBp,
          raw: metrics.raw,
        })
        .onConflictDoNothing();
      report.refreshed += 1;
    } catch (err) {
      report.skipped += 1;
      report.reasons.push(`${post.platformPostId}: ${redactUnknown(err)}`);
    }
  }

  if (report.refreshed > 0) {
    await notify({
      severity: "success",
      category: "analytics",
      title: "YouTube analytics refreshed",
      body: `${report.refreshed} video(s) updated with real platform metrics.`,
      href: "/creator-analytics",
      dedupeKey: `yt-analytics:${new Date().toISOString().slice(0, 13)}`,
    });
  } else if (report.posts > 0) {
    await notify({
      severity: "warning",
      category: "analytics",
      title: "YouTube analytics refresh failed",
      body: report.reasons[0]?.slice(0, 160) ?? "No metrics could be retrieved.",
      href: "/creator-analytics",
      dedupeKey: `yt-analytics-fail:${new Date().toISOString().slice(0, 13)}`,
    });
  }
  return report;
}

/** Latest snapshot per YouTube post — aggregation on top of history. */
export async function youtubeLatestMetrics() {
  const rows = await db
    .select()
    .from(postMetrics)
    .where(eq(postMetrics.platform, "youtube"))
    .orderBy(desc(postMetrics.measuredAt));
  const latest = new Map<string, (typeof rows)[number]>();
  for (const r of rows) if (!latest.has(r.platformPostId)) latest.set(r.platformPostId, r);
  return Array.from(latest.values());
}
