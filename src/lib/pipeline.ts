/* ------------------------------------------------------------------ */
/*  Pipeline stage registry — shared by UI, engine and DB seeds        */
/* ------------------------------------------------------------------ */

export type StageKey =
  | "discovered"
  | "selected"
  | "researching"
  | "scripted"
  | "fact_check"
  | "production"
  | "qc"
  | "scheduled"
  | "published";

export type StageDef = {
  key: StageKey;
  label: string;
  short: string;
  description: string;
  /** tailwind text color class for accents */
  tone: string;
  /** hex for dots / charts */
  hex: string;
  agents: string[];
};

export const PIPELINE_STAGES: StageDef[] = [
  {
    key: "discovered",
    label: "Discovered",
    short: "Disc.",
    description: "Story surfaced by the scout network",
    tone: "text-zinc-300",
    hex: "#8b93a7",
    agents: ["story-scout"],
  },
  {
    key: "selected",
    label: "Selected",
    short: "Sel.",
    description: "Approved for production by the judge",
    tone: "text-sky-300",
    hex: "#7dd3fc",
    agents: ["story-judge"],
  },
  {
    key: "researching",
    label: "Researching",
    short: "Res.",
    description: "Sources being gathered and summarised",
    tone: "text-cyan-300",
    hex: "#22d3ee",
    agents: ["research-agent"],
  },
  {
    key: "scripted",
    label: "Scripted",
    short: "Scr.",
    description: "Draft script written and hooked",
    tone: "text-teal-300",
    hex: "#2dd4bf",
    agents: ["scriptwriter"],
  },
  {
    key: "fact_check",
    label: "Fact Checked",
    short: "Fact.",
    description: "Claims verified against sources",
    tone: "text-emerald-300",
    hex: "#34d399",
    agents: ["fact-checker"],
  },
  {
    key: "production",
    label: "Producing",
    short: "Prod.",
    description: "Voiceover, visuals and edit in flight",
    tone: "text-violet-300",
    hex: "#a78bfa",
    agents: ["video-director", "voice-agent", "visual-gen"],
  },
  {
    key: "qc",
    label: "Quality Check",
    short: "QC",
    description: "Retention, pacing and policy review",
    tone: "text-amber-300",
    hex: "#fbbf24",
    agents: ["qc-agent"],
  },
  {
    key: "scheduled",
    label: "Scheduled",
    short: "Schd.",
    description: "Queued for multi-platform release",
    tone: "text-orange-300",
    hex: "#fb923c",
    agents: ["publishing-agent"],
  },
  {
    key: "published",
    label: "Published",
    short: "Live",
    description: "Live and being tracked by analytics",
    tone: "text-signal",
    hex: "#c6f135",
    agents: ["publishing-agent", "analytics-agent"],
  },
];

export const STAGE_ORDER = PIPELINE_STAGES.map((s) => s.key);

export function stageDef(key: string): StageDef {
  return PIPELINE_STAGES.find((s) => s.key === key) ?? PIPELINE_STAGES[0];
}

export function stageIndex(key: string): number {
  const i = STAGE_ORDER.indexOf(key as StageKey);
  return i < 0 ? 0 : i;
}

export function nextStage(key: string): StageKey {
  return STAGE_ORDER[Math.min(stageIndex(key) + 1, STAGE_ORDER.length - 1)];
}

export function prevStage(key: string): StageKey {
  return STAGE_ORDER[Math.max(stageIndex(key) - 1, 0)];
}

/* ---------------------------- platforms --------------------------- */

export const PLATFORM_META: Record<
  string,
  { label: string; short: string; hex: string }
> = {
  youtube: { label: "YouTube Shorts", short: "YT", hex: "#ff5c5c" },
  tiktok: { label: "TikTok", short: "TT", hex: "#67e8f9" },
  instagram: { label: "Instagram Reels", short: "IG", hex: "#f0abfc" },
  x: { label: "X / Twitter", short: "X", hex: "#e4e4e7" },
};

export function platformLabel(key: string): string {
  return PLATFORM_META[key]?.label ?? key;
}

/* ------------------------- automation events ---------------------- */

export const AUTOMATION_TYPES: Record<string, string> = {
  story_discovery: "Story discovery sweep",
  story_evaluation: "Story evaluation batch",
  research: "Research compilation",
  script_generation: "Script generation",
  fact_check: "Fact-check pass",
  production: "Video production batch",
  qc_review: "Quality-control review",
  publishing: "Publishing dispatch",
  analytics_sync: "Analytics sync",
  pipeline_orchestration: "Pipeline orchestration",
};
