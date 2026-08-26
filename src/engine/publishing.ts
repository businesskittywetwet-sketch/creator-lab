import { db } from "@/db";
import {
  channelStrategy,
  channels,
  content,
  contentDrafts,
  productionAssets,
  productionJobs,
  publishAccounts,
  publishAttempts,
  publishJobs,
  publishedPosts,
} from "@/db/schema";
import { and, asc, eq, inArray, lte, sql } from "drizzle-orm";
import { accountStateFor, adapterFor, connectionFor, PLATFORMS } from "@/lib/services/platforms";
import { notify } from "./notifications";
import { stat } from "node:fs/promises";
import path from "node:path";

/* ------------------------------------------------------------------ */
/*  PUBLISHING ENGINE                                                  */
/*                                                                     */
/*  Safety-first: a post is only ever marked `published` when a real   */
/*  platform adapter confirms it. Every dispatch — including blocked   */
/*  ones — is written to publish_attempts as an audit record.          */
/* ------------------------------------------------------------------ */

export async function ensureChannelStrategy(channelId: string) {
  const [existing] = await db
    .select()
    .from(channelStrategy)
    .where(eq(channelStrategy.channelId, channelId));
  if (existing) return existing;
  const [ch] = await db.select().from(channels).where(eq(channels.id, channelId));
  const [created] = await db
    .insert(channelStrategy)
    .values({
      channelId,
      platforms: ch?.targetPlatforms ?? [],
      // Safety default: humans approve, nothing auto-publishes.
      requireApproval: true,
      autoPublish: false,
    })
    .onConflictDoNothing()
    .returning();
  if (created) return created;
  const [again] = await db
    .select()
    .from(channelStrategy)
    .where(eq(channelStrategy.channelId, channelId));
  return again;
}

export type StrategyInput = {
  postsPerWeek: number;
  postingWindows: string[];
  timezone: string;
  platforms: string[];
  hashtagStrategy: string;
  defaultHashtags: string[];
  requireApproval: boolean;
  autoPublish: boolean;
  minQcScore: number;
};

export async function updateChannelStrategy(channelId: string, input: Partial<StrategyInput>) {
  await ensureChannelStrategy(channelId);
  await db
    .update(channelStrategy)
    .set({ ...input, updatedAt: new Date() })
    .where(eq(channelStrategy.channelId, channelId));
}

/* --------------------------- account wiring ------------------------ */

/** Reconcile publish_accounts rows against channel strategy platforms. */
export async function syncAccountsForChannel(channelId: string) {
  const strategy = await ensureChannelStrategy(channelId);
  const [ch] = await db.select().from(channels).where(eq(channels.id, channelId));
  const wanted = strategy.platforms.length ? strategy.platforms : (ch?.targetPlatforms ?? []);
  for (const platform of wanted) {
    if (!PLATFORMS.some((p) => p.key === platform)) continue;
    const conn = connectionFor(platform);
    await db
      .insert(publishAccounts)
      .values({
        channelId,
        platform,
        displayName: `${ch?.name ?? "Channel"} · ${platform}`,
        handle: ch?.slug ?? "",
        credentialRef: (adapterFor(platform)?.meta.envKeys ?? []).join(","),
        status: conn.state === "connected" ? "connected" : conn.state,
        lastCheckedAt: new Date(),
        lastError: conn.state === "connected" ? null : conn.detail,
      })
      .onConflictDoUpdate({
        target: [publishAccounts.channelId, publishAccounts.platform],
        set: {
          status: conn.state === "connected" ? "connected" : conn.state,
          lastCheckedAt: new Date(),
          lastError: conn.state === "connected" ? null : conn.detail,
        },
      });
  }
}

export async function refreshAllAccounts() {
  const rows = await db.select({ id: channels.id }).from(channels);
  for (const r of rows) await syncAccountsForChannel(r.id);
}

/* ----------------------------- preflight --------------------------- */

export type Preflight = { ok: boolean; reasons: string[]; warnings: string[] };

/**
 * Hard safety gate. Every condition must hold before a publish job can
 * leave `ready`/`scheduled` and be dispatched to a platform.
 */
