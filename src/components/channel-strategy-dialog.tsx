"use client";

import { useActionState, useState } from "react";
import { CalendarClock, ShieldAlert } from "lucide-react";
import { saveChannelStrategyAction, type ActionState } from "@/app/actions";
import { SubmitButton } from "@/components/controls";
import { PLATFORM_DISPLAY as PLATFORMS } from "@/lib/platform-meta";
import ModalDialog from "@/components/modal-dialog";

export type StrategyDraft = {
  channelId: string;
  channelName: string;
  postsPerWeek: number;
  postingWindows: string[];
  timezone: string;
  platforms: string[];
  hashtagStrategy: string;
  defaultHashtags: string[];
  requireApproval: boolean;
  autoPublish: boolean;
  minQcScore: number;
};

const ZONES = [
  "UTC",
  "America/New_York",
  "America/Chicago",
  "America/Los_Angeles",
  "Europe/London",
  "Europe/Berlin",
  "Asia/Singapore",
  "Australia/Sydney",
];

export default function ChannelStrategyDialog({ strategy }: { strategy: StrategyDraft }) {
  const [open, setOpen] = useState(false);
  const [autoPublish, setAutoPublish] = useState(strategy.autoPublish);
  const [state, formAction] = useActionState<ActionState, FormData>(saveChannelStrategyAction, {
    ok: false,
  });
  // Close on a successful submit. Uses React's "adjust state during
  // render" pattern rather than a synchronous setState inside an effect,
  // which would trigger cascading renders.
  const [seenState, setSeenState] = useState(state);
  if (seenState !== state) {
    setSeenState(state);
    if (state.ok) setOpen(false);
  }

  return (
    <>
      <button
        onClick={() => setOpen(true)}
        title="Publishing strategy"
        className="grid size-8 place-items-center rounded-lg border border-white/[0.08] text-zinc-500 transition hover:border-signal/40 hover:text-signal"
      >
        <CalendarClock className="size-3.5" />
      </button>

      {open && (
        <ModalDialog
          eyebrow="Publishing strategy"
          title={strategy.channelName}
          onClose={() => setOpen(false)}
          footer={
            <div className="flex justify-end gap-2">
              <button type="button" onClick={() => setOpen(false)} className="rounded-lg border border-white/10 px-4 py-2 text-sm text-zinc-400 transition hover:text-white">Cancel</button>
              <SubmitButton form="channel-strategy-form" label="Save strategy" />
            </div>
          }
        >
            <form id="channel-strategy-form" action={formAction} className="grid grid-cols-1 gap-4 sm:grid-cols-2">
              <input type="hidden" name="channelId" value={strategy.channelId} />

              <div>
                <label className="label" htmlFor="s-freq">Posts per week</label>
                <input id="s-freq" name="postsPerWeek" type="number" min={1} max={50}
                  defaultValue={strategy.postsPerWeek} className="field" />
              </div>
              <div>
                <label className="label" htmlFor="s-tz">Timezone</label>
                <select id="s-tz" name="timezone" defaultValue={strategy.timezone} className="field">
                  {ZONES.map((z) => <option key={z} value={z}>{z}</option>)}
                </select>
              </div>
              <div className="sm:col-span-2">
                <label className="label" htmlFor="s-windows">Preferred posting windows (comma separated)</label>
                <input id="s-windows" name="postingWindows"
                  defaultValue={strategy.postingWindows.join(", ")} placeholder="09:00, 18:00" className="field" />
              </div>

              <div className="sm:col-span-2">
                <span className="label">Target platforms</span>
                <div className="flex flex-wrap gap-2 pt-1">
                  {PLATFORMS.map((p) => (
                    <label key={p.key} className="cursor-pointer">
                      <input type="checkbox" name="platforms" value={p.key}
                        defaultChecked={strategy.platforms.includes(p.key)} className="peer sr-only" />
                      <span className="rounded-md border border-white/10 px-2.5 py-1.5 font-mono text-[10px] uppercase tracking-[0.1em] text-zinc-500 transition peer-checked:border-signal/50 peer-checked:bg-signal/10 peer-checked:text-signal">
                        {p.short}
                      </span>
                    </label>
                  ))}
                </div>
              </div>

              <div className="sm:col-span-2">
                <label className="label" htmlFor="s-hashstrat">Hashtag strategy</label>
                <input id="s-hashstrat" name="hashtagStrategy"
                  defaultValue={strategy.hashtagStrategy} className="field" />
              </div>
              <div className="sm:col-span-2">
                <label className="label" htmlFor="s-tags">Default hashtags</label>
                <input id="s-tags" name="defaultHashtags"
                  defaultValue={strategy.defaultHashtags.join(" ")} placeholder="history weird archive" className="field" />
              </div>
              <div>
                <label className="label" htmlFor="s-qc">Minimum QC score to publish</label>
                <input id="s-qc" name="minQcScore" type="number" min={0} max={100}
                  defaultValue={strategy.minQcScore} className="field" />
              </div>

              <label className="flex cursor-pointer items-start gap-3 rounded-lg border border-white/[0.08] bg-white/[0.02] px-4 py-3 sm:col-span-2">
                <input type="checkbox" name="requireApproval" defaultChecked={strategy.requireApproval}
                  className="mt-0.5 size-4 accent-[#c6f135]" />
                <span>
                  <span className="block text-sm text-zinc-200">Require human approval before publishing</span>
                  <span className="block text-xs text-zinc-500">
                    Strongly recommended. Publish jobs cannot dispatch until the draft is approved.
                  </span>
                </span>
              </label>

              <label
                className={`flex cursor-pointer items-start gap-3 rounded-lg border px-4 py-3 sm:col-span-2 ${
                  autoPublish
                    ? "border-amber-400/40 bg-amber-400/[0.07]"
                    : "border-white/[0.08] bg-white/[0.02]"
                }`}
              >
                <input
                  type="checkbox"
                  name="autoPublish"
                  defaultChecked={strategy.autoPublish}
                  onChange={(e) => setAutoPublish(e.target.checked)}
                  className="mt-0.5 size-4 accent-[#fbbf24]"
                />
                <span>
                  <span className="flex items-center gap-1.5 text-sm text-zinc-200">
                    {autoPublish && <ShieldAlert className="size-3.5 text-amber-300" />}
                    Auto-publish scheduled posts
                  </span>
                  <span className="block text-xs text-zinc-500">
                    OFF by default. When enabled, due scheduled jobs dispatch automatically —
                    still subject to every preflight safety check.
                  </span>
                </span>
              </label>

              {state.error && (
                <p className="rounded-lg border border-red-400/30 bg-red-400/10 px-3 py-2 text-xs text-red-300 sm:col-span-2">
                  {state.error}
                </p>
              )}

            </form>
        </ModalDialog>
      )}
    </>
  );
}
