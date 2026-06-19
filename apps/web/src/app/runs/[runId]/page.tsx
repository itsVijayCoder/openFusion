import type { FusionRunDetail } from "@fusion-harness/shared";
import { apiGet } from "@/lib/api";
import { RunChat } from "./run-chat";

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
    messages: [],
  };
}

export default async function RunDetailPage({ params }: RunPageProps) {
  const { runId } = await params;
  const run = await apiGet<FusionRunDetail>(`/api/fusion/runs/${runId}`, fallbackRun(runId));

  return <RunChat run={run.data} />;
}