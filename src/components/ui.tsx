import type { CSSProperties, ReactNode } from "react";
import type { LucideIcon } from "lucide-react";
import { Inbox } from "lucide-react";
import { stageDef } from "@/lib/pipeline";

/* ------------------------------- layout ------------------------------ */

export function PageHeader({
  eyebrow,
  title,
  description,
  actions,
}: {
  eyebrow: string;
  title: string;
  description?: string;
  actions?: ReactNode;
}) {
  return (
    <div className="mb-7 flex flex-wrap items-end justify-between gap-4 animate-fade-up">
      <div>
        <p className="eyebrow mb-2">{eyebrow}</p>
        <h2 className="font-display text-2xl font-bold tracking-tight text-white sm:text-3xl">
          {title}
        </h2>
        {description && (
          <p className="mt-2 max-w-xl text-sm leading-relaxed text-zinc-500">
            {description}
          </p>
        )}
      </div>
      {actions && <div className="flex items-center gap-2">{actions}</div>}
    </div>
  );
}

export function Panel({
  className = "",
  style,
  id,
  children,
}: {
  className?: string;
  style?: CSSProperties;
  id?: string;
  children: ReactNode;
}) {
  return (
    <div id={id} className={`panel ${className}`} style={style}>
      {children}
    </div>
  );
}

export function PanelHeader({
  title,
  hint,
  action,
}: {
  title: string;
  hint?: string;
  action?: ReactNode;
}) {
  return (
    <div className="flex items-center justify-between gap-3 border-b border-white/[0.06] px-5 py-4">
      <div>
        <h3 className="font-display text-sm font-semibold tracking-wide text-zinc-100">
          {title}
        </h3>
        {hint && <p className="mt-0.5 text-xs text-zinc-500">{hint}</p>}
      </div>
      {action}
    </div>
  );
}

/* -------------------------------- status ----------------------------- */

const STATUS_TONES: Record<string, { ring: string; text: string; dot: string; pulse?: boolean }> = {
  success: { ring: "border-emerald-400/30 bg-emerald-400/10", text: "text-emerald-300", dot: "bg-emerald-400" },
  running: { ring: "border-sky-400/30 bg-sky-400/10", text: "text-sky-300", dot: "bg-sky-400", pulse: true },
  queued: { ring: "border-zinc-400/20 bg-zinc-400/10", text: "text-zinc-400", dot: "bg-zinc-500" },
  failed: { ring: "border-red-400/30 bg-red-400/10", text: "text-red-300", dot: "bg-red-400" },
  error: { ring: "border-red-400/30 bg-red-400/10", text: "text-red-300", dot: "bg-red-400" },
  paused: { ring: "border-amber-400/30 bg-amber-400/10", text: "text-amber-300", dot: "bg-amber-400" },
  idle: { ring: "border-zinc-400/20 bg-zinc-400/10", text: "text-zinc-400", dot: "bg-zinc-500" },
  published: { ring: "border-signal/30 bg-signal/10", text: "text-signal", dot: "bg-signal", pulse: true },
  publishing: { ring: "border-sky-400/30 bg-sky-400/10", text: "text-sky-300", dot: "bg-sky-400", pulse: true },
  completed: { ring: "border-emerald-400/30 bg-emerald-400/10", text: "text-emerald-300", dot: "bg-emerald-400" },
  discovered: { ring: "border-sky-400/30 bg-sky-400/10", text: "text-sky-300", dot: "bg-sky-400" },
  selected: { ring: "border-signal/30 bg-signal/10", text: "text-signal", dot: "bg-signal" },
  rejected: { ring: "border-red-400/25 bg-red-400/5", text: "text-red-300/80", dot: "bg-red-400/70" },
  used: { ring: "border-violet-400/30 bg-violet-400/10", text: "text-violet-300", dot: "bg-violet-400" },
  inactive: { ring: "border-zinc-400/15 bg-zinc-400/5", text: "text-zinc-500", dot: "bg-zinc-600" },
  active: { ring: "border-signal/30 bg-signal/10", text: "text-signal", dot: "bg-signal", pulse: true },
};

