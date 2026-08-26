import { Activity, BarChart3, Eye, Heart, TrendingUp, Users } from "lucide-react";
import { getCreatorAnalytics, getPerformanceSignals, getYouTubeAnalytics } from "@/lib/queries";
import { computeInsights } from "@/engine";
import { RefreshYouTubeAnalyticsButton } from "@/components/youtube-controls";
import { platformConnectionSummary } from "@/lib/services/platforms";
import { fmtNum } from "@/lib/format";
import { SyncAnalyticsButton } from "@/components/publish-controls";
import {
  EmptyState,
  MiniBar,
  PageHeader,
  Panel,
  PanelHeader,
  StatCard,
} from "@/components/ui";

export const dynamic = "force-dynamic";

const DIMENSION_TITLES: Record<string, string> = {
  topic: "TOP TOPICS",
  source: "TOP SOURCES",
  hook: "TOP HOOKS",
  channel: "TOP CHANNELS",
  platform: "TOP PLATFORMS",
};

const CONF_TONE: Record<string, string> = {
  none: "text-zinc-600",
  low: "text-amber-300",
  medium: "text-sky-300",
  high: "text-signal",
};

export default async function CreatorAnalyticsPage() {
  const [a, signals, yt, insights] = await Promise.all([
    getCreatorAnalytics(),
    getPerformanceSignals(),
    getYouTubeAnalytics(),
    computeInsights(),
  ]);
  const secs = (s: number) => (s >= 3600 ? `${(s / 3600).toFixed(1)}h` : `${Math.round(s / 60)}m`);
  const platforms = platformConnectionSummary();
  const connected = platforms.filter((p) => p.state === "connected");

  return (
    <div className="space-y-6">
      <PageHeader
        eyebrow="Feedback loop"
        title="Creator analytics"
        description="Real platform performance and the transparent signal layer that feeds story selection."
        actions={
          <div className="flex flex-wrap gap-2">
            <RefreshYouTubeAnalyticsButton />
            <SyncAnalyticsButton />
          </div>
        }
      />

      {/* ---------------- YouTube ---------------- */}
      <Panel>
        <PanelHeader
          title="YouTube performance"
          hint={
            yt.hasData
              ? `Real platform data · ${yt.snapshots} snapshot(s) across ${yt.videos} video(s)`
              : "No YouTube data yet"
          }
          action={
            <span
              className={`rounded-md border px-2 py-1 font-mono text-[10px] ${
                yt.hasData
                  ? "border-signal/30 bg-signal/10 text-signal"
                  : "border-white/10 bg-white/[0.03] text-zinc-500"
              }`}
            >
              {yt.hasData ? "REAL YOUTUBE DATA" : "NO DATA"}
            </span>
          }
        />
        {!yt.hasData ? (
          <p className="px-5 py-8 text-center text-xs leading-relaxed text-zinc-500">
            No analytics data available. Connect a YouTube account, publish a video, then refresh —
            Viboro only ever shows metrics returned by the YouTube API.
          </p>
        ) : (
          <>
            <div className="grid grid-cols-2 gap-px overflow-hidden bg-white/[0.04] sm:grid-cols-4 xl:grid-cols-8">
              {[
                { l: "Views", v: fmtNum(yt.views) },
                { l: "Likes", v: fmtNum(yt.likes) },
                { l: "Comments", v: fmtNum(yt.comments) },
                { l: "Watch time", v: secs(yt.watchTimeSec) },
                { l: "Avg view", v: yt.avgViewDurationSec != null ? `${yt.avgViewDurationSec}s` : "—" },
                { l: "Retention", v: yt.avgViewPercentageBp != null ? `${(yt.avgViewPercentageBp / 100).toFixed(1)}%` : "—" },
                { l: "CTR", v: yt.ctrBp != null ? `${(yt.ctrBp / 100).toFixed(2)}%` : "—" },
                { l: "Subs", v: `${yt.subsGained - yt.subsLost >= 0 ? "+" : ""}${yt.subsGained - yt.subsLost}` },
              ].map((k) => (
                <div key={k.l} className="bg-[#0a0c12] px-4 py-3.5">
                  <p className="font-mono text-[9px] uppercase tracking-[0.16em] text-zinc-500">{k.l}</p>
                  <p className="mt-1.5 font-display text-lg font-bold text-white">{k.v}</p>
                </div>
              ))}
            </div>
            <div className="divide-y divide-white/[0.05] border-t border-white/[0.06]">
              {yt.top.map((v, i) => (
                <a
                  key={i}
                  href={v.url}
                  target="_blank"
                  rel="noreferrer"
                  className="flex items-center gap-3 px-5 py-3 transition hover:bg-white/[0.02]"
                >
                  <span className="font-mono text-sm font-bold text-zinc-700">
                    {String(i + 1).padStart(2, "0")}
                  </span>
                  <span className="min-w-0 flex-1 truncate text-sm text-zinc-200">{v.title}</span>
                  {v.retentionBp != null && (
                    <span className="font-mono text-[10px] text-zinc-500">
                      {(v.retentionBp / 100).toFixed(0)}% ret
                    </span>
                  )}
                  <span className="font-mono text-sm text-white">{fmtNum(v.views)}</span>
                </a>
              ))}
            </div>
          </>
        )}
      </Panel>

      {/* ---------------- qualitative insights ---------------- */}
      {insights.length > 0 && (
        <Panel>
          <PanelHeader title="Performance insights" hint="Derived from measured retention and engagement" />
          <div className="grid grid-cols-1 gap-3 p-5 sm:grid-cols-2 xl:grid-cols-3">
            {insights.map((ins, i) => {
              const good = ins.kind.startsWith("strong") || ins.kind === "high_engagement";
              return (
                <div
                  key={i}
                  className={`rounded-xl border p-3.5 ${
                    good
                      ? "border-signal/30 bg-signal/[0.05]"
                      : "border-amber-400/30 bg-amber-400/[0.05]"
                  }`}
                >
                  <p className={`text-xs font-semibold ${good ? "text-signal" : "text-amber-300"}`}>
                    {ins.label}
                  </p>
                  <p className="mt-1 text-[11px] leading-relaxed text-zinc-400">{ins.detail}</p>
                  <p className="mt-1.5 font-mono text-[9px] text-zinc-600">
                    n={ins.sampleSize} · {ins.confidence} confidence
                  </p>
                </div>
              );
            })}
          </div>
        </Panel>
      )}

      {!a.hasData ? (
        <>
          <EmptyState
            icon={BarChart3}
            title="No analytics data available."
            body={
              connected.length === 0
                ? "No platform is connected, so no performance metrics can be collected. Metrics appear here once a platform account is configured and posts are published."
                : "No metric snapshots have been recorded yet. Run a sync once posts are live."
            }
            action={<SyncAnalyticsButton />}
          />
          <Panel>
            <PanelHeader
              title="Why there is no data"
              hint="Viboro never fabricates performance numbers"
            />
            <ul className="divide-y divide-white/[0.05]">
              {platforms.map((p) => (
                <li key={p.key} className="flex flex-wrap items-center gap-3 px-5 py-3">
                  <span className="text-sm text-zinc-300">{p.label}</span>
                  <span className="ml-auto font-mono text-[10px] text-zinc-500">{p.detail}</span>
                </li>
              ))}
            </ul>
          </Panel>
        </>
      ) : (
        <>
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4">
            <StatCard icon={Eye} label="Total views" value={fmtNum(a.totalViews)} sub={`${a.videoCount} videos measured`} accent="#c6f135" />
            <StatCard icon={TrendingUp} label="Avg views / video" value={fmtNum(a.avgViews)} sub="across measured posts" accent="#67e8f9" delay={60} />
            <StatCard
              icon={Heart}
              label="Engagement rate"
              value={`${(a.engagementRateBp / 100).toFixed(2)}%`}
              sub={`${fmtNum(a.totalEngagements)} total interactions`}
              accent="#a78bfa"
              delay={120}
            />
            <StatCard
              icon={Users}
              label="Followers gained"
              value={fmtNum(a.followersGained)}
              sub={
                a.completionRateBp != null
                  ? `${(a.completionRateBp / 100).toFixed(1)}% completion`
                  : "completion rate unavailable"
              }
              accent="#fbbf24"
              delay={180}
            />
          </div>

          <Panel>
            <PanelHeader title="TOP VIDEOS" hint="Ranked by measured views" />
            <div className="divide-y divide-white/[0.05]">
              {a.topVideos.map((v, i) => (
                <div key={i} className="grid grid-cols-[32px_minmax(0,1fr)_auto] items-center gap-3 px-5 py-3">
                  <span className="font-mono text-sm font-bold text-zinc-700">
                    {String(i + 1).padStart(2, "0")}
                  </span>
                  <div className="min-w-0">
                    <p className="truncate text-sm text-zinc-200">{v.title}</p>
                    <p className="font-mono text-[10px] text-zinc-600">{v.channel}</p>
                  </div>
                  <div className="text-right">
                    <p className="font-mono text-sm text-white">{fmtNum(v.views)}</p>
                    <p className="font-mono text-[9px] text-zinc-600">{fmtNum(v.engagements)} eng</p>
                  </div>
                </div>
              ))}
            </div>
          </Panel>
        </>
      )}

      {/* signal layer — always shown so the feedback logic is explainable */}
      <Panel>
        <PanelHeader
          title="Performance signal layer"
          hint="Explainable adjustments handed to the Story Judge — capped at ±10 and zero below 5 samples"
          action={
            <span className="rounded-md border border-white/10 bg-white/[0.03] px-2 py-1 font-mono text-[10px] text-zinc-400">
              {signals.length} signal{signals.length === 1 ? "" : "s"}
            </span>
          }
        />
        {signals.length === 0 ? (
          <p className="px-5 py-8 text-center text-xs text-zinc-600">
            No signals computed yet — they are derived from real post metrics only.
          </p>
        ) : (
          <div className="grid grid-cols-1 gap-4 p-5 xl:grid-cols-2">
            {Object.entries(
              signals.reduce<Record<string, typeof signals>>((acc, s) => {
                (acc[s.dimension] ??= []).push(s);
                return acc;
              }, {}),
            ).map(([dim, rows]) => {
              const max = Math.max(...rows.map((r) => r.avgViews), 1);
              return (
                <div key={dim} className="rounded-xl border border-white/[0.06] bg-white/[0.02] p-4">
                  <p className="eyebrow mb-3">{DIMENSION_TITLES[dim] ?? dim.toUpperCase()}</p>
                  <ul className="space-y-3">
                    {rows.slice(0, 8).map((r) => (
                      <li key={r.id}>
                        <div className="flex flex-wrap items-baseline gap-2">
                          <span className="text-xs font-medium text-zinc-200">{r.label}</span>
                          <span className="font-mono text-[10px] text-zinc-500">
                            {r.sampleSize} video{r.sampleSize === 1 ? "" : "s"}
                          </span>
                          <span className="font-mono text-[10px] text-zinc-400">
                            {fmtNum(r.avgViews)} avg
                          </span>
                          <span
                            className={`ml-auto font-mono text-[10px] font-bold ${
                              r.confidence === "none"
                                ? "text-zinc-600"
                                : r.adjustment > 0
                                  ? "text-signal"
                                  : r.adjustment < 0
                                    ? "text-red-300"
                                    : "text-zinc-400"
                            }`}
                          >
                            {r.confidence === "none"
                              ? "insufficient data"
                              : `${r.adjustment >= 0 ? "+" : ""}${r.adjustment}`}
                          </span>
                        </div>
                        <MiniBar value={r.avgViews} max={max} className="mt-1.5" />
                        <p className={`mt-1 font-mono text-[9px] ${CONF_TONE[r.confidence]}`}>
                          {r.explanation}
                        </p>
                      </li>
                    ))}
                  </ul>
                </div>
              );
            })}
          </div>
        )}
      </Panel>

      <Panel>
        <PanelHeader title="Measurement sources" hint="Where metrics come from" />
        <div className="flex flex-wrap gap-2 p-5">
          {platforms.map((p) => (
            <span
              key={p.key}
              className="inline-flex items-center gap-2 rounded-md border border-white/[0.07] bg-white/[0.02] px-2.5 py-1.5"
            >
              <Activity className="size-3 text-zinc-600" />
              <span className="text-xs text-zinc-300">{p.label}</span>
              <span className="font-mono text-[9px] uppercase tracking-[0.1em] text-zinc-600">
                {p.state.replace(/_/g, " ")}
              </span>
            </span>
          ))}
        </div>
      </Panel>
    </div>
  );
}
