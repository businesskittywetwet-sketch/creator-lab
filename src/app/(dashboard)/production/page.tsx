import Link from "next/link";
import { ArrowRight, Clapperboard, Clock3, FileText, Gauge } from "lucide-react";
import { getGlobalCost, getProductionJobs } from "@/lib/queries";
import { PRODUCTION_STEPS, JOB_STATUS_LABELS } from "@/lib/production-steps";
import { productionProviderLabel } from "@/lib/services/production";
import { mediaProviderSummary } from "@/lib/services/media";
import { ModeBadge } from "@/components/production-controls";
import { fmtDurationSec, timeAgo } from "@/lib/format";
import { RunJobButton, RunQueueButton } from "@/components/production-controls";
import {
  EmptyState,
  MiniBar,
  PageHeader,
  Panel,
  PanelHeader,
  StatusBadge,
} from "@/components/ui";

export const dynamic = "force-dynamic";

const STEP_TONE: Record<string, string> = {
  success: "border-signal/40 bg-signal/15 text-signal",
  running: "border-sky-400/40 bg-sky-400/15 text-sky-300",
  failed: "border-red-400/40 bg-red-400/15 text-red-300",
  skipped: "border-white/[0.06] bg-white/[0.02] text-zinc-700",
  pending: "border-white/[0.07] bg-white/[0.02] text-zinc-600",
};

