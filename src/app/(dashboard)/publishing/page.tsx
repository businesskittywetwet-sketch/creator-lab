import Link from "next/link";
import { AlertTriangle, ExternalLink, Film, Send } from "lucide-react";
import { getPublishAccounts, getPublishJobs, getYouTubeAccounts } from "@/lib/queries";
import { YouTubeConnect } from "@/components/youtube-controls";
import { oauthReadiness } from "@/lib/services/youtube/oauth";
import { platformConnectionSummary } from "@/lib/services/platforms";
import { fmtDateTime, timeAgo, timeUntil } from "@/lib/format";
import {
  ConnectionBadge,
  PublishJobActions,
  RefreshAccountsButton,
} from "@/components/publish-controls";
import {
  EmptyState,
  PageHeader,
  Panel,
  PanelHeader,
  PlatformMark,
  StatusBadge,
} from "@/components/ui";

export const dynamic = "force-dynamic";

const STATUS_TONE: Record<string, string> = {
  draft: "queued",
  ready: "queued",
  scheduled: "running",
  publishing: "running",
  published: "published",
  failed: "failed",
  cancelled: "idle",
};

export default async function PublishingPage() {
  const [jobs, accounts, ytAccounts] = await Promise.all([
    getPublishJobs(),
    getPublishAccounts(),
    getYouTubeAccounts(),
  ]);
  const ytReady = oauthReadiness();
  const platforms = platformConnectionSummary();
  const connectedCount = platforms.filter((p) => p.state === "connected").length;

  const counts = {
    ready: jobs.filter((j) => j.status === "ready" || j.status === "draft").length,
    scheduled: jobs.filter((j) => j.status === "scheduled").length,
    published: jobs.filter((j) => j.status === "published").length,
    failed: jobs.filter((j) => j.status === "failed").length,
  };

  return (
    <div className="space-y-6">
      <PageHeader
        eyebrow="Distribution"
        title="Publishing queue"
        description="Prepare, schedule and dispatch approved videos. Nothing is published unless a platform adapter confirms it."
        actions={<RefreshAccountsButton />}
      />

      {/* YouTube — first real publishing integration */}
      <Panel>
        <PanelHeader
          title="YouTube accounts"
          hint="OAuth-backed. Tokens are encrypted at rest and never exposed to the browser."
          action={
            <span
              className={`rounded-md border px-2 py-1 font-mono text-[10px] ${
                ytReady.ready
                  ? "border-signal/30 bg-signal/10 text-signal"
                  : "border-amber-400/30 bg-amber-400/10 text-amber-300"
              }`}
            >
              {ytReady.ready ? "OAUTH READY" : "OAUTH NOT CONFIGURED"}
            </span>
          }
        />
        <div className="grid grid-cols-1 gap-3 p-5 sm:grid-cols-2">
          {ytAccounts.map((a) => (
            <YouTubeConnect
              key={a.channelId}
              channelId={a.channelId}
              channelName={a.channelName}
              state={a.state}
              detail={a.detail}
              displayName={a.displayName}
              handle={a.handle}
              needsReconnect={a.needsReconnect}
              oauthReady={ytReady.ready}
            />
          ))}
          {ytAccounts.length === 0 && (
            <p className="text-xs text-zinc-600">No channels configured yet.</p>
          )}
        </div>
        {!ytReady.ready && (
          <p className="border-t border-white/[0.06] px-5 py-3 font-mono text-[10px] leading-relaxed text-amber-200/80">
            {ytReady.detail} Set YOUTUBE_CLIENT_ID, YOUTUBE_CLIENT_SECRET and TOKEN_ENCRYPTION_KEY to enable publishing.
          </p>
        )}
      </Panel>

      {/* platform connections */}
      <Panel>
        <PanelHeader
          title="Platform connections"
          hint="Credentials resolve from environment variables only — never stored in the database"
          action={
            <span className="rounded-md border border-white/10 bg-white/[0.03] px-2 py-1 font-mono text-[10px] text-zinc-400">
              {connectedCount}/{platforms.length} connected
            </span>
          }
        />
        <div className="grid grid-cols-1 gap-px overflow-hidden rounded-b-[1.25rem] bg-white/[0.04] sm:grid-cols-2 xl:grid-cols-4">
          {platforms.map((p) => (
            <div key={p.key} className="bg-[#0a0c12] px-4 py-4">
              <div className="flex items-center gap-2">
                <PlatformMark platform={p.key} />
                <p className="text-sm font-medium text-zinc-200">{p.label}</p>
              </div>
              <div className="mt-2">
                <ConnectionBadge state={p.state} />
              </div>
              <p className="mt-2 text-[11px] leading-relaxed text-zinc-500">{p.detail}</p>
              {p.missing.length > 0 && (
                <div className="mt-2 flex flex-wrap gap-1">
                  {p.missing.map((k) => (
                    <code
                      key={k}
                      className="rounded border border-white/[0.07] bg-black/30 px-1 py-0.5 font-mono text-[8.5px] text-zinc-500"
                    >
                      {k}
                    </code>
                  ))}
                </div>
              )}
              <a
                href={p.docsUrl}
                target="_blank"
                rel="noreferrer"
                className="mt-2 inline-flex items-center gap-1 font-mono text-[9px] uppercase tracking-[0.12em] text-zinc-600 hover:text-signal"
              >
                docs <ExternalLink className="size-2.5" />
              </a>
            </div>
          ))}
        </div>
      </Panel>

      {/* counts */}
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        {[
          { label: "Ready", value: counts.ready, tone: "text-zinc-200" },
          { label: "Scheduled", value: counts.scheduled, tone: "text-sky-300" },
          { label: "Published", value: counts.published, tone: "text-signal" },
          { label: "Failed", value: counts.failed, tone: "text-red-300" },
        ].map((c, i) => (
          <div key={c.label} className="panel p-4 animate-fade-up" style={{ animationDelay: `${i * 50}ms` }}>
            <p className="eyebrow">{c.label}</p>
            <p className={`mt-2 font-display text-2xl font-bold ${c.tone}`}>{c.value}</p>
          </div>
        ))}
      </div>

      {jobs.length === 0 ? (
        <EmptyState
          icon={Send}
          title="No publish jobs yet"
          body="Approve a draft in Production, then use “Prepare publish jobs” to stage it for each target platform."
          action={
            <Link
              href="/production"
              className="inline-flex items-center gap-2 rounded-lg bg-signal px-4 py-2 text-sm font-semibold text-black"
            >
              Open production
            </Link>
          }
        />
      ) : (
        <div className="space-y-3">
          {jobs.map((job, i) => (
            <Panel
              key={job.id}
              className="card-hover p-4 animate-fade-up"
              style={{ animationDelay: `${Math.min(i, 10) * 40}ms` }}
            >
              <div className="flex flex-wrap items-start gap-4">
                {/* thumbnail */}
                <div className="hidden h-20 w-14 shrink-0 overflow-hidden rounded-lg border border-white/[0.08] sm:block">
                  {job.thumbUrl ? (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img src={job.thumbUrl} alt="" className="size-full object-cover" />
                  ) : (
                    <div className="grid size-full place-items-center bg-white/[0.02]">
                      <Film className="size-4 text-zinc-700" />
                    </div>
                  )}
                </div>

                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center gap-2">
                    <PlatformMark platform={job.platform} />
                    <span className="size-1.5 rounded-full" style={{ background: job.channelColor }} />
                    <span className="font-mono text-[9px] uppercase tracking-[0.16em] text-zinc-500">
                      {job.channelName}
                    </span>
                    <StatusBadge status={STATUS_TONE[job.status] ?? "queued"} label={job.status} />
                    {job.attemptCount > 0 && (
                      <span className="font-mono text-[9px] text-zinc-600">
                        {job.attemptCount} attempt{job.attemptCount === 1 ? "" : "s"}
                      </span>
                    )}
                  </div>
                  <h3 className="clamp-2 mt-1.5 font-display text-[15px] font-semibold leading-snug text-white">
                    {job.title || job.contentTitle}
                  </h3>
                  <p className="mt-1 flex flex-wrap items-center gap-x-3 font-mono text-[10px] text-zinc-500">
                    {job.scheduledAt ? (
                      <span className="text-sky-300">
                        scheduled {fmtDateTime(job.scheduledAt)} ({timeUntil(job.scheduledAt)})
                      </span>
                    ) : (
                      <span>not scheduled</span>
                    )}
                    <span>· account {job.accountStatus ?? "none"}</span>
                    <span>· updated {timeAgo(job.updatedAt)}</span>
                  </p>

                  {job.uploadState !== "idle" && job.status !== "published" && (
                    <p className="mt-1.5 font-mono text-[10px] text-sky-300">
                      upload: {job.uploadState}
                      {job.uploadProgressBp > 0 ? ` · ${(job.uploadProgressBp / 100).toFixed(0)}%` : ""}
                    </p>
                  )}
                  {job.platformPostId && (
                    <p className="mt-1 font-mono text-[10px] text-zinc-500">
                      video id: <span className="text-zinc-300">{job.platformPostId}</span>
                      {job.thumbnailStatus !== "none" ? ` · thumbnail ${job.thumbnailStatus}` : ""}
                    </p>
                  )}
                  {job.platformUrl && (
                    <a
                      href={job.platformUrl}
                      target="_blank"
                      rel="noreferrer"
                      className="mt-1.5 inline-flex items-center gap-1 font-mono text-[10px] text-signal hover:underline"
                    >
                      {job.platformUrl} <ExternalLink className="size-2.5" />
                    </a>
                  )}

                  {job.blockedReasons.length > 0 && job.status !== "published" && (
                    <ul className="mt-2 space-y-1">
                      {job.blockedReasons.slice(0, 3).map((r, k) => (
                        <li
                          key={k}
                          className="flex items-start gap-1.5 font-mono text-[10px] leading-relaxed text-amber-200/80"
                        >
                          <AlertTriangle className="mt-0.5 size-3 shrink-0" />
                          {r}
                        </li>
                      ))}
                    </ul>
                  )}
                  {job.error && job.status === "failed" && (
                    <p className="mt-2 truncate rounded-md border border-red-400/20 bg-red-400/[0.06] px-2 py-1.5 font-mono text-[10px] text-red-300/80">
                      {job.error}
                    </p>
                  )}
                </div>

                <div className="flex shrink-0 flex-col items-end gap-2">
                  <PublishJobActions
                    jobId={job.id}
                    status={job.status}
                    scheduledAt={
                      job.scheduledAt ? new Date(job.scheduledAt).toISOString().slice(0, 16) : null
                    }
                  />
                  <Link
                    href={`/queue`}
                    className="font-mono text-[10px] uppercase tracking-[0.1em] text-zinc-600 hover:text-signal"
                  >
                    open draft →
                  </Link>
                </div>
              </div>
            </Panel>
          ))}
        </div>
      )}

      {accounts.length > 0 && (
        <Panel>
          <PanelHeader title="Publishing accounts" hint="Per-channel destinations and credential state" />
          <div className="divide-y divide-white/[0.05]">
            {accounts.map(({ a, channelName, channelColor }) => (
              <div key={a.id} className="flex flex-wrap items-center gap-3 px-5 py-3">
                <PlatformMark platform={a.platform} />
                <span className="size-1.5 rounded-full" style={{ background: channelColor ?? "#8b93a7" }} />
                <span className="text-xs text-zinc-300">{channelName}</span>
                <span className="font-mono text-[10px] text-zinc-600">{a.handle}</span>
                <span className="ml-auto">
                  <ConnectionBadge
                    state={
                      (a.status as "connected" | "not_connected" | "credentials_required" | "publishing_unavailable") ??
                      "not_connected"
                    }
                  />
                </span>
              </div>
            ))}
          </div>
        </Panel>
      )}
    </div>
  );
}
