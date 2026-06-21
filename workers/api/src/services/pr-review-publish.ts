import {
  createAuditEvent,
  getGitHubPullRequest,
  getGitHubRepository,
  listPrReviewComments,
  updateGitHubPullRequestStatus,
  updatePrReviewComment,
} from "@fusion-harness/db";
import {
  formatEntityId,
  type PrDiffFile,
  type PrReviewCommentRef,
  type PrReviewDecision,
} from "@fusion-harness/shared";
import type { Env } from "../env";
import { GitHubAppAuth } from "./github-app";
import type { AccessIdentity } from "./auth";
import { getStoredPrDiff } from "./github-diff";

type PublishInput = {
  prId: string;
  commentIds?: string[];
  decision?: PrReviewDecision;
  event?: "COMMENT" | "REQUEST_CHANGES" | "APPROVE";
  body?: string;
};

type PublishResult = {
  reviewId: number;
  publishedComments: number;
  outdatedComments: number;
  checkRunId?: number;
};

type GitHubReviewComment = {
  path: string;
  line: number;
  side: "LEFT" | "RIGHT";
  start_line?: number;
  start_side?: "LEFT" | "RIGHT";
  body: string;
};

type GitHubReviewResponse = {
  id: number;
  state: string;
};

type GitHubCheckRunResponse = {
  id: number;
};

const CHECK_RUN_NAME = "Fusion PR Review";

export async function publishPrReview(
  env: Env,
  principal: AccessIdentity,
  input: PublishInput,
): Promise<PublishResult> {
  const now = new Date().toISOString();
  const pr = await getGitHubPullRequest(env.DB, principal.orgId, input.prId);
  if (!pr) {
    throw new PublishError("Pull request not found", 404);
  }

  const repo = await getGitHubRepository(env.DB, principal.orgId, pr.repoId);
  if (!repo) {
    throw new PublishError("Repository not found", 404);
  }

  if (pr.status !== "pending" && pr.status !== "stale" && pr.status !== "failed") {
    throw new PublishError(
      `PR must be in pending, stale, or failed state to publish. Current: ${pr.status}`,
      409,
    );
  }

  const allComments = await listPrReviewComments(env.DB, principal.orgId, input.prId);
  const selectedComments = selectComments(allComments, input.commentIds);

  if (selectedComments.length === 0 && input.event !== "APPROVE") {
    throw new PublishError("No comments selected for publishing", 422);
  }

  const diff = await getStoredPrDiff(env, principal.orgId, input.prId);
  const { publishable, outdated } = validateComments(selectedComments, diff?.files ?? []);

  const reviewBody = input.body ?? buildReviewBody(selectedComments, publishable.length, outdated.length);
  const reviewEvent = input.event ?? decisionToEvent(input.decision);

  if (reviewEvent === "REQUEST_CHANGES" && publishable.some((c) => c.severity === "blocker" || c.severity === "major")) {
    // Allowed - request changes for blocker/major findings
  }

  const auth = new GitHubAppAuth(env);
  const reviewComments = publishable.map(toGitHubReviewComment);

  const reviewId = await createGitHubReview(auth, repo.installationId, repo.fullName, pr.number, {
    body: reviewBody,
    event: reviewEvent,
    comments: reviewComments,
    commitId: pr.headSha,
  });

  for (const comment of publishable) {
    await updatePrReviewComment(env.DB, {
      orgId: principal.orgId,
      commentId: comment.id,
      status: "published",
      editedByUserId: principal.userId,
      now,
    });
  }

  for (const comment of outdated) {
    await updatePrReviewComment(env.DB, {
      orgId: principal.orgId,
      commentId: comment.id,
      status: "outdated",
      editedByUserId: principal.userId,
      now,
    });
  }

  let checkRunId: number | undefined;
  try {
    checkRunId = await createCheckRun(auth, repo.installationId, repo.fullName, {
      headSha: pr.headSha,
      status: "completed",
      conclusion: reviewEvent === "APPROVE" ? "success" : reviewEvent === "REQUEST_CHANGES" ? "failure" : "neutral",
      title: `Fusion PR Review: ${publishable.length} comments`,
      summary: reviewBody,
      detailsUrl: `${env.PUBLIC_APP_URL}/pr-reviews/${pr.id}`,
    });
  } catch (error) {
    console.error(`Check run creation failed: ${error instanceof Error ? error.message : String(error)}`);
  }

  await updateGitHubPullRequestStatus(env.DB, principal.orgId, input.prId, "reviewed", now);

  await createAuditEvent(env.DB, {
    id: formatEntityId("audit", crypto.randomUUID()),
    orgId: principal.orgId,
    userId: principal.userId,
    eventType: "pr_review.published",
    metadata: {
      prId: input.prId,
      reviewId,
      repoFullName: repo.fullName,
      prNumber: pr.number,
      event: reviewEvent,
      publishedComments: publishable.length,
      outdatedComments: outdated.length,
      checkRunId,
    },
    createdAt: now,
  });

  return {
    reviewId,
    publishedComments: publishable.length,
    outdatedComments: outdated.length,
    checkRunId,
  };
}

function selectComments(
  allComments: PrReviewCommentRef[],
  commentIds?: string[],
): PrReviewCommentRef[] {
  const eligible = allComments.filter(
    (c) => c.status === "draft" || c.status === "edited" || c.status === "approved",
  );

  if (!commentIds || commentIds.length === 0) {
    return eligible;
  }

  const idSet = new Set(commentIds);
  return eligible.filter((c) => idSet.has(c.id));
}

