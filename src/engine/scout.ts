import { db } from "@/db";
import {
  agentRuns,
  agents,
  automationJobs,
  automationSettings,
  channels,
  content,
  stories,
  storyEvaluations,
  storySources,
} from "@/db/schema";
import { and, desc, eq, inArray, lte, sql } from "drizzle-orm";
import { niches } from "@/db/schema";
import { adapterFor, type RawStoryItem } from "@/lib/services/sources";
import { cleanText, cleanTitle } from "@/lib/services/sources/types";
import { resolveJudgeProvider, type JudgeResult } from "@/lib/services/judge";
import { withRetry } from "./http";
import { getAutomationSettings } from "./settings";
import { createProductionJob } from "./production";
import { judgeSignalsFor } from "./analytics";

/* ------------------------------------------------------------------ */
/*  STORY SCOUT + STORY JUDGE — the autonomous intake pipeline.        */
/*                                                                     */
/*  fetch sources → normalize → dedupe → associate channel → persist   */
/*  → judge (AI/heuristic) → auto-greenlight into content pipeline.    */
/*  Every stage is individually failure-isolated and retry-wrapped.    */
/* ------------------------------------------------------------------ */

export type ScoutTrigger = "manual" | "schedule" | "retry";

export type SourceReport = {
  name: string;
  type: string;
  status: "ok" | "error" | "skipped";
  items: number;
  error?: string;
};

export type ScoutStats = {
  ok: boolean;
  trigger: ScoutTrigger;
  startedAt: string;
  durationMs: number;
  sourcesChecked: number;
  sourcesFailed: number;
  found: number;
  duplicatesSkipped: number;
  inserted: number;
  judged: number;
  judgeProvider: string;
  selected: number;
  rejected: number;
  sources: SourceReport[];
  errors: string[];
};

/* ------------------------ default source seed ---------------------- */

import { DEFAULT_SOURCES } from "./default-sources";

export async function ensureDefaultSources() {
  const existing = await db.select({ id: storySources.id }).from(storySources).limit(1);
  if (existing.length === 0) {
    await db.insert(storySources).values(DEFAULT_SOURCES);
  }
}

/* --------------------------- normalization ------------------------- */

type NormalizedItem = RawStoryItem & {
  dedupeKey: string;
  sourceId: string;
  sourceName: string;
  sourceType: string;
  sourceChannelHint: string | null;
  sourceReliability: number;
};

