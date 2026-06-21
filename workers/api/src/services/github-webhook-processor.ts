import {
  completeGitHubWebhookEvent,
  createAuditEvent,
  createGitHubWebhookEvent,
  deleteGitHubInstallation,
  getGitHubPullRequestByNumber,
  getGitHubRepositoryByFullName,
  getGitHubRepositoryByGithubId,
  getGitHubUserLinkByLogin,
  getGitHubWebhookEventByDelivery,
  upsertGitHubInstallation,
  upsertGitHubPullRequest,
  upsertGitHubRepository,
  upsertGitHubReviewSubject,
  markGitHubReviewSubjectsRemoved,
  updateGitHubPullRequestStatus,
} from "@fusion-harness/db";
import { formatEntityId } from "@fusion-harness/shared";
import type { Env } from "../env";
import { GitHubAppAuth } from "./github-app";
import { derivePrStatus, markPrStaleIfReviewed } from "./github-sync";

type WebhookPayload = {
  action?: string;
  installation?: {
    id: number;
    account?: { login: string; type: string };
    target_type?: string;
    permissions?: Record<string, string>;
    repository_selection?: string;
    suspended_at?: string | null;
  };
  repository?: {
    id: number;
    name: string;
    full_name: string;
    owner: { login: string };
    private: boolean;
    default_branch?: string;
    html_url?: string;
  };
  pull_request?: {
    id: number;
    number: number;
    title: string;
    user: { login: string } | null;
    state: string;
    draft: boolean;
    head: { ref: string; sha: string; repo: { full_name: string } | null };
    base: { ref: string; sha: string; repo: { full_name: string } };
    html_url?: string;
    additions?: number;
    deletions?: number;
    changed_files?: number;
    requested_reviewers?: Array<{ login: string; id?: number }>;
    assignees?: Array<{ login: string; id?: number }>;
  };
  requested_reviewer?: { login: string; id?: number };
  assignee?: { login: string; id?: number };
  repositories_added?: Array<{
    id: number;
    name: string;
    full_name: string;
    owner: { login: string };
    private: boolean;
    default_branch?: string;
    html_url?: string;
  }>;
  repositories_removed?: Array<{
    id: number;
    name: string;
    full_name: string;
    owner: { login: string };
    private: boolean;
    default_branch?: string;
    html_url?: string;
  }>;
  sender?: { login: string };
};

export type WebhookProcessResult = {
  deliveryId: string;
  eventName: string;
  action?: string;
  processed: boolean;
  error?: string;
};

