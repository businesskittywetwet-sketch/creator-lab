import { createServerSupabaseClient, getCurrentUserId } from "@/lib/supabase/server";
import { redirect } from "next/navigation";
import type { ReactNode } from "react";
import AppShell from "@/components/shell";
import { getAgents } from "@/lib/queries";
import { scanAttention, unreadCount, listNiches } from "@/engine";
import { timeUntil } from "@/lib/format";
import { getSettings } from "@/lib/queries";

export const dynamic = "force-dynamic";

export default async function DashboardLayout({
  children,
}: {
  children: ReactNode;
}) {
  const userId = await getCurrentUserId();
  if (!userId) redirect("/login");

  const [settings, agentRows, attention, unread, niches] = await Promise.all([
    getSettings(userId),
    getAgents(userId),
    scanAttention(userId),
    unreadCount(userId),
    listNiches(userId),
  ]);

  const activeAgents = agentRows.filter((a) => a.status === "running").length;
  const attentionCount = attention.reduce((a, i) => a + i.count, 0);
  const reviewCount = attention.find((a) => a.id === "awaiting-review")?.count ?? 0;

  return (
    <AppShell
      automationEnabled={settings?.enabled ?? false}
      nextRunLabel={settings?.nextRunAt ? timeUntil(settings.nextRunAt) : "—"}
      activeAgents={activeAgents}
      attentionCount={attentionCount}
      unread={unread}
      reviewCount={reviewCount}
      niches={niches}
      userEmail={null}
    >
      {children}
    </AppShell>
  );
}

// Re-export for use in pages that need to verify auth
export { getCurrentUserId };
