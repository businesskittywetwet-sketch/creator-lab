/* Proves the YouTube code path performs REAL network I/O against Google,
   using deliberately invalid credentials. No fake success anywhere. */
import "dotenv/config";
process.env.YOUTUBE_CLIENT_ID = "audit6-invalid-client-id.apps.googleusercontent.com";
process.env.YOUTUBE_CLIENT_SECRET = "GOCSPX-audit6-invalid-secret";
process.env.TOKEN_ENCRYPTION_KEY = process.env.TOKEN_ENCRYPTION_KEY ?? "audit6-encryption-key-at-least-32b!";

import { db } from "../src/db";
import { channels, publishAccounts } from "../src/db/schema";
import { and, eq } from "drizzle-orm";
import { encryptJson } from "../src/lib/crypto";
import { exchangeCode, getAccessToken, oauthReadiness, createAuthUrl } from "../src/lib/services/youtube/oauth";
import { initiateUpload } from "../src/lib/services/youtube/api";
import { adapterFor } from "../src/lib/services/platforms";

const log = (...a: unknown[]) => console.log(...a);

async function main() {
  log("=== readiness with credentials present ===");
  const r = oauthReadiness();
  log(`  ready=${r.ready} detail="${r.detail}"`);

  const [ch] = await db.select().from(channels).limit(1);
  const auth = await createAuthUrl(ch.id);
  log(`  auth URL generated: ${"url" in auth}`);
  if ("url" in auth) {
    log(`  host=${new URL(auth.url).host} scopes=${new URL(auth.url).searchParams.get("scope")?.split(" ").length}`);
    log(`  secret leaked into URL: ${auth.url.includes("GOCSPX-audit6-invalid-secret")}`);
  }

  log("\n=== REAL token exchange against oauth2.googleapis.com (expect rejection) ===");
  try {
    await exchangeCode("invalid-authorization-code");
    log("  UNEXPECTED: exchange succeeded");
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    log(`  Google responded: ${msg.slice(0, 130)}`);
    log(`  contains client secret: ${msg.includes("GOCSPX-audit6-invalid-secret")}`);
  }

  log("\n=== REAL upload initiation against googleapis.com (expect 401) ===");
  try {
    await initiateUpload("ya29.invalid-access-token-audit6",
      { title: "audit", description: "d", tags: [], categoryId: "24", privacyStatus: "private" }, 1024);
    log("  UNEXPECTED: upload session opened");
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    log(`  Google responded: ${msg.slice(0, 130)}`);
    log(`  contains access token: ${msg.includes("ya29.invalid-access-token-audit6")}`);
  }

  log("\n=== token refresh with a stored (invalid) refresh token ===");
  await db.insert(publishAccounts).values({
    channelId: ch.id, platform: "youtube", displayName: "Audit6 Test", handle: "@audit6",
    externalAccountId: "UCaudit6", credentialRef: "YOUTUBE_CLIENT_ID,YOUTUBE_CLIENT_SECRET",
    status: "connected",
    encryptedTokens: encryptJson({
      accessToken: "ya29.expired-audit6", refreshToken: "1//0invalid-refresh-audit6",
      expiresAt: Date.now() - 60_000, scopes: [], tokenType: "Bearer",
    }),
    tokenExpiresAt: new Date(Date.now() - 60_000), connectedAt: new Date(),
  }).onConflictDoUpdate({
    target: [publishAccounts.channelId, publishAccounts.platform],
    set: {
      status: "connected",
      encryptedTokens: encryptJson({
        accessToken: "ya29.expired-audit6", refreshToken: "1//0invalid-refresh-audit6",
        expiresAt: Date.now() - 60_000, scopes: [], tokenType: "Bearer",
      }),
      tokenExpiresAt: new Date(Date.now() - 60_000), revokedAt: null,
    },
  });

  const tok = await getAccessToken(ch.id);
  log(`  refresh attempted -> ok=${tok.ok}`);
  if (!tok.ok) log(`  reason: ${tok.reason.slice(0, 120)}\n  needsReconnect=${tok.needsReconnect}`);

  const [acct] = await db.select().from(publishAccounts)
    .where(and(eq(publishAccounts.channelId, ch.id), eq(publishAccounts.platform, "youtube")));
  log(`  account marked: status=${acct.status}`);
  log(`  stored error contains token/secret: ${/ya29\.|1\/\/0|GOCSPX-/.test(acct.lastError ?? "")}`);

  log("\n=== adapter.publish() with expired stored auth ===");
  const out = await adapterFor("youtube")!.publish({
    jobId: "00000000-0000-0000-0000-000000000000", platform: "youtube", channelId: ch.id,
    title: "t", description: "", caption: "", hashtags: [], videoPath: null, videoUrl: null,
    scheduledAt: null, accountRef: "",
  });
  log(`  ok=${out.ok}${out.ok ? "" : ` kind=${out.kind} reason="${out.reason.slice(0, 90)}"`}`);

  // cleanup
  await db.update(publishAccounts).set({
    status: "not_connected", encryptedTokens: null, tokenExpiresAt: null, revokedAt: new Date(),
  }).where(eq(publishAccounts.id, acct.id));
  log("\n  (test account cleared)");
  process.exit(0);
}
main().catch((e) => { console.error(e); process.exit(1); });
