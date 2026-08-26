"use client";

import { useState, useTransition } from "react";
import {
  ChevronUp,
  Loader2,
  Pause,
  Play,
  RotateCcw,
  X,
  Zap,
} from "lucide-react";
import {
  cancelJobAction,
  pauseJobAction,
  resumeJobAction,
  retryJobAction,
  runWorkerAction,
  setJobPriorityAction,
} from "@/app/actions";

export function RunWorkerButton() {
  const [pending, start] = useTransition();
  const [msg, setMsg] = useState<string | null>(null);
  return (
    <div>
      <button
        onClick={() =>
          start(async () => {
            setMsg(null);
            const r = await runWorkerAction();
            setMsg(r.ok ? (r.error ?? "Worker tick complete.") : (r.error ?? "Failed"));
          })
        }
        disabled={pending}
        className="inline-flex items-center gap-2 rounded-lg border border-signal/40 bg-signal/10 px-3.5 py-2 text-sm font-medium text-signal transition hover:bg-signal/20 disabled:opacity-60"
      >
        {pending ? <Loader2 className="size-3.5 animate-spin" /> : <Zap className="size-3.5" />}
        {pending ? "Draining queue…" : "Run worker tick"}
      </button>
      {msg && <p className="mt-2 font-mono text-[10px] text-zinc-400">{msg}</p>}
    </div>
  );
}

export function JobActions({ id, status }: { id: string; status: string }) {
  const [pending, start] = useTransition();
  const [err, setErr] = useState<string | null>(null);
  const btn =
    "inline-flex items-center gap-1 rounded-md border px-1.5 py-1 font-mono text-[9px] uppercase tracking-[0.08em] transition disabled:opacity-40";

  const act = (fn: (id: string) => Promise<{ ok: boolean; error?: string }>) => () =>
    start(async () => {
      setErr(null);
      const r = await fn(id);
      if (!r.ok) setErr(r.error ?? "Failed");
    });

  const canPause = ["queued", "retrying", "running"].includes(status);
  const canResume = status === "paused";
  const canCancel = !["completed", "cancelled"].includes(status);
  const canRetry = ["failed", "cancelled"].includes(status);

  return (
    <div className="min-w-0">
      <div className="flex flex-wrap items-center gap-1">
        {canRetry && (
          <button disabled={pending} onClick={act(retryJobAction)}
            className={`${btn} border-signal/30 bg-signal/10 text-signal hover:bg-signal/20`}>
            {pending ? <Loader2 className="size-2.5 animate-spin" /> : <RotateCcw className="size-2.5" />}
            Retry
          </button>
        )}
        {canResume && (
          <button disabled={pending} onClick={act(resumeJobAction)}
            className={`${btn} border-signal/30 bg-signal/10 text-signal hover:bg-signal/20`}>
            <Play className="size-2.5" /> Resume
          </button>
        )}
        {canPause && !canResume && (
          <button disabled={pending} onClick={act(pauseJobAction)}
            className={`${btn} border-white/10 text-zinc-400 hover:text-amber-300`}>
            <Pause className="size-2.5" /> Pause
          </button>
        )}
        {canCancel && (
          <button disabled={pending} onClick={act(cancelJobAction)}
            className={`${btn} border-white/10 text-zinc-500 hover:border-red-400/40 hover:text-red-300`}>
            <X className="size-2.5" /> Cancel
          </button>
        )}
        {!["completed", "cancelled"].includes(status) && (
          <button
            disabled={pending}
            onClick={() => start(async () => { await setJobPriorityAction(id, 100); })}
            title="Boost to manual priority"
            className={`${btn} border-white/10 text-zinc-500 hover:text-white`}
          >
            <ChevronUp className="size-2.5" /> Boost
          </button>
        )}
      </div>
      {err && <p className="mt-1 font-mono text-[9px] text-amber-300">{err}</p>}
    </div>
  );
}
