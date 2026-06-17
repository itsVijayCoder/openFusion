import type { FusionRunDetail } from "@fusion-harness/shared";
import Link from "next/link";
import { DataNotice, EmptyState, Metric, PageHeader, Section, StatusPill } from "@/components/product-ui";
import { apiGet } from "@/lib/api";
import { formatBytes, formatDateTime } from "@/lib/format";
import { RunEventStream } from "./run-event-stream";

export const dynamic = "force-dynamic";

type RunPageProps = {
  params: Promise<{ runId: string }>;
};

function fallbackRun(runId: string): FusionRunDetail {
  return {
    id: runId,
    orgId: "org_dev",
    userId: "usr_dev",
    status: "queued",
    mode: "auto",
    permissionProfile: "readonly",
    createdAt: new Date().toISOString(),
    panelOutputs: [],
    artifacts: [],
    auditEvents: [],
  };
}

export default async function RunDetailPage({ params }: RunPageProps) {
  const { runId } = await params;
  const run = await apiGet<FusionRunDetail>(`/api/fusion/runs/${runId}`, fallbackRun(runId));

  return (
    <div className="flex min-w-0 flex-col gap-6 overflow-hidden p-6">
      <PageHeader title={run.data.id} description="Fusion trace, panel outputs, judge/final artifacts, and audit history." />
      <DataNotice source={run.source} error={run.error} />
      <div className="grid gap-4 md:grid-cols-4">
        <Metric label="Status" value={run.data.status} detail={run.data.error} />
        <Metric label="Mode" value={run.data.mode} detail={run.data.preset ?? "No preset"} />
        <Metric label="Permission" value={run.data.permissionProfile} />
        <Metric label="Created" value={formatDateTime(run.data.createdAt)} />
      </div>
      <RunEventStream runId={run.data.id} />
      <div className="grid min-w-0 gap-6 xl:grid-cols-[minmax(0,1.2fr)_minmax(320px,0.8fr)]">
        <Section title="Panel Outputs">
          {run.data.panelOutputs.length ? (
            <div className="divide-y divide-border rounded-lg border border-border">
              {run.data.panelOutputs.map((output) => (
                <div key={output.id} className="p-4">
                  <div className="flex items-center justify-between gap-3">
                    <p className="font-medium">{output.modelId}</p>
                    <StatusPill value={output.status} />
                  </div>
                  <p className="mt-2 text-sm text-muted-foreground">
                    {output.adapter} {output.latencyMs ? `- ${output.latencyMs}ms` : ""}
                  </p>
                  {output.error ? <p className="mt-2 text-sm text-destructive">{output.error}</p> : null}
                </div>
              ))}
            </div>
          ) : (
            <EmptyState title="No panel output yet" description="Panel output metadata appears after a runner starts processing the run." />
          )}
        </Section>
        <Section title="Artifacts">
          {run.data.artifacts.length ? (
            <div className="divide-y divide-border rounded-lg border border-border">
              {run.data.artifacts.map((artifact) => (
                <Link key={artifact.id} href={`/artifacts/${artifact.id}`} className="block p-4 hover:bg-muted/50">
                  <div className="flex items-center justify-between gap-3">
                    <p className="font-medium">{artifact.kind}</p>
                    <span className="text-xs text-muted-foreground">{formatBytes(artifact.sizeBytes)}</span>
                  </div>
                  <p className="mt-1 truncate text-xs text-muted-foreground">{artifact.objectKey}</p>
                </Link>
              ))}
            </div>
          ) : (
            <EmptyState title="No artifacts yet" description="Prompt, panel, judge, final, patch, and log artifacts are stored in R2." />
          )}
        </Section>
      </div>
      <Section title="Audit History">
        {run.data.auditEvents.length ? (
          <div className="divide-y divide-border rounded-lg border border-border">
            {run.data.auditEvents.map((event) => (
              <div key={event.id} className="flex items-center justify-between gap-4 p-4 text-sm">
                <div className="min-w-0">
                  <p className="truncate font-medium">{event.eventType}</p>
                  <p className="text-xs text-muted-foreground">{formatDateTime(event.createdAt)}</p>
                </div>
                <StatusPill value={event.severity} />
              </div>
            ))}
          </div>
        ) : (
          <EmptyState title="No audit events for this run" description="Approvals, runner events, commands, file edits, and artifact uploads will appear here." />
        )}
      </Section>
    </div>
  );
}
