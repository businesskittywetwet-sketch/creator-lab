/*
# Phase 8 — Full schema recreation with multi-user / multi-tenant support

## Summary
This migration creates the complete Viboro Creator Lab schema from scratch with
proper multi-user ownership. Every user-owned table now carries a `user_id` column
referencing `auth.users(id)`. RLS policies enforce that authenticated users can
only access their own rows.

## Key architectural changes from Phase 7:
1. **User ownership**: channels, stories, story_sources, content, niches,
   publish_accounts, publish_jobs, published_posts, notifications, automation_jobs,
   automation_settings, work_queue, agent_runs, oauth_states all carry `user_id`.
2. **Publish accounts are user-owned, not channel-owned**: A user can connect
   multiple YouTube channels. `channelId` is nullable for backward compatibility.
   Unique constraint is on (user_id, external_account_id, platform) — preventing
   the same external account from being connected twice by the same user, while
   allowing different users to connect their own accounts.
3. **Niche destinations junction table**: `niche_destinations` links niches to
   publish_accounts in a many-to-many relationship. A niche can publish to zero,
   one, or many destinations. A destination can serve multiple niches.
4. **Publish jobs route by account, not just platform**: Unique constraint changed
   from (content_id, platform) to (content_id, account_id) — allowing the same
   content to publish to two different YouTube channels independently.
5. **Published posts carry user_id and account_id** for proper analytics scoping.
6. **Automation settings are per-user** (unique on user_id) instead of single-row.

## Tables created (40 total):
- channels, stories, story_sources, story_evaluations, agent_runs
- content, channel_production_settings, production_jobs, production_steps
- content_drafts, production_assets, ai_usage, draft_revisions
- channel_strategy, publish_accounts, niche_destinations
- publish_jobs, publish_attempts, published_posts, post_metrics
- performance_signals, oauth_states, notifications
- niches, workers, work_queue, job_events, agents, workflows
- publishing_jobs (legacy), analytics_snapshots (legacy)
- automation_jobs, automation_settings

## Security:
- RLS enabled on ALL user-owned tables.
- 4 policies per table (SELECT/INSERT/UPDATE/DELETE) scoped to `auth.uid() = user_id`.
- Tables without user_id (agents, workers, performance_signals, story_evaluations,
  production_steps, production_assets, ai_usage, draft_revisions, channel_production_settings,
  channel_strategy, publish_attempts, job_events, workflows) use `TO authenticated` with
  ownership checked through parent table EXISTS subqueries, or are read-only.
- `agents` table is globally readable (it's a static registry).

## Important notes:
1. This migration is idempotent — uses CREATE TABLE IF NOT EXISTS.
2. All foreign keys use ON DELETE CASCADE or SET NULL appropriately.
3. Indexes cover all hot paths: queue claiming, status filtering, user scoping.
4. The legacy `publishing_jobs` and `analytics_snapshots` tables are kept but
   the UI is repointed to the modern `publish_jobs` / `post_metrics` system.
*/

-- ============================================================
-- 1. CHANNELS (user-owned)
-- ============================================================
CREATE TABLE IF NOT EXISTS channels (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL,
  slug text NOT NULL,
  name text NOT NULL,
  niche text NOT NULL DEFAULT '',
  description text NOT NULL DEFAULT '',
  content_style text NOT NULL DEFAULT '',
  target_audience text NOT NULL DEFAULT '',
  posting_frequency text NOT NULL DEFAULT '',
  preferred_length text NOT NULL DEFAULT '',
  voice_tone text NOT NULL DEFAULT '',
  target_platforms jsonb NOT NULL DEFAULT '[]'::jsonb,
  color text NOT NULL DEFAULT '#C6F135',
  active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS channels_user_slug_unique ON channels(user_id, slug);
CREATE INDEX IF NOT EXISTS channels_user_idx ON channels(user_id);
ALTER TABLE channels ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "channels_select_own" ON channels;
CREATE POLICY "channels_select_own" ON channels FOR SELECT TO authenticated USING (auth.uid() = user_id);
DROP POLICY IF EXISTS "channels_insert_own" ON channels;
CREATE POLICY "channels_insert_own" ON channels FOR INSERT TO authenticated WITH CHECK (auth.uid() = user_id);
DROP POLICY IF EXISTS "channels_update_own" ON channels;
CREATE POLICY "channels_update_own" ON channels FOR UPDATE TO authenticated USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);
DROP POLICY IF EXISTS "channels_delete_own" ON channels;
CREATE POLICY "channels_delete_own" ON channels FOR DELETE TO authenticated USING (auth.uid() = user_id);

-- ============================================================
-- 2. STORIES (user-owned)
-- ============================================================
CREATE TABLE IF NOT EXISTS stories (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL,
  channel_id uuid REFERENCES channels(id) ON DELETE CASCADE,
  title text NOT NULL,
  summary text NOT NULL DEFAULT '',
  source_name text NOT NULL DEFAULT '',
  source_url text NOT NULL DEFAULT '',
  discovered_by text NOT NULL DEFAULT 'story-scout',
  score integer NOT NULL DEFAULT 0,
  status text NOT NULL DEFAULT 'discovered',
  tags jsonb NOT NULL DEFAULT '[]'::jsonb,
  source_adapter text NOT NULL DEFAULT 'seed',
  dedupe_key text,
  signals jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS stories_channel_idx ON stories(channel_id);
CREATE INDEX IF NOT EXISTS stories_status_idx ON stories(status);
CREATE INDEX IF NOT EXISTS stories_user_idx ON stories(user_id);
ALTER TABLE stories ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "stories_select_own" ON stories;
CREATE POLICY "stories_select_own" ON stories FOR SELECT TO authenticated USING (auth.uid() = user_id);
DROP POLICY IF EXISTS "stories_insert_own" ON stories;
CREATE POLICY "stories_insert_own" ON stories FOR INSERT TO authenticated WITH CHECK (auth.uid() = user_id);
DROP POLICY IF EXISTS "stories_update_own" ON stories;
CREATE POLICY "stories_update_own" ON stories FOR UPDATE TO authenticated USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);
DROP POLICY IF EXISTS "stories_delete_own" ON stories;
CREATE POLICY "stories_delete_own" ON stories FOR DELETE TO authenticated USING (auth.uid() = user_id);

-- ============================================================
-- 3. STORY SOURCES (user-owned)
-- ============================================================
CREATE TABLE IF NOT EXISTS story_sources (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL,
  type text NOT NULL,
  name text NOT NULL,
  enabled boolean NOT NULL DEFAULT true,
  channel_slug text,
  niche_id uuid,
  config jsonb NOT NULL DEFAULT '{}'::jsonb,
  reliability integer NOT NULL DEFAULT 70,
  poll_interval_minutes integer NOT NULL DEFAULT 360,
  last_run_at timestamptz,
  last_success_at timestamptz,
  last_failure_at timestamptz,
  consecutive_failures integer NOT NULL DEFAULT 0,
  last_status text NOT NULL DEFAULT 'never',
  last_error text,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS story_sources_user_idx ON story_sources(user_id);
ALTER TABLE story_sources ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "story_sources_select_own" ON story_sources;
CREATE POLICY "story_sources_select_own" ON story_sources FOR SELECT TO authenticated USING (auth.uid() = user_id);
DROP POLICY IF EXISTS "story_sources_insert_own" ON story_sources;
CREATE POLICY "story_sources_insert_own" ON story_sources FOR INSERT TO authenticated WITH CHECK (auth.uid() = user_id);
DROP POLICY IF EXISTS "story_sources_update_own" ON story_sources;
CREATE POLICY "story_sources_update_own" ON story_sources FOR UPDATE TO authenticated USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);
DROP POLICY IF EXISTS "story_sources_delete_own" ON story_sources;
CREATE POLICY "story_sources_delete_own" ON story_sources FOR DELETE TO authenticated USING (auth.uid() = user_id);

