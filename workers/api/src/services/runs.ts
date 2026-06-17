import { createArtifact, createAuditEvent, createFusionRun, ensurePrincipal, getFusionRun } from "@fusion-harness/db";
import { formatEntityId, type FusionRunRequest, type FusionRunSummary } from "@fusion-harness/shared";
import type { Env } from "../env";
import { buildArtifactKey } from "./artifact-store";
import type { AccessIdentity } from "./auth";

type CreateRunResult = {
  run: FusionRunSummary;
  promptObjectKey: string;
};

export async function createRunFromRequest(env: Env, principal: AccessIdentity, payload: FusionRunRequest): Promise<CreateRunResult> {
  const now = new Date().toISOString();
  const runId = formatEntityId("run", crypto.randomUUID());
  const promptObjectKey = buildArtifactKey(principal.orgId, runId, "prompt.json");

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

  await notifyFusionRunObject(env, runId, "/start", {
    runId,
    principal,
    request: payload,
    promptObjectKey,
  });

  const run = await getFusionRun(env.DB, principal.orgId, runId);
  if (!run) {
    throw new Error("Fusion run insert did not produce a readable run");
  }

  return { run, promptObjectKey };
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
