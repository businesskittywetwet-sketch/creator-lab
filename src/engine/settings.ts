import { db } from "@/db";
import { automationSettings } from "@/db/schema";
import { eq } from "drizzle-orm";

/* Single-row automation configuration. */

export async function getAutomationSettings(userId?: string) {
  if (!userId) throw new Error("A user ID is required for automation settings");
  const rows = await db.select().from(automationSettings).where(eq(automationSettings.userId, userId)).limit(1);
  if (rows[0]) return rows[0];
  await db.insert(automationSettings).values({ userId }).onConflictDoNothing();
  const again = await db.select().from(automationSettings).where(eq(automationSettings.userId, userId)).limit(1);
  return again[0];
}

export async function setAutomationEnabled(userId: string, enabled: boolean) {
  await getAutomationSettings(userId);
  await db
    .update(automationSettings)
    .set({ enabled, updatedAt: new Date() })
    .where(eq(automationSettings.userId, userId));
}

export type AutomationConfigInput = {
  discoveryIntervalHours: number;
  publishWindowStart: string;
  publishWindowEnd: string;
  dailyPublishCap: number;
  maxConcurrentJobs: number;
  autoRetry: boolean;
  timezone: string;
  judgeThreshold: number;
  scoutMaxStoriesPerRun: number;
  retryDelayMinutes: number;
};

export async function updateAutomationConfig(userId: string, input: AutomationConfigInput) {
  await getAutomationSettings(userId);
  const current = await getAutomationSettings(userId);
  const nextRunAt = current.lastRunAt
    ? new Date(
        new Date(current.lastRunAt).getTime() +
          input.discoveryIntervalHours * 3600_000,
      )
    : new Date(Date.now() + input.discoveryIntervalHours * 3600_000);
  await db
    .update(automationSettings)
    .set({ ...input, nextRunAt, updatedAt: new Date() })
    .where(eq(automationSettings.userId, userId));
}
