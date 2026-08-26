"use client";

import { useState, useTransition } from "react";
import {
  AlertTriangle,
  CheckCircle2,
  Loader2,
  Play,
  RefreshCcw,
  RotateCcw,
  ShieldAlert,
  XCircle,
  Zap,
} from "lucide-react";
import {
  advanceProductionQueueAction,
  approveDraftAction,
  rejectDraftAction,
  requestChangesAction,
  retryProductionJobAction,
  runProductionJobAction,
} from "@/app/actions";
import { PRODUCTION_STEPS } from "@/lib/production-steps";

export function RunQueueButton() {
  const [pending, start] = useTransition();
  return (
    <button
      onClick={() => start(async () => { await advanceProductionQueueAction(); })}
      disabled={pending}
      className="inline-flex items-center gap-2 rounded-lg border border-signal/40 bg-signal/10 px-3.5 py-2 text-sm font-medium text-signal transition hover:bg-signal/20 disabled:opacity-60"
    >
      {pending ? <Loader2 className="size-3.5 animate-spin" /> : <Zap className="size-3.5" />}
      {pending ? "Producing…" : "Run production queue"}
    </button>
  );
}

export function RunJobButton({
  jobId,
  status,
  compact = false,
}: {
  jobId: string;
  status: string;
  compact?: boolean;
}) {
  const [pending, start] = useTransition();
  const failed = status === "failed";
  const done = status === "completed";
  const action = failed ? retryProductionJobAction : runProductionJobAction;
  const label = failed ? "Retry" : status === "awaiting_review" ? "Re-run" : "Run";
  if (done) return null;
  return (
    <button
      onClick={() => start(async () => { await action(jobId); })}
      disabled={pending}
      className={`inline-flex items-center gap-1.5 rounded-md border font-mono uppercase tracking-[0.08em] transition disabled:opacity-50 ${
        failed
          ? "border-red-400/40 bg-red-400/10 text-red-300 hover:bg-red-400/20"
          : "border-signal/30 bg-signal/10 text-signal hover:bg-signal/20"
      } ${compact ? "px-2 py-1 text-[10px]" : "px-2.5 py-1.5 text-[10px]"}`}
    >
      {pending ? (
        <Loader2 className="size-3 animate-spin" />
      ) : failed ? (
        <RotateCcw className="size-3" />
      ) : (
        <Play className="size-3" />
      )}
      {pending ? "Working…" : label}
    </button>
  );
}

const REVISION_TARGETS = [
  { value: "auto", label: "Auto-detect from note" },
  ...PRODUCTION_STEPS.filter((s) => s.key !== "review").map((s) => ({
    value: s.key,
    label: `Rewind to ${s.label}`,
  })),
];

