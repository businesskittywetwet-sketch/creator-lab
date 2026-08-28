import { db } from "@/db";
import {
  channelProductionSettings,
  channelStrategy,
  channels,
  content,
  niches,
  productionJobs,
  publishJobs,
  publishedPosts,
  storySources,
  workQueue,
} from "@/db/schema";
import { and, desc, eq, inArray, sql } from "drizzle-orm";
import { DEFAULT_REQUIRED_STEPS } from "@/lib/production-steps";
import { ensureProductionSettings } from "./production";
import { ensureChannelStrategy } from "./publishing";
import { notify } from "./notifications";

/* ------------------------------------------------------------------ */
/*  NICHE ENGINE                                                       */
/*                                                                     */
/*  A niche is a configuration object binding:                         */
/*    niche → scout config → sources → judge rules → production        */
/*    profile → publishing profile                                     */
/*                                                                     */
/*  There is exactly ONE scout engine and ONE production engine; a     */
/*  niche only supplies configuration. Nothing is hard-coded.          */
/* ------------------------------------------------------------------ */

export const DEFAULT_JUDGE_WEIGHTS: Record<string, number> = {
  viralPotential: 22,
  entertainmentValue: 16,
  channelRelevance: 18,
  visualPotential: 12,
  originality: 12,
  evergreenPotential: 10,
  sourceReliability: 10,
};

export function slugify(name: string): string {
  return name.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/(^-|-$)/g, "").slice(0, 48);
}

export type NicheInput = {
  name: string;
  description?: string;
  color?: string;
  // scouting
  scoutEnabled?: boolean;
  scoutIntervalHours?: number;
  maxCandidatesPerCycle?: number;
  keywords?: string[];
  excludedKeywords?: string[];
  filters?: Record<string, unknown>;
  // judge
  judgeWeights?: Record<string, number>;
  minGreenlightScore?: number;
  freshnessMaxAgeHours?: number;
  minSourceReliability?: number;
  duplicateSensitivity?: number;
  minEngagementSignal?: number;
  qualityThreshold?: number;
  // production profile (stored on channel_production_settings)
  production?: {
    format?: string;
    targetDurationSec?: number;
    scriptWordTarget?: number;
    tone?: string;
    visualStyle?: string;
    sectionCount?: number;
    requiredSteps?: string[];
  };
  // publishing profile (stored on channel_strategy)
  publishing?: {
    platforms?: string[];
    postsPerWeek?: number;
    postingWindows?: string[];
    timezone?: string;
    requireApproval?: boolean;
    autoPublish?: boolean;
    minQcScore?: number;
    defaultHashtags?: string[];
  };
};

/**
 * Create a niche plus its backing channel, production profile and
 * publishing profile. Everything is configuration — no code changes
 * are required to add a niche.
 */
