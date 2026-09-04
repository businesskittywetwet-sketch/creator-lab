"use client";

import { useTransition } from "react";
import { ArrowLeft, ArrowRight, CalendarClock, Clock3 } from "lucide-react";
import { moveContent } from "@/app/actions";
import { PIPELINE_STAGES, stageIndex } from "@/lib/pipeline";
import { AgentAvatars, ScoreOrb } from "@/components/ui";
import { fmtDurationSec } from "@/lib/format";

export type QueueItem = {
  id: string;
  title: string;
  stage: string;
  score: number;
  format: string;
  durationSec: number | null;
  channelName: string;
  channelColor: string;
  updatedLabel: string;
  scheduledLabel: string | null;
  assignedAgents: string[];
};

function QueueCard({ item }: { item: QueueItem }) {
  const [pending, start] = useTransition();
  const idx = stageIndex(item.stage);
  const stageColor = PIPELINE_STAGES[idx]?.hex ?? "#8b93a7";

  return (
    <div
      className={`panel card-hover group relative p-3.5 transition-opacity ${
        pending ? "opacity-50" : ""
      }`}
    >
      <div className="mb-2.5 flex items-center gap-2">
        <span
          className="size-1.5 rounded-full"
          style={{ background: item.channelColor }}
        />
        <span className="truncate font-mono text-[9px] uppercase tracking-[0.16em] text-zinc-500">
          {item.channelName}
        </span>
        <span className="ml-auto">
          <ScoreOrb score={item.score} size={30} />
        </span>
      </div>

      <h4 className="clamp-2 min-h-10 font-display text-[13px] font-semibold leading-snug text-zinc-100">
        {item.title}
      </h4>

      <div className="mt-2.5 flex items-center gap-3 font-mono text-[10px] text-zinc-500">
        <span>{item.format}</span>
        {item.durationSec ? (
          <span className="inline-flex items-center gap-1">
            <Clock3 className="size-3" />
            {fmtDurationSec(item.durationSec)}
          </span>
        ) : null}
        <span className="ml-auto">{item.updatedLabel}</span>
      </div>

      {item.scheduledLabel && (
        <div className="mt-2 inline-flex items-center gap-1.5 rounded-md border border-orange-400/25 bg-orange-400/10 px-1.5 py-0.5 font-mono text-[9px] uppercase tracking-wider text-orange-300">
          <CalendarClock className="size-3" />
          {item.scheduledLabel}
        </div>
      )}

      {/* stage progress rail */}
      <div className="mt-3 flex gap-[3px]">
        {PIPELINE_STAGES.map((s, i) => (
          <span
            key={s.key}
            className="h-[3px] flex-1 rounded-full"
            style={{
              background: i <= idx ? stageColor : "rgba(255,255,255,0.07)",
              opacity: i === idx ? 1 : i < idx ? 0.55 : 1,
            }}
          />
        ))}
      </div>

      <div className="mt-3 flex items-center justify-between border-t border-white/[0.05] pt-2.5">
        <AgentAvatars slugs={item.assignedAgents} size="sm" />
        <div className="flex gap-1 opacity-0 transition-opacity group-hover:opacity-100">
          <button
            title="Move back a stage"
            disabled={idx === 0 || pending}
            onClick={() => start(async () => { await moveContent(item.id, -1); })}
            className="grid size-6 place-items-center rounded-md border border-white/10 text-zinc-500 transition hover:border-white/25 hover:text-white disabled:opacity-30"
          >
            <ArrowLeft className="size-3" />
          </button>
          <button
            title="Advance a stage"
            disabled={idx === PIPELINE_STAGES.length - 1 || pending}
            onClick={() => start(async () => { await moveContent(item.id, 1); })}
            className="grid size-6 place-items-center rounded-md border border-white/10 text-zinc-500 transition hover:border-signal/50 hover:text-signal disabled:opacity-30"
          >
            <ArrowRight className="size-3" />
          </button>
        </div>
      </div>
    </div>
  );
}

export default function QueueBoard({ items }: { items: QueueItem[] }) {
  return (
    <div className="scanline -mx-4 overflow-x-auto px-4 pb-4 sm:-mx-6 sm:px-6 lg:-mx-10 lg:px-10">
      <div className="flex min-w-max gap-4">
        {PIPELINE_STAGES.map((stage) => {
          const col = items.filter((i) => i.stage === stage.key);
          return (
            <div key={stage.key} className="w-[248px] shrink-0">
              <div className="mb-3 flex items-center gap-2 px-1">
                <span
                  className="size-2 rounded-[4px]"
                  style={{ background: stage.hex }}
                />
                <h3 className="font-display text-xs font-semibold uppercase tracking-[0.12em] text-zinc-300">
                  {stage.label}
                </h3>
                <span className="ml-auto rounded-md border border-white/[0.07] bg-white/[0.03] px-1.5 py-0.5 font-mono text-[10px] text-zinc-400">
                  {col.length}
                </span>
              </div>
              <div className="space-y-3">
                {col.map((item, i) => (
                  <div key={item.id} className="animate-fade-up" style={{ animationDelay: `${i * 45}ms` }}>
                    <QueueCard item={item} />
                  </div>
                ))}
                {col.length === 0 && (
                  <div className="rounded-xl border border-dashed border-white/[0.07] px-3 py-6 text-center">
                    <p className="font-mono text-[10px] uppercase tracking-[0.18em] text-zinc-700">
                      Empty
                    </p>
                  </div>
                )}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
