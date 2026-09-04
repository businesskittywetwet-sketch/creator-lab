# Viboro Creator Lab — PRD & Phase 8 Status

## Original problem statement
Continue development of an existing multi-phase Next.js/Supabase application called Viboro Creator Lab. Phases 3–7 were audited as complete (33-table schema, durable work queue, workers/leases, FFmpeg rendering, YouTube OAuth, analytics, cron routes). Phase 8 goal: multi-tenant Supabase auth with per-user `user_id` scoping enforced by RLS, without rebuilding or simplifying Phases 3–7.

## Architecture (as audited — do not modify)
- Next.js 16.2.6 App Router, React 19, TypeScript strict, Tailwind 4.
- Drizzle ORM + `node-postgres` connected to Supabase Postgres.
- 33 tables, 92 indexes, 42 FKs, 105 RLS policies (Phase 8 migration).
- Engine at `src/engine/*` (13 modules) — do not duplicate logic.
- Cron at `/api/cron/{scout,production,worker,publishing}` (vercel.json).
- YouTube OAuth at `/api/oauth/youtube/{start,callback}` with encrypted tokens.
- Supabase auth pages: `/login`, `/signup`, middleware at `src/middleware.ts`.
- Audit scripts under `scripts/`: `audit-phase3.ts`, `e2e-phase4.ts`, `audit-phase5.ts`, `audit-phase6.ts`, `audit-phase7.ts`, `audit7-{crash,perf}.ts`, plus `audit51-{fail,ops,prod,scout}.ts`, `e2e-gates.ts`, `verify-production.ts`.

## Phase 8 — Work completed this session
1. **Environment provisioned** — `/app/.env` created with:
   - `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY`, `SUPABASE_SERVICE_ROLE_KEY` (from user).
   - `SUPABASE_DB_URL` + `DATABASE_URL` = transaction pooler (port 6543), password URL-encoded.
   - `TOKEN_ENCRYPTION_KEY` = 64 hex chars (freshly generated).
   - `CRON_SECRET` = 48 hex chars (freshly generated).
   - Values recorded in `/app/memory/test_credentials.md` (private).
2. **Dependencies installed** — `yarn install --ignore-engines` (Node 20 in container vs. `@supabase/supabase-js` engines: ">=22"; runtime works, warning only).
3. **Migration applied** — `supabase/migrations/20260826140905_phase8_full_schema.sql` executed against the live Supabase database via `pg` client on the transaction pooler.
4. **Schema verified against live DB**:
   - **Tables in `public`: 33/33** (schema.ts and migration file agree; migration header comment "40 total" is stale and cosmetic).
   - **RLS enabled: 33/33 tables.**
   - **Policies: 105.**
   - **Indexes: 92.**
   - **Foreign keys: 42.**
5. **DB connectivity confirmed** — `pg.Client` connects as `postgres` via the pooler with SSL.
6. **Codebase security audit performed (read-only)** — every server action, engine module, API route, cron route and dashboard page inspected. Findings and remaining work below.

## Phase 8 — Work NOT completed (must be done in a follow-up session)

**Critical scope:** The Phase 8 migration added `user_id` (NOT NULL, FK to `auth.users`) to 14+ tables. The Phase 3–7 engine and all server actions **never write or read `user_id`**. TypeScript strict mode now reports **52 compile errors** — the app does not build.

### Compile error distribution
| File | Errors | Notes |
|---|---|---|
| `src/db/seed.ts` | 21 | Every seed insert missing `userId`. |
| `src/app/` (pages/layout) | 6 | Layout props signature mismatch. |
| `src/engine/niches.ts` | 5 | createNiche / addSource / adoptLegacyChannels writes miss `userId`. |
| `src/engine/scout.ts` | 4 | `stories` / `story_sources` inserts miss `userId`. |
| `src/engine/settings.ts` | 3 | `automation_settings` now unique on `user_id`, not `id=1`. |
| `src/engine/publishing.ts` | 3 | `publish_jobs` / `publish_accounts` writes miss `userId`. |
| `src/engine/notifications.ts` | 1 | `notifications` insert misses `userId`. |
| `src/engine/youtube.ts` | 1 | `null` passed where string expected. |
| `src/app/actions.ts` | 2 | `createChannel` + `advanceStoryToContent` miss `userId`. |
| `src/lib/services/youtube/oauth.ts` | 1 | `publish_accounts` write on OAuth callback misses `userId`. |
| scripts (audit51-ops, audit-phase6, audit6-live-path) | 5 | Same pattern. |
| **Total** | **52** | |

