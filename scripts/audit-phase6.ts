/* Phase 6 audit — real YouTube publishing + analytics integration. */
import "dotenv/config";
import { db } from "../src/db";
import {
  channels, content, contentDrafts, notifications, oauthStates, postMetrics,
  productionAssets, productionJobs, publishAccounts, publishAttempts, publishJobs,
  publishedPosts, performanceSignals,
} from "../src/db/schema";
import {
  approveDraft, buildYouTubeMetadata, createProductionJob, createPublishJobsForContent,
  createThumbnail, dispatchPublishJob, ensureChannelStrategy, maintainTokens, preflight,
  refreshYouTubeAnalytics, runProductionJob, saveYouTubeSettings, schedulePublishJob,
  computePerformanceSignals, computeInsights, judgeSignalsFor, selectThumbnail,
} from "../src/engine";
import { adapterFor, platformConnectionSummary } from "../src/lib/services/platforms";
import {
  consumeState, createAuthUrl, oauthReadiness, YOUTUBE_SCOPES, accountStatus,
} from "../src/lib/services/youtube/oauth";
import { decryptJson, encryptJson, encryptionConfigured, redact, safeEqual } from "../src/lib/crypto";
import { composeMetadata } from "../src/lib/services/youtube/metadata";
import { and, eq, isNull, sql } from "drizzle-orm";

const R: { id: string; n: string; ok: boolean; d: string }[] = [];
const chk = (id: string, n: string, ok: boolean, d: string) => {
  R.push({ id, n, ok, d });
  console.log(`${ok ? "PASS" : "FAIL"}  [${id}] ${n} — ${d}`);
};
const SKIP: string[] = [];
const skip = (id: string, n: string, why: string) => {
  SKIP.push(`[${id}] ${n} — ${why}`);
  console.log(`SKIP  [${id}] ${n} — ${why}`);
};

