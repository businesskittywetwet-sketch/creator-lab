"use client";

import { useState, useTransition } from "react";
import { History, Loader2, PencilLine, RotateCcw, Save } from "lucide-react";
import { restoreRevisionAction, saveDraftEditsAction } from "@/app/actions";

export type EditableDraft = {
  jobId: string;
  title: string;
  hook: string;
  scriptBody: string;
  cta: string;
  socialCaption: string;
  description: string;
  hashtags: string[];
  editedFields: string[];
  revision: number;
};

export type RevisionEntry = {
  id: string;
  revision: number;
  kind: string;
  targetStep: string;
  reason: string;
  changedFields: string[];
  createdAt: string;
  snapshot: Record<string, unknown>;
};

function EditedTag({ on }: { on: boolean }) {
  if (!on) return null;
  return (
    <span className="ml-2 rounded border border-sky-400/40 bg-sky-400/10 px-1 py-0.5 font-mono text-[8.5px] uppercase tracking-[0.1em] text-sky-300">
      human edited
    </span>
  );
}

export function DraftEditor({ draft }: { draft: EditableDraft }) {
  const [open, setOpen] = useState(false);
  const [pending, start] = useTransition();
  const [msg, setMsg] = useState<string | null>(null);
  const [form, setForm] = useState({
    title: draft.title,
    hook: draft.hook,
    scriptBody: draft.scriptBody,
    cta: draft.cta,
    socialCaption: draft.socialCaption,
    description: draft.description,
    hashtags: draft.hashtags.join(" "),
  });

  const set = (k: keyof typeof form) => (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) =>
    setForm((f) => ({ ...f, [k]: e.target.value }));

  const edited = new Set(draft.editedFields);

  if (!open) {
    return (
      <button
        onClick={() => setOpen(true)}
        className="inline-flex items-center gap-2 rounded-lg border border-white/10 bg-white/[0.03] px-3.5 py-2 text-sm text-zinc-300 transition hover:border-signal/40 hover:text-signal"
      >
        <PencilLine className="size-3.5" />
        Edit draft
      </button>
    );
  }

  return (
    <div className="panel p-5">
      <div className="mb-4 flex items-center justify-between">
        <div>
          <p className="eyebrow mb-1">Editing · revision v{draft.revision}</p>
          <h3 className="font-display text-sm font-bold text-white">Draft fields</h3>
          <p className="mt-1 text-xs text-zinc-500">
            Saving creates a new revision — previous content is never overwritten.
          </p>
        </div>
        <button
          onClick={() => setOpen(false)}
          className="rounded-lg border border-white/10 px-3 py-1.5 text-xs text-zinc-400 hover:text-white"
        >
          Close
        </button>
      </div>

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        <div className="sm:col-span-2">
          <label className="label" htmlFor="d-title">
            Title <EditedTag on={edited.has("title")} />
          </label>
          <input id="d-title" value={form.title} onChange={set("title")} className="field" />
        </div>
        <div className="sm:col-span-2">
          <label className="label" htmlFor="d-hook">
            Hook <EditedTag on={edited.has("hook")} />
          </label>
          <textarea id="d-hook" rows={2} value={form.hook} onChange={set("hook")} className="field resize-none" />
        </div>
        <div className="sm:col-span-2">
          <label className="label" htmlFor="d-script">
            Script <EditedTag on={edited.has("scriptBody")} />
          </label>
          <textarea
            id="d-script"
            rows={10}
            value={form.scriptBody}
            onChange={set("scriptBody")}
            className="field resize-y font-mono text-xs leading-relaxed"
          />
        </div>
        <div>
          <label className="label" htmlFor="d-cta">
            CTA <EditedTag on={edited.has("cta")} />
          </label>
          <input id="d-cta" value={form.cta} onChange={set("cta")} className="field" />
        </div>
        <div>
          <label className="label" htmlFor="d-tags">
            Hashtags <EditedTag on={edited.has("hashtags")} />
          </label>
          <input
            id="d-tags"
            value={form.hashtags}
            onChange={set("hashtags")}
            placeholder="history weird archive"
            className="field"
          />
        </div>
        <div className="sm:col-span-2">
          <label className="label" htmlFor="d-caption">
            Social caption <EditedTag on={edited.has("socialCaption")} />
          </label>
          <textarea
            id="d-caption"
            rows={3}
            value={form.socialCaption}
            onChange={set("socialCaption")}
            className="field resize-none"
          />
        </div>
        <div className="sm:col-span-2">
          <label className="label" htmlFor="d-desc">
            Description <EditedTag on={edited.has("description")} />
          </label>
          <textarea
            id="d-desc"
            rows={3}
            value={form.description}
            onChange={set("description")}
            className="field resize-none"
          />
        </div>
      </div>

      {msg && (
        <p className="mt-3 rounded-lg border border-white/10 bg-white/[0.03] px-3 py-2 text-xs text-zinc-300">
          {msg}
        </p>
      )}

      <div className="mt-4 flex justify-end gap-2">
        <button
          disabled={pending}
          onClick={() =>
            start(async () => {
              setMsg(null);
              const fd = new FormData();
              Object.entries(form).forEach(([k, v]) => fd.set(k, v));
              const r = await saveDraftEditsAction(draft.jobId, fd);
              setMsg(r.ok ? (r.error ?? "Saved as a new revision.") : (r.error ?? "Save failed"));
            })
          }
          className="inline-flex items-center gap-2 rounded-lg bg-signal px-4 py-2 text-sm font-semibold text-black transition hover:brightness-110 disabled:opacity-60"
        >
          {pending ? <Loader2 className="size-3.5 animate-spin" /> : <Save className="size-3.5" />}
          Save revision
        </button>
      </div>
    </div>
  );
}