function validateComments(
  comments: PrReviewCommentRef[],
  diffFiles: PrDiffFile[],
): { publishable: PrReviewCommentRef[]; outdated: PrReviewCommentRef[] } {
  const fileMap = new Map<string, PrDiffFile>();
  for (const file of diffFiles) {
    fileMap.set(file.filename, file);
  }

  const publishable: PrReviewCommentRef[] = [];
  const outdated: PrReviewCommentRef[] = [];

  for (const comment of comments) {
    const file = fileMap.get(comment.filePath);
    if (!file) {
      outdated.push(comment);
      continue;
    }

    if (comment.line === undefined || comment.line === null) {
      publishable.push(comment);
      continue;
    }

    if (file.additions + file.deletions === 0) {
      outdated.push(comment);
      continue;
    }

    publishable.push(comment);
  }

  return { publishable, outdated };
}

function toGitHubReviewComment(comment: PrReviewCommentRef): GitHubReviewComment {
  const body = formatCommentBody(comment);
  const reviewComment: GitHubReviewComment = {
    path: comment.filePath,
    line: comment.line ?? 1,
    side: comment.side,
    body,
  };

  if (comment.startLine && comment.startLine !== comment.line) {
    reviewComment.start_line = comment.startLine;
    reviewComment.start_side = comment.side;
  }

  return reviewComment;
}

function formatCommentBody(comment: PrReviewCommentRef): string {
  const parts: string[] = [comment.body];

  if (comment.suggestedChange) {
    parts.push("");
    parts.push("```suggestion");
    parts.push(comment.suggestedChange);
    parts.push("```");
  }

  if (comment.evidence) {
    parts.push("");
    parts.push(`> **Evidence:** ${comment.evidence}`);
  }

  parts.push("");
  parts.push(`*Severity: ${comment.severity} · Category: ${comment.category}*`);

  return parts.join("\n");
}

function buildReviewBody(comments: PrReviewCommentRef[], published: number, outdated: number): string {
  const parts: string[] = ["## Fusion PR Review"];

  parts.push("");
  parts.push(`Published ${published} comment${published === 1 ? "" : "s"}.`);
  if (outdated > 0) {
    parts.push(`${outdated} comment${outdated === 1 ? "" : "s"} marked as outdated due to diff changes.`);
  }

  const bySeverity = new Map<string, number>();
  for (const comment of comments) {
    bySeverity.set(comment.severity, (bySeverity.get(comment.severity) ?? 0) + 1);
  }

  if (bySeverity.size > 0) {
    parts.push("");
    parts.push("### Findings by severity");
    for (const severity of ["blocker", "major", "minor", "nit"]) {
      const count = bySeverity.get(severity);
      if (count) {
        parts.push(`- **${severity}**: ${count}`);
      }
    }
  }

  return parts.join("\n");
}

function decisionToEvent(decision?: PrReviewDecision): "COMMENT" | "REQUEST_CHANGES" | "APPROVE" {
  if (decision === "approve") return "APPROVE";
  if (decision === "request_changes") return "REQUEST_CHANGES";
  return "COMMENT";
}

async function createGitHubReview(
  auth: GitHubAppAuth,
  installationId: number,
  repoFullName: string,
  pullNumber: number,
  payload: {
    body: string;
    event: string;
    comments: GitHubReviewComment[];
    commitId: string;
  },
): Promise<number> {
  const response = await auth.fetchAsInstallation(
    installationId,
    `/repos/${repoFullName}/pulls/${pullNumber}/reviews`,
    {
      method: "POST",
      body: JSON.stringify({
        body: payload.body,
        event: payload.event,
        comments: payload.comments,
        commit_id: payload.commitId,
      }),
    },
  );

  if (!response.ok) {
    const text = await response.text();
    throw new PublishError(`GitHub review creation failed (${response.status}): ${text}`, 502);
  }

  const body = (await response.json()) as GitHubReviewResponse;
  return body.id;
}

async function createCheckRun(
  auth: GitHubAppAuth,
  installationId: number,
  repoFullName: string,
  payload: {
    headSha: string;
    status: "queued" | "in_progress" | "completed";
    conclusion?: "success" | "failure" | "neutral" | "action_required";
    title: string;
    summary: string;
    detailsUrl?: string;
  },
): Promise<number> {
  const response = await auth.fetchAsInstallation(
    installationId,
    `/repos/${repoFullName}/check-runs`,
    {
      method: "POST",
      body: JSON.stringify({
        name: CHECK_RUN_NAME,
        head_sha: payload.headSha,
        status: payload.status,
        conclusion: payload.conclusion,
        output: {
          title: payload.title,
          summary: payload.summary,
        },
        details_url: payload.detailsUrl,
      }),
    },
  );

  if (!response.ok) {
    const text = await response.text();
    throw new Error(`Check run creation failed (${response.status}): ${text}`);
  }

  const body = (await response.json()) as GitHubCheckRunResponse;
  return body.id;
}

export class PublishError extends Error {
  constructor(
    message: string,
    readonly statusCode: 400 | 404 | 409 | 422 | 502 = 400,
  ) {
    super(message);
    this.name = "PublishError";
  }
}