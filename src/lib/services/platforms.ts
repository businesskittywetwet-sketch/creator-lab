import { youtubeAdapter } from "./youtube/adapter";
import type {
  AccountPublishRequest,
  AccountState,
  ConnectionState,
  MetricsContext,
  MetricsResult,
  PlatformAdapter,
  PlatformMeta,
  PublishOutcome,
} from "./platform-types";

/* ------------------------------------------------------------------ */
/*  Platform registry.                                                 */
/*                                                                     */
/*  YouTube is a real, OAuth-backed implementation (Phase 6).          */
/*  TikTok / Instagram / Facebook are registered placeholders that     */
/*  report honestly and never fabricate a publish. They will be filled */
/*  in later against the same PlatformAdapter contract.                */
/* ------------------------------------------------------------------ */

export type {
  AccountPublishRequest,
  AccountState,
  ConnectionState,
  MetricsContext,
  MetricsResult,
  PlatformAdapter,
  PlatformMeta,
  PublishOutcome,
};

const PENDING_PLATFORMS: PlatformMeta[] = [
  {
    key: "tiktok",
    label: "TikTok",
    short: "TT",
    hex: "#67e8f9",
    envKeys: ["TIKTOK_CLIENT_KEY", "TIKTOK_CLIENT_SECRET", "TIKTOK_ACCESS_TOKEN"],
    docsUrl: "https://developers.tiktok.com/doc/content-posting-api-get-started",
    maxTitle: 90,
    maxCaption: 2200,
    aspect: "9:16",
    uploadImplemented: false,
    oauth: false,
    scopes: [],
  },
  {
    key: "instagram",
    label: "Instagram Reels",
    short: "IG",
    hex: "#f0abfc",
    envKeys: ["INSTAGRAM_ACCESS_TOKEN", "INSTAGRAM_BUSINESS_ACCOUNT_ID"],
    docsUrl: "https://developers.facebook.com/docs/instagram-api/guides/content-publishing",
    maxTitle: 125,
    maxCaption: 2200,
    aspect: "9:16",
    uploadImplemented: false,
    oauth: false,
    scopes: [],
  },
  {
    key: "facebook",
    label: "Facebook Reels",
    short: "FB",
    hex: "#93c5fd",
    envKeys: ["FACEBOOK_PAGE_ID", "FACEBOOK_PAGE_ACCESS_TOKEN"],
    docsUrl: "https://developers.facebook.com/docs/video-api/guides/reels-publishing",
    maxTitle: 255,
    maxCaption: 2200,
    aspect: "9:16",
    uploadImplemented: false,
    oauth: false,
    scopes: [],
  },
];

/** Placeholder adapter: reports state truthfully, never fakes a publish. */
function pendingAdapter(meta: PlatformMeta): PlatformAdapter {
  return {
    meta,
    connection() {
      const missing = meta.envKeys.filter((k) => !process.env[k]);
      if (missing.length === meta.envKeys.length) {
        return {
          state: "not_connected",
          missing,
          detail: `No credentials configured for ${meta.label}.`,
        };
      }
      if (missing.length > 0) {
        return {
          state: "credentials_required",
          missing,
          detail: `Partially configured — missing ${missing.join(", ")}.`,
        };
      }
      return {
        state: "publishing_unavailable",
        missing: [],
        detail: `Credentials detected, but the ${meta.label} upload adapter is not implemented yet.`,
      };
    },
    async publish() {
      return {
        ok: false,
        kind: "blocked",
        reason: `${meta.label} publishing is not implemented yet (planned after YouTube).`,
      };
    },
    async fetchMetrics() {
      return null;
    },
  };
}

const REGISTRY: Record<string, PlatformAdapter> = {
  youtube: youtubeAdapter,
  ...Object.fromEntries(PENDING_PLATFORMS.map((m) => [m.key, pendingAdapter(m)])),
};

export const PLATFORMS: PlatformMeta[] = [
  youtubeAdapter.meta,
  ...PENDING_PLATFORMS,
];

export function platformMeta(key: string): PlatformMeta | undefined {
  return PLATFORMS.find((p) => p.key === key);
}

export function adapterFor(platform: string): PlatformAdapter | undefined {
  return REGISTRY[platform];
}

export function connectionFor(platform: string) {
  const a = adapterFor(platform);
  if (!a) {
    return {
      state: "not_connected" as ConnectionState,
      missing: [] as string[],
      detail: `Unknown platform "${platform}".`,
    };
  }
  return a.connection();
}

export function platformConnectionSummary() {
  return PLATFORMS.map((m) => ({ ...m, ...connectionFor(m.key) }));
}

/** Per-channel account state across every OAuth-capable platform. */
export async function accountStateFor(
  platform: string,
  channelId: string,
): Promise<AccountState | null> {
  const a = adapterFor(platform);
  if (!a?.accountState) return null;
  return a.accountState(channelId);
}

export { CONNECTION_LABELS } from "@/lib/platform-meta";
