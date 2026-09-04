/* ------------------------------------------------------------------ */
/*  Client-safe platform constants.                                    */
/*                                                                     */
/*  This module contains ONLY presentational metadata and must never   */
/*  import an adapter, the database, or anything that reads            */
/*  process.env secrets. Client components import from here;           */
/*  server code imports the full registry from ./services/platforms.   */
/* ------------------------------------------------------------------ */

export type ConnectionState =
  | "connected"
  | "not_connected"
  | "credentials_required"
  | "publishing_unavailable"
  | "expired";

export const CONNECTION_LABELS: Record<ConnectionState, string> = {
  connected: "CONNECTED",
  not_connected: "NOT CONNECTED",
  credentials_required: "CREDENTIALS REQUIRED",
  publishing_unavailable: "PUBLISHING UNAVAILABLE",
  expired: "RECONNECT REQUIRED",
};

/** Display-only platform descriptors (no credentials, no logic). */
export const PLATFORM_DISPLAY: {
  key: string;
  label: string;
  short: string;
  hex: string;
}[] = [
  { key: "youtube", label: "YouTube", short: "YT", hex: "#ff5c5c" },
  { key: "tiktok", label: "TikTok", short: "TT", hex: "#67e8f9" },
  { key: "instagram", label: "Instagram Reels", short: "IG", hex: "#f0abfc" },
  { key: "facebook", label: "Facebook Reels", short: "FB", hex: "#93c5fd" },
];