export function RevisionList({
  jobId,
  revisions,
}: {
  jobId: string;
  revisions: RevisionEntry[];
}) {
  const [pending, start] = useTransition();
  const [preview, setPreview] = useState<RevisionEntry | null>(null);

  if (revisions.length === 0) {
    return (
      <p className="px-5 py-8 text-center text-xs text-zinc-600">
        No revisions yet. Edits and rewinds are recorded here.
      </p>
    );
  }

  return (
    <>
      <ul className="divide-y divide-white/[0.05]">
        {revisions.map((r) => (
          <li key={r.id} className="flex flex-wrap items-start gap-3 px-5 py-3">
            <span className="grid size-7 shrink-0 place-items-center rounded-md border border-white/10 font-mono text-[10px] text-zinc-300">
              v{r.revision}
            </span>
            <div className="min-w-0 flex-1">
              <p className="flex flex-wrap items-center gap-2 text-xs text-zinc-200">
                {r.reason}
                <span
                  className={`rounded border px-1 py-0.5 font-mono text-[8.5px] uppercase tracking-[0.1em] ${
                    r.kind === "manual_edit"
                      ? "border-sky-400/40 bg-sky-400/10 text-sky-300"
                      : r.kind === "restore"
                        ? "border-violet-400/40 bg-violet-400/10 text-violet-300"
                        : "border-amber-400/40 bg-amber-400/10 text-amber-300"
                  }`}
                >
                  {r.kind.replace("_", " ")}
                </span>
              </p>
              <p className="mt-0.5 font-mono text-[10px] text-zinc-600">
                {r.kind === "rewind" ? `rewound to ${r.targetStep}` : r.changedFields.join(", ") || "snapshot"} ·{" "}
                {new Date(r.createdAt).toLocaleString()}
              </p>
            </div>
            <div className="flex shrink-0 gap-1.5">
              <button
                onClick={() => setPreview(r)}
                className="rounded-md border border-white/10 px-2 py-1 font-mono text-[10px] uppercase tracking-[0.08em] text-zinc-400 hover:text-white"
              >
                <History className="mr-1 inline size-3" />
                Preview
              </button>
              <button
                disabled={pending}
                onClick={() => start(async () => { await restoreRevisionAction(jobId, r.id); })}
                className="rounded-md border border-signal/30 bg-signal/10 px-2 py-1 font-mono text-[10px] uppercase tracking-[0.08em] text-signal hover:bg-signal/20 disabled:opacity-50"
              >
                {pending ? <Loader2 className="mr-1 inline size-3 animate-spin" /> : <RotateCcw className="mr-1 inline size-3" />}
                Restore
              </button>
            </div>
          </li>
        ))}
      </ul>

      {preview && (
        <div className="fixed inset-0 z-[80] grid place-items-center p-4">
          <button
            aria-label="Close"
            onClick={() => setPreview(null)}
            className="absolute inset-0 bg-black/70 backdrop-blur-sm"
          />
          <div className="panel relative max-h-[80vh] w-full max-w-2xl overflow-y-auto rounded-2xl bg-[#0a0c12] p-5 shadow-2xl animate-fade-up">
            <div className="mb-3 flex items-center justify-between">
              <h3 className="font-display text-sm font-bold text-white">
                Revision v{preview.revision} snapshot
              </h3>
              <button
                onClick={() => setPreview(null)}
                className="rounded-lg border border-white/10 px-3 py-1 text-xs text-zinc-400 hover:text-white"
              >
                Close
              </button>
            </div>
            <dl className="space-y-3">
              {["title", "hook", "cta", "socialCaption", "description", "scriptBody"].map((k) => {
                const v = preview.snapshot[k];
                if (typeof v !== "string" || !v) return null;
                return (
                  <div key={k}>
                    <dt className="eyebrow mb-1">{k}</dt>
                    <dd className="whitespace-pre-wrap rounded-lg border border-white/[0.06] bg-white/[0.02] p-3 text-xs leading-relaxed text-zinc-300">
                      {v}
                    </dd>
                  </div>
                );
              })}
            </dl>
          </div>
        </div>
      )}
    </>
  );
}
