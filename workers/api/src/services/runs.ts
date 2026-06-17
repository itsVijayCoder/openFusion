import { buildPanelPrompt } from "@fusion-harness/core";
import {
  createArtifact,
  createAuditEvent,
  createFusionRun,
  createRunEvent,
  createRunnerJob,
  ensurePrincipal,
  getFusionRun,
  listModels,
  listRunners,
  updateFusionRunStatus,
} from "@fusion-harness/db";
import {
  formatEntityId,
  type ClaimedRunnerJob,
  type FusionExecutionPlan,
  type FusionExecutionStep,
  type FusionRunRequest,
  type FusionRunSummary,
  type ModelRef,
  type RunEvent,
  type RunnerEvent,
  type RunnerJobKind,
  type RunnerJobPayload,
  type RunnerRef,
} from "@fusion-harness/shared";
import type { Env } from "../env";
import { buildArtifactKey } from "./artifact-store";
import type { AccessIdentity } from "./auth";
import { selectFusionModels } from "./model-selection";
import { notifyRunnerSessionObject } from "./runner-session";

type CreateRunResult = {
  run: FusionRunSummary;
  promptObjectKey: string;
};

const panelRoles = ["architect", "critic", "implementer", "risk-reviewer", "test-planner", "maintainer"];

export async function createRunFromRequest(env: Env, principal: AccessIdentity, payload: FusionRunRequest): Promise<CreateRunResult> {
  const now = new Date().toISOString();
  const runId = formatEntityId("run", crypto.randomUUID());
  const promptObjectKey = buildArtifactKey(principal.orgId, runId, "prompt.json");
  const availableModels = await listModels(env.DB, principal.orgId);
  const runners = await listRunners(env.DB, principal.orgId);
  const userPrompt = renderMessages(payload.messages);
  const selection = selectFusionModels({
    availableModels,
    preset: payload.preset ?? "mixed-coding",
    requestedModels: payload.analysisModels,
    requestedJudgeModel: payload.judgeModel,
    requestedFinalModel: payload.finalModel,
    providerPolicy: payload.providerPolicy,
    maxPanelModels: payload.mode === "direct" ? 1 : 6,
  });
  const plannedPanel = payload.mode === "direct" ? [selection.final ?? selection.panel[0]].filter(Boolean) : selection.panel;
  const plannedPanelSteps = plannedPanel.map((model, index) =>
    buildExecutableStep({
      runId,
      kind: payload.mode === "direct" ? "direct" : "panel",
      model,
      runners,
      role: payload.mode === "direct" ? "direct" : panelRole(index),
    }),
  );

  if (plannedPanelSteps.length === 0) {
    throw new Error("No runnable panel model was selected");
  }

  const plan: FusionExecutionPlan = {
    version: 1,
    runId,
    mode: payload.mode,
    steps: [
      ...plannedPanelSteps,
      ...buildDeferredSteps(runId, payload, selection.judge, selection.final, plannedPanelSteps),
    ],
    createdAt: now,
  };

  await ensurePrincipal(env.DB, {
    orgId: principal.orgId,
    orgName: principal.orgName,
    userId: principal.userId,
    email: principal.email,
    name: principal.name,
    now,
  });

  await createFusionRun(env.DB, {
    id: runId,
    orgId: principal.orgId,
    userId: principal.userId,
    workspaceId: payload.workspaceId,
    mode: payload.mode,
    preset: payload.preset,
    permissionProfile: payload.permissionProfile,
    promptObjectKey,
    executionPlan: plan,
    createdAt: now,
  });

  if (env.ARTIFACTS) {
    await env.ARTIFACTS.put(
      promptObjectKey,
      JSON.stringify(
        {
          runId,
          createdAt: now,
          request: payload,
        },
        null,
        2,
      ),
      {
        httpMetadata: {
          contentType: "application/json",
        },
      },
    );
  }

  await createArtifact(env.DB, {
    id: formatEntityId("artifact", crypto.randomUUID()),
    orgId: principal.orgId,
    runId,
    kind: "prompt",
    objectKey: promptObjectKey,
    contentType: "application/json",
    createdAt: now,
  });

  await createAuditEvent(env.DB, {
    id: formatEntityId("audit", crypto.randomUUID()),
    orgId: principal.orgId,
    userId: principal.userId,
    runId,
    eventType: "run.created",
    metadata: {
      mode: payload.mode,
      preset: payload.preset,
      permissionProfile: payload.permissionProfile,
      messageCount: payload.messages.length,
    },
    createdAt: now,
  });

  const startedEvent = await notifyFusionRunObject(env, runId, "/start", {
    runId,
    principal,
    request: payload,
    promptObjectKey,
  });
  await persistSequencedEvent(env, principal.orgId, startedEvent);

  await appendRunEvent(env, principal.orgId, {
    type: "run.planning.started",
    runId,
    timestamp: now,
    data: {
      requestedPanelModels: payload.analysisModels ?? [],
    },
  });

  await appendRunEvent(env, principal.orgId, {
    type: "run.planning.completed",
    runId,
    timestamp: now,
    data: {
      plan,
    },
  });

  for (const step of plannedPanelSteps) {
    await enqueueRunnerJob(env, principal.orgId, payload, userPrompt, promptObjectKey, step, now);
    await appendRunEvent(env, principal.orgId, {
      type: "panel.job.queued",
      runId,
      jobId: step.jobId,
      runnerId: step.runnerId,
      timestamp: now,
      data: {
        kind: step.kind,
        modelId: step.modelId,
        adapter: step.adapter,
        model: step.model,
        role: step.role,
      },
    });
  }

  await updateFusionRunStatus(env.DB, principal.orgId, runId, "running", now);
  await appendRunEvent(env, principal.orgId, {
    type: "run.started",
    runId,
    timestamp: now,
    data: {
      queuedJobs: plannedPanelSteps.length,
    },
  });

  const run = await getFusionRun(env.DB, principal.orgId, runId);
  if (!run) {
    throw new Error("Fusion run insert did not produce a readable run");
  }

  return { run, promptObjectKey };
}

