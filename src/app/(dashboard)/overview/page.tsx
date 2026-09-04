import Link from "next/link";
import {
  ArrowRight,
  Bot,
  CalendarClock,
  CirclePlay,
  Eye,
  Layers,
  Newspaper,
  Zap,
} from "lucide-react";
import { getCreatorMetrics, getOverviewData } from "@/lib/queries";
import { scanAttention } from "@/engine";
import { PIPELINE_STAGES } from "@/lib/pipeline";
import { fmtNum, timeAgo, timeUntil } from "@/lib/format";
import {
  EmptyState,
  MiniBar,
  PageHeader,
  Panel,
  PanelHeader,
  StageBadge,
  StatCard,
  StatusBadge,
} from "@/components/ui";
import { AgentIcon } from "@/components/agent-icon";
import { ViewsAreaChart } from "@/components/charts";
import { RunSweepButton } from "@/components/controls";
import CreatorPipeline from "@/components/creator-pipeline";
import { AlertTriangle, CheckCircle2, DollarSign, Timer } from "lucide-react";

export const dynamic = "force-dynamic";

export default async function OverviewPage() {
  const [d, m, attention] = await Promise.all([
    getOverviewData(),
    getCreatorMetrics(),
    scanAttention(),
  ]);
  const usd = (v: number) => `$${(v / 1e6).toFixed(4)}`;
  const mins = (ms: number) => (ms > 0 ? `${(ms / 60000).toFixed(1)}m` : "—");
  const spark = d.series.map((s) => s.views);
  const totalViews = spark.reduce((a, b) => a + b, 0);
  const stageCounts = PIPELINE_STAGES.map((s) => d.byStage[s.key]?.length ?? 0);
  const maxStage = Math.max(...stageCounts, 1);
  const activeAgents = d.agents.filter((a) => a.status === "running");
  const successJobs = d.jobRows.filter((j) => j.status === "success").length;

  if (d.channels.length === 0 && d.contentRows.length === 0) {
    return (
      <EmptyState
        icon={Zap}
        title="Bootstrapping the operation"
        body="The database has no data yet. Seed the demo dataset from Settings → Data management to explore the full dashboard."
        action={
          <Link
            href="/settings"
            className="inline-flex items-center gap-2 rounded-lg bg-signal px-4 py-2 text-sm font-semibold text-black"
          >
            Open settings <ArrowRight className="size-4" />
          </Link>
        }
      />
    );
  }

  return (
    <div className="space-y-6">
      <PageHeader
        eyebrow="Creator Lab"
        title="Studio overview"
        description="Everything happening across every niche — discovery, production, review, publishing and performance."
        actions={
          <>
            <RunSweepButton />
            <Link
              href="/queue"
              className="inline-flex items-center gap-2 rounded-lg border border-white/10 bg-white/[0.03] px-3.5 py-2 text-sm text-zinc-300 transition hover:border-white/25 hover:text-white"
            >
              Open pipeline <ArrowRight className="size-3.5" />
            </Link>
          </>
        }
      />

      {/* KPI row */}
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <StatCard
          icon={Eye}
          label="Views · 14 days"
          value={fmtNum(totalViews)}
          sub={`${d.engagement.toFixed(1)}% engagement across platforms`}
          spark={spark}
          accent="#c6f135"
        />
        <StatCard
          icon={Layers}
          label="In production"
          value={String(d.pipelineCount)}
          sub={`${d.channels.filter((c) => c.active).length} active channels feeding the line`}
          spark={stageCounts}
          accent="#67e8f9"
          delay={60}
        />
        <StatCard
          icon={CirclePlay}
          label="Published · 7 days"
          value={String(d.publishedThisWeek)}
          sub={`${d.totals.watch > 0 ? fmtNum(d.totals.watch) : "0"} watch-minutes lifetime`}
          accent="#a78bfa"
          delay={120}
        />
        <StatCard
          icon={Newspaper}
          label="Stories discovered"
          value={String(d.discoveredCount)}
          sub={`avg scout score ${d.avgScore}/100 awaiting judgement`}
          accent="#fbbf24"
          delay={180}
        />
      </div>

      {/* creator lab metrics */}
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 xl:grid-cols-6">
        {[
          { label: "Greenlit", value: m.storiesGreenlit, tone: "text-signal" },
          { label: "Running", value: m.jobsRunning, tone: "text-sky-300" },
          { label: "Awaiting review", value: m.awaitingReview, tone: "text-amber-300" },
          { label: "Approved", value: m.approved, tone: "text-emerald-300" },
          { label: "Scheduled", value: m.scheduled, tone: "text-violet-300" },
          { label: "Published", value: m.published, tone: "text-signal" },
        ].map((c, i) => (
          <div key={c.label} className="panel p-4 animate-fade-up" style={{ animationDelay: `${i * 40}ms` }}>
            <p className="eyebrow">{c.label}</p>
            <p className={`mt-2 font-display text-2xl font-bold ${c.tone}`}>{c.value}</p>
          </div>
        ))}
      </div>

      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        {[
          { icon: CheckCircle2, label: "Videos produced", value: String(m.videosProduced), tone: "text-zinc-100" },
          { icon: DollarSign, label: "Total AI cost", value: usd(m.totalCostMicroUsd), tone: "text-signal" },
          { icon: Timer, label: "Avg production time", value: mins(m.avgProductionMs), tone: "text-zinc-100" },
          { icon: AlertTriangle, label: "Avg QC score", value: m.avgQcScore ? String(m.avgQcScore) : "—", tone: m.avgQcScore >= 60 ? "text-signal" : "text-amber-300" },
        ].map((c, i) => (
          <div key={c.label} className="panel flex items-center gap-3 p-4 animate-fade-up" style={{ animationDelay: `${i * 40}ms` }}>
            <c.icon className="size-4 shrink-0 text-zinc-600" />
            <div className="min-w-0">
              <p className="eyebrow">{c.label}</p>
              <p className={`mt-1 font-display text-lg font-bold ${c.tone}`}>{c.value}</p>
            </div>
          </div>
        ))}
      </div>

      {/* full creator pipeline */}
      <CreatorPipeline
        counts={{
          discovered: m.storiesDiscovered,
          greenlit: m.storiesGreenlit,
          research: d.byStage.researching?.length ?? 0,
          script: d.byStage.scripted?.length ?? 0,
          visuals: d.byStage.production?.length ?? 0,
          video: m.videosProduced,
          qc: d.byStage.qc?.length ?? 0,
          review: m.awaitingReview,
          approved: m.approved,
          scheduled: m.scheduled,
          published: m.published,
        }}
      />

      {/* needs attention */}
      <Panel id="attention">
        <PanelHeader
          title="Needs attention"
          hint={attention.length === 0 ? "All clear" : `${attention.length} condition(s) require a human`}
          action={
            <span
              className={`rounded-md border px-2 py-1 font-mono text-[10px] ${
                attention.some((a) => a.severity === "error")
                  ? "border-red-400/30 bg-red-400/10 text-red-300"
                  : attention.length
                    ? "border-amber-400/30 bg-amber-400/10 text-amber-300"
                    : "border-signal/30 bg-signal/10 text-signal"
              }`}
            >
              {attention.reduce((a, i) => a + i.count, 0)} ITEMS
            </span>
          }
        />
        {attention.length === 0 ? (
          <p className="px-5 py-8 text-center text-xs text-zinc-600">
            Nothing needs attention right now.
          </p>
        ) : (
          <div className="grid grid-cols-1 gap-px overflow-hidden rounded-b-[1.25rem] bg-white/[0.04] sm:grid-cols-2 xl:grid-cols-3">
            {attention.map((a) => (
              <Link
                key={a.id}
                href={a.href}
                className="group bg-[#0a0c12] px-4 py-3.5 transition hover:bg-[#0d1018]"
              >
                <div className="flex items-center gap-2">
                  <span
                    className={`size-1.5 rounded-full ${
                      a.severity === "error" ? "bg-red-400" : a.severity === "warning" ? "bg-amber-400" : "bg-sky-400"
                    }`}
                  />
                  <p className="truncate text-xs font-medium text-zinc-200">{a.title}</p>
                  <span
                    className={`ml-auto font-mono text-sm font-bold ${
                      a.severity === "error" ? "text-red-300" : "text-amber-300"
                    }`}
                  >
                    {a.count}
                  </span>
                </div>
                <p className="clamp-2 mt-1 text-[11px] leading-relaxed text-zinc-500">{a.detail}</p>
              </Link>
            ))}
          </div>
        )}
      </Panel>

      {/* chart + automation status */}
      <div className="grid grid-cols-1 gap-4 xl:grid-cols-3">
        <Panel className="xl:col-span-2 animate-fade-up" >
          <PanelHeader
            title="Audience output"
            hint="Combined daily views across all channels · last 14 days"
            action={
              <span className="rounded-md border border-signal/25 bg-signal/10 px-2 py-1 font-mono text-[10px] text-signal">
                {fmtNum(totalViews)} VIEWS
              </span>
            }
          />
          <div className="px-4 py-4">
            <ViewsAreaChart data={d.series} />
          </div>
        </Panel>

        <Panel className="scanline flex flex-col">
          <PanelHeader
            title="Automation engine"
            hint="Scheduler and job runner"
            action={<StatusBadge status={d.settings?.enabled ? "active" : "paused"} />}
          />
          <div className="flex flex-1 flex-col gap-3 px-5 py-4">
            <div className="grid grid-cols-2 gap-3">
              <div className="rounded-xl border border-white/[0.06] bg-white/[0.02] p-3">
                <p className="font-mono text-[9px] uppercase tracking-[0.2em] text-zinc-500">
                  Next run
                </p>
                <p className="mt-1.5 font-display text-sm font-semibold text-white">
                  {d.settings?.nextRunAt ? timeUntil(d.settings.nextRunAt) : "—"}
                </p>
              </div>
              <div className="rounded-xl border border-white/[0.06] bg-white/[0.02] p-3">
                <p className="font-mono text-[9px] uppercase tracking-[0.2em] text-zinc-500">
                  Last run
                </p>
                <p className="mt-1.5 font-display text-sm font-semibold text-white">
                  {d.settings?.lastRunAt ? timeAgo(d.settings.lastRunAt) : "—"}
                </p>
              </div>
              <div className="rounded-xl border border-white/[0.06] bg-white/[0.02] p-3">
                <p className="font-mono text-[9px] uppercase tracking-[0.2em] text-zinc-500">
                  Jobs OK
                </p>
                <p className="mt-1.5 font-display text-sm font-semibold text-emerald-300">
                  {successJobs}
                </p>
              </div>
              <div className="rounded-xl border border-white/[0.06] bg-white/[0.02] p-3">
                <p className="font-mono text-[9px] uppercase tracking-[0.2em] text-zinc-500">
                  Failed
                </p>
                <p
                  className={`mt-1.5 font-display text-sm font-semibold ${
                    d.failedJobs > 0 ? "text-red-300" : "text-zinc-300"
                  }`}
                >
                  {d.failedJobs}
                </p>
              </div>
            </div>
            <div className="mt-auto flex items-center justify-between rounded-xl border border-white/[0.06] bg-white/[0.02] px-4 py-3">
              <div className="flex items-center gap-2">
                <Bot className="size-4 text-signal" />
                <p className="text-xs text-zinc-400">
                  <span className="font-semibold text-white">{activeAgents.length}</span> agents
                  on task
                </p>
              </div>
              <Link
                href="/automation"
                className="font-mono text-[10px] uppercase tracking-[0.18em] text-signal hover:underline"
              >
                Control →
              </Link>
            </div>
          </div>
        </Panel>
      </div>

      {/* pipeline strip */}
      <Panel>
        <PanelHeader
          title="Production pipeline"
          hint="Live count of content in each stage"
          action={
            <Link
              href="/queue"
              className="font-mono text-[10px] uppercase tracking-[0.18em] text-signal hover:underline"
            >
              Board view →
            </Link>
          }
        />
        <div className="grid grid-cols-3 gap-px overflow-hidden rounded-b-[1.25rem] bg-white/[0.04] sm:grid-cols-5 lg:grid-cols-9">
          {PIPELINE_STAGES.map((s, i) => (
            <Link
              key={s.key}
              href="/queue"
              className="group bg-[#0a0c12] px-4 py-4 transition hover:bg-[#0d1018]"
            >
              <p className="truncate font-mono text-[9px] uppercase tracking-[0.16em] text-zinc-500 group-hover:text-zinc-400">
                {s.label}
              </p>
              <p
                className="mt-2 font-display text-2xl font-bold"
                style={{ color: stageCounts[i] ? s.hex : "#3f3f46" }}
              >
                {stageCounts[i]}
              </p>
              <MiniBar value={stageCounts[i]} max={maxStage} color={s.hex} className="mt-3" />
            </Link>
          ))}
        </div>
      </Panel>

      {/* agents / schedule / jobs */}
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
        <Panel>
          <PanelHeader
            title="Agent activity"
            hint={`${activeAgents.length} running · ${d.agents.length} registered`}
            action={
              <Link
                href="/agents"
                className="font-mono text-[10px] uppercase tracking-[0.18em] text-signal hover:underline"
              >
                Fleet →
              </Link>
            }
          />
          <ul className="divide-y divide-white/[0.05]">
            {d.agents.slice(0, 6).map((a) => (
              <li key={a.id} className="flex items-center gap-3 px-5 py-3">
                <div className="grid size-8 shrink-0 place-items-center rounded-lg border border-white/[0.07] bg-white/[0.03]">
                  <AgentIcon icon={a.icon} className="size-3.5 text-zinc-400" />
                </div>
                <div className="min-w-0 flex-1">
                  <p className="truncate text-[13px] font-medium text-zinc-200">{a.name}</p>
                  <p className="truncate text-[11px] text-zinc-500">
                    {a.status === "running" ? a.currentTask : a.lastTask ?? "Standing by"}
                  </p>
                </div>
                <StatusBadge status={a.status} />
              </li>
            ))}
          </ul>
        </Panel>

        <Panel>
          <PanelHeader title="Upcoming schedule" hint="Next releases in the publish window" />
          <ul className="divide-y divide-white/[0.05]">
            {d.upcoming.length === 0 && (
              <li className="px-5 py-8 text-center text-xs text-zinc-600">
                Nothing scheduled — promote stories to fill the slate.
              </li>
            )}
            {d.upcoming.map((c) => (
              <li key={c.id} className="flex items-start gap-3 px-5 py-3.5">
                <span
                  className="mt-1.5 size-1.5 shrink-0 rounded-full"
                  style={{ background: c.channelColor }}
                />
                <div className="min-w-0 flex-1">
                  <p className="clamp-2 text-[13px] font-medium leading-snug text-zinc-200">
                    {c.title}
                  </p>
                  <p className="mt-1 flex items-center gap-1.5 text-[11px] text-zinc-500">
                    <CalendarClock className="size-3" />
                    {timeUntil(c.scheduledAt)} · {c.channelName}
                  </p>
                </div>
                <StageBadge stage={c.stage} />
              </li>
            ))}
          </ul>
        </Panel>

        <Panel>
          <PanelHeader title="System jobs" hint="Latest automation activity" />
          <ul className="divide-y divide-white/[0.05]">
            {d.jobRows.slice(0, 6).map((j) => (
              <li key={j.id} className="flex items-center gap-3 px-5 py-3">
                <div className="min-w-0 flex-1">
                  <p className="truncate text-[13px] font-medium text-zinc-200">{j.label}</p>
                  <p className="font-mono text-[10px] text-zinc-600">
                    {timeAgo(j.createdAt)}
                  </p>
                </div>
                <StatusBadge status={j.status} />
              </li>
            ))}
          </ul>
        </Panel>
      </div>
    </div>
  );
}
