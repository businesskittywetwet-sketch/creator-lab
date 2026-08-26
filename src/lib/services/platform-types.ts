/* ------------------------------------------------------------------ */
/*  Shared platform publishing contract.                               */
/*                                                                     */
/*  YouTube is the first real implementation. TikTok, Instagram and    */
/*  Facebook implement this same interface later with no changes to    */
/*  the publishing engine, queue UI, analytics or feedback loop.       */
/*                                                                     */
/*  Two levels of connection state:                                    */
/*    connection()   — app-level, env-only, synchronous, client-safe   */
/*    accountState() — per-channel OAuth state, async, DB-backed       */
/* ------------------------------------------------------------------ */

export type ConnectionState =
  | "connected"
  | "not_connected"
  | "credentials_required"
  | "publishing_unavailable"
  | "expired";

export type PlatformMeta = {
  key: string;
  label: string;
  short: string;
  hex: string;
  /** env vars required for the adapter to operate (names only) */
  envKeys: string[];
  docsUrl: string;
  maxTitle: number;
  maxCaption: number;
  aspect: string;
  /** true once a real upload transport exists */
  uploadImplemented: boolean;
  /** true when the platform authorizes per-account via OAuth */
  oauth: boolean;
  scopes: string[];
};

export type AccountState = {
  connected: boolean;
  state: ConnectionState;
  detail: string;
  displayName: string;
  handle: string;
  externalId: string;
  needsReconnect: boolean;
  expiresAt: string | null;
};

export type AccountPublishRequest = {
  jobId: string;
  platform: string;
  /** internal Viboro channel id — resolves the OAuth account */
  channelId: string | null;
  title: string;
  description: string;
  caption: string;
  hashtags: string[];
  videoPath: string | null;
  videoUrl: string | null;
  thumbnailPath?: string | null;
  scheduledAt: Date | null;
  /** RFC3339 for native platform-side scheduling */
  publishAt?: string | null;
  privacyStatus?: string;
  categoryId?: string;
  accountRef: string;
  onProgress?: (sent: number, total: number) => void;
};

export type PublishOutcome =
  | {
      ok: true;
      platformPostId: string;
      platformUrl: string;
      publishedAt: string;
      response: Record<string, unknown>;
    }
  | {
      ok: false;
      /** blocked = preconditions unmet (config/auth); failed = attempted and errored */
      kind: "blocked" | "failed";
      reason: string;
      response?: Record<string, unknown>;
    };

/** Normalised metrics. `null` means "platform did not report it", not zero. */
export type MetricsResult = {
  views: number;
  likes: number;
  comments: number;
  shares: number;
  watchTimeSec: number | null;
  avgViewDurationSec: number | null;
  avgViewPercentageBp: number | null;
  followersGained: number | null;
  followersLost: number | null;
  impressions: number | null;
  ctrBp: number | null;
  raw: Record<string, unknown>;
} | null;

export type MetricsContext = { channelId: string | null };

export interface PlatformAdapter {
  meta: PlatformMeta;
  connection(): { state: ConnectionState; missing: string[]; detail: string };
  /** Per-channel authorization state. Adapters without OAuth may omit. */
  accountState?(channelId: string): Promise<AccountState>;
  publish(req: AccountPublishRequest): Promise<PublishOutcome>;
  fetchMetrics(platformPostId: string, ctx?: MetricsContext): Promise<MetricsResult>;
}
