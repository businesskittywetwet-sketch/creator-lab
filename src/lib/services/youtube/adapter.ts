import { db } from "@/db";
import { publishJobs } from "@/db/schema";
import { eq } from "drizzle-orm";
import { redact, redactUnknown } from "@/lib/crypto";
import type {
  AccountPublishRequest,
  AccountState,
  ConnectionState,
  MetricsResult,
  PlatformAdapter,
  PlatformMeta,
  PublishOutcome,
} from "../platform-types";
import {
  accountStatus,
  getAccessToken,
  oauthReadiness,
  YOUTUBE_SCOPES,
} from "./oauth";
import {
  fetchImpressions,
  fetchOwnerAnalytics,
  fetchPublicStats,
  findVideoByMarker,
  getVideoStatus,
  initiateUpload,
  probeUploadOffset,
  uploadThumbnail,
  uploadVideoBytes,
  videoUrl,
  YouTubeApiError,
  type VideoMetadata,
} from "./api";

/* ------------------------------------------------------------------ */
/*  YouTube platform adapter — the first real publishing integration.  */
/*                                                                     */
/*  Everything here is genuine: OAuth-backed auth, resumable upload of */
/*  the actual MP4, thumbnail set, and confirmation via videos.list.   */
/*  A publish is only reported successful once YouTube returns a video */
/*  id AND that id is confirmed to exist.                              */
/* ------------------------------------------------------------------ */

export const youtubeMeta: PlatformMeta = {
  key: "youtube",
  label: "YouTube",
  short: "YT",
  hex: "#ff5c5c",
  envKeys: ["YOUTUBE_CLIENT_ID", "YOUTUBE_CLIENT_SECRET", "TOKEN_ENCRYPTION_KEY"],
  docsUrl: "https://developers.google.com/youtube/v3/guides/uploading_a_video",
  maxTitle: 100,
  maxCaption: 5000,
  aspect: "9:16",
  uploadImplemented: true,
  oauth: true,
  scopes: YOUTUBE_SCOPES,
};