### The correct fix (single-session refactor plan for follow-up)
1. **Auth helper** — create `src/lib/auth.ts` exporting `getCurrentUserId()` (Server Component / Server Action / Route Handler variant) backed by `createServerSupabaseClient()`. Throws if unauthenticated.
2. **Actions layer** — every write in `src/app/actions.ts` calls `getCurrentUserId()` and passes it to the engine.
3. **Engine layer** — extend every write function to accept `userId: string` as a first-class argument (not pulled from session, so cron/worker paths can pass a stored `userId` from the row they're working on). Every read query filters by `userId` where the table carries one.
4. **Cron / worker paths** — jobs already carry `nicheId` / `channelId` / `contentId`; resolve `user_id` from those parent rows before running child work.
5. **YouTube OAuth callback** — carry the initiating `user_id` through `oauth_states` and stamp it on `publish_accounts` at persistence.
6. **Seed script** — accept `--user-id=<uuid>` argument and stamp every row with it; refuse to run without one.
7. **Dashboard pages** — every query in `src/app/(dashboard)/**/page.tsx` calls `getCurrentUserId()` and filters by `user_id` (defence-in-depth; RLS is the ultimate enforcement).
8. **Middleware** — already redirects unauth to `/login`; leave in place. Confirm `/api/*` (non-cron) also require auth.
9. **Cron auth** — `CRON_SECRET` already enforced (fails closed in prod). Confirmed present in `.env`.
10. **Cross-user isolation tests** (option 5c) — new `scripts/audit-phase8-isolation.ts`:
    - Create two disposable auth users via service-role admin API.
    - Sign in as each, mint short-lived JWTs, make PostgREST calls to `channels`, `niches`, `stories`, `content`, `publish_accounts`, `notifications`, `work_queue`, etc.
    - Assert each user sees only own rows and cannot mutate the other's rows.
    - Delete both users when done.

## Verification suite — Status

| Step | Status | Notes |
|---|---|---|
| Migration applied to live DB | ✅ PASS | 33 tables, 105 policies, 92 indexes, 42 FKs — all present. |
| Schema verification | ✅ PASS | RLS on 33/33. |
| `yarn install` | ✅ PASS | with `--ignore-engines` (Node 20 container). |
| `yarn typecheck` | ❌ FAIL | **52 errors**, all rooted in Phase 3–7 code not knowing about `user_id` (see table above). |
| `yarn lint` | ⏭ SKIPPED | Blocked by typecheck. |
| `yarn build` | ⏭ SKIPPED | Blocked by typecheck. |
| `audit-phase3.ts` | ⏭ SKIPPED | Blocked by typecheck / missing `user_id` at write sites. |
| `e2e-phase4.ts` | ⏭ SKIPPED | Same. |
| `audit-phase5.ts` | ⏭ SKIPPED | Same. |
| `audit-phase6.ts` | ⏭ SKIPPED | Same. |
| `audit-phase7.ts` | ⏭ SKIPPED | Same. |
| `audit7-crash.ts` / `audit7-perf.ts` | ⏭ SKIPPED | Same. |
| Auth flow live smoke | ⏭ SKIPPED | Runtime blocked by build. |
| Cross-user isolation | ⏭ SKIPPED | Script not written yet. |

## Data integrity guarantees currently in place
- **RLS is active on all 33 public tables** — even if the (currently non-compiling) app were run with a user JWT, cross-user reads/writes would be blocked at the database.
- **Service-role connections bypass RLS** — because `src/db/index.ts` uses raw `pg.Pool` with the `postgres` superuser via the pooler, the engine currently operates *without* RLS enforcement. The follow-up refactor must either (a) route user-triggered writes through a JWT-scoped client, or (b) filter every query by `userId` explicitly (defence-in-depth). This is documented in the follow-up plan above.

## What is safe to do right now
- Nothing that changes source code — a partial edit would break Phases 3–7 mid-refactor.
- The DB is live and migrated; you can inspect it in Supabase Studio.
- Sign-up via `/login`/`/signup` will succeed in Supabase Auth (the pages are wired), but the dashboard cannot render until the build compiles.

## Next tasks (P0 for next session)
1. Implement the 10-step refactor plan above end-to-end.
2. Get `yarn typecheck && yarn lint && yarn build` green.
3. Run every audit script and record results.
4. Write and run `scripts/audit-phase8-isolation.ts`.
5. Only then declare Phase 8 complete.