export async function preflight(jobId: string): Promise<Preflight> {
  const reasons: string[] = [];
  const warnings: string[] = [];

  const [job] = await db.select().from(publishJobs).where(eq(publishJobs.id, jobId));
  if (!job) return { ok: false, reasons: ["Publish job not found."], warnings };

  const [draft] = job.draftId
    ? await db.select().from(contentDrafts).where(eq(contentDrafts.id, job.draftId))
    : await db.select().from(contentDrafts).where(eq(contentDrafts.contentId, job.contentId));
  const strategy = await ensureChannelStrategy(job.channelId);

  // 1. draft approved
  if (!draft) reasons.push("No draft is attached to this content.");
  else if (strategy.requireApproval && draft.status !== "approved")
    reasons.push(`Draft is not approved (status: ${draft.status}).`);

  // 2. QC passed
  if (draft) {
    const qc = (draft.qcReport ?? {}) as Record<string, unknown>;
    if (Object.keys(qc).length === 0) reasons.push("No QC report attached to the draft.");
    else if (qc.blocksApproval === true)
      reasons.push(`QC reported ${Number(qc.criticalCount ?? 0)} critical finding(s).`);
    if (draft.qcScore < strategy.minQcScore)
      reasons.push(`QC score ${draft.qcScore} is below the channel minimum of ${strategy.minQcScore}.`);
  }

  // 3+4. video exists and is playable
  let videoOk = false;
  const [videoAsset] = await db
    .select()
    .from(productionAssets)
    .innerJoin(productionJobs, eq(productionAssets.jobId, productionJobs.id))
    .where(
      and(
        eq(productionJobs.contentId, job.contentId),
        eq(productionAssets.kind, "video"),
        eq(productionAssets.status, "generated"),
      ),
    )
    .limit(1)
    .then((r) => r.map((x) => x.production_assets));
  if (!videoAsset) reasons.push("No generated video asset exists for this content.");
  else {
    const p =
      videoAsset.filePath ??
      (videoAsset.url ? path.join(process.cwd(), "public", videoAsset.url) : null);
    if (!p) reasons.push("Video asset has no resolvable file path.");
    else {
      try {
        const st = await stat(p);
        if (st.size < 1024) reasons.push("Video file is present but appears empty/unplayable.");
        else videoOk = true;
      } catch {
        reasons.push("Video file is missing from disk.");
      }
    }
    if (!videoAsset.durationSec) warnings.push("Video duration is unknown.");
  }

  // 5. required metadata
  if (!job.title.trim()) reasons.push("Missing title.");
  if (!job.caption.trim() && !job.description.trim())
    reasons.push("Missing caption/description.");
  const meta = PLATFORMS.find((p) => p.key === job.platform);
  if (meta) {
    if (job.title.length > meta.maxTitle)
      reasons.push(`Title exceeds ${meta.label} limit of ${meta.maxTitle} characters.`);
    if (job.caption.length > meta.maxCaption)
      reasons.push(`Caption exceeds ${meta.label} limit of ${meta.maxCaption} characters.`);
  }

  // 6. platform account connected (OAuth-aware)
  const acct = await accountStateFor(job.platform, job.channelId);
  if (acct) {
    if (!acct.connected) reasons.push(acct.detail);
  } else {
    const conn = connectionFor(job.platform);
    if (conn.state !== "connected") reasons.push(conn.detail);
  }

  // 7. schedule validity
  if (job.status === "scheduled") {
    if (!job.scheduledAt) reasons.push("Job is scheduled but has no scheduled time.");
    else if (+new Date(job.scheduledAt) > Date.now() + 60_000)
      reasons.push(`Scheduled for ${new Date(job.scheduledAt).toISOString()} — not due yet.`);
  }

  // 8. duplicate protection
  if (job.status === "published") reasons.push("This job has already been published.");
  const [dupe] = await db
    .select({ id: publishedPosts.id })
    .from(publishedPosts)
    .where(
      and(eq(publishedPosts.contentId, job.contentId), eq(publishedPosts.platform, job.platform)),
    );
  if (dupe) reasons.push("This content is already published on this platform.");

  void videoOk;
  return { ok: reasons.length === 0, reasons, warnings };
}

/* --------------------------- job lifecycle ------------------------- */

function buildCaption(draft: typeof contentDrafts.$inferSelect | undefined, tags: string[]) {
  const base = draft?.socialCaption?.trim() || draft?.hook?.trim() || draft?.title?.trim() || "";
  const tagLine = tags.length ? `\n\n${tags.map((t) => (t.startsWith("#") ? t : `#${t}`)).join(" ")}` : "";
  return `${base}${tagLine}`.trim();
}