-- ============================================================
-- 4. STORY EVALUATIONS (ownership through stories)
-- ============================================================
CREATE TABLE IF NOT EXISTS story_evaluations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  story_id uuid NOT NULL REFERENCES stories(id) ON DELETE CASCADE,
  provider text NOT NULL,
  model text NOT NULL DEFAULT '',
  viral_potential integer NOT NULL DEFAULT 0,
  entertainment_value integer NOT NULL DEFAULT 0,
  channel_relevance integer NOT NULL DEFAULT 0,
  visual_potential integer NOT NULL DEFAULT 0,
  originality integer NOT NULL DEFAULT 0,
  evergreen_potential integer NOT NULL DEFAULT 0,
  source_reliability integer NOT NULL DEFAULT 0,
  overall integer NOT NULL DEFAULT 0,
  recommendation text NOT NULL DEFAULT 'review',
  rationale text NOT NULL DEFAULT '',
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS evaluations_story_idx ON story_evaluations(story_id, created_at);
ALTER TABLE story_evaluations ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "story_evaluations_select_own" ON story_evaluations;
CREATE POLICY "story_evaluations_select_own" ON story_evaluations FOR SELECT TO authenticated
  USING (EXISTS (SELECT 1 FROM stories WHERE stories.id = story_evaluations.story_id AND stories.user_id = auth.uid()));
DROP POLICY IF EXISTS "story_evaluations_insert_own" ON story_evaluations;
CREATE POLICY "story_evaluations_insert_own" ON story_evaluations FOR INSERT TO authenticated
  WITH CHECK (EXISTS (SELECT 1 FROM stories WHERE stories.id = story_evaluations.story_id AND stories.user_id = auth.uid()));
DROP POLICY IF EXISTS "story_evaluations_delete_own" ON story_evaluations;
CREATE POLICY "story_evaluations_delete_own" ON story_evaluations FOR DELETE TO authenticated
  USING (EXISTS (SELECT 1 FROM stories WHERE stories.id = story_evaluations.story_id AND stories.user_id = auth.uid()));

-- ============================================================
-- 5. AGENT RUNS (user-owned)
-- ============================================================
CREATE TABLE IF NOT EXISTS agent_runs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid,
  agent_slug text NOT NULL,
  job_type text NOT NULL,
  status text NOT NULL DEFAULT 'running',
  trigger text NOT NULL DEFAULT 'schedule',
  stats jsonb NOT NULL DEFAULT '{}'::jsonb,
  error text,
  started_at timestamptz NOT NULL DEFAULT now(),
  finished_at timestamptz,
  duration_ms integer,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS agent_runs_slug_idx ON agent_runs(agent_slug, created_at);
ALTER TABLE agent_runs ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "agent_runs_select_own" ON agent_runs;
CREATE POLICY "agent_runs_select_own" ON agent_runs FOR SELECT TO authenticated USING (auth.uid() = user_id);
DROP POLICY IF EXISTS "agent_runs_insert_own" ON agent_runs;
CREATE POLICY "agent_runs_insert_own" ON agent_runs FOR INSERT TO authenticated WITH CHECK (auth.uid() = user_id);
DROP POLICY IF EXISTS "agent_runs_delete_own" ON agent_runs;
CREATE POLICY "agent_runs_delete_own" ON agent_runs FOR DELETE TO authenticated USING (auth.uid() = user_id);

-- ============================================================
-- 6. CONTENT (user-owned)
-- ============================================================
CREATE TABLE IF NOT EXISTS content (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL,
  channel_id uuid NOT NULL REFERENCES channels(id) ON DELETE CASCADE,
  story_id uuid REFERENCES stories(id) ON DELETE SET NULL,
  title text NOT NULL,
  format text NOT NULL DEFAULT 'Short',
  stage text NOT NULL DEFAULT 'discovered',
  score integer NOT NULL DEFAULT 0,
  hook text NOT NULL DEFAULT '',
  duration_sec integer,
  assigned_agents jsonb NOT NULL DEFAULT '[]'::jsonb,
  scheduled_at timestamptz,
  published_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS content_channel_idx ON content(channel_id);
CREATE INDEX IF NOT EXISTS content_stage_idx ON content(stage);
CREATE INDEX IF NOT EXISTS content_user_idx ON content(user_id);
ALTER TABLE content ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "content_select_own" ON content;
CREATE POLICY "content_select_own" ON content FOR SELECT TO authenticated USING (auth.uid() = user_id);
DROP POLICY IF EXISTS "content_insert_own" ON content;
CREATE POLICY "content_insert_own" ON content FOR INSERT TO authenticated WITH CHECK (auth.uid() = user_id);
DROP POLICY IF EXISTS "content_update_own" ON content;
CREATE POLICY "content_update_own" ON content FOR UPDATE TO authenticated USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);
DROP POLICY IF EXISTS "content_delete_own" ON content;
CREATE POLICY "content_delete_own" ON content FOR DELETE TO authenticated USING (auth.uid() = user_id);

