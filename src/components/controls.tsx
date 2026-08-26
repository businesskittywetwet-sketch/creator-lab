"use client";

import { useTransition } from "react";
import { useFormStatus } from "react-dom";
import { Loader2, Pause, Play, RotateCcw, Trash2 } from "lucide-react";
import {
  deleteChannel,
  reseedDatabase,
  runDiscoveryNow,
  setAgentStatus,
} from "@/app/actions";

export function RunSweepButton({ compact = false }: { compact?: boolean }) {
  const [pending, start] = useTransition();
  return (
    <button
      onClick={() => start(async () => { await runDiscoveryNow(); })}
      disabled={pending}
      className={`inline-flex items-center gap-2 rounded-lg border border-signal/40 bg-signal/10 font-medium text-signal transition hover:bg-signal/20 disabled:opacity-60 ${
        compact ? "px-2.5 py-1.5 text-xs" : "px-3.5 py-2 text-sm"
      }`}
    >
      {pending ? (
        <Loader2 className="size-3.5 animate-spin" />
      ) : (
        <Play className="size-3.5" />
      )}
      {pending ? "Sweep running…" : "Run story sweep"}
    </button>
  );
}

export function ReseedButton() {
  const [pending, start] = useTransition();
  return (
    <button
      onClick={() => {
        if (window.confirm("Replace all data with a fresh demo dataset?")) {
          start(async () => { await reseedDatabase(); });
        }
      }}
      disabled={pending}
      className="inline-flex items-center gap-2 rounded-lg border border-amber-400/30 bg-amber-400/10 px-3.5 py-2 text-sm font-medium text-amber-300 transition hover:bg-amber-400/20 disabled:opacity-60"
    >
      {pending ? (
        <Loader2 className="size-3.5 animate-spin" />
      ) : (
        <RotateCcw className="size-3.5" />
      )}
      {pending ? "Reseeding…" : "Reset demo data"}
    </button>
  );
}

export function AgentToggle({ id, status }: { id: string; status: string }) {
  const [pending, start] = useTransition();
  const isPaused = status === "paused";
  const isError = status === "error";
  return (
    <button
      onClick={() =>
        start(async () => {
          await setAgentStatus(id, isPaused || isError ? "idle" : "paused");
        })
      }
      disabled={pending}
      className={`inline-flex items-center gap-1.5 rounded-md border px-2 py-1 font-mono text-[10px] uppercase tracking-[0.08em] transition disabled:opacity-60 ${
        isPaused || isError
          ? "border-signal/30 bg-signal/10 text-signal hover:bg-signal/20"
          : "border-white/10 bg-white/[0.03] text-zinc-400 hover:text-zinc-200"
      }`}
    >
      {pending ? (
        <Loader2 className="size-3 animate-spin" />
      ) : isPaused || isError ? (
        <Play className="size-3" />
      ) : (
        <Pause className="size-3" />
      )}
      {isPaused ? "Resume" : isError ? "Reset" : "Pause"}
    </button>
  );
}

export function ChannelDelete({ id }: { id: string }) {
  const [pending, start] = useTransition();
  return (
    <button
      title="Delete channel"
      onClick={() => {
        if (window.confirm("Delete this channel and all of its content?")) {
          start(async () => { await deleteChannel(id); });
        }
      }}
      disabled={pending}
      className="grid size-8 place-items-center rounded-lg border border-white/[0.08] text-zinc-500 transition hover:border-red-400/40 hover:text-red-300 disabled:opacity-60"
    >
      {pending ? <Loader2 className="size-3.5 animate-spin" /> : <Trash2 className="size-3.5" />}
    </button>
  );
}

export function SubmitButton({ label }: { label: string }) {
  const { pending } = useFormStatus();
  return (
    <button
      type="submit"
      disabled={pending}
      className="inline-flex items-center gap-2 rounded-lg bg-signal px-4 py-2 text-sm font-semibold text-black transition hover:brightness-110 disabled:opacity-60"
    >
      {pending && <Loader2 className="size-3.5 animate-spin" />}
      {pending ? "Saving…" : label}
    </button>
  );
}