function normalize(
  items: RawStoryItem[],
  src: { id: string; name: string; type: string; channelSlug: string | null; reliability: number },
): NormalizedItem[] {
  const out: NormalizedItem[] = [];
  const seen = new Set<string>();
  for (const item of items) {
    const title = cleanTitle(item.title);
    if (title.length < 15) continue;
    if (/^\[?\[?removed\]?/i.test(title)) continue;
    const dedupeKey = `${src.type}:${item.externalId || item.url || title}`;
    if (seen.has(dedupeKey)) continue;
    seen.add(dedupeKey);
    out.push({
      ...item,
      title,
      summary: cleanText(item.summary, 500),
      dedupeKey,
      sourceId: src.id,
      sourceName: src.name,
      sourceType: src.type,
      sourceChannelHint: src.channelSlug,
      sourceReliability: src.reliability,
    });
  }
  return out;
}

function provisionalScore(signals: RawStoryItem["signals"]): number {
  const s = signals.score ?? 0;
  const c = signals.comments ?? 0;
  if (s <= 0) return 52;
  return Math.min(92, Math.round(40 + Math.log1p(s) * 9 + Math.log1p(c) * 5));
}

/* ------------------------ channel association ---------------------- */

function associateChannel(
  item: NormalizedItem,
  channelRows: (typeof channels.$inferSelect)[],
): string | null {
  if (item.sourceChannelHint) {
    const hint = channelRows.find((c) => c.slug === item.sourceChannelHint);
    if (hint) return hint.id;
  }
  const haystack = `${item.title} ${item.summary} ${item.tags.join(" ")}`.toLowerCase();
  let bestId: string | null = null;
  let bestScore = 0;
  for (const ch of channelRows) {
    const terms = `${ch.name} ${ch.niche} ${ch.description}`
      .toLowerCase()
      .split(/[^a-z]+/)
      .filter((t) => t.length >= 5);
    let score = 0;
    for (const t of new Set(terms)) if (haystack.includes(t)) score += 1;
    if (score > bestScore) {
      bestScore = score;
      bestId = ch.id;
    }
  }
  return bestScore >= 2 ? bestId : null;
}

/* ------------------------------- judge ----------------------------- */

async function judgeStory(
  item: { id: string; title: string; summary: string; sourceUrl: string; channelId: string | null },
  meta: { sourceName: string; sourceReliability: number; signals: RawStoryItem["signals"] },
  channelRows: (typeof channels.$inferSelect)[],
  threshold: number,
): Promise<{ result: JudgeResult; action: "selected" | "rejected" | "discovered" }> {
  const judge = resolveJudgeProvider();
  const channel = item.channelId
    ? (channelRows.find((c) => c.id === item.channelId) ?? null)
    : null;

  const result = await judge.evaluate({
    title: item.title,
    summary: item.summary,
    url: item.sourceUrl,
    sourceName: meta.sourceName,
    sourceReliability: meta.sourceReliability,
    signals: meta.signals,
    channel: channel
      ? {
          name: channel.name,
          niche: channel.niche,
          targetAudience: channel.targetAudience,
          voiceTone: channel.voiceTone,
          preferredLength: channel.preferredLength,
        }
      : null,
  });

  /* --- Phase 5 feedback layer -----------------------------------
     Historical performance nudges the score within a hard ±10 cap.
     Dimensions with too few samples contribute nothing, and the
     reasoning is appended to the rationale so it stays explainable. */
  const perf = await judgeSignalsFor({
    tags: (item as { tags?: string[] }).tags ?? [],
    sourceName: meta.sourceName,
    channelSlug: channel?.slug ?? null,
  });
  if (perf.adjustment !== 0 || perf.notes.length > 0) {
    const before = result.overall;
    result.overall = Math.max(0, Math.min(100, result.overall + perf.adjustment));
    result.rationale =
      `${result.rationale} | performance layer: ${before}→${result.overall} (${perf.notes.join("; ")})`.slice(
        0,
        900,
      );
  }

  await db.insert(storyEvaluations).values({
    storyId: item.id,
    provider: result.provider,
    model: result.model,
    viralPotential: result.viralPotential,
    entertainmentValue: result.entertainmentValue,
    channelRelevance: result.channelRelevance,
    visualPotential: result.visualPotential,
    originality: result.originality,
    evergreenPotential: result.evergreenPotential,
    sourceReliability: result.sourceReliability,
    overall: result.overall,
    recommendation: result.recommendation,
    rationale: result.rationale,
  });

  let action: "selected" | "rejected" | "discovered" = "discovered";
  if (result.overall >= threshold && item.channelId) {
    action = "selected";
    const [already] = await db
      .select({ id: content.id })
      .from(content)
      .where(eq(content.storyId, item.id))
      .limit(1);
    if (!already) {
      const [createdContent] = await db
        .insert(content)
        .values({
          channelId: item.channelId,
          storyId: item.id,
          title: item.title,
          stage: "selected",
          score: result.overall,
          hook: result.rationale,
          assignedAgents: ["story-scout", "story-judge"],
        })
        .returning();
      // Greenlit → immediately open a production job so the draft
      // pipeline can pick it up on the next production tick.
      if (createdContent) {
        try {
          await createProductionJob(createdContent.id);
        } catch (err) {
          console.error("[scout] failed to open production job", err);
        }
      }
    }
  } else if (result.recommendation === "reject" || result.overall < threshold - 20) {
    action = "rejected";
  }

  await db
    .update(stories)
    .set({ score: result.overall, status: action === "discovered" ? "discovered" : action })
    .where(eq(stories.id, item.id));

  return { result, action };
}

/* --------------------------- main cycle ---------------------------- */

export type ScoutOptions = {
  /** restrict the cycle to one niche's sources + judging rules */
  nicheId?: string;
};

export async function runScoutCycle(
  trigger: ScoutTrigger,
  options: ScoutOptions = {},
): Promise<ScoutStats> {
  const started = Date.now();
  const stats: ScoutStats = {
    ok: false,
    trigger,
    startedAt: new Date(started).toISOString(),
    durationMs: 0,
    sourcesChecked: 0,
    sourcesFailed: 0,
    found: 0,
    duplicatesSkipped: 0,
    inserted: 0,
    judged: 0,
    judgeProvider: resolveJudgeProvider().key,
    selected: 0,
    rejected: 0,
    sources: [],
    errors: [],
  };

  await ensureDefaultSources();
  const settings = await getAutomationSettings();
  const channelRows = await db.select().from(channels);

  const [runRow] = await db
    .insert(agentRuns)
    .values({ agentSlug: "story-scout", jobType: "story_discovery", trigger })
    .returning();
  const [jobRow] = await db
    .insert(automationJobs)
    .values({
      type: "story_discovery",
      label: "Story discovery sweep",
      status: "running",
      trigger,
      scheduledAt: new Date(),
      startedAt: new Date(),
      attempts: 1,
    })
    .returning();

  try {
    /* ---------- 1. fetch all enabled sources (failure-isolated) ---- */
    // Phase 7: when a niche is supplied, scope sources + rules to it.
    const nicheRow = options.nicheId
      ? (await db.select().from(niches).where(eq(niches.id, options.nicheId)))[0]
      : undefined;
    const sourceRows = nicheRow
      ? await db
          .select()
          .from(storySources)
          .where(and(eq(storySources.enabled, true), eq(storySources.nicheId, nicheRow.id)))
      : await db.select().from(storySources).where(eq(storySources.enabled, true));
    const normalized: NormalizedItem[] = [];

    for (const src of sourceRows) {
      const adapter = adapterFor(src.type);
      const report: SourceReport = { name: src.name, type: src.type, status: "ok", items: 0 };
      if (!adapter) {
        report.status = "skipped";
        report.error = `No adapter registered for type "${src.type}"`;
        stats.errors.push(`${src.name}: ${report.error}`);
      } else {
        try {
          const items = await withRetry(
            () =>
              adapter.fetch({
                id: src.id,
                type: src.type,
                name: src.name,
                channelSlug: src.channelSlug,
                reliability: src.reliability,
                config: src.config,
              }),
            { retries: 2, baseDelayMs: 600, label: `source:${src.name}` },
          );
          const cleaned = normalize(items, src);
          report.items = cleaned.length;
          normalized.push(...cleaned);
          stats.found += items.length;
          await db
            .update(storySources)
            .set({
              lastRunAt: new Date(),
              lastSuccessAt: new Date(),
              consecutiveFailures: 0,
              lastStatus: "ok",
              lastError: null,
            })
            .where(eq(storySources.id, src.id));
        } catch (err) {
          const message = err instanceof Error ? err.message : String(err);
          report.status = "error";
          report.error = message.slice(0, 220);
          stats.sourcesFailed += 1;
          stats.errors.push(`${src.name}: ${message}`);
          const failures = (src.consecutiveFailures ?? 0) + 1;
          await db
            .update(storySources)
            .set({
              lastRunAt: new Date(),
              lastFailureAt: new Date(),
              consecutiveFailures: failures,
              lastStatus: "error",
              lastError: message.slice(0, 400),
            })
            .where(eq(storySources.id, src.id));
          // Only notify once a source is repeatedly broken — no spam.
          if (failures === 3) {
            const { notify } = await import("./notifications");
            await notify({
              severity: "warning",
              category: "sources",
              title: `Source failing repeatedly · ${src.name}`,
              body: `${failures} consecutive failures. ${message.slice(0, 120)}`,
              href: "/niches",
              dedupeKey: `source-failing:${src.id}:${failures}`,
            });
          }
        }
      }
      stats.sourcesChecked += 1;
      stats.sources.push(report);
    }

    /* -------- 1b. niche keyword filters + candidate cap ------------- */
    if (nicheRow) {
      const inc = (nicheRow.keywords ?? []).map((k) => k.toLowerCase()).filter(Boolean);
      const exc = (nicheRow.excludedKeywords ?? []).map((k) => k.toLowerCase()).filter(Boolean);
      if (inc.length || exc.length) {
        const before = normalized.length;
        const kept = normalized.filter((n) => {
          const hay = `${n.title} ${n.summary}`.toLowerCase();
          if (exc.some((k) => hay.includes(k))) return false;
          if (inc.length && !inc.some((k) => hay.includes(k))) return false;
          return true;
        });
        normalized.length = 0;
        normalized.push(...kept);
        stats.errors.push(`niche filter: ${before - kept.length} candidate(s) filtered out`);
      }
      if (normalized.length > nicheRow.maxCandidatesPerCycle) {
        normalized.length = nicheRow.maxCandidatesPerCycle;
      }
    }

    /* -------- 2. dedupe against the database ----------------------- */
    let fresh = normalized;
    if (normalized.length > 0) {
      const keys = normalized.map((n) => n.dedupeKey);
      const existing = await db
        .select({ k: stories.dedupeKey })
        .from(stories)
        .where(inArray(stories.dedupeKey, keys));
      const existingSet = new Set(existing.map((e) => e.k));
      fresh = normalized.filter((n) => {
        if (existingSet.has(n.dedupeKey)) {
          stats.duplicatesSkipped += 1;
          return false;
        }
        return true;
      });
    }

    /* -------- 3. associate + persist ------------------------------- */
    const insertedRows: (typeof stories.$inferSelect)[] = [];
    if (fresh.length > 0) {
      const inserted = await db
        .insert(stories)
        .values(
          fresh.map((n) => ({
            channelId: associateChannel(n, channelRows),
            title: n.title,
            summary: n.summary,
            sourceName: n.sourceName,
            sourceUrl: n.url,
            discoveredBy: "story-scout",
            score: provisionalScore(n.signals),
            status: "discovered",
            tags: n.tags,
            sourceAdapter: n.sourceType,
            dedupeKey: n.dedupeKey,
            signals: n.signals,
          })),
        )
        .onConflictDoNothing({ target: stories.dedupeKey })
        .returning();
      insertedRows.push(...inserted);
      stats.inserted = inserted.length;
      stats.duplicatesSkipped += fresh.length - inserted.length;
    }

    /* -------- 4. judge pass: best unjudged stories first ----------- */
    // Fresh inserts plus any older discovered stories that never got an
    // evaluation (beyond the per-run cap) — highest provisional first.
    const metaByDedupe = new Map(fresh.map((n) => [n.dedupeKey, n]));
    const evaluated = await db
      .select({ sid: storyEvaluations.storyId })
      .from(storyEvaluations);
    const evaluatedIds = new Set(evaluated.map((e) => e.sid));
    const reliabilityBySource = new Map(sourceRows.map((s) => [s.name, s.reliability]));
    const candidates = await db
      .select()
      .from(stories)
      .where(eq(stories.status, "discovered"))
      .orderBy(desc(stories.score))
      .limit(250);
    const toJudge = candidates
      .filter((r) => !evaluatedIds.has(r.id))
      .slice(0, settings.scoutMaxStoriesPerRun);

    for (const row of toJudge) {
      const meta = metaByDedupe.get(row.dedupeKey ?? "");
      try {
        const { action } = await judgeStory(
          row,
          {
            sourceName: meta?.sourceName ?? row.sourceName,
            sourceReliability:
              meta?.sourceReliability ?? reliabilityBySource.get(row.sourceName) ?? 60,
            signals: row.signals,
          },
          channelRows,
          nicheRow?.minGreenlightScore ?? settings.judgeThreshold,
        );
        stats.judged += 1;
        if (action === "selected") stats.selected += 1;
        if (action === "rejected") stats.rejected += 1;
      } catch (err) {
        stats.errors.push(
          `judge:${row.title.slice(0, 48)}: ${err instanceof Error ? err.message : String(err)}`,
        );
      }
    }

    stats.ok = true;
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    stats.errors.push(`fatal: ${message}`);
  }

  /* ------------- 5. bookkeeping (runs, jobs, agents, settings) ----- */
  stats.durationMs = Date.now() - started;
  const finalStatus = stats.ok ? "success" : "failed";

  await db
    .update(agentRuns)
    .set({
      status: finalStatus,
      finishedAt: new Date(),
      durationMs: stats.durationMs,
      stats: stats as unknown as Record<string, unknown>,
      error: stats.ok ? null : (stats.errors[0] ?? "unknown failure"),
    })
    .where(eq(agentRuns.id, runRow.id));

  await db
    .update(automationJobs)
    .set({
      status: stats.ok ? "success" : "failed",
      finishedAt: new Date(),
      durationMs: stats.durationMs,
      lastError: stats.ok ? null : (stats.errors[0] ?? "unknown failure"),
      payload: {
        inserted: stats.inserted,
        judged: stats.judged,
        selected: stats.selected,
        rejected: stats.rejected,
        sourcesFailed: stats.sourcesFailed,
        judgeProvider: stats.judgeProvider,
      },
    })
    .where(eq(automationJobs.id, jobRow.id));

  await db
    .update(agents)
    .set({
      lastRunAt: new Date(),
      lastTask: stats.ok
        ? `Sweep complete — ${stats.inserted} new, ${stats.judged} judged, ${stats.selected} greenlit`
        : `Sweep failed — ${stats.errors[0]?.slice(0, 90) ?? "unknown"}`,
      lastTaskStatus: stats.ok ? "success" : "failure",
      totalRuns: sql`${agents.totalRuns} + 1`,
      failedRuns: sql`${agents.failedRuns} + ${stats.ok ? 0 : 1}`,
    })
    .where(eq(agents.slug, "story-scout"));

  if (stats.judged > 0) {
    await db
      .update(agents)
      .set({
        lastRunAt: new Date(),
        lastTask: `Evaluated ${stats.judged} stories · ${stats.selected} greenlit (${stats.judgeProvider})`,
        lastTaskStatus: "success",
        totalRuns: sql`${agents.totalRuns} + ${stats.judged}`,
      })
      .where(eq(agents.slug, "story-judge"));
  }

  // On failure with auto-retry, queue a real retry run into the queue.
  if (!stats.ok) {
    const settingsRow = await getAutomationSettings();
    if (settingsRow.autoRetry) {
      await db.insert(automationJobs).values({
        type: "story_discovery",
        label: "Story discovery sweep (auto-retry)",
        status: "queued",
        trigger: "retry",
        attempts: jobRow.attempts + 1,
        scheduledAt: new Date(Date.now() + settingsRow.retryDelayMinutes * 60_000),
        payload: { retryOf: runRow.id },
      });
    }
  }

  const settingsNow = await getAutomationSettings();
  await db
    .update(automationSettings)
    .set({
      lastRunAt: new Date(),
      nextRunAt: new Date(Date.now() + settingsNow.discoveryIntervalHours * 3600_000),
      updatedAt: new Date(),
    })
    .where(eq(automationSettings.id, 1));

  console.log(
    `[scout] cycle complete (${trigger}): found=${stats.found} inserted=${stats.inserted} judged=${stats.judged} selected=${stats.selected} rejected=${stats.rejected} sourcesFailed=${stats.sourcesFailed} duration=${stats.durationMs}ms`,
  );

  return stats;
}

/* --------------- queue consumption + scheduling gate --------------- */

/** Consume due queued automation jobs; returns true if a cycle ran. */
export async function processDueAutomationJobs(): Promise<boolean> {
  const due = await db
    .select()
    .from(automationJobs)
    .where(
      and(
        eq(automationJobs.status, "queued"),
        eq(automationJobs.type, "story_discovery"),
        lte(automationJobs.scheduledAt, new Date()),
      ),
    )
    .orderBy(desc(automationJobs.scheduledAt))
    .limit(5);

  if (due.length === 0) return false;

  for (const job of due) {
    await db
      .update(automationJobs)
      .set({
        status: "success",
        startedAt: new Date(),
        finishedAt: new Date(),
        payload: { consumed: true },
      })
      .where(eq(automationJobs.id, job.id));
  }
  await runScoutCycle(due[0].attempts > 0 ? "retry" : "schedule");
  return true;
}

/** Run a scheduled cycle when enabled and past due. */
export async function runScheduledScoutIfDue(): Promise<ScoutStats | null> {
  const settings = await getAutomationSettings();
  if (!settings.enabled) return null;
  const now = Date.now();
  if (settings.nextRunAt && +new Date(settings.nextRunAt) > now) return null;
  return runScoutCycle("schedule");
}
