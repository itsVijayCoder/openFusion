import {
  completeRunnerJob,
  createArtifact,
  createRunEvent,
  getRunnerJob,
  updatePanelOutput,
} from "@openfusion/db";
import {
  type ArtifactKind,
  formatEntityId,
  type RunEvent,
  type RunnerEvent,
  type RunnerJob,
  type RunnerJobKind,
  type RunnerJobStatus,
} from "@openfusion/shared";
import type { Env } from "../env";
import { buildArtifactKey } from "./artifact-store";
import { notifyRunnerSessionObject } from "./runner-session";
import { advanceFusionRunAfterJob, appendRunEvent, notifyFusionRunObject } from "./runs";

export type JobWorkMessage =
  | {
      kind: "complete";
      orgId: string;
      runnerId: string;
      jobId: string;
      status: Extract<RunnerJobStatus, "completed" | "failed" | "timeout" | "cancelled">;
      outputText?: string;
      error?: string;
      latencyMs?: number;
      usage?: Record<string, unknown>;
      artifactKeys?: string[];
    }
  | {
      kind: "event";
      orgId: string;
      event: RunEvent;
    };

export async function processJobWork(env: Env, message: JobWorkMessage): Promise<void> {
  if (message.kind === "event") {
    await persistEvent(env, message.orgId, message.event);
    return;
  }

  await completeJob(env, message);
}

async function completeJob(
  env: Env,
  message: Extract<JobWorkMessage, { kind: "complete" }>,
): Promise<void> {
  const { orgId, runnerId, jobId, status } = message;
  const existingJob = await getRunnerJob(env.DB, orgId, runnerId, jobId);
  if (!existingJob) {
    return;
  }

  const now = new Date().toISOString();
  const outputObjectKey = await persistJobOutput(env, orgId, existingJob, message.outputText);
  const job = await completeRunnerJob(env.DB, {
    orgId,
    runnerId,
    jobId,
    status,
    outputObjectKey,
    error: message.error,
    completedAt: now,
  });
  if (!job) {
    return;
  }
  if (existingJob.kind === "panel") {
    await updatePanelOutput(env.DB, {
      id: panelOutputId(jobId),
      status: status === "completed" ? "completed" : status,
      outputObjectKey,
      error: message.error,
      latencyMs: message.latencyMs,
      usage: message.usage,
      completedAt: now,
    });
  }

  await notifyRunnerSessionObject(env, runnerId, `/jobs/${encodeURIComponent(jobId)}/${status === "completed" ? "complete" : "fail"}`, {
    status,
  });

  const event = await appendRunEvent(env, orgId, {
    type: completionEventType(existingJob.kind, status),
    runId: existingJob.runId,
    jobId,
    runnerId,
    timestamp: now,
    data: {
      status,
      outputObjectKey,
      outputText: message.outputText,
      error: message.error,
      latencyMs: message.latencyMs,
      usage: message.usage,
      artifactKeys: message.artifactKeys,
    },
  });

  if (event) {
    await advanceFusionRunAfterJob(env, orgId, job, now);
  }
}

async function persistEvent(env: Env, orgId: string, event: RunEvent): Promise<void> {
  await createRunEvent(env.DB, {
    id: formatEntityId("event", crypto.randomUUID()),
    orgId,
    runId: event.runId,
    seq: event.seq,
    type: event.type,
    jobId: event.jobId,
    runnerId: event.runnerId,
    payload: event,
    createdAt: event.timestamp,
  });
}

export async function sequenceRunnerEvent(env: Env, event: RunnerEvent): Promise<RunEvent | undefined> {
  const response = await notifyFusionRunObject(env, event.runId, "/runner-event", event);
  const body = (await response.json().catch(() => ({}))) as { event?: RunEvent };
  return body.event;
}

async function persistJobOutput(
  env: Env,
  orgId: string,
  job: RunnerJob,
  outputText: string | undefined,
): Promise<string | undefined> {
  if (!env.ARTIFACTS || !outputText) {
    return undefined;
  }

  const kind = artifactKindForJob(job.kind);
  const objectKey = buildArtifactKey(orgId, job.runId, `${kind}/${job.id}.txt`);
  await env.ARTIFACTS.put(objectKey, outputText, {
    httpMetadata: {
      contentType: "text/plain; charset=utf-8",
    },
  });
  await createArtifact(env.DB, {
    id: formatEntityId("artifact", crypto.randomUUID()),
    orgId,
    runId: job.runId,
    kind,
    objectKey,
    contentType: "text/plain; charset=utf-8",
    sizeBytes: new TextEncoder().encode(outputText).byteLength,
    createdAt: new Date().toISOString(),
  });
  return objectKey;
}

function artifactKindForJob(kind: RunnerJobKind): ArtifactKind {
  if (kind === "judge") return "judge";
  if (kind === "final" || kind === "direct") return "final";
  return "panel_output";
}

function panelOutputId(jobId: string) {
  return formatEntityId("panel", jobId);
}

function completionEventType(
  kind: RunnerJobKind,
  status: Extract<RunnerJobStatus, "completed" | "failed" | "timeout" | "cancelled">,
): RunEvent["type"] {
  if (status === "cancelled" && (kind === "direct" || kind === "final" || kind === "judge")) {
    return "run.cancelled";
  }
  if (status !== "completed") {
    if (kind === "judge") return "judge.failed";
    if (kind === "final" || kind === "direct") return "run.failed";
    return "panel.job.failed";
  }

  switch (kind) {
    case "judge":
      return "judge.completed";
    case "final":
    case "direct":
      return "final.completed";
    case "command":
      return "command.completed";
    default:
      return "panel.job.completed";
  }
}