export async function createNiche(userId: string, input: NicheInput) {
  const name = input.name.trim();
  if (!name) return { ok: false as const, error: "Niche name is required." };

  const base = slugify(name);
  const existing = await db.select({ slug: niches.slug }).from(niches);
  const taken = new Set(existing.map((e) => e.slug));
  let slug = base || "niche";
  let n = 2;
  while (taken.has(slug)) slug = `${base}-${n++}`;

  const color = input.color ?? "#C6F135";

  // Backing channel carries production/publishing profiles (reuses Phase 3-6).
  const [channel] = await db
    .insert(channels)
    .values({
      userId,
      slug,
      name,
      niche: input.description?.slice(0, 120) ?? name,
      description: input.description ?? "",
      contentStyle: input.production?.visualStyle ?? "",
      voiceTone: input.production?.tone ?? "",
      targetPlatforms: input.publishing?.platforms ?? [],
      color,
      active: true,
    })
    .returning();

  const [niche] = await db
    .insert(niches)
    .values({
      userId,
      slug,
      name,
      description: input.description ?? "",
      status: "active",
      color,
      channelId: channel.id,
      scoutEnabled: input.scoutEnabled ?? true,
      scoutIntervalHours: input.scoutIntervalHours ?? 6,
      maxCandidatesPerCycle: input.maxCandidatesPerCycle ?? 20,
      keywords: input.keywords ?? [],
      excludedKeywords: input.excludedKeywords ?? [],
      filters: input.filters ?? {},
      judgeWeights: input.judgeWeights ?? DEFAULT_JUDGE_WEIGHTS,
      minGreenlightScore: input.minGreenlightScore ?? 72,
      freshnessMaxAgeHours: input.freshnessMaxAgeHours ?? 720,
      minSourceReliability: input.minSourceReliability ?? 40,
      duplicateSensitivity: input.duplicateSensitivity ?? 70,
      minEngagementSignal: input.minEngagementSignal ?? 0,
      qualityThreshold: input.qualityThreshold ?? 50,
      nextScoutAt: new Date(Date.now() + (input.scoutIntervalHours ?? 6) * 3600_000),
    })
    .returning();

  // Production profile
  await ensureProductionSettings(channel.id);
  if (input.production) {
    await db
      .update(channelProductionSettings)
      .set({
        ...(input.production.format ? { format: input.production.format } : {}),
        ...(input.production.targetDurationSec
          ? { targetDurationSec: input.production.targetDurationSec }
          : {}),
        ...(input.production.scriptWordTarget
          ? { scriptWordTarget: input.production.scriptWordTarget }
          : {}),
        ...(input.production.tone ? { tone: input.production.tone } : {}),
        ...(input.production.visualStyle ? { visualStyle: input.production.visualStyle } : {}),
        ...(input.production.sectionCount
          ? { sectionCount: input.production.sectionCount }
          : {}),
        requiredSteps: input.production.requiredSteps ?? DEFAULT_REQUIRED_STEPS,
        updatedAt: new Date(),
      })
      .where(eq(channelProductionSettings.channelId, channel.id));
  }

  // Publishing profile — auto-publish stays OFF unless explicitly enabled.
  await ensureChannelStrategy(channel.id);
  if (input.publishing) {
    await db
      .update(channelStrategy)
      .set({
        platforms: input.publishing.platforms ?? [],
        postsPerWeek: input.publishing.postsPerWeek ?? 5,
        postingWindows: input.publishing.postingWindows ?? ["09:00", "18:00"],
        timezone: input.publishing.timezone ?? "UTC",
        requireApproval: input.publishing.requireApproval ?? true,
        autoPublish: input.publishing.autoPublish ?? false,
        minQcScore: input.publishing.minQcScore ?? 60,
        defaultHashtags: input.publishing.defaultHashtags ?? [],
        updatedAt: new Date(),
      })
      .where(eq(channelStrategy.channelId, channel.id));
  }

  await notify({
    severity: "success",
    category: "niche",
    title: `Niche created · ${name}`,
    body: "Configure sources to begin discovery.",
    href: "/niches",
    dedupeKey: `niche-created:${niche.id}`,
  });
  return { ok: true as const, niche, channelId: channel.id };
}

export async function updateNiche(id: string, input: Partial<NicheInput>) {
  const [niche] = await db.select().from(niches).where(eq(niches.id, id));
  if (!niche) return { ok: false as const, error: "Niche not found" };

  await db
    .update(niches)
    .set({
      ...(input.name ? { name: input.name } : {}),
      ...(input.description !== undefined ? { description: input.description } : {}),
      ...(input.color ? { color: input.color } : {}),
      ...(input.scoutEnabled !== undefined ? { scoutEnabled: input.scoutEnabled } : {}),
      ...(input.scoutIntervalHours ? { scoutIntervalHours: input.scoutIntervalHours } : {}),
      ...(input.maxCandidatesPerCycle
        ? { maxCandidatesPerCycle: input.maxCandidatesPerCycle }
        : {}),
      ...(input.keywords ? { keywords: input.keywords } : {}),
      ...(input.excludedKeywords ? { excludedKeywords: input.excludedKeywords } : {}),
      ...(input.filters ? { filters: input.filters } : {}),
      ...(input.judgeWeights ? { judgeWeights: input.judgeWeights } : {}),
      ...(input.minGreenlightScore ? { minGreenlightScore: input.minGreenlightScore } : {}),
      ...(input.freshnessMaxAgeHours ? { freshnessMaxAgeHours: input.freshnessMaxAgeHours } : {}),
      ...(input.minSourceReliability !== undefined
        ? { minSourceReliability: input.minSourceReliability }
        : {}),
      ...(input.duplicateSensitivity !== undefined
        ? { duplicateSensitivity: input.duplicateSensitivity }
        : {}),
      ...(input.minEngagementSignal !== undefined
        ? { minEngagementSignal: input.minEngagementSignal }
        : {}),
      ...(input.qualityThreshold !== undefined
        ? { qualityThreshold: input.qualityThreshold }
        : {}),
      updatedAt: new Date(),
    })
    .where(eq(niches.id, id));

  if (niche.channelId && input.production) {
    await db
      .update(channelProductionSettings)
      .set({ ...input.production, updatedAt: new Date() })
      .where(eq(channelProductionSettings.channelId, niche.channelId));
  }
  if (niche.channelId && input.publishing) {
    await db
      .update(channelStrategy)
      .set({ ...input.publishing, updatedAt: new Date() })
      .where(eq(channelStrategy.channelId, niche.channelId));
  }
  return { ok: true as const };
}

