import { createReadStream } from "node:fs";
import { stat, readFile } from "node:fs/promises";
import { redact } from "@/lib/crypto";

/* ------------------------------------------------------------------ */
/*  YouTube Data API v3 + YouTube Analytics API v2 (server-only).      */
/*                                                                     */
/*  Implements a genuine resumable upload session:                     */
/*    1. POST /upload/...?uploadType=resumable  -> session URI         */
/*    2. PUT  <session URI> with the MP4 body                          */
/*    3. On interruption, query Content-Range to resume from an offset */
/*                                                                     */
/*  All error text is redacted before it leaves this module.           */
/* ------------------------------------------------------------------ */

const UPLOAD_URL =
  "https://www.googleapis.com/upload/youtube/v3/videos?uploadType=resumable&part=snippet,status";
const VIDEOS_URL = "https://www.googleapis.com/youtube/v3/videos";
const THUMB_URL = "https://www.googleapis.com/upload/youtube/v3/thumbnails/set";
const ANALYTICS_URL = "https://youtubeanalytics.googleapis.com/v2/reports";

export type YtError = { status: number; message: string; retryable: boolean };

export class YouTubeApiError extends Error {
  status: number;
  retryable: boolean;
  constructor(status: number, message: string) {
    super(redact(message));
    this.status = status;
    // 5xx and 429 are transient; 401/403 need auth attention; 4xx are permanent.
    this.retryable = status === 429 || status >= 500 || status === 0;
  }
}

async function readError(res: Response): Promise<string> {
  const text = await res.text().catch(() => "");
  try {
    const j = JSON.parse(text) as { error?: { message?: string; errors?: { reason?: string }[] } };
    const reason = j.error?.errors?.[0]?.reason;
    return redact(`${j.error?.message ?? text.slice(0, 200)}${reason ? ` (${reason})` : ""}`);
  } catch {
    return redact(text.slice(0, 200) || `HTTP ${res.status}`);
  }
}

export type VideoMetadata = {
  title: string;
  description: string;
  tags: string[];
  categoryId: string;
  privacyStatus: "private" | "unlisted" | "public";
  /** RFC3339; when set with privacyStatus=private, YouTube auto-publishes */
  publishAt?: string | null;
};

/* ------------------------- resumable upload ------------------------ */

/** Step 1 — open a resumable session and return its URI. */
export async function initiateUpload(
  accessToken: string,
  meta: VideoMetadata,
  fileSize: number,
): Promise<string> {
  const body = {
    snippet: {
      title: meta.title.slice(0, 100),
      description: meta.description.slice(0, 5000),
      tags: meta.tags.slice(0, 60),
      categoryId: meta.categoryId,
    },
    status: {
      privacyStatus: meta.publishAt ? "private" : meta.privacyStatus,
      ...(meta.publishAt ? { publishAt: meta.publishAt } : {}),
      selfDeclaredMadeForKids: false,
    },
  };
  const res = await fetch(UPLOAD_URL, {
    method: "POST",
    headers: {
      authorization: `Bearer ${accessToken}`,
      "content-type": "application/json; charset=UTF-8",
      "X-Upload-Content-Length": String(fileSize),
      "X-Upload-Content-Type": "video/mp4",
    },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(60_000),
  });
  if (!res.ok) throw new YouTubeApiError(res.status, await readError(res));
  const location = res.headers.get("location");
  if (!location) throw new YouTubeApiError(0, "Upload session URI missing from response.");
  return location;
}

/** Query how many bytes the server already has (for resume). */
export async function probeUploadOffset(
  sessionUrl: string,
  fileSize: number,
): Promise<{ done: boolean; offset: number; videoId?: string }> {
  const res = await fetch(sessionUrl, {
    method: "PUT",
    headers: { "content-range": `bytes */${fileSize}`, "content-length": "0" },
    signal: AbortSignal.timeout(30_000),
  });
  if (res.status === 200 || res.status === 201) {
    const json = (await res.json().catch(() => ({}))) as { id?: string };
    return { done: true, offset: fileSize, videoId: json.id };
  }
  if (res.status === 308) {
    const range = res.headers.get("range");
    const offset = range ? Number(range.split("-")[1]) + 1 : 0;
    return { done: false, offset: Number.isFinite(offset) ? offset : 0 };
  }
  throw new YouTubeApiError(res.status, await readError(res));
}

export type UploadResult = { videoId: string; response: Record<string, unknown> };

