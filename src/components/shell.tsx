"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useState, type ReactNode } from "react";
import {
  Activity,
  Aperture,
  Bot,
  BarChart3,
  Bell,
  CalendarDays,
  CirclePlay,
  Clapperboard,
  Columns3,
  Cpu,
  Layers,
  Send,
  LayoutDashboard,
  Menu,
  Newspaper,
  Radio,
  Search,
  Settings2,
  Workflow,
  X,
} from "lucide-react";

const NAV: {
  group: string;
  items: { href: string; label: string; icon: typeof Radio }[];
}[] = [
  {
    group: "Command",
    items: [{ href: "/overview", label: "Overview", icon: LayoutDashboard }],
  },
  {
    group: "Studio",
    items: [
      { href: "/niches", label: "Niches", icon: Layers },
      { href: "/channels", label: "Channels", icon: Radio },
      { href: "/queue", label: "Content Queue", icon: Columns3 },
      { href: "/production", label: "Production", icon: Clapperboard },
      { href: "/stories", label: "Stories", icon: Newspaper },
    ],
  },
  {
    group: "Fleet",
    items: [{ href: "/agents", label: "AI Agents", icon: Bot }],
  },
  {
    group: "Output",
    items: [
      { href: "/publishing", label: "Publishing Queue", icon: Send },
      { href: "/calendar", label: "Content Calendar", icon: CalendarDays },
      { href: "/published", label: "Published Content", icon: CirclePlay },
      { href: "/creator-analytics", label: "Creator Analytics", icon: BarChart3 },
      { href: "/analytics", label: "Analytics", icon: Activity },
    ],
  },
  {
    group: "System",
    items: [
      { href: "/workers", label: "Workers & Jobs", icon: Cpu },
      { href: "/automation", label: "Automation", icon: Workflow },
      { href: "/settings", label: "Settings", icon: Settings2 },
    ],
  },
];

const ALL_ITEMS = NAV.flatMap((g) => g.items);

