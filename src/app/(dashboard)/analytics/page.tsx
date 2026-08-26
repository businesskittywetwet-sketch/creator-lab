import {
  Clock3,
  Eye,
  Heart,
  TrendingUp,
} from "lucide-react";
import {
  dailyViewsSeries,
  dayLabel,
  getChannels,
  getContentWithChannel,
  getSnapshots,
  lastNDays,
  latestTotals,
  type SnapshotRow,
} from "@/lib/queries";
import { fmtNum, timeAgo } from "@/lib/format";
import {
  EmptyState,
  MiniBar,
  PageHeader,
  Panel,
  PanelHeader,
  ScoreOrb,
  StatCard,
} from "@/components/ui";
import {
  EngageBarChart,
  PlatformDonut,
  ViewsAreaChart,
} from "@/components/charts";
import { Activity } from "lucide-react";
import { PLATFORM_COLORS } from "@/components/ui";

export const dynamic = "force-dynamic";

function dailyFieldSeries(
  snaps: SnapshotRow[],
  days: string[],
  field: "likes" | "shares" | "comments",
) {
  const bySeries = new Map<string, SnapshotRow[]>();
  for (const s of snaps) {
    const k = `${s.contentId}|${s.platform}`;
    if (!bySeries.has(k)) bySeries.set(k, []);
    bySeries.get(k)!.push(s);
  }
  const perDay = new Map<string, number>(days.map((d) => [d, 0]));
  for (const rows of bySeries.values()) {
    rows.sort((a, b) => +new Date(a.capturedAt) - +new Date(b.capturedAt));
    let prev = rows[0]?.[field] ?? 0;
    for (const r of rows) {
      const key = new Date(r.capturedAt).toISOString().slice(0, 10);
      if (perDay.has(key))
        perDay.set(key, (perDay.get(key) ?? 0) + Math.max(0, r[field] - prev));
      prev = r[field];
    }
  }
  return perDay;
}