export async function setNicheStatus(id: string, status: "active" | "paused" | "archived") {
  const [niche] = await db.select().from(niches).where(eq(niches.id, id));
  if (!niche) return { ok: false as const, error: "Niche not found" };

  await db
    .update(niches)
    .set({
      status,
      archivedAt: status === "archived" ? new Date() : null,
      updatedAt: new Date(),
    })
    .where(eq(niches.id, id));

  // Pausing/archiving must stop future work without corrupting running jobs.
  if (status !== "active") {
    await db
      .update(workQueue)
      .set({ status: "paused", progressLabel: `Niche ${status}`, updatedAt: new Date() })
      .where(and(eq(workQueue.nicheId, id), inArray(workQueue.status, ["queued", "retrying"])));
    if (niche.channelId) {
      await db.update(channels).set({ active: false }).where(eq(channels.id, niche.channelId));
    }
    await notify({
      severity: "warning",
      category: "niche",
      title: `Niche ${status} · ${niche.name}`,
      body: "Queued jobs for this niche were paused.",
      href: "/niches",
      dedupeKey: `niche-${status}:${id}:${Date.now()}`,
    });
  } else {
    await db
      .update(workQueue)
      .set({ status: "queued", progressLabel: "Queued", updatedAt: new Date() })
      .where(and(eq(workQueue.nicheId, id), eq(workQueue.status, "paused")));
    if (niche.channelId) {
      await db.update(channels).set({ active: true }).where(eq(channels.id, niche.channelId));
    }
  }
  return { ok: true as const };
}

/** Deep-copy a niche's configuration (not its content/history). */
export async function duplicateNiche(id: string, newName?: string) {
  const [src] = await db.select().from(niches).where(eq(niches.id, id));
  if (!src) return { ok: false as const, error: "Niche not found" };

  const prod = src.channelId
    ? (
        await db
          .select()
          .from(channelProductionSettings)
          .where(eq(channelProductionSettings.channelId, src.channelId))
      )[0]
    : undefined;
  const strat = src.channelId
    ? (await db.select().from(channelStrategy).where(eq(channelStrategy.channelId, src.channelId)))[0]
    : undefined;

  const created = await createNiche(src.userId, {
    name: newName?.trim() || `${src.name} (copy)`,
    description: src.description,
    color: src.color,
    scoutEnabled: src.scoutEnabled,
    scoutIntervalHours: src.scoutIntervalHours,
    maxCandidatesPerCycle: src.maxCandidatesPerCycle,
    keywords: src.keywords,
    excludedKeywords: src.excludedKeywords,
    filters: src.filters,
    judgeWeights: src.judgeWeights,
    minGreenlightScore: src.minGreenlightScore,
    freshnessMaxAgeHours: src.freshnessMaxAgeHours,
    minSourceReliability: src.minSourceReliability,
    duplicateSensitivity: src.duplicateSensitivity,
    minEngagementSignal: src.minEngagementSignal,
    qualityThreshold: src.qualityThreshold,
    production: prod
      ? {
          format: prod.format,
          targetDurationSec: prod.targetDurationSec,
          scriptWordTarget: prod.scriptWordTarget,
          tone: prod.tone,
          visualStyle: prod.visualStyle,
          sectionCount: prod.sectionCount,
          requiredSteps: prod.requiredSteps,
        }
      : undefined,
    publishing: strat
      ? {
          platforms: strat.platforms,
          postsPerWeek: strat.postsPerWeek,
          postingWindows: strat.postingWindows,
          timezone: strat.timezone,
          requireApproval: strat.requireApproval,
          // never inherit auto-publish
          autoPublish: false,
          minQcScore: strat.minQcScore,
          defaultHashtags: strat.defaultHashtags,
        }
      : undefined,
  });
  if (!created.ok) return created;

  // Copy source configuration (references, not implementations).
  const srcSources = await db.select().from(storySources).where(eq(storySources.nicheId, id));
  for (const s of srcSources) {
    await db.insert(storySources).values({
      userId: s.userId,
      type: s.type,
      name: `${s.name} (copy)`,
      enabled: s.enabled,
      nicheId: created.niche.id,
      channelSlug: created.niche.slug,
      config: s.config,
      reliability: s.reliability,
      pollIntervalMinutes: s.pollIntervalMinutes,
    });
  }
  return { ok: true as const, niche: created.niche, sourcesCopied: srcSources.length };
}

