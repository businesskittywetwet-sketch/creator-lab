import Link from "next/link";
import { notFound } from "next/navigation";
import {
  AlertTriangle,
  ArrowLeft,
  BookOpenText,
  CheckCircle2,
  Clock3,
  FileText,
  Film,
  Gauge,
  ImagePlus,
  Mic,
  ShieldCheck,
  XCircle,
} from "lucide-react";
import { getProductionJobDetail, getYouTubeJobConfig } from "@/lib/queries";
import { YouTubePublishPanel } from "@/components/youtube-controls";
import { JOB_STATUS_LABELS, productionStepDef } from "@/lib/production-steps";
import { fmtDurationSec, fmtMs, timeAgo } from "@/lib/format";
import { RunJobButton, ReviewControls, ModeBadge } from "@/components/production-controls";
import { DraftEditor, RevisionList } from "@/components/draft-editor";
import { PreparePublishButton } from "@/components/publish-controls";
import type { ScriptSection, VisualShot } from "@/db/schema";
import {
  MiniBar,
  PageHeader,
  Panel,
  PanelHeader,
  ScoreOrb,
  StatusBadge,
} from "@/components/ui";

export const dynamic = "force-dynamic";

type Params = { params: Promise<{ id: string }> };

function asRecord(v: unknown): Record<string, unknown> {
  return v && typeof v === "object" ? (v as Record<string, unknown>) : {};
}
function asList(v: unknown): string[] {
  return Array.isArray(v) ? v.filter((x): x is string => typeof x === "string") : [];
}

