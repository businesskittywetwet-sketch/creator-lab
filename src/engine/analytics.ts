import { db } from "@/db";
import {
  channels,
  content,
  contentDrafts,
  performanceSignals,
  postMetrics,
  publishedPosts,
  stories,
} from "@/db/schema";
import { desc, eq, sql } from "drizzle-orm";
import { adapterFor } from "@/lib/services/platforms";

/* ------------------------------------------------------------------ */
/*  ANALYTICS + FEEDBACK LOOP                                          */
/*                                                                     */
/*  Metrics are only ever written from a real platform adapter         */
/*  response. When no platform is connected there is simply no data —  */
/*  the UI says so rather than showing invented numbers.               */
/* ------------------------------------------------------------------ */

export type SyncReport = {
  posts: number;
  synced: number;
  skipped: number;
  reasons: string[];
};

export async function syncPostMetrics(): Promise<SyncReport> {
  const posts = await db.select().from(publishedPosts);
  const report: SyncReport = { posts: posts.length, synced: 0, skipped: 0, reasons: [] };

  for (const post of posts) {
    const adapter = adapterFor(post.platform);
    if (!adapter) {
      report.skipped += 1;
      report.reasons.push(`${post.platform}: no adapter`);
      continue;
    }
    const conn = adapter.connection();
    if (conn.state !== "connected") {
      report.skipped += 1;
      report.reasons.push(`${post.platform}: ${conn.detail}`);
      continue;
    }
    const metrics = await adapter.fetchMetrics(post.platformPostId, {
      channelId: post.channelId,
    });
    if (!metrics) {
      report.skipped += 1;
      report.reasons.push(`${post.platform}: adapter returned no metrics`);
      continue;
    }
    await db.insert(postMetrics).values({
      postId: post.id,
      contentId: post.contentId,
      channelId: post.channelId,
      platform: post.platform,
      platformPostId: post.platformPostId,
      source: "platform_api",
      views: metrics.views ?? null,
      likes: metrics.likes ?? null,
      comments: metrics.comments ?? null,
      shares: metrics.shares ?? null,
      saves: null,
      watchTimeSec: metrics.watchTimeSec ?? null,
      avgViewDurationSec: metrics.avgViewDurationSec ?? null,
      completionRateBp: metrics.avgViewPercentageBp ?? null,
      avgViewPercentageBp: metrics.avgViewPercentageBp ?? null,
      followersLost: metrics.followersLost ?? null,
      followersGained: metrics.followersGained ?? null,
      impressions: metrics.impressions ?? null,
      ctrBp: metrics.ctrBp ?? null,
      raw: metrics.raw ?? {},
    });
    report.synced += 1;
  }
  return report;
}

/* ----------------------- latest metric per post -------------------- */

export type LatestMetric = {
  contentId: string | null;
  channelId: string | null;
  platform: string;
  views: number;
  likes: number;
  comments: number;
  shares: number;
  completionRateBp: number | null;
};

export async function latestMetrics(): Promise<LatestMetric[]> {
  try {
    const res = await db.execute(sql`
      SELECT DISTINCT ON (post_id, platform)
        content_id, channel_id, platform,
        COALESCE(views,0) views, COALESCE(likes,0) likes,
        COALESCE(comments,0) comments, COALESCE(shares,0) shares,
        completion_rate_bp
      FROM post_metrics
      ORDER BY post_id, platform, measured_at DESC
    `);
    return (res.rows as Record<string, unknown>[]).map((r) => ({
      contentId: r.content_id ? String(r.content_id) : null,
      channelId: r.channel_id ? String(r.channel_id) : null,
      platform: String(r.platform),
      views: Number(r.views ?? 0),
      likes: Number(r.likes ?? 0),
      comments: Number(r.comments ?? 0),
      shares: Number(r.shares ?? 0),
      completionRateBp: r.completion_rate_bp == null ? null : Number(r.completion_rate_bp),
    }));
  } catch {
    return [];
  }
}

/* --------------------- performance signal layer -------------------- */