/** Create publish jobs for an approved draft, one per strategy platform. */
export async function createPublishJobsForContent(
  contentId: string,
  opts: { scheduledAt?: Date | null } = {},
): Promise<{ created: number; jobIds: string[]; skipped: string[] }> {
  const [item] = await db.select().from(content).where(eq(content.id, contentId));
  if (!item) return { created: 0, jobIds: [], skipped: ["content not found"] };

  const [draft] = await db
    .select()
    .from(contentDrafts)
    .where(eq(contentDrafts.contentId, contentId));
  const strategy = await ensureChannelStrategy(item.channelId);
  const [ch] = await db.select().from(channels).where(eq(channels.id, item.channelId));
  await syncAccountsForChannel(item.channelId);

  const skipped: string[] = [];
  if (strategy.requireApproval && draft?.status !== "approved") {
    return { created: 0, jobIds: [], skipped: ["Draft is not approved — publish jobs not created."] };
  }

  const platforms = strategy.platforms.length ? strategy.platforms : (ch?.targetPlatforms ?? []);
  const [videoAsset] = await db
    .select()
    .from(productionAssets)
    .innerJoin(productionJobs, eq(productionAssets.jobId, productionJobs.id))
    .where(
      and(
        eq(productionJobs.contentId, contentId),
        eq(productionAssets.kind, "video"),
        eq(productionAssets.status, "generated"),
      ),
    )
    .limit(1)
    .then((r) => r.map((x) => x.production_assets));

  const tags = draft?.hashtags?.length ? draft.hashtags : strategy.defaultHashtags;
  const jobIds: string[] = [];
  let created = 0;

  for (const platform of platforms) {
    if (!PLATFORMS.some((p) => p.key === platform)) {
      skipped.push(`${platform}: no adapter registered`);
      continue;
    }
    const [account] = await db
      .select()
      .from(publishAccounts)
      .where(
        and(eq(publishAccounts.channelId, item.channelId), eq(publishAccounts.platform, platform)),
      );
    const meta = PLATFORMS.find((p) => p.key === platform)!;
    const [row] = await db
      .insert(publishJobs)
      .values({
        contentId,
        draftId: draft?.id ?? null,
        channelId: item.channelId,
        accountId: account?.id ?? null,
        platform,
        videoAssetId: videoAsset?.id ?? null,
        title: (draft?.title || item.title).slice(0, meta.maxTitle),
        description: draft?.description ?? "",
        caption: buildCaption(draft, tags).slice(0, meta.maxCaption),
        hashtags: tags,
        status: opts.scheduledAt ? "scheduled" : "ready",
        scheduledAt: opts.scheduledAt ?? null,
      })
      .onConflictDoNothing({ target: [publishJobs.contentId, publishJobs.platform] })
      .returning();
    if (row) {
      created += 1;
      jobIds.push(row.id);
      const pf = await preflight(row.id);
      await db
        .update(publishJobs)
        .set({ blockedReasons: pf.reasons, updatedAt: new Date() })
        .where(eq(publishJobs.id, row.id));
    } else {
      skipped.push(`${platform}: job already exists`);
    }
  }

  if (created > 0) {
    await notify({
      severity: "info",
      category: "publishing",
      title: `${created} publish job(s) prepared`,
      body: `${ch?.name ?? "Channel"} — ${item.title.slice(0, 70)}`,
      href: "/publishing",
      dedupeKey: `pubjobs:${contentId}`,
    });
  }
  return { created, jobIds, skipped };
}

export async function schedulePublishJob(jobId: string, when: Date) {
  if (Number.isNaN(when.getTime())) throw new Error("Invalid scheduled time");
  if (when.getTime() < Date.now() - 60_000)
    throw new Error("Scheduled time is in the past");
  await db
    .update(publishJobs)
    .set({ scheduledAt: when, status: "scheduled", error: null, updatedAt: new Date() })
    .where(eq(publishJobs.id, jobId));
}

export async function cancelPublishJob(jobId: string) {
  await db
    .update(publishJobs)
    .set({ status: "cancelled", updatedAt: new Date() })
    .where(eq(publishJobs.id, jobId));
}

/* ----------------------------- dispatch ---------------------------- */

export type DispatchResult = {
  jobId: string;
  status: string;
  ok: boolean;
  reason?: string;
  platformUrl?: string;
};

