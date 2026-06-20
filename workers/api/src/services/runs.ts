import { buildJudgeSynthesisPrompt, buildPanelPrompt } from "@fusion-harness/core";
import {
  createArtifact,
  createAuditEvent,
  createFusionRun,
  createPanelOutput,
  createRunEvent,
  createRunnerJob,
  ensureModel,
  ensurePrincipal,
  getFusionRun,
  listRunEvents,
  listRunnerJobsByRun,
  listModels,
  listRunners,
  updateFusionRunStatus,
} from "@fusion-harness/db";
import {
  extractReadableOutput,
  formatEntityId,
  type ChatMessage,
  type ClaimedRunnerJob,
  type FusionExecutionPlan,
  type FusionExecutionStep,
  type FusionRunRequest,
  type FusionRunSummary,
  type ModelRef,
  type RunEvent,
  type RunnerEvent,
  type RunnerJob,
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

type CreateRunOptions = {
  parentRunId?: string;
  conversationId?: string;
};

const panelRoles = ["architect", "critic", "implementer", "risk-reviewer", "test-planner", "maintainer"];

export class RunCreationError extends Error {
  constructor(
    message: string,
    readonly statusCode: 400 | 404 | 409 | 422 = 409,
  ) {
    super(message);
    this.name = "RunCreationError";
  }
}

export async function createRunFromRequest(
  env: Env,
  principal: AccessIdentity,
  payload: FusionRunRequest,
  options?: CreateRunOptions,
): Promise<CreateRunResult> {
  const now = new Date().toISOString();
  const runId = formatEntityId("run", crypto.randomUUID());
  const promptObjectKey = buildArtifactKey(principal.orgId, runId, "prompt.json");
  const availableModels = await listModels(env.DB, principal.orgId);
  const runners = await listRunners(env.DB, principal.orgId);
  const userPrompt = renderMessages(payload.messages);
  const title = await deriveTitle(env, payload.messages);
  const selection = selectFusionModels({
    availableModels,
    preset: payload.preset ?? "mixed-coding",
    requestedModels: payload.analysisModels,
    requestedJudgeModel: payload.judgeModel,
    requestedFinalModel: payload.finalModel,
    providerPolicy: payload.providerPolicy,
    maxPanelModels: payload.mode === "direct" ? 1 : 6,
  });
  const plannedPanel = payload.mode === "direct" ? [selection.panel[0] ?? selection.judge].filter(Boolean) : selection.panel;
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
    throw new RunCreationError("No runnable panel model was selected. Register a local runner or select a model advertised by an online runner.");
  }

  const plan: FusionExecutionPlan = {
    version: 1,
    runId,
    mode: payload.mode,
    steps: [
      ...plannedPanelSteps,
      ...buildDeferredSteps(runId, payload, selection.judge, plannedPanelSteps, runners),
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
    parentRunId: options?.parentRunId,
    conversationId: options?.conversationId,
    title,
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

export async function continueRun(
  env: Env,
  principal: AccessIdentity,
  parentRunId: string,
  message: string,
): Promise<CreateRunResult> {
  const parentRun = await getFusionRun(env.DB, principal.orgId, parentRunId);
  if (!parentRun) {
    throw new RunCreationError("Parent run not found", 404);
  }

  if (parentRun.status !== "completed" && parentRun.status !== "failed") {
    throw new RunCreationError("Parent run must be completed before continuing", 409);
  }

  const parentRequest = await loadRunRequest(env, parentRun.promptObjectKey);
  if (!parentRequest) {
    throw new RunCreationError("Parent run prompt was not found", 422);
  }

  const finalOutput = await getRunFinalOutput(env, principal.orgId, parentRunId);

  const messages: ChatMessage[] = [
    ...parentRequest.messages,
    { role: "assistant", content: finalOutput || "(No output was produced)" },
    { role: "user", content: message },
  ];

  const conversationId = parentRun.conversationId ?? parentRun.id;

  const payload: FusionRunRequest = {
    ...parentRequest,
    messages,
  };

  return createRunFromRequest(env, principal, payload, {
    parentRunId,
    conversationId,
  });
}

export async function loadRunMessages(env: Env, promptObjectKey: string | undefined): Promise<ChatMessage[]> {
  const request = await loadRunRequest(env, promptObjectKey);
  return request?.messages ?? [];
}

async function getRunFinalOutput(env: Env, orgId: string, runId: string): Promise<string> {
  const events = await listRunEvents(env.DB, orgId, runId, { limit: 1000 });

  let finalText = "";
  let synthesisText = "";

  for (const event of events) {
    const text = extractReadableOutput(eventStringData(event, "text") || eventStringData(event, "outputText"));
    if (event.type === "final.delta" || event.type === "final.completed") {
      finalText += text;
    }
    if (event.type === "judge.output.delta" || event.type === "judge.completed") {
      synthesisText += text;
    }
  }

  if (finalText.trim()) return finalText.trim();
  return extractFinalOutput(synthesisText);
}

function eventStringData(event: RunEvent, key: string): string {
  const value = event.data[key];
  return typeof value === "string" ? value : "";
}

function extractFinalOutput(text: string): string {
  const marker = "FINAL_OUTPUT:";
  const trimmed = text.trim();
  const markerIndex = trimmed.lastIndexOf(marker);
  if (markerIndex < 0) return trimmed;
  return trimmed.slice(markerIndex + marker.length).trim();
}

export async function advanceFusionRunAfterJob(env: Env, orgId: string, completedJob: RunnerJob, now = new Date().toISOString()) {
  const run = await getFusionRun(env.DB, orgId, completedJob.runId);
  if (!run?.executionPlan) return;

  if (completedJob.kind === "direct" || completedJob.kind === "judge") {
    const status = completedJob.status === "completed" ? "completed" : "failed";
    await updateFusionRunStatus(env.DB, orgId, completedJob.runId, status, now, completedJob.error);
    await appendRunEvent(env, orgId, {
      type: status === "completed" ? "run.completed" : "run.failed",
      runId: completedJob.runId,
      jobId: completedJob.id,
      runnerId: completedJob.runnerId,
      timestamp: now,
      data: {
        status,
        outputObjectKey: completedJob.outputObjectKey,
        error: completedJob.error,
      },
    });
    return;
  }

  const jobs = await listRunnerJobsByRun(env.DB, orgId, completedJob.runId);
  const jobsById = new Map(jobs.map((job) => [job.id, job]));
  const panelOutputs = await successfulPanelOutputs(env, orgId, completedJob.runId, run.executionPlan, jobs);
  const panelsAreTerminal = plannedJobs(run.executionPlan, "panel").every((step) => isTerminal(jobsById.get(step.jobId)?.status));

  if (panelsAreTerminal && panelOutputs.length === 0) {
    await failRun(env, orgId, completedJob, now, "All panel jobs failed or returned empty output.");
    return;
  }

  const dispatchableQueuedStep = run.executionPlan.steps.find((step) => {
    if (step.kind !== "judge") return false;
    const job = jobsById.get(step.jobId);
    if (job?.status !== "queued") return false;
    return (step.dependsOn ?? []).every((jobId) => isTerminal(jobsById.get(jobId)?.status));
  });
  if (dispatchableQueuedStep) {
    await dispatchDeferredStep(env, orgId, run, completedJob, dispatchableQueuedStep, panelOutputs, jobs, now);
    return;
  }

  const nextStep = run.executionPlan.steps.find((step) => {
    if (step.kind !== "judge") return false;
    if (jobsById.has(step.jobId)) return false;
    return (step.dependsOn ?? []).every((jobId) => isTerminal(jobsById.get(jobId)?.status));
  });
  if (!nextStep) return;

  await dispatchDeferredStep(env, orgId, run, completedJob, nextStep, panelOutputs, jobs, now);
}

export async function reconcileFusionRun(env: Env, orgId: string, runId: string, now = new Date().toISOString()) {
  const run = await getFusionRun(env.DB, orgId, runId);
  if (!run?.executionPlan || run.status !== "running") return;

  const jobs = await listRunnerJobsByRun(env.DB, orgId, runId);
  const latestTerminalJob = [...jobs].reverse().find((job) => isTerminal(job.status));
  if (latestTerminalJob) {
    await advanceFusionRunAfterJob(env, orgId, latestTerminalJob, now);
  }
}

async function dispatchDeferredStep(
  env: Env,
  orgId: string,
  run: NonNullable<Awaited<ReturnType<typeof getFusionRun>>>,
  completedJob: RunnerJob,
  step: FusionExecutionStep,
  panelOutputs: Array<{ model: string; output: string }>,
  jobs: RunnerJob[],
  now: string,
) {
  const request = await loadRunRequest(env, run.promptObjectKey);
  const runnableRequest = request ?? requestFromRun(run);
  const userPrompt = request ? renderMessages(request.messages) : "Original user request was unavailable. Use the provided panel evidence only.";
  const runnableStep = await hydrateStepRouting(env, orgId, step);
  if (!runnableStep) return;
  const prompt = await promptForDeferredStep(env, orgId, completedJob.runId, runnableStep, userPrompt, panelOutputs, jobs);

  await enqueueRunnerJob(env, orgId, runnableRequest, userPrompt, run.promptObjectKey ?? "", runnableStep, now, prompt);
  const startedType = "judge.started";
  const events = await listRunEvents(env.DB, orgId, completedJob.runId, { limit: 1000 });
  if (!events.some((event) => event.jobId === runnableStep.jobId && event.type === startedType)) {
    await appendRunEvent(env, orgId, {
      type: startedType,
      runId: completedJob.runId,
      jobId: runnableStep.jobId,
      runnerId: runnableStep.runnerId,
      timestamp: now,
      data: {
        modelId: runnableStep.modelId,
        adapter: runnableStep.adapter,
        model: runnableStep.model,
        dependencies: runnableStep.dependsOn ?? [],
      },
    });
  }
}

async function enqueueRunnerJob(
  env: Env,
  orgId: string,
  request: FusionRunRequest,
  userPrompt: string,
  promptObjectKey: string,
  step: FusionExecutionStep,
  now: string,
  promptOverride?: string,
) {
  if (!step.runnerId || !step.modelId || !step.adapter || !step.model) {
    throw new Error(`Execution step ${step.id} is missing runner or model routing`);
  }

  await ensureModel(env.DB, {
    id: step.modelId,
    orgId,
    runnerId: step.runnerId,
    adapter: step.adapter,
    provider: inferProvider(step.adapter, step.model),
    model: step.model,
    displayName: step.model,
    authMode:
      step.adapter === "cloudflare-ai-gateway"
        ? "cloud_gateway"
        : step.adapter === "api-key" || step.adapter === "openrouter" || step.adapter === "openrouter-fusion"
          ? "api_key"
          : "cli_session",
    availability: "configured_unverified",
    source: "custom",
    capabilities: {
      streaming: true,
      tools: step.adapter !== "api-key",
      fileEdits: step.adapter === "opencode" || step.adapter === "codex",
      shell: step.adapter === "opencode" || step.adapter === "codex",
      jsonOutput: true,
      modelListing: false,
    },
    now,
  });

  const jobPrompt = promptOverride ?? (step.kind === "direct" ? userPrompt : buildPanelPrompt(userPrompt, step.role ?? "panel"));
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
  if (step.kind === "panel") {
    await createPanelOutput(env.DB, {
      id: panelOutputId(step.jobId),
      runId: payload.runId,
      modelId: step.modelId,
      adapter: step.adapter,
      status: "queued",
      createdAt: now,
    });
  }
  const dispatchPayload: ClaimedRunnerJob = {
    ...job,
    payload,
  };

  await notifyRunnerSessionObject(env, step.runnerId, "/dispatch", dispatchPayload);
}

function panelOutputId(jobId: string) {
  return formatEntityId("panel", jobId);
}

function inferProvider(adapter: ModelRef["adapter"], model: string) {
  if (adapter === "codex") return "openai";
  const [provider] = model.split("/");
  return provider && provider !== model ? provider : adapter;
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
    throw new RunCreationError(`No runner is available for ${input.model.id}. Start fusion-runner serve and refresh the model list.`);
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
  panelSteps: FusionExecutionStep[],
  runners: RunnerRef[],
): FusionExecutionStep[] {
  if (request.mode === "direct") {
    return [];
  }

  const steps: FusionExecutionStep[] = [];
  const panelJobIds = panelSteps.map((step) => step.jobId);
  if (judge) {
    steps.push({
      ...buildExecutableStep({
        runId,
        kind: "judge",
        model: judge,
        runners,
        role: "judge_synthesis",
      }),
      dependsOn: panelJobIds,
    });
  }
  return steps;
}

async function promptForDeferredStep(
  env: Env,
  orgId: string,
  runId: string,
  step: FusionExecutionStep,
  userPrompt: string,
  panelOutputs: Array<{ model: string; output: string }>,
  jobs: RunnerJob[],
) {
  void env;
  void orgId;
  void runId;
  void jobs;
  return buildJudgeSynthesisPrompt(userPrompt, panelOutputs);
}

async function hydrateStepRouting(env: Env, orgId: string, step: FusionExecutionStep): Promise<FusionExecutionStep | undefined> {
  if (step.runnerId && step.modelId && step.adapter && step.model) return step;
  if (!step.adapter || !step.modelId || !step.model) return undefined;

  const runner = resolveRunnerForStep(step, await listRunners(env.DB, orgId));
  if (!runner) return undefined;
  return {
    ...step,
    runnerId: runner.id,
  };
}

async function successfulPanelOutputs(env: Env, orgId: string, runId: string, plan: FusionExecutionPlan, jobs: RunnerJob[]) {
  const outputs: Array<{ model: string; output: string }> = [];
  for (const job of jobs) {
    if (job.kind !== "panel" || job.status !== "completed") continue;
    const output = await outputForJob(env, orgId, runId, job);
    if (output.trim()) {
      const step = plan.steps.find((candidate) => candidate.jobId === job.id);
      outputs.push({
        model: step?.modelId ?? job.id,
        output,
      });
    }
  }
  return outputs;
}

async function outputForJob(env: Env, orgId: string, runId: string, job: RunnerJob) {
  const events = await listRunEvents(env.DB, orgId, runId, { limit: 1000 });
  const completionEvent = [...events].reverse().find((event) => event.jobId === job.id && typeof event.data.outputText === "string");
  if (typeof completionEvent?.data.outputText === "string") {
    return extractReadableOutput(completionEvent.data.outputText);
  }

  if (job.outputObjectKey && env.ARTIFACTS) {
    const object = await env.ARTIFACTS.get(job.outputObjectKey);
    if (object) return extractReadableOutput(await object.text());
  }

  return "";
}

async function loadRunRequest(env: Env, promptObjectKey: string | undefined): Promise<FusionRunRequest | undefined> {
  if (!promptObjectKey || !env.ARTIFACTS) return undefined;
  const object = await env.ARTIFACTS.get(promptObjectKey);
  if (!object) return undefined;

  const body = parseJson<{ request?: FusionRunRequest }>(await object.text());
  return body?.request;
}

function requestFromRun(run: { mode: FusionRunRequest["mode"]; preset?: string; permissionProfile: FusionRunRequest["permissionProfile"] }): FusionRunRequest {
  return {
    mode: run.mode,
    preset: run.preset,
    permissionProfile: run.permissionProfile,
    messages: [{ role: "user", content: "Original user request was unavailable." }],
  };
}

async function failRun(env: Env, orgId: string, job: RunnerJob, now: string, error: string) {
  await updateFusionRunStatus(env.DB, orgId, job.runId, "failed", now, error);
  await appendRunEvent(env, orgId, {
    type: "run.failed",
    runId: job.runId,
    jobId: job.id,
    runnerId: job.runnerId,
    timestamp: now,
    data: { error },
  });
}

function plannedJobs(plan: FusionExecutionPlan, kind: RunnerJobKind) {
  return plan.steps.filter((step) => step.kind === kind);
}

function isTerminal(status: RunnerJob["status"] | undefined) {
  return status === "completed" || status === "failed" || status === "timeout" || status === "cancelled";
}

function parseJson<T>(value: string): T | undefined {
  try {
    return JSON.parse(value) as T;
  } catch {
    return undefined;
  }
}

function resolveRunner(model: ModelRef, runners: RunnerRef[]) {
  if (model.runnerId) {
    const exactRunner = runners.find((runner) => runner.id === model.runnerId && runner.status !== "disabled");
    if (exactRunner) return exactRunner;
  }

  const candidates = runners.filter((runner) => runner.status !== "disabled" && runner.capabilities.adapters.includes(model.adapter));
  return candidates.find((runner) => runner.status === "online") ?? candidates[0];
}

function resolveRunnerForStep(step: FusionExecutionStep, runners: RunnerRef[]) {
  if (step.runnerId) {
    const exactRunner = runners.find((runner) => runner.id === step.runnerId && runner.status !== "disabled");
    if (exactRunner) return exactRunner;
  }

  const candidates = runners.filter((runner) => runner.status !== "disabled" && step.adapter && runner.capabilities.adapters.includes(step.adapter));
  return candidates.find((runner) => runner.status === "online") ?? candidates[0];
}

function renderMessages(messages: FusionRunRequest["messages"]) {
  return messages.map((message) => `${message.role.toUpperCase()}:\n${message.content}`).join("\n\n");
}

async function deriveTitle(env: Env, messages: FusionRunRequest["messages"]): Promise<string> {
  const userMessage = messages.find((message) => message.role === "user");
  const text = userMessage?.content ?? messages[0]?.content ?? "Untitled run";
  const fallback = fallbackTitle(text);

  try {
    const response = await env.AI.run("@cf/meta/llama-3.1-8b-instruct", {
      messages: [
        {
          role: "system",
          content:
            "You generate a short, descriptive title (max 6 words) for a user's prompt. " +
            "Reply with ONLY the title, no quotes, no punctuation at the end, no explanation.",
        },
        { role: "user", content: text.slice(0, 2000) },
      ],
      max_tokens: 30,
    });
    const title = typeof response === "string" ? response : String((response as { response?: string }).response ?? "");
    const cleaned = title.trim().replace(/^["']|["']$/g, "").replace(/\.$/, "");
    if (cleaned && cleaned.length <= 80) return cleaned;
    return fallback;
  } catch {
    return fallback;
  }
}

function fallbackTitle(text: string): string {
  const firstLine = text.split(/\r?\n/)[0]?.trim() ?? text;
  if (firstLine.length <= 60) return firstLine;
  return `${firstLine.slice(0, 57).trim()}...`;
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
