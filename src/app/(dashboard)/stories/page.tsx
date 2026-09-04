import { Newspaper } from "lucide-react";
import StoriesTable, { type StoryListRow } from "@/components/stories-table";
import { RunSweepButton } from "@/components/controls";
import { getLatestEvaluations, getStoriesWithChannel } from "@/lib/queries";
import { timeAgo } from "@/lib/format";
import { EmptyState, PageHeader } from "@/components/ui";

export const dynamic = "force-dynamic";

export default async function StoriesPage() {
  const [rows, evaluations] = await Promise.all([
    getStoriesWithChannel(),
    getLatestEvaluations(),
  ]);

  const list: StoryListRow[] = rows.map((s) => {
    const ev = evaluations.get(s.id);
    return {
      id: s.id,
      title: s.title,
      summary: s.summary,
      channelName: s.channelName ?? "Unassigned",
      channelColor: s.channelColor ?? "#8b93a7",
      score: s.score,
      status: s.status,
      tags: s.tags,
      sourceName: s.sourceName,
      ageLabel: timeAgo(s.createdAt),
      evaluation: ev
        ? { provider: ev.provider, recommendation: ev.recommendation, dims: ev.dims }
        : null,
    };
  });

  return (
    <div className="space-y-6">
      <PageHeader
        eyebrow="Intake"
        title="Stories"
        description="Raw story candidates surfaced by the Story Scout and scored by the Story Judge. Promote winners straight into the production pipeline."
        actions={<RunSweepButton />}
      />

      {list.length === 0 ? (
        <EmptyState
          icon={Newspaper}
          title="No stories in the intake"
          body="Run a discovery sweep to let the Story Scout surface new candidates for your channels."
          action={<RunSweepButton />}
        />
      ) : (
        <StoriesTable rows={list} />
      )}
    </div>
  );
}
