import { Layers } from "lucide-react";
import { db } from "@/db";
import { storySources } from "@/db/schema";
import { adoptLegacyChannels, listNiches } from "@/engine";
import { fmtDateTime, timeAgo, timeUntil } from "@/lib/format";
import NicheWizard from "@/components/niche-wizard";
import { NicheActions, SourceManager } from "@/components/niche-controls";
import { EmptyState, MiniBar, PageHeader, Panel, StatusBadge } from "@/components/ui";

export const dynamic = "force-dynamic";

const STATUS_TONE: Record<string, string> = {
  active: "active",
  paused: "paused",
  archived: "idle",
};

export default async function NichesPage() {
  // Adopt any pre-Phase-7 channel so nothing is orphaned by the migration.
  await adoptLegacyChannels();
  const [rows, allSources] = await Promise.all([
    listNiches(),
    db.select().from(storySources),
  ]);
  const sourcesByNiche = new Map<string, typeof allSources>();
  for (const s of allSources) {
    if (!s.nicheId) continue;
    if (!sourcesByNiche.has(s.nicheId)) sourcesByNiche.set(s.nicheId, []);
    sourcesByNiche.get(s.nicheId)!.push(s);
  }

  const active = rows.filter((n) => n.status === "active").length;
  const maxPublished = Math.max(1, ...rows.map((n) => n.videosPublished));

  return (
    <div className="space-y-6">
      <PageHeader
        eyebrow="Studio"
        title="Niches"
        description="Each niche is a configuration object binding sources, judging rules, production and publishing profiles. One shared engine runs them all."
        actions={<NicheWizard />}
      />

      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        {[
          { l: "Niches", v: rows.length, t: "text-zinc-100" },
          { l: "Active", v: active, t: "text-signal" },
          { l: "Sources", v: allSources.length, t: "text-sky-300" },
          { l: "Jobs queued", v: rows.reduce((a, n) => a + n.jobsQueued, 0), t: "text-amber-300" },
        ].map((c, i) => (
          <div key={c.l} className="panel p-4 animate-fade-up" style={{ animationDelay: `${i * 40}ms` }}>
            <p className="eyebrow">{c.l}</p>
            <p className={`mt-2 font-display text-2xl font-bold ${c.t}`}>{c.v}</p>
          </div>
        ))}
      </div>

      {rows.length === 0 ? (
        <EmptyState
          icon={Layers}
          title="No niches yet"
          body="Create your first niche to configure sources, judging, production and publishing — no code required."
          action={<NicheWizard />}
        />
      ) : (
        <div className="grid grid-cols-1 gap-4 xl:grid-cols-2">
          {rows.map((n, i) => (
            <Panel key={n.id} className="card-hover p-5 animate-fade-up"
              style={{ animationDelay: `${Math.min(i, 8) * 50}ms` }}>
              <div className="flex items-start gap-3">
                <div className="grid size-10 shrink-0 place-items-center rounded-xl border font-display text-base font-bold"
                  style={{ borderColor: `${n.color}44`, background: `${n.color}12`, color: n.color }}>
                  {n.name.slice(0, 1)}
                </div>
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center gap-2">
                    <h3 className="truncate font-display text-base font-bold text-white">{n.name}</h3>
                    <StatusBadge status={STATUS_TONE[n.status] ?? "idle"} label={n.status} />
                  </div>
                  <p className="clamp-2 mt-1 text-xs text-zinc-500">{n.description || "No description"}</p>
                </div>
              </div>

              <div className="mt-4 grid grid-cols-2 gap-2 sm:grid-cols-4">
                {[
                  { l: "Sources", v: n.sourceCount },
                  { l: "Produced", v: n.videosTotal },
                  { l: "In queue", v: n.jobsQueued },
                  { l: "Published", v: n.videosPublished },
                ].map((k) => (
                  <div key={k.l} className="rounded-lg border border-white/[0.05] bg-white/[0.02] px-3 py-2">
                    <p className="font-mono text-[8.5px] uppercase tracking-[0.18em] text-zinc-600">{k.l}</p>
                    <p className="mt-0.5 font-display text-sm font-bold text-zinc-100">{k.v}</p>
                  </div>
                ))}
              </div>

              <MiniBar value={n.videosPublished} max={maxPublished} color={n.color} className="mt-3" />

              <div className="mt-3 flex flex-wrap gap-x-4 gap-y-1 font-mono text-[10px] text-zinc-500">
                <span>scout every {n.scoutIntervalHours}h</span>
                <span>greenlight ≥ {n.minGreenlightScore}</span>
                <span>max {n.maxCandidatesPerCycle}/cycle</span>
                <span>last scout {n.lastScoutAt ? timeAgo(n.lastScoutAt) : "never"}</span>
                {n.status === "active" && n.nextScoutAt && (
                  <span className="text-sky-300">next {timeUntil(n.nextScoutAt)}</span>
                )}
                {n.nextPublishAt && (
                  <span className="text-signal">publish {fmtDateTime(n.nextPublishAt)}</span>
                )}
              </div>

              <div className="mt-3 border-t border-white/[0.05] pt-3">
                <SourceManager
                  nicheId={n.id}
                  sources={(sourcesByNiche.get(n.id) ?? []).map((s) => ({
                    id: s.id,
                    type: s.type,
                    name: s.name,
                    enabled: s.enabled,
                    lastStatus: s.lastStatus,
                    consecutiveFailures: s.consecutiveFailures,
                    lastError: s.lastError,
                  }))}
                />
              </div>

              <div className="mt-3 border-t border-white/[0.05] pt-3">
                <NicheActions id={n.id} status={n.status} />
              </div>
            </Panel>
          ))}
        </div>
      )}
    </div>
  );
}