export const youtubeAdapter: PlatformAdapter = {
  meta: youtubeMeta,

  /** App-level readiness (env only). Safe to call from a server component. */
  connection() {
    const readiness = oauthReadiness();
    if (readiness.issue === "missing_client_credentials") {
      return {
        state: "not_connected" as ConnectionState,
        missing: ["YOUTUBE_CLIENT_ID", "YOUTUBE_CLIENT_SECRET"].filter((k) => !process.env[k]),
        detail: readiness.detail,
      };
    }
    if (readiness.issue === "missing_encryption_key") {
      return {
        state: "credentials_required" as ConnectionState,
        missing: ["TOKEN_ENCRYPTION_KEY"],
        detail: readiness.detail,
      };
    }
    return {
      state: "credentials_required" as ConnectionState,
      missing: [],
      detail: "OAuth configured — connect a channel to finish authorization.",
    };
  },

  /** Account-level state (DB-backed OAuth). */
  async accountState(channelId: string): Promise<AccountState> {
    const s = await accountStatus(channelId);
    return {
      connected: s.connected,
      state: s.state,
      detail: s.detail,
      displayName: s.displayName,
      handle: s.handle,
      externalId: s.externalId,
      needsReconnect: s.needsReconnect,
      expiresAt: s.expiresAt ? new Date(s.expiresAt).toISOString() : null,
    };
  },

  async publish(req: AccountPublishRequest): Promise<PublishOutcome> {
    const readiness = oauthReadiness();
    if (!readiness.ready) {
      return { ok: false, kind: "blocked", reason: readiness.detail };
    }
    if (!req.channelId) {
      return { ok: false, kind: "blocked", reason: "Publish job has no channel context." };
    }
    const token = await getAccessToken(req.channelId);
    if (!token.ok) {
      return {
        ok: false,
        kind: "blocked",
        reason: token.reason,
        response: { needsReconnect: token.needsReconnect },
      };
    }
    if (!req.videoPath) {
      return { ok: false, kind: "blocked", reason: "No local video file to upload." };
    }

    const marker = `viboro-job:${req.jobId}`;
    const meta: VideoMetadata = {
      title: req.title.slice(0, 100),
      // The marker makes the upload idempotent: if a retry happens after a
      // partial success we can locate the existing video instead of
      // uploading a duplicate.
      description: `${req.description}\n\n${req.hashtags.map((h) => `#${h}`).join(" ")}\n\n[${marker}]`.trim(),
      tags: req.hashtags.slice(0, 60),
      categoryId: req.categoryId ?? "24",
      privacyStatus: (req.privacyStatus as VideoMetadata["privacyStatus"]) ?? "private",
      publishAt: req.publishAt ?? null,
    };

    try {
      /* ---- idempotency: never upload the same job twice ---- */
      const [existing] = await db
        .select()
        .from(publishJobs)
        .where(eq(publishJobs.id, req.jobId));
      if (existing?.platformPostId) {
        const status = await getVideoStatus(token.accessToken, existing.platformPostId);
        if (status) {
          return {
            ok: true,
            platformPostId: status.id,
            platformUrl: videoUrl(status.id),
            publishedAt: new Date().toISOString(),
            response: { reused: true, uploadStatus: status.uploadStatus },
          };
        }
      }
      const priorRemote = await findVideoByMarker(token.accessToken, marker);
      if (priorRemote) {
        return {
          ok: true,
          platformPostId: priorRemote,
          platformUrl: videoUrl(priorRemote),
          publishedAt: new Date().toISOString(),
          response: { reused: true, foundBy: "marker" },
        };
      }

      /* ---- resumable upload (resume if a session already exists) ---- */
      const { size } = await import("node:fs/promises").then((m) => m.stat(req.videoPath!));
      let sessionUrl = existing?.uploadSessionUrl ?? null;
      let offset = 0;

      if (sessionUrl) {
        try {
          const probe = await probeUploadOffset(sessionUrl, size);
          if (probe.done && probe.videoId) {
            return {
              ok: true,
              platformPostId: probe.videoId,
              platformUrl: videoUrl(probe.videoId),
              publishedAt: new Date().toISOString(),
              response: { resumed: true, completedByProbe: true },
            };
          }
          offset = probe.offset;
        } catch {
          sessionUrl = null; // stale session — start a fresh one
        }
      }

      if (!sessionUrl) {
        sessionUrl = await initiateUpload(token.accessToken, meta, size);
        offset = 0;
        await db
          .update(publishJobs)
          .set({ uploadSessionUrl: sessionUrl, uploadState: "uploading", idempotencyKey: marker })
          .where(eq(publishJobs.id, req.jobId));
      }

      const result = await uploadVideoBytes(sessionUrl, req.videoPath, {
        offset,
        onProgress: req.onProgress,
      });

      /* ---- confirm the video actually exists remotely ---- */
      const confirmed = await getVideoStatus(token.accessToken, result.videoId);
      if (!confirmed) {
        return {
          ok: false,
          kind: "failed",
          reason: "Upload returned an id but the video could not be confirmed on YouTube.",
        };
      }

      /* ---- thumbnail (non-fatal) ---- */
      let thumb: { ok: boolean; reason?: string } = { ok: false, reason: "no thumbnail supplied" };
      if (req.thumbnailPath) {
        thumb = await uploadThumbnail(token.accessToken, result.videoId, req.thumbnailPath);
      }

      await db
        .update(publishJobs)
        .set({
          uploadState: "complete",
          uploadProgressBp: 10000,
          uploadSessionUrl: null,
          thumbnailStatus: req.thumbnailPath ? (thumb.ok ? "uploaded" : "failed") : "none",
          thumbnailError: thumb.ok ? null : (thumb.reason ?? null)?.slice(0, 300) ?? null,
        })
        .where(eq(publishJobs.id, req.jobId));

      return {
        ok: true,
        platformPostId: result.videoId,
        platformUrl: videoUrl(result.videoId),
        publishedAt: new Date().toISOString(),
        response: {
          uploadStatus: confirmed.uploadStatus,
          privacyStatus: confirmed.privacyStatus,
          processingStatus: confirmed.processingStatus,
          scheduledPublishAt: confirmed.publishAt,
          thumbnail: thumb.ok ? "uploaded" : thumb.reason,
        },
      };
    } catch (err) {
      const retryable = err instanceof YouTubeApiError ? err.retryable : true;
      const reason = redactUnknown(err);
      await db
        .update(publishJobs)
        .set({ uploadState: "failed" })
        .where(eq(publishJobs.id, req.jobId));
      return {
        ok: false,
        kind: "failed",
        reason,
        response: { retryable, status: err instanceof YouTubeApiError ? err.status : 0 },
      };
    }
  },

  async fetchMetrics(platformPostId: string, ctx): Promise<MetricsResult> {
    if (!ctx?.channelId) return null;
    const token = await getAccessToken(ctx.channelId);
    if (!token.ok) return null;
    try {
      const [pub, owner, imp] = await Promise.all([
        fetchPublicStats(token.accessToken, platformPostId).catch(() => null),
        fetchOwnerAnalytics(token.accessToken, platformPostId).catch(() => null),
        fetchImpressions(token.accessToken, platformPostId).catch(() => ({
          impressions: null,
          ctrBp: null,
        })),
      ]);
      if (!pub && !owner) return null;
      // Owner analytics is authoritative where present; public stats fill gaps.
      return {
        views: owner?.views ?? pub?.views ?? 0,
        likes: owner?.likes ?? pub?.likes ?? 0,
        comments: owner?.comments ?? pub?.comments ?? 0,
        shares: owner?.shares ?? 0,
        watchTimeSec: owner?.watchTimeSec ?? null,
        avgViewDurationSec: owner?.avgViewDurationSec ?? null,
        avgViewPercentageBp: owner?.avgViewPercentageBp ?? null,
        followersGained: owner?.subscribersGained ?? null,
        followersLost: owner?.subscribersLost ?? null,
        impressions: imp.impressions,
        ctrBp: imp.ctrBp,
        raw: { source: "youtube", hasOwnerAnalytics: Boolean(owner) },
      };
    } catch (err) {
      console.warn(`[youtube] metrics failed: ${redact(redactUnknown(err))}`);
      return null;
    }
  },
};
