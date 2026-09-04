"use client";

import { useMemo, useState, useTransition } from "react";
import Link from "next/link";
import { ChevronLeft, ChevronRight, Loader2, Send, X } from "lucide-react";
import {
  cancelPublishAction,
  publishNowAction,
  schedulePublishAction,
} from "@/app/actions";
import { PlatformMark, StatusBadge } from "@/components/ui";

export type CalendarItem = {
  id: string;
  title: string;
  channelName: string;
  channelColor: string;
  platform: string;
  status: string;
  timezone: string;
  iso: string;
  localLabel: string;
  relative: string;
  blocked: boolean;
};

type View = "month" | "week" | "list";

const STATUS_TONE: Record<string, string> = {
  draft: "queued",
  ready: "queued",
  scheduled: "running",
  publishing: "running",
  published: "published",
  failed: "failed",
  cancelled: "idle",
};

/** Render an instant in a specific IANA timezone. */
function inZone(iso: string, tz: string) {
  try {
    return new Intl.DateTimeFormat("en-US", {
      timeZone: tz,
      month: "short",
      day: "numeric",
      hour: "2-digit",
      minute: "2-digit",
      hour12: false,
    }).format(new Date(iso));
  } catch {
    return new Date(iso).toISOString().slice(0, 16).replace("T", " ");
  }
}

