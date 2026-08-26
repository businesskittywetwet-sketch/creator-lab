"use client";

import { useActionState, useState } from "react";
import { SlidersHorizontal, X } from "lucide-react";
import { saveProductionSettings, type ActionState } from "@/app/actions";
import { SubmitButton } from "@/components/controls";
import { PRODUCTION_STEPS } from "@/lib/production-steps";

export type ProductionSettingsDraft = {
  channelId: string;
  channelName: string;
  format: string;
  targetDurationSec: number;
  scriptWordTarget: number;
  tone: string;
  hookStyle: string;
  ctaStyle: string;
  visualStyle: string;
  narrationVoice: string;
  researchDepth: number;
  sectionCount: number;
  requiredSteps: string[];
};

export default function ProductionSettingsDialog({
  settings,
}: {
  settings: ProductionSettingsDraft;
}) {
  const [open, setOpen] = useState(false);
  const [state, formAction] = useActionState<ActionState, FormData>(saveProductionSettings, {
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
        title="Production settings"
        className="grid size-8 place-items-center rounded-lg border border-white/[0.08] text-zinc-500 transition hover:border-signal/40 hover:text-signal"
      >
        <SlidersHorizontal className="size-3.5" />
      </button>

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
                <p className="eyebrow mb-1.5">Production settings</p>
                <h3 className="font-display text-lg font-bold text-white">
                  {settings.channelName}
                </h3>
                <p className="mt-1 text-xs text-zinc-500">
                  Controls how the production pipeline drafts content for this niche.
                </p>
              </div>
              <button
                onClick={() => setOpen(false)}
                className="grid size-8 place-items-center rounded-lg border border-white/[0.08] text-zinc-500 hover:text-white"
              >
                <X className="size-4" />
              </button>
            </div>

            <form action={formAction} className="grid grid-cols-1 gap-4 sm:grid-cols-2">
              <input type="hidden" name="channelId" value={settings.channelId} />

              <div>
                <label className="label" htmlFor="p-format">Format</label>
                <select id="p-format" name="format" defaultValue={settings.format} className="field">
                  {["Short", "Long-form", "Teaser"].map((f) => (
                    <option key={f} value={f}>{f}</option>
                  ))}
                </select>
              </div>
              <div>
                <label className="label" htmlFor="p-duration">Target duration (seconds)</label>
                <input
                  id="p-duration"
                  name="targetDurationSec"
                  type="number"
                  min={10}
                  max={3600}
                  defaultValue={settings.targetDurationSec}
                  className="field"
                />
              </div>
              <div>
                <label className="label" htmlFor="p-words">Script word target</label>
                <input
                  id="p-words"
                  name="scriptWordTarget"
                  type="number"
                  min={40}
                  max={4000}
                  defaultValue={settings.scriptWordTarget}
                  className="field"
                />
              </div>
              <div>
                <label className="label" htmlFor="p-sections">Script sections</label>
                <input
                  id="p-sections"
                  name="sectionCount"
                  type="number"
                  min={2}
                  max={8}
                  defaultValue={settings.sectionCount}
                  className="field"
                />
              </div>
              <div className="sm:col-span-2">
                <label className="label" htmlFor="p-tone">Tone</label>
                <input id="p-tone" name="tone" defaultValue={settings.tone} className="field" />
              </div>
              <div>
                <label className="label" htmlFor="p-hook">Hook style</label>
                <input id="p-hook" name="hookStyle" defaultValue={settings.hookStyle} className="field" />
              </div>
              <div>
                <label className="label" htmlFor="p-cta">Call to action</label>
                <input id="p-cta" name="ctaStyle" defaultValue={settings.ctaStyle} className="field" />
              </div>
              <div className="sm:col-span-2">
                <label className="label" htmlFor="p-visual">Visual style</label>
                <input id="p-visual" name="visualStyle" defaultValue={settings.visualStyle} className="field" />
              </div>
              <div>
                <label className="label" htmlFor="p-voice">Narration voice</label>
                <input id="p-voice" name="narrationVoice" defaultValue={settings.narrationVoice} className="field" />
              </div>
              <div>
                <label className="label" htmlFor="p-depth">Research depth (facts)</label>
                <input
                  id="p-depth"
                  name="researchDepth"
                  type="number"
                  min={2}
                  max={12}
                  defaultValue={settings.researchDepth}
                  className="field"
                />
              </div>

              <div className="sm:col-span-2">
                <span className="label">Required pipeline steps</span>
                <div className="flex flex-wrap gap-2 pt-1">
                  {PRODUCTION_STEPS.map((s) => (
                    <label key={s.key} className={s.mandatory ? "cursor-not-allowed" : "cursor-pointer"}>
                      <input
                        type="checkbox"
                        name="requiredSteps"
                        value={s.key}
                        disabled={s.mandatory}
                        defaultChecked={s.mandatory || settings.requiredSteps.includes(s.key)}
                        className="peer sr-only"
                      />
                      <span
                        title={s.mandatory ? "Mandatory step" : s.description}
                        className={`rounded-md border px-2.5 py-1.5 font-mono text-[10px] uppercase tracking-[0.08em] transition ${
                          s.mandatory
                            ? "border-white/10 bg-white/[0.04] text-zinc-500"
                            : "border-white/10 text-zinc-500 peer-checked:border-signal/50 peer-checked:bg-signal/10 peer-checked:text-signal"
                        }`}
                      >
                        {s.label}
                      </span>
                    </label>
                  ))}
                </div>
                <p className="mt-2 font-mono text-[10px] text-zinc-600">
                  Research, fact check, concept, script, QC and review are mandatory.
                </p>
              </div>

              {state.error && (
                <p className="rounded-lg border border-red-400/30 bg-red-400/10 px-3 py-2 text-xs text-red-300 sm:col-span-2">
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
                <SubmitButton label="Save production settings" />
              </div>
            </form>
          </div>
        </div>
      )}
    </>
  );
}