const MIN_SAMPLE = 5;

function confidenceFor(n: number): "none" | "low" | "medium" | "high" {
  if (n < MIN_SAMPLE) return "none";
  if (n < 10) return "low";
  if (n < 25) return "medium";
  return "high";
}

/**
 * Compute a bounded, explainable adjustment (-10..+10) per dimension key.
 * Below MIN_SAMPLE the adjustment is forced to 0 ("insufficient data") so
 * a handful of videos can never distort story selection.
 */
function adjustmentFor(avg: number, baseline: number, n: number): number {
  if (n < MIN_SAMPLE || baseline <= 0) return 0;
  const ratio = avg / baseline;
  const raw = (ratio - 1) * 10;
  // damp by sample size so early data moves the needle less
  const damp = Math.min(1, n / 25);
  return Math.max(-10, Math.min(10, Math.round(raw * damp)));
}

export type SignalRow = {
  dimension: string;
  key: string;
  label: string;
  sampleSize: number;
  avgViews: number;
  avgEngagementBp: number;
  baselineViews: number;
  adjustment: number;
  confidence: string;
  explanation: string;
};

export async function computePerformanceSignals(): Promise<SignalRow[]> {
  const metrics = await latestMetrics();
  if (metrics.length === 0) {
    await db.delete(performanceSignals);
    return [];
  }

  const contentRows = await db.select().from(content);
  const storyRows = await db.select().from(stories);
  const channelRows = await db.select().from(channels);
  const draftRows = await db.select().from(contentDrafts);

  const contentById = new Map(contentRows.map((c) => [c.id, c]));
  const storyById = new Map(storyRows.map((s) => [s.id, s]));
  const channelById = new Map(channelRows.map((c) => [c.id, c]));
  const draftByContent = new Map(draftRows.map((d) => [d.contentId, d]));

  // aggregate per content first (sum platforms)
  type Agg = { views: number; eng: number };
  const perContent = new Map<string, Agg>();
  const perPlatform = new Map<string, Agg & { n: number }>();
  for (const m of metrics) {
    if (m.contentId) {
      const cur = perContent.get(m.contentId) ?? { views: 0, eng: 0 };
      cur.views += m.views;
      cur.eng += m.likes + m.comments + m.shares;
      perContent.set(m.contentId, cur);
    }
    const p = perPlatform.get(m.platform) ?? { views: 0, eng: 0, n: 0 };
    p.views += m.views;
    p.eng += m.likes + m.comments + m.shares;
    p.n += 1;
    perPlatform.set(m.platform, p);
  }

  const allViews = Array.from(perContent.values()).map((v) => v.views);
  const baseline = allViews.length
    ? Math.round(allViews.reduce((a, b) => a + b, 0) / allViews.length)
    : 0;

  const buckets = new Map<string, { label: string; views: number[]; eng: number[] }>();
  const push = (dimension: string, key: string, label: string, a: Agg) => {
    if (!key) return;
    const id = `${dimension}::${key}`;
    const b = buckets.get(id) ?? { label, views: [], eng: [] };
    b.views.push(a.views);
    b.eng.push(a.views > 0 ? Math.round((a.eng / a.views) * 10000) : 0);
    buckets.set(id, b);
  };

  for (const [contentId, agg] of perContent) {
    const c = contentById.get(contentId);
    if (!c) continue;
    const story = c.storyId ? storyById.get(c.storyId) : undefined;
    const channel = channelById.get(c.channelId);
    const draft = draftByContent.get(contentId);

    // topic = story tags (fall back to channel niche)
    const topics = story?.tags?.length ? story.tags : channel?.niche ? [channel.niche] : [];
    for (const t of topics) push("topic", t.toLowerCase(), t, agg);
    if (story?.sourceName) push("source", story.sourceName.toLowerCase(), story.sourceName, agg);
    if (channel) push("channel", channel.slug, channel.name, agg);

    // hook style from the selected concept
    const concepts = (draft?.concepts ?? []) as Record<string, unknown>[];
    const selected = concepts.find((x) => String(x.hook ?? "") === String(draft?.hook ?? ""));
    const style = String(selected?.style ?? "").trim();
    if (style) push("hook", style.toLowerCase(), style, agg);
  }

  for (const [platform, agg] of perPlatform) {
    push("platform", platform, platform, { views: agg.views, eng: agg.eng });
  }

  const rows: SignalRow[] = [];
  for (const [id, b] of buckets) {
    const [dimension, key] = id.split("::");
    const n = b.views.length;
    const avgViews = Math.round(b.views.reduce((a, c) => a + c, 0) / n);
    const avgEng = Math.round(b.eng.reduce((a, c) => a + c, 0) / n);
    const adjustment = adjustmentFor(avgViews, baseline, n);
    const confidence = confidenceFor(n);
    const explanation =
      confidence === "none"
        ? `${n} video${n === 1 ? "" : "s"} · insufficient data (need ${MIN_SAMPLE}+) — no adjustment applied`
        : `${n} videos · avg ${avgViews.toLocaleString()} views vs baseline ${baseline.toLocaleString()} · signal ${adjustment >= 0 ? "+" : ""}${adjustment}`;
    rows.push({
      dimension,
      key,
      label: b.label,
      sampleSize: n,
      avgViews,
      avgEngagementBp: avgEng,
      baselineViews: baseline,
      adjustment,
      confidence,
      explanation,
    });
  }

  for (const r of rows) {
    await db
      .insert(performanceSignals)
      .values({ ...r, computedAt: new Date() })
      .onConflictDoUpdate({
        target: [performanceSignals.dimension, performanceSignals.key],
        set: { ...r, computedAt: new Date() },
      });
  }
  return rows;
}

