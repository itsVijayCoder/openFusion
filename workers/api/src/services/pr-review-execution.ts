import {
  createAuditEvent,
  createFusionRun,
  createPrReviewComment,
  createPrReviewRun,
  createRunnerJob,
  getGitHubPullRequest,
  getGitHubRepository,
  getPrReviewRun,
  getRunnerJob,
  listPrReviewCommentsByRun,
  updateFusionRunStatus,
  updateGitHubPullRequestStatus,
  updatePrReviewRun,
} from "@fusion-harness/db";
import {
  formatEntityId,
  prReviewResultSchema,
  type AdapterId,
  type ClaimedRunnerJob,
  type PermissionProfile,
  type PrReviewFinding,
  type PrReviewMode,
  type PrReviewResult,
  type RunnerJobPayload,
} from "@fusion-harness/shared";
import type { Env } from "../env";
import { buildArtifactKey } from "./artifact-store";
import type { AccessIdentity } from "./auth";
import { fetchAndStorePrDiff } from "./github-diff";
import { notifyRunnerSessionObject } from "./runner-session";

const DEFAULT_REVIEW_MODE: PrReviewMode = "standard";
const DEFAULT_ADAPTER: AdapterId = "codex";
const DEFAULT_PERMISSION_PROFILE: PermissionProfile = "readonly";
const DEFAULT_MAX_COMMENTS = 20;

const COMMENT_BUDGETS: Record<PrReviewMode, number> = {
  quick: 8,
  standard: 20,
  deep: 30,
  security: 25,
};

export type StartPrReviewInput = {
  reviewMode?: PrReviewMode;
  runnerId?: string;
};

export async function startPrReview(
  env: Env,
  principal: AccessIdentity,
  prId: string,
  input: StartPrReviewInput,
) {
  const now = new Date().toISOString();
  const pr = await getGitHubPullRequest(env.DB, principal.orgId, prId);
  if (!pr) {
    throw new PrReviewError("Pull request not found", 404);
  }

  const repo = await getGitHubRepository(env.DB, principal.orgId, pr.repoId);
  if (!repo) {
    throw new PrReviewError("Repository not found", 404);
  }

  if (pr.status === "pending") {
    throw new PrReviewError("A review is already in progress for this PR", 409);
  }

  if (pr.isFork) {
    throw new PrReviewError("Fork PRs are not eligible for full review in MVP", 422);
  }

  const reviewMode = input.reviewMode ?? DEFAULT_REVIEW_MODE;
  const runnerId = input.runnerId ?? repo.defaultRunnerId;
  if (!runnerId) {
    throw new PrReviewError("No runner is configured for this repository", 422);
  }

  const fusionRunId = formatEntityId("run", crypto.randomUUID());
  const reviewRunId = formatEntityId("prrev_run", crypto.randomUUID());
  const jobId = formatEntityId("job", crypto.randomUUID());

  await createFusionRun(env.DB, {
    id: fusionRunId,
    orgId: principal.orgId,
    userId: principal.userId,
    mode: "direct",
    permissionProfile: repo.permissionProfile,
    title: `PR Review: ${repo.fullName}#${pr.number}`,
    status: "running",
    createdAt: now,
  });

  let diffObjectKey: string | undefined;
  try {
    const diff = await fetchAndStorePrDiff(env, principal.orgId, prId);
    diffObjectKey = diff.objectKey;
  } catch (error) {
    console.error(`Failed to fetch diff for PR ${prId}: ${error instanceof Error ? error.message : String(error)}`);
  }

  const reviewRun = await createPrReviewRun(env.DB, {
    id: reviewRunId,
    orgId: principal.orgId,
    prId,
    runnerId,
    requestedByUserId: principal.userId,
    headSha: pr.headSha,
    baseSha: pr.baseSha,
    reviewMode,
    diffObjectKey,
    now,
  });

  if (!reviewRun) {
    throw new PrReviewError("Failed to create review run", 500);
  }

  const maxComments = Math.min(repo.maxComments || DEFAULT_MAX_COMMENTS, COMMENT_BUDGETS[reviewMode]);

  const payload: RunnerJobPayload = {
    jobId,
    runId: fusionRunId,
    kind: "pr_review",
    adapter: DEFAULT_ADAPTER,
    model: "default",
    role: "senior_reviewer",
    workspaceId: repo.workspaceId,
    workspacePath: undefined,
    permissionProfile: DEFAULT_PERMISSION_PROFILE,
    attempt: 1,
    metadata: {
      provider: "github",
      repoFullName: repo.fullName,
      pullNumber: pr.number,
      baseRef: pr.baseRef,
      baseSha: pr.baseSha,
      headRef: pr.headRef,
      headSha: pr.headSha,
      headRepoFullName: pr.headRepoFullName ?? repo.fullName,
      diffObjectKey,
      reviewRunId,
      reviewDepth: reviewMode,
      runTests: false,
      maxComments,
      ignoredPaths: repo.ignoredPaths,
    },
  };

  const inputObjectKey = await persistJobInput(env, principal.orgId, fusionRunId, jobId, payload);
  const job = await createRunnerJob(env.DB, {
    id: jobId,
    orgId: principal.orgId,
    runId: fusionRunId,
    runnerId,
    kind: "pr_review",
    inputObjectKey,
    createdAt: now,
  });

  await updatePrReviewRun(env.DB, {
    orgId: principal.orgId,
    runId: reviewRunId,
    fusionRunId,
    status: "queued",
    startedAt: now,
  });

  await updateGitHubPullRequestStatus(env.DB, principal.orgId, prId, "pending", now);

  const dispatchPayload: ClaimedRunnerJob = {
    ...job,
    payload,
  };
  await notifyRunnerSessionObject(env, runnerId, "/dispatch", dispatchPayload);

  await createAuditEvent(env.DB, {
    id: formatEntityId("audit", crypto.randomUUID()),
    orgId: principal.orgId,
    userId: principal.userId,
    runId: fusionRunId,
    eventType: "pr_review.started",
    metadata: {
      prId,
      reviewRunId,
      jobId,
      runnerId,
      reviewMode,
      repoFullName: repo.fullName,
      prNumber: pr.number,
    },
    createdAt: now,
  });

  return reviewRun;
}

