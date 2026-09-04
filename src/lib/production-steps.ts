/* ------------------------------------------------------------------ */
/*  Production step registry — shared by engine, UI and DB seeds.      */
/*  Mirrors the pipeline.ts pattern used by the discovery stages.      */
/* ------------------------------------------------------------------ */

export type ProductionStepKey =
  | "research"
  | "fact_check"
  | "concept"
  | "script"
  | "visual_plan"
  | "visual_assets"
  | "narration"
  | "captions"
  | "assembly"
  | "quality_check"
  | "review";

export type ProductionStepDef = {
  key: ProductionStepKey;
  label: string;
  short: string;
  description: string;
  agentSlug: string;
  /** content.stage this step maps onto while running */
  contentStage: string;
  hex: string;
  /** steps that must always run — cannot be disabled per channel */
  mandatory: boolean;
};

export const PRODUCTION_STEPS: ProductionStepDef[] = [
  {
    key: "research",
    label: "Research",
    short: "RSCH",
    description: "Gather sourced facts, timeline and context for the story",
    agentSlug: "research-agent",
    contentStage: "researching",
    hex: "#22d3ee",
    mandatory: true,
  },
  {
    key: "fact_check",
    label: "Fact Check",
    short: "FACT",
    description: "Verify each claim and flag anything unsupported",
    agentSlug: "fact-checker",
    contentStage: "fact_check",
    hex: "#34d399",
    mandatory: true,
  },
  {
    key: "concept",
    label: "Content Concept",
    short: "CNPT",
    description: "Lock the angle, working title and hook direction",
    agentSlug: "scriptwriter",
    contentStage: "scripted",
    hex: "#60a5fa",
    mandatory: true,
  },
  {
    key: "script",
    label: "Script",
    short: "SCRP",
    description: "Write the narration script to the channel's length and tone",
    agentSlug: "scriptwriter",
    contentStage: "scripted",
    hex: "#2dd4bf",
    mandatory: true,
  },
  {
    key: "visual_plan",
    label: "Visual Plan",
    short: "VIS",
    description: "Shot list, asset types and on-screen text per section",
    agentSlug: "visual-gen",
    contentStage: "production",
    hex: "#a78bfa",
    mandatory: false,
  },
  {
    key: "visual_assets",
    label: "Visual Assets",
    short: "ASST",
    description: "Render or generate the actual image asset for each scene",
    agentSlug: "visual-gen",
    contentStage: "production",
    hex: "#c084fc",
    mandatory: false,
  },
  {
    key: "narration",
    label: "Voice / Narration",
    short: "VOX",
    description: "Synthesize the narration audio track for the script",
    agentSlug: "voice-agent",
    contentStage: "production",
    hex: "#f0abfc",
    mandatory: false,
  },
  {
    key: "captions",
    label: "Captions",
    short: "CAP",
    description: "Timed caption cues (SRT/VTT) synced to the narration",
    agentSlug: "scriptwriter",
    contentStage: "production",
    hex: "#38bdf8",
    mandatory: false,
  },
  {
    key: "assembly",
    label: "Video Assembly",
    short: "ASMB",
    description: "Render the playable video from assets, audio and captions",
    agentSlug: "video-director",
    contentStage: "production",
    hex: "#fb923c",
    mandatory: false,
  },
  {
    key: "quality_check",
    label: "Quality Check",
    short: "QC",
    description: "Score retention, accuracy, pacing and policy compliance",
    agentSlug: "qc-agent",
    contentStage: "qc",
    hex: "#fbbf24",
    mandatory: true,
  },
  {
    key: "review",
    label: "Review",
    short: "RVW",
    description: "Human sign-off gate — draft waits here for approval",
    agentSlug: "qc-agent",
    contentStage: "qc",
    hex: "#c6f135",
    mandatory: true,
  },
];

export const PRODUCTION_STEP_ORDER = PRODUCTION_STEPS.map((s) => s.key);

export const DEFAULT_REQUIRED_STEPS: string[] = PRODUCTION_STEPS.map((s) => s.key);

export function productionStepDef(key: string): ProductionStepDef {
  return PRODUCTION_STEPS.find((s) => s.key === key) ?? PRODUCTION_STEPS[0];
}

export function productionStepIndex(key: string): number {
  const i = PRODUCTION_STEP_ORDER.indexOf(key as ProductionStepKey);
  return i < 0 ? 0 : i;
}

/** Steps that will actually execute for a channel configuration. */
export function activeSteps(requiredSteps: string[]): ProductionStepDef[] {
  const set = new Set(requiredSteps.length ? requiredSteps : DEFAULT_REQUIRED_STEPS);
  return PRODUCTION_STEPS.filter((s) => s.mandatory || set.has(s.key));
}

export const JOB_STATUS_LABELS: Record<string, string> = {
  queued: "Queued",
  running: "Running",
  awaiting_review: "Awaiting review",
  completed: "Completed",
  failed: "Failed",
  cancelled: "Cancelled",
};
