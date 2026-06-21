import {
  createAuditEvent,
  getGitHubPullRequestByNumber,
  getGitHubRepositoryByFullName,
  getGitHubRepositoryByGithubId,
  getGitHubUserLinkByLogin,
  getLatestPrReviewRun,
  listGitHubRepositoriesByInstallation,
  markGitHubReviewSubjectsRemoved,
  upsertGitHubInstallation,
  upsertGitHubPullRequest,
  upsertGitHubRepository,
  upsertGitHubReviewSubject,
  updateGitHubPullRequestStatus,
  updateGitHubPullRequestHeadSha,
  type UpsertGitHubPullRequestInput,
} from "@fusion-harness/db";
import {
  formatEntityId,
  type GitHubPrStatus,
  type GitHubPullRequestRef,
  type GitHubRepositoryRef,
} from "@fusion-harness/shared";
import type { Env } from "../env";
import { GitHubAppAuth } from "./github-app";

type GitHubInstallationResponse = {
  id: number;
  account: {
    login: string;
    type: string;
  };
  target_type?: string;
  permissions?: Record<string, string>;
  repository_selection?: string;
  suspended_at?: string | null;
};

type GitHubRepositoryResponse = {
  id: number;
  name: string;
  full_name: string;
  owner: { login: string };
  private: boolean;
  default_branch?: string;
  html_url?: string;
};

type GitHubPullRequestResponse = {
  id: number;
  number: number;
  title: string;
  user: { login: string } | null;
  state: string;
  draft: boolean;
  head: {
    ref: string;
    sha: string;
    repo: { full_name: string } | null;
  };
  base: {
    ref: string;
    sha: string;
    repo: { full_name: string };
  };
  html_url?: string;
  additions?: number;
  deletions?: number;
  changed_files?: number;
  requested_reviewers?: Array<{ login: string; id?: number }>;
  requested_teams?: Array<{ name: string; id?: number }>;
  assignees?: Array<{ login: string; id?: number }>;
};

export type SyncResult = {
  installations: number;
  repositories: number;
  pullRequests: number;
};

export async function syncInstallations(env: Env, orgId: string): Promise<number> {
  const auth = new GitHubAppAuth(env);
  const response = await auth.fetchAsApp("/app/installations?per_page=100");

  if (!response.ok) {
    throw new Error(`GitHub installations list failed (${response.status})`);
  }

  const installations = (await response.json()) as GitHubInstallationResponse[];
  const now = new Date().toISOString();

  for (const installation of installations) {
    await upsertGitHubInstallation(env.DB, {
      id: formatEntityId("gh_install", `${orgId}_${installation.id}`),
      orgId,
      installationId: installation.id,
      accountLogin: installation.account.login,
      accountType: normalizeAccountType(installation.account.type),
      targetType: installation.target_type,
      permissions: installation.permissions ?? {},
      repositorySelection: installation.repository_selection as "selected" | "all" | undefined,
      suspendedAt: installation.suspended_at ?? undefined,
      now,
    });
  }

  return installations.length;
}

export async function syncRepositoriesForInstallation(
  env: Env,
  orgId: string,
  installationId: number,
): Promise<number> {
  const auth = new GitHubAppAuth(env);
  const response = await auth.fetchAsInstallation(
    installationId,
    "/installation/repositories?per_page=100",
  );

  if (!response.ok) {
    throw new Error(`GitHub repositories list failed (${response.status})`);
  }

  const body = (await response.json()) as { repositories: GitHubRepositoryResponse[] };
  const now = new Date().toISOString();
  let count = 0;

  for (const repo of body.repositories) {
    const existing = await getGitHubRepositoryByGithubId(env.DB, orgId, repo.id);
    await upsertGitHubRepository(env.DB, {
      id: existing?.id ?? formatEntityId("gh_repo", `${orgId}_${repo.id}`),
      orgId,
      installationId,
      githubRepoId: repo.id,
      owner: repo.owner.login,
      name: repo.name,
      fullName: repo.full_name,
      private: repo.private,
      defaultBranch: repo.default_branch,
      htmlUrl: repo.html_url,
      now,
    });
    count += 1;
  }

  return count;
}