async function enqueueRunnerJob(
  env: Env,
  orgId: string,
  request: FusionRunRequest,
  userPrompt: string,
  promptObjectKey: string,
  step: FusionExecutionStep,
  now: string,
) {
  if (!step.runnerId || !step.modelId || !step.adapter || !step.model) {
    throw new Error(`Execution step ${step.id} is missing runner or model routing`);
  }

  const jobPrompt = step.kind === "direct" ? userPrompt : buildPanelPrompt(userPrompt, step.role ?? "panel");
  const payload: RunnerJobPayload = {
    jobId: step.jobId,
    runId: step.id,
    kind: step.kind,
    modelId: step.modelId,
    adapter: step.adapter,
    model: step.model,
    role: step.role,
    prompt: jobPrompt,
    promptObjectKey,
    workspaceId: request.workspaceId,
    permissionProfile: request.permissionProfile,
    timeoutMs: request.timeoutMs,
    attempt: 1,
    metadata: {
      mode: request.mode,
      preset: request.preset,
    },
  };
  const inputObjectKey = await persistJobInput(env, orgId, payload.runId, step.jobId, payload);
  const job = await createRunnerJob(env.DB, {
    id: step.jobId,
    orgId,
    runId: payload.runId,
    runnerId: step.runnerId,
    kind: step.kind,
    inputObjectKey,
    createdAt: now,
  });
  const dispatchPayload: ClaimedRunnerJob = {
    ...job,
    payload,
  };

  await notifyRunnerSessionObject(env, step.runnerId, "/dispatch", dispatchPayload);
}

async function persistJobInput(env: Env, orgId: string, runId: string, jobId: string, payload: RunnerJobPayload) {
  if (!env.ARTIFACTS) {
    return undefined;
  }

  const key = buildArtifactKey(orgId, runId, `jobs/${jobId}.json`);
  await env.ARTIFACTS.put(key, JSON.stringify(payload, null, 2), {
    httpMetadata: {
      contentType: "application/json",
    },
  });
  return key;
}

function buildExecutableStep(input: {
  runId: string;
  kind: RunnerJobKind;
  model: ModelRef;
  runners: RunnerRef[];
  role: string;
}): FusionExecutionStep {
  const runner = resolveRunner(input.model, input.runners);
  if (!runner) {
    throw new Error(`No runner is available for ${input.model.id}`);
  }

  const jobId = formatEntityId("job", crypto.randomUUID());
  return {
    id: input.runId,
    kind: input.kind,
    jobId,
    runnerId: runner.id,
    modelId: input.model.id,
    adapter: input.model.adapter,
    model: input.model.model,
    role: input.role,
  };
}

function buildDeferredSteps(
  runId: string,
  request: FusionRunRequest,
  judge: ModelRef | undefined,
  final: ModelRef | undefined,
  panelSteps: FusionExecutionStep[],
): FusionExecutionStep[] {
  if (request.mode === "direct") {
    return [];
  }

  const steps: FusionExecutionStep[] = [];
  const panelJobIds = panelSteps.map((step) => step.jobId);
  if (judge) {
    steps.push({
      id: runId,
      kind: "judge",
      jobId: formatEntityId("job", crypto.randomUUID()),
      modelId: judge.id,
      adapter: judge.adapter,
      model: judge.model,
      dependsOn: panelJobIds,
    });
  }
  if (final) {
    steps.push({
      id: runId,
      kind: "final",
      jobId: formatEntityId("job", crypto.randomUUID()),
      modelId: final.id,
      adapter: final.adapter,
      model: final.model,
      dependsOn: judge ? [steps[steps.length - 1].jobId] : panelJobIds,
    });
  }
  return steps;
}

function resolveRunner(model: ModelRef, runners: RunnerRef[]) {
  if (model.runnerId) {
    const exactRunner = runners.find((runner) => runner.id === model.runnerId && runner.status !== "disabled");
    if (exactRunner) return exactRunner;
  }

  const candidates = runners.filter((runner) => runner.status !== "disabled" && runner.capabilities.adapters.includes(model.adapter));
  return candidates.find((runner) => runner.status === "online") ?? candidates[0];
}

function renderMessages(messages: FusionRunRequest["messages"]) {
  return messages.map((message) => `${message.role.toUpperCase()}:\n${message.content}`).join("\n\n");
}

function panelRole(index: number) {
  return panelRoles[index] ?? `panel-${index + 1}`;
}

async function appendRunEvent(env: Env, orgId: string, event: RunnerEvent) {
  const response = await notifyFusionRunObject(env, event.runId, "/runner-event", event);
  return persistSequencedEvent(env, orgId, response);
}

async function persistSequencedEvent(env: Env, orgId: string, response: Response) {
  const body = (await response.json().catch(() => ({}))) as { event?: RunEvent };
  if (!body.event) {
    return undefined;
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

export async function notifyFusionRunObject(env: Env, runId: string, path: string, body: unknown) {
  const id = env.FUSION_RUN.idFromName(runId);
  const stub = env.FUSION_RUN.get(id);
  const url = new URL(`https://fusion-run.internal${path}`);

  return stub.fetch(
    new Request(url, {
      method: "POST",
      headers: {
        "content-type": "application/json",
      },
      body: JSON.stringify(body),
    }),
  );
}
