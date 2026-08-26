import { db } from "@/db";
import {
  channels,
  content,
  contentDrafts,
  notifications,
  productionAssets,
  productionJobs,
  publishJobs,
  stories,
} from "@/db/schema";
import { and, desc, eq, gte, isNull, sql } from "drizzle-orm";
import { connectionFor, PLATFORMS } from "@/lib/services/platforms";

/* ------------------------------------------------------------------ */
/*  Attention system — derived, de-duplicated operator notifications   */
/* ------------------------------------------------------------------ */

export type NotifyInput = {
  severity: "info" | "success" | "warning" | "error";
  category: string;
  title: string;
  body?: string;
  href?: string;
  dedupeKey?: string;
};

export async function notify(input: NotifyInput) {
  try {
    await db
      .insert(notifications)
      .values({
        severity: input.severity,
        category: input.category,
        title: input.title,
        body: input.body ?? "",
        href: input.href ?? null,
        dedupeKey: input.dedupeKey ?? null,
      })
      .onConflictDoNothing({ target: notifications.dedupeKey });
  } catch (err) {
    console.warn("[notify] failed:", err instanceof Error ? err.message : err);
  }
}

export async function markAllRead() {
  await db.update(notifications).set({ readAt: new Date() }).where(isNull(notifications.readAt));
}

export async function markRead(id: string) {
  await db.update(notifications).set({ readAt: new Date() }).where(eq(notifications.id, id));
}

export async function unreadCount(): Promise<number> {
  try {
    const [row] = await db
      .select({ n: sql<number>`count(*)::int` })
      .from(notifications)
      .where(isNull(notifications.readAt));
    return row?.n ?? 0;
  } catch {
    return 0;
  }
}

export async function recentNotifications(limit = 20) {
  try {
    return await db
      .select()
      .from(notifications)
      .orderBy(desc(notifications.createdAt))
      .limit(limit);
  } catch {
    return [];
  }
}

/* --------------------------- attention scan ------------------------ */

export type AttentionItem = {
  id: string;
  severity: "info" | "warning" | "error";
  category: string;
  title: string;
  detail: string;
  href: string;
  count: number;
};

/**
 * Scan live state for conditions needing a human. Read-only, safe to
 * call on every dashboard render; also used to raise notifications.
 */
