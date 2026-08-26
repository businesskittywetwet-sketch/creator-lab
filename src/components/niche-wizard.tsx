"use client";

import { useActionState, useState } from "react";
import { ArrowLeft, ArrowRight, Check, Plus, Sparkles, Trash2, X } from "lucide-react";
import { createNicheAction, type ActionState } from "@/app/actions";
import { SubmitButton } from "@/components/controls";
import { PLATFORM_DISPLAY } from "@/lib/platform-meta";

/* Guided niche setup. Everything here is configuration — creating a
   niche never requires a code change. */

const STEPS = [
  "Identity",
  "Sources",
  "Scouting",
  "Story Judge",
  "Production",
  "Publishing",
  "Review",
];

const SOURCE_TYPES = [
  { key: "rss", label: "RSS feed", hint: "https://example.com/feed.xml" },
  { key: "googlenews", label: "Google News", hint: "search query" },
  { key: "reddit", label: "Reddit", hint: "subreddit name" },
  { key: "hackernews", label: "Hacker News", hint: "search query" },
  { key: "newsapi", label: "NewsAPI", hint: "search query (needs NEWS_API_KEY)" },
];

const WEIGHTS = [
  ["viralPotential", "Viral potential", 22],
  ["entertainmentValue", "Entertainment", 16],
  ["channelRelevance", "Niche relevance", 18],
  ["visualPotential", "Visual potential", 12],
  ["originality", "Originality", 12],
  ["evergreenPotential", "Evergreen", 10],
  ["sourceReliability", "Source reliability", 10],
] as const;

type DraftSource = { type: string; name: string; config: Record<string, unknown> };

