"use client";

import Link from "next/link";
import { useState } from "react";

/* Full Creator Lab pipeline. Each stage links to the surface that
   actually filters the relevant items. */

export type PipelineCounts = {
  discovered: number;
  greenlit: number;
  research: number;
  script: number;
  visuals: number;
  video: number;
  qc: number;
  review: number;
  approved: number;
  scheduled: number;
  published: number;
};

const STAGES: {
  key: keyof PipelineCounts;
  label: string;
  href: string;
  hex: string;
  hint: string;
}[] = [
  { key: "discovered", label: "Discovered", href: "/stories?status=discovered", hex: "#8b93a7", hint: "Scout intake awaiting judgement" },
  { key: "greenlit", label: "Greenlit", href: "/stories?status=selected", hex: "#7dd3fc", hint: "Judge-approved, entering production" },
  { key: "research", label: "Research", href: "/production", hex: "#22d3ee", hint: "Sourcing facts and claims" },
  { key: "script", label: "Script", href: "/production", hex: "#2dd4bf", hint: "Concept and narration drafting" },
  { key: "visuals", label: "Visuals", href: "/production", hex: "#a78bfa", hint: "Shot planning and asset generation" },
  { key: "video", label: "Video", href: "/production", hex: "#fb923c", hint: "Rendered playable drafts" },
  { key: "qc", label: "QC", href: "/production", hex: "#fbbf24", hint: "Quality control evaluation" },
  { key: "review", label: "Review", href: "/production", hex: "#f0abfc", hint: "Human sign-off gate" },
  { key: "approved", label: "Approved", href: "/publishing", hex: "#34d399", hint: "Cleared for distribution" },
  { key: "scheduled", label: "Scheduled", href: "/calendar", hex: "#60a5fa", hint: "Queued for a publish window" },
  { key: "published", label: "Published", href: "/publishing", hex: "#c6f135", hint: "Confirmed live on a platform" },
];

export default function CreatorPipeline({ counts }: { counts: PipelineCounts }) {
  const [hover, setHover] = useState<string | null>(null);
  const max = Math.max(...STAGES.map((s) => counts[s.key] ?? 0), 1);
  const active = STAGES.find((s) => s.key === hover);

  return (
    <div className="panel overflow-hidden">
      <div className="flex items-center justify-between gap-3 border-b border-white/[0.06] px-5 py-4">
        <div>
          <h3 className="font-display text-sm font-semibold tracking-wide text-zinc-100">
            Creator pipeline
          </h3>
          <p className="mt-0.5 text-xs text-zinc-500">
            {active ? active.hint : "Discovery through publication — click any stage to filter"}
          </p>
        </div>
        <span className="hidden rounded-md border border-white/10 bg-white/[0.03] px-2 py-1 font-mono text-[10px] text-zinc-400 sm:inline">
          {STAGES.reduce((a, s) => a + (counts[s.key] ?? 0), 0)} tracked
        </span>
      </div>

      <div className="grid grid-cols-3 gap-px bg-white/[0.04] sm:grid-cols-4 lg:grid-cols-6 xl:grid-cols-11">
        {STAGES.map((s) => {
          const n = counts[s.key] ?? 0;
          return (
            <Link
              key={s.key}
              href={s.href}
              onMouseEnter={() => setHover(s.key)}
              onMouseLeave={() => setHover(null)}
              className="group relative bg-[#0a0c12] px-3 py-4 transition hover:bg-[#0d1018]"
            >
              <p className="truncate font-mono text-[9px] uppercase tracking-[0.14em] text-zinc-500 group-hover:text-zinc-300">
                {s.label}
              </p>
              <p
                className="mt-2 font-display text-2xl font-bold leading-none transition"
                style={{ color: n ? s.hex : "#3f3f46" }}
              >
                {n}
              </p>
              <div className="mt-3 h-1 w-full overflow-hidden rounded-full bg-white/[0.06]">
                <div
                  className="h-full rounded-full transition-all duration-700"
                  style={{ width: `${Math.min(100, (n / max) * 100)}%`, background: s.hex }}
                />
              </div>
            </Link>
          );
        })}
      </div>
    </div>
  );
}
