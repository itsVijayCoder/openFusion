import { getGitHubPullRequest, getGitHubRepository } from "@fusion-harness/db";
import type { PrDiffFile, PrDiffSnapshot, PrFileContent, PrReviewSide } from "@fusion-harness/shared";
import type { Env } from "../env";
import { GitHubAppAuth } from "./github-app";

type GitHubPrFileResponse = {
  filename: string;
  previous_filename?: string;
  status: string;
  additions: number;
  deletions: number;
  changes: number;
  sha: string;
  patch?: string;
  blob_url?: string;
  raw_url?: string;
};

type GitHubContentResponse = {
  content: string;
  encoding: string;
  sha?: string;
};

export async function fetchAndStorePrDiff(
  env: Env,
  orgId: string,
  prId: string,
): Promise<PrDiffSnapshot> {
  const pr = await getGitHubPullRequest(env.DB, orgId, prId);
  if (!pr) {
    throw new Error("Pull request not found");
  }

  const repo = await getGitHubRepository(env.DB, orgId, pr.repoId);
  if (!repo) {
    throw new Error("Repository not found");
  }

  const auth = new GitHubAppAuth(env);
  const files: PrDiffFile[] = [];
  let page = 1;
  const perPage = 100;

  while (true) {
    const response = await auth.fetchAsInstallation(
      repo.installationId,
      `/repos/${repo.fullName}/pulls/${pr.number}/files?per_page=${perPage}&page=${page}`,
    );

    if (!response.ok) {
      throw new Error(`GitHub PR files fetch failed (${response.status})`);
    }

    const batch = (await response.json()) as GitHubPrFileResponse[];
    if (batch.length === 0) break;

    for (const file of batch) {
      files.push({
        filename: file.filename,
        previousFilename: file.previous_filename,
        status: normalizeFileStatus(file.status),
        additions: file.additions,
        deletions: file.deletions,
        changes: file.changes,
        sha: file.sha,
        patch: file.patch,
        blobUrl: file.blob_url,
        rawUrl: file.raw_url,
      });
    }

    if (batch.length < perPage) break;
    page += 1;
  }

  const snapshot: PrDiffSnapshot = {
    prId,
    headSha: pr.headSha,
    baseSha: pr.baseSha,
    files,
    fetchedAt: new Date().toISOString(),
  };

  const objectKey = await storeDiffSnapshot(env, orgId, prId, pr.headSha, snapshot);
  snapshot.objectKey = objectKey;

  return snapshot;
}

export async function getStoredPrDiff(
  env: Env,
  orgId: string,
  prId: string,
): Promise<PrDiffSnapshot | null> {
  const pr = await getGitHubPullRequest(env.DB, orgId, prId);
  if (!pr) return null;

  const objectKey = buildDiffObjectKey(orgId, prId, pr.headSha);
  if (!env.ARTIFACTS) return null;

  const object = await env.ARTIFACTS.get(objectKey);
  if (!object) return null;

  const snapshot = JSON.parse(await object.text()) as PrDiffSnapshot;
  snapshot.objectKey = objectKey;
  return snapshot;
}

export async function fetchFileContent(
  env: Env,
  orgId: string,
  prId: string,
  filename: string,
  side: PrReviewSide,
): Promise<PrFileContent> {
  const pr = await getGitHubPullRequest(env.DB, orgId, prId);
  if (!pr) {
    throw new Error("Pull request not found");
  }

  const repo = await getGitHubRepository(env.DB, orgId, pr.repoId);
  if (!repo) {
    throw new Error("Repository not found");
  }

  const ref = side === "LEFT" ? pr.baseSha : pr.headSha;
  const auth = new GitHubAppAuth(env);
  const encodedPath = encodeURIComponent(filename);
  const response = await auth.fetchAsInstallation(
    repo.installationId,
    `/repos/${repo.fullName}/contents/${encodedPath}?ref=${ref}`,
  );

  if (response.status === 404) {
    return { filename, side, content: "" };
  }

  if (!response.ok) {
    throw new Error(`GitHub file content fetch failed (${response.status})`);
  }

  const body = (await response.json()) as GitHubContentResponse;
  const content = body.encoding === "base64" ? atob(body.content) : body.content;

  return {
    filename,
    side,
    content,
    sha: body.sha,
  };
}

async function storeDiffSnapshot(
  env: Env,
  orgId: string,
  prId: string,
  headSha: string,
  snapshot: PrDiffSnapshot,
): Promise<string | undefined> {
  if (!env.ARTIFACTS) return undefined;

  const objectKey = buildDiffObjectKey(orgId, prId, headSha);
  await env.ARTIFACTS.put(objectKey, JSON.stringify(snapshot), {
    httpMetadata: { contentType: "application/json" },
  });
  return objectKey;
}

export function buildDiffObjectKey(orgId: string, prId: string, headSha: string): string {
  return `pr-reviews/${orgId}/${prId}/diffs/${headSha}.json`;
}

function normalizeFileStatus(status: string): PrDiffFile["status"] {
  const valid: PrDiffFile["status"][] = ["added", "removed", "modified", "renamed", "copied", "changed", "unchanged"];
  return (valid as string[]).includes(status) ? (status as PrDiffFile["status"]) : "changed";
}