function dayKey(d: Date) {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

export default function CalendarViews({ items }: { items: CalendarItem[] }) {
  const [view, setView] = useState<View>("month");
  const [cursor, setCursor] = useState(() => new Date());
  const [selected, setSelected] = useState<CalendarItem | null>(null);
  const [dragId, setDragId] = useState<string | null>(null);
  const [pending, start] = useTransition();
  const [error, setError] = useState<string | null>(null);

  const byDay = useMemo(() => {
    const m = new Map<string, CalendarItem[]>();
    for (const it of items) {
      const k = dayKey(new Date(it.iso));
      if (!m.has(k)) m.set(k, []);
      m.get(k)!.push(it);
    }
    return m;
  }, [items]);

  /** Reschedule to a dropped day, preserving the original time of day. */
  function reschedule(id: string, day: Date) {
    const item = items.find((i) => i.id === id);
    if (!item) return;
    const orig = new Date(item.iso);
    const next = new Date(day);
    next.setHours(orig.getHours(), orig.getMinutes(), 0, 0);
    start(async () => {
      setError(null);
      const fd = new FormData();
      // datetime-local style string (local time), parsed server-side
      const pad = (n: number) => String(n).padStart(2, "0");
      fd.set(
        "scheduledAt",
        `${next.getFullYear()}-${pad(next.getMonth() + 1)}-${pad(next.getDate())}T${pad(next.getHours())}:${pad(next.getMinutes())}`,
      );
      const r = await schedulePublishAction(id, fd);
      if (!r.ok) setError(r.error ?? "Could not reschedule");
    });
  }

  const monthStart = new Date(cursor.getFullYear(), cursor.getMonth(), 1);
  const gridStart = new Date(monthStart);
  gridStart.setDate(1 - monthStart.getDay());

  const weekStart = new Date(cursor);
  weekStart.setDate(cursor.getDate() - cursor.getDay());

  const shift = (n: number) => {
    const d = new Date(cursor);
    if (view === "month") d.setMonth(d.getMonth() + n);
    else d.setDate(d.getDate() + n * 7);
    setCursor(d);
  };

  const label =
    view === "month"
      ? cursor.toLocaleDateString("en-US", { month: "long", year: "numeric" })
      : view === "week"
        ? `Week of ${weekStart.toLocaleDateString("en-US", { month: "short", day: "numeric" })}`
        : "All scheduled";

  function Chip({ it }: { it: CalendarItem }) {
    return (
      <button
        draggable={it.status !== "published"}
        onDragStart={() => setDragId(it.id)}
        onDragEnd={() => setDragId(null)}
        onClick={() => setSelected(it)}
        className={`group flex w-full items-center gap-1 rounded border px-1 py-0.5 text-left transition ${
          it.blocked
            ? "border-amber-400/30 bg-amber-400/[0.08]"
            : "border-white/[0.08] bg-white/[0.03] hover:border-signal/40"
        } ${dragId === it.id ? "opacity-40" : ""}`}
        title={`${it.title} · ${inZone(it.iso, it.timezone)} ${it.timezone}`}
      >
        <span className="size-1.5 shrink-0 rounded-full" style={{ background: it.channelColor }} />
        <span className="truncate font-mono text-[9px] text-zinc-300">{it.title}</span>
      </button>
    );
  }

  return (
    <div className="space-y-4">
      {/* toolbar */}
      <div className="flex flex-wrap items-center gap-3">
        <div className="flex gap-1">
          {(["month", "week", "list"] as View[]).map((v) => (
            <button
              key={v}
              onClick={() => setView(v)}
              className={`rounded-md border px-2.5 py-1.5 font-mono text-[10px] uppercase tracking-[0.1em] transition ${
                view === v
                  ? "border-signal/50 bg-signal/10 text-signal"
                  : "border-white/[0.08] text-zinc-500 hover:text-zinc-300"
              }`}
            >
              {v}
            </button>
          ))}
        </div>
        {view !== "list" && (
          <div className="flex items-center gap-2">
            <button
              onClick={() => shift(-1)}
              className="grid size-7 place-items-center rounded-md border border-white/[0.08] text-zinc-400 hover:text-white"
            >
              <ChevronLeft className="size-3.5" />
            </button>
            <span className="font-display text-sm font-semibold text-zinc-200">{label}</span>
            <button
              onClick={() => shift(1)}
              className="grid size-7 place-items-center rounded-md border border-white/[0.08] text-zinc-400 hover:text-white"
            >
              <ChevronRight className="size-3.5" />
            </button>
          </div>
        )}
        {pending && (
          <span className="inline-flex items-center gap-1.5 font-mono text-[10px] text-zinc-400">
            <Loader2 className="size-3 animate-spin" /> saving…
          </span>
        )}
        {error && <span className="font-mono text-[10px] text-amber-300">{error}</span>}
        <span className="ml-auto font-mono text-[9px] uppercase tracking-[0.14em] text-zinc-600">
          drag an item to another day to reschedule
        </span>
      </div>

      {/* month */}
      {view === "month" && (
        <div className="panel overflow-hidden">
          <div className="grid grid-cols-7 border-b border-white/[0.06]">
            {["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"].map((d) => (
              <div key={d} className="px-2 py-2 text-center font-mono text-[9px] uppercase tracking-[0.16em] text-zinc-600">
                {d}
              </div>
            ))}
          </div>
          <div className="grid grid-cols-7 gap-px bg-white/[0.04]">
            {Array.from({ length: 42 }, (_, i) => {
              const day = new Date(gridStart);
              day.setDate(gridStart.getDate() + i);
              const inMonth = day.getMonth() === cursor.getMonth();
              const key = dayKey(day);
              const dayItems = byDay.get(key) ?? [];
              const isToday = key === dayKey(new Date());
              return (
                <div
                  key={i}
                  onDragOver={(e) => e.preventDefault()}
                  onDrop={() => dragId && reschedule(dragId, day)}
                  className={`min-h-[86px] bg-[#0a0c12] p-1.5 ${inMonth ? "" : "opacity-35"}`}
                >
                  <p
                    className={`mb-1 font-mono text-[10px] ${
                      isToday ? "font-bold text-signal" : "text-zinc-600"
                    }`}
                  >
                    {day.getDate()}
                  </p>
                  <div className="space-y-1">
                    {dayItems.slice(0, 3).map((it) => (
                      <Chip key={it.id} it={it} />
                    ))}
                    {dayItems.length > 3 && (
                      <p className="font-mono text-[9px] text-zinc-600">+{dayItems.length - 3} more</p>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* week */}
      {view === "week" && (
        <div className="panel overflow-hidden">
          <div className="grid grid-cols-7 gap-px bg-white/[0.04]">
            {Array.from({ length: 7 }, (_, i) => {
              const day = new Date(weekStart);
              day.setDate(weekStart.getDate() + i);
              const key = dayKey(day);
              const dayItems = byDay.get(key) ?? [];
              return (
                <div
                  key={i}
                  onDragOver={(e) => e.preventDefault()}
                  onDrop={() => dragId && reschedule(dragId, day)}
                  className="min-h-[220px] bg-[#0a0c12] p-2"
                >
                  <p className="mb-2 font-mono text-[10px] uppercase tracking-[0.12em] text-zinc-500">
                    {day.toLocaleDateString("en-US", { weekday: "short", day: "numeric" })}
                  </p>
                  <div className="space-y-1.5">
                    {dayItems.map((it) => (
                      <Chip key={it.id} it={it} />
                    ))}
                    {dayItems.length === 0 && (
                      <p className="font-mono text-[9px] text-zinc-700">—</p>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* list */}
      {view === "list" && (
        <div className="panel divide-y divide-white/[0.05]">
          {items.map((it) => (
            <div key={it.id} className="flex flex-wrap items-center gap-3 px-5 py-3">
              <PlatformMark platform={it.platform} />
              <span className="size-1.5 rounded-full" style={{ background: it.channelColor }} />
              <div className="min-w-0 flex-1">
                <p className="truncate text-sm text-zinc-200">{it.title}</p>
                <p className="font-mono text-[10px] text-zinc-600">
                  {inZone(it.iso, it.timezone)} · {it.timezone} · {it.relative}
                </p>
              </div>
              <StatusBadge status={STATUS_TONE[it.status] ?? "queued"} label={it.status} />
              <button
                onClick={() => setSelected(it)}
                className="font-mono text-[10px] uppercase tracking-[0.1em] text-zinc-500 hover:text-signal"
              >
                open
              </button>
            </div>
          ))}
        </div>
      )}

      {/* detail drawer */}
      {selected && (
        <div className="fixed inset-0 z-[80] grid place-items-center p-4">
          <button
            aria-label="Close"
            onClick={() => setSelected(null)}
            className="absolute inset-0 bg-black/70 backdrop-blur-sm"
          />
          <div className="panel relative w-full max-w-md rounded-2xl bg-[#0a0c12] p-5 shadow-2xl animate-fade-up">
            <div className="flex items-start justify-between">
              <div className="min-w-0">
                <p className="eyebrow mb-1">{selected.channelName}</p>
                <h3 className="font-display text-base font-bold text-white">{selected.title}</h3>
              </div>
              <button
                onClick={() => setSelected(null)}
                className="grid size-7 place-items-center rounded-lg border border-white/[0.08] text-zinc-500 hover:text-white"
              >
                <X className="size-3.5" />
              </button>
            </div>
            <div className="mt-3 flex flex-wrap items-center gap-2">
              <PlatformMark platform={selected.platform} />
              <StatusBadge status={STATUS_TONE[selected.status] ?? "queued"} label={selected.status} />
              <span className="font-mono text-[10px] text-zinc-500">
                {inZone(selected.iso, selected.timezone)} {selected.timezone}
              </span>
            </div>
            {selected.blocked && (
              <p className="mt-3 rounded-md border border-amber-400/25 bg-amber-400/[0.07] px-2.5 py-2 font-mono text-[10px] text-amber-200/90">
                Preflight is blocking this post — see the publishing queue for details.
              </p>
            )}
            <div className="mt-4 flex flex-wrap gap-2">
              {selected.status !== "published" && (
                <button
                  disabled={pending}
                  onClick={() =>
                    start(async () => {
                      setError(null);
                      const r = await publishNowAction(selected.id);
                      if (!r.ok) setError(r.error ?? "Publishing blocked");
                      else setSelected(null);
                    })
                  }
                  className="inline-flex items-center gap-1.5 rounded-md border border-signal/30 bg-signal/10 px-2.5 py-1.5 font-mono text-[10px] uppercase tracking-[0.08em] text-signal"
                >
                  <Send className="size-3" /> Publish now
                </button>
              )}
              {selected.status !== "published" && (
                <button
                  disabled={pending}
                  onClick={() =>
                    start(async () => {
                      await cancelPublishAction(selected.id);
                      setSelected(null);
                    })
                  }
                  className="rounded-md border border-white/10 px-2.5 py-1.5 font-mono text-[10px] uppercase tracking-[0.08em] text-zinc-400 hover:border-red-400/40 hover:text-red-300"
                >
                  Cancel
                </button>
              )}
              <Link
                href="/publishing"
                className="rounded-md border border-white/10 px-2.5 py-1.5 font-mono text-[10px] uppercase tracking-[0.08em] text-zinc-400 hover:text-white"
              >
                Open queue
              </Link>
            </div>
            {error && <p className="mt-3 font-mono text-[10px] text-amber-300">{error}</p>}
          </div>
        </div>
      )}
    </div>
  );
}
