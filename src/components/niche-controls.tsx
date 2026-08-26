"use client";

import { useActionState, useState, useTransition } from "react";
import { Archive, Copy, Loader2, Pause, Play, Plus, Radar, Trash2 } from "lucide-react";
import {
  addSourceAction,
  deleteNicheAction,
  duplicateNicheAction,
  enqueueNicheScoutAction,
  removeSourceAction,
  setNicheStatusAction,
  type ActionState,
} from "@/app/actions";

export function NicheActions({ id, status }: { id: string; status: string }) {
  const [pending, start] = useTransition();
  const [msg, setMsg] = useState<string | null>(null);
  const btn =
    "inline-flex items-center gap-1.5 rounded-md border px-2 py-1 font-mono text-[10px] uppercase tracking-[0.08em] transition disabled:opacity-40";

  const run = (fn: () => Promise<ActionState>) => () =>
    start(async () => {
      setMsg(null);
      const r = await fn();
      if (r.error) setMsg(r.error);
    });

  return (
    <div className="min-w-0">
      <div className="flex flex-wrap items-center gap-1.5">
        <button disabled={pending} onClick={run(() => enqueueNicheScoutAction(id))}
          className={`${btn} border-signal/30 bg-signal/10 text-signal hover:bg-signal/20`}>
          {pending ? <Loader2 className="size-3 animate-spin" /> : <Radar className="size-3" />}
          Scout now
        </button>
        {status === "active" ? (
          <button disabled={pending} onClick={run(() => setNicheStatusAction(id, "paused"))}
            className={`${btn} border-white/10 text-zinc-400 hover:text-amber-300`}>
            <Pause className="size-3" /> Pause
          </button>
        ) : status === "paused" ? (
          <button disabled={pending} onClick={run(() => setNicheStatusAction(id, "active"))}
            className={`${btn} border-signal/30 bg-signal/10 text-signal`}>
            <Play className="size-3" /> Activate
          </button>
        ) : null}
        <button disabled={pending} onClick={run(() => duplicateNicheAction(id))}
          className={`${btn} border-white/10 text-zinc-400 hover:text-white`}>
          <Copy className="size-3" /> Duplicate
        </button>
        {status !== "archived" && (
          <button disabled={pending} onClick={run(() => setNicheStatusAction(id, "archived"))}
            className={`${btn} border-white/10 text-zinc-500 hover:text-amber-300`}>
            <Archive className="size-3" /> Archive
          </button>
        )}
        <button
          disabled={pending}
          onClick={() => {
            if (window.confirm("Delete this niche? It will be archived instead if content depends on it."))
              run(() => deleteNicheAction(id))();
          }}
          className={`${btn} border-white/10 text-zinc-600 hover:border-red-400/40 hover:text-red-300`}
        >
          <Trash2 className="size-3" /> Delete
        </button>
      </div>
      {msg && <p className="mt-1.5 font-mono text-[10px] text-amber-300">{msg}</p>}
    </div>
  );
}

const TYPES = [
  { key: "rss", hint: "https://example.com/feed.xml" },
  { key: "googlenews", hint: "search query" },
  { key: "reddit", hint: "subreddit" },
  { key: "hackernews", hint: "search query" },
  { key: "newsapi", hint: "search query" },
];

export function SourceManager({
  nicheId,
  sources,
}: {
  nicheId: string;
  sources: {
    id: string;
    type: string;
    name: string;
    enabled: boolean;
    lastStatus: string;
    consecutiveFailures: number;
    lastError: string | null;
  }[];
}) {
  const [open, setOpen] = useState(false);
  const [type, setType] = useState("rss");
  const [pending, start] = useTransition();
  const [state, formAction] = useActionState<ActionState, FormData>(addSourceAction, { ok: false });

  const [seen, setSeen] = useState(state);
  if (seen !== state) {
    setSeen(state);
    if (state.ok) setOpen(false);
  }

  return (
    <div>
      <div className="flex flex-wrap gap-1.5">
        {sources.map((s) => (
          <span key={s.id}
            title={s.lastError ?? `${s.type} · ${s.lastStatus}`}
            className={`inline-flex items-center gap-1.5 rounded border px-1.5 py-0.5 font-mono text-[9px] ${
              s.lastStatus === "error"
                ? "border-red-400/30 bg-red-400/10 text-red-300"
                : s.lastStatus === "ok"
                  ? "border-signal/30 bg-signal/10 text-signal"
                  : "border-white/10 bg-white/[0.03] text-zinc-500"
            }`}>
            {s.type}
            {s.consecutiveFailures > 0 && <span className="text-red-300">×{s.consecutiveFailures}</span>}
            <button
              onClick={() => start(async () => { await removeSourceAction(s.id); })}
              className="text-zinc-600 hover:text-red-300"
            >
              ×
            </button>
          </span>
        ))}
        <button onClick={() => setOpen((v) => !v)}
          className="inline-flex items-center gap-1 rounded border border-white/10 px-1.5 py-0.5 font-mono text-[9px] text-zinc-400 hover:border-signal/40 hover:text-signal">
          <Plus className="size-2.5" /> source
        </button>
      </div>

      {open && (
        <form action={formAction} className="mt-2 flex flex-wrap items-center gap-1.5">
          <input type="hidden" name="nicheId" value={nicheId} />
          <select name="type" value={type} onChange={(e) => setType(e.target.value)}
            className="field max-w-[130px] py-1 text-xs">
            {TYPES.map((t) => <option key={t.key} value={t.key}>{t.key}</option>)}
          </select>
          <input name="config" required placeholder={TYPES.find((t) => t.key === type)?.hint}
            className="field min-w-[180px] flex-1 py-1 text-xs" />
          <input type="hidden" name="name" value="" />
          <button type="submit" disabled={pending}
            className="rounded-md border border-signal/40 bg-signal/10 px-2 py-1 font-mono text-[10px] uppercase text-signal">
            Add
          </button>
          {state.error && <span className="font-mono text-[10px] text-amber-300">{state.error}</span>}
        </form>
      )}
    </div>
  );
}
