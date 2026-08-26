import { db } from "@/db";
import { channels, oauthStates, publishAccounts } from "@/db/schema";
import { and, eq, lt } from "drizzle-orm";
import {
  decryptJson,
  encryptJson,
  encryptionConfigured,
  randomToken,
  redact,
  redactUnknown,
} from "@/lib/crypto";

/* ------------------------------------------------------------------ */
/*  Google / YouTube OAuth 2.0 (server-only).                          */
/*                                                                     */
/*  - Client secret lives in env only, never in the DB or the browser. */
/*  - Access/refresh tokens are AES-256-GCM encrypted before storage.  */
/*  - Every error surface passes through redact() so no token or       */
/*    secret fragment can reach a log, DB column, or the UI.           */
/* ------------------------------------------------------------------ */

const AUTH_ENDPOINT = "https://accounts.google.com/o/oauth2/v2/auth";
const TOKEN_ENDPOINT = "https://oauth2.googleapis.com/token";
const REVOKE_ENDPOINT = "https://oauth2.googleapis.com/revoke";

/** Minimum scopes: upload + read own channel + read analytics. */
export const YOUTUBE_SCOPES = [
  "https://www.googleapis.com/auth/youtube.upload",
  "https://www.googleapis.com/auth/youtube.readonly",
  "https://www.googleapis.com/auth/yt-analytics.readonly",
];

export type StoredTokens = {
  accessToken: string;
  refreshToken: string | null;
  expiresAt: number; // epoch ms
  scopes: string[];
  tokenType: string;
};

export type OAuthConfig = {
  clientId: string;
  clientSecret: string;
  redirectUri: string;
};

export function oauthConfig(): OAuthConfig | null {
  const clientId = process.env.YOUTUBE_CLIENT_ID;
  const clientSecret = process.env.YOUTUBE_CLIENT_SECRET;
  if (!clientId || !clientSecret) return null;
  const base =
    process.env.OAUTH_REDIRECT_BASE_URL ??
    process.env.NEXT_PUBLIC_APP_URL ??
    "http://localhost:3000";
  return {
    clientId,
    clientSecret,
    redirectUri: `${base.replace(/\/$/, "")}/api/oauth/youtube/callback`,
  };
}

export type ReadinessIssue =
  | "missing_client_credentials"
  | "missing_encryption_key"
  | null;

/** Can the app perform OAuth at all? (independent of any account) */
export function oauthReadiness(): { ready: boolean; issue: ReadinessIssue; detail: string } {
  if (!oauthConfig()) {
    return {
      ready: false,
      issue: "missing_client_credentials",
      detail: "YOUTUBE_CLIENT_ID / YOUTUBE_CLIENT_SECRET are not configured.",
    };
  }
  if (!encryptionConfigured()) {
    return {
      ready: false,
      issue: "missing_encryption_key",
      detail:
        "TOKEN_ENCRYPTION_KEY is not configured — refusing to store OAuth tokens insecurely.",
    };
  }
  return { ready: true, issue: null, detail: "YouTube OAuth is configured." };
}

/* ----------------------------- authorize --------------------------- */

export async function createAuthUrl(
  channelId: string,
  redirectTo = "/publishing",
): Promise<{ url: string } | { error: string }> {
  const readiness = oauthReadiness();
  if (!readiness.ready) return { error: readiness.detail };
  const cfg = oauthConfig()!;

  // single-use, expiring CSRF state
  const state = randomToken(32);
  await db.insert(oauthStates).values({
    state,
    platform: "youtube",
    channelId,
    redirectTo,
    expiresAt: new Date(Date.now() + 10 * 60_000),
  });

  const params = new URLSearchParams({
    client_id: cfg.clientId,
    redirect_uri: cfg.redirectUri,
    response_type: "code",
    scope: YOUTUBE_SCOPES.join(" "),
    access_type: "offline", // required to receive a refresh token
    prompt: "consent",
    include_granted_scopes: "true",
    state,
  });
  return { url: `${AUTH_ENDPOINT}?${params.toString()}` };
}