export async function processGitHubWebhook(
  env: Env,
  deliveryId: string,
  eventName: string,
  payload: WebhookPayload,
  rawBody: string,
): Promise<WebhookProcessResult> {
  const now = new Date().toISOString();
  const existing = await getGitHubWebhookEventByDelivery(env.DB, deliveryId);
  if (existing?.processedAt) {
    return {
      deliveryId,
      eventName,
      action: payload.action,
      processed: true,
    };
  }

  const installationId = payload.installation?.id;
  const payloadObjectKey = await storeWebhookPayload(env, deliveryId, eventName, rawBody);

  const webhookEvent = existing ?? await createGitHubWebhookEvent(env.DB, {
    id: formatEntityId("gh_webhook", deliveryId),
    deliveryId,
    eventName,
    action: payload.action,
    installationId,
    payloadObjectKey,
    now,
  });

  if (!webhookEvent) {
    return {
      deliveryId,
      eventName,
      action: payload.action,
      processed: false,
      error: "Failed to record webhook event",
    };
  }

  try {
    const orgIds = await resolveWebhookOrgIds(env, payload);
    for (const orgId of orgIds) {
      await dispatchWebhookEvent(env, orgId, eventName, payload, now);
    }
    await completeGitHubWebhookEvent(env.DB, {
      id: webhookEvent.id,
      orgId: orgIds[0],
      processedAt: new Date().toISOString(),
    });

    return {
      deliveryId,
      eventName,
      action: payload.action,
      processed: true,
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    await completeGitHubWebhookEvent(env.DB, {
      id: webhookEvent.id,
      orgId: undefined,
      processedAt: new Date().toISOString(),
      error: message,
    });

    return {
      deliveryId,
      eventName,
      action: payload.action,
      processed: false,
      error: message,
    };
  }
}

async function resolveWebhookOrgIds(env: Env, payload: WebhookPayload) {
  const installationId = payload.installation?.id;
  if (installationId) {
    const { results } = await env.DB
      .prepare("SELECT DISTINCT org_id FROM github_installations WHERE installation_id = ?")
      .bind(installationId)
      .all<{ org_id: string }>();
    if (results.length > 0) return results.map((row) => row.org_id);
  }

  const repositoryId = payload.repository?.id;
  if (repositoryId) {
    const { results } = await env.DB
      .prepare("SELECT DISTINCT org_id FROM github_repositories WHERE github_repo_id = ?")
      .bind(repositoryId)
      .all<{ org_id: string }>();
    if (results.length > 0) return results.map((row) => row.org_id);
  }

  return [];
}

async function dispatchWebhookEvent(
  env: Env,
  orgId: string,
  eventName: string,
  payload: WebhookPayload,
  now: string,
) {
  switch (eventName) {
    case "installation":
      await handleInstallationEvent(env, orgId, payload, now);
      break;
    case "installation_repositories":
      await handleInstallationRepositoriesEvent(env, orgId, payload, now);
      break;
    case "pull_request":
      await handlePullRequestEvent(env, orgId, payload, now);
      break;
    case "ping":
      break;
    default:
      break;
  }
}

async function handleInstallationEvent(
  env: Env,
  orgId: string,
  payload: WebhookPayload,
  now: string,
) {
  const action = payload.action;
  const installation = payload.installation;
  if (!installation) return;

  if (action === "deleted") {
    await deleteGitHubInstallation(env.DB, orgId, installation.id);
    await createAuditEvent(env.DB, {
      id: formatEntityId("audit", crypto.randomUUID()),
      orgId,
      eventType: "github.installation_deleted",
      metadata: { installationId: installation.id },
      createdAt: now,
    });
    return;
  }

  const accountLogin = installation.account?.login ?? "unknown";
  const accountType = installation.account?.type ?? "User";

  await upsertGitHubInstallation(env.DB, {
    id: formatEntityId("gh_install", `${orgId}_${installation.id}`),
    orgId,
    installationId: installation.id,
    accountLogin,
    accountType: accountType === "Organization" || accountType === "Bot" ? accountType : "User",
    targetType: installation.target_type,
    permissions: installation.permissions ?? {},
    repositorySelection: installation.repository_selection as "selected" | "all" | undefined,
    suspendedAt: installation.suspended_at ?? undefined,
    now,
  });

  if (action === "created" || action === "new_permissions_accepted") {
    await syncInstallationRepositories(env, orgId, installation.id);
  }

  await createAuditEvent(env.DB, {
    id: formatEntityId("audit", crypto.randomUUID()),
    orgId,
    eventType: `github.installation_${action}`,
    metadata: { installationId: installation.id, accountLogin },
    createdAt: now,
  });
}

async function handleInstallationRepositoriesEvent(
  env: Env,
  orgId: string,
  payload: WebhookPayload,
  now: string,
) {
  const installationId = payload.installation?.id;
  if (!installationId) return;

  for (const repo of payload.repositories_added ?? []) {
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
  }

  await createAuditEvent(env.DB, {
    id: formatEntityId("audit", crypto.randomUUID()),
    orgId,
    eventType: "github.installation_repositories",
    metadata: {
      installationId,
      added: payload.repositories_added?.length ?? 0,
      removed: payload.repositories_removed?.length ?? 0,
    },
    createdAt: now,
  });
}

async function handlePullRequestEvent(
  env: Env,
  orgId: string,
  payload: WebhookPayload,
  now: string,
) {
  const action = payload.action;
  const pr = payload.pull_request;
  const repo = payload.repository;
  if (!pr || !repo) return;

  const repoRecord = await getGitHubRepositoryByFullName(env.DB, orgId, repo.full_name);
  if (!repoRecord) return;

  const existing = await getGitHubPullRequestByNumber(env.DB, orgId, repoRecord.id, pr.number);
  const isFork = pr.head.repo?.full_name !== pr.base.repo.full_name;

  const record = await upsertGitHubPullRequest(env.DB, {
    id: existing?.id ?? formatEntityId("gh_pr", `${orgId}_${pr.id}`),
    orgId,
    repoId: repoRecord.id,
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
  });

  if (!record) return;

  await syncReviewSubjectsFromWebhook(env, orgId, record.id, pr, now);

  if (action === "synchronize" && existing && existing.headSha !== pr.head.sha) {
    await markPrStaleIfReviewed(env, orgId, record.id, now);
  }

  if (action === "closed") {
    await updateGitHubPullRequestStatus(env.DB, orgId, record.id, "ignored", now);
  }

  if (action === "converted_to_draft" && record.status !== "ignored") {
    await updateGitHubPullRequestStatus(env.DB, orgId, record.id, "not_assigned", now);
  }

  if (isFork && record.status === "not_assigned") {
    await updateGitHubPullRequestStatus(env.DB, orgId, record.id, "ignored", now);
  }

  const status = await derivePrStatus(env, orgId, record.id, record);
  if (status !== record.status && record.status !== "ignored") {
    await updateGitHubPullRequestStatus(env.DB, orgId, record.id, status, now);
  }

  await createAuditEvent(env.DB, {
    id: formatEntityId("audit", crypto.randomUUID()),
    orgId,
    eventType: `github.pull_request_${action}`,
    metadata: {
      repoFullName: repo.full_name,
      prNumber: pr.number,
      prId: record.id,
      headSha: pr.head.sha,
    },
    createdAt: now,
  });
}

async function syncReviewSubjectsFromWebhook(
  env: Env,
  orgId: string,
  prId: string,
  pr: NonNullable<WebhookPayload["pull_request"]>,
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

async function syncInstallationRepositories(env: Env, orgId: string, installationId: number) {
  const auth = new GitHubAppAuth(env);
  const response = await auth.fetchAsInstallation(
    installationId,
    "/installation/repositories?per_page=100",
  );
  if (!response.ok) return;

  const body = (await response.json()) as {
    repositories: Array<{
      id: number;
      name: string;
      full_name: string;
      owner: { login: string };
      private: boolean;
      default_branch?: string;
      html_url?: string;
    }>;
  };

  const now = new Date().toISOString();
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
  }
}

async function storeWebhookPayload(
  env: Env,
  deliveryId: string,
  eventName: string,
  rawBody: string,
): Promise<string | undefined> {
  if (!env.ARTIFACTS) return undefined;

  const key = `github-webhooks/${deliveryId}/${eventName}.json`;
  await env.ARTIFACTS.put(key, rawBody, {
    httpMetadata: { contentType: "application/json" },
  });
  return key;
}
