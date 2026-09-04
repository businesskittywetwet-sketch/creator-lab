import { Layers, Mic, Repeat, Timer, Users } from "lucide-react";
import { toggleChannel } from "@/app/actions";
import ChannelDialog from "@/components/channel-dialog";
import ProductionSettingsDialog from "@/components/production-settings-dialog";
import ChannelStrategyDialog from "@/components/channel-strategy-dialog";
import { ChannelDelete } from "@/components/controls";
import { getChannels, getChannelStats, getProductionSettingsMap, getChannelStrategies } from "@/lib/queries";
import { DEFAULT_REQUIRED_STEPS } from "@/lib/production-steps";
import { fmtNum } from "@/lib/format";
import {
  EmptyState,
  PageHeader,
  Panel,
  PlatformMark,
  StatusBadge,
} from "@/components/ui";

export const dynamic = "force-dynamic";

function Spec({ label, value, className = "" }: { label: string; value: string; className?: string }) {
  return (
    <div className={`rounded-lg border border-white/[0.05] bg-white/[0.02] px-3 py-2 ${className}`}>
      <p className="font-mono text-[8.5px] uppercase tracking-[0.2em] text-zinc-600">{label}</p>
      <p className="mt-1 truncate text-xs text-zinc-300" title={value}>
        {value || "—"}
      </p>
    </div>
  );
}

