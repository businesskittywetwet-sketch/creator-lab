"use client";

import { useState, useTransition } from "react";
import {
  CalendarClock,
  Loader2,
  RotateCcw,
  Send,
  ShieldAlert,
  Trash2,
  Upload,
} from "lucide-react";
import {
  cancelPublishAction,
  preparePublishJobsAction,
  publishNowAction,
  refreshAccountsAction,
  retryPublishAction,
  schedulePublishAction,
  syncAnalyticsAction,
} from "@/app/actions";
import { CONNECTION_LABELS, type ConnectionState } from "@/lib/platform-meta";

export function ConnectionBadge({ state }: { state: ConnectionState }) {
  const tone: Record<ConnectionState, string> = {
    connected: "border-signal/40 bg-signal/10 text-signal",
    not_connected: "border-white/10 bg-white/[0.03] text-zinc-500",
    credentials_required: "border-amber-400/40 bg-amber-400/10 text-amber-300",
    publishing_unavailable: "border-sky-400/40 bg-sky-400/10 text-sky-300",
    expired: "border-red-400/40 bg-red-400/10 text-red-300",
  };
  return (
    <span
      className={`inline-flex items-center gap-1 rounded border px-1.5 py-0.5 font-mono text-[9px] uppercase tracking-[0.08em] ${tone[state]}`}
    >
      {CONNECTION_LABELS[state]}
    </span>
  );
}

function Err({ msg }: { msg: string | null }) {
  if (!msg) return null;
  return (
    <p className="mt-2 flex items-start gap-1.5 rounded-md border border-amber-400/25 bg-amber-400/[0.07] px-2 py-1.5 font-mono text-[10px] leading-relaxed text-amber-200/90">
      <ShieldAlert className="mt-0.5 size-3 shrink-0" />
      {msg}
    </p>
  );
}

export function PreparePublishButton({ contentId }: { contentId: string }) {
  const [pending, start] = useTransition();
  const [error, setError] = useState<string | null>(null);
  return (
    <div>
      <button
        onClick={() =>
          start(async () => {
            setError(null);
            const r = await preparePublishJobsAction(contentId);
            if (!r.ok) setError(r.error ?? "Failed");
          })
        }
        disabled={pending}
        className="inline-flex items-center gap-2 rounded-lg border border-signal/40 bg-signal/10 px-3.5 py-2 text-sm font-medium text-signal transition hover:bg-signal/20 disabled:opacity-60"
      >
        {pending ? <Loader2 className="size-3.5 animate-spin" /> : <Upload className="size-3.5" />}
        Prepare publish jobs
      </button>
      <Err msg={error} />
    </div>
  );
}

export function PublishJobActions({
  jobId,
  status,
  scheduledAt,
}: {
  jobId: string;
  status: string;
  scheduledAt: string | null;
}) {
  const [pending, start] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [showSchedule, setShowSchedule] = useState(false);
  const [when, setWhen] = useState(scheduledAt ?? "");
  const done = status === "published";
  const cancelled = status === "cancelled";

  const btn =
    "inline-flex items-center gap-1.5 rounded-md border px-2 py-1 font-mono text-[10px] uppercase tracking-[0.08em] transition disabled:opacity-50";

  return (
    <div className="min-w-0">
      <div className="flex flex-wrap items-center gap-1.5">
        {!done && !cancelled && (
          <button
            disabled={pending}
            onClick={() =>
              start(async () => {
                setError(null);
                const r = await publishNowAction(jobId);
                if (!r.ok) setError(r.error ?? "Publishing failed");
              })
            }
            className={`${btn} border-signal/30 bg-signal/10 text-signal hover:bg-signal/20`}
          >
            {pending ? <Loader2 className="size-3 animate-spin" /> : <Send className="size-3" />}
            Publish now
          </button>
        )}
        {status === "failed" && (
          <button
            disabled={pending}
            onClick={() =>
              start(async () => {
                setError(null);
                const r = await retryPublishAction(jobId);
                if (!r.ok) setError(r.error ?? "Retry failed");
              })
            }
            className={`${btn} border-red-400/40 bg-red-400/10 text-red-300 hover:bg-red-400/20`}
          >
            <RotateCcw className="size-3" /> Retry
          </button>
        )}
        {!done && !cancelled && (
          <button
            onClick={() => setShowSchedule((v) => !v)}
            className={`${btn} border-white/10 text-zinc-400 hover:text-zinc-200`}
          >
            <CalendarClock className="size-3" /> {scheduledAt ? "Reschedule" : "Schedule"}
          </button>
        )}
        {!done && !cancelled && (
          <button
            disabled={pending}
            onClick={() => start(async () => { await cancelPublishAction(jobId); })}
            className={`${btn} border-white/10 text-zinc-500 hover:border-red-400/40 hover:text-red-300`}
          >
            <Trash2 className="size-3" /> Cancel
          </button>
        )}
      </div>

      {showSchedule && (
        <div className="mt-2 flex flex-wrap items-center gap-2">
          <input
            type="datetime-local"
            value={when}
            onChange={(e) => setWhen(e.target.value)}
            className="field max-w-[220px]"
          />
          <button
            disabled={pending || !when}
            onClick={() =>
              start(async () => {
                setError(null);
                const fd = new FormData();
                fd.set("scheduledAt", when);
                const r = await schedulePublishAction(jobId, fd);
                if (!r.ok) setError(r.error ?? "Invalid schedule");
                else setShowSchedule(false);
              })
            }
            className={`${btn} border-signal/30 bg-signal/10 text-signal`}
          >
            Save time
          </button>
        </div>
      )}
      <Err msg={error} />
    </div>
  );
}

export function RefreshAccountsButton() {
  const [pending, start] = useTransition();
  return (
    <button
      onClick={() => start(async () => { await refreshAccountsAction(); })}
      disabled={pending}
      className="inline-flex items-center gap-2 rounded-lg border border-white/10 bg-white/[0.03] px-3.5 py-2 text-sm text-zinc-300 transition hover:border-white/25 hover:text-white disabled:opacity-60"
    >
      {pending ? <Loader2 className="size-3.5 animate-spin" /> : <RotateCcw className="size-3.5" />}
      Re-check credentials
    </button>
  );
}

export function SyncAnalyticsButton() {
  const [pending, start] = useTransition();
  const [error, setError] = useState<string | null>(null);
  return (
    <div>
      <button
        onClick={() =>
          start(async () => {
            setError(null);
            const r = await syncAnalyticsAction();
            if (!r.ok) setError(r.error ?? "Sync failed");
          })
        }
        disabled={pending}
        className="inline-flex items-center gap-2 rounded-lg border border-signal/40 bg-signal/10 px-3.5 py-2 text-sm font-medium text-signal transition hover:bg-signal/20 disabled:opacity-60"
      >
        {pending ? <Loader2 className="size-3.5 animate-spin" /> : <RotateCcw className="size-3.5" />}
        Sync platform metrics
      </button>
      <Err msg={error} />
    </div>
  );
}
