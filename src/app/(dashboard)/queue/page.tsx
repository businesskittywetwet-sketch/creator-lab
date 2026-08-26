import Link from "next/link";
import { ArrowRight, Columns3 } from "lucide-react";
import QueueBoard, { type QueueItem } from "@/components/queue-board";
import { getContentWithChannel } from "@/lib/queries";
import { timeAgo, timeUntil } from "@/lib/format";
import { EmptyState, PageHeader } from "@/components/ui";

export const dynamic = "force-dynamic";

export default async function QueuePage() {
  const rows = await getContentWithChannel();

  const items: QueueItem[] = rows.map((c) => ({
    id: c.id,
    title: c.title,
    stage: c.stage,
    score: c.score,
    format: c.format,
    durationSec: c.durationSec,
    channelName: c.channelName,
    channelColor: c.channelColor,
    updatedLabel: timeAgo(c.updatedAt),
    scheduledLabel:
      c.stage === "scheduled" && c.scheduledAt ? timeUntil(c.scheduledAt) : null,
    assignedAgents: c.assignedAgents,
  }));

  return (
    <div className="space-y-6">
      <PageHeader
        eyebrow="Production line"
        title="Content queue"
        description="Every piece of content moving from discovery to publication. Hover a card to advance or rewind its stage."
        actions={
          <Link
            href="/stories"
            className="inline-flex items-center gap-2 rounded-lg border border-white/10 bg-white/[0.03] px-3.5 py-2 text-sm text-zinc-300 transition hover:border-white/25 hover:text-white"
          >
            Review stories <ArrowRight className="size-3.5" />
          </Link>
        }
      />

      {items.length === 0 ? (
        <EmptyState
          icon={Columns3}
          title="The pipeline is empty"
          body="Promote a discovered story from the Stories page, or run a discovery sweep to surface new candidates."
          action={
            <Link
              href="/stories"
              className="inline-flex items-center gap-2 rounded-lg bg-signal px-4 py-2 text-sm font-semibold text-black"
            >
              Open stories <ArrowRight className="size-4" />
            </Link>
          }
        />
      ) : (
        <QueueBoard items={items} />
      )}

      <p className="font-mono text-[10px] uppercase tracking-[0.2em] text-zinc-600">
        {items.length} items · drag-free board — use arrows to move work between stages
      </p>
    </div>
  );
}