export async function syncPullRequestsForRepository(
  env: Env,
  orgId: string,
  repo: GitHubRepositoryRef,
): Promise<number> {
  const auth = new GitHubAppAuth(env);
  const path = `/repos/${repo.fullName}/pulls?state=open&per_page=100`;
  const response = await auth.fetchAsInstallation(repo.installationId, path);

  if (!response.ok) {
    throw new Error(`GitHub PRs list for ${repo.fullName} failed (${response.status})`);
  }

  const prs = (await response.json()) as GitHubPullRequestResponse[];
  const now = new Date().toISOString();
  let count = 0;

  for (const pr of prs) {
    await upsertPullRequestFromGitHub(env, orgId, repo.id, pr, now);
    count += 1;
  }

  return count;
}

export async function syncAll(env: Env, orgId: string): Promise<SyncResult> {
  const installationCount = await syncInstallations(env, orgId);
  const installationIds = await listAllInstallationsForSync(env, orgId);

  let repoCount = 0;
  let prCount = 0;

  for (const installationId of installationIds) {
    const reposSynced = await syncRepositoriesForInstallation(env, orgId, installationId);
    repoCount += reposSynced;

    const repos = await listGitHubRepositoriesByInstallation(env.DB, orgId, installationId);
    for (const repo of repos) {
      try {
        prCount += await syncPullRequestsForRepository(env, orgId, repo);
      } catch (error) {
        console.error(`PR sync failed for ${repo.fullName}: ${error instanceof Error ? error.message : String(error)}`);
      }
    }
  }

  await createAuditEvent(env.DB, {
    id: formatEntityId("audit", crypto.randomUUID()),
    orgId,
    eventType: "github.sync",
    metadata: { installations: installationCount, repositories: repoCount, pullRequests: prCount },
    createdAt: new Date().toISOString(),
  });

  return { installations: installationCount, repositories: repoCount, pullRequests: prCount };
}

async function listAllInstallationsForSync(env: Env, orgId: string): Promise<number[]> {
  const { results } = await env.DB
    .prepare("SELECT installation_id FROM github_installations WHERE org_id = ? ORDER BY installation_id ASC")
    .bind(orgId)
    .all<{ installation_id: number }>();
  return results.map((row) => row.installation_id);
}

export async function upsertPullRequestFromGitHub(
  env: Env,
  orgId: string,
  repoId: string,
  pr: GitHubPullRequestResponse,
  now: string,
): Promise<GitHubPullRequestRef> {
  const existing = await getGitHubPullRequestByNumber(env.DB, orgId, repoId, pr.number);
  const isFork = pr.head.repo?.full_name !== pr.base.repo.full_name;

  const input: UpsertGitHubPullRequestInput = {
    id: existing?.id ?? formatEntityId("gh_pr", `${orgId}_${pr.id}`),
    orgId,
    repoId,
    githubPrId: pr.id,
    number: pr.number,
    title: pr.title,
    authorLogin: pr.user?.login,
    state: pr.state,
    draft: pr.draft,
    isFork,
    baseRef: pr.base.ref,
    baseSha: pr.base.sha,
    headRef: pr.head.ref,
    headSha: pr.head.sha,
    headRepoFullName: pr.head.repo?.full_name,
    htmlUrl: pr.html_url,
    additions: pr.additions,
    deletions: pr.deletions,
    changedFiles: pr.changed_files,
    now,
  };

  const record = await upsertGitHubPullRequest(env.DB, input);
  if (!record) {
    throw new Error(`Failed to upsert PR #${pr.number}`);
  }

  await syncReviewSubjects(env, orgId, record.id, pr, now);

  if (existing && existing.headSha !== record.headSha) {
    await markPrStaleIfReviewed(env, orgId, record.id, now);
  }

  const status = await derivePrStatus(env, orgId, record.id, record);
  if (status !== record.status) {
    await updateGitHubPullRequestStatus(env.DB, orgId, record.id, status, now);
  }

  return record;
}

