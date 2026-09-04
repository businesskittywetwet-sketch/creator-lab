import { AlertTriangle, Cpu, Server } from "lucide-react";
import { activeWorkers, listJobs, queueStats } from "@/engine";
import { db } from "@/db";
import { channels, jobEvents, niches } from "@/db/schema";
import { desc } from "drizzle-orm";
import { fmtMs, timeAgo } from "@/lib/format";
import { JobActions, RunWorkerButton } from "@/components/job-controls";
import { EmptyState, PageHeader, Panel, PanelHeader, StatusBadge } from "@/components/ui";

export const dynamic = "force-dynamic";

const STATUS_TONE: Record<string, string> = {
  queued: "queued",
  running: "running",
  retrying: "running",
  paused: "paused",
  completed: "success",
  failed: "failed",
  cancelled: "idle",
};

const TYPE_LABEL: Record<string, string> = {
  scout_cycle: "Scout",
  production_step: "Production",
  render: "Render",
  publish: "Publish",
  analytics_refresh: "Analytics",
};

export default async function WorkersPage() {
  const [stats, jobs, workerRows, nicheRows, channelRows, events] = await Promise.all([
    queueStats(),
    listJobs(60),
    activeWorkers(),
    db.select().from(niches),
    db.select().from(channels),
    db.select().from(jobEvents).orderBy(desc(jobEvents.createdAt)).limit(25),
  ]);

  const nicheById = new Map(nicheRows.map((n) => [n.id, n]));
  const chanById = new Map(channelRows.map((c) => [c.id, c]));
  const live = workerRows.filter((w) => w.alive && w.status !== "stopped");

  return (
    <div className="space-y-6">
      <PageHeader
        eyebrow="Infrastructure"
        title="Workers & job queue"
        description="Durable async execution. Jobs persist in the database and survive request termination, restarts and worker crashes."
        actions={<RunWorkerButton />}
      />

      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4 xl:grid-cols-7">
        {[
          { l: "Workers", v: live.length, t: "text-sky-300" },
          { l: "Queued", v: stats.queued, t: "text-zinc-200" },
          { l: "Running", v: stats.running, t: "text-sky-300" },
          { l: "Retrying", v: stats.retrying, t: "text-amber-300" },
          { l: "Paused", v: stats.paused, t: "text-zinc-400" },
          { l: "Completed", v: stats.completed, t: "text-signal" },
          { l: "Failed", v: stats.failed, t: "text-red-300" },
        ].map((c, i) => (
          <div key={c.l} className="panel p-4 animate-fade-up" style={{ animationDelay: `${i * 35}ms` }}>
            <p className="eyebrow">{c.l}</p>
            <p className={`mt-2 font-display text-2xl font-bold ${c.t}`}>{c.v}</p>
          </div>
        ))}
      </div>

      <Panel>
        <PanelHeader
          title="Worker pool"
          hint="Lease-based claiming — two workers can never process the same job"
        />
        {workerRows.length === 0 ? (
          <p className="px-5 py-8 text-center text-xs text-zinc-600">
            No workers have registered yet. Run a worker tick or call /api/cron/worker.
          </p>
        ) : (
          <div className="divide-y divide-white/[0.05]">
            {workerRows.slice(0, 8).map((w) => (
              <div key={w.id} className="flex flex-wrap items-center gap-3 px-5 py-3">
                <Server className={`size-4 ${w.alive ? "text-signal" : "text-zinc-700"}`} />
                <span className="font-mono text-xs text-zinc-300">{w.id}</span>
                <span className="font-mono text-[10px] text-zinc-600">{w.hostname}</span>
                <StatusBadge status={w.alive ? (w.status === "busy" ? "running" : "idle") : "idle"}
                  label={w.alive ? w.status : "stale"} />
                <span className="ml-auto font-mono text-[10px] text-zinc-500">
                  concurrency {w.concurrency} · {w.jobsProcessed} processed · {w.jobsFailed} failed
                </span>
                <span className="font-mono text-[10px] text-zinc-600">
                  beat {timeAgo(w.lastHeartbeatAt)}
                </span>
              </div>
            ))}
          </div>
        )}
      </Panel>

      {jobs.length === 0 ? (
        <EmptyState
          icon={Cpu}
          title="No jobs in the queue"
          body="Jobs are created by scouting schedules, production pipelines and scheduled publishing."
          action={<RunWorkerButton />}
        />
      ) : (
        <Panel>
          <PanelHeader title="Job queue" hint={`${jobs.length} most relevant jobs`} />
          <div className="divide-y divide-white/[0.05]">
            {jobs.map((j) => {
              const niche = j.nicheId ? nicheById.get(j.nicheId) : undefined;
              const chan = j.channelId ? chanById.get(j.channelId) : undefined;
              const elapsed = j.elapsedMs;
              return (
                <div key={j.id} className="grid grid-cols-1 gap-2 px-5 py-3.5 lg:grid-cols-[minmax(0,1fr)_260px_170px]">
                  <div className="min-w-0">
                    <div className="flex flex-wrap items-center gap-2">
                      <span
                        className="size-1.5 rounded-full"
                        style={{ background: niche?.color ?? chan?.color ?? "#8b93a7" }}
                      />
                      <span className="font-mono text-[9px] uppercase tracking-[0.16em] text-zinc-500">
                        {niche?.name ?? chan?.name ?? "system"}
                      </span>
                      <span className="rounded border border-white/10 bg-white/[0.03] px-1.5 py-0.5 font-mono text-[9px] uppercase text-zinc-400">
                        {TYPE_LABEL[j.type] ?? j.type}
                      </span>
                      <StatusBadge status={STATUS_TONE[j.status] ?? "queued"} label={j.status} />
                      <span className="font-mono text-[9px] text-zinc-600">P{j.priority}</span>
                    </div>
                    <p className="mt-1 truncate text-[13px] text-zinc-200">
                      {j.progressLabel || j.currentStep || "—"}
                    </p>
                    {j.lastError && (
                      <p className="mt-1 truncate font-mono text-[10px] text-red-300/80">
                        {j.errorKind === "transient" ? "transient · " : "permanent · "}
                        {j.lastError}
                      </p>
                    )}
                  </div>

                  <div className="font-mono text-[10px] leading-relaxed text-zinc-500">
                    <p>
                      attempt {j.attempts}/{j.maxAttempts}
                      {j.workerId ? ` · ${j.workerId}` : ""}
                    </p>
                    <p>
                      {elapsed != null ? `elapsed ${fmtMs(elapsed)}` : "not started"} · updated{" "}
                      {timeAgo(j.updatedAt)}
                    </p>
                    {j.cancelRequested && (
                      <p className="text-amber-300">cancellation pending</p>
                    )}
                  </div>

                  <JobActions id={j.id} status={j.status} />
                </div>
              );
            })}
          </div>
        </Panel>
      )}

      <Panel>
        <PanelHeader
          title="Worker event log"
          hint="Full audit trail — answers “why didn’t this publish?” without server logs"
          action={<AlertTriangle className="size-4 text-zinc-600" />}
        />
        <div className="divide-y divide-white/[0.05]">
          {events.map((e) => (
            <div key={e.id} className="flex flex-wrap items-center gap-3 px-5 py-2">
              <span className="font-mono text-[10px] text-zinc-600">{timeAgo(e.createdAt)}</span>
              <span
                className={`rounded border px-1.5 py-0.5 font-mono text-[9px] uppercase ${
                  e.event === "failed"
                    ? "border-red-400/30 bg-red-400/10 text-red-300"
                    : e.event === "succeeded"
                      ? "border-signal/30 bg-signal/10 text-signal"
                      : "border-white/10 bg-white/[0.03] text-zinc-400"
                }`}
              >
                {e.event}
              </span>
              {e.step && <span className="font-mono text-[10px] text-zinc-500">{e.step}</span>}
              {e.workerId && <span className="font-mono text-[10px] text-zinc-600">{e.workerId}</span>}
              {e.durationMs != null && (
                <span className="font-mono text-[10px] text-zinc-600">{fmtMs(e.durationMs)}</span>
              )}
              {e.retryReason && (
                <span className="font-mono text-[10px] text-amber-300/80">{e.retryReason}</span>
              )}
              {e.error && (
                <span className="min-w-0 flex-1 truncate font-mono text-[10px] text-red-300/70">
                  {e.error}
                </span>
              )}
            </div>
          ))}
          {events.length === 0 && (
            <p className="px-5 py-8 text-center text-xs text-zinc-600">No worker events yet.</p>
          )}
        </div>
      </Panel>
    </div>
  );
}
