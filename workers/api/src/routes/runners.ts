import {
  completeRunnerJob,
  createArtifact,
  createAuditEvent,
  createRunEvent,
  ensurePrincipal,
  getFusionRun,
  getRunner,
  getRunnerJob,
  heartbeatRunner,
  listRunners,
  markRunnerJobLeased,
  registerRunner,
  updatePanelOutput,
} from "@fusion-harness/db";
import {
  type ArtifactKind,
  formatEntityId,
  runnerEventSchema,
  runnerJobCompletionSchema,
  runnerRegistrationRequestSchema,
  type ClaimedRunnerJob,
  type RunEvent,
  type RunnerEvent,
  type RunnerJob,
  type RunnerJobKind,
  type RunnerJobStatus,
} from "@fusion-harness/shared";
import { Hono } from "hono";
import type { AppBindings, Env } from "../env";
import { buildArtifactKey } from "../services/artifact-store";
import { requireAccessIdentity, requireRunnerAccessIdentity } from "../services/auth";
import { notifyRunnerSessionObject } from "../services/runner-session";
import { advanceFusionRunAfterJob, notifyFusionRunObject } from "../services/runs";

export const runnerRoutes = new Hono<AppBindings>()
  .get("/", async (c) => {
    const principal = await requireAccessIdentity(c.env.DB, c.env, c.req.raw.headers);
    return c.json({ data: await listRunners(c.env.DB, principal.orgId) });
  })
  .post("/register", async (c) => {
    const principal = await requireRunnerAccessIdentity(c.env.DB, c.env, c.req.raw.headers);
    const payload = runnerRegistrationRequestSchema.parse(await c.req.json());
    const now = new Date().toISOString();
    const runnerId = payload.runnerId ?? formatEntityId("runner", crypto.randomUUID());

    await ensurePrincipal(c.env.DB, {
      orgId: principal.orgId,
      orgName: principal.orgName,
      userId: principal.userId,
      email: principal.email,
      name: principal.name,
      now,
    });

    const runner = await registerRunner(c.env.DB, {
      ...payload,
      runnerId,
      orgId: principal.orgId,
      userId: principal.userId,
      now,
    });

    await createAuditEvent(c.env.DB, {
      id: formatEntityId("audit", crypto.randomUUID()),
      orgId: principal.orgId,
      userId: principal.userId,
      runnerId: runner.id,
      eventType: "runner.registered",
      metadata: {
        toolCount: runner.tools.length,
        modelCount: payload.models?.length ?? 0,
        os: runner.os,
        arch: runner.arch,
      },
      createdAt: now,
    });

    return c.json(runner, 202);
  })
  .post("/:id/heartbeat", async (c) => {
    const principal = await requireRunnerAccessIdentity(c.env.DB, c.env, c.req.raw.headers);
    const runner = await heartbeatRunner(c.env.DB, principal.orgId, c.req.param("id"), new Date().toISOString());

    if (!runner) {
      return c.json({ error: "Runner not found" }, 404);
    }

    return c.json(runner);
  })
  .post("/:id/jobs/claim", async (c) => {
    const principal = await requireRunnerAccessIdentity(c.env.DB, c.env, c.req.raw.headers);
    const runnerId = c.req.param("id");
    const runner = await getRunner(c.env.DB, principal.orgId, runnerId);

    if (!runner) {
      return c.json({ error: "Runner not found" }, 404);
    }

    const requestBody = (await c.req.json().catch(() => ({}))) as { leaseOwner?: string; leaseSeconds?: number };
    const claimResponse = await notifyRunnerSessionObject(c.env, runnerId, "/jobs/claim", {
      leaseOwner: requestBody.leaseOwner ?? runnerId,
      leaseSeconds: requestBody.leaseSeconds,
    });
    const claimBody = (await claimResponse.json().catch(() => ({ job: null }))) as { job: ClaimedRunnerJob | null };

    if (!claimBody.job) {
      return c.json({ job: null });
    }

    const now = new Date().toISOString();
    const leasedJob = await markRunnerJobLeased(c.env.DB, {
      orgId: principal.orgId,
      runnerId,
      jobId: claimBody.job.id,
      attempt: claimBody.job.attempt,
      leaseOwner: claimBody.job.leaseOwner ?? runnerId,
      leaseExpiresAt: claimBody.job.leaseExpiresAt ?? now,
      now,
    });

    if (!leasedJob) {
      return c.json({ error: "Claimed job is missing from D1", jobId: claimBody.job.id }, 409);
    }
    if (leasedJob.status !== "leased") {
      await notifyRunnerSessionObject(
        c.env,
        runnerId,
        `/jobs/${encodeURIComponent(claimBody.job.id)}/${leasedJob.status === "paused" ? "pause" : "cancel"}`,
        { reason: `Job is ${leasedJob.status}` },
      );
      return c.json({ job: null });
    }
    if (leasedJob.kind === "panel") {
      await updatePanelOutput(c.env.DB, {
        id: panelOutputId(leasedJob.id),
        status: "running",
      });
    }

    return c.json({ job: { ...leasedJob, payload: claimBody.job.payload } satisfies ClaimedRunnerJob });
  })
  .get("/:id/jobs/:jobId", async (c) => {
    const principal = await requireRunnerAccessIdentity(c.env.DB, c.env, c.req.raw.headers);
    const runnerId = c.req.param("id");
    const jobId = c.req.param("jobId");
    const job = await getRunnerJob(c.env.DB, principal.orgId, runnerId, jobId);
    if (!job) {
      return c.json({ status: "cancelled", runStatus: "deleted" });
    }

    const run = await getFusionRun(c.env.DB, principal.orgId, job.runId);
    if (!run) {
      return c.json({ job, status: "cancelled", runStatus: "deleted" });
    }

    const status = run.status === "cancelled" ? "cancelled" : job.status;
    return c.json({ job, status, runStatus: run.status });
  })
  .post("/:id/jobs/:jobId/events", async (c) => {
    const principal = await requireRunnerAccessIdentity(c.env.DB, c.env, c.req.raw.headers);
    const runnerId = c.req.param("id");
    const jobId = c.req.param("jobId");
    const event = runnerEventSchema.parse(await c.req.json());
    const normalizedEvent = {
      ...event,
      jobId: event.jobId ?? jobId,
      runnerId: event.runnerId ?? runnerId,
      timestamp: event.timestamp || new Date().toISOString(),
      data: event.data ?? {},
    };

    const persisted = await appendRunEvent(c.env, principal.orgId, normalizedEvent);
    return c.json({ status: "accepted", event: persisted }, 202);
  })
  .post("/:id/jobs/:jobId/complete", async (c) => {
    const principal = await requireRunnerAccessIdentity(c.env.DB, c.env, c.req.raw.headers);
    const runnerId = c.req.param("id");
    const jobId = c.req.param("jobId");
    const body = runnerJobCompletionSchema.parse(await c.req.json().catch(() => ({ status: "completed" })));
    const status = body.status === "completed" ? "completed" : body.status;
    const result = await finishRunnerJob(c.env, principal.orgId, runnerId, jobId, status, body);

    if (!result.job) {
      return c.json({ error: "Runner job not found" }, 404);
    }

    return c.json({ job: result.job, event: result.event }, 202);
  })
  .post("/:id/jobs/:jobId/fail", async (c) => {
    const principal = await requireRunnerAccessIdentity(c.env.DB, c.env, c.req.raw.headers);
    const runnerId = c.req.param("id");
    const jobId = c.req.param("jobId");
    const body = runnerJobCompletionSchema.parse(await c.req.json().catch(() => ({ status: "failed" })));
    const status = body.status === "completed" ? "failed" : body.status;
    const result = await finishRunnerJob(c.env, principal.orgId, runnerId, jobId, status, body);

    if (!result.job) {
      return c.json({ error: "Runner job not found" }, 404);
    }

    return c.json({ job: result.job, event: result.event }, 202);
  });

