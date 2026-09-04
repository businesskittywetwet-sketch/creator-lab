"use client";

import { useState, useTransition } from "react";
import Link from "next/link";
import {
  CheckCircle2,
  ImageIcon,
  Link2Off,
  Loader2,
  RefreshCcw,
  ShieldAlert,
  Sparkles,
  Video as Youtube,
} from "lucide-react";
import {
  disconnectYouTubeAction,
  generateThumbnailAction,
  generateYouTubeMetadataAction,
  refreshYouTubeAnalyticsAction,
  saveYouTubeSettingsAction,
  selectThumbnailAction,
} from "@/app/actions";

const CATEGORIES = [
  { id: "24", label: "Entertainment" },
  { id: "27", label: "Education" },
  { id: "22", label: "People & Blogs" },
  { id: "25", label: "News & Politics" },
  { id: "28", label: "Science & Technology" },
];

function Msg({ text, tone = "warn" }: { text: string | null; tone?: "warn" | "ok" }) {
  if (!text) return null;
  return (
    <p
      className={`mt-2 flex items-start gap-1.5 rounded-md border px-2 py-1.5 font-mono text-[10px] leading-relaxed ${
        tone === "ok"
          ? "border-signal/30 bg-signal/[0.07] text-signal"
          : "border-amber-400/25 bg-amber-400/[0.07] text-amber-200/90"
      }`}
    >
      {tone === "ok" ? (
        <CheckCircle2 className="mt-0.5 size-3 shrink-0" />
      ) : (
        <ShieldAlert className="mt-0.5 size-3 shrink-0" />
      )}
      {text}
    </p>
  );
}

/* --------------------------- connection ---------------------------- */

export function YouTubeConnect({
  channelId,
  channelName,
  state,
  detail,
  displayName,
  handle,
  needsReconnect,
  oauthReady,
}: {
  channelId: string;
  channelName: string;
  state: string;
  detail: string;
  displayName: string;
  handle: string;
  needsReconnect: boolean;
  oauthReady: boolean;
}) {
  const [pending, start] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const connected = state === "connected";

  return (
    <div className="rounded-xl border border-white/[0.06] bg-white/[0.02] p-4">
      <div className="flex flex-wrap items-center gap-2">
        <Youtube className="size-4 text-[#ff5c5c]" />
        <p className="text-sm font-medium text-zinc-200">{channelName}</p>
        <span
          className={`rounded border px-1.5 py-0.5 font-mono text-[9px] uppercase tracking-[0.08em] ${
            connected
              ? "border-signal/40 bg-signal/10 text-signal"
              : needsReconnect
                ? "border-red-400/40 bg-red-400/10 text-red-300"
                : "border-white/10 bg-white/[0.03] text-zinc-500"
          }`}
        >
          {connected ? "CONNECTED" : needsReconnect ? "RECONNECT REQUIRED" : "NOT CONNECTED"}
        </span>
      </div>

      {connected && (
        <p className="mt-1.5 font-mono text-[10px] text-zinc-500">
          {displayName}
          {handle ? ` · ${handle}` : ""}
        </p>
      )}
      {!connected && <p className="mt-1.5 text-[11px] leading-relaxed text-zinc-500">{detail}</p>}

      <div className="mt-3 flex flex-wrap gap-2">
        {oauthReady ? (
          <Link
            href={`/api/oauth/youtube/start?channelId=${channelId}&redirectTo=/publishing`}
            className={`inline-flex items-center gap-1.5 rounded-md border px-2.5 py-1.5 font-mono text-[10px] uppercase tracking-[0.08em] transition ${
              needsReconnect
                ? "border-red-400/40 bg-red-400/10 text-red-300 hover:bg-red-400/20"
                : "border-signal/30 bg-signal/10 text-signal hover:bg-signal/20"
            }`}
          >
            <Youtube className="size-3" />
            {connected ? "Reconnect" : needsReconnect ? "Reconnect now" : "Connect YouTube"}
          </Link>
        ) : (
          <span className="rounded-md border border-white/10 px-2.5 py-1.5 font-mono text-[10px] uppercase tracking-[0.08em] text-zinc-600">
            OAuth not configured
          </span>
        )}
        {(connected || needsReconnect) && (
          <button
            disabled={pending}
            onClick={() =>
              start(async () => {
                setError(null);
                const r = await disconnectYouTubeAction(channelId);
                if (!r.ok) setError(r.error ?? "Disconnect failed");
              })
            }
            className="inline-flex items-center gap-1.5 rounded-md border border-white/10 px-2.5 py-1.5 font-mono text-[10px] uppercase tracking-[0.08em] text-zinc-400 transition hover:border-red-400/40 hover:text-red-300 disabled:opacity-50"
          >
            {pending ? <Loader2 className="size-3 animate-spin" /> : <Link2Off className="size-3" />}
            Disconnect
          </button>
        )}
      </div>
      <Msg text={error} />
    </div>
  );
}