export async function completePrReviewJob(
  env: Env,
  orgId: string,
  jobId: string,
  completion: {
    status: "completed" | "failed" | "timeout" | "cancelled";
    outputText?: string;
    error?: string;
    outputObjectKey?: string;
  },
) {
  const job = await getRunnerJob(env.DB, orgId, "", jobId);
  if (!job || job.kind !== "pr_review") {
    return null;
  }

  const now = new Date().toISOString();
  const metadata = await loadJobMetadata(env, orgId, job.runId, jobId);
  const reviewRunId = metadata?.reviewRunId;
  if (!reviewRunId) {
    return null;
  }

  const reviewRun = await getPrReviewRun(env.DB, orgId, reviewRunId);
  if (!reviewRun) {
    return null;
  }

  if (completion.status !== "completed") {
    await updatePrReviewRun(env.DB, {
      orgId,
      runId: reviewRunId,
      status: "failed",
      error: completion.error ?? `Job ${completion.status}`,
      completedAt: now,
    });
    await updateFusionRunStatus(env.DB, orgId, job.runId, "failed", now, completion.error);
    await updateGitHubPullRequestStatus(env.DB, orgId, reviewRun.prId, "failed", now);

    await createAuditEvent(env.DB, {
      id: formatEntityId("audit", crypto.randomUUID()),
      orgId,
      runId: job.runId,
      eventType: "pr_review.failed",
      severity: "warning",
      metadata: { reviewRunId, jobId, error: completion.error },
      createdAt: now,
    });
    return reviewRunId;
  }

  const outputText = completion.outputText ?? (await loadJobOutput(env, orgId, job.runId, jobId));
  const result = parseReviewResult(outputText);

  if (!result) {
    await updatePrReviewRun(env.DB, {
      orgId,
      runId: reviewRunId,
      status: "failed",
      error: "Failed to parse review output as valid JSON",
      completedAt: now,
    });
    await updateFusionRunStatus(env.DB, orgId, job.runId, "failed", now, "Invalid review output");
    await updateGitHubPullRequestStatus(env.DB, orgId, reviewRun.prId, "failed", now);
    return reviewRunId;
  }

  const findingsObjectKey = await storeFindings(env, orgId, reviewRunId, result);

  const maxComments = metadata?.maxComments ?? DEFAULT_MAX_COMMENTS;
  const limitedFindings = result.findings.slice(0, maxComments);

  for (const finding of limitedFindings) {
    await createPrReviewComment(env.DB, {
      id: formatEntityId("prrev_comment", crypto.randomUUID()),
      orgId,
      reviewRunId,
      prId: reviewRun.prId,
      filePath: finding.filePath,
      side: finding.side,
      startLine: finding.startLine,
      line: finding.line,
      severity: finding.severity,
      category: finding.category,
      body: finding.body,
      suggestedChange: finding.suggestedChange,
      confidence: finding.confidence,
      evidence: finding.evidence,
      now,
    });
  }

  await updatePrReviewRun(env.DB, {
    orgId,
    runId: reviewRunId,
    status: "completed",
    riskLevel: result.riskLevel,
    decision: result.decision,
    summary: result.summary,
    findingsObjectKey,
    completedAt: now,
  });

  await updateFusionRunStatus(env.DB, orgId, job.runId, "completed", now);
  await updateGitHubPullRequestStatus(env.DB, orgId, reviewRun.prId, "pending", now);

  await createAuditEvent(env.DB, {
    id: formatEntityId("audit", crypto.randomUUID()),
    orgId,
    runId: job.runId,
    eventType: "pr_review.completed",
    metadata: {
      reviewRunId,
      jobId,
      findingCount: limitedFindings.length,
      riskLevel: result.riskLevel,
      decision: result.decision,
    },
    createdAt: now,
  });

  return reviewRunId;
}

