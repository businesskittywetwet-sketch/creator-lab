"use client";

import {
  Area,
  AreaChart,
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";

/* ---------------------------- primitives --------------------------- */

function TooltipBox({
  active,
  payload,
  label,
  formatter,
}: {
  active?: boolean;
  payload?: { value?: number | string; name?: string }[];
  label?: string;
  formatter?: (v: number) => string;
}) {
  if (!active || !payload?.length) return null;
  const v = Number(payload[0]?.value ?? 0);
  return (
    <div className="rounded-lg border border-white/10 bg-[#0b0d14]/95 px-3 py-2 shadow-2xl backdrop-blur">
      <p className="font-mono text-[9px] uppercase tracking-[0.2em] text-zinc-500">{label}</p>
      <p className="mt-1 font-mono text-sm font-semibold text-white">
        {formatter ? formatter(v) : v.toLocaleString()}
      </p>
    </div>
  );
}

export function ViewsAreaChart({
  data,
  color = "#c6f135",
  height = 260,
}: {
  data: { label: string; views: number }[];
  color?: string;
  height?: number;
}) {
  const gid = `area-${color.replace(/[^a-z0-9]/gi, "")}`;
  return (
    <div style={{ height }}>
      <ResponsiveContainer width="100%" height="100%">
        <AreaChart data={data} margin={{ top: 8, right: 4, left: -14, bottom: 0 }}>
          <defs>
            <linearGradient id={gid} x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor={color} stopOpacity={0.28} />
              <stop offset="100%" stopColor={color} stopOpacity={0} />
            </linearGradient>
          </defs>
          <CartesianGrid stroke="rgba(255,255,255,0.05)" vertical={false} />
          <XAxis
            dataKey="label"
            tick={{ fill: "#52525b", fontSize: 10, fontFamily: "var(--font-jbmono)" }}
            axisLine={false}
            tickLine={false}
            interval="preserveStartEnd"
            minTickGap={40}
          />
          <YAxis
            tick={{ fill: "#52525b", fontSize: 10, fontFamily: "var(--font-jbmono)" }}
            axisLine={false}
            tickLine={false}
            tickFormatter={(v: number) =>
              v >= 1000 ? `${Math.round(v / 100) / 10}K` : String(v)
            }
          />
          <Tooltip
            content={<TooltipBox />}
            cursor={{ stroke: "rgba(255,255,255,0.15)", strokeDasharray: "3 3" }}
          />
          <Area
            type="monotone"
            dataKey="views"
            stroke={color}
            strokeWidth={2}
            fill={`url(#${gid})`}
            dot={false}
            activeDot={{ r: 3.5, fill: color, stroke: "#05060a", strokeWidth: 2 }}
          />
        </AreaChart>
      </ResponsiveContainer>
    </div>
  );
}

export function EngageBarChart({
  data,
  height = 260,
}: {
  data: { label: string; likes: number; shares: number; comments: number }[];
  height?: number;
}) {
  return (
    <div style={{ height }}>
      <ResponsiveContainer width="100%" height="100%">
        <BarChart data={data} margin={{ top: 8, right: 4, left: -14, bottom: 0 }} barGap={2}>
          <CartesianGrid stroke="rgba(255,255,255,0.05)" vertical={false} />
          <XAxis
            dataKey="label"
            tick={{ fill: "#52525b", fontSize: 10, fontFamily: "var(--font-jbmono)" }}
            axisLine={false}
            tickLine={false}
            interval="preserveStartEnd"
            minTickGap={40}
          />
          <YAxis
            tick={{ fill: "#52525b", fontSize: 10, fontFamily: "var(--font-jbmono)" }}
            axisLine={false}
            tickLine={false}
            tickFormatter={(v: number) =>
              v >= 1000 ? `${Math.round(v / 100) / 10}K` : String(v)
            }
          />
          <Tooltip
            content={<TooltipBox />}
            cursor={{ fill: "rgba(255,255,255,0.04)" }}
          />
          <Bar dataKey="likes" fill="#c6f135" radius={[3, 3, 0, 0]} maxBarSize={10} />
          <Bar dataKey="shares" fill="#67e8f9" radius={[3, 3, 0, 0]} maxBarSize={10} />
          <Bar dataKey="comments" fill="#a78bfa" radius={[3, 3, 0, 0]} maxBarSize={10} />
        </BarChart>
      </ResponsiveContainer>
    </div>
  );
}

/* ------------------------------ donut ------------------------------ */

export function PlatformDonut({
  segments,
}: {
  segments: { label: string; value: number; color: string }[];
}) {
  const total = segments.reduce((a, s) => a + s.value, 0);
  let acc = 0;
  const stops = segments
    .filter((s) => s.value > 0)
    .map((s) => {
      const from = (acc / total) * 360;
      acc += s.value;
      const to = (acc / total) * 360;
      return `${s.color} ${from.toFixed(1)}deg ${to.toFixed(1)}deg`;
    })
    .join(", ");
  return (
    <div className="flex items-center gap-6">
      <div
        className="relative grid size-36 shrink-0 place-items-center rounded-full"
        style={{
          background: total > 0 ? `conic-gradient(${stops})` : "rgba(255,255,255,0.05)",
        }}
      >
        <div className="grid size-[104px] place-items-center rounded-full bg-[#0a0c12] text-center">
          <div>
            <p className="font-display text-xl font-bold text-white">
              {total >= 1000 ? `${(total / 1000).toFixed(0)}K` : total}
            </p>
            <p className="font-mono text-[8px] uppercase tracking-[0.2em] text-zinc-500">
              views
            </p>
          </div>
        </div>
      </div>
      <ul className="space-y-2.5">
        {segments.map((s) => (
          <li key={s.label} className="flex items-center gap-2 text-xs">
            <span className="size-2 rounded-sm" style={{ background: s.color }} />
            <span className="text-zinc-400">{s.label}</span>
            <span className="ml-auto pl-4 font-mono text-[11px] text-zinc-300">
              {total > 0 ? `${Math.round((s.value / total) * 100)}%` : "0%"}
            </span>
          </li>
        ))}
      </ul>
    </div>
  );
}

export { Cell };