export default async function ProductionDetailPage({ params }: Params) {
  const { id } = await params;
  const [detail, ytConfig] = await Promise.all([
    getProductionJobDetail(id),
    getYouTubeJobConfig(id),
  ]);
  if (!detail) notFound();

  const { job, draft, assets, usage, revisions } = detail;
  const images = assets.filter((a) => a.kind === "image");
  const audio = assets.find((a) => a.kind === "audio");
  const video = assets.find((a) => a.kind === "video");
  const capsAsset = assets.find((a) => a.kind === "captions");
  const usd = (micro: number) => `$${(micro / 1e6).toFixed(4)}`;
  const research = asRecord(draft?.researchBrief);
  const factCheck = asRecord(draft?.factCheck);
  const narration = asRecord(draft?.narrationPlan);
  const assembly = asRecord(draft?.assemblyPlan);
  const qc = asRecord(draft?.qcReport);
  const sections: ScriptSection[] = draft?.sections ?? [];
  const shots: VisualShot[] = draft?.visualPlan ?? [];
  const verdicts = Array.isArray(factCheck.verdicts) ? factCheck.verdicts : [];
  const flagged = Array.isArray(factCheck.flagged) ? factCheck.flagged : [];
  const conceptList = (draft?.concepts ?? []) as Record<string, unknown>[];
  const qcBlocks = qc.blocksApproval === true;
  const criticalCount = Number(qc.criticalCount ?? 0);
  const findings = Array.isArray(qc.findings) ? qc.findings : [];
  const pct = job.totalSteps ? Math.round((job.completedSteps / job.totalSteps) * 100) : 0;

  return (
    <div className="space-y-6">
      <Link
        href="/production"
        className="inline-flex items-center gap-1.5 font-mono text-[10px] uppercase tracking-[0.18em] text-zinc-500 transition hover:text-signal"
      >
        <ArrowLeft className="size-3" /> Production
      </Link>

      <PageHeader
        eyebrow={`${job.channelName} · draft v${draft?.version ?? 1}`}
        title={draft?.title || job.contentTitle}
        description={draft?.angle || undefined}
        actions={
          <div className="flex items-center gap-2">
            <ModeBadge mode={draft?.generationMode ?? "pending"} />
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
            <RunJobButton jobId={job.id} status={job.status} />
          </div>
        }
      />

      {/* progress + metrics */}
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-[minmax(0,2fr)_minmax(0,1fr)]">
        <Panel className="p-5">
          <div className="mb-3 flex items-center justify-between">
            <p className="eyebrow">Pipeline progress</p>
            <p className="font-mono text-xs text-zinc-400">
              {job.completedSteps}/{job.totalSteps} · {pct}%
            </p>
          </div>
          <MiniBar value={job.completedSteps} max={job.totalSteps} className="mb-5" />
          <ol className="space-y-2">
            {job.steps.map((s) => {
              const def = productionStepDef(s.stepKey);
              return (
                <li
                  key={s.id}
                  className="flex items-center gap-3 rounded-lg border border-white/[0.05] bg-white/[0.02] px-3 py-2"
                >
                  <span
                    className="grid size-6 shrink-0 place-items-center rounded-md border font-mono text-[9px]"
                    style={{
                      borderColor: `${def.hex}44`,
                      background: `${def.hex}12`,
                      color: def.hex,
                    }}
                  >
                    {def.short.slice(0, 2)}
                  </span>
                  <div className="min-w-0 flex-1">
                    <p className="text-[13px] font-medium text-zinc-200">{s.label}</p>
                    {s.error ? (
                      <p className="truncate font-mono text-[10px] text-red-300/80">{s.error}</p>
                    ) : (
                      <p className="flex flex-wrap items-center gap-1.5 font-mono text-[10px] text-zinc-600">
                        {s.provider || s.agentSlug}
                        {s.durationMs != null ? ` · ${fmtMs(s.durationMs)}` : ""}
                        {s.attempts > 1 ? ` · ${s.attempts} attempts` : ""}
                        {s.status === "success" && <ModeBadge mode={s.generationMode} />}
                      </p>
                    )}
                  </div>
                  {s.status === "success" ? (
                    <CheckCircle2 className="size-4 shrink-0 text-signal" />
                  ) : s.status === "failed" ? (
                    <XCircle className="size-4 shrink-0 text-red-400" />
                  ) : s.status === "running" ? (
                    <span className="dot-live size-2 shrink-0 rounded-full bg-sky-400 text-sky-400" />
                  ) : (
                    <span className="size-2 shrink-0 rounded-full bg-zinc-700" />
                  )}
                </li>
              );
            })}
          </ol>
        </Panel>

        <div className="space-y-4">
          <Panel className="p-5">
            <p className="eyebrow mb-3">Draft metrics</p>
            <div className="grid grid-cols-2 gap-3">
              <div className="rounded-lg border border-white/[0.06] bg-white/[0.02] p-3">
                <p className="font-mono text-[9px] uppercase tracking-[0.18em] text-zinc-500">Words</p>
                <p className="mt-1 font-display text-lg font-bold text-white">
                  {draft?.wordCount || "—"}
                </p>
              </div>
              <div className="rounded-lg border border-white/[0.06] bg-white/[0.02] p-3">
                <p className="font-mono text-[9px] uppercase tracking-[0.18em] text-zinc-500">Runtime</p>
                <p className="mt-1 font-display text-lg font-bold text-white">
                  {fmtDurationSec(draft?.estimatedDurationSec)}
                </p>
              </div>
              <div className="col-span-2 flex items-center gap-3 rounded-lg border border-white/[0.06] bg-white/[0.02] p-3">
                <ScoreOrb score={draft?.qcScore ?? 0} size={40} />
                <div>
                  <p className="font-mono text-[9px] uppercase tracking-[0.18em] text-zinc-500">
                    QC score
                  </p>
                  <p className="mt-0.5 text-xs text-zinc-400">
                    {qc.retentionRisk ? `retention: ${String(qc.retentionRisk)}` : "not yet scored"}
                  </p>
                </div>
              </div>
            </div>
            <p className="mt-3 font-mono text-[10px] text-zinc-600">
              engine {job.provider || "—"} · updated {timeAgo(job.updatedAt)}
            </p>
          </Panel>

          {(job.status === "awaiting_review" || draft?.status === "ready_for_review") && (
            <Panel className="scanline p-5">
              <p className="eyebrow mb-1">Review gate</p>
              <h3 className="font-display text-sm font-bold text-white">
                Draft is ready for sign-off
              </h3>
              <p className="mb-4 mt-1 text-xs leading-relaxed text-zinc-500">
                Approving completes the job. Publishing stays manual — nothing is sent to any
                platform.
              </p>
              <ReviewControls jobId={job.id} qcBlocks={qcBlocks} criticalCount={criticalCount} />
            </Panel>
          )}

          {draft?.status === "approved" && (
            <Panel className="p-5">
              <div className="flex items-center gap-2">
                <CheckCircle2 className="size-4 text-signal" />
                <p className="font-display text-sm font-bold text-white">Draft approved</p>
              </div>
              {draft.reviewNotes && (
                <p className="mt-2 text-xs text-zinc-500">{draft.reviewNotes}</p>
              )}
            </Panel>
          )}

          {draft?.status === "changes_requested" && (
            <Panel className="border-amber-400/20 p-5">
              <div className="flex items-center gap-2">
                <AlertTriangle className="size-4 text-amber-300" />
                <p className="font-display text-sm font-bold text-amber-200">Changes requested</p>
              </div>
              <p className="mt-2 text-xs text-zinc-400">{draft.reviewNotes}</p>
              <p className="mt-2 font-mono text-[10px] text-zinc-600">
                Re-run the job to regenerate the script, QC and review steps.
              </p>
            </Panel>
          )}
        </div>
      </div>

      {/* operator editing */}
      {draft && (
        <div className="flex flex-wrap items-center gap-2">
          <DraftEditor
            draft={{
              jobId: job.id,
              title: draft.title ?? "",
              hook: draft.hook ?? "",
              scriptBody: draft.scriptBody ?? "",
              cta: draft.cta ?? "",
              socialCaption: draft.socialCaption ?? "",
              description: draft.description ?? "",
              hashtags: draft.hashtags ?? [],
              editedFields: draft.editedFields ?? [],
              revision: draft.revision ?? 0,
            }}
          />
          {draft.status === "approved" && <PreparePublishButton contentId={job.contentId} />}
          {draft.editedFields?.length > 0 && (
            <span className="rounded-md border border-sky-400/30 bg-sky-400/[0.07] px-2 py-1.5 font-mono text-[10px] text-sky-300">
              {draft.editedFields.length} field(s) human-edited
            </span>
          )}
        </div>
      )}

      {/* video preview + assets */}
      <div className="grid grid-cols-1 gap-4 xl:grid-cols-[minmax(0,360px)_minmax(0,1fr)]">
        <Panel>
          <PanelHeader
            title="Video draft"
            hint={video?.status === "generated" ? `${video.provider} · ${video.bytes ? Math.round(video.bytes / 1024) : 0} KB` : "Not rendered"}
          />
          <div className="p-4">
            {video?.status === "generated" && video.url ? (
              <>
                { }
                <video
                  controls
                  playsInline
                  preload="metadata"
                  src={video.url}
                  className="w-full rounded-xl border border-white/10 bg-black"
                  style={{ aspectRatio: "9 / 16", maxHeight: 520 }}
                >
                  {capsAsset?.url && (
                    <track kind="captions" src={capsAsset.url} srcLang="en" label="English" default />
                  )}
                </video>
                <div className="mt-3 flex flex-wrap items-center gap-2 font-mono text-[10px] text-zinc-500">
                  <span>{video.durationSec ?? 0}s</span>
                  <span>· {String((video.metadata as Record<string, unknown>)?.scenes ?? 0)} scenes</span>
                  <span>· audio: {(video.metadata as Record<string, unknown>)?.hasAudio ? "yes" : "none"}</span>
                  <a href={video.url} download className="ml-auto text-signal hover:underline">
                    download
                  </a>
                </div>
              </>
            ) : (
              <div
                className="grid place-items-center rounded-xl border border-dashed border-white/10 p-8 text-center"
                style={{ aspectRatio: "9 / 16", maxHeight: 420 }}
              >
                <div>
                  <Film className="mx-auto size-6 text-zinc-700" />
                  <p className="mt-3 text-xs text-zinc-500">No video rendered yet</p>
                  {video?.error && (
                    <p className="mt-2 font-mono text-[10px] text-red-300/80">{video.error}</p>
                  )}
                </div>
              </div>
            )}
          </div>
        </Panel>

        <div className="space-y-4">
          <Panel>
            <PanelHeader
              title="Generated assets"
              hint={`${images.filter((i) => i.status === "generated").length}/${images.length} scenes · audio ${audio?.status ?? "none"} · captions ${capsAsset ? "yes" : "no"}`}
            />
            <div className="p-4">
              {images.length > 0 ? (
                <div className="grid grid-cols-3 gap-2 sm:grid-cols-5">
                  {images.map((img) => (
                    <div key={img.id} className="overflow-hidden rounded-lg border border-white/[0.08]">
                      {img.status === "generated" && img.url ? (
                        // eslint-disable-next-line @next/next/no-img-element
                        <img
                          src={img.url}
                          alt={`Scene ${img.sceneNumber}`}
                          className="aspect-[9/16] w-full object-cover"
                        />
                      ) : (
                        <div className="grid aspect-[9/16] w-full place-items-center bg-white/[0.02] text-center">
                          <span className="px-1 font-mono text-[8px] text-red-300/80">
                            missing
                          </span>
                        </div>
                      )}
                      <p className="truncate bg-black/40 px-1 py-0.5 text-center font-mono text-[8px] text-zinc-500">
                        {img.sceneNumber} · {img.provider}
                      </p>
                    </div>
                  ))}
                </div>
              ) : (
                <p className="text-xs text-zinc-600">No visual assets generated yet.</p>
              )}

              <div className="mt-4 grid grid-cols-1 gap-2 sm:grid-cols-2">
                <div className="rounded-lg border border-white/[0.06] bg-white/[0.02] p-3">
                  <p className="flex items-center gap-2 font-mono text-[9px] uppercase tracking-[0.18em] text-zinc-500">
                    <Mic className="size-3" /> Narration
                  </p>
                  {audio?.status === "generated" && audio.url ? (
                     
                    <audio controls src={audio.url} className="mt-2 w-full" />
                  ) : (
                    <p className="mt-1.5 text-[11px] leading-relaxed text-amber-200/70">
                      {audio?.error ?? "Not generated — no TTS provider configured."}
                    </p>
                  )}
                </div>
                <div className="rounded-lg border border-white/[0.06] bg-white/[0.02] p-3">
                  <p className="font-mono text-[9px] uppercase tracking-[0.18em] text-zinc-500">
                    Captions
                  </p>
                  {capsAsset?.url ? (
                    <p className="mt-1.5 text-[11px] text-zinc-400">
                      {String((capsAsset.metadata as Record<string, unknown>)?.cues ?? 0)} cues ·{" "}
                      <a href={capsAsset.url} className="text-signal hover:underline" target="_blank" rel="noreferrer">
                        view .vtt
                      </a>
                    </p>
                  ) : (
                    <p className="mt-1.5 text-[11px] text-zinc-600">No caption track.</p>
                  )}
                </div>
              </div>
            </div>
          </Panel>

          <Panel>
            <PanelHeader title="Production cost" hint={`${usage.generations} generations · ${usage.tokens.toLocaleString()} tokens`} />
            <div className="flex flex-wrap items-center gap-6 px-5 py-4">
              <div>
                <p className="font-mono text-[9px] uppercase tracking-[0.18em] text-zinc-500">Total</p>
                <p className="mt-1 font-display text-2xl font-bold text-white">{usd(usage.totalMicroUsd)}</p>
              </div>
              {usage.byKind.map((k) => (
                <div key={k.kind}>
                  <p className="font-mono text-[9px] uppercase tracking-[0.18em] text-zinc-500">{k.kind}</p>
                  <p className="mt-1 font-mono text-sm text-zinc-300">{usd(k.costMicroUsd)}</p>
                  <p className="font-mono text-[9px] text-zinc-600">{k.calls} calls</p>
                </div>
              ))}
              {usage.failures > 0 && (
                <p className="font-mono text-[10px] text-red-300">{usage.failures} failed call(s)</p>
              )}
            </div>
          </Panel>
        </div>
      </div>

      {/* concepts considered */}
      {conceptList.length > 0 && (
        <Panel>
          <PanelHeader title="Concepts considered" hint="Scored angles — highest weighted score selected" />
          <div className="grid grid-cols-1 gap-2 p-4 sm:grid-cols-2 xl:grid-cols-4">
            {conceptList.map((c, i) => {
              const scores = asRecord(c.scores);
                const selected = String(draft?.hook ?? "") === String(c.hook ?? "");
              return (
                <div
                  key={i}
                  className={`rounded-xl border p-3 ${selected ? "border-signal/40 bg-signal/[0.06]" : "border-white/[0.06] bg-white/[0.02]"}`}
                >
                  <div className="flex items-center justify-between">
                    <p className="font-mono text-[9px] uppercase tracking-[0.16em] text-zinc-500">
                      {String(c.style ?? "")}
                    </p>
                    <span className={`font-mono text-xs font-bold ${selected ? "text-signal" : "text-zinc-400"}`}>
                      {Number(c.total ?? 0)}
                    </span>
                  </div>
                  <p className="clamp-2 mt-1.5 text-xs leading-relaxed text-zinc-300">{String(c.hook ?? "")}</p>
                  <div className="mt-2 flex flex-wrap gap-x-2 gap-y-0.5 font-mono text-[8.5px] text-zinc-600">
                    {Object.entries(scores).map(([k, v]) => (
                      <span key={k}>{k.slice(0, 4)} {Number(v)}</span>
                    ))}
                  </div>
                  {selected && (
                    <p className="mt-2 font-mono text-[9px] uppercase tracking-[0.12em] text-signal">selected</p>
                  )}
                </div>
              );
            })}
          </div>
        </Panel>
      )}

      {/* revision history */}
      {revisions.length > 0 && (
        <Panel>
          <PanelHeader
            title="Revision history"
            hint={`${revisions.length} revision(s) — every prior draft is preserved`}
          />
          <RevisionList
            jobId={job.id}
            revisions={revisions.map((r) => ({
              id: r.id,
              revision: r.revision,
              kind: r.kind,
              targetStep: r.targetStep,
              reason: r.reason,
              changedFields: r.changedFields ?? [],
              createdAt: new Date(r.createdAt).toISOString(),
              snapshot: (r.snapshot ?? {}) as Record<string, unknown>,
            }))}
          />
        </Panel>
      )}

      {/* hook + script */}
      <Panel>
        <PanelHeader
          title="Script"
          hint={draft?.cta ? `CTA · ${draft.cta}` : "Narration draft"}
          action={
            <span className="font-mono text-[10px] text-zinc-500">
              <FileText className="mr-1 inline size-3" />
              {sections.length} sections
            </span>
          }
        />
        {draft?.hook && (
          <div className="border-b border-white/[0.06] px-5 py-4">
            <p className="eyebrow mb-1.5">Hook</p>
            <p className="font-display text-base leading-relaxed text-signal">{draft.hook}</p>
          </div>
        )}
        {sections.length > 0 ? (
          <ol className="divide-y divide-white/[0.05]">
            {sections.map((s, i) => (
              <li key={i} className="flex gap-4 px-5 py-4">
                <span className="font-mono text-xs text-zinc-700">
                  {String(i + 1).padStart(2, "0")}
                </span>
                <div className="min-w-0 flex-1">
                  <div className="flex items-baseline gap-2">
                    <p className="font-display text-xs font-semibold uppercase tracking-[0.1em] text-zinc-400">
                      {s.heading}
                    </p>
                    <span className="font-mono text-[10px] text-zinc-600">
                      <Clock3 className="mr-1 inline size-2.5" />
                      {s.durationSec}s
                    </span>
                  </div>
                  <p className="mt-1.5 text-sm leading-relaxed text-zinc-300">{s.narration}</p>
                </div>
              </li>
            ))}
          </ol>
        ) : (
          <p className="px-5 py-8 text-center text-xs text-zinc-600">
            Script not written yet — run the job to generate it.
          </p>
        )}
        {draft?.cta && (
          <div className="border-t border-white/[0.06] px-5 py-3.5">
            <p className="text-sm text-zinc-400">
              <span className="eyebrow mr-2">CTA</span>
              {draft.cta}
            </p>
          </div>
        )}
      </Panel>

      {/* research + fact check */}
      <div className="grid grid-cols-1 gap-4 xl:grid-cols-2">
        <Panel>
          <PanelHeader title="Research brief" hint={String(research.topic ?? "")} />
          <div className="space-y-4 px-5 py-4">
            {Array.isArray(research.keyFacts) && research.keyFacts.length > 0 ? (
              <div>
                <p className="eyebrow mb-2">
                  <BookOpenText className="mr-1 inline size-3" /> Key facts
                  <span className="ml-2 text-zinc-600">confidence {Number(research.confidence ?? 0)}/100</span>
                </p>
                <ul className="space-y-2">
                  {(research.keyFacts as unknown[]).map((f, i) => {
                    const o = asRecord(f);
                    const text = typeof f === "string" ? f : String(o.fact ?? "");
                    const url = String(o.sourceUrl ?? "");
                    const title = String(o.sourceTitle ?? "");
                    return (
                      <li key={i} className="text-xs leading-relaxed text-zinc-400">
                        <span className="text-signal">· </span>{text}
                        {(title || url) && (
                          <a
                            href={url || undefined}
                            target="_blank"
                            rel="noreferrer"
                            className="ml-1.5 font-mono text-[9px] text-zinc-600 hover:text-signal"
                          >
                            [{title || "source"}]
                          </a>
                        )}
                      </li>
                    );
                  })}
                </ul>
              </div>
            ) : (
              <p className="text-xs text-zinc-600">Not researched yet.</p>
            )}
            {asList(research.entities).length > 0 && (
              <div>
                <p className="eyebrow mb-2">Entities & dates</p>
                <div className="flex flex-wrap gap-1.5">
                  {[...asList(research.entities), ...asList(research.dates)].map((e, i) => (
                    <span key={i} className="rounded border border-white/[0.07] bg-white/[0.02] px-1.5 py-0.5 font-mono text-[9px] text-zinc-400">
                      {e}
                    </span>
                  ))}
                </div>
              </div>
            )}
            {asList(research.cautions).length > 0 && (
              <div>
                <p className="eyebrow mb-2">Cautions</p>
                <ul className="space-y-1.5">
                  {asList(research.cautions).map((c, i) => (
                    <li key={i} className="flex gap-2 text-xs leading-relaxed text-amber-200/70">
                      <AlertTriangle className="mt-0.5 size-3 shrink-0" />
                      {c}
                    </li>
                  ))}
                </ul>
              </div>
            )}
          </div>
        </Panel>

        <Panel>
          <PanelHeader
            title="Fact check"
            hint={
              factCheck.claimsChecked
                ? `${String(factCheck.verified ?? 0)}/${String(factCheck.claimsChecked)} verified · ${String(factCheck.confidence ?? 0)}% confidence`
                : "Not checked yet"
            }
            action={
              factCheck.passed != null ? (
                <StatusBadge
                  status={factCheck.passed ? "success" : "failed"}
                  label={factCheck.passed ? "passed" : "blocked"}
                />
              ) : undefined
            }
          />
          <div className="px-5 py-4">
            {verdicts.length > 0 ? (
              <ul className="space-y-2">
                {verdicts.map((v, i) => {
                  const o = asRecord(v);
                  const supported = o.supported === true;
                  const critical = String(o.importance ?? "") === "critical";
                  return (
                    <li
                      key={i}
                      className={`rounded-lg border px-3 py-2 ${
                        supported
                          ? "border-emerald-400/20 bg-emerald-400/[0.05]"
                          : critical
                            ? "border-red-400/25 bg-red-400/[0.06]"
                            : "border-amber-400/20 bg-amber-400/[0.05]"
                      }`}
                    >
                      <p className="text-xs text-zinc-200">{String(o.claim ?? "")}</p>
                      <p className="mt-1 flex flex-wrap items-center gap-2 font-mono text-[9px] uppercase tracking-[0.1em]">
                        <span className={supported ? "text-emerald-300" : critical ? "text-red-300" : "text-amber-300"}>
                          {String(o.verdict ?? "unverified")}
                        </span>
                        <span className="text-zinc-600">conf {Number(o.confidence ?? 0)}</span>
                        <span className="text-zinc-600">{String(o.importance ?? "supporting")}</span>
                      </p>
                      {Array.isArray(o.sources) && o.sources.length > 0 && (
                        <p className="mt-1 truncate font-mono text-[9px] text-zinc-600">
                          {(o.sources as Record<string, unknown>[])
                            .map((x) => String(x.title || x.url || ""))
                            .filter(Boolean)
                            .join(" · ")}
                        </p>
                      )}
                    </li>
                  );
                })}
              </ul>
            ) : flagged.length > 0 ? (
              <ul className="space-y-2">
                {flagged.map((f, i) => {
                  const o = asRecord(f);
                  return (
                    <li
                      key={i}
                      className="rounded-lg border border-amber-400/20 bg-amber-400/[0.05] px-3 py-2"
                    >
                      <p className="text-xs text-amber-100/90">{String(o.claim ?? "")}</p>
                      <p className="mt-1 font-mono text-[10px] text-amber-200/60">
                        {String(o.note ?? "")}
                      </p>
                    </li>
                  );
                })}
              </ul>
            ) : (
              <p className="flex items-center gap-2 text-xs text-zinc-500">
                <ShieldCheck className="size-3.5 text-emerald-400" />
                {factCheck.claimsChecked ? "No claims flagged." : "Awaiting fact-check step."}
              </p>
            )}
          </div>
        </Panel>
      </div>

      {/* visual / narration / assembly */}
      <div className="grid grid-cols-1 gap-4 xl:grid-cols-3">
        <Panel>
          <PanelHeader title="Visual plan" hint={`${shots.length} shots`} />
          <div className="space-y-2 px-5 py-4">
            {shots.length === 0 && <p className="text-xs text-zinc-600">No shot list yet.</p>}
            {shots.map((s, i) => (
              <div key={i} className="rounded-lg border border-white/[0.05] bg-white/[0.02] p-3">
                <div className="flex items-center gap-2">
                  <ImagePlus className="size-3 text-violet-300" />
                  <p className="truncate font-mono text-[9px] uppercase tracking-[0.14em] text-zinc-500">
                    {s.section} · {s.assetType}
                  </p>
                </div>
                <p className="mt-1.5 text-xs leading-relaxed text-zinc-400">{s.description}</p>
                {s.overlayText && (
                  <p className="mt-1.5 inline-block rounded border border-white/10 px-1.5 py-0.5 font-mono text-[9px] text-zinc-300">
                    {s.overlayText}
                  </p>
                )}
              </div>
            ))}
          </div>
        </Panel>

        <Panel>
          <PanelHeader
            title="Voice / narration"
            hint={narration.voice ? String(narration.voice) : "Not planned yet"}
          />
          <div className="space-y-3 px-5 py-4">
            {narration.pacingWpm != null && (
              <p className="flex items-center gap-2 text-xs text-zinc-400">
                <Mic className="size-3.5 text-fuchsia-300" />
                {String(narration.pacingWpm)} wpm · {String(narration.tone ?? "")}
              </p>
            )}
            {Array.isArray(narration.sectionDirections) &&
              narration.sectionDirections.map((d, i) => {
                const o = asRecord(d);
                return (
                  <div key={i} className="rounded-lg border border-white/[0.05] bg-white/[0.02] p-3">
                    <p className="font-mono text-[9px] uppercase tracking-[0.14em] text-zinc-500">
                      {String(o.section ?? "")}
                    </p>
                    <p className="mt-1 text-xs leading-relaxed text-zinc-400">
                      {String(o.direction ?? "")}
                    </p>
                  </div>
                );
              })}
            {asList(narration.deliveryNotes).map((n, i) => (
              <p key={i} className="text-xs text-zinc-500">· {n}</p>
            ))}
            {!narration.voice && <p className="text-xs text-zinc-600">No narration plan yet.</p>}
          </div>
        </Panel>

        <Panel>
          <PanelHeader
            title="Video assembly"
            hint={assembly.aspectRatio ? String(assembly.aspectRatio) : "Not planned yet"}
          />
          <div className="space-y-2 px-5 py-4">
            {Array.isArray(assembly.timeline) &&
              assembly.timeline.map((t, i) => {
                const o = asRecord(t);
                return (
                  <div key={i} className="flex gap-3 text-xs">
                    <span className="shrink-0 font-mono text-[10px] text-orange-300">
                      {String(o.at ?? "")}
                    </span>
                    <span className="text-zinc-400">{String(o.action ?? "")}</span>
                  </div>
                );
              })}
            {assembly.musicCue ? (
              <p className="mt-2 flex items-center gap-2 border-t border-white/[0.05] pt-2 text-xs text-zinc-500">
                <Film className="size-3" /> {String(assembly.musicCue)}
              </p>
            ) : null}
            {assembly.transitions ? (
              <p className="text-xs text-zinc-500">{String(assembly.transitions)}</p>
            ) : null}
            {!assembly.timeline && <p className="text-xs text-zinc-600">No assembly plan yet.</p>}
          </div>
        </Panel>
      </div>

      {/* YouTube publish configuration */}
      {ytConfig && draft?.status === "approved" && (
        <Panel>
          <PanelHeader
            title="YouTube publish configuration"
            hint="Applied when the publish job is dispatched"
          />
          <YouTubePublishPanel config={ytConfig} />
        </Panel>
      )}

      {/* publishing metadata */}
      {draft && (draft.socialCaption || draft.description || (draft.hashtags?.length ?? 0) > 0) && (
        <Panel>
          <PanelHeader title="Publishing metadata" hint="Used when publish jobs are prepared" />
          <div className="grid grid-cols-1 gap-4 p-5 sm:grid-cols-2">
            {draft.socialCaption && (
              <div>
                <p className="eyebrow mb-1.5">Social caption</p>
                <p className="whitespace-pre-wrap rounded-lg border border-white/[0.06] bg-white/[0.02] p-3 text-xs leading-relaxed text-zinc-300">
                  {draft.socialCaption}
                </p>
              </div>
            )}
            {draft.description && (
              <div>
                <p className="eyebrow mb-1.5">Description</p>
                <p className="whitespace-pre-wrap rounded-lg border border-white/[0.06] bg-white/[0.02] p-3 text-xs leading-relaxed text-zinc-300">
                  {draft.description}
                </p>
              </div>
            )}
            {(draft.hashtags?.length ?? 0) > 0 && (
              <div className="sm:col-span-2">
                <p className="eyebrow mb-1.5">Hashtags</p>
                <div className="flex flex-wrap gap-1.5">
                  {draft.hashtags.map((t) => (
                    <span key={t} className="rounded border border-white/[0.07] bg-white/[0.02] px-1.5 py-0.5 font-mono text-[10px] text-zinc-400">
                      #{t}
                    </span>
                  ))}
                </div>
              </div>
            )}
          </div>
        </Panel>
      )}

      {/* QC findings */}
      {findings.length > 0 && (
        <Panel>
          <PanelHeader
            title="Quality control findings"
            hint={`Score ${draft?.qcScore ?? 0}/100`}
            action={<Gauge className="size-4 text-amber-300" />}
          />
          <ul className="divide-y divide-white/[0.05]">
            {findings.map((f, i) => {
              const o = asRecord(f);
              const sev = String(o.severity ?? "info");
              return (
                <li key={i} className="flex items-start gap-3 px-5 py-3">
                  <span
                    className={`mt-1 size-1.5 shrink-0 rounded-full ${
                      sev === "critical" || sev === "high" ? "bg-red-400" : sev === "warning" ? "bg-amber-400" : "bg-zinc-500"
                    }`}
                  />
                  <p className="flex-1 text-xs leading-relaxed text-zinc-400">
                    <span className="mr-1.5 font-mono text-[9px] uppercase tracking-[0.1em] text-zinc-600">
                      {String(o.area ?? "")}
                    </span>
                    {String(o.note ?? "")}
                  </p>
                  <span className="font-mono text-[9px] uppercase tracking-[0.14em] text-zinc-600">
                    {sev}
                  </span>
                </li>
              );
            })}
          </ul>
        </Panel>
      )}
    </div>
  );
}