export function ReviewControls({
  jobId,
  qcBlocks,
  criticalCount,
}: {
  jobId: string;
  qcBlocks: boolean;
  criticalCount: number;
}) {
  const [pending, start] = useTransition();
  const [notes, setNotes] = useState("");
  const [target, setTarget] = useState("auto");
  const [mode, setMode] = useState<"idle" | "changes" | "reject">("idle");
  const [error, setError] = useState<string | null>(null);
  const [override, setOverride] = useState(false);

  return (
    <div className="space-y-3">
      {qcBlocks && (
        <div className="flex items-start gap-2 rounded-lg border border-red-400/30 bg-red-400/[0.07] px-3 py-2.5">
          <ShieldAlert className="mt-0.5 size-4 shrink-0 text-red-300" />
          <div className="text-xs leading-relaxed text-red-200/90">
            QC reported <strong>{criticalCount} critical finding(s)</strong>. Approval is blocked
            until they are resolved.
            <label className="mt-2 flex cursor-pointer items-center gap-2 text-[11px] text-red-200/80">
              <input
                type="checkbox"
                checked={override}
                onChange={(e) => setOverride(e.target.checked)}
                className="size-3.5 accent-red-400"
              />
              Override and approve anyway (records the override)
            </label>
          </div>
        </div>
      )}

      {mode !== "idle" && (
        <div className="space-y-2">
          <textarea
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
            rows={3}
            placeholder={
              mode === "changes"
                ? 'e.g. "The hook is weak" or "The visuals don\'t match the script"'
                : "Why is this draft being rejected?"
            }
            className="field resize-none"
          />
          {mode === "changes" && (
            <select value={target} onChange={(e) => setTarget(e.target.value)} className="field">
              {REVISION_TARGETS.map((t) => (
                <option key={t.value} value={t.value}>{t.label}</option>
              ))}
            </select>
          )}
        </div>
      )}

      {error && (
        <p className="rounded-lg border border-red-400/30 bg-red-400/10 px-3 py-2 text-xs text-red-300">
          {error}
        </p>
      )}

      <div className="flex flex-wrap items-center gap-2">
        <button
          disabled={pending || (qcBlocks && !override)}
          onClick={() =>
            start(async () => {
              setError(null);
              const fd = new FormData();
              fd.set("notes", notes);
              if (override) fd.set("override", "true");
              const res = await approveDraftAction(jobId, fd);
              if (!res.ok) setError(res.error ?? "Approval failed");
            })
          }
          className="inline-flex items-center gap-2 rounded-lg bg-signal px-4 py-2 text-sm font-semibold text-black transition hover:brightness-110 disabled:opacity-40"
        >
          {pending ? <Loader2 className="size-3.5 animate-spin" /> : <CheckCircle2 className="size-3.5" />}
          Approve
        </button>

        {mode === "changes" ? (
          <button
            disabled={pending || !notes.trim()}
            onClick={() =>
              start(async () => {
                const fd = new FormData();
                fd.set("notes", notes);
                fd.set("targetStep", target);
                await requestChangesAction(jobId, fd);
                setMode("idle");
                setNotes("");
              })
            }
            className="inline-flex items-center gap-2 rounded-lg border border-amber-400/40 bg-amber-400/10 px-4 py-2 text-sm font-medium text-amber-300 transition hover:bg-amber-400/20 disabled:opacity-50"
          >
            {pending ? <Loader2 className="size-3.5 animate-spin" /> : <RefreshCcw className="size-3.5" />}
            Send revision
          </button>
        ) : (
          <button
            onClick={() => setMode("changes")}
            className="inline-flex items-center gap-2 rounded-lg border border-white/10 px-4 py-2 text-sm text-zinc-300 transition hover:border-amber-400/40 hover:text-amber-300"
          >
            <RefreshCcw className="size-3.5" />
            Request revision
          </button>
        )}

        {mode === "reject" ? (
          <button
            disabled={pending || !notes.trim()}
            onClick={() =>
              start(async () => {
                const fd = new FormData();
                fd.set("notes", notes);
                await rejectDraftAction(jobId, fd);
                setMode("idle");
                setNotes("");
              })
            }
            className="inline-flex items-center gap-2 rounded-lg border border-red-400/40 bg-red-400/10 px-4 py-2 text-sm font-medium text-red-300 transition hover:bg-red-400/20 disabled:opacity-50"
          >
            {pending ? <Loader2 className="size-3.5 animate-spin" /> : <XCircle className="size-3.5" />}
            Confirm reject
          </button>
        ) : (
          <button
            onClick={() => setMode("reject")}
            className="inline-flex items-center gap-2 rounded-lg border border-white/10 px-4 py-2 text-sm text-zinc-400 transition hover:border-red-400/40 hover:text-red-300"
          >
            <XCircle className="size-3.5" />
            Reject
          </button>
        )}

        {mode !== "idle" && (
          <button
            onClick={() => { setMode("idle"); setNotes(""); }}
            className="text-xs text-zinc-500 underline-offset-2 hover:text-zinc-300 hover:underline"
          >
            cancel
          </button>
        )}
      </div>
    </div>
  );
}

/** Explicit provenance chip — fallback must never look like real AI. */
export function ModeBadge({ mode, className = "" }: { mode: string; className?: string }) {
  const map: Record<string, { label: string; cls: string; icon?: typeof AlertTriangle }> = {
    real_ai: { label: "AI generated", cls: "border-signal/40 bg-signal/10 text-signal" },
    mixed: { label: "Mixed AI + fallback", cls: "border-amber-400/40 bg-amber-400/10 text-amber-300", icon: AlertTriangle },
    fallback: { label: "Deterministic fallback", cls: "border-amber-400/40 bg-amber-400/10 text-amber-300", icon: AlertTriangle },
    unavailable: { label: "Unavailable", cls: "border-zinc-500/40 bg-zinc-500/10 text-zinc-400" },
    failed: { label: "Failed", cls: "border-red-400/40 bg-red-400/10 text-red-300", icon: XCircle },
    human: { label: "Human", cls: "border-sky-400/40 bg-sky-400/10 text-sky-300" },
    pending: { label: "Pending", cls: "border-white/10 bg-white/[0.03] text-zinc-500" },
  };
  const m = map[mode] ?? map.pending;
  const Icon = m.icon;
  return (
    <span
      className={`inline-flex items-center gap-1 rounded border px-1.5 py-0.5 font-mono text-[9px] uppercase tracking-[0.08em] ${m.cls} ${className}`}
    >
      {Icon && <Icon className="size-2.5" />}
      {m.label}
    </span>
  );
}