async function finishRunnerJob(
  env: Env,
  orgId: string,
  runnerId: string,
  jobId: string,
  status: Extract<RunnerJobStatus, "completed" | "failed" | "timeout" | "cancelled">,
  body: {
    outputObjectKey?: string;
    outputText?: string;
    error?: string;
    latencyMs?: number;
    usage?: Record<string, unknown>;
    artifactKeys?: string[];
  },
): Promise<{ job: RunnerJob | null; event?: RunEvent }> {
  const existingJob = await getRunnerJob(env.DB, orgId, runnerId, jobId);
  if (!existingJob) {
    return { job: null };
  }

  const now = new Date().toISOString();
  const outputObjectKey = body.outputObjectKey ?? (await persistJobOutput(env, orgId, existingJob, body.outputText));
  const job = await completeRunnerJob(env.DB, {
    orgId,
    runnerId,
    jobId,
    status,
    outputObjectKey,
    error: body.error,
    completedAt: now,
  });
  if (existingJob.kind === "panel") {
    await updatePanelOutput(env.DB, {
      id: panelOutputId(jobId),
      status: status === "completed" ? "completed" : status,
      outputObjectKey,
      error: body.error,
      latencyMs: body.latencyMs,
      usage: body.usage,
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
      outputText: body.outputText,
      error: body.error,
      latencyMs: body.latencyMs,
      usage: body.usage,
      artifactKeys: body.artifactKeys,
    },
  });

  if (job) {
    await advanceFusionRunAfterJob(env, orgId, job, now);
  }

  return { job, event };
}

async function persistJobOutput(env: Env, orgId: string, job: RunnerJob, outputText: string | undefined) {
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

async function appendRunEvent(env: Env, orgId: string, event: RunnerEvent) {
  const response = await notifyFusionRunObject(env, event.runId, "/runner-event", event);
  const body = (await response.json().catch(() => ({}))) as { event?: RunEvent };

  if (!body.event) {
    throw new Error("Fusion run durable object did not return a sequenced event");
  }

  await createRunEvent(env.DB, {
    id: formatEntityId("event", crypto.randomUUID()),
    orgId,
    runId: body.event.runId,
    seq: body.event.seq,
    type: body.event.type,
    jobId: body.event.jobId,
    runnerId: body.event.runnerId,
    payload: body.event,
    createdAt: body.event.timestamp,
  });

  return body.event;
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