export type StateCheck =
  | { ok: true; channelId: string | null; redirectTo: string }
  | { ok: false; reason: string };

/** Validate + consume a state token. Single use, expiry enforced. */
export async function consumeState(state: string): Promise<StateCheck> {
  if (!state) return { ok: false, reason: "Missing OAuth state parameter." };
  const [row] = await db.select().from(oauthStates).where(eq(oauthStates.state, state));
  if (!row) return { ok: false, reason: "Unknown or forged OAuth state." };
  if (row.consumedAt) return { ok: false, reason: "OAuth state already used (replay blocked)." };
  if (+new Date(row.expiresAt) < Date.now())
    return { ok: false, reason: "OAuth state expired — restart the connection." };
  await db
    .update(oauthStates)
    .set({ consumedAt: new Date() })
    .where(eq(oauthStates.id, row.id));
  return { ok: true, channelId: row.channelId, redirectTo: row.redirectTo };
}

export async function purgeExpiredStates() {
  await db.delete(oauthStates).where(lt(oauthStates.expiresAt, new Date()));
}

/* --------------------------- token exchange ------------------------ */

type TokenResponse = {
  access_token?: string;
  refresh_token?: string;
  expires_in?: number;
  scope?: string;
  token_type?: string;
  error?: string;
  error_description?: string;
};

async function postToken(body: Record<string, string>): Promise<TokenResponse> {
  const res = await fetch(TOKEN_ENDPOINT, {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams(body).toString(),
    signal: AbortSignal.timeout(30_000),
  });
  const text = await res.text();
  let json: TokenResponse;
  try {
    json = JSON.parse(text) as TokenResponse;
  } catch {
    throw new Error(redact(`Token endpoint returned non-JSON (HTTP ${res.status})`));
  }
  if (!res.ok || json.error) {
    throw new Error(
      redact(
        `OAuth token error (HTTP ${res.status}): ${json.error ?? "unknown"} ${
          json.error_description ?? ""
        }`.trim(),
      ),
    );
  }
  return json;
}

export async function exchangeCode(code: string): Promise<StoredTokens> {
  const cfg = oauthConfig();
  if (!cfg) throw new Error("YouTube OAuth is not configured.");
  const json = await postToken({
    code,
    client_id: cfg.clientId,
    client_secret: cfg.clientSecret,
    redirect_uri: cfg.redirectUri,
    grant_type: "authorization_code",
  });
  if (!json.access_token) throw new Error("Token exchange returned no access token.");
  return {
    accessToken: json.access_token,
    refreshToken: json.refresh_token ?? null,
    expiresAt: Date.now() + (json.expires_in ?? 3600) * 1000,
    scopes: (json.scope ?? "").split(" ").filter(Boolean),
    tokenType: json.token_type ?? "Bearer",
  };
}

async function refreshTokens(refreshToken: string): Promise<StoredTokens> {
  const cfg = oauthConfig();
  if (!cfg) throw new Error("YouTube OAuth is not configured.");
  const json = await postToken({
    refresh_token: refreshToken,
    client_id: cfg.clientId,
    client_secret: cfg.clientSecret,
    grant_type: "refresh_token",
  });
  if (!json.access_token) throw new Error("Token refresh returned no access token.");
  return {
    accessToken: json.access_token,
    // Google usually omits refresh_token on refresh — keep the original.
    refreshToken: json.refresh_token ?? refreshToken,
    expiresAt: Date.now() + (json.expires_in ?? 3600) * 1000,
    scopes: (json.scope ?? "").split(" ").filter(Boolean),
    tokenType: json.token_type ?? "Bearer",
  };
}

/* --------------------------- account storage ----------------------- */

export type AccountIdentity = {
  channelTitle: string;
  channelHandle: string;
  externalId: string;
};