export async function scanAttention(): Promise<AttentionItem[]> {
  const items: AttentionItem[] = [];
  const add = (i: AttentionItem) => {
    if (i.count > 0) items.push(i);
  };

  try {
    // failed production jobs
    const [failed] = await db
      .select({ n: sql<number>`count(*)::int` })
      .from(productionJobs)
      .where(eq(productionJobs.status, "failed"));
    add({
      id: "failed-jobs",
      severity: "error",
      category: "production",
      title: "Failed production jobs",
      detail: "Jobs stopped on an error and can be retried from the failed step.",
      href: "/production",
      count: failed?.n ?? 0,
    });

    // drafts awaiting review
    const [review] = await db
      .select({ n: sql<number>`count(*)::int` })
      .from(productionJobs)
      .where(eq(productionJobs.status, "awaiting_review"));
    add({
      id: "awaiting-review",
      severity: "warning",
      category: "review",
      title: "Drafts awaiting review",
      detail: "Sitting at the human sign-off gate.",
      href: "/production",
      count: review?.n ?? 0,
    });

    // QC blocked drafts
    const [qcBlocked] = await db
      .select({ n: sql<number>`count(*)::int` })
      .from(contentDrafts)
      .where(sql`${contentDrafts.qcReport}->>'blocksApproval' = 'true'`);
    add({
      id: "qc-blocked",
      severity: "error",
      category: "qc",
      title: "QC-blocked drafts",
      detail: "Critical findings prevent approval until resolved or overridden.",
      href: "/production",
      count: qcBlocked?.n ?? 0,
    });

    // missing media on jobs that reached review
    const [missingMedia] = await db
      .select({ n: sql<number>`count(*)::int` })
      .from(productionJobs)
      .where(
        and(
          eq(productionJobs.status, "awaiting_review"),
          sql`NOT EXISTS (SELECT 1 FROM production_assets a WHERE a.job_id = ${productionJobs.id} AND a.kind = 'video' AND a.status = 'generated')`,
        ),
      );
    add({
      id: "missing-media",
      severity: "warning",
      category: "assets",
      title: "Drafts missing a rendered video",
      detail: "Reached review without a playable video asset.",
      href: "/production",
      count: missingMedia?.n ?? 0,
    });

    // unavailable assets (audio/image failures)
    const [badAssets] = await db
      .select({ n: sql<number>`count(*)::int` })
      .from(productionAssets)
      .where(sql`${productionAssets.status} IN ('failed','unavailable')`);
    add({
      id: "asset-gaps",
      severity: "warning",
      category: "assets",
      title: "Missing or failed media assets",
      detail: "Usually a missing provider credential (e.g. text-to-speech).",
      href: "/settings",
      count: badAssets?.n ?? 0,
    });

    // publishing errors
    const [pubFailed] = await db
      .select({ n: sql<number>`count(*)::int` })
      .from(publishJobs)
      .where(eq(publishJobs.status, "failed"));
    add({
      id: "publish-failed",
      severity: "error",
      category: "publishing",
      title: "Publishing errors",
      detail: "Platform dispatch failed — inspect the attempt log and retry.",
      href: "/publishing",
      count: pubFailed?.n ?? 0,
    });

    // blocked publish jobs
    const [pubBlocked] = await db
      .select({ n: sql<number>`count(*)::int` })
      .from(publishJobs)
      .where(sql`jsonb_array_length(${publishJobs.blockedReasons}) > 0 AND ${publishJobs.status} <> 'published'`);
    add({
      id: "publish-blocked",
      severity: "warning",
      category: "publishing",
      title: "Publish jobs blocked by preflight",
      detail: "Approval, QC, media or credentials are not satisfied yet.",
      href: "/publishing",
      count: pubBlocked?.n ?? 0,
    });

    // missing credentials
    const missingPlatforms = PLATFORMS.filter((p) => connectionFor(p.key).state !== "connected");
    add({
      id: "missing-credentials",
      severity: "warning",
      category: "config",
      title: "Platforms without publishing credentials",
      detail: missingPlatforms.map((p) => p.label).join(", ") || "",
      href: "/publishing",
      count: missingPlatforms.length,
    });

    // stories needing revision
    const [revisions] = await db
      .select({ n: sql<number>`count(*)::int` })
      .from(contentDrafts)
      .where(eq(contentDrafts.status, "changes_requested"));
    add({
      id: "changes-requested",
      severity: "warning",
      category: "review",
      title: "Drafts with requested changes",
      detail: "Re-run the job to regenerate from the rewind point.",
      href: "/production",
      count: revisions?.n ?? 0,
    });
  } catch (err) {
    console.warn("[attention] scan failed:", err instanceof Error ? err.message : err);
  }

  return items.sort((a, b) => {
    const w = { error: 0, warning: 1, info: 2 };
    return w[a.severity] - w[b.severity] || b.count - a.count;
  });
}

/** Raise notifications for noteworthy state changes (idempotent per day). */
export async function syncNotifications() {
  const day = new Date().toISOString().slice(0, 10);
  try {
    const [review] = await db
      .select({ n: sql<number>`count(*)::int` })
      .from(productionJobs)
      .where(eq(productionJobs.status, "awaiting_review"));
    if ((review?.n ?? 0) > 0) {
      await notify({
        severity: "info",
        category: "review",
        title: `${review.n} video${review.n === 1 ? " is" : "s are"} awaiting review`,
        body: "Open the production board to approve or request changes.",
        href: "/production",
        dedupeKey: `review:${day}:${review.n}`,
      });
    }

    const since = new Date(Date.now() - 24 * 3600_000);
    const [greenlit] = await db
      .select({ n: sql<number>`count(*)::int` })
      .from(stories)
      .where(and(eq(stories.status, "selected"), gte(stories.createdAt, since)));
    if ((greenlit?.n ?? 0) > 0) {
      await notify({
        severity: "info",
        category: "scout",
        title: `${greenlit.n} stor${greenlit.n === 1 ? "y was" : "ies were"} greenlit`,
        body: "The Story Judge promoted new stories into production.",
        href: "/stories",
        dedupeKey: `greenlit:${day}:${greenlit.n}`,
      });
    }

    const [qcBlocked] = await db
      .select({ n: sql<number>`count(*)::int` })
      .from(contentDrafts)
      .where(sql`${contentDrafts.qcReport}->>'blocksApproval' = 'true'`);
    if ((qcBlocked?.n ?? 0) > 0) {
      await notify({
        severity: "warning",
        category: "qc",
        title: `QC blocked ${qcBlocked.n} draft${qcBlocked.n === 1 ? "" : "s"}`,
        body: "Critical findings must be resolved before approval.",
        href: "/production",
        dedupeKey: `qcblock:${day}:${qcBlocked.n}`,
      });
    }
  } catch (err) {
    console.warn("[notifications] sync failed:", err instanceof Error ? err.message : err);
  }
}

export { channels, content };
