import {
  ArrowDown,
  Database,
  KeyRound,
  Layers,
  MonitorSmartphone,
  Server,
} from "lucide-react";
import { PROVIDER_DOCS, envConfigured } from "@/lib/services";
import {
  getAgents,
  getAutomationJobs,
  getChannels,
  getContentWithChannel,
  getStoriesWithChannel,
} from "@/lib/queries";
import { ReseedButton } from "@/components/controls";
import { PageHeader, Panel, PanelHeader } from "@/components/ui";

export const dynamic = "force-dynamic";

const ARCHITECTURE = [
  {
    icon: MonitorSmartphone,
    name: "Interface layer",
    path: "src/app · src/components",
    body: "Server-rendered dashboard. Calls engine functions via server actions only — never providers directly.",
  },
  {
    icon: Layers,
    name: "Engine layer",
    path: "src/engine",
    body: "Owns all state transitions: pipeline advancement, sweeps, retries, scheduling. Swappable for a real job runner later.",
  },
  {
    icon: Server,
    name: "Service registry",
    path: "src/lib/services",
    body: "Provider slots selected by environment variables. Real adapters register here with zero UI changes.",
  },
  {
    icon: KeyRound,
    name: "External providers",
    path: "OpenAI · ElevenLabs · YouTube · …",
    body: "Keys live in environment variables only. Nothing is hardcoded; mocks stand in until keys are present.",
  },
];

export default async function SettingsPage() {
  const [channelRows, storyRows, contentRows, agentRows, jobRows] = await Promise.all([
    getChannels(),
    getStoriesWithChannel(),
    getContentWithChannel(),
    getAgents(),
    getAutomationJobs(500),
  ]);

  const dbConfigured = Boolean(process.env.DATABASE_URL);

  return (
    <div className="space-y-6">
      <PageHeader
        eyebrow="System"
        title="Settings"
        description="Provider configuration, workspace internals and data management. Secrets are read from environment variables and never reach the browser."
      />

      {/* integrations */}
      <Panel>
        <PanelHeader
          title="Provider integrations"
          hint="Each slot ships with a mock adapter — add keys to light up real APIs"
          action={
            <span className="rounded-md border border-amber-400/25 bg-amber-400/10 px-2 py-1 font-mono text-[10px] text-amber-300">
              PHASE 1 · MOCKS ACTIVE
            </span>
          }
        />
        <div className="grid grid-cols-1 gap-3 p-5 md:grid-cols-2 xl:grid-cols-3">
          {PROVIDER_DOCS.map((p) => {
            const configured = envConfigured(p.envKeys);
            return (
              <div key={p.id} className="rounded-xl border border-white/[0.06] bg-white/[0.02] p-4">
                <div className="flex items-center justify-between gap-2">
                  <p className="font-display text-sm font-semibold text-zinc-100">{p.label}</p>
                  <span
                    className={`rounded-full border px-2 py-0.5 font-mono text-[9px] uppercase tracking-[0.12em] ${
                      configured
                        ? "border-signal/40 bg-signal/10 text-signal"
                        : "border-white/10 text-zinc-500"
                    }`}
                  >
                    {configured ? "Keys detected" : "Mock"}
                  </span>
                </div>
                <p className="mt-1.5 text-xs leading-relaxed text-zinc-500">{p.description}</p>
                <div className="mt-3 flex flex-wrap gap-1.5">
                  {p.envKeys.map((k) => (
                    <code
                      key={k}
                      className="rounded border border-white/[0.07] bg-black/30 px-1.5 py-0.5 font-mono text-[9px] text-zinc-500"
                    >
                      {k}
                    </code>
                  ))}
                </div>
              </div>
            );
          })}
        </div>
      </Panel>

      {/* architecture */}
      <Panel>
        <PanelHeader
          title="Architecture"
          hint="Engine separated from UI so real services plug in without a rebuild"
        />
        <div className="space-y-2 p-5">
          {ARCHITECTURE.map((layer, i) => (
            <div key={layer.name}>
              <div className="flex items-center gap-4 rounded-xl border border-white/[0.06] bg-white/[0.02] px-4 py-3.5">
                <div className="grid size-9 shrink-0 place-items-center rounded-lg border border-signal/25 bg-signal/[0.07]">
                  <layer.icon className="size-4 text-signal" />
                </div>
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-baseline gap-x-3">
                    <p className="font-display text-sm font-semibold text-white">{layer.name}</p>
                    <code className="font-mono text-[10px] text-zinc-500">{layer.path}</code>
                  </div>
                  <p className="mt-0.5 text-xs leading-relaxed text-zinc-500">{layer.body}</p>
                </div>
              </div>
              {i < ARCHITECTURE.length - 1 && (
                <div className="flex justify-start pl-8 py-0.5">
                  <ArrowDown className="size-3.5 text-zinc-700" />
                </div>
              )}
            </div>
          ))}
        </div>
      </Panel>

      {/* environment + data */}
      <div className="grid grid-cols-1 gap-4 xl:grid-cols-2">
        <Panel>
          <PanelHeader title="Environment" hint="Runtime and database status" />
          <ul className="divide-y divide-white/[0.05]">
            <li className="flex items-center justify-between px-5 py-3.5">
              <span className="flex items-center gap-2 text-sm text-zinc-300">
                <Database className="size-4 text-zinc-500" /> PostgreSQL (Drizzle ORM)
              </span>
              <span
                className={`rounded-full border px-2 py-0.5 font-mono text-[9px] uppercase tracking-[0.12em] ${
                  dbConfigured
                    ? "border-signal/40 bg-signal/10 text-signal"
                    : "border-red-400/40 bg-red-400/10 text-red-300"
                }`}
              >
                {dbConfigured ? "Connected" : "Missing DATABASE_URL"}
              </span>
            </li>
            {[
              ["Channels", channelRows.length],
              ["Stories in intake", storyRows.length],
              ["Content items", contentRows.length],
              ["Agents registered", agentRows.length],
              ["Automation jobs logged", jobRows.length],
            ].map(([label, count]) => (
              <li key={label as string} className="flex items-center justify-between px-5 py-3">
                <span className="text-sm text-zinc-500">{label}</span>
                <span className="font-mono text-sm text-zinc-200">{count as number}</span>
              </li>
            ))}
          </ul>
        </Panel>

        <Panel>
          <PanelHeader title="Data management" hint="Demo dataset controls" />
          <div className="space-y-4 p-5">
            <p className="text-sm leading-relaxed text-zinc-500">
              The demo dataset repopulates every table with believable channels, pipeline content,
              agent activity, job history and 14 days of analytics. Useful when hand-testing or
              after schema experiments.
            </p>
            <div className="flex flex-wrap items-center gap-3">
              <ReseedButton />
              <p className="font-mono text-[10px] text-zinc-600">
                equivalent CLI: npx tsx scripts/seed.ts
              </p>
            </div>
            <div className="rounded-xl border border-amber-400/20 bg-amber-400/[0.05] p-4">
              <p className="text-xs leading-relaxed text-amber-200/80">
                Destructive action: reseeding wipes channels, stories, content, jobs and analytics
                before inserting fresh demo rows. This is intentional for the phase-1 sandbox.
              </p>
            </div>
          </div>
        </Panel>
      </div>
    </div>
  );
}