/* ----------------------- publish config panel ---------------------- */

export type YtConfig = {
  jobId: string;
  title: string;
  description: string;
  tags: string[];
  categoryId: string;
  privacy: string;
  metadataMode: string;
  thumbnailUrl: string | null;
  thumbnailMode: string | null;
  candidates: { id: string; url: string; kind: string; sceneNumber: number | null }[];
};

export function YouTubePublishPanel({ config }: { config: YtConfig }) {
  const [pending, start] = useTransition();
  const [msg, setMsg] = useState<string | null>(null);
  const [ok, setOk] = useState(false);
  const [form, setForm] = useState({
    title: config.title,
    description: config.description,
    tags: config.tags.join(" "),
    categoryId: config.categoryId,
    privacy: config.privacy,
  });

  const set =
    (k: keyof typeof form) =>
    (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement>) =>
      setForm((f) => ({ ...f, [k]: e.target.value }));

  const isAi = config.metadataMode === "real_ai";

  return (
    <div className="space-y-4 p-5">
      <div className="flex flex-wrap items-center gap-2">
        <span
          className={`rounded border px-1.5 py-0.5 font-mono text-[9px] uppercase tracking-[0.08em] ${
            isAi
              ? "border-signal/40 bg-signal/10 text-signal"
              : "border-amber-400/40 bg-amber-400/10 text-amber-300"
          }`}
        >
          {isAi ? "AI generated metadata" : "Deterministic fallback metadata"}
        </span>
        <button
          disabled={pending}
          onClick={() =>
            start(async () => {
              setMsg(null);
              const r = await generateYouTubeMetadataAction(config.jobId);
              setOk(r.ok);
              setMsg(r.ok ? "Metadata regenerated." : (r.error ?? "Failed"));
            })
          }
          className="inline-flex items-center gap-1.5 rounded-md border border-white/10 px-2 py-1 font-mono text-[10px] uppercase tracking-[0.08em] text-zinc-400 transition hover:border-signal/40 hover:text-signal disabled:opacity-50"
        >
          {pending ? <Loader2 className="size-3 animate-spin" /> : <Sparkles className="size-3" />}
          Regenerate
        </button>
      </div>

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        <div className="sm:col-span-2">
          <label className="label" htmlFor="yt-title">
            YouTube title <span className="text-zinc-600">({form.title.length}/100)</span>
          </label>
          <input id="yt-title" value={form.title} onChange={set("title")} maxLength={100} className="field" />
        </div>
        <div className="sm:col-span-2">
          <label className="label" htmlFor="yt-desc">
            Description <span className="text-zinc-600">({form.description.length}/5000)</span>
          </label>
          <textarea
            id="yt-desc"
            rows={6}
            value={form.description}
            onChange={set("description")}
            maxLength={5000}
            className="field resize-y text-xs leading-relaxed"
          />
        </div>
        <div className="sm:col-span-2">
          <label className="label" htmlFor="yt-tags">Tags</label>
          <input id="yt-tags" value={form.tags} onChange={set("tags")} className="field" />
        </div>
        <div>
          <label className="label" htmlFor="yt-cat">Category</label>
          <select id="yt-cat" value={form.categoryId} onChange={set("categoryId")} className="field">
            {CATEGORIES.map((c) => (
              <option key={c.id} value={c.id}>{c.label}</option>
            ))}
          </select>
        </div>
        <div>
          <label className="label" htmlFor="yt-priv">Privacy</label>
          <select id="yt-priv" value={form.privacy} onChange={set("privacy")} className="field">
            <option value="private">Private</option>
            <option value="unlisted">Unlisted</option>
            <option value="public">Public</option>
          </select>
        </div>
      </div>

      {/* thumbnail */}
      <div className="rounded-xl border border-white/[0.06] bg-white/[0.02] p-4">
        <div className="flex flex-wrap items-center gap-2">
          <p className="eyebrow">Thumbnail</p>
          {config.thumbnailMode && (
            <span
              className={`rounded border px-1.5 py-0.5 font-mono text-[9px] uppercase ${
                config.thumbnailMode === "real_ai"
                  ? "border-signal/40 bg-signal/10 text-signal"
                  : "border-amber-400/40 bg-amber-400/10 text-amber-300"
              }`}
            >
              {config.thumbnailMode === "real_ai" ? "AI image" : "rendered locally"}
            </span>
          )}
          <button
            disabled={pending}
            onClick={() =>
              start(async () => {
                setMsg(null);
                const r = await generateThumbnailAction(config.jobId);
                setOk(r.ok);
                setMsg(r.ok ? "Thumbnail generated." : (r.error ?? "Failed"));
              })
            }
            className="ml-auto inline-flex items-center gap-1.5 rounded-md border border-white/10 px-2 py-1 font-mono text-[10px] uppercase tracking-[0.08em] text-zinc-400 transition hover:border-signal/40 hover:text-signal disabled:opacity-50"
          >
            {pending ? <Loader2 className="size-3 animate-spin" /> : <ImageIcon className="size-3" />}
            Generate 1280×720
          </button>
        </div>

        {config.thumbnailUrl ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={config.thumbnailUrl}
            alt="YouTube thumbnail preview"
            className="mt-3 w-full max-w-md rounded-lg border border-white/10"
          />
        ) : (
          <p className="mt-2 text-[11px] text-zinc-600">
            No thumbnail selected — YouTube will auto-pick a frame.
          </p>
        )}

        {config.candidates.length > 0 && (
          <>
            <p className="mt-3 font-mono text-[9px] uppercase tracking-[0.16em] text-zinc-600">
              Use an existing scene
            </p>
            <div className="mt-2 flex flex-wrap gap-2">
              {config.candidates.map((c) => (
                <button
                  key={c.id}
                  disabled={pending}
                  onClick={() =>
                    start(async () => {
                      setMsg(null);
                      const r = await selectThumbnailAction(config.jobId, c.id);
                      setOk(r.ok);
                      setMsg(r.ok ? "Thumbnail selected." : (r.error ?? "Failed"));
                    })
                  }
                  className="overflow-hidden rounded-md border border-white/[0.08] transition hover:border-signal/50 disabled:opacity-50"
                >
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img src={c.url} alt="" className="h-14 w-auto object-cover" />
                </button>
              ))}
            </div>
          </>
        )}
      </div>

      <Msg text={msg} tone={ok ? "ok" : "warn"} />

      <div className="flex justify-end">
        <button
          disabled={pending}
          onClick={() =>
            start(async () => {
              setMsg(null);
              const fd = new FormData();
              fd.set("title", form.title);
              fd.set("description", form.description);
              fd.set("tags", form.tags);
              fd.set("categoryId", form.categoryId);
              fd.set("privacy", form.privacy);
              const r = await saveYouTubeSettingsAction(config.jobId, fd);
              setOk(r.ok);
              setMsg(r.ok ? "YouTube settings saved." : (r.error ?? "Failed"));
            })
          }
          className="inline-flex items-center gap-2 rounded-lg bg-signal px-4 py-2 text-sm font-semibold text-black transition hover:brightness-110 disabled:opacity-60"
        >
          {pending ? <Loader2 className="size-3.5 animate-spin" /> : <CheckCircle2 className="size-3.5" />}
          Save YouTube settings
        </button>
      </div>
    </div>
  );
}

/* --------------------------- analytics ----------------------------- */

export function RefreshYouTubeAnalyticsButton() {
  const [pending, start] = useTransition();
  const [msg, setMsg] = useState<string | null>(null);
  const [ok, setOk] = useState(false);
  return (
    <div>
      <button
        onClick={() =>
          start(async () => {
            setMsg(null);
            const r = await refreshYouTubeAnalyticsAction();
            setOk(r.ok);
            setMsg(r.ok ? "YouTube metrics refreshed." : (r.error ?? "Refresh failed"));
          })
        }
        disabled={pending}
        className="inline-flex items-center gap-2 rounded-lg border border-[#ff5c5c]/40 bg-[#ff5c5c]/10 px-3.5 py-2 text-sm font-medium text-[#ff9a9a] transition hover:bg-[#ff5c5c]/20 disabled:opacity-60"
      >
        {pending ? <Loader2 className="size-3.5 animate-spin" /> : <RefreshCcw className="size-3.5" />}
        Refresh YouTube analytics
      </button>
      <Msg text={msg} tone={ok ? "ok" : "warn"} />
    </div>
  );
}