/** Archive is the safe default; hard delete only when nothing depends on it. */
export async function deleteNiche(id: string, opts: { force?: boolean } = {}) {
  const [niche] = await db.select().from(niches).where(eq(niches.id, id));
  if (!niche) return { ok: false as const, error: "Niche not found" };

  const [{ n: liveJobs }] = await db
    .select({ n: sql<number>`count(*)::int` })
    .from(workQueue)
    .where(and(eq(workQueue.nicheId, id), inArray(workQueue.status, ["running", "queued", "retrying"])));
  const [{ n: published }] = niche.channelId
    ? await db
        .select({ n: sql<number>`count(*)::int` })
        .from(publishedPosts)
        .where(eq(publishedPosts.channelId, niche.channelId))
    : [{ n: 0 }];

  if (!opts.force && (liveJobs > 0 || published > 0)) {
    await setNicheStatus(id, "archived");
    return {
      ok: true as const,
      archived: true,
      reason: `Archived instead of deleted: ${liveJobs} live job(s), ${published} published post(s) depend on it.`,
    };
  }

  await db.delete(storySources).where(eq(storySources.nicheId, id));
  await db.delete(niches).where(eq(niches.id, id));
  if (niche.channelId) await db.delete(channels).where(eq(channels.id, niche.channelId));
  return { ok: true as const, archived: false, reason: "Deleted." };
}

/* ---------------------------- sources ------------------------------ */

export type SourceInput = {
  nicheId: string;
  type: string;
  name: string;
  config: Record<string, unknown>;
  reliability?: number;
  pollIntervalMinutes?: number;
  enabled?: boolean;
};

export async function addSource(input: SourceInput) {
  const [niche] = await db.select().from(niches).where(eq(niches.id, input.nicheId));
  if (!niche) return { ok: false as const, error: "Niche not found" };
  const [row] = await db
    .insert(storySources)
    .values({
      userId: niche.userId,
      type: input.type,
      name: input.name,
      enabled: input.enabled ?? true,
      nicheId: input.nicheId,
      channelSlug: niche.slug,
      config: input.config,
      reliability: input.reliability ?? 70,
      pollIntervalMinutes: input.pollIntervalMinutes ?? 360,
    })
    .returning();
  return { ok: true as const, source: row };
}

export async function updateSource(
  id: string,
  patch: Partial<Omit<SourceInput, "nicheId">> & { enabled?: boolean },
) {
  await db
    .update(storySources)
    .set({
      ...(patch.name ? { name: patch.name } : {}),
      ...(patch.type ? { type: patch.type } : {}),
      ...(patch.config ? { config: patch.config } : {}),
      ...(patch.reliability !== undefined ? { reliability: patch.reliability } : {}),
      ...(patch.pollIntervalMinutes ? { pollIntervalMinutes: patch.pollIntervalMinutes } : {}),
      ...(patch.enabled !== undefined ? { enabled: patch.enabled } : {}),
    })
    .where(eq(storySources.id, id));
  return { ok: true as const };
}

export async function removeSource(id: string) {
  await db.delete(storySources).where(eq(storySources.id, id));
  return { ok: true as const };
}

