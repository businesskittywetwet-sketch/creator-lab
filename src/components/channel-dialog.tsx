"use client";
import { useActionState, useState, type ReactNode } from "react";
import { Pencil, Plus } from "lucide-react";
import { createChannel, updateChannel, type ActionState } from "@/app/actions";
import { PLATFORM_SHORT } from "@/components/ui";
import { WizardDialog } from "@/components/modal-dialog";

export type ChannelDraft = { id?: string; name: string; niche: string; description: string; contentStyle: string; targetAudience: string; postingFrequency: string; preferredLength: string; voiceTone: string; color: string; targetPlatforms: string[] };
const COLORS = ["#C6F135", "#67E8F9", "#A78BFA", "#FBBF24", "#F87171", "#34D399"];
const PLATFORMS = ["youtube", "tiktok", "instagram", "x"];
const STEPS = ["Name", "Niche", "Description", "Content style", "Audience", "Posting frequency", "Preferred length", "Voice", "Brand", "Review"];
const blank: ChannelDraft = { name: "", niche: "", description: "", contentStyle: "", targetAudience: "", postingFrequency: "", preferredLength: "", voiceTone: "", color: COLORS[0], targetPlatforms: ["youtube", "tiktok", "instagram"] };

export default function ChannelDialog({ channel }: { channel?: ChannelDraft }) {
  const [open, setOpen] = useState(false), [step, setStep] = useState(0), [draft, setDraft] = useState<ChannelDraft>(() => channel ?? blank);
  const [state, formAction] = useActionState<ActionState, FormData>(channel ? updateChannel : createChannel, { ok: false });
  const [seen, setSeen] = useState(state);
  if (seen !== state) { setSeen(state); if (state.ok) { setOpen(false); setStep(0); } }
  const set = <K extends keyof ChannelDraft>(key: K, value: ChannelDraft[K]) => setDraft((current) => ({ ...current, [key]: value }));
  const toggle = (value: string) => set("targetPlatforms", draft.targetPlatforms.includes(value) ? draft.targetPlatforms.filter((item) => item !== value) : [...draft.targetPlatforms, value]);
  const field = (label: string, value: keyof ChannelDraft, placeholder: string, textarea = false) => <Question label={label}>{textarea ? <textarea autoFocus value={draft[value] as string} onChange={(e) => set(value, e.target.value)} rows={4} className="field resize-none" placeholder={placeholder} /> : <input autoFocus value={draft[value] as string} onChange={(e) => set(value, e.target.value)} className="field" placeholder={placeholder} />}</Question>;
  return <>
    <button onClick={() => setOpen(true)} title={channel ? "Edit channel" : undefined} className={channel ? "grid size-8 place-items-center rounded-lg border border-white/[0.08] text-zinc-500" : "inline-flex items-center gap-2 rounded-lg bg-signal px-3.5 py-2 text-sm font-semibold text-black"}>{channel ? <Pencil className="size-3.5" /> : <><Plus className="size-4" /> New channel</>}</button>
    {open && <WizardDialog title={STEPS[step]} step={step} steps={STEPS} onClose={() => setOpen(false)} onBack={() => setStep((value) => value - 1)} onNext={() => setStep((value) => value + 1)} nextDisabled={step === 0 && !draft.name.trim()} formId="channel-form" submitLabel={channel ? "Save changes" : "Create channel"}>
      <form id="channel-form" action={formAction}>
        {channel?.id && <input type="hidden" name="id" value={channel.id} />}
        {Object.entries(draft).filter(([key]) => key !== "id" && key !== "targetPlatforms").map(([key, value]) => <input key={key} type="hidden" name={key} value={String(value)} />)}
        {draft.targetPlatforms.map((value) => <input key={value} type="hidden" name="platforms" value={value} />)}
        {step === 0 && <Question label="What is this channel called?" hint="Choose a clear, memorable name."><input autoFocus required value={draft.name} onChange={(e) => set("name", e.target.value)} className="field" placeholder="Weird History" /></Question>}
        {step === 1 && field("What niche does it cover?", "niche", "Bizarre & forgotten history")}
        {step === 2 && field("What does this channel cover?", "description", "What this channel covers and why it wins…", true)}
        {step === 3 && field("What is its content style?", "contentStyle", "Fast-cut archival, kinetic captions")}
        {step === 4 && field("Who is it for?", "targetAudience", "18–34, history-curious scrollers")}
        {step === 5 && field("How often will it post?", "postingFrequency", "5 videos / week")}
        {step === 6 && field("What is the preferred length?", "preferredLength", "45–60s · vertical")}
        {step === 7 && field("What is its voice or personality?", "voiceTone", "Wry, deadpan narrator")}
        {step === 8 && <Question label="Choose its brand and platforms"><div className="flex flex-wrap gap-3">{COLORS.map((color) => <button key={color} type="button" aria-label={color} onClick={() => set("color", color)} className={`size-10 rounded-full border-2 ${draft.color === color ? "border-white ring-2 ring-white/30" : "border-transparent"}`} style={{ background: color }} />)}</div><p className="label mt-7">Platforms</p><div className="flex flex-wrap gap-2">{PLATFORMS.map((platform) => <button key={platform} type="button" onClick={() => toggle(platform)} className={`rounded-md border px-3 py-2 font-mono text-xs uppercase ${draft.targetPlatforms.includes(platform) ? "border-signal/50 bg-signal/10 text-signal" : "border-white/10 text-zinc-500"}`}>{PLATFORM_SHORT[platform]}</button>)}</div></Question>}
        {step === 9 && <Question label={channel ? "Ready to save?" : "Ready to create?"}><dl className="space-y-3 rounded-xl border border-white/10 bg-white/[0.03] p-4 text-sm"><div><dt className="eyebrow">Channel</dt><dd>{draft.name}</dd></div><div><dt className="eyebrow">Niche</dt><dd>{draft.niche || "Not specified"}</dd></div><div><dt className="eyebrow">Platforms</dt><dd>{draft.targetPlatforms.join(", ") || "YouTube"}</dd></div></dl>{state.error && <p className="mt-4 text-sm text-red-300">{state.error}</p>}</Question>}
      </form>
    </WizardDialog>}
  </>;
}
function Question({ label, hint, children }: { label: string; hint?: string; children: ReactNode }) { return <div className="space-y-3"><h4 className="text-lg font-semibold text-white">{label}</h4>{hint && <p className="text-sm text-zinc-500">{hint}</p>}{children}</div>; }
