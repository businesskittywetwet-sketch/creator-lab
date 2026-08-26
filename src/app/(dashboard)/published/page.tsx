import { ExternalLink, Eye, Heart, MessageCircle, Play, Share2 } from "lucide-react";
import { getContentWithChannel, getPublishingJobs, getSnapshots } from "@/lib/queries";
import { fmtDurationSec, fmtNum, timeAgo } from "@/lib/format";
import {
  EmptyState,
  PageHeader,
  PlatformMark,
  ScoreOrb,
  StatusBadge,
} from "@/components/ui";
import { CirclePlay } from "lucide-react";

export const dynamic = "force-dynamic";

export default async function PublishedPage() {
  const [rows, jobs, snaps] = await Promise.all([
    getContentWithChannel(),
    getPublishingJobs(),
    getSnapshots(),
  ]);
  const published = rows.filter((c) => c.stage === "published");

  // latest cumulative snapshot per content+platform → per-content totals
  const totals = new Map<string, { views: number; likes: number; comments: number; shares: number }>();
  const latest = new Map<string, (typeof snaps)[number]>();
  for (const s of snaps) {
    const k = `${s.contentId}|${s.platform}`;
    const cur = latest.get(k);
    if (!cur || +new Date(s.capturedAt) > +new Date(cur.capturedAt)) latest.set(k, s);
  }
  for (const s of latest.values()) {
    if (!s.contentId) continue;
    const t = totals.get(s.contentId) ?? { views: 0, likes: 0, comments: 0, shares: 0 };
    t.views += s.views;
    t.likes += s.likes;
    t.comments += s.comments;
    t.shares += s.shares;
    totals.set(s.contentId, t);
  }

  const lifetimeViews = Array.from(totals.values()).reduce((a, t) => a + t.views, 0);
  const jobsByContent = new Map<string, typeof jobs>();
  for (const j of jobs) {
    if (!jobsByContent.has(j.contentId)) jobsByContent.set(j.contentId, []);
    jobsByContent.get(j.contentId)!.push(j);
  }

  return (
    <div className="space-y-6">
      <PageHeader
        eyebrow="Distribution"
        title="Published content"
        description="Everything live across target platforms, with per-platform job receipts and rolling performance."
        actions={
          <div className="rounded-lg border border-white/[0.08] bg-white/[0.02] px-3 py-2 font-mono text-[10px] uppercase tracking-[0.16em] text-zinc-400">
            {fmtNum(lifetimeViews)} lifetime views
          </div>
        }
      />

      {published.length === 0 ? (
        <EmptyState
          icon={CirclePlay}
          title="Nothing published yet"
          body="Advance content through the pipeline to the Published stage and it will appear here with live receipts."
        />
      ) : (
        <div className="space-y-3">
          {published.map((c, i) => {
            const t = totals.get(c.id) ?? { views: 0, likes: 0, comments: 0, shares: 0 };
            const engagements = t.likes + t.comments + t.shares;
            const rate = t.views ? ((engagements / t.views) * 100).toFixed(1) : "0.0";
            const contentJobs = jobsByContent.get(c.id) ?? [];
            return (
              <div
                key={c.id}
                className="panel card-hover grid grid-cols-1 gap-4 p-4 animate-fade-up lg:grid-cols-[150px_minmax(0,1fr)_200px_190px]"
                style={{ animationDelay: `${i * 55}ms` }}
              >
                {/* poster */}
                <div
                  className="relative hidden h-[86px] overflow-hidden rounded-xl border border-white/[0.07] lg:block"
                  style={{
                    background: `linear-gradient(135deg, ${c.channelColor}26, transparent 55%), radial-gradient(120px 60px at 100% 0%, ${c.channelColor}1f, transparent)`,
                  }}
                >
                  <div className="absolute inset-0 grid place-items-center">
                    <div className="grid size-9 place-items-center rounded-full border border-white/15 bg-black/40 backdrop-blur">
                      <Play className="size-3.5 pl-0.5 text-white" />
                    </div>
                  </div>
                  <span className="absolute bottom-1.5 right-1.5 rounded bg-black/60 px-1.5 py-0.5 font-mono text-[9px] text-zinc-300">
                    {fmtDurationSec(c.durationSec)}
                  </span>
                </div>

                {/* main */}
                <div className="min-w-0">
                  <div className="flex items-center gap-2">
                    <span className="size-1.5 rounded-full" style={{ background: c.channelColor }} />
                    <span className="font-mono text-[9px] uppercase tracking-[0.18em] text-zinc-500">
                      {c.channelName} · {c.format}
                    </span>
                  </div>
                  <h3 className="clamp-2 mt-1.5 font-display text-[15px] font-semibold leading-snug text-white">
                    {c.title}
                  </h3>
                  <p className="mt-1.5 font-mono text-[10px] text-zinc-600">
                    published {timeAgo(c.publishedAt)}
                  </p>
                </div>

                {/* stats */}
                <div>
                  <p className="flex items-center gap-1.5 font-display text-xl font-bold text-white">
                    <Eye className="size-4 text-zinc-600" />
                    {fmtNum(t.views)}
                  </p>
                  <div className="mt-1.5 flex items-center gap-3 text-[11px] text-zinc-500">
                    <span className="inline-flex items-center gap-1">
                      <Heart className="size-3 text-zinc-600" /> {fmtNum(t.likes)}
                    </span>
                    <span className="inline-flex items-center gap-1">
                      <MessageCircle className="size-3 text-zinc-600" /> {fmtNum(t.comments)}
                    </span>
                    <span className="inline-flex items-center gap-1">
                      <Share2 className="size-3 text-zinc-600" /> {fmtNum(t.shares)}
                    </span>
                  </div>
                  <p className="mt-1.5 font-mono text-[10px] text-signal">{rate}% engagement</p>
                </div>

                {/* receipts */}
                <div className="flex flex-col justify-between gap-3 lg:items-end">
                  <ScoreOrb score={c.score} size={34} />
                  <div className="flex flex-wrap gap-1.5 lg:justify-end">
                    {contentJobs.map((j) =>
                      j.status === "published" && j.externalUrl ? (
                        <span key={j.id} className="inline-flex items-center gap-1">
                          <PlatformMark platform={j.platform} />
                          <ExternalLink className="size-2.5 text-zinc-600" />
                        </span>
                      ) : (
                        <span key={j.id} className="inline-flex items-center gap-1">
                          <PlatformMark platform={j.platform} />
                          <StatusBadge status={j.status} />
                        </span>
                      ),
                    )}
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
