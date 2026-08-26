"use client";

import { useActionState, useState } from "react";
import { Pencil, Plus, X } from "lucide-react";
import { createChannel, updateChannel, type ActionState } from "@/app/actions";
import { PLATFORM_SHORT } from "@/components/ui";
import { SubmitButton } from "@/components/controls";

export type ChannelDraft = {
  id?: string;
  name: string;
  niche: string;
  description: string;
  contentStyle: string;
  targetAudience: string;
  postingFrequency: string;
  preferredLength: string;
  voiceTone: string;
  color: string;
  targetPlatforms: string[];
};

const COLORS = ["#C6F135", "#67E8F9", "#A78BFA", "#FBBF24", "#F87171", "#34D399"];
const PLATFORMS = ["youtube", "tiktok", "instagram", "x"];

export default function ChannelDialog({ channel }: { channel?: ChannelDraft }) {
  const [open, setOpen] = useState(false);
  const action = channel ? updateChannel : createChannel;
  const [state, formAction] = useActionState<ActionState, FormData>(action, { ok: false });
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
      {channel ? (
        <button
          onClick={() => setOpen(true)}
          title="Edit channel"
          className="grid size-8 place-items-center rounded-lg border border-white/[0.08] text-zinc-500 transition hover:border-signal/40 hover:text-signal"
        >
          <Pencil className="size-3.5" />
        </button>
      ) : (
        <button
          onClick={() => setOpen(true)}
          className="inline-flex items-center gap-2 rounded-lg bg-signal px-3.5 py-2 text-sm font-semibold text-black transition hover:brightness-110"
        >
          <Plus className="size-4" />
          New channel
        </button>
      )}

      {open && (
        <div className="fixed inset-0 z-[80] grid place-items-center p-4">
          <button
            aria-label="Close"
            onClick={() => setOpen(false)}
            className="absolute inset-0 bg-black/70 backdrop-blur-sm"
          />
          <div className="panel relative max-h-[90vh] w-full max-w-2xl overflow-y-auto rounded-2xl bg-[#0a0c12] p-6 shadow-2xl animate-fade-up">
            <div className="mb-5 flex items-start justify-between">
              <div>
                <p className="eyebrow mb-1.5">Channels</p>
                <h3 className="font-display text-lg font-bold text-white">
                  {channel ? "Edit channel" : "Create channel"}
                </h3>
              </div>
              <button
                onClick={() => setOpen(false)}
                className="grid size-8 place-items-center rounded-lg border border-white/[0.08] text-zinc-500 hover:text-white"
              >
                <X className="size-4" />
              </button>
            </div>

            <form action={formAction} className="grid grid-cols-1 gap-4 sm:grid-cols-2">
              {channel?.id && <input type="hidden" name="id" value={channel.id} />}

              <div>
                <label className="label" htmlFor="c-name">Channel name</label>
                <input id="c-name" name="name" required defaultValue={channel?.name} placeholder="Weird History" className="field" />
              </div>
              <div>
                <label className="label" htmlFor="c-niche">Niche</label>
                <input id="c-niche" name="niche" defaultValue={channel?.niche} placeholder="Bizarre & forgotten history" className="field" />
              </div>
              <div className="sm:col-span-2">
                <label className="label" htmlFor="c-desc">Description</label>
                <textarea id="c-desc" name="description" rows={2} defaultValue={channel?.description} placeholder="What this channel covers and why it wins…" className="field resize-none" />
              </div>
              <div>
                <label className="label" htmlFor="c-style">Content style</label>
                <input id="c-style" name="contentStyle" defaultValue={channel?.contentStyle} placeholder="Fast-cut archival, kinetic captions" className="field" />
              </div>
              <div>
                <label className="label" htmlFor="c-aud">Target audience</label>
                <input id="c-aud" name="targetAudience" defaultValue={channel?.targetAudience} placeholder="18–34, history-curious scrollers" className="field" />
              </div>
              <div>
                <label className="label" htmlFor="c-freq">Posting frequency</label>
                <input id="c-freq" name="postingFrequency" defaultValue={channel?.postingFrequency} placeholder="5 videos / week" className="field" />
              </div>
              <div>
                <label className="label" htmlFor="c-len">Preferred length</label>
                <input id="c-len" name="preferredLength" defaultValue={channel?.preferredLength} placeholder="45–60s · vertical" className="field" />
              </div>
              <div className="sm:col-span-2">
                <label className="label" htmlFor="c-voice">Voice / personality</label>
                <input id="c-voice" name="voiceTone" defaultValue={channel?.voiceTone} placeholder="Wry, deadpan narrator" className="field" />
              </div>

              <div>
                <span className="label">Brand color</span>
                <div className="flex flex-wrap gap-2 pt-1">
                  {COLORS.map((c) => (
                    <label key={c} className="cursor-pointer">
                      <input
                        type="radio"
                        name="color"
                        value={c}
                        defaultChecked={(channel?.color ?? COLORS[0]) === c}
                        className="peer sr-only"
                      />
                      <span
                        className="block size-7 rounded-full border-2 border-transparent transition peer-checked:border-white peer-checked:ring-2 peer-checked:ring-white/20"
                        style={{ background: c }}
                      />
                    </label>
                  ))}
                </div>
              </div>

              <div>
                <span className="label">Target platforms</span>
                <div className="flex flex-wrap gap-2 pt-1">
                  {PLATFORMS.map((p) => (
                    <label key={p} className="cursor-pointer">
                      <input
                        type="checkbox"
                        name="platforms"
                        value={p}
                        defaultChecked={channel ? channel.targetPlatforms.includes(p) : p !== "x"}
                        className="peer sr-only"
                      />
                      <span className="rounded-md border border-white/10 px-2.5 py-1.5 font-mono text-[10px] uppercase tracking-[0.1em] text-zinc-500 transition peer-checked:border-signal/50 peer-checked:bg-signal/10 peer-checked:text-signal">
                        {PLATFORM_SHORT[p]}
                      </span>
                    </label>
                  ))}
                </div>
              </div>

              {state.error && (
                <p className="sm:col-span-2 rounded-lg border border-red-400/30 bg-red-400/10 px-3 py-2 text-xs text-red-300">
                  {state.error}
                </p>
              )}

              <div className="flex justify-end gap-2 pt-2 sm:col-span-2">
                <button
                  type="button"
                  onClick={() => setOpen(false)}
                  className="rounded-lg border border-white/10 px-4 py-2 text-sm text-zinc-400 transition hover:text-white"
                >
                  Cancel
                </button>
                <SubmitButton label={channel ? "Save changes" : "Create channel"} />
              </div>
            </form>
          </div>
        </div>
      )}
    </>
  );
}