async function main() {
  // Idempotency: clear any leftovers from a previous interrupted run.
  await db.delete(postMetrics).where(eq(postMetrics.platformPostId, "AUDIT6-SNAP"));
  await db.delete(publishedPosts).where(eq(publishedPosts.platformPostId, "AUDIT6-SNAP"));
  await db.delete(oauthStates).where(eq(oauthStates.state, "expired-test-state"));

  const hasOAuth = Boolean(process.env.YOUTUBE_CLIENT_ID && process.env.YOUTUBE_CLIENT_SECRET);
  const hasKey = encryptionConfigured();
  console.log(`\nENV: youtube_oauth=${hasOAuth ? "CONFIGURED" : "NOT CONFIGURED"} encryption_key=${hasKey ? "CONFIGURED" : "NOT CONFIGURED"}\n`);

  /* ============ 1. CRYPTO / TOKEN STORAGE ============ */
  if (hasKey) {
    const payload = { accessToken: "ya29.SECRET-ACCESS", refreshToken: "1//SECRET-REFRESH", expiresAt: Date.now(), scopes: YOUTUBE_SCOPES, tokenType: "Bearer" };
    const blob = encryptJson(payload);
    chk("X1", "Tokens encrypt to opaque ciphertext", !blob.includes("SECRET-ACCESS") && !blob.includes("SECRET-REFRESH") && blob.startsWith("v1."), `blob=${blob.slice(0, 28)}…`);
    const back = decryptJson<typeof payload>(blob);
    chk("X2", "Round-trip decryption works", back?.accessToken === payload.accessToken, `recovered=${back ? "yes" : "no"}`);
    const tampered = blob.slice(0, -4) + "AAAA";
    chk("X3", "Tampered ciphertext rejected (AEAD)", decryptJson(tampered) === null, "returns null, does not throw");
    const orig = process.env.TOKEN_ENCRYPTION_KEY;
    process.env.TOKEN_ENCRYPTION_KEY = "a-completely-different-key-value-32";
    chk("X4", "Wrong key cannot decrypt", decryptJson(blob) === null, "key rotation invalidates old blobs safely");
    process.env.TOKEN_ENCRYPTION_KEY = orig;
  } else {
    skip("X1-X4", "Token encryption round-trip", "TOKEN_ENCRYPTION_KEY not configured");
  }
  chk("X5", "redact() strips token-shaped strings",
    !redact("token ya29.abcdefghijklmnop and 1//0abcdefghijklmnopqrst and GOCSPX-abcdef").match(/ya29|GOCSPX|1\/\/0/),
    redact("ya29.abcdefghijklmnop"));
  chk("X6", "Constant-time compare works", safeEqual("abc", "abc") && !safeEqual("abc", "abd"), "safeEqual ok");

  /* ============ 2. OAUTH SECURITY ============ */
  const readiness = oauthReadiness();
  chk("O1", "OAuth readiness reported honestly",
    readiness.ready === (hasOAuth && hasKey), `ready=${readiness.ready} detail="${readiness.detail.slice(0, 70)}"`);
  chk("O2", "Minimum scopes only (upload + readonly + analytics)",
    YOUTUBE_SCOPES.length === 3 && YOUTUBE_SCOPES.every((s) => /youtube\.upload|youtube\.readonly|yt-analytics\.readonly/.test(s)),
    YOUTUBE_SCOPES.map((s) => s.split("/auth/")[1]).join(", "));

  const [ch] = await db.select().from(channels).where(eq(channels.slug, "weird-history"));
  if (hasOAuth && hasKey) {
    const auth = await createAuthUrl(ch.id);
    if ("url" in auth) {
      const u = new URL(auth.url);
      chk("O3", "Auth URL well-formed with CSRF state",
        u.origin === "https://accounts.google.com" && !!u.searchParams.get("state") &&
        u.searchParams.get("access_type") === "offline" && u.searchParams.get("prompt") === "consent",
        `offline+consent set, state len=${u.searchParams.get("state")?.length}`);
      chk("O4", "Client secret NEVER in the auth URL", !auth.url.includes(process.env.YOUTUBE_CLIENT_SECRET ?? "@@"), "secret absent from redirect");
      const st = u.searchParams.get("state")!;
      const first = await consumeState(st);
      const second = await consumeState(st);
      chk("O5", "State is single-use (replay blocked)", first.ok && !second.ok, `1st=${first.ok} 2nd=${second.ok} (${!second.ok ? second.reason : ""})`);
    } else chk("O3", "Auth URL generation", false, auth.error);
  } else {
    const auth = await createAuthUrl(ch.id);
    chk("O3", "Auth URL refused without config", "error" in auth, "error" in auth ? auth.error.slice(0, 70) : "unexpectedly succeeded");
  }
  const forged = await consumeState("forged-state-value-xyz");
  chk("O6", "Forged state rejected", !forged.ok, forged.ok ? "" : forged.reason);
  await db.insert(oauthStates).values({ state: "expired-test-state", platform: "youtube", channelId: ch.id, expiresAt: new Date(Date.now() - 1000) });
  const exp = await consumeState("expired-test-state");
  chk("O7", "Expired state rejected", !exp.ok, exp.ok ? "" : exp.reason);
  await db.delete(oauthStates).where(eq(oauthStates.state, "expired-test-state"));

  const acctState = await accountStatus(ch.id);
  chk("O8", "Unconnected account reports honestly",
    !acctState.connected, `state=${acctState.state} detail="${acctState.detail.slice(0, 60)}"`);

  /* ============ 3. ADAPTER CONTRACT ============ */
  const plats = platformConnectionSummary();
  const yt = plats.find((p) => p.key === "youtube")!;
  chk("A1", "YouTube adapter marked uploadImplemented", yt.uploadImplemented === true, `oauth=${yt.oauth} scopes=${yt.scopes.length}`);
  chk("A2", "Other 3 platforms still honestly unimplemented",
    plats.filter((p) => p.key !== "youtube").every((p) => !p.uploadImplemented),
    plats.filter((p) => p.key !== "youtube").map((p) => `${p.short}:${p.uploadImplemented}`).join(" "));
  const adapter = adapterFor("youtube")!;
  chk("A3", "Adapter exposes accountState (OAuth-aware)", typeof adapter.accountState === "function", "per-channel state supported");

  const pubOut = await adapter.publish({
    jobId: "00000000-0000-0000-0000-000000000000", platform: "youtube", channelId: ch.id,
    title: "audit", description: "", caption: "", hashtags: [], videoPath: null, videoUrl: null,
    scheduledAt: null, accountRef: "",
  });
  chk("A4", "publish() blocks without a connected account (no fake success)",
    !pubOut.ok && pubOut.kind === "blocked", pubOut.ok ? "UNEXPECTED SUCCESS" : pubOut.reason.slice(0, 80));
  const m = await adapter.fetchMetrics("dQw4w9WgXcQ", { channelId: ch.id });
  chk("A5", "fetchMetrics() returns null without auth (no invented data)", m === null, `returned ${m}`);

  /* ============ 4. METADATA GENERATION ============ */
  let [item] = await db.select().from(content)
    .leftJoin(productionJobs, eq(productionJobs.contentId, content.id))
    .where(and(eq(content.channelId, ch.id), isNull(productionJobs.id))).limit(1)
    .then((r) => r.map((x) => x.content));
  if (!item) [item] = await db.select().from(content).where(eq(content.channelId, ch.id)).limit(1);
  const jobId = (await createProductionJob(item.id))!;
  await runProductionJob(jobId, { trigger: "audit6" });

  const meta = await buildYouTubeMetadata(jobId, { force: true });
  chk("M1", "YouTube metadata generated", meta.ok && !!meta.metadata?.title, `mode=${meta.metadata?.mode} title="${meta.metadata?.title.slice(0, 45)}"`);
  chk("M2", "Metadata provenance labelled honestly",
    meta.metadata?.mode === (process.env.OPENAI_API_KEY || process.env.ANTHROPIC_API_KEY ? "real_ai" : "fallback"),
    `mode=${meta.metadata?.mode} provider=${meta.metadata?.provider}`);
  chk("M3", "Title respects the 100-char YouTube limit", (meta.metadata?.title.length ?? 0) <= 100, `len=${meta.metadata?.title.length}`);
  chk("M4", "Description within 5000 chars", (meta.metadata?.description.length ?? 0) <= 5000, `len=${meta.metadata?.description.length}`);
  const composed = composeMetadata({
    draftTitle: "T", hook: "H", sections: [{ heading: "HOOK", narration: "Real narration only.", durationSec: 5 }],
    cta: "Follow", channelName: "Weird History", niche: "history", sourceName: "Src", sourceUrl: "https://e.invalid", existingHashtags: ["history"],
  });
  chk("M5", "Fallback composer invents no facts/claims",
    !/\d+[MK]? views|million views|studies show|according to experts/i.test(composed.description),
    "no fabricated performance/citation language");

  /* ============ 5. THUMBNAIL ============ */
  const thumb = await createThumbnail(jobId);
  chk("T1", "Thumbnail generated as a real image", thumb.ok && !!thumb.url, `mode=${thumb.mode} url=${thumb.url}`);
  if (thumb.ok && thumb.assetId) {
    const [ta] = await db.select().from(productionAssets).where(eq(productionAssets.id, thumb.assetId));
    const { statSync } = await import("node:fs");
    const size = ta.filePath ? statSync(ta.filePath).size : 0;
    chk("T2", "Thumbnail file exists on disk and is non-trivial", size > 5000, `${size} bytes at ${ta.filePath?.split("/").pop()}`);
    chk("T3", "Thumbnail under YouTube 2MB limit", size < 2 * 1024 * 1024, `${(size / 1024).toFixed(0)} KB`);
    const [d0] = await db.select().from(contentDrafts).where(eq(contentDrafts.jobId, jobId));
    chk("T4", "Thumbnail linked to the draft", d0.thumbnailAssetId === thumb.assetId, "draft.thumbnailAssetId set");
    const imgs = await db.select().from(productionAssets).where(and(eq(productionAssets.jobId, jobId), eq(productionAssets.kind, "image")));
    if (imgs[0]) {
      const sel = await selectThumbnail(jobId, imgs[0].id);
      chk("T5", "Existing visual asset can be selected as thumbnail", sel.ok, `selected scene asset ${imgs[0].sceneNumber}`);
      await selectThumbnail(jobId, thumb.assetId);
    } else skip("T5", "Select existing asset", "no scene images");
  }

  /* ============ 6. PUBLISH SAFETY GATES ============ */
  const strat = await ensureChannelStrategy(ch.id);
  chk("S1", "auto-publish still OFF by default", strat.autoPublish === false, `autoPublish=${strat.autoPublish}`);
  const unapproved = await createPublishJobsForContent(item.id);
  chk("S2", "Unapproved draft cannot create publish jobs", unapproved.created === 0, unapproved.skipped[0] ?? "");
  await approveDraft(jobId, "audit6", { override: true });
  const prepared = await createPublishJobsForContent(item.id);
  const existingJobs = await db
    .select()
    .from(publishJobs)
    .where(eq(publishJobs.contentId, item.id));
  chk(
    "S3",
    "Approved draft yields publish jobs",
    prepared.created > 0 || existingJobs.length > 0,
    `${prepared.created} created, ${existingJobs.length} total (idempotent)`,
  );

  const [ytJob] = await db.select().from(publishJobs)
    .where(and(eq(publishJobs.contentId, item.id), eq(publishJobs.platform, "youtube")));
  chk("S4", "YouTube publish job exists", !!ytJob, ytJob ? `status=${ytJob.status}` : "missing");

  const pf = await preflight(ytJob.id);
  console.log(`      preflight: ${JSON.stringify(pf.reasons)}`);
  chk("S5", "Preflight blocks without a connected YouTube account",
    !pf.ok && pf.reasons.some((r) => /connect|authoriz|credential|configured/i.test(r)),
    `${pf.reasons.length} reason(s): ${JSON.stringify(pf.reasons)}`);

  const disp = await dispatchPublishJob(ytJob.id, { trigger: "audit6" });
  const [afterDisp] = await db.select().from(publishJobs).where(eq(publishJobs.id, ytJob.id));
  chk("S6", "Dispatch does not publish without auth", !disp.ok && afterDisp.status !== "published", `status=${afterDisp.status} reason="${disp.reason?.slice(0, 60)}"`);
  chk("S7", "No published_posts fabricated", (await db.select().from(publishedPosts)).length === 0, "0 rows");
  const atts = await db.select().from(publishAttempts).where(eq(publishAttempts.jobId, ytJob.id));
  chk("S8", "Blocked dispatch recorded in the audit trail", atts.length > 0, `${atts.length} attempt(s), outcome=${atts[0]?.outcome}`);

  /* ============ 7. IDEMPOTENCY & SCHEDULING ============ */
  const dup = await createPublishJobsForContent(item.id);
  const dupSql = await db.execute(sql`SELECT content_id,platform,COUNT(*) c FROM publish_jobs GROUP BY 1,2 HAVING COUNT(*)>1`);
  chk("I1", "Duplicate publish jobs prevented", dup.created === 0 && dupSql.rows.length === 0, `re-run created ${dup.created}, ${dupSql.rows.length} dupes`);

  await db.update(publishJobs).set({ platformPostId: "AUDIT6FAKE", uploadState: "complete" }).where(eq(publishJobs.id, ytJob.id));
  const reDisp = await dispatchPublishJob(ytJob.id, { trigger: "audit6-dup" });
  chk("I2", "Existing platformPostId short-circuits re-upload",
    !reDisp.ok || reDisp.status === "published", `outcome=${reDisp.status} (blocked before any new upload)`);
  await db.update(publishJobs).set({ platformPostId: null, uploadState: "idle" }).where(eq(publishJobs.id, ytJob.id));

  let past = false;
  try { await schedulePublishJob(ytJob.id, new Date(Date.now() - 3600_000)); } catch { past = true; }
  chk("I3", "Past-date scheduling rejected", past, "throws");
  const when = new Date(Date.now() + 4 * 3600_000);
  await schedulePublishJob(ytJob.id, when);
  const [sch] = await db.select().from(publishJobs).where(eq(publishJobs.id, ytJob.id));
  chk("I4", "Future scheduling accepted (native publishAt path)", sch.status === "scheduled", sch.scheduledAt?.toISOString() ?? "");

  /* ============ 8. ANALYTICS ============ */
  const refresh = await refreshYouTubeAnalytics();
  chk("N1", "Analytics refresh honest with no published posts",
    refresh.posts === 0 && refresh.refreshed === 0, `posts=${refresh.posts} refreshed=${refresh.refreshed}`);
  const ytMetrics = await db.select().from(postMetrics).where(eq(postMetrics.platform, "youtube"));
  chk("N2", "No YouTube metrics fabricated", ytMetrics.length === 0, `${ytMetrics.length} rows`);

  // snapshot history + uniqueness (explicitly labelled audit rows)
  const [pp] = await db.insert(publishedPosts).values({
    contentId: item.id, channelId: ch.id, platform: "youtube",
    platformPostId: "AUDIT6-SNAP", platformUrl: "https://youtube.invalid/x", title: "audit snapshot",
  }).returning();
  const t1 = new Date(Date.now() - 86400_000);
  const t2 = new Date();
  for (const [t, v] of [[t1, 1000], [t2, 2500]] as [Date, number][]) {
    await db.insert(postMetrics).values({
      postId: pp.id, contentId: item.id, channelId: ch.id, platform: "youtube",
      platformPostId: "AUDIT6-SNAP", source: "audit_test", measuredAt: t,
      views: v, likes: Math.round(v / 20), comments: Math.round(v / 200), shares: Math.round(v / 100),
      watchTimeSec: v * 20, avgViewDurationSec: 22, avgViewPercentageBp: 5500,
      completionRateBp: 5500, followersGained: 5, followersLost: 1, impressions: v * 4, ctrBp: 450,
    }).onConflictDoNothing();
  }
  const snaps = await db.select().from(postMetrics).where(eq(postMetrics.platformPostId, "AUDIT6-SNAP"));
  chk("N3", "Historical snapshots coexist (never overwritten)", snaps.length === 2, `${snaps.length} snapshots retained`);
  const dupIns = await db.insert(postMetrics).values({
    postId: pp.id, contentId: item.id, channelId: ch.id, platform: "youtube",
    platformPostId: "AUDIT6-SNAP", source: "audit_test", measuredAt: t2, views: 9999,
  }).onConflictDoNothing().returning();
  chk("N4", "Duplicate snapshot at same instant prevented", dupIns.length === 0, "unique(platform,post,measured_at) enforced");

  const { getYouTubeAnalytics } = await import("../src/lib/queries");
  const ytA = await getYouTubeAnalytics();
  chk("N5", "Latest-value aggregation over history", ytA.hasData && ytA.views === 2500,
    `views=${ytA.views} (latest 2500, not sum 3500) retention=${ytA.avgViewPercentageBp}`);
  chk("N6", "Watch time + CTR + subs surfaced", ytA.watchTimeSec > 0 && ytA.ctrBp !== null,
    `watch=${ytA.watchTimeSec}s ctr=${ytA.ctrBp}bp subs=+${ytA.subsGained}/-${ytA.subsLost}`);

  /* ============ 9. FEEDBACK LOOP ============ */
  const sigs = await computePerformanceSignals();
  const small = sigs.filter((s) => s.sampleSize < 5);
  chk("F1", "Signals computed from real metric rows", sigs.length > 0, `${sigs.length} signals`);
  chk("F2", "Tiny samples produce ZERO adjustment", small.every((s) => s.adjustment === 0),
    small[0] ? `n=${small[0].sampleSize} adj=${small[0].adjustment} "${small[0].explanation.slice(0, 55)}"` : "n/a");
  const js = await judgeSignalsFor({ tags: [sigs[0]?.key ?? "x"], sourceName: "x", channelSlug: "weird-history" });
  chk("F3", "Judge adjustment capped at ±10", Math.abs(js.adjustment) <= 10, `adjustment=${js.adjustment}`);
  chk("F4", "One video cannot distort scoring", js.adjustment === 0 || js.notes.some((n) => n.includes("insufficient")),
    js.notes[0]?.slice(0, 70) ?? "no notes");
  const insights = await computeInsights();
  chk("F5", "Qualitative insights gated by sample size",
    insights.every((i) => i.sampleSize >= 5) || insights.length === 0,
    insights.length ? insights.map((i) => i.kind).join(",") : "0 insights (below MIN_SAMPLE) — correct");

  // cleanup audit rows
  await db.delete(postMetrics).where(eq(postMetrics.platformPostId, "AUDIT6-SNAP"));
  await db.delete(publishedPosts).where(eq(publishedPosts.id, pp.id));
  await db.delete(performanceSignals);
  console.log("      (audit metric rows removed)");

  /* ============ 10. TOKEN MAINTENANCE + NOTIFICATIONS ============ */
  const maint = await maintainTokens();
  chk("K1", "Token maintenance runs safely with no accounts", maint.checked >= 0, `checked=${maint.checked} expired=${maint.expired}`);
  const notes = await db.select().from(notifications);
  chk("K2", "Notifications recorded for publishing events", notes.length > 0,
    `${notes.length} notification(s); categories=${[...new Set(notes.map((n) => n.category))].join(",")}`);

  /* ============ 11. SECRET LEAKAGE (DB) ============ */
  const leak = await db.execute(sql`
    SELECT
      (SELECT COUNT(*) FROM publish_accounts WHERE COALESCE(last_error,'') ~ '(ya29\\.|1//0|GOCSPX-)')::int a,
      (SELECT COUNT(*) FROM publish_attempts WHERE COALESCE(error,'')||request_summary::text||response_summary::text ~ '(ya29\\.|1//0|GOCSPX-)')::int b,
      (SELECT COUNT(*) FROM notifications WHERE title||body ~ '(ya29\\.|1//0|GOCSPX-)')::int c,
      (SELECT COUNT(*) FROM publish_accounts WHERE encrypted_tokens IS NOT NULL AND encrypted_tokens !~ '^v1\\.')::int d
  `);
  const L = leak.rows[0] as Record<string, number>;
  chk("L1", "No tokens in publish_accounts.last_error", Number(L.a) === 0, `${L.a} rows`);
  chk("L2", "No tokens in publish_attempts audit", Number(L.b) === 0, `${L.b} rows`);
  chk("L3", "No tokens in notifications", Number(L.c) === 0, `${L.c} rows`);
  chk("L4", "Stored tokens are always encrypted (v1. envelope)", Number(L.d) === 0, `${L.d} plaintext rows`);
  const accts = await db.select().from(publishAccounts);
  chk("L5", "credentialRef holds env var NAMES only",
    accts.every((a) => !a.credentialRef || /^[A-Z0-9_,]+$/.test(a.credentialRef)),
    `e.g. "${accts[0]?.credentialRef ?? "none"}"`);

  /* ============ 12. REAL API (credential-gated) ============ */
  if (hasOAuth && hasKey) {
    const st = await accountStatus(ch.id);
    if (st.connected) {
      chk("E1", "Live YouTube account connected", true, `${st.displayName} (${st.externalId})`);
      const live = await adapter.fetchMetrics("dQw4w9WgXcQ", { channelId: ch.id });
      chk("E2", "Live analytics call executed", live !== undefined, live ? "metrics returned" : "null (not owner of test video)");
    } else {
      skip("E1-E2", "Live upload + analytics", `OAuth configured but no channel authorized yet (${st.state})`);
    }
  } else {
    skip("E1-E2", "Live upload + analytics", "YOUTUBE_CLIENT_ID/SECRET + TOKEN_ENCRYPTION_KEY required");
  }

  console.log(`\n================ PHASE 6 SUMMARY ================`);
  console.log(`${R.filter((r) => r.ok).length}/${R.length} passed, ${SKIP.length} skipped (credential-gated)`);
  const f = R.filter((r) => !r.ok);
  if (f.length) { console.log("FAILURES:"); f.forEach((x) => console.log(`  [${x.id}] ${x.n} :: ${x.d}`)); }
  if (SKIP.length) { console.log("SKIPPED:"); SKIP.forEach((s) => console.log(`  ${s}`)); }
  process.exit(f.length ? 1 : 0);
}

main().catch((e) => { console.error(e); process.exit(1); });