/** Step 2 — stream the MP4 into the session (supports resume offset). */
export async function uploadVideoBytes(
  sessionUrl: string,
  filePath: string,
  opts: { offset?: number; onProgress?: (sentBytes: number, total: number) => void } = {},
): Promise<UploadResult> {
  const { size } = await stat(filePath);
  const offset = opts.offset ?? 0;
  if (offset >= size) {
    const probe = await probeUploadOffset(sessionUrl, size);
    if (probe.done && probe.videoId) return { videoId: probe.videoId, response: {} };
  }

  const stream = createReadStream(filePath, { start: offset });
  let sent = offset;
  if (opts.onProgress) {
    stream.on("data", (chunk: string | Buffer) => {
      sent += typeof chunk === "string" ? Buffer.byteLength(chunk) : chunk.length;
      opts.onProgress?.(sent, size);
    });
  }

  const headers: Record<string, string> = {
    "content-type": "video/mp4",
    "content-length": String(size - offset),
  };
  if (offset > 0) headers["content-range"] = `bytes ${offset}-${size - 1}/${size}`;

  const res = await fetch(sessionUrl, {
    method: "PUT",
    headers,
    // Node streams are valid fetch bodies; duplex is required for them.
    body: stream as unknown as BodyInit,
    // @ts-expect-error node-specific fetch option
    duplex: "half",
    signal: AbortSignal.timeout(15 * 60_000),
  });

  if (res.status === 308) {
    throw new YouTubeApiError(308, "Upload incomplete — resumable session still open.");
  }
  if (!res.ok) throw new YouTubeApiError(res.status, await readError(res));
  const json = (await res.json()) as Record<string, unknown> & { id?: string };
  if (!json.id) throw new YouTubeApiError(0, "Upload succeeded but no video id was returned.");
  return { videoId: json.id, response: json };
}

/* ---------------------------- thumbnail ---------------------------- */

export async function uploadThumbnail(
  accessToken: string,
  videoId: string,
  imagePath: string,
): Promise<{ ok: true } | { ok: false; reason: string }> {
  try {
    const buf = await readFile(imagePath);
    if (buf.length > 2 * 1024 * 1024) {
      return { ok: false, reason: "Thumbnail exceeds the 2MB YouTube limit." };
    }
    const res = await fetch(`${THUMB_URL}?videoId=${encodeURIComponent(videoId)}`, {
      method: "POST",
      headers: {
        authorization: `Bearer ${accessToken}`,
        "content-type": imagePath.endsWith(".png") ? "image/png" : "image/jpeg",
        "content-length": String(buf.length),
      },
      body: new Uint8Array(buf),
      signal: AbortSignal.timeout(120_000),
    });
    if (!res.ok) return { ok: false, reason: await readError(res) };
    return { ok: true };
  } catch (err) {
    return { ok: false, reason: redact(err instanceof Error ? err.message : String(err)) };
  }
}

/* ---------------------------- verification ------------------------- */

export type VideoStatus = {
  id: string;
  uploadStatus: string;
  privacyStatus: string;
  processingStatus?: string;
  title: string;
  publishAt?: string | null;
};

/** Confirm the remote video exists — the only proof a publish succeeded. */
export async function getVideoStatus(
  accessToken: string,
  videoId: string,
): Promise<VideoStatus | null> {
  const url = `${VIDEOS_URL}?part=status,snippet,processingDetails&id=${encodeURIComponent(videoId)}`;
  const res = await fetch(url, {
    headers: { authorization: `Bearer ${accessToken}` },
    signal: AbortSignal.timeout(30_000),
  });
  if (!res.ok) throw new YouTubeApiError(res.status, await readError(res));
  const json = (await res.json()) as {
    items?: {
      id: string;
      status?: { uploadStatus?: string; privacyStatus?: string; publishAt?: string };
      snippet?: { title?: string };
      processingDetails?: { processingStatus?: string };
    }[];
  };
  const item = json.items?.[0];
  if (!item) return null;
  return {
    id: item.id,
    uploadStatus: item.status?.uploadStatus ?? "unknown",
    privacyStatus: item.status?.privacyStatus ?? "unknown",
    processingStatus: item.processingDetails?.processingStatus,
    title: item.snippet?.title ?? "",
    publishAt: item.status?.publishAt ?? null,
  };
}

/** Find an existing upload by idempotency marker in the description. */
export async function findVideoByMarker(
  accessToken: string,
  marker: string,
): Promise<string | null> {
  const url = `https://www.googleapis.com/youtube/v3/search?part=id&forMine=true&type=video&maxResults=25&q=${encodeURIComponent(marker)}`;
  const res = await fetch(url, {
    headers: { authorization: `Bearer ${accessToken}` },
    signal: AbortSignal.timeout(30_000),
  });
  if (!res.ok) return null;
  const json = (await res.json()) as { items?: { id?: { videoId?: string } }[] };
  return json.items?.[0]?.id?.videoId ?? null;
}

/* ----------------------------- analytics --------------------------- */

export type YouTubeMetrics = {
  views: number;
  likes: number;
  comments: number;
  shares: number;
  watchTimeSec: number;
  avgViewDurationSec: number;
  avgViewPercentageBp: number | null;
  subscribersGained: number;
  subscribersLost: number;
  impressions: number | null;
  ctrBp: number | null;
};

