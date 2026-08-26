import {
  AlertTriangle,
  CheckCircle2,
  ListTodo,
  Power,
  RefreshCw,
  Timer,
} from "lucide-react";
import {
  getAutomationJobs,
  getPublishingJobs,
  getScoutTelemetry,
  getSettings,
} from "@/lib/queries";
import { judgeProviderLabel } from "@/lib/services/judge";
import { AUTOMATION_TYPES, platformLabel } from "@/lib/pipeline";
import { fmtMs, timeAgo, timeUntil } from "@/lib/format";
import {
  retryAutomationJob,
  retryPublishingJob,
  toggleAutomation,
} from "@/app/actions";
import AutomationConfigForm from "@/components/automation-config-form";
import { RunSweepButton } from "@/components/controls";
import {
  PageHeader,
  Panel,
  PanelHeader,
  PlatformMark,
  StatusBadge,
} from "@/components/ui";

export const dynamic = "force-dynamic";

export default async function AutomationPage() {
  const [settings, jobs, pubJobs, telemetry] = await Promise.all([
    getSettings(),
    getAutomationJobs(60),
    getPublishingJobs(),
    getScoutTelemetry(),
  ]);

  const enabled = settings?.enabled ?? false;
  const successCount = jobs.filter((j) => j.status === "success").length;
  const failedAuto = jobs.filter((j) => j.status === "failed");
  const failedPub = pubJobs.filter((j) => j.status === "failed");
  const queued = jobs
    .filter((j) => j.status === "queued")
    .sort((a, b) => +new Date(a.scheduledAt ?? 0) - +new Date(b.scheduledAt ?? 0));
  const running = jobs.filter((j) => j.status === "running");
  const retryCount = failedAuto.length + failedPub.length;
  const history = jobs.filter((j) => j.status !== "queued").slice(0, 12);

  return (
    <div className="space-y-6">
      <PageHeader
        eyebrow="System"
        title="Automation"
        description="The Story Scout and Judge now run live against configured sources. Schedule, thresholds and retry policy are operator-controlled below."
        actions={<RunSweepButton />}
      />

      {/* master control */}
      <Panel className="scanline overflow-hidden">
        <div className="flex flex-col gap-6 p-6 lg:flex-row lg:items-center">
          <div className="flex items-center gap-5">
            <div
              className={`grid size-16 shrink-0 place-items-center rounded-2xl border ${
                enabled
                  ? "border-signal/40 bg-signal/10 shadow-[0_0_40px_-8px_rgba(198,241,53,0.4)]"
                  : "border-white/10 bg-white/[0.03]"
              }`}
            >
              <Power className={`size-6 ${enabled ? "text-signal" : "text-zinc-600"}`} />
            </div>
            <div>
              <p className="eyebrow mb-1">Master switch</p>
              <h3 className="font-display text-xl font-bold text-white">
                Automation is {enabled ? "enabled" : "paused"}
              </h3>
              <p className="mt-1 max-w-md text-xs leading-relaxed text-zinc-500">
                When enabled the orchestrator runs discovery sweeps every{" "}
                <span className="text-zinc-300">{settings?.discoveryIntervalHours ?? 6}h</span>,
                advances pipeline stages and dispatches publishes inside the daily window.
              </p>
            </div>
          </div>

          <div className="grid flex-1 grid-cols-2 gap-3 sm:grid-cols-4">
            <div className="rounded-xl border border-white/[0.06] bg-white/[0.02] p-3.5">
              <p className="flex items-center gap-1.5 font-mono text-[9px] uppercase tracking-[0.18em] text-zinc-500">
                <Timer className="size-3" /> Next run
              </p>
              <p className="mt-2 font-display text-sm font-semibold text-white">
                {enabled ? timeUntil(settings?.nextRunAt) : "paused"}
              </p>
            </div>
            <div className="rounded-xl border border-white/[0.06] bg-white/[0.02] p-3.5">
              <p className="flex items-center gap-1.5 font-mono text-[9px] uppercase tracking-[0.18em] text-zinc-500">
                <RefreshCw className="size-3" /> Last run
              </p>
              <p className="mt-2 font-display text-sm font-semibold text-white">
                {timeAgo(settings?.lastRunAt)}
              </p>
            </div>
            <div className="rounded-xl border border-white/[0.06] bg-white/[0.02] p-3.5">
              <p className="flex items-center gap-1.5 font-mono text-[9px] uppercase tracking-[0.18em] text-zinc-500">
                <CheckCircle2 className="size-3" /> Successful
              </p>
              <p className="mt-2 font-display text-sm font-semibold text-emerald-300">
                {successCount} jobs
              </p>
            </div>
            <div className="rounded-xl border border-white/[0.06] bg-white/[0.02] p-3.5">
              <p className="flex items-center gap-1.5 font-mono text-[9px] uppercase tracking-[0.18em] text-zinc-500">
                <AlertTriangle className="size-3" /> Retry queue
              </p>
              <p
                className={`mt-2 font-display text-sm font-semibold ${
                  retryCount > 0 ? "text-red-300" : "text-zinc-300"
                }`}
              >
                {retryCount} {retryCount === 1 ? "job" : "jobs"}
              </p>
            </div>
          </div>

          <form action={toggleAutomation.bind(null, !enabled)} className="shrink-0">
            <button
              className={`w-full rounded-xl px-5 py-3 font-display text-sm font-bold transition lg:w-auto ${
                enabled
                  ? "border border-red-400/40 bg-red-400/10 text-red-300 hover:bg-red-400/20"
                  : "bg-signal text-black hover:brightness-110"
              }`}
            >
              {enabled ? "Pause automation" : "Enable automation"}
            </button>
          </form>
        </div>
      </Panel>

      {/* story scout telemetry */}
      <Panel>
        <PanelHeader
          title="Story Scout network"
          hint="Live discovery sources and latest sweep results"
          action={
            <span className="rounded-md border border-white/10 bg-white/[0.03] px-2 py-1 font-mono text-[10px] text-zinc-400">
              judge: {judgeProviderLabel()}
            </span>
          }
        />
        <div className="grid grid-cols-1 divide-y divide-white/[0.05] xl:grid-cols-2 xl:divide-x xl:divide-y-0">
          <ul className="divide-y divide-white/[0.05]">
            <li className="flex items-center gap-3 px-5 py-3.5">
              <span className="font-mono text-[9px] uppercase tracking-[0.2em] text-zinc-500">
                Last scout run
              </span>
              <span className="ml-auto text-sm text-zinc-200">
                {telemetry.lastRun ? timeAgo(telemetry.lastRun.createdAt) : "never"}
              </span>
              {telemetry.lastRun && <StatusBadge status={telemetry.lastRun.status} />}
            </li>
            <li className="flex items-center gap-3 px-5 py-3.5">
              <span className="font-mono text-[9px] uppercase tracking-[0.2em] text-zinc-500">
                Next scout run
              </span>
              <span className="ml-auto text-sm text-zinc-200">
                {settings?.enabled ? timeUntil(settings.nextRunAt) : "automation paused"}
              </span>
              <span className="rounded-md border border-white/10 px-1.5 py-0.5 font-mono text-[9px] uppercase tracking-[0.1em] text-zinc-500">
                every {settings?.discoveryIntervalHours ?? 6}h
              </span>
            </li>
            <li className="flex items-center gap-3 px-5 py-3.5">
              <span className="font-mono text-[9px] uppercase tracking-[0.2em] text-zinc-500">
                Retry policy
              </span>
              <span className="ml-auto text-sm text-zinc-200">
                {settings?.autoRetry
                  ? `auto-retry after ${settings.retryDelayMinutes}m`
                  : "manual retry only"}
              </span>
              <StatusBadge status={settings?.autoRetry ? "active" : "paused"} label={settings?.autoRetry ? "auto" : "manual"} />
            </li>
          </ul>
          <div className="grid grid-cols-2 gap-px bg-white/[0.04]">
            {[
              { label: "Stories discovered", value: telemetry.counts.discovered, tone: "text-sky-300" },
              { label: "Stories selected", value: telemetry.counts.selected, tone: "text-signal" },
              { label: "Stories rejected", value: telemetry.counts.rejected, tone: "text-red-300" },
              { label: "Failed jobs", value: jobs.filter((j) => j.status === "failed").length, tone: "text-amber-300" },
            ].map((chip) => (
              <div key={chip.label} className="bg-[#0a0c12] px-5 py-4">
                <p className="font-mono text-[9px] uppercase tracking-[0.2em] text-zinc-500">
                  {chip.label}
                </p>
                <p className={`mt-1.5 font-display text-2xl font-bold ${chip.tone}`}>
                  {chip.value}
                </p>
              </div>
            ))}
          </div>
        </div>

        {/* per-source health */}
        <div className="border-t border-white/[0.06] px-5 py-4">
          <p className="mb-3 font-mono text-[9px] uppercase tracking-[0.24em] text-zinc-600">
            Source health
          </p>
          <div className="grid grid-cols-1 gap-2 sm:grid-cols-2 xl:grid-cols-3">
            {telemetry.sources.map((s) => (
              <div
                key={s.id}
                className="rounded-lg border border-white/[0.06] bg-white/[0.02] px-3 py-2.5"
              >
                <div className="flex items-center gap-2">
                  <span
                    className={`size-1.5 rounded-full ${
                      s.lastStatus === "ok"
                        ? "bg-emerald-400"
                        : s.lastStatus === "error"
                          ? "bg-red-400"
                          : "bg-zinc-600"
                    }`}
                  />
                  <p className="truncate text-xs font-medium text-zinc-200">{s.name}</p>
                  <span className="ml-auto rounded border border-white/[0.08] px-1 py-0.5 font-mono text-[8px] uppercase text-zinc-500">
                    {s.type}
                  </span>
                </div>
                {s.lastStatus === "error" && s.lastError ? (
                  <p className="mt-1.5 truncate font-mono text-[9px] text-red-300/70" title={s.lastError}>
                    {s.lastError}
                  </p>
                ) : (
                  <p className="mt-1.5 font-mono text-[9px] text-zinc-600">
                    reliability {s.reliability}/100
                    {s.lastRunAt ? ` · checked ${timeAgo(s.lastRunAt)}` : " · not run yet"}
                  </p>
                )}
              </div>
            ))}
            {telemetry.sources.length === 0 && (
              <p className="col-span-full py-3 text-xs text-zinc-600">
                No discovery sources configured — defaults are seeded on the next sweep.
              </p>
            )}
          </div>
        </div>
      </Panel>

      <div className="grid grid-cols-1 gap-4 xl:grid-cols-2">
        {/* retry queue */}
        <Panel>
          <PanelHeader
            title="Retry queue"
            hint="Failed jobs awaiting operator or auto-retry"
            action={
              <span
                className={`rounded-md border px-2 py-1 font-mono text-[10px] ${
                  retryCount
                    ? "border-red-400/30 bg-red-400/10 text-red-300"
                    : "border-white/10 text-zinc-500"
                }`}
              >
                {retryCount} WAITING
              </span>
            }
          />
          <ul className="divide-y divide-white/[0.05]">
            {failedAuto.map((j) => (
              <li key={j.id} className="flex items-start gap-3 px-5 py-4">
                <AlertTriangle className="mt-0.5 size-4 shrink-0 text-red-400" />
                <div className="min-w-0 flex-1">
                  <p className="text-[13px] font-medium text-zinc-200">{j.label}</p>
                  <p className="mt-1 truncate text-xs text-red-300/80">{j.lastError}</p>
                  <p className="mt-1 font-mono text-[10px] text-zinc-600">
                    attempt {j.attempts}/{j.maxAttempts} · {timeAgo(j.finishedAt)}
                  </p>
                </div>
                <form action={retryAutomationJob.bind(null, j.id)}>
                  <button className="rounded-md border border-signal/30 bg-signal/10 px-2.5 py-1.5 font-mono text-[10px] uppercase tracking-[0.1em] text-signal transition hover:bg-signal/20">
                    Retry now
                  </button>
                </form>
              </li>
            ))}
            {failedPub.map((j) => (
              <li key={j.id} className="flex items-start gap-3 px-5 py-4">
                <PlatformMark platform={j.platform} />
                <div className="min-w-0 flex-1">
                  <p className="text-[13px] font-medium text-zinc-200">
                    Publish → {platformLabel(j.platform)}
                  </p>
                  <p className="mt-1 truncate text-xs text-red-300/80">{j.lastError}</p>
                  <p className="mt-1 font-mono text-[10px] text-zinc-600">
                    publishing job · attempt {j.attempts}
                  </p>
                </div>
                <form action={retryPublishingJob.bind(null, j.id)}>
                  <button className="rounded-md border border-signal/30 bg-signal/10 px-2.5 py-1.5 font-mono text-[10px] uppercase tracking-[0.1em] text-signal transition hover:bg-signal/20">
                    Retry now
                  </button>
                </form>
              </li>
            ))}
            {retryCount === 0 && (
              <li className="px-5 py-10 text-center text-xs text-zinc-600">
                All clear — no failed jobs waiting.
              </li>
            )}
          </ul>
        </Panel>

        {/* upcoming + running */}
        <Panel>
          <PanelHeader
            title="Scheduled queue"
            hint="What the orchestrator will execute next"
            action={
              <span className="rounded-md border border-white/10 px-2 py-1 font-mono text-[10px] text-zinc-500">
                {queued.length} QUEUED
              </span>
            }
          />
          <ul className="divide-y divide-white/[0.05]">
            {running.map((j) => (
              <li key={j.id} className="flex items-center gap-3 px-5 py-3.5">
                <span className="dot-live size-1.5 shrink-0 rounded-full bg-sky-400 text-sky-400" />
                <div className="min-w-0 flex-1">
                  <p className="truncate text-[13px] font-medium text-zinc-200">{j.label}</p>
                  <p className="font-mono text-[10px] text-zinc-600">
                    started {timeAgo(j.startedAt)}
                  </p>
                </div>
                <StatusBadge status="running" />
              </li>
            ))}
            {queued.map((j) => (
              <li key={j.id} className="flex items-center gap-3 px-5 py-3.5">
                <span className="size-1.5 shrink-0 rounded-full bg-zinc-600" />
                <div className="min-w-0 flex-1">
                  <p className="truncate text-[13px] font-medium text-zinc-200">{j.label}</p>
                  <p className="font-mono text-[10px] text-zinc-600">
                    {AUTOMATION_TYPES[j.type] ?? j.type}
                  </p>
                </div>
                <span className="rounded-md border border-white/10 bg-white/[0.03] px-2 py-1 font-mono text-[10px] text-zinc-400">
                  {timeUntil(j.scheduledAt)}
                </span>
              </li>
            ))}
            {queued.length === 0 && running.length === 0 && (
              <li className="px-5 py-10 text-center text-xs text-zinc-600">
                Queue is empty — waiting for the next scheduled run.
              </li>
            )}
          </ul>
        </Panel>
      </div>

      {/* history */}
      <Panel>
        <PanelHeader
          title="Job history"
          hint="Recent automation executions"
          action={
            <span className="flex items-center gap-1.5 font-mono text-[10px] text-zinc-500">
              <ListTodo className="size-3" /> {jobs.length} logged
            </span>
          }
        />
        <div className="divide-y divide-white/[0.05]">
          {history.map((j) => (
            <div
              key={j.id}
              className="grid grid-cols-[minmax(0,1fr)_auto] items-center gap-3 px-5 py-3 sm:grid-cols-[minmax(0,1fr)_130px_90px_80px_90px]"
            >
              <div className="min-w-0">
                <p className="truncate text-[13px] font-medium text-zinc-200">{j.label}</p>
                <p className="font-mono text-[10px] text-zinc-600">
                  {AUTOMATION_TYPES[j.type] ?? j.type}
                </p>
              </div>
              <StatusBadge status={j.status} />
              <p className="hidden text-right font-mono text-[11px] text-zinc-500 sm:block">
                {j.attempts} {j.attempts === 1 ? "try" : "tries"}
              </p>
              <p className="hidden text-right font-mono text-[11px] text-zinc-500 sm:block">
                {fmtMs(j.durationMs)}
              </p>
              <p className="hidden text-right font-mono text-[11px] text-zinc-500 sm:block">
                {timeAgo(j.finishedAt ?? j.createdAt)}
              </p>
            </div>
          ))}
        </div>
      </Panel>

      {/* schedule form */}
      <Panel>
        <PanelHeader
          title="Automation schedule"
          hint="Controls consumed by the orchestrator on every tick"
        />
        <div className="p-5">
          <AutomationConfigForm
            defaults={{
              discoveryIntervalHours: settings?.discoveryIntervalHours ?? 6,
              publishWindowStart: settings?.publishWindowStart ?? "09:00",
              publishWindowEnd: settings?.publishWindowEnd ?? "21:00",
              dailyPublishCap: settings?.dailyPublishCap ?? 8,
              maxConcurrentJobs: settings?.maxConcurrentJobs ?? 3,
              autoRetry: settings?.autoRetry ?? true,
              timezone: settings?.timezone ?? "UTC",
              judgeThreshold: settings?.judgeThreshold ?? 72,
              scoutMaxStoriesPerRun: settings?.scoutMaxStoriesPerRun ?? 20,
              retryDelayMinutes: settings?.retryDelayMinutes ?? 15,
            }}
          />
        </div>
      </Panel>
    </div>
  );
}