/** Fetch the authorized YouTube channel identity (mine=true). */
export async function fetchIdentity(accessToken: string): Promise<AccountIdentity> {
  const res = await fetch(
    "https://www.googleapis.com/youtube/v3/channels?part=snippet&mine=true",
    {
      headers: { authorization: `Bearer ${accessToken}` },
      signal: AbortSignal.timeout(30_000),
    },
  );
  const text = await res.text();
  if (!res.ok) throw new Error(redact(`Identity lookup failed (HTTP ${res.status})`));
  const json = JSON.parse(text) as {
    items?: { id: string; snippet?: { title?: string; customUrl?: string } }[];
  };
  const item = json.items?.[0];
  if (!item) throw new Error("No YouTube channel is associated with this Google account.");
  return {
    channelTitle: item.snippet?.title ?? "YouTube channel",
    channelHandle: item.snippet?.customUrl ?? "",
    externalId: item.id,
  };
}

export async function persistConnection(
  channelId: string,
  tokens: StoredTokens,
  identity: AccountIdentity,
) {
  const encrypted = encryptJson(tokens);
  await db
    .insert(publishAccounts)
    .values({
      channelId,
      platform: "youtube",
      displayName: identity.channelTitle,
      handle: identity.channelHandle,
      externalAccountId: identity.externalId,
      credentialRef: "YOUTUBE_CLIENT_ID,YOUTUBE_CLIENT_SECRET",
      status: "connected",
      encryptedTokens: encrypted,
      tokenExpiresAt: new Date(tokens.expiresAt),
      scopes: tokens.scopes,
      connectedAt: new Date(),
      revokedAt: null,
      lastError: null,
      lastCheckedAt: new Date(),
      enabled: true,
    })
    .onConflictDoUpdate({
      target: [publishAccounts.channelId, publishAccounts.platform],
      set: {
        displayName: identity.channelTitle,
        handle: identity.channelHandle,
        externalAccountId: identity.externalId,
        status: "connected",
        encryptedTokens: encrypted,
        tokenExpiresAt: new Date(tokens.expiresAt),
        scopes: tokens.scopes,
        connectedAt: new Date(),
        revokedAt: null,
        lastError: null,
        lastCheckedAt: new Date(),
      },
    });
}

export type TokenResult =
  | { ok: true; accessToken: string; refreshed: boolean }
  | { ok: false; reason: string; needsReconnect: boolean };

/**
 * Return a valid access token for a channel, refreshing when it is
 * within 2 minutes of expiry. Marks the account as `expired` when the
 * grant has been revoked so the UI can prompt for reconnection.
 */
export async function getAccessToken(channelId: string): Promise<TokenResult> {
  const [account] = await db
    .select()
    .from(publishAccounts)
    .where(
      and(eq(publishAccounts.channelId, channelId), eq(publishAccounts.platform, "youtube")),
    );
  if (!account) return { ok: false, reason: "No YouTube account connected.", needsReconnect: true };
  if (account.revokedAt)
    return { ok: false, reason: "YouTube authorization was disconnected.", needsReconnect: true };

  const tokens = decryptJson<StoredTokens>(account.encryptedTokens);
  if (!tokens) {
    return {
      ok: false,
      reason: encryptionConfigured()
        ? "Stored YouTube tokens could not be decrypted (key rotated?). Reconnect required."
        : "TOKEN_ENCRYPTION_KEY missing — cannot read stored tokens.",
      needsReconnect: true,
    };
  }

  if (tokens.expiresAt > Date.now() + 120_000) {
    return { ok: true, accessToken: tokens.accessToken, refreshed: false };
  }
  if (!tokens.refreshToken) {
    await markExpired(channelId, "Access token expired and no refresh token is available.");
    return { ok: false, reason: "Access token expired — reconnect required.", needsReconnect: true };
  }

  try {
    const fresh = await refreshTokens(tokens.refreshToken);
    await db
      .update(publishAccounts)
      .set({
        encryptedTokens: encryptJson(fresh),
        tokenExpiresAt: new Date(fresh.expiresAt),
        status: "connected",
        lastError: null,
        lastRefreshAt: new Date(),
        lastCheckedAt: new Date(),
      })
      .where(eq(publishAccounts.id, account.id));
    return { ok: true, accessToken: fresh.accessToken, refreshed: true };
  } catch (err) {
    const reason = redactUnknown(err);
    await markExpired(channelId, reason);
    return { ok: false, reason, needsReconnect: true };
  }
}