export default async function ProductionPage() {
  const [jobs, cost] = await Promise.all([getProductionJobs(), getGlobalCost()]);
  const media = mediaProviderSummary();
  const usd = (m: number) => `$${(m / 1e6).toFixed(4)}`;

  const counts = {
    queued: jobs.filter((j) => j.status === "queued").length,
    running: jobs.filter((j) => j.status === "running").length,
    review: jobs.filter((j) => j.status === "awaiting_review").length,
    completed: jobs.filter((j) => j.status === "completed").length,
    failed: jobs.filter((j) => j.status === "failed").length,
  };

  return (
    <div className="space-y-6">
      <PageHeader
        eyebrow="Studio"
        title="Production pipeline"
        description="Greenlit stories are taken from research to a finished draft: research, fact check, concept, script, visual plan, narration, assembly, QC, then human review."
        actions={<RunQueueButton />}
      />

      {/* status strip */}
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-5">
        {[
          { label: "Queued", value: counts.queued, tone: "text-zinc-300" },
          { label: "Running", value: counts.running, tone: "text-sky-300" },
          { label: "Awaiting review", value: counts.review, tone: "text-signal" },
          { label: "Completed", value: counts.completed, tone: "text-emerald-300" },
          { label: "Failed", value: counts.failed, tone: "text-red-300" },
        ].map((c, i) => (
          <div
            key={c.label}
            className="panel p-4 animate-fade-up"
            style={{ animationDelay: `${i * 50}ms` }}
          >
            <p className="eyebrow">{c.label}</p>
            <p className={`mt-2 font-display text-2xl font-bold ${c.tone}`}>{c.value}</p>
          </div>
        ))}
      </div>

      {/* provider + cost summary */}
      <div className="grid grid-cols-1 gap-4 xl:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]">
        <Panel>
          <PanelHeader title="Generation providers" hint="Resolved from environment variables" />
          <div className="grid grid-cols-2 gap-px overflow-hidden rounded-b-[1.25rem] bg-white/[0.04] sm:grid-cols-4">
            {[
              { label: "Text / script", value: productionProviderLabel(), real: productionProviderLabel().startsWith("composer") === false },
              { label: "Images", value: `${media.image.provider}`, real: media.image.real },
              { label: "Voice", value: media.voice.provider === "none" ? "not configured" : media.voice.provider, real: media.voice.real },
              { label: "Render", value: media.render.provider, real: media.render.real },
            ].map((p) => (
              <div key={p.label} className="bg-[#0a0c12] px-4 py-3.5">
                <p className="font-mono text-[9px] uppercase tracking-[0.18em] text-zinc-500">{p.label}</p>
                <p className="mt-1.5 truncate text-xs text-zinc-200" title={p.value}>{p.value}</p>
                <ModeBadge mode={p.real ? "real_ai" : "fallback"} className="mt-2" />
              </div>
            ))}
          </div>
        </Panel>
        <Panel>
          <PanelHeader title="Production cost" hint={`${cost.generations} generations · ${cost.tokens.toLocaleString()} tokens`} />
          <div className="grid grid-cols-2 gap-px overflow-hidden rounded-b-[1.25rem] bg-white/[0.04] sm:grid-cols-4">
            <div className="bg-[#0a0c12] px-4 py-3.5">
              <p className="font-mono text-[9px] uppercase tracking-[0.18em] text-zinc-500">Total spend</p>
              <p className="mt-1.5 font-display text-xl font-bold text-white">{usd(cost.totalMicroUsd)}</p>
            </div>
            <div className="bg-[#0a0c12] px-4 py-3.5">
              <p className="font-mono text-[9px] uppercase tracking-[0.18em] text-zinc-500">Per video</p>
              <p className="mt-1.5 font-display text-xl font-bold text-signal">{usd(cost.perVideoMicroUsd)}</p>
            </div>
            <div className="bg-[#0a0c12] px-4 py-3.5">
              <p className="font-mono text-[9px] uppercase tracking-[0.18em] text-zinc-500">Videos</p>
              <p className="mt-1.5 font-display text-xl font-bold text-zinc-200">{cost.jobs}</p>
            </div>
            <div className="bg-[#0a0c12] px-4 py-3.5">
              <p className="font-mono text-[9px] uppercase tracking-[0.18em] text-zinc-500">Failed calls</p>
              <p className={`mt-1.5 font-display text-xl font-bold ${cost.failures ? "text-red-300" : "text-zinc-200"}`}>{cost.failures}</p>
            </div>
          </div>
        </Panel>
      </div>

      <Panel>
        <PanelHeader
          title="Pipeline stages"
          hint="Nine-step draft production — steps can be disabled per channel"
          action={
            <span className="rounded-md border border-white/10 bg-white/[0.03] px-2 py-1 font-mono text-[10px] text-zinc-400">
              engine: {productionProviderLabel()}
            </span>
          }
        />
        <div className="grid grid-cols-3 gap-px overflow-hidden rounded-b-[1.25rem] bg-white/[0.04] sm:grid-cols-5 lg:grid-cols-9">
          {PRODUCTION_STEPS.map((s) => {
            const done = jobs.reduce(
              (a, j) => a + (j.steps.find((x) => x.stepKey === s.key)?.status === "success" ? 1 : 0),
              0,
            );
            return (
              <div key={s.key} className="bg-[#0a0c12] px-3 py-4" title={s.description}>
                <p className="truncate font-mono text-[9px] uppercase tracking-[0.14em] text-zinc-500">
                  {s.label}
                </p>
                <p className="mt-2 font-display text-xl font-bold" style={{ color: done ? s.hex : "#3f3f46" }}>
                  {done}
                </p>
                <MiniBar value={done} max={Math.max(1, jobs.length)} color={s.hex} className="mt-2.5" />
              </div>
            );
          })}
        </div>
      </Panel>

      {jobs.length === 0 ? (
        <EmptyState
          icon={Clapperboard}
          title="No production jobs yet"
          body="Jobs open automatically when the Story Judge greenlights a story into the content queue. You can also start the queue manually."
          action={<RunQueueButton />}
        />
      ) : (
        <div className="space-y-3">
          {jobs.map((job, i) => {
            const pct = job.totalSteps
              ? Math.round((job.completedSteps / job.totalSteps) * 100)
              : 0;
            return (
              <Panel
                key={job.id}
                className="card-hover p-4 animate-fade-up"
                style={{ animationDelay: `${Math.min(i, 10) * 45}ms` }}
              >
                <div className="flex flex-wrap items-start gap-3">
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2">
                      <span
                        className="size-1.5 rounded-full"
                        style={{ background: job.channelColor }}
                      />
                      <span className="font-mono text-[9px] uppercase tracking-[0.18em] text-zinc-500">
                        {job.channelName}
                      </span>
                      <StatusBadge
                        status={
                          job.status === "awaiting_review"
                            ? "queued"
                            : job.status === "completed"
                              ? "success"
                              : job.status
                        }
                        label={JOB_STATUS_LABELS[job.status] ?? job.status}
                      />
                    </div>
                    <Link href={`/production/${job.id}`}>
                      <h3 className="clamp-2 mt-1.5 font-display text-[15px] font-semibold leading-snug text-white hover:text-signal">
                        {job.contentTitle}
                      </h3>
                    </Link>
                    <div className="mt-2 flex flex-wrap items-center gap-x-4 gap-y-1 font-mono text-[10px] text-zinc-500">
                      <span>{job.completedSteps}/{job.totalSteps} steps · {pct}%</span>
                      {job.wordCount ? <span><FileText className="mr-1 inline size-3" />{job.wordCount}w</span> : null}
                      {job.estimatedDurationSec ? (
                        <span><Clock3 className="mr-1 inline size-3" />{fmtDurationSec(job.estimatedDurationSec)}</span>
                      ) : null}
                      {job.qcScore ? (
                        <span className={job.qcScore >= 70 ? "text-signal" : "text-amber-300"}>
                          <Gauge className="mr-1 inline size-3" />QC {job.qcScore}
                        </span>
                      ) : null}
                      <span>updated {timeAgo(job.updatedAt)}</span>
                    </div>
                  </div>

                  <div className="flex items-center gap-2">
                    <RunJobButton jobId={job.id} status={job.status} />
                    <Link
                      href={`/production/${job.id}`}
                      className="inline-flex items-center gap-1.5 rounded-md border border-white/10 px-2.5 py-1.5 font-mono text-[10px] uppercase tracking-[0.08em] text-zinc-400 transition hover:border-white/25 hover:text-white"
                    >
                      Draft <ArrowRight className="size-3" />
                    </Link>
                  </div>
                </div>

                {/* step chips */}
                <div className="mt-3 flex flex-wrap gap-1.5 border-t border-white/[0.05] pt-3">
                  {job.steps.map((s) => (
                    <span
                      key={s.id}
                      title={`${s.label}: ${s.status}${s.error ? ` — ${s.error}` : ""}`}
                      className={`rounded border px-1.5 py-0.5 font-mono text-[9px] uppercase tracking-[0.08em] ${
                        STEP_TONE[s.status] ?? STEP_TONE.pending
                      }`}
                    >
                      {s.label}
                    </span>
                  ))}
                </div>

                {job.lastError && (
                  <p className="mt-2 truncate rounded-md border border-red-400/20 bg-red-400/[0.06] px-2.5 py-1.5 font-mono text-[10px] text-red-300/80">
                    {job.lastError}
                  </p>
                )}
              </Panel>
            );
          })}
        </div>
      )}
    </div>
  );
}