export async function getReviewRunComments(env: Env, orgId: string, reviewRunId: string) {
  return listPrReviewCommentsByRun(env.DB, orgId, reviewRunId);
}

function parseReviewResult(outputText: string | undefined): PrReviewResult | null {
  if (!outputText) return null;

  const jsonText = extractJson(outputText);
  if (!jsonText) return null;

  try {
    const parsed = JSON.parse(jsonText);
    const result = prReviewResultSchema.safeParse(parsed);
    if (!result.success) {
      console.error("Review result validation failed:", result.error.issues);
      return null;
    }
    return result.data;
  } catch {
    return null;
  }
}

function extractJson(text: string): string | null {
  const trimmed = text.trim();

  if (trimmed.startsWith("{") && trimmed.endsWith("}")) {
    return trimmed;
  }

  const fenceMatch = trimmed.match(/```(?:json)?\s*\n([\s\S]*?)\n```/);
  if (fenceMatch) {
    return fenceMatch[1].trim();
  }

  const start = trimmed.indexOf("{");
  const end = trimmed.lastIndexOf("}");
  if (start >= 0 && end > start) {
    return trimmed.slice(start, end + 1);
  }

  return null;
}

async function persistJobInput(env: Env, orgId: string, runId: string, jobId: string, payload: RunnerJobPayload) {
  if (!env.ARTIFACTS) return undefined;

  const key = buildArtifactKey(orgId, runId, `jobs/${jobId}.json`);
  await env.ARTIFACTS.put(key, JSON.stringify(payload, null, 2), {
    httpMetadata: { contentType: "application/json" },
  });
  return key;
}

type PrReviewJobMetadata = {
  provider?: string;
  repoFullName?: string;
  pullNumber?: number;
  baseRef?: string;
  baseSha?: string;
  headRef?: string;
  headSha?: string;
  headRepoFullName?: string;
  diffObjectKey?: string;
  reviewRunId?: string;
  reviewDepth?: string;
  runTests?: boolean;
  maxComments?: number;
  ignoredPaths?: string[];
};

async function loadJobMetadata(
  env: Env,
  orgId: string,
  runId: string,
  jobId: string,
): Promise<PrReviewJobMetadata | undefined> {
  if (!env.ARTIFACTS) return undefined;

  const key = buildArtifactKey(orgId, runId, `jobs/${jobId}.json`);
  const object = await env.ARTIFACTS.get(key);
  if (!object) return undefined;

  const body = JSON.parse(await object.text()) as { metadata?: PrReviewJobMetadata };
  return body.metadata;
}

async function loadJobOutput(env: Env, orgId: string, runId: string, jobId: string): Promise<string | undefined> {
  if (!env.ARTIFACTS) return undefined;

  const key = buildArtifactKey(orgId, runId, `pr_review/${jobId}.txt`);
  const object = await env.ARTIFACTS.get(key);
  if (!object) return undefined;
  return object.text();
}

async function storeFindings(env: Env, orgId: string, reviewRunId: string, result: PrReviewResult): Promise<string | undefined> {
  if (!env.ARTIFACTS) return undefined;

  const key = `pr-reviews/${orgId}/${reviewRunId}/findings.json`;
  await env.ARTIFACTS.put(key, JSON.stringify(result, null, 2), {
    httpMetadata: { contentType: "application/json" },
  });
  return key;
}

export class PrReviewError extends Error {
  constructor(
    message: string,
    readonly statusCode: 400 | 404 | 409 | 422 | 500 = 400,
  ) {
    super(message);
    this.name = "PrReviewError";
  }
}

export type { PrReviewFinding };