/**
 * Attempt to publish one job. Always records an attempt row. Only a
 * confirmed adapter success transitions the job to `published`.
 */
export async function dispatchPublishJob(
  jobId: string,
  opts: { trigger?: string } = {},
): Promise<DispatchResult> {
  const started = Date.now();
  const [job] = await db.select().from(publishJobs).where(eq(publishJobs.id, jobId));
  if (!job) return { jobId, status: "missing", ok: false, reason: "job not found" };
  if (job.status === "published")
    return { jobId, status: "published", ok: true, reason: "already published" };
  if (job.status === "cancelled")
    return { jobId, status: "cancelled", ok: false, reason: "job is cancelled" };

  const attempt = job.attemptCount + 1;
  const pf = await preflight(jobId);
  if (!pf.ok) {
    await db.insert(publishAttempts).values({
      jobId,
      attempt,
      outcome: "blocked",
      platform: job.platform,
      adapter: job.platform,
      requestSummary: { title: job.title, trigger: opts.trigger ?? "manual" },
      responseSummary: { blocked: pf.reasons },
      error: pf.reasons[0],
      durationMs: Date.now() - started,
    });
    await db
      .update(publishJobs)
      .set({
        attemptCount: attempt,
        blockedReasons: pf.reasons,
        error: pf.reasons[0],
        updatedAt: new Date(),
      })
      .where(eq(publishJobs.id, jobId));
    return { jobId, status: job.status, ok: false, reason: pf.reasons[0] };
  }

  await db
    .update(publishJobs)
    .set({ status: "publishing", updatedAt: new Date() })
    .where(eq(publishJobs.id, jobId));

  const adapter = adapterFor(job.platform)!;
  const [videoAsset] = job.videoAssetId
    ? await db.select().from(productionAssets).where(eq(productionAssets.id, job.videoAssetId))
    : [];

  // Resolve an optional thumbnail asset for this job.
  const [thumbAsset] = job.thumbnailAssetId
    ? await db.select().from(productionAssets).where(eq(productionAssets.id, job.thumbnailAssetId))
    : [];

  // Native platform-side scheduling: if the job is scheduled in the future
  // we hand the timestamp to the platform instead of publishing immediately.
  const publishAt =
    job.scheduledAt && +new Date(job.scheduledAt) > Date.now()
      ? new Date(job.scheduledAt).toISOString()
      : null;

  await db
    .update(publishJobs)
    .set({ uploadState: "initiating", uploadProgressBp: 0 })
    .where(eq(publishJobs.id, jobId));
  await notify({
    severity: "info",
    category: "publishing",
    title: `Upload started · ${job.platform}`,
    body: job.title.slice(0, 90),
    href: "/publishing",
    dedupeKey: `upstart:${jobId}:${attempt}`,
  });

  let lastPct = -1;
  let outcome;
  try {
    outcome = await adapter.publish({
      jobId,
      platform: job.platform,
      channelId: job.channelId,
      title: job.title,
      description: job.description,
      caption: job.caption,
      hashtags: job.hashtags,
      videoPath: videoAsset?.filePath ?? null,
      videoUrl: videoAsset?.url ?? null,
      thumbnailPath: thumbAsset?.filePath ?? null,
      scheduledAt: job.scheduledAt,
      publishAt,
      privacyStatus: job.privacyStatus,
      categoryId: job.categoryId,
      accountRef: job.accountId ?? "",
      onProgress: (sent, total) => {
        const bp = Math.min(10000, Math.round((sent / Math.max(1, total)) * 10000));
        const pct = Math.floor(bp / 500);
        if (pct !== lastPct) {
          lastPct = pct;
          void db
            .update(publishJobs)
            .set({ uploadProgressBp: bp, uploadState: "uploading" })
            .where(eq(publishJobs.id, jobId))
            .catch(() => {});
        }
      },
    });
  } catch (err) {
    outcome = {
      ok: false as const,
      kind: "failed" as const,
      reason: err instanceof Error ? err.message : String(err),
    };
  }

  if (outcome.ok) {
    await db.insert(publishAttempts).values({
      jobId,
      attempt,
      outcome: "success",
      platform: job.platform,
      adapter: job.platform,
      requestSummary: { title: job.title, trigger: opts.trigger ?? "manual" },
      responseSummary: outcome.response ?? {},
      durationMs: Date.now() - started,
    });
    await db
      .update(publishJobs)
      .set({
        status: "published",
        publishedAt: new Date(outcome.publishedAt),
        platformPostId: outcome.platformPostId,
        platformUrl: outcome.platformUrl,
        attemptCount: attempt,
        error: null,
        blockedReasons: [],
        updatedAt: new Date(),
      })
      .where(eq(publishJobs.id, jobId));
    await db
      .insert(publishedPosts)
      .values({
        jobId,
        contentId: job.contentId,
        channelId: job.channelId,
        platform: job.platform,
        platformPostId: outcome.platformPostId,
        platformUrl: outcome.platformUrl,
        title: job.title,
        publishedAt: new Date(outcome.publishedAt),
      })
      .onConflictDoNothing();
    await db
      .update(content)
      .set({ stage: "published", publishedAt: new Date(), updatedAt: new Date() })
      .where(eq(content.id, job.contentId));
    await db
      .update(publishJobs)
      .set({ uploadState: "complete", uploadProgressBp: 10000 })
      .where(eq(publishJobs.id, jobId));
    await notify({
      severity: "success",
      category: "publishing",
      title: `Upload completed · published to ${job.platform}`,
      body: `${job.title.slice(0, 70)} → ${outcome.platformUrl}`,
      href: "/publishing",
      dedupeKey: `published:${jobId}`,
    });
    return { jobId, status: "published", ok: true, platformUrl: outcome.platformUrl };
  }

  const blocked = outcome.kind === "blocked";
  await db.insert(publishAttempts).values({
    jobId,
    attempt,
    outcome: blocked ? "blocked" : "failed",
    platform: job.platform,
    adapter: job.platform,
    requestSummary: { title: job.title, trigger: opts.trigger ?? "manual" },
    responseSummary: outcome.response ?? {},
    error: outcome.reason,
    durationMs: Date.now() - started,
  });
  await db
    .update(publishJobs)
    .set({
      // A blocked job stays actionable; a real failure is marked failed.
      status: blocked ? (job.scheduledAt ? "scheduled" : "ready") : "failed",
      attemptCount: attempt,
      error: outcome.reason,
      blockedReasons: blocked ? [outcome.reason] : [],
      updatedAt: new Date(),
    })
    .where(eq(publishJobs.id, jobId));
  const needsReconnect = Boolean(
    (outcome.response as Record<string, unknown> | undefined)?.needsReconnect,
  );
  await notify({
    severity: blocked ? "warning" : "error",
    category: "publishing",
    title: needsReconnect
      ? `Reconnect required · ${job.platform}`
      : blocked
        ? `Publishing unavailable · ${job.platform}`
        : `Upload failed · ${job.platform}`,
    body: outcome.reason.slice(0, 140),
    href: "/publishing",
    dedupeKey: `pubfail:${jobId}:${attempt}`,
  });
  return { jobId, status: blocked ? "blocked" : "failed", ok: false, reason: outcome.reason };
}