export function StatusBadge({ status, label }: { status: string; label?: string }) {
  const tone = STATUS_TONES[status] ?? STATUS_TONES.queued;
  return (
    <span
      className={`inline-flex items-center gap-1.5 rounded-full border px-2 py-0.5 font-mono text-[10px] uppercase tracking-[0.08em] ${tone.ring} ${tone.text}`}
    >
      <span className={`size-1 rounded-full ${tone.dot} ${tone.pulse ? "dot-live" : ""}`} />
      {label ?? status.replace(/_/g, " ")}
    </span>
  );
}

export function StatusDot({ status }: { status: string }) {
  const tone = STATUS_TONES[status] ?? STATUS_TONES.idle;
  return (
    <span
      className={`inline-block size-2 rounded-full ${tone.dot} ${
        status === "running" ? "dot-live text-current" : ""
      }`}
    />
  );
}

export function StageBadge({ stage }: { stage: string }) {
  const def = stageDef(stage);
  return (
    <span className="inline-flex items-center gap-1.5 rounded-full border border-white/10 bg-white/[0.04] px-2 py-0.5 font-mono text-[10px] uppercase tracking-[0.08em] text-zinc-300">
      <span className="size-1 rounded-full" style={{ background: def.hex }} />
      {def.label}
    </span>
  );
}

/* ------------------------------ data viz ----------------------------- */

export function ScoreOrb({ score, size = 40 }: { score: number; size?: number }) {
  const color = score >= 85 ? "#c6f135" : score >= 70 ? "#fbbf24" : "#f87171";
  return (
    <div
      className="grid shrink-0 place-items-center rounded-full"
      style={{
        width: size,
        height: size,
        background: `conic-gradient(${color} ${score * 3.6}deg, rgba(255,255,255,0.07) 0deg)`,
      }}
      title={`Score ${score}/100`}
    >
      <div
        className="grid place-items-center rounded-full bg-[#0a0c12]"
        style={{ width: size - 7, height: size - 7 }}
      >
        <span
          className="font-mono font-semibold leading-none"
          style={{ fontSize: Math.max(9, size * 0.3), color }}
        >
          {score}
        </span>
      </div>
    </div>
  );
}

export function Sparkline({
  data,
  stroke = "#c6f135",
  className = "",
}: {
  data: number[];
  stroke?: string;
  className?: string;
}) {
  const w = 116;
  const h = 34;
  const pts = data.length >= 2 ? data : [0, ...data, 0];
  const max = Math.max(...pts, 1);
  const min = Math.min(...pts, 0);
  const span = max - min || 1;
  const coords = pts.map((v, i) => [
    (i / (pts.length - 1)) * w,
    h - 3 - ((v - min) / span) * (h - 6),
  ]);
  const line = coords.map((p, i) => `${i ? "L" : "M"}${p[0].toFixed(1)},${p[1].toFixed(1)}`).join(" ");
  const gid = `spark-${stroke.replace(/[^a-z0-9]/gi, "")}`;
  return (
    <svg viewBox={`0 0 ${w} ${h}`} className={`w-full ${className}`} preserveAspectRatio="none">
      <defs>
        <linearGradient id={gid} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor={stroke} stopOpacity="0.32" />
          <stop offset="100%" stopColor={stroke} stopOpacity="0" />
        </linearGradient>
      </defs>
      <path d={`${line} L${w},${h} L0,${h} Z`} fill={`url(#${gid})`} stroke="none" />
      <path d={line} fill="none" stroke={stroke} strokeWidth="1.6" strokeLinecap="round" />
    </svg>
  );
}