async function markExpired(channelId: string, reason: string) {
  await db
    .update(publishAccounts)
    .set({ status: "expired", lastError: redact(reason).slice(0, 400), lastCheckedAt: new Date() })
    .where(
      and(eq(publishAccounts.channelId, channelId), eq(publishAccounts.platform, "youtube")),
    );
}

export async function disconnect(channelId: string): Promise<{ ok: boolean; detail: string }> {
  const [account] = await db
    .select()
    .from(publishAccounts)
    .where(
      and(eq(publishAccounts.channelId, channelId), eq(publishAccounts.platform, "youtube")),
    );
  if (!account) return { ok: false, detail: "No YouTube account to disconnect." };

  const tokens = decryptJson<StoredTokens>(account.encryptedTokens);
  let remote = "local only";
  if (tokens?.refreshToken || tokens?.accessToken) {
    try {
      const res = await fetch(REVOKE_ENDPOINT, {
        method: "POST",
        headers: { "content-type": "application/x-www-form-urlencoded" },
        body: new URLSearchParams({
          token: tokens.refreshToken ?? tokens.accessToken,
        }).toString(),
        signal: AbortSignal.timeout(15_000),
      });
      remote = res.ok ? "revoked at Google" : `Google revoke returned HTTP ${res.status}`;
    } catch (err) {
      remote = `revoke call failed: ${redactUnknown(err)}`;
    }
  }

  // Always clear locally, even if the remote revoke failed.
  await db
    .update(publishAccounts)
    .set({
      status: "not_connected",
      encryptedTokens: null,
      tokenExpiresAt: null,
      scopes: [],
      revokedAt: new Date(),
      lastError: null,
      lastCheckedAt: new Date(),
    })
    .where(eq(publishAccounts.id, account.id));
  return { ok: true, detail: `Disconnected (${remote}).` };
}

/** Non-sensitive connection summary for UI/engine use. */
export async function accountStatus(channelId: string) {
  const [account] = await db
    .select()
    .from(publishAccounts)
    .where(
      and(eq(publishAccounts.channelId, channelId), eq(publishAccounts.platform, "youtube")),
    );
  const readiness = oauthReadiness();
  if (!account || account.status === "not_connected" || !account.encryptedTokens) {
    return {
      connected: false,
      state: readiness.ready ? ("not_connected" as const) : ("credentials_required" as const),
      detail: readiness.ready
        ? "YouTube account is not connected. Use Connect to authorize."
        : readiness.detail,
      displayName: account?.displayName ?? "",
      handle: account?.handle ?? "",
      externalId: account?.externalAccountId ?? "",
      expiresAt: null as Date | null,
      needsReconnect: false,
      scopes: [] as string[],
    };
  }
  const expired = account.status === "expired";
  return {
    connected: !expired,
    state: expired ? ("expired" as const) : ("connected" as const),
    detail: expired
      ? account.lastError ?? "Authorization expired — reconnect required."
      : `Connected as ${account.displayName}`,
    displayName: account.displayName,
    handle: account.handle,
    externalId: account.externalAccountId,
    expiresAt: account.tokenExpiresAt,
    needsReconnect: expired,
    scopes: account.scopes,
  };
}

export async function listConnectedChannels() {
  return db
    .select({
      accountId: publishAccounts.id,
      channelId: publishAccounts.channelId,
      channelName: channels.name,
      displayName: publishAccounts.displayName,
      handle: publishAccounts.handle,
      status: publishAccounts.status,
      expiresAt: publishAccounts.tokenExpiresAt,
      externalId: publishAccounts.externalAccountId,
    })
    .from(publishAccounts)
    .leftJoin(channels, eq(channels.id, publishAccounts.channelId))
    .where(eq(publishAccounts.platform, "youtube"));
}
