import type { ReactNode } from "react";
import AppShell from "@/components/shell";
import { getAgents, getSettings } from "@/lib/queries";
import { scanAttention, unreadCount } from "@/engine";
import { timeUntil } from "@/lib/format";

export const dynamic = "force-dynamic";

export default async function DashboardLayout({
  children,
}: {
  children: ReactNode;
}) {
  const [settings, agentRows, attention, unread] = await Promise.all([
    getSettings(),
    getAgents(),
    scanAttention(),
    unreadCount(),
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
    >
      {children}
    </AppShell>
  );
}