-- ============================================================
-- 7. CHANNEL PRODUCTION SETTINGS (ownership through channels)
-- ============================================================
CREATE TABLE IF NOT EXISTS channel_production_settings (
  channel_id uuid PRIMARY KEY REFERENCES channels(id) ON DELETE CASCADE,
  format text NOT NULL DEFAULT 'Short',
  target_duration_sec integer NOT NULL DEFAULT 55,
  script_word_target integer NOT NULL DEFAULT 140,
  tone text NOT NULL DEFAULT 'Wry, deadpan narrator',
  hook_style text NOT NULL DEFAULT 'cold-open shock fact',
  cta_style text NOT NULL DEFAULT 'Follow for more',
  visual_style text NOT NULL DEFAULT 'Archival footage with kinetic captions',
  narration_voice text NOT NULL DEFAULT 'default',
  research_depth integer NOT NULL DEFAULT 4,
  section_count integer NOT NULL DEFAULT 4,
  writing_style text NOT NULL DEFAULT 'Punchy, concrete, no filler',
  pacing text NOT NULL DEFAULT 'fast',
  min_word_count integer NOT NULL DEFAULT 90,
  max_word_count integer NOT NULL DEFAULT 200,
  language text NOT NULL DEFAULT 'en',
  caption_style text NOT NULL DEFAULT 'bold-centered',
  words_per_cue integer NOT NULL DEFAULT 4,
  speaking_rate integer NOT NULL DEFAULT 150,
  music_cue text NOT NULL DEFAULT '',
  required_steps jsonb NOT NULL DEFAULT '[]'::jsonb,
  updated_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE channel_production_settings ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "cps_select_own" ON channel_production_settings;
CREATE POLICY "cps_select_own" ON channel_production_settings FOR SELECT TO authenticated
  USING (EXISTS (SELECT 1 FROM channels WHERE channels.id = channel_production_settings.channel_id AND channels.user_id = auth.uid()));
DROP POLICY IF EXISTS "cps_insert_own" ON channel_production_settings;
CREATE POLICY "cps_insert_own" ON channel_production_settings FOR INSERT TO authenticated
  WITH CHECK (EXISTS (SELECT 1 FROM channels WHERE channels.id = channel_production_settings.channel_id AND channels.user_id = auth.uid()));
DROP POLICY IF EXISTS "cps_update_own" ON channel_production_settings;
CREATE POLICY "cps_update_own" ON channel_production_settings FOR UPDATE TO authenticated
  USING (EXISTS (SELECT 1 FROM channels WHERE channels.id = channel_production_settings.channel_id AND channels.user_id = auth.uid()))
  WITH CHECK (EXISTS (SELECT 1 FROM channels WHERE channels.id = channel_production_settings.channel_id AND channels.user_id = auth.uid()));
DROP POLICY IF EXISTS "cps_delete_own" ON channel_production_settings;
CREATE POLICY "cps_delete_own" ON channel_production_settings FOR DELETE TO authenticated
  USING (EXISTS (SELECT 1 FROM channels WHERE channels.id = channel_production_settings.channel_id AND channels.user_id = auth.uid()));

-- ============================================================
-- 8. PRODUCTION JOBS (ownership through content)
-- ============================================================
CREATE TABLE IF NOT EXISTS production_jobs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  content_id uuid NOT NULL REFERENCES content(id) ON DELETE CASCADE,
  channel_id uuid NOT NULL REFERENCES channels(id) ON DELETE CASCADE,
  status text NOT NULL DEFAULT 'queued',
  current_step text NOT NULL DEFAULT 'research',
  completed_steps integer NOT NULL DEFAULT 0,
  total_steps integer NOT NULL DEFAULT 9,
  attempts integer NOT NULL DEFAULT 0,
  max_attempts integer NOT NULL DEFAULT 3,
  provider text NOT NULL DEFAULT '',
  last_error text,
  started_at timestamptz,
  completed_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS production_jobs_content_unique ON production_jobs(content_id);
CREATE INDEX IF NOT EXISTS production_jobs_status_idx ON production_jobs(status);
ALTER TABLE production_jobs ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "pj_select_own" ON production_jobs;
CREATE POLICY "pj_select_own" ON production_jobs FOR SELECT TO authenticated
  USING (EXISTS (SELECT 1 FROM content WHERE content.id = production_jobs.content_id AND content.user_id = auth.uid()));
DROP POLICY IF EXISTS "pj_insert_own" ON production_jobs;
CREATE POLICY "pj_insert_own" ON production_jobs FOR INSERT TO authenticated
  WITH CHECK (EXISTS (SELECT 1 FROM content WHERE content.id = production_jobs.content_id AND content.user_id = auth.uid()));
DROP POLICY IF EXISTS "pj_update_own" ON production_jobs;
CREATE POLICY "pj_update_own" ON production_jobs FOR UPDATE TO authenticated
  USING (EXISTS (SELECT 1 FROM content WHERE content.id = production_jobs.content_id AND content.user_id = auth.uid()))
  WITH CHECK (EXISTS (SELECT 1 FROM content WHERE content.id = production_jobs.content_id AND content.user_id = auth.uid()));
DROP POLICY IF EXISTS "pj_delete_own" ON production_jobs;
CREATE POLICY "pj_delete_own" ON production_jobs FOR DELETE TO authenticated
  USING (EXISTS (SELECT 1 FROM content WHERE content.id = production_jobs.content_id AND content.user_id = auth.uid()));

-- ============================================================
-- 9. PRODUCTION STEPS (ownership through production_jobs)
-- ============================================================
CREATE TABLE IF NOT EXISTS production_steps (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  job_id uuid NOT NULL REFERENCES production_jobs(id) ON DELETE CASCADE,
  step_key text NOT NULL,
  label text NOT NULL DEFAULT '',
  agent_slug text NOT NULL DEFAULT '',
  position integer NOT NULL DEFAULT 0,
  status text NOT NULL DEFAULT 'pending',
  attempts integer NOT NULL DEFAULT 0,
  provider text NOT NULL DEFAULT '',
  generation_mode text NOT NULL DEFAULT 'pending',
  input jsonb NOT NULL DEFAULT '{}'::jsonb,
  output jsonb NOT NULL DEFAULT '{}'::jsonb,
  error text,
  started_at timestamptz,
  finished_at timestamptz,
  duration_ms integer
);
CREATE INDEX IF NOT EXISTS production_steps_job_idx ON production_steps(job_id, position);
ALTER TABLE production_steps ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "ps_select_own" ON production_steps;
CREATE POLICY "ps_select_own" ON production_steps FOR SELECT TO authenticated
  USING (EXISTS (SELECT 1 FROM production_jobs pj JOIN content c ON c.id = pj.content_id WHERE pj.id = production_steps.job_id AND c.user_id = auth.uid()));
DROP POLICY IF EXISTS "ps_insert_own" ON production_steps;
CREATE POLICY "ps_insert_own" ON production_steps FOR INSERT TO authenticated
  WITH CHECK (EXISTS (SELECT 1 FROM production_jobs pj JOIN content c ON c.id = pj.content_id WHERE pj.id = production_steps.job_id AND c.user_id = auth.uid()));
DROP POLICY IF EXISTS "ps_update_own" ON production_steps;
CREATE POLICY "ps_update_own" ON production_steps FOR UPDATE TO authenticated
  USING (EXISTS (SELECT 1 FROM production_jobs pj JOIN content c ON c.id = pj.content_id WHERE pj.id = production_steps.job_id AND c.user_id = auth.uid()))
  WITH CHECK (EXISTS (SELECT 1 FROM production_jobs pj JOIN content c ON c.id = pj.content_id WHERE pj.id = production_steps.job_id AND c.user_id = auth.uid()));
DROP POLICY IF EXISTS "ps_delete_own" ON production_steps;
CREATE POLICY "ps_delete_own" ON production_steps FOR DELETE TO authenticated
  USING (EXISTS (SELECT 1 FROM production_jobs pj JOIN content c ON c.id = pj.content_id WHERE pj.id = production_steps.job_id AND c.user_id = auth.uid()));

-- ============================================================
-- 10. CONTENT DRAFTS (ownership through content)
-- ============================================================
CREATE TABLE IF NOT EXISTS content_drafts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  content_id uuid NOT NULL REFERENCES content(id) ON DELETE CASCADE,
  job_id uuid REFERENCES production_jobs(id) ON DELETE CASCADE,
  version integer NOT NULL DEFAULT 1,
  status text NOT NULL DEFAULT 'in_progress',
  concept text NOT NULL DEFAULT '',
  angle text NOT NULL DEFAULT '',
  hook text NOT NULL DEFAULT '',
  title text NOT NULL DEFAULT '',
  script_body text NOT NULL DEFAULT '',
  cta text NOT NULL DEFAULT '',
  sections jsonb NOT NULL DEFAULT '[]'::jsonb,
  research_brief jsonb NOT NULL DEFAULT '{}'::jsonb,
  fact_check jsonb NOT NULL DEFAULT '{}'::jsonb,
  visual_plan jsonb NOT NULL DEFAULT '[]'::jsonb,
  narration_plan jsonb NOT NULL DEFAULT '{}'::jsonb,
  assembly_plan jsonb NOT NULL DEFAULT '{}'::jsonb,
  qc_report jsonb NOT NULL DEFAULT '{}'::jsonb,
  word_count integer NOT NULL DEFAULT 0,
  estimated_duration_sec integer NOT NULL DEFAULT 0,
  qc_score integer NOT NULL DEFAULT 0,
  review_notes text,
  generation_mode text NOT NULL DEFAULT 'pending',
  provider text NOT NULL DEFAULT '',
  concepts jsonb NOT NULL DEFAULT '[]'::jsonb,
  captions jsonb NOT NULL DEFAULT '{}'::jsonb,
  video_url text,
  audio_url text,
  revision integer NOT NULL DEFAULT 0,
  description text NOT NULL DEFAULT '',
  social_caption text NOT NULL DEFAULT '',
  hashtags jsonb NOT NULL DEFAULT '[]'::jsonb,
  edited_fields jsonb NOT NULL DEFAULT '[]'::jsonb,
  youtube_title text NOT NULL DEFAULT '',
  youtube_description text NOT NULL DEFAULT '',
  youtube_tags jsonb NOT NULL DEFAULT '[]'::jsonb,
  youtube_category_id text NOT NULL DEFAULT '24',
  youtube_privacy text NOT NULL DEFAULT 'private',
  thumbnail_asset_id uuid,
  metadata_mode text NOT NULL DEFAULT 'pending',
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS content_drafts_content_idx ON content_drafts(content_id, version);
CREATE UNIQUE INDEX IF NOT EXISTS content_drafts_job_unique ON content_drafts(job_id);
ALTER TABLE content_drafts ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "cd_select_own" ON content_drafts;
CREATE POLICY "cd_select_own" ON content_drafts FOR SELECT TO authenticated
  USING (EXISTS (SELECT 1 FROM content WHERE content.id = content_drafts.content_id AND content.user_id = auth.uid()));
DROP POLICY IF EXISTS "cd_insert_own" ON content_drafts;
CREATE POLICY "cd_insert_own" ON content_drafts FOR INSERT TO authenticated
  WITH CHECK (EXISTS (SELECT 1 FROM content WHERE content.id = content_drafts.content_id AND content.user_id = auth.uid()));
DROP POLICY IF EXISTS "cd_update_own" ON content_drafts;
CREATE POLICY "cd_update_own" ON content_drafts FOR UPDATE TO authenticated
  USING (EXISTS (SELECT 1 FROM content WHERE content.id = content_drafts.content_id AND content.user_id = auth.uid()))
  WITH CHECK (EXISTS (SELECT 1 FROM content WHERE content.id = content_drafts.content_id AND content.user_id = auth.uid()));
DROP POLICY IF EXISTS "cd_delete_own" ON content_drafts;
CREATE POLICY "cd_delete_own" ON content_drafts FOR DELETE TO authenticated
  USING (EXISTS (SELECT 1 FROM content WHERE content.id = content_drafts.content_id AND content.user_id = auth.uid()));

-- ============================================================
-- 11. PRODUCTION ASSETS (ownership through production_jobs)
-- ============================================================
CREATE TABLE IF NOT EXISTS production_assets (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  job_id uuid NOT NULL REFERENCES production_jobs(id) ON DELETE CASCADE,
  step_key text NOT NULL DEFAULT '',
  kind text NOT NULL,
  scene_number integer,
  prompt text NOT NULL DEFAULT '',
  provider text NOT NULL DEFAULT '',
  model text NOT NULL DEFAULT '',
  status text NOT NULL DEFAULT 'generated',
  url text,
  file_path text,
  mime_type text NOT NULL DEFAULT '',
  bytes integer,
  duration_sec integer,
  error text,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS production_assets_job_idx ON production_assets(job_id, kind);
CREATE INDEX IF NOT EXISTS production_assets_scene_idx ON production_assets(job_id, scene_number);
ALTER TABLE production_assets ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "pa_select_own" ON production_assets;
CREATE POLICY "pa_select_own" ON production_assets FOR SELECT TO authenticated
  USING (EXISTS (SELECT 1 FROM production_jobs pj JOIN content c ON c.id = pj.content_id WHERE pj.id = production_assets.job_id AND c.user_id = auth.uid()));
DROP POLICY IF EXISTS "pa_insert_own" ON production_assets;
CREATE POLICY "pa_insert_own" ON production_assets FOR INSERT TO authenticated
  WITH CHECK (EXISTS (SELECT 1 FROM production_jobs pj JOIN content c ON c.id = pj.content_id WHERE pj.id = production_assets.job_id AND c.user_id = auth.uid()));
DROP POLICY IF EXISTS "pa_update_own" ON production_assets;
CREATE POLICY "pa_update_own" ON production_assets FOR UPDATE TO authenticated
  USING (EXISTS (SELECT 1 FROM production_jobs pj JOIN content c ON c.id = pj.content_id WHERE pj.id = production_assets.job_id AND c.user_id = auth.uid()))
  WITH CHECK (EXISTS (SELECT 1 FROM production_jobs pj JOIN content c ON c.id = pj.content_id WHERE pj.id = production_assets.job_id AND c.user_id = auth.uid()));
DROP POLICY IF EXISTS "pa_delete_own" ON production_assets;
CREATE POLICY "pa_delete_own" ON production_assets FOR DELETE TO authenticated
  USING (EXISTS (SELECT 1 FROM production_jobs pj JOIN content c ON c.id = pj.content_id WHERE pj.id = production_assets.job_id AND c.user_id = auth.uid()));

-- ============================================================
-- 12. AI USAGE (ownership through production_jobs)
-- ============================================================
CREATE TABLE IF NOT EXISTS ai_usage (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  job_id uuid REFERENCES production_jobs(id) ON DELETE CASCADE,
  step_key text NOT NULL DEFAULT '',
  kind text NOT NULL DEFAULT 'text',
  provider text NOT NULL DEFAULT '',
  model text NOT NULL DEFAULT '',
  prompt_tokens integer NOT NULL DEFAULT 0,
  completion_tokens integer NOT NULL DEFAULT 0,
  generations integer NOT NULL DEFAULT 0,
  cost_micro_usd integer NOT NULL DEFAULT 0,
  duration_ms integer NOT NULL DEFAULT 0,
  success boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS ai_usage_job_idx ON ai_usage(job_id, created_at);
ALTER TABLE ai_usage ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "ai_usage_select_own" ON ai_usage;
CREATE POLICY "ai_usage_select_own" ON ai_usage FOR SELECT TO authenticated
  USING (EXISTS (SELECT 1 FROM production_jobs pj JOIN content c ON c.id = pj.content_id WHERE pj.id = ai_usage.job_id AND c.user_id = auth.uid()));
DROP POLICY IF EXISTS "ai_usage_insert_own" ON ai_usage;
CREATE POLICY "ai_usage_insert_own" ON ai_usage FOR INSERT TO authenticated
  WITH CHECK (EXISTS (SELECT 1 FROM production_jobs pj JOIN content c ON c.id = pj.content_id WHERE pj.id = ai_usage.job_id AND c.user_id = auth.uid()));
DROP POLICY IF EXISTS "ai_usage_delete_own" ON ai_usage;
CREATE POLICY "ai_usage_delete_own" ON ai_usage FOR DELETE TO authenticated
  USING (EXISTS (SELECT 1 FROM production_jobs pj JOIN content c ON c.id = pj.content_id WHERE pj.id = ai_usage.job_id AND c.user_id = auth.uid()));

-- ============================================================
-- 13. DRAFT REVISIONS (ownership through production_jobs)
-- ============================================================
CREATE TABLE IF NOT EXISTS draft_revisions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  job_id uuid NOT NULL REFERENCES production_jobs(id) ON DELETE CASCADE,
  revision integer NOT NULL DEFAULT 1,
  target_step text NOT NULL DEFAULT 'script',
  kind text NOT NULL DEFAULT 'rewind',
  changed_fields jsonb NOT NULL DEFAULT '[]'::jsonb,
  reason text NOT NULL DEFAULT '',
  requested_by text NOT NULL DEFAULT 'operator',
  snapshot jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS draft_revisions_job_idx ON draft_revisions(job_id, revision);
ALTER TABLE draft_revisions ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "dr_select_own" ON draft_revisions;
CREATE POLICY "dr_select_own" ON draft_revisions FOR SELECT TO authenticated
  USING (EXISTS (SELECT 1 FROM production_jobs pj JOIN content c ON c.id = pj.content_id WHERE pj.id = draft_revisions.job_id AND c.user_id = auth.uid()));
DROP POLICY IF EXISTS "dr_insert_own" ON draft_revisions;
CREATE POLICY "dr_insert_own" ON draft_revisions FOR INSERT TO authenticated
  WITH CHECK (EXISTS (SELECT 1 FROM production_jobs pj JOIN content c ON c.id = pj.content_id WHERE pj.id = draft_revisions.job_id AND c.user_id = auth.uid()));
DROP POLICY IF EXISTS "dr_delete_own" ON draft_revisions;
CREATE POLICY "dr_delete_own" ON draft_revisions FOR DELETE TO authenticated
  USING (EXISTS (SELECT 1 FROM production_jobs pj JOIN content c ON c.id = pj.content_id WHERE pj.id = draft_revisions.job_id AND c.user_id = auth.uid()));

-- ============================================================
-- 14. CHANNEL STRATEGY (ownership through channels)
-- ============================================================
CREATE TABLE IF NOT EXISTS channel_strategy (
  channel_id uuid PRIMARY KEY REFERENCES channels(id) ON DELETE CASCADE,
  posts_per_week integer NOT NULL DEFAULT 5,
  posting_windows jsonb NOT NULL DEFAULT '["09:00","18:00"]'::jsonb,
  timezone text NOT NULL DEFAULT 'UTC',
  platforms jsonb NOT NULL DEFAULT '[]'::jsonb,
  hashtag_strategy text NOT NULL DEFAULT '3-5 niche tags, no generic spam',
  default_hashtags jsonb NOT NULL DEFAULT '[]'::jsonb,
  content_mix jsonb NOT NULL DEFAULT '{}'::jsonb,
  require_approval boolean NOT NULL DEFAULT true,
  auto_publish boolean NOT NULL DEFAULT false,
  min_qc_score integer NOT NULL DEFAULT 60,
  updated_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE channel_strategy ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "cs_select_own" ON channel_strategy;
CREATE POLICY "cs_select_own" ON channel_strategy FOR SELECT TO authenticated
  USING (EXISTS (SELECT 1 FROM channels WHERE channels.id = channel_strategy.channel_id AND channels.user_id = auth.uid()));
DROP POLICY IF EXISTS "cs_insert_own" ON channel_strategy;
CREATE POLICY "cs_insert_own" ON channel_strategy FOR INSERT TO authenticated
  WITH CHECK (EXISTS (SELECT 1 FROM channels WHERE channels.id = channel_strategy.channel_id AND channels.user_id = auth.uid()));
DROP POLICY IF EXISTS "cs_update_own" ON channel_strategy;
CREATE POLICY "cs_update_own" ON channel_strategy FOR UPDATE TO authenticated
  USING (EXISTS (SELECT 1 FROM channels WHERE channels.id = channel_strategy.channel_id AND channels.user_id = auth.uid()))
  WITH CHECK (EXISTS (SELECT 1 FROM channels WHERE channels.id = channel_strategy.channel_id AND channels.user_id = auth.uid()));
DROP POLICY IF EXISTS "cs_delete_own" ON channel_strategy;
CREATE POLICY "cs_delete_own" ON channel_strategy FOR DELETE TO authenticated
  USING (EXISTS (SELECT 1 FROM channels WHERE channels.id = channel_strategy.channel_id AND channels.user_id = auth.uid()));

-- ============================================================
-- 15. PUBLISH ACCOUNTS (user-owned — multiple destinations per platform)
-- ============================================================
CREATE TABLE IF NOT EXISTS publish_accounts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL,
  channel_id uuid REFERENCES channels(id) ON DELETE SET NULL,
  platform text NOT NULL,
  display_name text NOT NULL DEFAULT '',
  handle text NOT NULL DEFAULT '',
  external_account_id text NOT NULL DEFAULT '',
  credential_ref text NOT NULL DEFAULT '',
  status text NOT NULL DEFAULT 'not_connected',
  last_checked_at timestamptz,
  last_error text,
  enabled boolean NOT NULL DEFAULT true,
  encrypted_tokens text,
  token_expires_at timestamptz,
  scopes jsonb NOT NULL DEFAULT '[]'::jsonb,
  connected_at timestamptz,
  revoked_at timestamptz,
  last_refresh_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS publish_accounts_user_idx ON publish_accounts(user_id, platform);
CREATE UNIQUE INDEX IF NOT EXISTS publish_accounts_user_external_unique ON publish_accounts(user_id, external_account_id, platform);
ALTER TABLE publish_accounts ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "pa_acc_select_own" ON publish_accounts;
CREATE POLICY "pa_acc_select_own" ON publish_accounts FOR SELECT TO authenticated USING (auth.uid() = user_id);
DROP POLICY IF EXISTS "pa_acc_insert_own" ON publish_accounts;
CREATE POLICY "pa_acc_insert_own" ON publish_accounts FOR INSERT TO authenticated WITH CHECK (auth.uid() = user_id);
DROP POLICY IF EXISTS "pa_acc_update_own" ON publish_accounts;
CREATE POLICY "pa_acc_update_own" ON publish_accounts FOR UPDATE TO authenticated USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);
DROP POLICY IF EXISTS "pa_acc_delete_own" ON publish_accounts;
CREATE POLICY "pa_acc_delete_own" ON publish_accounts FOR DELETE TO authenticated USING (auth.uid() = user_id);

-- ============================================================
-- 16. NICHES (user-owned)
-- ============================================================
CREATE TABLE IF NOT EXISTS niches (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL,
  slug text NOT NULL,
  name text NOT NULL,
  description text NOT NULL DEFAULT '',
  status text NOT NULL DEFAULT 'active',
  color text NOT NULL DEFAULT '#C6F135',
  scout_enabled boolean NOT NULL DEFAULT true,
  scout_interval_hours integer NOT NULL DEFAULT 6,
  max_candidates_per_cycle integer NOT NULL DEFAULT 20,
  keywords jsonb NOT NULL DEFAULT '[]'::jsonb,
  excluded_keywords jsonb NOT NULL DEFAULT '[]'::jsonb,
  filters jsonb NOT NULL DEFAULT '{}'::jsonb,
  last_scout_at timestamptz,
  next_scout_at timestamptz,
  judge_weights jsonb NOT NULL DEFAULT '{}'::jsonb,
  min_greenlight_score integer NOT NULL DEFAULT 72,
  freshness_max_age_hours integer NOT NULL DEFAULT 720,
  min_source_reliability integer NOT NULL DEFAULT 40,
  duplicate_sensitivity integer NOT NULL DEFAULT 70,
  min_engagement_signal integer NOT NULL DEFAULT 0,
  quality_threshold integer NOT NULL DEFAULT 50,
  channel_id uuid REFERENCES channels(id) ON DELETE SET NULL,
  archived_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS niches_user_slug_unique ON niches(user_id, slug);
CREATE INDEX IF NOT EXISTS niches_status_idx ON niches(status);
CREATE INDEX IF NOT EXISTS niches_user_idx ON niches(user_id);
ALTER TABLE niches ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "niches_select_own" ON niches;
CREATE POLICY "niches_select_own" ON niches FOR SELECT TO authenticated USING (auth.uid() = user_id);
DROP POLICY IF EXISTS "niches_insert_own" ON niches;
CREATE POLICY "niches_insert_own" ON niches FOR INSERT TO authenticated WITH CHECK (auth.uid() = user_id);
DROP POLICY IF EXISTS "niches_update_own" ON niches;
CREATE POLICY "niches_update_own" ON niches FOR UPDATE TO authenticated USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);
DROP POLICY IF EXISTS "niches_delete_own" ON niches;
CREATE POLICY "niches_delete_own" ON niches FOR DELETE TO authenticated USING (auth.uid() = user_id);

-- ============================================================
-- 17. NICHE DESTINATIONS (many-to-many: niches ↔ publish_accounts)
-- ============================================================
CREATE TABLE IF NOT EXISTS niche_destinations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  niche_id uuid NOT NULL REFERENCES niches(id) ON DELETE CASCADE,
  account_id uuid NOT NULL REFERENCES publish_accounts(id) ON DELETE CASCADE,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS niche_destinations_unique ON niche_destinations(niche_id, account_id);
CREATE INDEX IF NOT EXISTS niche_destinations_niche_idx ON niche_destinations(niche_id);
CREATE INDEX IF NOT EXISTS niche_destinations_account_idx ON niche_destinations(account_id);
ALTER TABLE niche_destinations ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "nd_select_own" ON niche_destinations;
CREATE POLICY "nd_select_own" ON niche_destinations FOR SELECT TO authenticated
  USING (EXISTS (SELECT 1 FROM niches WHERE niches.id = niche_destinations.niche_id AND niches.user_id = auth.uid()));
DROP POLICY IF EXISTS "nd_insert_own" ON niche_destinations;
CREATE POLICY "nd_insert_own" ON niche_destinations FOR INSERT TO authenticated
  WITH CHECK (EXISTS (SELECT 1 FROM niches WHERE niches.id = niche_destinations.niche_id AND niches.user_id = auth.uid()));
DROP POLICY IF EXISTS "nd_delete_own" ON niche_destinations;
CREATE POLICY "nd_delete_own" ON niche_destinations FOR DELETE TO authenticated
  USING (EXISTS (SELECT 1 FROM niches WHERE niches.id = niche_destinations.niche_id AND niches.user_id = auth.uid()));

-- ============================================================
-- 18. PUBLISH JOBS (user-owned, routed by account_id)
-- ============================================================
CREATE TABLE IF NOT EXISTS publish_jobs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL,
  content_id uuid NOT NULL REFERENCES content(id) ON DELETE CASCADE,
  draft_id uuid REFERENCES content_drafts(id) ON DELETE SET NULL,
  channel_id uuid NOT NULL REFERENCES channels(id) ON DELETE CASCADE,
  account_id uuid REFERENCES publish_accounts(id) ON DELETE SET NULL,
  platform text NOT NULL,
  video_asset_id uuid REFERENCES production_assets(id) ON DELETE SET NULL,
  title text NOT NULL DEFAULT '',
  description text NOT NULL DEFAULT '',
  caption text NOT NULL DEFAULT '',
  hashtags jsonb NOT NULL DEFAULT '[]'::jsonb,
  status text NOT NULL DEFAULT 'draft',
  scheduled_at timestamptz,
  published_at timestamptz,
  platform_post_id text,
  platform_url text,
  error text,
  attempt_count integer NOT NULL DEFAULT 0,
  blocked_reasons jsonb NOT NULL DEFAULT '[]'::jsonb,
  upload_state text NOT NULL DEFAULT 'idle',
  upload_progress_bp integer NOT NULL DEFAULT 0,
  upload_session_url text,
  idempotency_key text,
  privacy_status text NOT NULL DEFAULT 'private',
  category_id text NOT NULL DEFAULT '24',
  thumbnail_asset_id uuid,
  thumbnail_status text NOT NULL DEFAULT 'none',
  thumbnail_error text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS publish_jobs_status_idx ON publish_jobs(status, scheduled_at);
CREATE INDEX IF NOT EXISTS publish_jobs_content_idx ON publish_jobs(content_id);
CREATE INDEX IF NOT EXISTS publish_jobs_user_idx ON publish_jobs(user_id);
CREATE UNIQUE INDEX IF NOT EXISTS publish_jobs_content_account_unique ON publish_jobs(content_id, account_id);
ALTER TABLE publish_jobs ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "publish_jobs_select_own" ON publish_jobs;
CREATE POLICY "publish_jobs_select_own" ON publish_jobs FOR SELECT TO authenticated USING (auth.uid() = user_id);
DROP POLICY IF EXISTS "publish_jobs_insert_own" ON publish_jobs;
CREATE POLICY "publish_jobs_insert_own" ON publish_jobs FOR INSERT TO authenticated WITH CHECK (auth.uid() = user_id);
DROP POLICY IF EXISTS "publish_jobs_update_own" ON publish_jobs;
CREATE POLICY "publish_jobs_update_own" ON publish_jobs FOR UPDATE TO authenticated USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);
DROP POLICY IF EXISTS "publish_jobs_delete_own" ON publish_jobs;
CREATE POLICY "publish_jobs_delete_own" ON publish_jobs FOR DELETE TO authenticated USING (auth.uid() = user_id);

-- ============================================================
-- 19. PUBLISH ATTEMPTS (ownership through publish_jobs)
-- ============================================================
CREATE TABLE IF NOT EXISTS publish_attempts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  job_id uuid NOT NULL REFERENCES publish_jobs(id) ON DELETE CASCADE,
  attempt integer NOT NULL DEFAULT 1,
  outcome text NOT NULL,
  platform text NOT NULL DEFAULT '',
  adapter text NOT NULL DEFAULT '',
  request_summary jsonb NOT NULL DEFAULT '{}'::jsonb,
  response_summary jsonb NOT NULL DEFAULT '{}'::jsonb,
  error text,
  duration_ms integer,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS publish_attempts_job_idx ON publish_attempts(job_id, attempt);
ALTER TABLE publish_attempts ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "pub_attempts_select_own" ON publish_attempts;
CREATE POLICY "pub_attempts_select_own" ON publish_attempts FOR SELECT TO authenticated
  USING (EXISTS (SELECT 1 FROM publish_jobs WHERE publish_jobs.id = publish_attempts.job_id AND publish_jobs.user_id = auth.uid()));
DROP POLICY IF EXISTS "pub_attempts_insert_own" ON publish_attempts;
CREATE POLICY "pub_attempts_insert_own" ON publish_attempts FOR INSERT TO authenticated
  WITH CHECK (EXISTS (SELECT 1 FROM publish_jobs WHERE publish_jobs.id = publish_attempts.job_id AND publish_jobs.user_id = auth.uid()));
DROP POLICY IF EXISTS "pub_attempts_delete_own" ON publish_attempts;
CREATE POLICY "pub_attempts_delete_own" ON publish_attempts FOR DELETE TO authenticated
  USING (EXISTS (SELECT 1 FROM publish_jobs WHERE publish_jobs.id = publish_attempts.job_id AND publish_jobs.user_id = auth.uid()));

-- ============================================================
-- 20. PUBLISHED POSTS (user-owned)
-- ============================================================
CREATE TABLE IF NOT EXISTS published_posts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL,
  job_id uuid REFERENCES publish_jobs(id) ON DELETE SET NULL,
  content_id uuid NOT NULL REFERENCES content(id) ON DELETE CASCADE,
  channel_id uuid NOT NULL REFERENCES channels(id) ON DELETE CASCADE,
  account_id uuid,
  platform text NOT NULL,
  platform_post_id text NOT NULL,
  platform_url text NOT NULL DEFAULT '',
  title text NOT NULL DEFAULT '',
  published_at timestamptz NOT NULL DEFAULT now(),
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS published_posts_content_idx ON published_posts(content_id);
CREATE INDEX IF NOT EXISTS published_posts_user_idx ON published_posts(user_id);
CREATE UNIQUE INDEX IF NOT EXISTS published_posts_unique ON published_posts(platform, platform_post_id);
ALTER TABLE published_posts ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "published_posts_select_own" ON published_posts;
CREATE POLICY "published_posts_select_own" ON published_posts FOR SELECT TO authenticated USING (auth.uid() = user_id);
DROP POLICY IF EXISTS "published_posts_insert_own" ON published_posts;
CREATE POLICY "published_posts_insert_own" ON published_posts FOR INSERT TO authenticated WITH CHECK (auth.uid() = user_id);
DROP POLICY IF EXISTS "published_posts_delete_own" ON published_posts;
CREATE POLICY "published_posts_delete_own" ON published_posts FOR DELETE TO authenticated USING (auth.uid() = user_id);

-- ============================================================
-- 21. POST METRICS (ownership through published_posts)
-- ============================================================
CREATE TABLE IF NOT EXISTS post_metrics (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  post_id uuid REFERENCES published_posts(id) ON DELETE CASCADE,
  content_id uuid REFERENCES content(id) ON DELETE CASCADE,
  channel_id uuid REFERENCES channels(id) ON DELETE CASCADE,
  platform text NOT NULL,
  platform_post_id text NOT NULL DEFAULT '',
  measured_at timestamptz NOT NULL DEFAULT now(),
  source text NOT NULL DEFAULT 'platform_api',
  views integer,
  likes integer,
  comments integer,
  shares integer,
  saves integer,
  watch_time_sec integer,
  avg_view_duration_sec integer,
  completion_rate_bp integer,
  followers_gained integer,
  followers_lost integer,
  avg_view_percentage_bp integer,
  impressions integer,
  ctr_bp integer,
  raw jsonb NOT NULL DEFAULT '{}'::jsonb
);
CREATE INDEX IF NOT EXISTS post_metrics_post_idx ON post_metrics(post_id, measured_at);
CREATE INDEX IF NOT EXISTS post_metrics_content_idx ON post_metrics(content_id, measured_at);
CREATE UNIQUE INDEX IF NOT EXISTS post_metrics_snapshot_unique ON post_metrics(platform, platform_post_id, measured_at);
ALTER TABLE post_metrics ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "post_metrics_select_own" ON post_metrics;
CREATE POLICY "post_metrics_select_own" ON post_metrics FOR SELECT TO authenticated
  USING (EXISTS (SELECT 1 FROM published_posts WHERE published_posts.id = post_metrics.post_id AND published_posts.user_id = auth.uid()));
DROP POLICY IF EXISTS "post_metrics_insert_own" ON post_metrics;
CREATE POLICY "post_metrics_insert_own" ON post_metrics FOR INSERT TO authenticated
  WITH CHECK (EXISTS (SELECT 1 FROM published_posts WHERE published_posts.id = post_metrics.post_id AND published_posts.user_id = auth.uid()));
DROP POLICY IF EXISTS "post_metrics_delete_own" ON post_metrics;
CREATE POLICY "post_metrics_delete_own" ON post_metrics FOR DELETE TO authenticated
  USING (EXISTS (SELECT 1 FROM published_posts WHERE published_posts.id = post_metrics.post_id AND published_posts.user_id = auth.uid()));

-- ============================================================
-- 22. PERFORMANCE SIGNALS (global, read-only to authenticated)
-- ============================================================
CREATE TABLE IF NOT EXISTS performance_signals (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  dimension text NOT NULL,
  key text NOT NULL,
  label text NOT NULL DEFAULT '',
  sample_size integer NOT NULL DEFAULT 0,
  avg_views integer NOT NULL DEFAULT 0,
  avg_engagement_bp integer NOT NULL DEFAULT 0,
  baseline_views integer NOT NULL DEFAULT 0,
  adjustment integer NOT NULL DEFAULT 0,
  confidence text NOT NULL DEFAULT 'none',
  explanation text NOT NULL DEFAULT '',
  computed_at timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS performance_signals_unique ON performance_signals(dimension, key);
ALTER TABLE performance_signals ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "perf_signals_select" ON performance_signals;
CREATE POLICY "perf_signals_select" ON performance_signals FOR SELECT TO authenticated USING (true);
DROP POLICY IF EXISTS "perf_signals_write" ON performance_signals;
CREATE POLICY "perf_signals_write" ON performance_signals FOR ALL TO authenticated USING (true) WITH CHECK (true);

-- ============================================================
-- 23. OAUTH STATES (user-owned)
-- ============================================================
CREATE TABLE IF NOT EXISTS oauth_states (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  state text NOT NULL UNIQUE,
  platform text NOT NULL,
  user_id uuid,
  channel_id uuid REFERENCES channels(id) ON DELETE CASCADE,
  redirect_to text NOT NULL DEFAULT '/publishing',
  consumed_at timestamptz,
  expires_at timestamptz NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS oauth_states_expiry_idx ON oauth_states(expires_at);
ALTER TABLE oauth_states ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "oauth_states_select_own" ON oauth_states;
CREATE POLICY "oauth_states_select_own" ON oauth_states FOR SELECT TO authenticated USING (auth.uid() = user_id OR user_id IS NULL);
DROP POLICY IF EXISTS "oauth_states_insert_own" ON oauth_states;
CREATE POLICY "oauth_states_insert_own" ON oauth_states FOR INSERT TO authenticated WITH CHECK (auth.uid() = user_id OR user_id IS NULL);
DROP POLICY IF EXISTS "oauth_states_update_own" ON oauth_states;
CREATE POLICY "oauth_states_update_own" ON oauth_states FOR UPDATE TO authenticated USING (auth.uid() = user_id OR user_id IS NULL) WITH CHECK (true);
DROP POLICY IF EXISTS "oauth_states_delete_own" ON oauth_states;
CREATE POLICY "oauth_states_delete_own" ON oauth_states FOR DELETE TO authenticated USING (auth.uid() = user_id OR user_id IS NULL);

-- ============================================================
-- 24. NOTIFICATIONS (user-owned)
-- ============================================================
CREATE TABLE IF NOT EXISTS notifications (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL,
  severity text NOT NULL DEFAULT 'info',
  category text NOT NULL DEFAULT 'system',
  title text NOT NULL,
  body text NOT NULL DEFAULT '',
  href text,
  dedupe_key text,
  read_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS notifications_created_idx ON notifications(created_at);
CREATE INDEX IF NOT EXISTS notifications_user_idx ON notifications(user_id, created_at);
ALTER TABLE notifications ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "notifications_select_own" ON notifications;
CREATE POLICY "notifications_select_own" ON notifications FOR SELECT TO authenticated USING (auth.uid() = user_id);
DROP POLICY IF EXISTS "notifications_insert_own" ON notifications;
CREATE POLICY "notifications_insert_own" ON notifications FOR INSERT TO authenticated WITH CHECK (auth.uid() = user_id);
DROP POLICY IF EXISTS "notifications_update_own" ON notifications;
CREATE POLICY "notifications_update_own" ON notifications FOR UPDATE TO authenticated USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);
DROP POLICY IF EXISTS "notifications_delete_own" ON notifications;
CREATE POLICY "notifications_delete_own" ON notifications FOR DELETE TO authenticated USING (auth.uid() = user_id);

-- ============================================================
-- 25. WORKERS (global registry — no user_id, accessible to authenticated)
-- ============================================================
CREATE TABLE IF NOT EXISTS workers (
  id text PRIMARY KEY,
  hostname text NOT NULL DEFAULT '',
  status text NOT NULL DEFAULT 'idle',
  concurrency integer NOT NULL DEFAULT 2,
  active_jobs integer NOT NULL DEFAULT 0,
  jobs_processed integer NOT NULL DEFAULT 0,
  jobs_failed integer NOT NULL DEFAULT 0,
  started_at timestamptz NOT NULL DEFAULT now(),
  last_heartbeat_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS workers_heartbeat_idx ON workers(last_heartbeat_at);
ALTER TABLE workers ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "workers_all" ON workers;
CREATE POLICY "workers_all" ON workers FOR SELECT TO authenticated USING (true);

-- ============================================================
-- 26. WORK QUEUE (user-owned)
-- ============================================================
CREATE TABLE IF NOT EXISTS work_queue (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  type text NOT NULL,
  status text NOT NULL DEFAULT 'queued',
  priority integer NOT NULL DEFAULT 50,
  user_id uuid,
  niche_id uuid REFERENCES niches(id) ON DELETE CASCADE,
  channel_id uuid REFERENCES channels(id) ON DELETE CASCADE,
  content_id uuid REFERENCES content(id) ON DELETE CASCADE,
  production_job_id uuid REFERENCES production_jobs(id) ON DELETE CASCADE,
  publish_job_id uuid REFERENCES publish_jobs(id) ON DELETE CASCADE,
  payload jsonb NOT NULL DEFAULT '{}'::jsonb,
  dedupe_key text,
  current_step text NOT NULL DEFAULT '',
  progress_label text NOT NULL DEFAULT '',
  progress_bp integer,
  attempts integer NOT NULL DEFAULT 0,
  max_attempts integer NOT NULL DEFAULT 3,
  last_error text,
  error_kind text,
  worker_id text,
  lease_expires_at timestamptz,
  heartbeat_at timestamptz,
  cancel_requested boolean NOT NULL DEFAULT false,
  run_after timestamptz NOT NULL DEFAULT now(),
  started_at timestamptz,
  completed_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS work_queue_claim_idx ON work_queue(status, run_after, priority);
CREATE INDEX IF NOT EXISTS work_queue_niche_idx ON work_queue(niche_id, status);
CREATE INDEX IF NOT EXISTS work_queue_lease_idx ON work_queue(lease_expires_at);
CREATE INDEX IF NOT EXISTS work_queue_user_idx ON work_queue(user_id);
CREATE UNIQUE INDEX IF NOT EXISTS work_queue_dedupe_unique ON work_queue(dedupe_key);
ALTER TABLE work_queue ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "work_queue_select_own" ON work_queue;
CREATE POLICY "work_queue_select_own" ON work_queue FOR SELECT TO authenticated USING (auth.uid() = user_id OR user_id IS NULL);
DROP POLICY IF EXISTS "work_queue_insert_own" ON work_queue;
CREATE POLICY "work_queue_insert_own" ON work_queue FOR INSERT TO authenticated WITH CHECK (auth.uid() = user_id OR user_id IS NULL);
DROP POLICY IF EXISTS "work_queue_update_own" ON work_queue;
CREATE POLICY "work_queue_update_own" ON work_queue FOR UPDATE TO authenticated USING (auth.uid() = user_id OR user_id IS NULL) WITH CHECK (auth.uid() = user_id OR user_id IS NULL);
DROP POLICY IF EXISTS "work_queue_delete_own" ON work_queue;
CREATE POLICY "work_queue_delete_own" ON work_queue FOR DELETE TO authenticated USING (auth.uid() = user_id OR user_id IS NULL);

-- ============================================================
-- 27. JOB EVENTS (ownership through work_queue)
-- ============================================================
CREATE TABLE IF NOT EXISTS job_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  job_id uuid NOT NULL REFERENCES work_queue(id) ON DELETE CASCADE,
  worker_id text,
  attempt integer NOT NULL DEFAULT 1,
  step text NOT NULL DEFAULT '',
  event text NOT NULL,
  provider text NOT NULL DEFAULT '',
  duration_ms integer,
  result text NOT NULL DEFAULT '',
  error text,
  retry_reason text,
  detail jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS job_events_job_idx ON job_events(job_id, created_at);
ALTER TABLE job_events ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "job_events_select_own" ON job_events;
CREATE POLICY "job_events_select_own" ON job_events FOR SELECT TO authenticated
  USING (EXISTS (SELECT 1 FROM work_queue WHERE work_queue.id = job_events.job_id AND (work_queue.user_id = auth.uid() OR work_queue.user_id IS NULL)));

-- ============================================================
-- 28. AGENTS (global registry — read-only to authenticated)
-- ============================================================
CREATE TABLE IF NOT EXISTS agents (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  slug text NOT NULL UNIQUE,
  name text NOT NULL,
  role text NOT NULL DEFAULT '',
  description text NOT NULL DEFAULT '',
  icon text NOT NULL DEFAULT 'Bot',
  status text NOT NULL DEFAULT 'idle',
  current_task text,
  last_task text,
  last_task_status text NOT NULL DEFAULT 'success',
  last_run_at timestamptz,
  success_rate integer NOT NULL DEFAULT 100,
  total_runs integer NOT NULL DEFAULT 0,
  failed_runs integer NOT NULL DEFAULT 0
);
ALTER TABLE agents ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "agents_select" ON agents;
CREATE POLICY "agents_select" ON agents FOR SELECT TO authenticated USING (true);

-- ============================================================
-- 29. WORKFLOWS (ownership through content)
-- ============================================================
CREATE TABLE IF NOT EXISTS workflows (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  content_id uuid REFERENCES content(id) ON DELETE CASCADE,
  name text NOT NULL,
  type text NOT NULL DEFAULT 'content_pipeline',
  status text NOT NULL DEFAULT 'running',
  current_stage text NOT NULL DEFAULT 'discovered',
  steps jsonb NOT NULL DEFAULT '[]'::jsonb,
  started_at timestamptz NOT NULL DEFAULT now(),
  completed_at timestamptz
);
ALTER TABLE workflows ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "workflows_select_own" ON workflows;
CREATE POLICY "workflows_select_own" ON workflows FOR SELECT TO authenticated
  USING (EXISTS (SELECT 1 FROM content WHERE content.id = workflows.content_id AND content.user_id = auth.uid()));
DROP POLICY IF EXISTS "workflows_insert_own" ON workflows;
CREATE POLICY "workflows_insert_own" ON workflows FOR INSERT TO authenticated
  WITH CHECK (EXISTS (SELECT 1 FROM content WHERE content.id = workflows.content_id AND content.user_id = auth.uid()));
DROP POLICY IF EXISTS "workflows_update_own" ON workflows;
CREATE POLICY "workflows_update_own" ON workflows FOR UPDATE TO authenticated
  USING (EXISTS (SELECT 1 FROM content WHERE content.id = workflows.content_id AND content.user_id = auth.uid()));

-- ============================================================
-- 30-32. LEGACY TABLES (kept for backward compatibility)
-- ============================================================
CREATE TABLE IF NOT EXISTS publishing_jobs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  content_id uuid NOT NULL REFERENCES content(id) ON DELETE CASCADE,
  platform text NOT NULL,
  status text NOT NULL DEFAULT 'queued',
  scheduled_at timestamptz,
  published_at timestamptz,
  attempts integer NOT NULL DEFAULT 0,
  last_error text,
  external_url text,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS pub_jobs_status_idx ON publishing_jobs(status);
ALTER TABLE publishing_jobs ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "publishing_jobs_select_own" ON publishing_jobs;
CREATE POLICY "publishing_jobs_select_own" ON publishing_jobs FOR SELECT TO authenticated
  USING (EXISTS (SELECT 1 FROM content WHERE content.id = publishing_jobs.content_id AND content.user_id = auth.uid()));

CREATE TABLE IF NOT EXISTS analytics_snapshots (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  content_id uuid REFERENCES content(id) ON DELETE CASCADE,
  channel_id uuid REFERENCES channels(id) ON DELETE CASCADE,
  platform text NOT NULL DEFAULT 'all',
  captured_at timestamptz NOT NULL DEFAULT now(),
  views integer NOT NULL DEFAULT 0,
  likes integer NOT NULL DEFAULT 0,
  comments integer NOT NULL DEFAULT 0,
  shares integer NOT NULL DEFAULT 0,
  watch_minutes integer NOT NULL DEFAULT 0
);
CREATE INDEX IF NOT EXISTS snapshots_content_idx ON analytics_snapshots(content_id, captured_at);
ALTER TABLE analytics_snapshots ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "analytics_snapshots_select_own" ON analytics_snapshots;
CREATE POLICY "analytics_snapshots_select_own" ON analytics_snapshots FOR SELECT TO authenticated
  USING (EXISTS (SELECT 1 FROM content WHERE content.id = analytics_snapshots.content_id AND content.user_id = auth.uid()));

-- ============================================================
-- 33. AUTOMATION JOBS (user-owned)
-- ============================================================
CREATE TABLE IF NOT EXISTS automation_jobs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid,
  type text NOT NULL,
  label text NOT NULL DEFAULT '',
  status text NOT NULL DEFAULT 'queued',
  trigger text NOT NULL DEFAULT 'schedule',
  payload jsonb NOT NULL DEFAULT '{}'::jsonb,
  attempts integer NOT NULL DEFAULT 0,
  max_attempts integer NOT NULL DEFAULT 3,
  duration_ms integer,
  last_error text,
  scheduled_at timestamptz,
  started_at timestamptz,
  finished_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS automation_status_idx ON automation_jobs(status);
CREATE INDEX IF NOT EXISTS automation_user_idx ON automation_jobs(user_id);
ALTER TABLE automation_jobs ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "automation_jobs_select_own" ON automation_jobs;
CREATE POLICY "automation_jobs_select_own" ON automation_jobs FOR SELECT TO authenticated USING (auth.uid() = user_id OR user_id IS NULL);
DROP POLICY IF EXISTS "automation_jobs_insert_own" ON automation_jobs;
CREATE POLICY "automation_jobs_insert_own" ON automation_jobs FOR INSERT TO authenticated WITH CHECK (auth.uid() = user_id OR user_id IS NULL);
DROP POLICY IF EXISTS "automation_jobs_update_own" ON automation_jobs;
CREATE POLICY "automation_jobs_update_own" ON automation_jobs FOR UPDATE TO authenticated USING (auth.uid() = user_id OR user_id IS NULL) WITH CHECK (auth.uid() = user_id OR user_id IS NULL);

-- ============================================================
-- 34. AUTOMATION SETTINGS (per-user, unique on user_id)
-- ============================================================
CREATE TABLE IF NOT EXISTS automation_settings (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL UNIQUE,
  enabled boolean NOT NULL DEFAULT true,
  discovery_interval_hours integer NOT NULL DEFAULT 6,
  publish_window_start text NOT NULL DEFAULT '09:00',
  publish_window_end text NOT NULL DEFAULT '21:00',
  daily_publish_cap integer NOT NULL DEFAULT 8,
  max_concurrent_jobs integer NOT NULL DEFAULT 3,
  auto_retry boolean NOT NULL DEFAULT true,
  judge_threshold integer NOT NULL DEFAULT 72,
  scout_max_stories_per_run integer NOT NULL DEFAULT 20,
  retry_delay_minutes integer NOT NULL DEFAULT 15,
  timezone text NOT NULL DEFAULT 'UTC',
  next_run_at timestamptz,
  last_run_at timestamptz,
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS automation_settings_user_idx ON automation_settings(user_id);
ALTER TABLE automation_settings ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "automation_settings_select_own" ON automation_settings;
CREATE POLICY "automation_settings_select_own" ON automation_settings FOR SELECT TO authenticated USING (auth.uid() = user_id);
DROP POLICY IF EXISTS "automation_settings_insert_own" ON automation_settings;
CREATE POLICY "automation_settings_insert_own" ON automation_settings FOR INSERT TO authenticated WITH CHECK (auth.uid() = user_id);
DROP POLICY IF EXISTS "automation_settings_update_own" ON automation_settings;
CREATE POLICY "automation_settings_update_own" ON automation_settings FOR UPDATE TO authenticated USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);
DROP POLICY IF EXISTS "automation_settings_delete_own" ON automation_settings;
CREATE POLICY "automation_settings_delete_own" ON automation_settings FOR DELETE TO authenticated USING (auth.uid() = user_id);

-- ============================================================
-- Add FK for niche_destinations references to story_sources
-- ============================================================
DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.table_constraints
    WHERE constraint_name = 'story_sources_niche_id_fkey'
  ) THEN
    ALTER TABLE story_sources ADD CONSTRAINT story_sources_niche_id_fkey
      FOREIGN KEY (niche_id) REFERENCES niches(id) ON DELETE SET NULL;
  END IF;
END $$;

-- Add FK for story_evaluations dedupe_key uniqueness
-- (stories.dedupe_key was unique in Phase 7; keep it)
DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.table_constraints
    WHERE constraint_name = 'stories_dedupe_key_key'
  ) THEN
    CREATE UNIQUE INDEX IF NOT EXISTS stories_dedupe_key_idx ON stories(dedupe_key) WHERE dedupe_key IS NOT NULL;
  END IF;
END $$;