/* ------------------------------------------------------------------ */
/*  Qualitative performance insights (Phase 6).                        */
/*  Derived ONLY from real measured retention/engagement data, and     */
/*  still governed by the same MIN_SAMPLE confidence gate so a single  */
/*  video can never swing the system.                                  */
/* ------------------------------------------------------------------ */

export type Insight = {
  kind:
    | "strong_hook" | "weak_hook"
    | "strong_retention" | "weak_retention"
    | "high_engagement" | "low_engagement"
    | "strong_fit" | "poor_fit";
  label: string;
  detail: string;
  sampleSize: number;
  confidence: string;
};

const RETENTION_STRONG_BP = 5000; // >=50% average view percentage
const RETENTION_WEAK_BP = 2500;   // <25%
const ENGAGEMENT_STRONG_BP = 600; // >=6% interactions/view
const ENGAGEMENT_WEAK_BP = 150;   // <1.5%

export async function computeInsights(): Promise<Insight[]> {
  const rows = await db.execute(sql`
    SELECT DISTINCT ON (post_id, platform)
      content_id, platform,
      COALESCE(views,0) v, COALESCE(likes,0)+COALESCE(comments,0)+COALESCE(shares,0) eng,
      avg_view_percentage_bp pct
    FROM post_metrics ORDER BY post_id, platform, measured_at DESC
  `);
  const data = (rows.rows as Record<string, unknown>[]).map((r) => ({
    contentId: r.content_id ? String(r.content_id) : null,
    views: Number(r.v ?? 0),
    eng: Number(r.eng ?? 0),
    pct: r.pct == null ? null : Number(r.pct),
  }));
  if (data.length === 0) return [];

  const out: Insight[] = [];
  const n = data.length;
  const confidence = confidenceFor(n);

  // Retention / hook strength (first-impression proxy = avg view %)
  const withPct = data.filter((d) => d.pct != null) as { pct: number }[];
  if (withPct.length >= MIN_SAMPLE) {
    const avgPct = Math.round(withPct.reduce((a, d) => a + d.pct, 0) / withPct.length);
    if (avgPct >= RETENTION_STRONG_BP)
      out.push({ kind: "strong_retention", label: "Strong retention",
        detail: `Average view percentage ${(avgPct / 100).toFixed(1)}% across ${withPct.length} videos.`,
        sampleSize: withPct.length, confidence });
    else if (avgPct < RETENTION_WEAK_BP)
      out.push({ kind: "weak_retention", label: "Weak retention",
        detail: `Average view percentage only ${(avgPct / 100).toFixed(1)}% across ${withPct.length} videos.`,
        sampleSize: withPct.length, confidence });
    // Hook quality tracks early retention closely for short-form.
    if (avgPct >= RETENTION_STRONG_BP)
      out.push({ kind: "strong_hook", label: "Strong hook",
        detail: "Viewers are staying past the opening — current hook styles are working.",
        sampleSize: withPct.length, confidence });
    else if (avgPct < RETENTION_WEAK_BP)
      out.push({ kind: "weak_hook", label: "Weak hook",
        detail: "Heavy early drop-off — test sharper cold opens.",
        sampleSize: withPct.length, confidence });
  }

  // Engagement rate
  if (n >= MIN_SAMPLE) {
    const totalViews = data.reduce((a, d) => a + d.views, 0);
    const totalEng = data.reduce((a, d) => a + d.eng, 0);
    const bp = totalViews ? Math.round((totalEng / totalViews) * 10000) : 0;
    if (bp >= ENGAGEMENT_STRONG_BP)
      out.push({ kind: "high_engagement", label: "High engagement",
        detail: `${(bp / 100).toFixed(2)}% interaction rate across ${n} videos.`,
        sampleSize: n, confidence });
    else if (bp < ENGAGEMENT_WEAK_BP)
      out.push({ kind: "low_engagement", label: "Low engagement",
        detail: `${(bp / 100).toFixed(2)}% interaction rate across ${n} videos.`,
        sampleSize: n, confidence });
  }

  // Topic/channel fit from the computed signal table
  const sig = await db.select().from(performanceSignals);
  for (const srow of sig) {
    if (srow.confidence === "none") continue;
    if (srow.adjustment >= 5)
      out.push({ kind: "strong_fit", label: `Strong fit: ${srow.label}`,
        detail: srow.explanation, sampleSize: srow.sampleSize, confidence: srow.confidence });
    else if (srow.adjustment <= -5)
      out.push({ kind: "poor_fit", label: `Poor fit: ${srow.label}`,
        detail: srow.explanation, sampleSize: srow.sampleSize, confidence: srow.confidence });
  }
  return out;
}