export default function AppShell({
  children,
  automationEnabled,
  nextRunLabel,
  activeAgents,
  attentionCount = 0,
  unread = 0,
  reviewCount = 0,
}: {
  children: ReactNode;
  automationEnabled: boolean;
  nextRunLabel: string;
  activeAgents: number;
  attentionCount?: number;
  unread?: number;
  reviewCount?: number;
}) {
  const pathname = usePathname();
  const [open, setOpen] = useState(false);
  const current =
    ALL_ITEMS.find((i) => pathname.startsWith(i.href))?.label ?? "Overview";

  return (
    <div className="relative z-10 min-h-screen">
      {/* ------------------------------ sidebar ------------------------------ */}
      <aside
        className={`fixed inset-y-0 left-0 z-50 flex w-60 flex-col border-r border-white/[0.06] bg-[#07080e]/95 backdrop-blur-xl transition-transform duration-300 ease-out lg:translate-x-0 ${
          open ? "translate-x-0" : "-translate-x-full"
        }`}
      >
        <div className="flex h-16 items-center gap-3 border-b border-white/[0.06] px-5">
          <div className="grid size-8 place-items-center rounded-lg border border-signal/40 bg-signal/10">
            <Aperture className="size-4 text-signal" />
          </div>
          <div className="leading-tight">
            <p className="font-display text-sm font-bold tracking-[0.18em] text-white">
              VIBORO
            </p>
            <p className="font-mono text-[9px] uppercase tracking-[0.28em] text-zinc-500">
              Creator Lab
            </p>
          </div>
        </div>

        <nav className="flex-1 overflow-y-auto px-3 py-5">
          {NAV.map((section) => (
            <div key={section.group} className="mb-5">
              <p className="px-3 pb-2 font-mono text-[9px] uppercase tracking-[0.3em] text-zinc-600">
                {section.group}
              </p>
              <ul className="space-y-0.5">
                {section.items.map((item) => {
                  const active = pathname.startsWith(item.href);
                  const Icon = item.icon;
                  return (
                    <li key={item.href}>
                      <Link
                        href={item.href}
                        onClick={() => setOpen(false)}
                        className={`group relative flex items-center gap-3 rounded-lg px-3 py-2 text-[13px] transition-colors ${
                          active
                            ? "bg-white/[0.07] font-medium text-white"
                            : "text-zinc-500 hover:bg-white/[0.04] hover:text-zinc-200"
                        }`}
                      >
                        {active && (
                          <span className="absolute left-0 top-1/2 h-4 w-[2px] -translate-y-1/2 rounded-full bg-signal" />
                        )}
                        <Icon
                          className={`size-4 ${active ? "text-signal" : "text-zinc-600 group-hover:text-zinc-400"}`}
                        />
                        {item.label}
                        {item.href === "/agents" && activeAgents > 0 && (
                          <span className="ml-auto rounded-full bg-signal/10 px-1.5 py-0.5 font-mono text-[9px] text-signal">
                            {activeAgents}
                          </span>
                        )}
                        {item.href === "/production" && reviewCount > 0 && (
                          <span className="ml-auto rounded-full bg-amber-400/15 px-1.5 py-0.5 font-mono text-[9px] text-amber-300">
                            {reviewCount}
                          </span>
                        )}
                      </Link>
                    </li>
                  );
                })}
              </ul>
            </div>
          ))}
        </nav>

        <div className="border-t border-white/[0.06] p-4">
          <div className="rounded-xl border border-white/[0.06] bg-white/[0.02] p-3">
            <div className="flex items-center gap-2">
              <span
                className={`size-1.5 rounded-full ${
                  automationEnabled ? "dot-live bg-signal text-signal" : "bg-zinc-600"
                }`}
              />
              <p className="font-mono text-[9px] uppercase tracking-[0.24em] text-zinc-500">
                Automation
              </p>
              <p
                className={`ml-auto font-mono text-[9px] uppercase tracking-[0.14em] ${
                  automationEnabled ? "text-signal" : "text-zinc-600"
                }`}
              >
                {automationEnabled ? "Online" : "Paused"}
              </p>
            </div>
            <p className="mt-2 text-xs text-zinc-400">
              Next sweep <span className="text-zinc-200">{nextRunLabel}</span>
            </p>
          </div>
          <p className="mt-3 text-center font-mono text-[9px] uppercase tracking-[0.3em] text-zinc-700">
            Phase 1 · Mock Providers
          </p>
        </div>
      </aside>

      {open && (
        <button
          aria-label="Close navigation"
          onClick={() => setOpen(false)}
          className="fixed inset-0 z-40 bg-black/60 backdrop-blur-sm lg:hidden"
        />
      )}

      {/* ------------------------------ main ------------------------------ */}
      <div className="relative z-10 lg:pl-60">
        <header className="sticky top-0 z-30 flex h-16 items-center gap-4 border-b border-white/[0.06] bg-[#05060a]/80 px-4 backdrop-blur-xl sm:px-6 lg:px-10">
          <button
            onClick={() => setOpen(!open)}
            aria-label="Toggle navigation"
            className="grid size-9 place-items-center rounded-lg border border-white/[0.08] text-zinc-400 transition hover:text-white lg:hidden"
          >
            {open ? <X className="size-4" /> : <Menu className="size-4" />}
          </button>
          <div className="flex items-baseline gap-3">
            <span className="hidden font-mono text-[10px] uppercase tracking-[0.3em] text-zinc-600 sm:inline">
              Viboro Creator Lab
            </span>
            <span className="hidden text-zinc-700 sm:inline">/</span>
            <h1 className="font-display text-sm font-semibold tracking-wide text-white">
              {current}
            </h1>
          </div>

          <div className="ml-auto flex items-center gap-3">
            <div className="hidden items-center gap-2 rounded-lg border border-white/[0.07] bg-white/[0.02] px-3 py-1.5 md:flex">
              <Search className="size-3.5 text-zinc-600" />
              <input
                placeholder="Search operations…"
                className="w-44 bg-transparent text-xs text-zinc-300 outline-none placeholder:text-zinc-600"
              />
              <kbd className="rounded border border-white/10 px-1 font-mono text-[9px] text-zinc-600">
                ⌘K
              </kbd>
            </div>
            <div className="hidden items-center gap-2 rounded-full border border-signal/25 bg-signal/[0.06] px-3 py-1.5 sm:flex">
              <span className="dot-live size-1.5 rounded-full bg-signal text-signal" />
              <span className="font-mono text-[9px] uppercase tracking-[0.22em] text-signal">
                Systems nominal
              </span>
            </div>
            <Link
              href="/overview#attention"
              title={`${attentionCount} item(s) need attention`}
              className="relative grid size-9 place-items-center rounded-lg border border-white/[0.08] text-zinc-400 transition hover:border-white/25 hover:text-white"
            >
              <Bell className="size-4" />
              {(attentionCount > 0 || unread > 0) && (
                <span className="absolute -right-1 -top-1 grid min-w-4 place-items-center rounded-full bg-signal px-1 font-mono text-[9px] font-bold text-black">
                  {attentionCount || unread}
                </span>
              )}
            </Link>
            <div className="grid size-9 place-items-center rounded-full border border-white/10 bg-gradient-to-br from-white/10 to-transparent font-mono text-[10px] font-semibold text-zinc-300">
              OP
            </div>
          </div>
        </header>

        <main className="mx-auto w-full max-w-[1440px] px-4 pb-20 pt-7 sm:px-6 lg:px-10">
          {children}
        </main>
      </div>
    </div>
  );
}