export default function NicheWizard() {
  const [open, setOpen] = useState(false);
  const [step, setStep] = useState(0);
  const [sources, setSources] = useState<DraftSource[]>([]);
  const [srcType, setSrcType] = useState("rss");
  const [srcValue, setSrcValue] = useState("");
  const [name, setName] = useState("");
  const [state, formAction] = useActionState<ActionState, FormData>(createNicheAction, { ok: false });

  const [seen, setSeen] = useState(state);
  if (seen !== state) {
    setSeen(state);
    if (state.ok) {
      setOpen(false);
      setStep(0);
      setSources([]);
      setName("");
    }
  }

  function addSource() {
    const v = srcValue.trim();
    if (!v) return;
    const cfg: Record<string, unknown> =
      srcType === "rss" ? { feedUrl: v, limit: 12 }
      : srcType === "reddit" ? { subreddit: v, limit: 20, minScore: 50 }
      : srcType === "hackernews" ? { query: v, limit: 12, minPoints: 30 }
      : { query: v, limit: 12 };
    setSources((s) => [...s, { type: srcType, name: `${srcType} · ${v}`.slice(0, 70), config: cfg }]);
    setSrcValue("");
  }

  if (!open) {
    return (
      <button
        onClick={() => setOpen(true)}
        className="inline-flex items-center gap-2 rounded-lg bg-signal px-3.5 py-2 text-sm font-semibold text-black transition hover:brightness-110"
      >
        <Plus className="size-4" /> Create niche
      </button>
    );
  }

  const show = (i: number) => (step === i ? "block" : "hidden");

  return (
    <div className="fixed inset-0 z-[80] grid place-items-center p-4">
      <button aria-label="Close" onClick={() => setOpen(false)}
        className="absolute inset-0 bg-black/70 backdrop-blur-sm" />
      <div className="panel relative max-h-[92vh] w-full max-w-3xl overflow-y-auto rounded-2xl bg-[#0a0c12] p-6 shadow-2xl animate-fade-up">
        <div className="mb-5 flex items-start justify-between">
          <div>
            <p className="eyebrow mb-1.5">New niche · step {step + 1} of {STEPS.length}</p>
            <h3 className="font-display text-lg font-bold text-white">{STEPS[step]}</h3>
          </div>
          <button onClick={() => setOpen(false)}
            className="grid size-8 place-items-center rounded-lg border border-white/[0.08] text-zinc-500 hover:text-white">
            <X className="size-4" />
          </button>
        </div>

        {/* progress rail */}
        <div className="mb-6 flex gap-1">
          {STEPS.map((s, i) => (
            <div key={s} className="h-1 flex-1 rounded-full"
              style={{ background: i <= step ? "#c6f135" : "rgba(255,255,255,0.08)" }} />
          ))}
        </div>

        <form action={formAction} className="space-y-4">
          <input type="hidden" name="sources" value={JSON.stringify(sources)} />

          {/* 1 identity */}
          <div className={show(0)}>
            <div className="grid gap-4 sm:grid-cols-2">
              <div className="sm:col-span-2">
                <label className="label" htmlFor="n-name">Niche name</label>
                <input id="n-name" name="name" required value={name}
                  onChange={(e) => setName(e.target.value)}
                  placeholder="Sports Facts" className="field" />
              </div>
              <div className="sm:col-span-2">
                <label className="label" htmlFor="n-desc">Description</label>
                <textarea id="n-desc" name="description" rows={3}
                  placeholder="Short-form surprising sports history and records."
                  className="field resize-none" />
              </div>
              <div>
                <span className="label">Accent colour</span>
                <div className="flex flex-wrap gap-2 pt-1">
                  {["#C6F135", "#67E8F9", "#A78BFA", "#FBBF24", "#F87171", "#34D399"].map((c, i) => (
                    <label key={c} className="cursor-pointer">
                      <input type="radio" name="color" value={c} defaultChecked={i === 0} className="peer sr-only" />
                      <span className="block size-7 rounded-full border-2 border-transparent peer-checked:border-white"
                        style={{ background: c }} />
                    </label>
                  ))}
                </div>
              </div>
            </div>
          </div>

          {/* 2 sources */}
          <div className={show(1)}>
            <p className="mb-3 text-xs text-zinc-500">
              Sources are reusable configurations, not code. Add as many as you like — a failing
              source can never break a scout cycle.
            </p>
            <div className="flex flex-wrap gap-2">
              <select value={srcType} onChange={(e) => setSrcType(e.target.value)} className="field max-w-[170px]">
                {SOURCE_TYPES.map((t) => <option key={t.key} value={t.key}>{t.label}</option>)}
              </select>
              <input value={srcValue} onChange={(e) => setSrcValue(e.target.value)}
                placeholder={SOURCE_TYPES.find((t) => t.key === srcType)?.hint}
                className="field flex-1 min-w-[200px]" />
              <button type="button" onClick={addSource}
                className="rounded-lg border border-signal/40 bg-signal/10 px-3 py-2 text-sm text-signal">
                Add
              </button>
            </div>
            <ul className="mt-3 space-y-1.5">
              {sources.map((s, i) => (
                <li key={i} className="flex items-center gap-2 rounded-lg border border-white/[0.06] bg-white/[0.02] px-3 py-2">
                  <span className="rounded border border-white/10 px-1.5 py-0.5 font-mono text-[9px] uppercase text-zinc-400">
                    {s.type}
                  </span>
                  <span className="min-w-0 flex-1 truncate text-xs text-zinc-300">{s.name}</span>
                  <button type="button" onClick={() => setSources((x) => x.filter((_, k) => k !== i))}
                    className="text-zinc-600 hover:text-red-300">
                    <Trash2 className="size-3.5" />
                  </button>
                </li>
              ))}
              {sources.length === 0 && (
                <li className="py-3 text-center font-mono text-[10px] text-zinc-600">
                  No sources yet — you can add them later too.
                </li>
              )}
            </ul>
          </div>

          {/* 3 scouting */}
          <div className={show(2)}>
            <div className="grid gap-4 sm:grid-cols-2">
              <div>
                <label className="label" htmlFor="n-int">Scout interval (hours)</label>
                <input id="n-int" name="scoutIntervalHours" type="number" min={1} max={168} defaultValue={6} className="field" />
              </div>
              <div>
                <label className="label" htmlFor="n-max">Max candidates per cycle</label>
                <input id="n-max" name="maxCandidatesPerCycle" type="number" min={1} max={200} defaultValue={20} className="field" />
              </div>
              <div className="sm:col-span-2">
                <label className="label" htmlFor="n-kw">Required keywords (comma separated, optional)</label>
                <input id="n-kw" name="keywords" placeholder="record, first ever, unbeaten" className="field" />
              </div>
              <div className="sm:col-span-2">
                <label className="label" htmlFor="n-xkw">Excluded keywords</label>
                <input id="n-xkw" name="excludedKeywords" placeholder="betting, injury report" className="field" />
              </div>
            </div>
          </div>

          {/* 4 judge */}
          <div className={show(3)}>
            <p className="mb-3 text-xs text-zinc-500">
              Scoring weights and thresholds are per-niche. Nothing is hard-coded.
            </p>
            <div className="grid gap-3 sm:grid-cols-2">
              {WEIGHTS.map(([key, label, def]) => (
                <div key={key}>
                  <label className="label" htmlFor={`w-${key}`}>{label} weight</label>
                  <input id={`w-${key}`} name={`w_${key}`} type="number" min={0} max={100}
                    defaultValue={def} className="field" />
                </div>
              ))}
              <div>
                <label className="label" htmlFor="n-green">Minimum greenlight score</label>
                <input id="n-green" name="minGreenlightScore" type="number" min={0} max={100} defaultValue={72} className="field" />
              </div>
              <div>
                <label className="label" htmlFor="n-fresh">Freshness max age (hours)</label>
                <input id="n-fresh" name="freshnessMaxAgeHours" type="number" min={1} defaultValue={720} className="field" />
              </div>
              <div>
                <label className="label" htmlFor="n-rel">Minimum source reliability</label>
                <input id="n-rel" name="minSourceReliability" type="number" min={0} max={100} defaultValue={40} className="field" />
              </div>
              <div>
                <label className="label" htmlFor="n-dup">Duplicate sensitivity</label>
                <input id="n-dup" name="duplicateSensitivity" type="number" min={0} max={100} defaultValue={70} className="field" />
              </div>
            </div>
          </div>

          {/* 5 production */}
          <div className={show(4)}>
            <div className="grid gap-4 sm:grid-cols-2">
              <div>
                <label className="label" htmlFor="n-fmt">Format</label>
                <select id="n-fmt" name="format" defaultValue="Short" className="field">
                  <option>Short</option><option>Long-form</option><option>Teaser</option>
                </select>
              </div>
              <div>
                <label className="label" htmlFor="n-dur">Target duration (seconds)</label>
                <input id="n-dur" name="targetDurationSec" type="number" min={10} max={3600} defaultValue={55} className="field" />
              </div>
              <div>
                <label className="label" htmlFor="n-words">Script word target</label>
                <input id="n-words" name="scriptWordTarget" type="number" min={40} defaultValue={140} className="field" />
              </div>
              <div>
                <label className="label" htmlFor="n-sec">Script sections</label>
                <input id="n-sec" name="sectionCount" type="number" min={2} max={8} defaultValue={5} className="field" />
              </div>
              <div className="sm:col-span-2">
                <label className="label" htmlFor="n-tone">Tone</label>
                <input id="n-tone" name="tone" placeholder="Punchy, confident, factual" className="field" />
              </div>
              <div className="sm:col-span-2">
                <label className="label" htmlFor="n-vis">Visual style</label>
                <input id="n-vis" name="visualStyle" placeholder="Archival footage with kinetic captions" className="field" />
              </div>
            </div>
          </div>

          {/* 6 publishing */}
          <div className={show(5)}>
            <div className="grid gap-4 sm:grid-cols-2">
              <div className="sm:col-span-2">
                <span className="label">Platforms</span>
                <div className="flex flex-wrap gap-2 pt-1">
                  {PLATFORM_DISPLAY.map((p) => (
                    <label key={p.key} className="cursor-pointer">
                      <input type="checkbox" name="platforms" value={p.key}
                        defaultChecked={p.key === "youtube"} className="peer sr-only" />
                      <span className="rounded-md border border-white/10 px-2.5 py-1.5 font-mono text-[10px] uppercase text-zinc-500 peer-checked:border-signal/50 peer-checked:bg-signal/10 peer-checked:text-signal">
                        {p.short}
                      </span>
                    </label>
                  ))}
                </div>
              </div>
              <div>
                <label className="label" htmlFor="n-ppw">Posts per week</label>
                <input id="n-ppw" name="postsPerWeek" type="number" min={1} max={50} defaultValue={5} className="field" />
              </div>
              <div>
                <label className="label" htmlFor="n-tz">Timezone</label>
                <select id="n-tz" name="timezone" defaultValue="UTC" className="field">
                  {["UTC","America/New_York","America/Los_Angeles","Europe/London","Asia/Singapore"].map((z) =>
                    <option key={z} value={z}>{z}</option>)}
                </select>
              </div>
              <div>
                <label className="label" htmlFor="n-win">Posting windows</label>
                <input id="n-win" name="postingWindows" defaultValue="09:00, 18:00" className="field" />
              </div>
              <div>
                <label className="label" htmlFor="n-qc">Minimum QC score</label>
                <input id="n-qc" name="minQcScore" type="number" min={0} max={100} defaultValue={60} className="field" />
              </div>
              <div className="sm:col-span-2">
                <label className="label" htmlFor="n-tags">Default hashtags</label>
                <input id="n-tags" name="defaultHashtags" placeholder="sports, history, facts" className="field" />
              </div>
              <p className="sm:col-span-2 rounded-lg border border-signal/25 bg-signal/[0.06] px-3 py-2 font-mono text-[10px] text-signal">
                Approval is required and auto-publish stays OFF for new niches. Enable it later per niche.
              </p>
            </div>
          </div>

          {/* 7 review */}
          <div className={show(6)}>
            <div className="space-y-2 rounded-xl border border-white/[0.06] bg-white/[0.02] p-4">
              <p className="text-sm text-zinc-200">
                <span className="eyebrow mr-2">Niche</span>{name || "(unnamed)"}
              </p>
              <p className="text-xs text-zinc-500">
                <span className="eyebrow mr-2">Sources</span>
                {sources.length ? sources.map((s) => s.type).join(", ") : "none yet"}
              </p>
              <p className="text-xs text-zinc-500">
                Creating a niche provisions its scout config, judge rules, production profile and
                publishing profile. The shared engines are reused — no new code paths.
              </p>
            </div>
            {state.error && (
              <p className="mt-3 rounded-lg border border-red-400/30 bg-red-400/10 px-3 py-2 text-xs text-red-300">
                {state.error}
              </p>
            )}
          </div>

          {/* nav */}
          <div className="flex items-center justify-between border-t border-white/[0.06] pt-4">
            <button type="button" disabled={step === 0} onClick={() => setStep((s) => s - 1)}
              className="inline-flex items-center gap-1.5 rounded-lg border border-white/10 px-3 py-2 text-sm text-zinc-400 disabled:opacity-30">
              <ArrowLeft className="size-3.5" /> Back
            </button>
            {step < STEPS.length - 1 ? (
              <button type="button" onClick={() => setStep((s) => s + 1)}
                className="inline-flex items-center gap-1.5 rounded-lg border border-signal/40 bg-signal/10 px-3.5 py-2 text-sm text-signal">
                Next <ArrowRight className="size-3.5" />
              </button>
            ) : (
              <SubmitButton label="Create & activate niche" />
            )}
          </div>
        </form>

        <p className="mt-3 flex items-center gap-1.5 font-mono text-[10px] text-zinc-600">
          <Sparkles className="size-3" /> One scout engine + one production engine, driven entirely by this configuration.
          <Check className="size-3 text-signal" />
        </p>
      </div>
    </div>
  );
}
