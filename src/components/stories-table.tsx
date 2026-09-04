"use client";

import { useMemo, useState, useTransition } from "react";
import { ArrowRight, Loader2, Search } from "lucide-react";
import { advanceStoryToContent } from "@/app/actions";
import { ScoreOrb, StatusBadge } from "@/components/ui";

export type StoryListRow = {
  id: string;
  title: string;
  summary: string;
  channelName: string;
  channelColor: string;
  score: number;
  status: string;
  tags: string[];
  sourceName: string;
  ageLabel: string;
  evaluation: {
    provider: string;
    recommendation: string;
    dims: { label: string; value: number }[];
  } | null;
};

const STATUS_FILTERS = ["all", "discovered", "selected", "rejected", "used"] as const;

function PromoteButton({ id }: { id: string }) {
  const [pending, start] = useTransition();
  return (
    <button
      title="Promote story into the content pipeline"
      onClick={() => start(async () => { await advanceStoryToContent(id); })}
      disabled={pending}
      className="inline-flex items-center gap-1.5 rounded-md border border-signal/30 bg-signal/10 px-2 py-1 font-mono text-[10px] uppercase tracking-[0.08em] text-signal transition hover:bg-signal/20 disabled:opacity-50"
    >
      {pending ? <Loader2 className="size-3 animate-spin" /> : <ArrowRight className="size-3" />}
      Select
    </button>
  );
}

export default function StoriesTable({ rows }: { rows: StoryListRow[] }) {
  const [query, setQuery] = useState("");
  const [status, setStatus] = useState<(typeof STATUS_FILTERS)[number]>("all");
  const [channel, setChannel] = useState("all");

  const channelNames = useMemo(
    () => Array.from(new Set(rows.map((r) => r.channelName))),
    [rows],
  );

  const filtered = rows.filter((r) => {
    if (status !== "all" && r.status !== status) return false;
    if (channel !== "all" && r.channelName !== channel) return false;
    if (query) {
      const q = query.toLowerCase();
      return (
        r.title.toLowerCase().includes(q) ||
        r.summary.toLowerCase().includes(q) ||
        r.tags.some((t) => t.toLowerCase().includes(q))
      );
    }
    return true;
  });

  return (
    <div>
      {/* toolbar */}
      <div className="mb-5 flex flex-wrap items-center gap-3">
        <div className="flex items-center gap-2 rounded-lg border border-white/[0.08] bg-white/[0.02] px-3 py-2">
          <Search className="size-3.5 text-zinc-600" />
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search stories, tags…"
            className="w-52 bg-transparent text-xs text-zinc-200 outline-none placeholder:text-zinc-600"
          />
        </div>
        <div className="flex flex-wrap gap-1.5">
          {STATUS_FILTERS.map((s) => (
            <button
              key={s}
              onClick={() => setStatus(s)}
              className={`rounded-md border px-2.5 py-1.5 font-mono text-[10px] uppercase tracking-[0.1em] transition ${
                status === s
                  ? "border-signal/50 bg-signal/10 text-signal"
                  : "border-white/[0.08] text-zinc-500 hover:text-zinc-300"
              }`}
            >
              {s}
            </button>
          ))}
        </div>
        <select
          value={channel}
          onChange={(e) => setChannel(e.target.value)}
          className="ml-auto rounded-lg border border-white/[0.08] bg-[#0b0d14] px-3 py-2 text-xs text-zinc-300 outline-none"
        >
          <option value="all">All channels</option>
          {channelNames.map((c) => (
            <option key={c} value={c}>
              {c}
            </option>
          ))}
        </select>
      </div>

      {/* header (desktop) */}
      <div className="mb-2 hidden grid-cols-[minmax(0,1fr)_130px_56px_110px_120px_80px] items-center gap-4 px-4 md:grid">
        {["Story", "Channel", "Score", "Status", "Source", ""].map((h, i) => (
          <p key={i} className="font-mono text-[9px] uppercase tracking-[0.24em] text-zinc-600">
            {h}
          </p>
        ))}
      </div>

      <div className="space-y-2">
        {filtered.map((r, i) => (
          <div
            key={r.id}
            className="panel card-hover grid grid-cols-1 items-center gap-3 px-4 py-3.5 animate-fade-up md:grid-cols-[minmax(0,1fr)_130px_56px_110px_120px_80px] md:gap-4"
            style={{ animationDelay: `${Math.min(i, 10) * 40}ms` }}
          >
            <div className="min-w-0">
              <h4 className="truncate font-display text-sm font-semibold text-zinc-100">
                {r.title}
              </h4>
              <p className="clamp-2 mt-1 text-xs leading-relaxed text-zinc-500">
                {r.summary}
              </p>
              {r.evaluation && (
                <div className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1">
                  <span
                    className={`rounded border px-1.5 py-0.5 font-mono text-[8.5px] uppercase tracking-[0.1em] ${
                      r.evaluation.recommendation === "greenlight"
                        ? "border-signal/40 bg-signal/10 text-signal"
                        : r.evaluation.recommendation === "reject"
                          ? "border-red-400/30 bg-red-400/10 text-red-300"
                          : "border-white/10 text-zinc-500"
                    }`}
                  >
                    {r.evaluation.recommendation} · {r.evaluation.provider}
                  </span>
                  {r.evaluation.dims.map((d) => (
                    <span
                      key={d.label}
                      title={`${d.label}: ${d.value}/100`}
                      className="flex items-center gap-1 font-mono text-[9px] text-zinc-600"
                    >
                      <span
                        className="inline-block h-1 rounded-full"
                        style={{
                          width: 18,
                          background: `linear-gradient(90deg, ${
                            d.value >= 70 ? "#c6f135" : d.value >= 50 ? "#fbbf24" : "#f87171"
                          } ${d.value}%, rgba(255,255,255,0.08) ${d.value}%)`,
                        }}
                      />
                      {d.label.slice(0, 4)} {d.value}
                    </span>
                  ))}
                </div>
              )}
              {r.tags.length > 0 && (
                <div className="mt-1.5 flex flex-wrap gap-1.5">
                  {r.tags.map((t) => (
                    <span
                      key={t}
                      className="rounded border border-white/[0.07] bg-white/[0.02] px-1.5 py-0.5 font-mono text-[9px] text-zinc-500"
                    >
                      #{t}
                    </span>
                  ))}
                </div>
              )}
            </div>
            <div className="flex items-center gap-2">
              <span className="size-1.5 rounded-full" style={{ background: r.channelColor }} />
              <span className="text-xs text-zinc-400">{r.channelName}</span>
            </div>
            <ScoreOrb score={r.score} size={34} />
            <div>
              <StatusBadge status={r.status} />
            </div>
            <div className="text-xs text-zinc-500">
              <p className="truncate">{r.sourceName}</p>
              <p className="font-mono text-[10px] text-zinc-600">{r.ageLabel}</p>
            </div>
            <div className="md:text-right">
              {r.status === "discovered" ? (
                <PromoteButton id={r.id} />
              ) : (
                <span className="font-mono text-[10px] text-zinc-700">—</span>
              )}
            </div>
          </div>
        ))}
        {filtered.length === 0 && (
          <div className="panel px-6 py-12 text-center text-sm text-zinc-500">
            No stories match the current filters.
          </div>
        )}
      </div>

      <p className="mt-4 font-mono text-[10px] uppercase tracking-[0.2em] text-zinc-600">
        {filtered.length} of {rows.length} stories shown
      </p>
    </div>
  );
}