/** Signals consumed by the Story Judge when scoring a candidate. */
export async function judgeSignalsFor(input: {
  tags: string[];
  sourceName: string;
  channelSlug: string | null;
}): Promise<{ adjustment: number; notes: string[] }> {
  try {
    const rows = await db.select().from(performanceSignals);
    if (rows.length === 0) return { adjustment: 0, notes: [] };
    const byKey = new Map(rows.map((r) => [`${r.dimension}::${r.key}`, r]));
    const notes: string[] = [];
    let total = 0;

    const consider = (dimension: string, key: string | null) => {
      if (!key) return;
      const r = byKey.get(`${dimension}::${key.toLowerCase()}`);
      if (!r) return;
      if (r.confidence === "none") {
        notes.push(`${dimension} "${r.label}": insufficient data (${r.sampleSize} videos)`);
        return;
      }
      total += r.adjustment;
      notes.push(
        `${dimension} "${r.label}": ${r.adjustment >= 0 ? "+" : ""}${r.adjustment} (${r.sampleSize} videos, ${r.confidence} confidence)`,
      );
    };

    for (const t of input.tags.slice(0, 3)) consider("topic", t);
    consider("source", input.sourceName);
    consider("channel", input.channelSlug);

    // hard cap so the feedback layer can never dominate the base score
    return { adjustment: Math.max(-10, Math.min(10, total)), notes };
  } catch {
    return { adjustment: 0, notes: [] };
  }
}

export async function getSignals() {
  try {
    return await db
      .select()
      .from(performanceSignals)
      .orderBy(desc(performanceSignals.sampleSize), desc(performanceSignals.avgViews));
  } catch {
    return [];
  }
}

export { eq };