/** Public counts from the Data API (always available to the owner). */
export async function fetchPublicStats(
  accessToken: string,
  videoId: string,
): Promise<Partial<YouTubeMetrics> | null> {
  const url = `${VIDEOS_URL}?part=statistics&id=${encodeURIComponent(videoId)}`;
  const res = await fetch(url, {
    headers: { authorization: `Bearer ${accessToken}` },
    signal: AbortSignal.timeout(30_000),
  });
  if (!res.ok) throw new YouTubeApiError(res.status, await readError(res));
  const json = (await res.json()) as {
    items?: { statistics?: Record<string, string> }[];
  };
  const s = json.items?.[0]?.statistics;
  if (!s) return null;
  const n = (v?: string) => (v == null ? 0 : Number(v) || 0);
  return {
    views: n(s.viewCount),
    likes: n(s.likeCount),
    comments: n(s.commentCount),
  };
}

/**
 * Owner analytics (watch time, retention, CTR, subscriber deltas).
 * Some metrics are unavailable for very new or low-traffic videos —
 * those come back absent and are stored as NULL rather than zero.
 */
export async function fetchOwnerAnalytics(
  accessToken: string,
  videoId: string,
  opts: { startDate?: string; endDate?: string } = {},
): Promise<Partial<YouTubeMetrics> | null> {
  const end = opts.endDate ?? new Date().toISOString().slice(0, 10);
  const start = opts.startDate ?? "2005-02-14"; // YouTube launch = lifetime
  const metrics = [
    "views",
    "likes",
    "comments",
    "shares",
    "estimatedMinutesWatched",
    "averageViewDuration",
    "averageViewPercentage",
    "subscribersGained",
    "subscribersLost",
  ].join(",");
  const params = new URLSearchParams({
    ids: "channel==MINE",
    startDate: start,
    endDate: end,
    metrics,
    filters: `video==${videoId}`,
  });
  const res = await fetch(`${ANALYTICS_URL}?${params.toString()}`, {
    headers: { authorization: `Bearer ${accessToken}` },
    signal: AbortSignal.timeout(30_000),
  });
  if (!res.ok) {
    // Analytics can 400 for videos with no data yet — not a hard failure.
    if (res.status === 400) return null;
    throw new YouTubeApiError(res.status, await readError(res));
  }
  const json = (await res.json()) as {
    columnHeaders?: { name: string }[];
    rows?: (number | string)[][];
  };
  const row = json.rows?.[0];
  if (!row || !json.columnHeaders) return null;
  const idx = (name: string) => json.columnHeaders!.findIndex((c) => c.name === name);
  const num = (name: string): number | null => {
    const i = idx(name);
    if (i < 0) return null;
    const v = Number(row[i]);
    return Number.isFinite(v) ? v : null;
  };
  const minutes = num("estimatedMinutesWatched");
  const pct = num("averageViewPercentage");
  return {
    views: num("views") ?? 0,
    likes: num("likes") ?? 0,
    comments: num("comments") ?? 0,
    shares: num("shares") ?? 0,
    watchTimeSec: minutes != null ? Math.round(minutes * 60) : 0,
    avgViewDurationSec: num("averageViewDuration") ?? 0,
    avgViewPercentageBp: pct != null ? Math.round(pct * 100) : null,
    subscribersGained: num("subscribersGained") ?? 0,
    subscribersLost: num("subscribersLost") ?? 0,
  };
}

/** Impressions + CTR live in a separate analytics dimension set. */
export async function fetchImpressions(
  accessToken: string,
  videoId: string,
): Promise<{ impressions: number | null; ctrBp: number | null }> {
  const params = new URLSearchParams({
    ids: "channel==MINE",
    startDate: "2005-02-14",
    endDate: new Date().toISOString().slice(0, 10),
    metrics: "impressions,impressionsClickThroughRate",
    filters: `video==${videoId}`,
  });
  try {
    const res = await fetch(`${ANALYTICS_URL}?${params.toString()}`, {
      headers: { authorization: `Bearer ${accessToken}` },
      signal: AbortSignal.timeout(30_000),
    });
    if (!res.ok) return { impressions: null, ctrBp: null };
    const json = (await res.json()) as {
      columnHeaders?: { name: string }[];
      rows?: number[][];
    };
    const row = json.rows?.[0];
    if (!row || !json.columnHeaders) return { impressions: null, ctrBp: null };
    const i = json.columnHeaders.findIndex((c) => c.name === "impressions");
    const c = json.columnHeaders.findIndex((c) => c.name === "impressionsClickThroughRate");
    return {
      impressions: i >= 0 ? Number(row[i]) || 0 : null,
      ctrBp: c >= 0 ? Math.round((Number(row[c]) || 0) * 100) : null,
    };
  } catch {
    return { impressions: null, ctrBp: null };
  }
}

export function videoUrl(videoId: string): string {
  return `https://www.youtube.com/watch?v=${videoId}`;
}
