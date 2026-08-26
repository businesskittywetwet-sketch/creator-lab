"use client";

import { useActionState } from "react";
import { CheckCircle2 } from "lucide-react";
import { saveAutomationConfig, type ActionState } from "@/app/actions";
import { SubmitButton } from "@/components/controls";

export type ConfigDefaults = {
  discoveryIntervalHours: number;
  publishWindowStart: string;
  publishWindowEnd: string;
  dailyPublishCap: number;
  maxConcurrentJobs: number;
  autoRetry: boolean;
  timezone: string;
  judgeThreshold: number;
  scoutMaxStoriesPerRun: number;
  retryDelayMinutes: number;
};

export default function AutomationConfigForm({ defaults }: { defaults: ConfigDefaults }) {
  const [state, formAction] = useActionState<ActionState, FormData>(saveAutomationConfig, {
    ok: false,
  });

  return (
    <form action={formAction} className="grid grid-cols-1 gap-4 sm:grid-cols-2">
      <div>
        <label className="label" htmlFor="a-interval">Discovery interval (hours)</label>
        <input
          id="a-interval"
          name="discoveryIntervalHours"
          type="number"
          min={1}
          max={48}
          defaultValue={defaults.discoveryIntervalHours}
          className="field"
        />
      </div>
      <div>
        <label className="label" htmlFor="a-tz">Timezone</label>
        <select id="a-tz" name="timezone" defaultValue={defaults.timezone} className="field">
          {["UTC", "America/New_York", "America/Los_Angeles", "Europe/London", "Europe/Berlin"].map(
            (tz) => (
              <option key={tz} value={tz}>
                {tz}
              </option>
            ),
          )}
        </select>
      </div>
      <div>
        <label className="label" htmlFor="a-win1">Publish window start</label>
        <input
          id="a-win1"
          name="publishWindowStart"
          type="time"
          defaultValue={defaults.publishWindowStart}
          className="field"
        />
      </div>
      <div>
        <label className="label" htmlFor="a-win2">Publish window end</label>
        <input
          id="a-win2"
          name="publishWindowEnd"
          type="time"
          defaultValue={defaults.publishWindowEnd}
          className="field"
        />
      </div>
      <div>
        <label className="label" htmlFor="a-cap">Daily publish cap</label>
        <input
          id="a-cap"
          name="dailyPublishCap"
          type="number"
          min={1}
          max={50}
          defaultValue={defaults.dailyPublishCap}
          className="field"
        />
      </div>
      <div>
        <label className="label" htmlFor="a-conc">Max concurrent jobs</label>
        <input
          id="a-conc"
          name="maxConcurrentJobs"
          type="number"
          min={1}
          max={16}
          defaultValue={defaults.maxConcurrentJobs}
          className="field"
        />
      </div>
      <div>
        <label className="label" htmlFor="a-threshold">Judge greenlight score ≥</label>
        <input
          id="a-threshold"
          name="judgeThreshold"
          type="number"
          min={40}
          max={95}
          defaultValue={defaults.judgeThreshold}
          className="field"
        />
      </div>
      <div>
        <label className="label" htmlFor="a-maxstories">Stories judged per run</label>
        <input
          id="a-maxstories"
          name="scoutMaxStoriesPerRun"
          type="number"
          min={1}
          max={100}
          defaultValue={defaults.scoutMaxStoriesPerRun}
          className="field"
        />
      </div>
      <div>
        <label className="label" htmlFor="a-retry">Auto-retry delay (minutes)</label>
        <input
          id="a-retry"
          name="retryDelayMinutes"
          type="number"
          min={1}
          max={240}
          defaultValue={defaults.retryDelayMinutes}
          className="field"
        />
      </div>

      <label className="flex cursor-pointer items-center gap-3 rounded-lg border border-white/[0.08] bg-white/[0.02] px-4 py-3 sm:col-span-2">
        <input
          type="checkbox"
          name="autoRetry"
          defaultChecked={defaults.autoRetry}
          className="peer sr-only"
        />
        <span className="grid size-5 place-items-center rounded border border-white/15 transition peer-checked:border-signal peer-checked:bg-signal peer-checked:[&>span]:opacity-100">
          <span className="size-2 rounded-sm bg-black opacity-0" />
        </span>
        <span>
          <span className="block text-sm text-zinc-200">Auto-retry failed jobs</span>
          <span className="block text-xs text-zinc-500">
            Failed automation jobs are re-queued automatically up to their attempt limit.
          </span>
        </span>
      </label>

      <div className="flex items-center justify-end gap-3 sm:col-span-2">
        {state.ok && (
          <span className="inline-flex items-center gap-1.5 text-xs text-signal">
            <CheckCircle2 className="size-3.5" /> Schedule saved — next run recomputed
          </span>
        )}
        {state.error && <span className="text-xs text-red-300">{state.error}</span>}
        <SubmitButton label="Save schedule" />
      </div>
    </form>
  );
}
