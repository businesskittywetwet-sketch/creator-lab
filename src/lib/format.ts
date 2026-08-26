/* Server-safe formatting helpers (pure functions, no client APIs). */

export function timeAgo(input: Date | string | null | undefined): string {
  if (!input) return "—";
  const d = new Date(input);
  const secs = Math.max(0, Math.floor((Date.now() - d.getTime()) / 1000));
  if (secs < 10) return "just now";
  if (secs < 60) return `${secs}s ago`;
  const mins = Math.floor(secs / 60);
  if (mins < 60) return `${mins}m ago`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  if (days < 7) return `${days}d ago`;
  const weeks = Math.floor(days / 7);
  if (weeks < 5) return `${weeks}w ago`;
  return d.toLocaleDateString("en-US", { month: "short", day: "numeric" });
}

export function timeUntil(input: Date | string | null | undefined): string {
  if (!input) return "—";
  const d = new Date(input);
  const secs = Math.floor((d.getTime() - Date.now()) / 1000);
  if (secs <= 0) return "now";
  if (secs < 60) return `in ${secs}s`;
  const mins = Math.floor(secs / 60);
  if (mins < 60) return `in ${mins}m`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `in ${hours}h ${mins % 60}m`;
  const days = Math.floor(hours / 24);
  return `in ${days}d ${hours % 24}h`;
}

export function fmtNum(n: number | null | undefined): string {
  if (n == null) return "0";
  if (n >= 1_000_000)
    return `${(n / 1_000_000).toFixed(n >= 10_000_000 ? 0 : 1)}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(n >= 10_000 ? 0 : 1)}K`;
  return String(n);
}

export function fmtDate(input: Date | string | null | undefined): string {
  if (!input) return "—";
  return new Date(input).toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
  });
}

export function fmtDateTime(input: Date | string | null | undefined): string {
  if (!input) return "—";
  const d = new Date(input);
  return `${d.toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
  })} · ${d.toLocaleTimeString("en-US", {
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  })}`;
}

export function fmtDurationSec(sec: number | null | undefined): string {
  if (!sec) return "—";
  if (sec < 90) return `${sec}s`;
  const m = Math.floor(sec / 60);
  const s = sec % 60;
  return `${m}:${String(s).padStart(2, "0")}`;
}

export function fmtClock(input: Date | string | null | undefined): string {
  if (!input) return "—";
  return new Date(input).toLocaleTimeString("en-US", {
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  });
}

export function fmtMs(ms: number | null | undefined): string {
  if (ms == null) return "—";
  if (ms < 1000) return `${ms}ms`;
  return `${(ms / 1000).toFixed(1)}s`;
}