export default async function AnalyticsPage() {
  const [snaps, channelRows, contentRows] = await Promise.all([
    getSnapshots(),
    getChannels(),
    getContentWithChannel(),
  ]);

  const days = lastNDays(14);
  const viewsSeries = dailyViewsSeries(snaps, days);
  const likesMap = dailyFieldSeries(snaps, days, "likes");
  const sharesMap = dailyFieldSeries(snaps, days, "shares");
  const commentsMap = dailyFieldSeries(snaps, days, "comments");
  const engageSeries = days.map((d) => ({
    label: dayLabel(d),
    likes: likesMap.get(d) ?? 0,
    shares: sharesMap.get(d) ?? 0,
    comments: commentsMap.get(d) ?? 0,
  }));

  const totals = latestTotals(snaps);
  const engagement = totals.views
    ? ((totals.likes + totals.comments + totals.shares) / totals.views) * 100
    : 0;
  const total14 = viewsSeries.reduce((a, s) => a + s.views, 0);
  const publishedCount = contentRows.filter((c) => c.stage === "published").length;
  const avgPerVideo = publishedCount ? Math.round(totals.views / publishedCount) : 0;

  // platform split (latest per content+platform)
  const latest = new Map<string, SnapshotRow>();
  for (const s of snaps) {
    const k = `${s.contentId}|${s.platform}`;
    const cur = latest.get(k);
    if (!cur || +new Date(s.capturedAt) > +new Date(cur.capturedAt)) latest.set(k, s);
  }
  const byPlatform = new Map<string, number>();
  const byChannel = new Map<string, { views: number; eng: number }>();
  const byContent = new Map<string, { views: number; eng: number }>();
  for (const s of latest.values()) {
    byPlatform.set(s.platform, (byPlatform.get(s.platform) ?? 0) + s.views);
    if (s.channelId) {
      const c = byChannel.get(s.channelId) ?? { views: 0, eng: 0 };
      c.views += s.views;
      c.eng += s.likes + s.shares + s.comments;
      byChannel.set(s.channelId, c);
    }
    if (s.contentId) {
      const c = byContent.get(s.contentId) ?? { views: 0, eng: 0 };
      c.views += s.views;
      c.eng += s.likes + s.shares + s.comments;
      byContent.set(s.contentId, c);
    }
  }

  const donut = Array.from(byPlatform.entries())
    .map(([p, v]) => ({ label: p.charAt(0).toUpperCase() + p.slice(1), value: v, color: PLATFORM_COLORS[p] ?? "#8b93a7" }))
    .sort((a, b) => b.value - a.value);

  const maxChannelViews = Math.max(1, ...Array.from(byChannel.values()).map((c) => c.views));

  const topContent = contentRows
    .filter((c) => c.stage === "published")
    .map((c) => ({ ...c, perf: byContent.get(c.id) ?? { views: 0, eng: 0 } }))
    .sort((a, b) => b.perf.views - a.perf.views)
    .slice(0, 6);

  return (
    <div className="space-y-6">
      <PageHeader
        eyebrow="Feedback loop"
        title="Analytics"
        description="Performance telemetry the Analytics Agent feeds back into story selection and scripting decisions."
      />

      {snaps.length === 0 ? (
        <EmptyState
          icon={Activity}
          title="No performance data yet"
          body="Analytics snapshots appear once content is published. Seed demo data or publish something first."
        />
      ) : (
        <>
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4">
            <StatCard
              icon={Eye}
              label="Views · 14 days"
              value={fmtNum(total14)}
              sub={`${fmtNum(totals.views)} lifetime across platforms`}
              spark={viewsSeries.map((s) => s.views)}
              accent="#c6f135"
            />
            <StatCard
              icon={TrendingUp}
              label="Engagement rate"
              value={`${engagement.toFixed(1)}%`}
              sub="likes + shares + comments per view"
              accent="#67e8f9"
              delay={60}
            />
            <StatCard
              icon={Clock3}
              label="Watch minutes"
              value={fmtNum(totals.watch)}
              sub="cumulative audience time served"
              accent="#a78bfa"
              delay={120}
            />
            <StatCard
              icon={Heart}
              label="Avg views / video"
              value={fmtNum(avgPerVideo)}
              sub={`across ${publishedCount} published videos`}
              accent="#fbbf24"
              delay={180}
            />
          </div>

          <div className="grid grid-cols-1 gap-4 xl:grid-cols-3">
            <Panel className="xl:col-span-2">
              <PanelHeader
                title="Views trajectory"
                hint="All channels · daily views · 14 days"
              />
              <div className="px-4 py-4">
                <ViewsAreaChart data={viewsSeries} />
              </div>
            </Panel>
            <Panel>
              <PanelHeader title="Platform split" hint="Lifetime views by network" />
              <div className="px-5 py-6">
                <PlatformDonut segments={donut} />
              </div>
            </Panel>
          </div>

          <div className="grid grid-cols-1 gap-4 xl:grid-cols-3">
            <Panel className="xl:col-span-2">
              <PanelHeader
                title="Engagement composition"
                hint="Daily likes, shares and comments"
                action={
                  <div className="flex items-center gap-3 font-mono text-[9px] uppercase tracking-[0.14em] text-zinc-500">
                    <span className="flex items-center gap-1.5"><span className="size-2 rounded-sm bg-[#c6f135]" />Likes</span>
                    <span className="flex items-center gap-1.5"><span className="size-2 rounded-sm bg-[#67e8f9]" />Shares</span>
                    <span className="flex items-center gap-1.5"><span className="size-2 rounded-sm bg-[#a78bfa]" />Comments</span>
                  </div>
                }
              />
              <div className="px-4 py-4">
                <EngageBarChart data={engageSeries} />
              </div>
            </Panel>
            <Panel>
              <PanelHeader title="Channel performance" hint="Lifetime views per brand" />
              <ul className="space-y-4 px-5 py-5">
                {channelRows
                  .map((ch) => ({ ch, perf: byChannel.get(ch.id) ?? { views: 0, eng: 0 } }))
                  .sort((a, b) => b.perf.views - a.perf.views)
                  .map(({ ch, perf }) => (
                    <li key={ch.id}>
                      <div className="mb-1.5 flex items-center gap-2">
                        <span className="size-1.5 rounded-full" style={{ background: ch.color }} />
                        <p className="text-xs font-medium text-zinc-300">{ch.name}</p>
                        <span className="ml-auto font-mono text-[11px] text-zinc-400">
                          {fmtNum(perf.views)}
                        </span>
                      </div>
                      <MiniBar value={perf.views} max={maxChannelViews} color={ch.color} />
                    </li>
                  ))}
              </ul>
            </Panel>
          </div>

          <Panel>
            <PanelHeader
              title="Top performing content"
              hint="Ranked by lifetime views — these patterns feed the Story Judge"
            />
            <div className="divide-y divide-white/[0.05]">
              {topContent.map((c, i) => {
                const rate = c.perf.views ? ((c.perf.eng / c.perf.views) * 100).toFixed(1) : "0.0";
                return (
                  <div
                    key={c.id}
                    className="grid grid-cols-[44px_minmax(0,1fr)_auto] items-center gap-4 px-5 py-3.5 sm:grid-cols-[44px_minmax(0,1fr)_140px_110px_110px_56px]"
                  >
                    <p className="font-mono text-sm font-bold text-zinc-600">
                      {String(i + 1).padStart(2, "0")}
                    </p>
                    <div className="min-w-0">
                      <p className="truncate font-display text-sm font-semibold text-zinc-100">
                        {c.title}
                      </p>
                      <p className="mt-0.5 flex items-center gap-1.5 text-[11px] text-zinc-500">
                        <span className="size-1 rounded-full" style={{ background: c.channelColor }} />
                        {c.channelName} · {timeAgo(c.publishedAt)}
                      </p>
                    </div>
                    <ScoreOrb score={c.score} size={32} />
                    <p className="hidden text-right font-mono text-sm text-white sm:block">
                      {fmtNum(c.perf.views)}
                      <span className="block font-mono text-[9px] uppercase tracking-[0.18em] text-zinc-600">
                        views
                      </span>
                    </p>
                    <p className="hidden text-right font-mono text-sm text-signal sm:block">
                      {rate}%
                      <span className="block font-mono text-[9px] uppercase tracking-[0.18em] text-zinc-600">
                        engaged
                      </span>
                    </p>
                    <p className="hidden text-right font-mono text-sm text-zinc-300 sm:block">
                      {fmtNum(c.perf.eng)}
                      <span className="block font-mono text-[9px] uppercase tracking-[0.18em] text-zinc-600">
                        actions
                      </span>
                    </p>
                  </div>
                );
              })}
            </div>
          </Panel>
        </>
      )}
    </div>
  );
}
