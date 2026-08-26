import { sql } from "drizzle-orm";
import {
  boolean,
  index,
  integer,
  jsonb,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";

/* ------------------------------------------------------------------ */
/*  Channels — independent entertainment brands                        */
/* ------------------------------------------------------------------ */
export const channels = pgTable("channels", {
  id: uuid("id").primaryKey().defaultRandom(),
  slug: text("slug").notNull().unique(),
  name: text("name").notNull(),
  niche: text("niche").notNull().default(""),
  description: text("description").notNull().default(""),
  contentStyle: text("content_style").notNull().default(""),
  targetAudience: text("target_audience").notNull().default(""),
  postingFrequency: text("posting_frequency").notNull().default(""),
  preferredLength: text("preferred_length").notNull().default(""),
  voiceTone: text("voice_tone").notNull().default(""),
  targetPlatforms: jsonb("target_platforms")
    .$type<string[]>()
    .notNull()
    .default(sql`'[]'::jsonb`),
  color: text("color").notNull().default("#C6F135"),
  active: boolean("active").notNull().default(true),
  createdAt: timestamp("created_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
});

/* ------------------------------------------------------------------ */
/*  Stories — raw discovered entertainment stories                     */
/* ------------------------------------------------------------------ */
export const stories = pgTable(
  "stories",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    channelId: uuid("channel_id").references(() => channels.id, {
      onDelete: "cascade",
    }),
    title: text("title").notNull(),
    summary: text("summary").notNull().default(""),
    sourceName: text("source_name").notNull().default(""),
    sourceUrl: text("source_url").notNull().default(""),
    discoveredBy: text("discovered_by").notNull().default("story-scout"),
    score: integer("score").notNull().default(0),
    status: text("status").notNull().default("discovered"), // discovered | selected | rejected | used
    tags: jsonb("tags").$type<string[]>().notNull().default(sql`'[]'::jsonb`),
    sourceAdapter: text("source_adapter").notNull().default("seed"),
    dedupeKey: text("dedupe_key").unique(),
    signals: jsonb("signals")
      .$type<{ score?: number; comments?: number; rank?: number }>()
      .notNull()
      .default(sql`'{}'::jsonb`),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [
    index("stories_channel_idx").on(t.channelId),
    index("stories_status_idx").on(t.status),
  ],
);

/* ------------------------------------------------------------------ */
/*  Story sources — configurable discovery inputs for the scout        */
/* ------------------------------------------------------------------ */
export const storySources = pgTable("story_sources", {
  id: uuid("id").primaryKey().defaultRandom(),
  type: text("type").notNull(), // rss | googlenews | hackernews | reddit | newsapi
  name: text("name").notNull(),
  enabled: boolean("enabled").notNull().default(true),
  channelSlug: text("channel_slug"), // legacy hint, superseded by nicheId
  /** Phase 7: sources are reusable objects referenced by niches. */
  nicheId: uuid("niche_id"),
  config: jsonb("config")
    .$type<Record<string, unknown>>()
    .notNull()
    .default(sql`'{}'::jsonb`),
  reliability: integer("reliability").notNull().default(70),
  pollIntervalMinutes: integer("poll_interval_minutes").notNull().default(360),
  lastRunAt: timestamp("last_run_at", { withTimezone: true }),
  lastSuccessAt: timestamp("last_success_at", { withTimezone: true }),
  lastFailureAt: timestamp("last_failure_at", { withTimezone: true }),
  consecutiveFailures: integer("consecutive_failures").notNull().default(0),
  lastStatus: text("last_status").notNull().default("never"), // never | ok | error
  lastError: text("last_error"),
  createdAt: timestamp("created_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
});

/* ------------------------------------------------------------------ */
/*  Story evaluations — judge-agent scorecards (history per story)     */
/* ------------------------------------------------------------------ */
export const storyEvaluations = pgTable(
  "story_evaluations",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    storyId: uuid("story_id")
      .notNull()
      .references(() => stories.id, { onDelete: "cascade" }),
    provider: text("provider").notNull(), // openai | anthropic | heuristic
    model: text("model").notNull().default(""),
    viralPotential: integer("viral_potential").notNull().default(0),
    entertainmentValue: integer("entertainment_value").notNull().default(0),
    channelRelevance: integer("channel_relevance").notNull().default(0),
    visualPotential: integer("visual_potential").notNull().default(0),
    originality: integer("originality").notNull().default(0),
    evergreenPotential: integer("evergreen_potential").notNull().default(0),
    sourceReliability: integer("source_reliability").notNull().default(0),
    overall: integer("overall").notNull().default(0),
    recommendation: text("recommendation").notNull().default("review"), // greenlight | review | reject
    rationale: text("rationale").notNull().default(""),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [index("evaluations_story_idx").on(t.storyId, t.createdAt)],
);

/* ------------------------------------------------------------------ */
/*  Agent runs — audit trail for background workflows                  */
/* ------------------------------------------------------------------ */
export const agentRuns = pgTable(
  "agent_runs",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    agentSlug: text("agent_slug").notNull(),
    jobType: text("job_type").notNull(),
    status: text("status").notNull().default("running"), // running | success | failed
    trigger: text("trigger").notNull().default("schedule"), // schedule | manual | retry
    stats: jsonb("stats")
      .$type<Record<string, unknown>>()
      .notNull()
      .default(sql`'{}'::jsonb`),
    error: text("error"),
    startedAt: timestamp("started_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    finishedAt: timestamp("finished_at", { withTimezone: true }),
    durationMs: integer("duration_ms"),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [index("agent_runs_slug_idx").on(t.agentSlug, t.createdAt)],
);

/* ------------------------------------------------------------------ */
/*  Content — a story promoted into the production pipeline            */
/* ------------------------------------------------------------------ */
export const content = pgTable(
  "content",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    channelId: uuid("channel_id")
      .notNull()
      .references(() => channels.id, { onDelete: "cascade" }),
    storyId: uuid("story_id").references(() => stories.id, {
      onDelete: "set null",
    }),
    title: text("title").notNull(),
    format: text("format").notNull().default("Short"), // Short | Long-form | Teaser
    stage: text("stage").notNull().default("discovered"), // see PIPELINE_STAGES
    score: integer("score").notNull().default(0),
    hook: text("hook").notNull().default(""),
    durationSec: integer("duration_sec"),
    assignedAgents: jsonb("assigned_agents")
      .$type<string[]>()
      .notNull()
      .default(sql`'[]'::jsonb`),
    scheduledAt: timestamp("scheduled_at", { withTimezone: true }),
    publishedAt: timestamp("published_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [
    index("content_channel_idx").on(t.channelId),
    index("content_stage_idx").on(t.stage),
  ],
);

/* ------------------------------------------------------------------ */
/*  Channel production settings — per-niche production configuration   */
/* ------------------------------------------------------------------ */
export const channelProductionSettings = pgTable("channel_production_settings", {
  channelId: uuid("channel_id")
    .primaryKey()
    .references(() => channels.id, { onDelete: "cascade" }),
  format: text("format").notNull().default("Short"), // Short | Long-form | Teaser
  targetDurationSec: integer("target_duration_sec").notNull().default(55),
  scriptWordTarget: integer("script_word_target").notNull().default(140),
  tone: text("tone").notNull().default("Wry, deadpan narrator"),
  hookStyle: text("hook_style").notNull().default("cold-open shock fact"),
  ctaStyle: text("cta_style").notNull().default("Follow for more"),
  visualStyle: text("visual_style").notNull().default("Archival footage with kinetic captions"),
  narrationVoice: text("narration_voice").notNull().default("default"),
  researchDepth: integer("research_depth").notNull().default(4),
  sectionCount: integer("section_count").notNull().default(4),
  writingStyle: text("writing_style").notNull().default("Punchy, concrete, no filler"),
  pacing: text("pacing").notNull().default("fast"), // fast | measured | slow
  minWordCount: integer("min_word_count").notNull().default(90),
  maxWordCount: integer("max_word_count").notNull().default(200),
  language: text("language").notNull().default("en"),
  captionStyle: text("caption_style").notNull().default("bold-centered"),
  wordsPerCue: integer("words_per_cue").notNull().default(4),
  speakingRate: integer("speaking_rate").notNull().default(150), // wpm
  musicCue: text("music_cue").notNull().default(""),
  /** Which pipeline steps run for this channel; others are skipped. */
  requiredSteps: jsonb("required_steps")
    .$type<string[]>()
    .notNull()
    .default(sql`'[]'::jsonb`),
  updatedAt: timestamp("updated_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
});

/* ------------------------------------------------------------------ */
/*  Production jobs — one draft-production run per content item        */
/* ------------------------------------------------------------------ */
export const productionJobs = pgTable(
  "production_jobs",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    contentId: uuid("content_id")
      .notNull()
      .references(() => content.id, { onDelete: "cascade" }),
    channelId: uuid("channel_id")
      .notNull()
      .references(() => channels.id, { onDelete: "cascade" }),
    // queued | running | awaiting_review | completed | failed | cancelled
    status: text("status").notNull().default("queued"),
    currentStep: text("current_step").notNull().default("research"),
    completedSteps: integer("completed_steps").notNull().default(0),
    totalSteps: integer("total_steps").notNull().default(9),
    attempts: integer("attempts").notNull().default(0),
    maxAttempts: integer("max_attempts").notNull().default(3),
    provider: text("provider").notNull().default(""),
    lastError: text("last_error"),
    startedAt: timestamp("started_at", { withTimezone: true }),
    completedAt: timestamp("completed_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [
    // One production job per content item — enforced in the DB so
    // concurrent cron ticks can never create duplicates.
    uniqueIndex("production_jobs_content_unique").on(t.contentId),
    index("production_jobs_status_idx").on(t.status),
  ],
);

/* ------------------------------------------------------------------ */
/*  Production steps — per-stage execution record inside a job         */
/* ------------------------------------------------------------------ */
export const productionSteps = pgTable(
  "production_steps",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    jobId: uuid("job_id")
      .notNull()
      .references(() => productionJobs.id, { onDelete: "cascade" }),
    stepKey: text("step_key").notNull(),
    label: text("label").notNull().default(""),
    agentSlug: text("agent_slug").notNull().default(""),
    position: integer("position").notNull().default(0),
    // pending | running | success | failed | skipped
    status: text("status").notNull().default("pending"),
    attempts: integer("attempts").notNull().default(0),
    provider: text("provider").notNull().default(""),
    /** real_ai | fallback | human | failed — never conflate these */
    generationMode: text("generation_mode").notNull().default("pending"),
    input: jsonb("input")
      .$type<Record<string, unknown>>()
      .notNull()
      .default(sql`'{}'::jsonb`),
    output: jsonb("output")
      .$type<Record<string, unknown>>()
      .notNull()
      .default(sql`'{}'::jsonb`),
    error: text("error"),
    startedAt: timestamp("started_at", { withTimezone: true }),
    finishedAt: timestamp("finished_at", { withTimezone: true }),
    durationMs: integer("duration_ms"),
  },
  (t) => [index("production_steps_job_idx").on(t.jobId, t.position)],
);

/* ------------------------------------------------------------------ */
/*  Content drafts — the assembled deliverable produced by a job       */
/* ------------------------------------------------------------------ */
export type ScriptSection = {
  heading: string;
  narration: string;
  durationSec: number;
};
export type VisualShot = {
  section: string;
  description: string;
  assetType: string;
  overlayText: string;
};
export type QcFinding = { severity: string; note: string };

export const contentDrafts = pgTable(
  "content_drafts",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    contentId: uuid("content_id")
      .notNull()
      .references(() => content.id, { onDelete: "cascade" }),
    jobId: uuid("job_id").references(() => productionJobs.id, {
      onDelete: "cascade",
    }),
    version: integer("version").notNull().default(1),
    // in_progress | ready_for_review | approved | changes_requested
    status: text("status").notNull().default("in_progress"),
    concept: text("concept").notNull().default(""),
    angle: text("angle").notNull().default(""),
    hook: text("hook").notNull().default(""),
    title: text("title").notNull().default(""),
    scriptBody: text("script_body").notNull().default(""),
    cta: text("cta").notNull().default(""),
    sections: jsonb("sections")
      .$type<ScriptSection[]>()
      .notNull()
      .default(sql`'[]'::jsonb`),
    researchBrief: jsonb("research_brief")
      .$type<Record<string, unknown>>()
      .notNull()
      .default(sql`'{}'::jsonb`),
    factCheck: jsonb("fact_check")
      .$type<Record<string, unknown>>()
      .notNull()
      .default(sql`'{}'::jsonb`),
    visualPlan: jsonb("visual_plan")
      .$type<VisualShot[]>()
      .notNull()
      .default(sql`'[]'::jsonb`),
    narrationPlan: jsonb("narration_plan")
      .$type<Record<string, unknown>>()
      .notNull()
      .default(sql`'{}'::jsonb`),
    assemblyPlan: jsonb("assembly_plan")
      .$type<Record<string, unknown>>()
      .notNull()
      .default(sql`'{}'::jsonb`),
    qcReport: jsonb("qc_report")
      .$type<Record<string, unknown>>()
      .notNull()
      .default(sql`'{}'::jsonb`),
    wordCount: integer("word_count").notNull().default(0),
    estimatedDurationSec: integer("estimated_duration_sec").notNull().default(0),
    qcScore: integer("qc_score").notNull().default(0),
    reviewNotes: text("review_notes"),
    /** real_ai | fallback | mixed — surfaced in the UI on every draft */
    generationMode: text("generation_mode").notNull().default("pending"),
    provider: text("provider").notNull().default(""),
    concepts: jsonb("concepts")
      .$type<Record<string, unknown>[]>()
      .notNull()
      .default(sql`'[]'::jsonb`),
    captions: jsonb("captions")
      .$type<Record<string, unknown>>()
      .notNull()
      .default(sql`'{}'::jsonb`),
    videoUrl: text("video_url"),
    audioUrl: text("audio_url"),
    revision: integer("revision").notNull().default(0),
    /* --- operator-editable publishing metadata (Phase 5) --- */
    description: text("description").notNull().default(""),
    socialCaption: text("social_caption").notNull().default(""),
    hashtags: jsonb("hashtags").$type<string[]>().notNull().default(sql`'[]'::jsonb`),
    /** fields manually edited by a human, so regeneration can respect them */
    editedFields: jsonb("edited_fields")
      .$type<string[]>()
      .notNull()
      .default(sql`'[]'::jsonb`),
    /* --- platform metadata (Phase 6) --- */
    youtubeTitle: text("youtube_title").notNull().default(""),
    youtubeDescription: text("youtube_description").notNull().default(""),
    youtubeTags: jsonb("youtube_tags").$type<string[]>().notNull().default(sql`'[]'::jsonb`),
    youtubeCategoryId: text("youtube_category_id").notNull().default("24"),
    youtubePrivacy: text("youtube_privacy").notNull().default("private"),
    thumbnailAssetId: uuid("thumbnail_asset_id"),
    /** real_ai | fallback — provenance of the platform metadata */
    metadataMode: text("metadata_mode").notNull().default("pending"),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [
    index("content_drafts_content_idx").on(t.contentId, t.version),
    uniqueIndex("content_drafts_job_unique").on(t.jobId),
  ],
);

/* ------------------------------------------------------------------ */
/*  Production assets — generated images, audio, video, captions       */
/* ------------------------------------------------------------------ */
export const productionAssets = pgTable(
  "production_assets",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    jobId: uuid("job_id")
      .notNull()
      .references(() => productionJobs.id, { onDelete: "cascade" }),
    stepKey: text("step_key").notNull().default(""),
    kind: text("kind").notNull(), // image | audio | video | captions
    sceneNumber: integer("scene_number"),
    prompt: text("prompt").notNull().default(""),
    provider: text("provider").notNull().default(""),
    model: text("model").notNull().default(""),
    /** generated | unavailable | failed */
    status: text("status").notNull().default("generated"),
    url: text("url"),
    filePath: text("file_path"),
    mimeType: text("mime_type").notNull().default(""),
    bytes: integer("bytes"),
    durationSec: integer("duration_sec"),
    error: text("error"),
    metadata: jsonb("metadata")
      .$type<Record<string, unknown>>()
      .notNull()
      .default(sql`'{}'::jsonb`),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [
    index("production_assets_job_idx").on(t.jobId, t.kind),
    index("production_assets_scene_idx").on(t.jobId, t.sceneNumber),
  ],
);

/* ------------------------------------------------------------------ */
/*  AI usage — per-step provider/token/cost accounting                 */
/* ------------------------------------------------------------------ */
export const aiUsage = pgTable(
  "ai_usage",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    jobId: uuid("job_id").references(() => productionJobs.id, {
      onDelete: "cascade",
    }),
    stepKey: text("step_key").notNull().default(""),
    kind: text("kind").notNull().default("text"), // text | image | audio | video
    provider: text("provider").notNull().default(""),
    model: text("model").notNull().default(""),
    promptTokens: integer("prompt_tokens").notNull().default(0),
    completionTokens: integer("completion_tokens").notNull().default(0),
    generations: integer("generations").notNull().default(0),
    /** micro-USD (millionths) to avoid float drift */
    costMicroUsd: integer("cost_micro_usd").notNull().default(0),
    durationMs: integer("duration_ms").notNull().default(0),
    success: boolean("success").notNull().default(true),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [index("ai_usage_job_idx").on(t.jobId, t.createdAt)],
);

/* ------------------------------------------------------------------ */
/*  Draft revisions — immutable history of review-driven rewrites      */
/* ------------------------------------------------------------------ */
export const draftRevisions = pgTable(
  "draft_revisions",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    jobId: uuid("job_id")
      .notNull()
      .references(() => productionJobs.id, { onDelete: "cascade" }),
    revision: integer("revision").notNull().default(1),
    /** which step the revision rewinds to */
    targetStep: text("target_step").notNull().default("script"),
    /** rewind | manual_edit | restore */
    kind: text("kind").notNull().default("rewind"),
    changedFields: jsonb("changed_fields")
      .$type<string[]>()
      .notNull()
      .default(sql`'[]'::jsonb`),
    reason: text("reason").notNull().default(""),
    requestedBy: text("requested_by").notNull().default("operator"),
    /** full snapshot of the draft before the rewrite */
    snapshot: jsonb("snapshot")
      .$type<Record<string, unknown>>()
      .notNull()
      .default(sql`'{}'::jsonb`),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [index("draft_revisions_job_idx").on(t.jobId, t.revision)],
);

/* ------------------------------------------------------------------ */
/*  Channel strategy — per-niche publishing/posting strategy           */
/* ------------------------------------------------------------------ */
export const channelStrategy = pgTable("channel_strategy", {
  channelId: uuid("channel_id")
    .primaryKey()
    .references(() => channels.id, { onDelete: "cascade" }),
  postsPerWeek: integer("posts_per_week").notNull().default(5),
  /** ["09:00","17:30"] local to the channel timezone */
  postingWindows: jsonb("posting_windows")
    .$type<string[]>()
    .notNull()
    .default(sql`'["09:00","18:00"]'::jsonb`),
  timezone: text("timezone").notNull().default("UTC"),
  platforms: jsonb("platforms").$type<string[]>().notNull().default(sql`'[]'::jsonb`),
  hashtagStrategy: text("hashtag_strategy").notNull().default("3-5 niche tags, no generic spam"),
  defaultHashtags: jsonb("default_hashtags")
    .$type<string[]>()
    .notNull()
    .default(sql`'[]'::jsonb`),
  contentMix: jsonb("content_mix")
    .$type<Record<string, number>>()
    .notNull()
    .default(sql`'{}'::jsonb`),
  /** Human approval is required before anything can be published. */
  requireApproval: boolean("require_approval").notNull().default(true),
  /** Auto-publish is OFF by default and must be explicitly enabled. */
  autoPublish: boolean("auto_publish").notNull().default(false),
  minQcScore: integer("min_qc_score").notNull().default(60),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

/* ------------------------------------------------------------------ */
/*  Publish accounts — per-platform destinations.                      */
/*  NOTE: no raw secrets. Credentials resolve from environment vars    */
/*  via `credentialRef`; only non-sensitive identifiers live here.     */
/* ------------------------------------------------------------------ */
export const publishAccounts = pgTable(
  "publish_accounts",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    channelId: uuid("channel_id")
      .notNull()
      .references(() => channels.id, { onDelete: "cascade" }),
    platform: text("platform").notNull(), // youtube | tiktok | instagram | facebook
    displayName: text("display_name").notNull().default(""),
    handle: text("handle").notNull().default(""),
    externalAccountId: text("external_account_id").notNull().default(""),
    /** Name of the env var holding the token — never the token itself. */
    credentialRef: text("credential_ref").notNull().default(""),
    /** not_connected | credentials_required | connected | error | expired */
    status: text("status").notNull().default("not_connected"),
    lastCheckedAt: timestamp("last_checked_at", { withTimezone: true }),
    lastError: text("last_error"),
    enabled: boolean("enabled").notNull().default(true),
    /* --- OAuth (Phase 6). Tokens are AES-256-GCM encrypted at rest;
       the key lives only in TOKEN_ENCRYPTION_KEY, never in the DB. --- */
    encryptedTokens: text("encrypted_tokens"),
    tokenExpiresAt: timestamp("token_expires_at", { withTimezone: true }),
    scopes: jsonb("scopes").$type<string[]>().notNull().default(sql`'[]'::jsonb`),
    connectedAt: timestamp("connected_at", { withTimezone: true }),
    revokedAt: timestamp("revoked_at", { withTimezone: true }),
    lastRefreshAt: timestamp("last_refresh_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index("publish_accounts_channel_idx").on(t.channelId, t.platform),
    uniqueIndex("publish_accounts_unique").on(t.channelId, t.platform),
  ],
);

/* ------------------------------------------------------------------ */
/*  Publish jobs — one per (content, platform) distribution intent     */
/* ------------------------------------------------------------------ */
export const publishJobs = pgTable(
  "publish_jobs",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    contentId: uuid("content_id")
      .notNull()
      .references(() => content.id, { onDelete: "cascade" }),
    draftId: uuid("draft_id").references(() => contentDrafts.id, { onDelete: "set null" }),
    channelId: uuid("channel_id")
      .notNull()
      .references(() => channels.id, { onDelete: "cascade" }),
    accountId: uuid("account_id").references(() => publishAccounts.id, {
      onDelete: "set null",
    }),
    platform: text("platform").notNull(),
    videoAssetId: uuid("video_asset_id").references(() => productionAssets.id, {
      onDelete: "set null",
    }),
    title: text("title").notNull().default(""),
    description: text("description").notNull().default(""),
    caption: text("caption").notNull().default(""),
    hashtags: jsonb("hashtags").$type<string[]>().notNull().default(sql`'[]'::jsonb`),
    /** draft | ready | scheduled | publishing | published | failed | cancelled */
    status: text("status").notNull().default("draft"),
    scheduledAt: timestamp("scheduled_at", { withTimezone: true }),
    publishedAt: timestamp("published_at", { withTimezone: true }),
    platformPostId: text("platform_post_id"),
    platformUrl: text("platform_url"),
    error: text("error"),
    attemptCount: integer("attempt_count").notNull().default(0),
    blockedReasons: jsonb("blocked_reasons")
      .$type<string[]>()
      .notNull()
      .default(sql`'[]'::jsonb`),
    /* --- upload lifecycle (Phase 6) --- */
    /** idle | initiating | uploading | processing | complete | failed */
    uploadState: text("upload_state").notNull().default("idle"),
    uploadProgressBp: integer("upload_progress_bp").notNull().default(0),
    /** resumable session URI — allows a retry to continue, not restart */
    uploadSessionUrl: text("upload_session_url"),
    /** stable key so a retry can never create a second remote video */
    idempotencyKey: text("idempotency_key"),
    privacyStatus: text("privacy_status").notNull().default("private"),
    categoryId: text("category_id").notNull().default("24"),
    thumbnailAssetId: uuid("thumbnail_asset_id"),
    thumbnailStatus: text("thumbnail_status").notNull().default("none"),
    thumbnailError: text("thumbnail_error"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index("publish_jobs_status_idx").on(t.status, t.scheduledAt),
    index("publish_jobs_content_idx").on(t.contentId),
    uniqueIndex("publish_jobs_unique_target").on(t.contentId, t.platform),
  ],
);

/* ------------------------------------------------------------------ */
/*  Publish attempts — immutable audit trail of every dispatch         */
/* ------------------------------------------------------------------ */
export const publishAttempts = pgTable(
  "publish_attempts",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    jobId: uuid("job_id")
      .notNull()
      .references(() => publishJobs.id, { onDelete: "cascade" }),
    attempt: integer("attempt").notNull().default(1),
    /** success | failed | blocked */
    outcome: text("outcome").notNull(),
    platform: text("platform").notNull().default(""),
    adapter: text("adapter").notNull().default(""),
    requestSummary: jsonb("request_summary")
      .$type<Record<string, unknown>>()
      .notNull()
      .default(sql`'{}'::jsonb`),
    responseSummary: jsonb("response_summary")
      .$type<Record<string, unknown>>()
      .notNull()
      .default(sql`'{}'::jsonb`),
    error: text("error"),
    durationMs: integer("duration_ms"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index("publish_attempts_job_idx").on(t.jobId, t.attempt)],
);

/* ------------------------------------------------------------------ */
/*  Published posts — confirmed live posts (platform-acknowledged)     */
/* ------------------------------------------------------------------ */
export const publishedPosts = pgTable(
  "published_posts",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    jobId: uuid("job_id").references(() => publishJobs.id, { onDelete: "set null" }),
    contentId: uuid("content_id")
      .notNull()
      .references(() => content.id, { onDelete: "cascade" }),
    channelId: uuid("channel_id")
      .notNull()
      .references(() => channels.id, { onDelete: "cascade" }),
    platform: text("platform").notNull(),
    platformPostId: text("platform_post_id").notNull(),
    platformUrl: text("platform_url").notNull().default(""),
    title: text("title").notNull().default(""),
    publishedAt: timestamp("published_at", { withTimezone: true }).notNull().defaultNow(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index("published_posts_content_idx").on(t.contentId),
    uniqueIndex("published_posts_unique").on(t.platform, t.platformPostId),
  ],
);

/* ------------------------------------------------------------------ */
/*  Post metrics — time-series performance snapshots per post          */
/* ------------------------------------------------------------------ */
export const postMetrics = pgTable(
  "post_metrics",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    postId: uuid("post_id").references(() => publishedPosts.id, { onDelete: "cascade" }),
    contentId: uuid("content_id").references(() => content.id, { onDelete: "cascade" }),
    channelId: uuid("channel_id").references(() => channels.id, { onDelete: "cascade" }),
    platform: text("platform").notNull(),
    platformPostId: text("platform_post_id").notNull().default(""),
    measuredAt: timestamp("measured_at", { withTimezone: true }).notNull().defaultNow(),
    source: text("source").notNull().default("platform_api"),
    views: integer("views"),
    likes: integer("likes"),
    comments: integer("comments"),
    shares: integer("shares"),
    saves: integer("saves"),
    watchTimeSec: integer("watch_time_sec"),
    avgViewDurationSec: integer("avg_view_duration_sec"),
    completionRateBp: integer("completion_rate_bp"), // basis points (0-10000)
    followersGained: integer("followers_gained"),
    followersLost: integer("followers_lost"),
    avgViewPercentageBp: integer("avg_view_percentage_bp"),
    impressions: integer("impressions"),
    ctrBp: integer("ctr_bp"), // basis points
    raw: jsonb("raw").$type<Record<string, unknown>>().notNull().default(sql`'{}'::jsonb`),
  },
  (t) => [
    index("post_metrics_post_idx").on(t.postId, t.measuredAt),
    index("post_metrics_content_idx").on(t.contentId, t.measuredAt),
    // One snapshot per post per measurement instant — prevents duplicate
    // analytics rows while preserving full history.
    uniqueIndex("post_metrics_snapshot_unique").on(t.platform, t.platformPostId, t.measuredAt),
  ],
);

/* ------------------------------------------------------------------ */
/*  Performance signals — transparent feedback layer for the Judge     */
/* ------------------------------------------------------------------ */
export const performanceSignals = pgTable(
  "performance_signals",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    /** topic | source | hook | channel | platform */
    dimension: text("dimension").notNull(),
    key: text("key").notNull(),
    label: text("label").notNull().default(""),
    sampleSize: integer("sample_size").notNull().default(0),
    avgViews: integer("avg_views").notNull().default(0),
    avgEngagementBp: integer("avg_engagement_bp").notNull().default(0),
    /** global baseline this key is compared against */
    baselineViews: integer("baseline_views").notNull().default(0),
    /** -10..+10 score fed to the judge; 0 when confidence is low */
    adjustment: integer("adjustment").notNull().default(0),
    /** none | low | medium | high */
    confidence: text("confidence").notNull().default("none"),
    explanation: text("explanation").notNull().default(""),
    computedAt: timestamp("computed_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [uniqueIndex("performance_signals_unique").on(t.dimension, t.key)],
);

/* ------------------------------------------------------------------ */
/*  OAuth states — single-use CSRF tokens for authorization flows      */
/* ------------------------------------------------------------------ */
export const oauthStates = pgTable(
  "oauth_states",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    state: text("state").notNull().unique(),
    platform: text("platform").notNull(),
    channelId: uuid("channel_id").references(() => channels.id, { onDelete: "cascade" }),
    redirectTo: text("redirect_to").notNull().default("/publishing"),
    consumedAt: timestamp("consumed_at", { withTimezone: true }),
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index("oauth_states_expiry_idx").on(t.expiresAt)],
);

/* ------------------------------------------------------------------ */
/*  Notifications — operator attention feed                            */
/* ------------------------------------------------------------------ */
export const notifications = pgTable(
  "notifications",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    /** info | success | warning | error */
    severity: text("severity").notNull().default("info"),
    category: text("category").notNull().default("system"),
    title: text("title").notNull(),
    body: text("body").notNull().default(""),
    href: text("href"),
    /** stable key so the same condition is not repeatedly re-notified */
    dedupeKey: text("dedupe_key").unique(),
    readAt: timestamp("read_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index("notifications_created_idx").on(t.createdAt)],
);


/* ================================================================== */
/*  PHASE 7 — Niches, durable job queue, workers, observability       */
/* ================================================================== */

/* ------------------------------------------------------------------ */
/*  Niches — first-class configuration objects.                        */
/*  A niche binds: scouting → sources → judging → production →         */
/*  publishing. One reusable engine, many niche configurations.        */
/* ------------------------------------------------------------------ */
export const niches = pgTable(
  "niches",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    slug: text("slug").notNull().unique(),
    name: text("name").notNull(),
    description: text("description").notNull().default(""),
    /** active | paused | archived */
    status: text("status").notNull().default("active"),
    color: text("color").notNull().default("#C6F135"),

    /* ---- scouting ---- */
    scoutEnabled: boolean("scout_enabled").notNull().default(true),
    scoutIntervalHours: integer("scout_interval_hours").notNull().default(6),
    maxCandidatesPerCycle: integer("max_candidates_per_cycle").notNull().default(20),
    keywords: jsonb("keywords").$type<string[]>().notNull().default(sql`'[]'::jsonb`),
    excludedKeywords: jsonb("excluded_keywords")
      .$type<string[]>()
      .notNull()
      .default(sql`'[]'::jsonb`),
    filters: jsonb("filters")
      .$type<Record<string, unknown>>()
      .notNull()
      .default(sql`'{}'::jsonb`),
    lastScoutAt: timestamp("last_scout_at", { withTimezone: true }),
    nextScoutAt: timestamp("next_scout_at", { withTimezone: true }),

    /* ---- story judge (all niche-configurable, nothing hard-coded) ---- */
    judgeWeights: jsonb("judge_weights")
      .$type<Record<string, number>>()
      .notNull()
      .default(sql`'{}'::jsonb`),
    minGreenlightScore: integer("min_greenlight_score").notNull().default(72),
    freshnessMaxAgeHours: integer("freshness_max_age_hours").notNull().default(720),
    minSourceReliability: integer("min_source_reliability").notNull().default(40),
    duplicateSensitivity: integer("duplicate_sensitivity").notNull().default(70),
    minEngagementSignal: integer("min_engagement_signal").notNull().default(0),
    qualityThreshold: integer("quality_threshold").notNull().default(50),

    /* ---- linkage to existing profiles ---- */
    /** channel that carries production + publishing profiles for this niche */
    channelId: uuid("channel_id").references(() => channels.id, { onDelete: "set null" }),

    archivedAt: timestamp("archived_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index("niches_status_idx").on(t.status)],
);

/* ------------------------------------------------------------------ */
/*  Workers — registry with heartbeats for lease reclamation           */
/* ------------------------------------------------------------------ */
export const workers = pgTable(
  "workers",
  {
    id: text("id").primaryKey(),
    hostname: text("hostname").notNull().default(""),
    /** idle | busy | stopped */
    status: text("status").notNull().default("idle"),
    concurrency: integer("concurrency").notNull().default(2),
    activeJobs: integer("active_jobs").notNull().default(0),
    jobsProcessed: integer("jobs_processed").notNull().default(0),
    jobsFailed: integer("jobs_failed").notNull().default(0),
    startedAt: timestamp("started_at", { withTimezone: true }).notNull().defaultNow(),
    lastHeartbeatAt: timestamp("last_heartbeat_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [index("workers_heartbeat_idx").on(t.lastHeartbeatAt)],
);

/* ------------------------------------------------------------------ */
/*  Work queue — THE durable async job system (single source of truth) */
/*                                                                     */
/*  Supersedes ad-hoc in-request execution. automation_jobs remains as */
/*  the human-readable activity log; this table is the executor.       */
/* ------------------------------------------------------------------ */
export const workQueue = pgTable(
  "work_queue",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    /** scout_cycle | production_step | render | publish | analytics_refresh */
    type: text("type").notNull(),
    /** queued | running | paused | retrying | completed | failed | cancelled */
    status: text("status").notNull().default("queued"),
    /** higher runs first: 100 manual, 75 publish, 50 production, 25 scout, 10 analytics */
    priority: integer("priority").notNull().default(50),

    nicheId: uuid("niche_id").references(() => niches.id, { onDelete: "cascade" }),
    channelId: uuid("channel_id").references(() => channels.id, { onDelete: "cascade" }),
    contentId: uuid("content_id").references(() => content.id, { onDelete: "cascade" }),
    productionJobId: uuid("production_job_id").references(() => productionJobs.id, {
      onDelete: "cascade",
    }),
    publishJobId: uuid("publish_job_id").references(() => publishJobs.id, {
      onDelete: "cascade",
    }),

    payload: jsonb("payload")
      .$type<Record<string, unknown>>()
      .notNull()
      .default(sql`'{}'::jsonb`),
    /** de-duplication: at most one live job per key */
    dedupeKey: text("dedupe_key"),

    currentStep: text("current_step").notNull().default(""),
    /** honest state text; percent only when genuinely measurable */
    progressLabel: text("progress_label").notNull().default(""),
    progressBp: integer("progress_bp"),

    attempts: integer("attempts").notNull().default(0),
    maxAttempts: integer("max_attempts").notNull().default(3),
    lastError: text("last_error"),
    /** transient | permanent — drives whether a retry is scheduled */
    errorKind: text("error_kind"),

    /* ---- lease / ownership ---- */
    workerId: text("worker_id"),
    leaseExpiresAt: timestamp("lease_expires_at", { withTimezone: true }),
    heartbeatAt: timestamp("heartbeat_at", { withTimezone: true }),

    /** operator asked to cancel while a critical op was in flight */
    cancelRequested: boolean("cancel_requested").notNull().default(false),

    runAfter: timestamp("run_after", { withTimezone: true }).notNull().defaultNow(),
    startedAt: timestamp("started_at", { withTimezone: true }),
    completedAt: timestamp("completed_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    // claim path: status + runAfter + priority
    index("work_queue_claim_idx").on(t.status, t.runAfter, t.priority),
    index("work_queue_niche_idx").on(t.nicheId, t.status),
    index("work_queue_lease_idx").on(t.leaseExpiresAt),
    // at most one live job per dedupe key (partial unique enforced in code+index)
    uniqueIndex("work_queue_dedupe_unique").on(t.dedupeKey),
  ],
);

/* ------------------------------------------------------------------ */
/*  Job events — per-attempt observability trail                       */
/* ------------------------------------------------------------------ */
export const jobEvents = pgTable(
  "job_events",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    jobId: uuid("job_id")
      .notNull()
      .references(() => workQueue.id, { onDelete: "cascade" }),
    workerId: text("worker_id"),
    attempt: integer("attempt").notNull().default(1),
    step: text("step").notNull().default(""),
    /** claimed | started | progress | succeeded | failed | retry_scheduled |
        lease_expired | reclaimed | cancelled | paused | resumed */
    event: text("event").notNull(),
    provider: text("provider").notNull().default(""),
    durationMs: integer("duration_ms"),
    result: text("result").notNull().default(""),
    error: text("error"),
    retryReason: text("retry_reason"),
    detail: jsonb("detail")
      .$type<Record<string, unknown>>()
      .notNull()
      .default(sql`'{}'::jsonb`),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index("job_events_job_idx").on(t.jobId, t.createdAt)],
);

/* ------------------------------------------------------------------ */
/*  Agents — the AI workforce registry                                 */
/* ------------------------------------------------------------------ */
export const agents = pgTable("agents", {
  id: uuid("id").primaryKey().defaultRandom(),
  slug: text("slug").notNull().unique(),
  name: text("name").notNull(),
  role: text("role").notNull().default(""),
  description: text("description").notNull().default(""),
  icon: text("icon").notNull().default("Bot"),
  status: text("status").notNull().default("idle"), // idle | running | paused | error
  currentTask: text("current_task"),
  lastTask: text("last_task"),
  lastTaskStatus: text("last_task_status").notNull().default("success"), // success | failure
  lastRunAt: timestamp("last_run_at", { withTimezone: true }),
  successRate: integer("success_rate").notNull().default(100),
  totalRuns: integer("total_runs").notNull().default(0),
  failedRuns: integer("failed_runs").notNull().default(0),
});

/* ------------------------------------------------------------------ */
/*  Workflows — pipeline runs linking content to per-stage progress    */
/* ------------------------------------------------------------------ */
export type WorkflowStep = {
  stage: string;
  label: string;
  status: "pending" | "active" | "done" | "failed";
  agent?: string;
  at?: string;
};

export const workflows = pgTable("workflows", {
  id: uuid("id").primaryKey().defaultRandom(),
  contentId: uuid("content_id").references(() => content.id, {
    onDelete: "cascade",
  }),
  name: text("name").notNull(),
  type: text("type").notNull().default("content_pipeline"),
  status: text("status").notNull().default("running"), // queued | running | completed | failed
  currentStage: text("current_stage").notNull().default("discovered"),
  steps: jsonb("steps").$type<WorkflowStep[]>().notNull().default(sql`'[]'::jsonb`),
  startedAt: timestamp("started_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
  completedAt: timestamp("completed_at", { withTimezone: true }),
});

/* ------------------------------------------------------------------ */
/*  Publishing jobs — per-platform distribution tasks                  */
/* ------------------------------------------------------------------ */
export const publishingJobs = pgTable(
  "publishing_jobs",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    contentId: uuid("content_id")
      .notNull()
      .references(() => content.id, { onDelete: "cascade" }),
    platform: text("platform").notNull(), // youtube | tiktok | instagram | x
    status: text("status").notNull().default("queued"), // queued | publishing | published | failed
    scheduledAt: timestamp("scheduled_at", { withTimezone: true }),
    publishedAt: timestamp("published_at", { withTimezone: true }),
    attempts: integer("attempts").notNull().default(0),
    lastError: text("last_error"),
    externalUrl: text("external_url"),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [index("pub_jobs_status_idx").on(t.status)],
);

/* ------------------------------------------------------------------ */
/*  Analytics snapshots — cumulative per-content / per-platform stats  */
/* ------------------------------------------------------------------ */
export const analyticsSnapshots = pgTable(
  "analytics_snapshots",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    contentId: uuid("content_id").references(() => content.id, {
      onDelete: "cascade",
    }),
    channelId: uuid("channel_id").references(() => channels.id, {
      onDelete: "cascade",
    }),
    platform: text("platform").notNull().default("all"),
    capturedAt: timestamp("captured_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    views: integer("views").notNull().default(0),
    likes: integer("likes").notNull().default(0),
    comments: integer("comments").notNull().default(0),
    shares: integer("shares").notNull().default(0),
    watchMinutes: integer("watch_minutes").notNull().default(0),
  },
  (t) => [index("snapshots_content_idx").on(t.contentId, t.capturedAt)],
);

/* ------------------------------------------------------------------ */
/*  Automation jobs — scheduled system tasks (discovery, sync, ...)    */
/* ------------------------------------------------------------------ */
export const automationJobs = pgTable(
  "automation_jobs",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    type: text("type").notNull(), // story_discovery | analytics_sync | publishing | script_generation | ...
    label: text("label").notNull().default(""),
    status: text("status").notNull().default("queued"), // queued | running | success | failed
    trigger: text("trigger").notNull().default("schedule"), // schedule | manual | retry
    payload: jsonb("payload")
      .$type<Record<string, unknown>>()
      .notNull()
      .default(sql`'{}'::jsonb`),
    attempts: integer("attempts").notNull().default(0),
    maxAttempts: integer("max_attempts").notNull().default(3),
    durationMs: integer("duration_ms"),
    lastError: text("last_error"),
    scheduledAt: timestamp("scheduled_at", { withTimezone: true }),
    startedAt: timestamp("started_at", { withTimezone: true }),
    finishedAt: timestamp("finished_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [index("automation_status_idx").on(t.status)],
);

/* ------------------------------------------------------------------ */
/*  Automation settings — single-row config                            */
/* ------------------------------------------------------------------ */
export const automationSettings = pgTable("automation_settings", {
  id: integer("id").primaryKey().default(1),
  enabled: boolean("enabled").notNull().default(true),
  discoveryIntervalHours: integer("discovery_interval_hours")
    .notNull()
    .default(6),
  publishWindowStart: text("publish_window_start").notNull().default("09:00"),
  publishWindowEnd: text("publish_window_end").notNull().default("21:00"),
  dailyPublishCap: integer("daily_publish_cap").notNull().default(8),
  maxConcurrentJobs: integer("max_concurrent_jobs").notNull().default(3),
  autoRetry: boolean("auto_retry").notNull().default(true),
  judgeThreshold: integer("judge_threshold").notNull().default(72),
  scoutMaxStoriesPerRun: integer("scout_max_stories_per_run")
    .notNull()
    .default(20),
  retryDelayMinutes: integer("retry_delay_minutes").notNull().default(15),
  timezone: text("timezone").notNull().default("UTC"),
  nextRunAt: timestamp("next_run_at", { withTimezone: true }),
  lastRunAt: timestamp("last_run_at", { withTimezone: true }),
  updatedAt: timestamp("updated_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
});

/* ------------------------------ types ----------------------------- */
export type Channel = typeof channels.$inferSelect;
export type NewChannel = typeof channels.$inferInsert;
export type Story = typeof stories.$inferSelect;
export type ContentItem = typeof content.$inferSelect;
export type Agent = typeof agents.$inferSelect;
export type Workflow = typeof workflows.$inferSelect;
export type PublishingJob = typeof publishingJobs.$inferSelect;
export type AnalyticsSnapshot = typeof analyticsSnapshots.$inferSelect;
export type AutomationJob = typeof automationJobs.$inferSelect;
export type AutomationSettings = typeof automationSettings.$inferSelect;
export type StorySource = typeof storySources.$inferSelect;
export type ChannelProductionSettings = typeof channelProductionSettings.$inferSelect;
export type ProductionJob = typeof productionJobs.$inferSelect;
export type ProductionStep = typeof productionSteps.$inferSelect;
export type ContentDraft = typeof contentDrafts.$inferSelect;
export type ProductionAsset = typeof productionAssets.$inferSelect;
export type AiUsage = typeof aiUsage.$inferSelect;
export type DraftRevision = typeof draftRevisions.$inferSelect;
export type ChannelStrategy = typeof channelStrategy.$inferSelect;
export type PublishAccount = typeof publishAccounts.$inferSelect;
export type PublishJob = typeof publishJobs.$inferSelect;
export type PublishAttempt = typeof publishAttempts.$inferSelect;
export type PublishedPost = typeof publishedPosts.$inferSelect;
export type PostMetric = typeof postMetrics.$inferSelect;
export type PerformanceSignal = typeof performanceSignals.$inferSelect;
export type NotificationRow = typeof notifications.$inferSelect;
export type OauthState = typeof oauthStates.$inferSelect;
export type Niche = typeof niches.$inferSelect;
export type NewNiche = typeof niches.$inferInsert;
export type Worker = typeof workers.$inferSelect;
export type WorkItem = typeof workQueue.$inferSelect;
export type JobEvent = typeof jobEvents.$inferSelect;
export type StoryEvaluation = typeof storyEvaluations.$inferSelect;
export type AgentRun = typeof agentRuns.$inferSelect;