export function StatCard({
  icon: Icon,
  label,
  value,
  sub,
  spark,
  accent = "#c6f135",
  delay = 0,
}: {
  icon: LucideIcon;
  label: string;
  value: string;
  sub?: string;
  spark?: number[];
  accent?: string;
  delay?: number;
}) {
  return (
    <div
      className="panel card-hover relative overflow-hidden p-5 animate-fade-up"
      style={{ animationDelay: `${delay}ms` }}
    >
      <div className="flex items-start justify-between">
        <div>
          <p className="eyebrow">{label}</p>
          <p className="mt-2 font-display text-[28px] font-bold leading-none tracking-tight text-white">
            {value}
          </p>
          {sub && <p className="mt-2 text-xs text-zinc-500">{sub}</p>}
        </div>
        <div
          className="grid size-9 place-items-center rounded-lg border"
          style={{ borderColor: `${accent}33`, background: `${accent}0f` }}
        >
          <Icon className="size-4" style={{ color: accent }} />
        </div>
      </div>
      {spark && spark.length > 1 && (
        <div className="mt-4 -mb-1">
          <Sparkline data={spark} stroke={accent} />
        </div>
      )}
    </div>
  );
}

/* ------------------------------- chips ------------------------------- */

export const PLATFORM_COLORS: Record<string, string> = {
  youtube: "#ff5c5c",
  tiktok: "#67e8f9",
  instagram: "#f0abfc",
  x: "#e4e4e7",
};

export const PLATFORM_SHORT: Record<string, string> = {
  youtube: "YT",
  tiktok: "TT",
  instagram: "IG",
  x: "X",
};

export function PlatformMark({ platform }: { platform: string }) {
  const color = PLATFORM_COLORS[platform] ?? "#8b93a7";
  return (
    <span
      title={platform}
      className="grid size-5 place-items-center rounded-md border font-mono text-[8px] font-bold"
      style={{ borderColor: `${color}44`, color, background: `${color}0d` }}
    >
      {PLATFORM_SHORT[platform] ?? platform.slice(0, 2).toUpperCase()}
    </span>
  );
}

export function agentInitials(slug: string): string {
  return slug
    .split("-")
    .map((s) => s[0] ?? "")
    .join("")
    .slice(0, 2)
    .toUpperCase();
}

export function AgentAvatars({ slugs, size = "md" }: { slugs: string[]; size?: "sm" | "md" }) {
  if (slugs.length === 0)
    return <span className="font-mono text-[10px] text-zinc-600">unassigned</span>;
  const dim = size === "sm" ? "size-5 text-[8px]" : "size-6 text-[9px]";
  return (
    <div className="flex -space-x-1.5">
      {slugs.slice(0, 4).map((s) => (
        <span
          key={s}
          title={s}
          className={`grid ${dim} place-items-center rounded-full border border-[#0a0c12] bg-zinc-800 font-mono font-semibold text-zinc-300 ring-1 ring-white/10`}
        >
          {agentInitials(s)}
        </span>
      ))}
      {slugs.length > 4 && (
        <span className={`grid ${dim} place-items-center rounded-full border border-[#0a0c12] bg-zinc-900 font-mono text-zinc-500 ring-1 ring-white/10`}>
          +{slugs.length - 4}
        </span>
      )}
    </div>
  );
}

/* ------------------------------ feedback ----------------------------- */

export function EmptyState({
  icon: Icon = Inbox,
  title,
  body,
  action,
}: {
  icon?: LucideIcon;
  title: string;
  body?: string;
  action?: ReactNode;
}) {
  return (
    <div className="panel grid place-items-center px-6 py-16 text-center">
      <div className="grid size-12 place-items-center rounded-2xl border border-white/[0.08] bg-white/[0.03]">
        <Icon className="size-5 text-zinc-500" />
      </div>
      <h3 className="mt-4 font-display text-base font-semibold text-zinc-200">{title}</h3>
      {body && <p className="mt-1.5 max-w-sm text-sm text-zinc-500">{body}</p>}
      {action && <div className="mt-5">{action}</div>}
    </div>
  );
}

export function MiniBar({
  value,
  max,
  color = "#c6f135",
  className = "",
}: {
  value: number;
  max: number;
  color?: string;
  className?: string;
}) {
  const pct = max > 0 ? Math.min(100, (value / max) * 100) : 0;
  return (
    <div className={`h-1 w-full overflow-hidden rounded-full bg-white/[0.06] ${className}`}>
      <div
        className="h-full rounded-full transition-all duration-700"
        style={{ width: `${pct}%`, background: color }}
      />
    </div>
  );
}
