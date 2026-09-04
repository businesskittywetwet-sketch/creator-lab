import Link from "next/link";
import { CalendarDays } from "lucide-react";
import { getChannelStrategies, getPublishJobs } from "@/lib/queries";
import { fmtDateTime, timeUntil } from "@/lib/format";
import CalendarViews, { type CalendarItem } from "@/components/calendar-views";
import { EmptyState, PageHeader, Panel, PanelHeader } from "@/components/ui";

export const dynamic = "force-dynamic";

export default async function CalendarPage() {
  const [jobs, strategies] = await Promise.all([getPublishJobs(), getChannelStrategies()]);

  const items: CalendarItem[] = jobs
    .filter((j) => j.scheduledAt || j.publishedAt)
    .map((j) => {
      const tz = strategies.get(j.channelId)?.timezone ?? "UTC";
      const when = (j.scheduledAt ?? j.publishedAt) as Date;
      return {
        id: j.id,
        title: j.title || j.contentTitle,
        channelName: j.channelName,
        channelColor: j.channelColor,
        platform: j.platform,
        status: j.status,
        timezone: tz,
        iso: new Date(when).toISOString(),
        localLabel: fmtDateTime(when),
        relative: j.scheduledAt ? timeUntil(j.scheduledAt) : "published",
        blocked: j.blockedReasons.length > 0 && j.status !== "published",
      };
    })
    .sort((a, b) => +new Date(a.iso) - +new Date(b.iso));

  const timezones = Array.from(new Set(Array.from(strategies.values()).map((s) => s.timezone)));

  return (
    <div className="space-y-6">
      <PageHeader
        eyebrow="Distribution"
        title="Content calendar"
        description="Scheduled and published videos across every channel. Times render in each channel's configured timezone."
        actions={
          <span className="rounded-lg border border-white/[0.08] bg-white/[0.02] px-3 py-2 font-mono text-[10px] uppercase tracking-[0.14em] text-zinc-400">
            {items.length} scheduled item{items.length === 1 ? "" : "s"}
          </span>
        }
      />

      {items.length === 0 ? (
        <EmptyState
          icon={CalendarDays}
          title="Nothing scheduled"
          body="Schedule a publish job from the Publishing Queue and it will appear here in month, week and list views."
          action={
            <Link
              href="/publishing"
              className="inline-flex items-center gap-2 rounded-lg bg-signal px-4 py-2 text-sm font-semibold text-black"
            >
              Open publishing queue
            </Link>
          }
        />
      ) : (
        <CalendarViews items={items} />
      )}

      {timezones.length > 0 && (
        <Panel>
          <PanelHeader title="Channel timezones" hint="Scheduling respects each channel's configured zone" />
          <div className="flex flex-wrap gap-2 p-5">
            {Array.from(strategies.entries()).map(([id, s]) => (
              <span
                key={id}
                className="rounded-md border border-white/[0.07] bg-white/[0.02] px-2 py-1 font-mono text-[10px] text-zinc-400"
              >
                {s.timezone} · {s.postsPerWeek}/wk · windows {s.postingWindows.join(", ")}
              </span>
            ))}
          </div>
        </Panel>
      )}
    </div>
  );
}