export async function retryPublish(jobId: string) {
  await db
    .update(publishJobs)
    .set({ status: "ready", error: null, updatedAt: new Date() })
    .where(eq(publishJobs.id, jobId));
  return dispatchPublishJob(jobId, { trigger: "retry" });
}

/** Cron entry: dispatch scheduled jobs that are due, if auto-publish is on. */
export async function processDuePublishJobs(limit = 5): Promise<DispatchResult[]> {
  const due = await db
    .select()
    .from(publishJobs)
    .where(and(eq(publishJobs.status, "scheduled"), lte(publishJobs.scheduledAt, new Date())))
    .orderBy(asc(publishJobs.scheduledAt))
    .limit(limit);

  const out: DispatchResult[] = [];
  for (const job of due) {
    const strategy = await ensureChannelStrategy(job.channelId);
    if (!strategy.autoPublish) {
      out.push({
        jobId: job.id,
        status: "held",
        ok: false,
        reason: "Auto-publish is disabled for this channel — awaiting manual dispatch.",
      });
      continue;
    }
    out.push(await dispatchPublishJob(job.id, { trigger: "schedule" }));
  }
  return out;
}

export async function publishJobCounts() {
  const rows = await db
    .select({ status: publishJobs.status, n: sql<number>`count(*)::int` })
    .from(publishJobs)
    .groupBy(publishJobs.status);
  return Object.fromEntries(rows.map((r) => [r.status, r.n])) as Record<string, number>;
}

export { PLATFORMS, connectionFor, accountStateFor, inArray };