export default async function ChannelsPage() {
  const [channelRows, stats, prodSettings, strategies] = await Promise.all([
    getChannels(),
    getChannelStats(),
    getProductionSettingsMap(),
    getChannelStrategies(),
  ]);

  return (
    <div className="space-y-6">
      <PageHeader
        eyebrow="Studio"
        title="Channels"
        description="Independent entertainment brands, each with its own voice, cadence and audience. Agents route work per channel profile."
        actions={<ChannelDialog />}
      />

      {channelRows.length === 0 ? (
        <EmptyState
          title="No channels yet"
          body="Create your first entertainment channel to give the agent fleet something to work on."
          action={<ChannelDialog />}
        />
      ) : (
        <div className="grid grid-cols-1 gap-4 xl:grid-cols-2">
          {channelRows.map((ch, i) => {
            const s = stats.byChannel.get(ch.id) ?? { total: 0, published: 0, inPipeline: 0 };
            const views = stats.viewsByChannel.get(ch.id) ?? 0;
            return (
              <Panel
                key={ch.id}
                className={`card-hover relative overflow-hidden animate-fade-up ${
                  ch.active ? "" : "opacity-70"
                }`}
              >
                <div
                  className="pointer-events-none absolute inset-x-0 top-0 h-px"
                  style={{
                    background: `linear-gradient(90deg, transparent, ${ch.color}88, transparent)`,
                  }}
                />
                <div
                  className="pointer-events-none absolute -left-16 -top-16 size-48 rounded-full blur-3xl"
                  style={{ background: `${ch.color}0c` }}
                />

                <div style={{ animationDelay: `${i * 60}ms` }} className="animate-fade-up">
                  <div className="flex items-start gap-3.5 p-5 pb-0">
                    <div
                      className="grid size-11 shrink-0 place-items-center rounded-xl border font-display text-base font-bold"
                      style={{
                        borderColor: `${ch.color}44`,
                        background: `${ch.color}12`,
                        color: ch.color,
                      }}
                    >
                      {ch.name.slice(0, 1)}
                    </div>
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-2.5">
                        <h3 className="truncate font-display text-base font-bold text-white">
                          {ch.name}
                        </h3>
                        <StatusBadge status={ch.active ? "active" : "inactive"} />
                      </div>
                      <p className="mt-0.5 truncate text-xs text-zinc-500">{ch.niche}</p>
                    </div>
                    <div className="flex shrink-0 -space-x-1">
                      {ch.targetPlatforms.map((p) => (
                        <PlatformMark key={p} platform={p} />
                      ))}
                    </div>
                  </div>

                  <p className="clamp-2 px-5 pt-3 text-[13px] leading-relaxed text-zinc-500">
                    {ch.description}
                  </p>

                  <div className="grid grid-cols-2 gap-2 p-5 sm:grid-cols-3">
                    <Spec label="Style" value={ch.contentStyle} />
                    <Spec label="Voice" value={ch.voiceTone} />
                    <Spec label="Audience" value={ch.targetAudience} />
                    <Spec label="Frequency" value={ch.postingFrequency} />
                    <Spec label="Length" value={ch.preferredLength} />
                    <Spec label="Slug" value={`/${ch.slug}`} />
                  </div>

                  {(() => {
                    const st = strategies.get(ch.id);
                    if (!st) return null;
                    return (
                      <div className="mx-5 mb-3 flex flex-wrap gap-x-4 gap-y-1 rounded-xl border border-white/[0.06] bg-white/[0.02] px-4 py-2.5 font-mono text-[10px] text-zinc-500">
                        <span className="text-zinc-400">strategy</span>
                        <span>{st.postsPerWeek}/wk</span>
                        <span>{st.timezone}</span>
                        <span>{st.platforms.length} platform(s)</span>
                        <span className={st.autoPublish ? "text-amber-300" : "text-signal"}>
                          auto-publish {st.autoPublish ? "ON" : "OFF"}
                        </span>
                        <span className={st.requireApproval ? "text-signal" : "text-amber-300"}>
                          approval {st.requireApproval ? "required" : "not required"}
                        </span>
                      </div>
                    );
                  })()}
                  {(() => {
                    const ps = prodSettings.get(ch.id);
                    if (!ps) return null;
                    return (
                      <div className="mx-5 mb-4 rounded-xl border border-white/[0.06] bg-white/[0.02] px-4 py-3">
                        <p className="eyebrow mb-2">Production profile</p>
                        <div className="flex flex-wrap gap-x-4 gap-y-1.5 font-mono text-[10px] text-zinc-500">
                          <span>{ps.format}</span>
                          <span>{ps.targetDurationSec}s target</span>
                          <span>{ps.scriptWordTarget}w script</span>
                          <span>{ps.sectionCount} sections</span>
                          <span className="text-zinc-400">
                            {ps.requiredSteps.length || DEFAULT_REQUIRED_STEPS.length} steps enabled
                          </span>
                        </div>
                      </div>
                    );
                  })()}

                  <div className="flex items-center gap-5 border-t border-white/[0.05] px-5 py-3.5">
                    <span className="text-[11px] text-zinc-500">
                      <span className="font-mono font-semibold text-zinc-200">{s.inPipeline}</span>{" "}
                      in pipeline
                    </span>
                    <span className="text-[11px] text-zinc-500">
                      <span className="font-mono font-semibold text-zinc-200">{s.published}</span>{" "}
                      published
                    </span>
                    <span className="hidden text-[11px] text-zinc-500 sm:inline">
                      <span className="font-mono font-semibold text-zinc-200">{fmtNum(views)}</span>{" "}
                      lifetime views
                    </span>
                    <div className="ml-auto flex items-center gap-2">
                      <ChannelStrategyDialog
                        strategy={{
                          channelId: ch.id,
                          channelName: ch.name,
                          postsPerWeek: strategies.get(ch.id)?.postsPerWeek ?? 5,
                          postingWindows: strategies.get(ch.id)?.postingWindows ?? ["09:00", "18:00"],
                          timezone: strategies.get(ch.id)?.timezone ?? "UTC",
                          platforms: strategies.get(ch.id)?.platforms ?? ch.targetPlatforms,
                          hashtagStrategy:
                            strategies.get(ch.id)?.hashtagStrategy ?? "3-5 niche tags, no generic spam",
                          defaultHashtags: strategies.get(ch.id)?.defaultHashtags ?? [],
                          requireApproval: strategies.get(ch.id)?.requireApproval ?? true,
                          autoPublish: strategies.get(ch.id)?.autoPublish ?? false,
                          minQcScore: strategies.get(ch.id)?.minQcScore ?? 60,
                        }}
                      />
                      <ProductionSettingsDialog
                        settings={{
                          channelId: ch.id,
                          channelName: ch.name,
                          format: prodSettings.get(ch.id)?.format ?? "Short",
                          targetDurationSec: prodSettings.get(ch.id)?.targetDurationSec ?? 55,
                          scriptWordTarget: prodSettings.get(ch.id)?.scriptWordTarget ?? 140,
                          tone: prodSettings.get(ch.id)?.tone ?? ch.voiceTone,
                          hookStyle: prodSettings.get(ch.id)?.hookStyle ?? "cold-open shock fact",
                          ctaStyle: prodSettings.get(ch.id)?.ctaStyle ?? "Follow for more",
                          visualStyle: prodSettings.get(ch.id)?.visualStyle ?? ch.contentStyle,
                          narrationVoice: prodSettings.get(ch.id)?.narrationVoice ?? "default",
                          researchDepth: prodSettings.get(ch.id)?.researchDepth ?? 4,
                          sectionCount: prodSettings.get(ch.id)?.sectionCount ?? 4,
                          requiredSteps:
                            prodSettings.get(ch.id)?.requiredSteps ?? DEFAULT_REQUIRED_STEPS,
                        }}
                      />
                      <ChannelDialog
                        channel={{
                          id: ch.id,
                          name: ch.name,
                          niche: ch.niche,
                          description: ch.description,
                          contentStyle: ch.contentStyle,
                          targetAudience: ch.targetAudience,
                          postingFrequency: ch.postingFrequency,
                          preferredLength: ch.preferredLength,
                          voiceTone: ch.voiceTone,
                          color: ch.color,
                          targetPlatforms: ch.targetPlatforms,
                        }}
                      />
                      <form action={toggleChannel.bind(null, ch.id, ch.active)}>
                        <button
                          className={`rounded-lg border px-2.5 py-1.5 font-mono text-[10px] uppercase tracking-[0.1em] transition ${
                            ch.active
                              ? "border-white/10 text-zinc-400 hover:border-amber-400/40 hover:text-amber-300"
                              : "border-signal/30 bg-signal/10 text-signal hover:bg-signal/20"
                          }`}
                        >
                          {ch.active ? "Deactivate" : "Activate"}
                        </button>
                      </form>
                      <ChannelDelete id={ch.id} />
                    </div>
                  </div>
                </div>
              </Panel>
            );
          })}
        </div>
      )}

      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        {[
          { icon: Repeat, label: "Cadence engine", body: "Posting frequency drives scheduler slots" },
          { icon: Mic, label: "Voice profiles", body: "One cloned narrator voice per channel" },
          { icon: Timer, label: "Runtime targets", body: "Length guides scripting and render budgets" },
          { icon: Users, label: "Audience fit", body: "The judge agent scores against audience overlap" },
        ].map((f) => (
          <div key={f.label} className="panel p-4">
            <f.icon className="size-4 text-signal" />
            <p className="mt-2.5 font-display text-xs font-semibold text-zinc-200">{f.label}</p>
            <p className="mt-1 text-[11px] leading-relaxed text-zinc-500">{f.body}</p>
          </div>
        ))}
      </div>
    </div>
  );
}
