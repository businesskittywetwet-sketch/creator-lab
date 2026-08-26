import { Bot, CheckCircle2, XCircle } from "lucide-react";
import { getAgents } from "@/lib/queries";
import { timeAgo } from "@/lib/format";
import { AgentToggle } from "@/components/controls";
import { AgentIcon } from "@/components/agent-icon";
import {
  EmptyState,
  MiniBar,
  PageHeader,
  StatusBadge,
} from "@/components/ui";

export const dynamic = "force-dynamic";

export default async function AgentsPage() {
  const agentRows = await getAgents();
  const running = agentRows.filter((a) => a.status === "running").length;
  const avgSuccess = agentRows.length
    ? Math.round(agentRows.reduce((a, x) => a + x.successRate, 0) / agentRows.length)
    : 0;

  return (
    <div className="space-y-6">
      <PageHeader
        eyebrow="Fleet"
        title="AI agents"
        description="The autonomous workforce. Each agent is a stateless worker wired to a provider slot — swap mocks for live model APIs without touching this UI."
        actions={
          <div className="flex items-center gap-2 rounded-lg border border-white/[0.08] bg-white/[0.02] px-3 py-2">
            <span className="dot-live size-1.5 rounded-full bg-signal text-signal" />
            <span className="font-mono text-[10px] uppercase tracking-[0.16em] text-zinc-400">
              {running} on task · {avgSuccess}% fleet success
            </span>
          </div>
        }
      />

      {agentRows.length === 0 ? (
        <EmptyState
          icon={Bot}
          title="No agents registered"
          body="Seed the demo dataset from Settings to register the eleven-agent workforce."
        />
      ) : (
        <div className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-3">
          {agentRows.map((a, i) => (
            <div
              key={a.id}
              className="panel card-hover flex flex-col p-5 animate-fade-up"
              style={{ animationDelay: `${Math.min(i, 8) * 55}ms` }}
            >
              <div className="flex items-start gap-3">
                <div
                  className={`grid size-10 shrink-0 place-items-center rounded-xl border ${
                    a.status === "running"
                      ? "border-sky-400/30 bg-sky-400/10 text-sky-300"
                      : a.status === "error"
                        ? "border-red-400/30 bg-red-400/10 text-red-300"
                        : "border-white/[0.08] bg-white/[0.03] text-zinc-400"
                  }`}
                >
                  <AgentIcon icon={a.icon} className="size-4.5" />
                </div>
                <div className="min-w-0 flex-1">
                  <h3 className="truncate font-display text-sm font-bold text-white">{a.name}</h3>
                  <p className="font-mono text-[9px] uppercase tracking-[0.22em] text-zinc-500">
                    {a.role} · {a.slug}
                  </p>
                </div>
                <StatusBadge status={a.status} />
              </div>

              <p className="mt-3 text-xs leading-relaxed text-zinc-500">{a.description}</p>

              <div className="mt-4 space-y-2.5">
                <div>
                  <p className="font-mono text-[9px] uppercase tracking-[0.22em] text-zinc-600">
                    Current task
                  </p>
                  {a.status === "running" && a.currentTask ? (
                    <div className="mt-1.5 rounded-lg border border-sky-400/25 bg-sky-400/[0.07] px-3 py-2">
                      <p className="flex items-center gap-2 text-xs leading-snug text-sky-200">
                        <span className="dot-live size-1.5 shrink-0 rounded-full bg-sky-400 text-sky-400" />
                        {a.currentTask}
                      </p>
                    </div>
                  ) : (
                    <div className="mt-1.5 rounded-lg border border-dashed border-white/[0.08] px-3 py-2">
                      <p className="font-mono text-[10px] uppercase tracking-[0.14em] text-zinc-600">
                        {a.status === "paused"
                          ? "Paused by operator"
                          : a.status === "error"
                            ? "Halted — needs attention"
                            : "Standing by"}
                      </p>
                    </div>
                  )}
                </div>

                {a.lastTask && (
                  <div>
                    <p className="font-mono text-[9px] uppercase tracking-[0.22em] text-zinc-600">
                      Last completed
                    </p>
                    <p className="mt-1.5 flex items-start gap-2 text-xs leading-snug text-zinc-400">
                      {a.lastTaskStatus === "success" ? (
                        <CheckCircle2 className="mt-0.5 size-3.5 shrink-0 text-emerald-400" />
                      ) : (
                        <XCircle className="mt-0.5 size-3.5 shrink-0 text-red-400" />
                      )}
                      <span>
                        {a.lastTask}
                        <span className="ml-1.5 font-mono text-[10px] text-zinc-600">
                          {timeAgo(a.lastRunAt)}
                        </span>
                      </span>
                    </p>
                  </div>
                )}
              </div>

              <div className="mt-auto pt-4">
                <div className="mb-2 flex items-center justify-between font-mono text-[10px]">
                  <span className="uppercase tracking-[0.18em] text-zinc-600">Success rate</span>
                  <span
                    className={
                      a.successRate >= 95
                        ? "text-signal"
                        : a.successRate >= 90
                          ? "text-amber-300"
                          : "text-red-300"
                    }
                  >
                    {a.successRate}%
                  </span>
                </div>
                <MiniBar
                  value={a.successRate}
                  max={100}
                  color={a.successRate >= 95 ? "#c6f135" : a.successRate >= 90 ? "#fbbf24" : "#f87171"}
                />
                <div className="mt-3 flex items-center justify-between border-t border-white/[0.05] pt-3">
                  <p className="font-mono text-[10px] text-zinc-600">
                    {a.totalRuns} runs · {a.failedRuns} failed
                  </p>
                  <AgentToggle id={a.id} status={a.status} />
                </div>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