async function syncReviewSubjects(
  env: Env,
  orgId: string,
  prId: string,
  pr: GitHubPullRequestResponse,
  now: string,
) {
  const requestedReviewers = pr.requested_reviewers ?? [];
  const assignees = pr.assignees ?? [];

  for (const reviewer of requestedReviewers) {
    const link = await getGitHubUserLinkByLogin(env.DB, orgId, reviewer.login);
    await upsertGitHubReviewSubject(env.DB, {
      id: formatEntityId("gh_subject", `${prId}:${reviewer.login}:requested_reviewer`),
      orgId,
      prId,
      githubLogin: reviewer.login,
      userId: link?.userId,
      subjectType: "requested_reviewer",
      state: "active",
      now,
    });
  }

  await markGitHubReviewSubjectsRemoved(
    env.DB,
    orgId,
    prId,
    "requested_reviewer",
    requestedReviewers.map((r) => r.login),
    now,
  );

  for (const assignee of assignees) {
    const link = await getGitHubUserLinkByLogin(env.DB, orgId, assignee.login);
    await upsertGitHubReviewSubject(env.DB, {
      id: formatEntityId("gh_subject", `${prId}:${assignee.login}:assignee`),
      orgId,
      prId,
      githubLogin: assignee.login,
      userId: link?.userId,
      subjectType: "assignee",
      state: "active",
      now,
    });
  }

  await markGitHubReviewSubjectsRemoved(
    env.DB,
    orgId,
    prId,
    "assignee",
    assignees.map((a) => a.login),
    now,
  );
}

export async function markPrStaleIfReviewed(env: Env, orgId: string, prId: string, now: string) {
  const latestRun = await getLatestPrReviewRun(env.DB, orgId, prId);
  if (!latestRun) return;
  if (latestRun.status === "completed" || latestRun.status === "failed" || latestRun.status === "cancelled") {
    await updateGitHubPullRequestStatus(env.DB, orgId, prId, "stale", now);
  }
}

export async function derivePrStatus(
  env: Env,
  orgId: string,
  prId: string,
  pr: GitHubPullRequestRef,
): Promise<GitHubPrStatus> {
  if (pr.status === "ignored") return "ignored";

  const latestRun = await getLatestPrReviewRun(env.DB, orgId, prId);

  if (latestRun) {
    if (latestRun.status === "queued" || latestRun.status === "running") {
      return "pending";
    }
    if (latestRun.status === "failed") {
      return "failed";
    }
    if (latestRun.status === "completed") {
      if (latestRun.headSha !== pr.headSha) {
        return "stale";
      }
      return "reviewed";
    }
  }

  const { results } = await env.DB
    .prepare(
      `SELECT 1 FROM github_pr_review_subjects
       WHERE org_id = ? AND pr_id = ? AND subject_type = 'requested_reviewer' AND state = 'active'
       LIMIT 1`,
    )
    .bind(orgId, prId)
    .all();

  if (results.length > 0) {
    return "assigned";
  }

  return "not_assigned";
}

export async function markPrStaleOnNewCommit(
  env: Env,
  orgId: string,
  prId: string,
  newHeadSha: string,
  now: string,
) {
  await updateGitHubPullRequestHeadSha(env.DB, orgId, prId, newHeadSha, now);
  await markPrStaleIfReviewed(env, orgId, prId, now);
}

function normalizeAccountType(type: string): "User" | "Organization" | "Bot" {
  if (type === "User" || type === "Organization" || type === "Bot") return type;
  return "User";
}