/* ----------------------------- reads ------------------------------- */

export async function listNiches() {
  const rows = await db.select().from(niches).orderBy(desc(niches.createdAt));
  const out = [];
  for (const n of rows) {
    const [sources] = await db
      .select({ c: sql<number>`count(*)::int` })
      .from(storySources)
      .where(eq(storySources.nicheId, n.id));
    const stats = n.channelId
      ? (
          await db.execute(sql`
            SELECT
              (SELECT COUNT(*) FROM content WHERE channel_id = ${n.channelId})::int total,
              (SELECT COUNT(*) FROM production_jobs WHERE channel_id = ${n.channelId}
                 AND status IN ('queued','running'))::int producing,
              (SELECT COUNT(*) FROM published_posts WHERE channel_id = ${n.channelId})::int published,
              (SELECT MIN(scheduled_at) FROM publish_jobs WHERE channel_id = ${n.channelId}
                 AND status = 'scheduled' AND scheduled_at > now()) next_at
          `)
        ).rows[0] as Record<string, unknown>
      : { total: 0, producing: 0, published: 0, next_at: null };
    const [queued] = await db
      .select({ c: sql<number>`count(*)::int` })
      .from(workQueue)
      .where(and(eq(workQueue.nicheId, n.id), inArray(workQueue.status, ["queued", "running", "retrying"])));
    out.push({
      ...n,
      sourceCount: sources?.c ?? 0,
      videosTotal: Number(stats.total ?? 0),
      videosProducing: Number(stats.producing ?? 0),
      videosPublished: Number(stats.published ?? 0),
      jobsQueued: queued?.c ?? 0,
      nextPublishAt: stats.next_at ? String(stats.next_at) : null,
    });
  }
  return out;
}

export async function getNiche(id: string) {
  const [niche] = await db.select().from(niches).where(eq(niches.id, id));
  if (!niche) return null;
  const sources = await db.select().from(storySources).where(eq(storySources.nicheId, id));
  const production = niche.channelId
    ? (
        await db
          .select()
          .from(channelProductionSettings)
          .where(eq(channelProductionSettings.channelId, niche.channelId))
      )[0]
    : null;
  const strategy = niche.channelId
    ? (await db.select().from(channelStrategy).where(eq(channelStrategy.channelId, niche.channelId)))[0]
    : null;
  return { niche, sources, production: production ?? null, strategy: strategy ?? null };
}

/** Niches whose scout interval has elapsed. */
export async function nichesDueForScout() {
  return db
    .select()
    .from(niches)
    .where(
      and(
        eq(niches.status, "active"),
        eq(niches.scoutEnabled, true),
        sql`(${niches.nextScoutAt} IS NULL OR ${niches.nextScoutAt} <= now())`,
      ),
    );
}

export async function markNicheScouted(id: string) {
  const [n] = await db.select().from(niches).where(eq(niches.id, id));
  if (!n) return;
  await db
    .update(niches)
    .set({
      lastScoutAt: new Date(),
      nextScoutAt: new Date(Date.now() + n.scoutIntervalHours * 3600_000),
      updatedAt: new Date(),
    })
    .where(eq(niches.id, id));
}

/** Backfill: adopt pre-Phase-7 channels as niches so nothing is orphaned. */
export async function adoptLegacyChannels(): Promise<number> {
  const chans = await db.select().from(channels);
  let created = 0;
  for (const c of chans) {
    const [existing] = await db.select().from(niches).where(eq(niches.channelId, c.id));
    if (existing) continue;
    const [n] = await db
      .insert(niches)
      .values({
        userId: c.userId,
        slug: c.slug,
        name: c.name,
        description: c.description,
        status: c.active ? "active" : "paused",
        color: c.color,
        channelId: c.id,
        judgeWeights: DEFAULT_JUDGE_WEIGHTS,
      })
      .onConflictDoNothing()
      .returning();
    if (n) {
      created += 1;
      await db
        .update(storySources)
        .set({ nicheId: n.id })
        .where(and(eq(storySources.channelSlug, c.slug), sql`${storySources.nicheId} IS NULL`));
    }
  }
  return created;
}

export { content, productionJobs, publishJobs };
