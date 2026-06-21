import type { PermissionProfile } from "./types";

export type GitHubPrStatus =
  | "not_assigned"
  | "assigned"
  | "pending"
  | "reviewed"
  | "stale"
  | "failed"
  | "ignored";

export type GitHubAccountType = "User" | "Organization" | "Bot";

export type GitHubRepositorySelection = "selected" | "all";

export type GitHubReviewSubjectType = "assignee" | "requested_reviewer";

export type GitHubReviewSubjectState = "active" | "removed";

export type PrReviewRunStatus =
  | "queued"
  | "running"
  | "completed"
  | "failed"
  | "cancelled";

export type PrReviewMode = "quick" | "standard" | "deep" | "security";

export type PrReviewSeverity = "blocker" | "major" | "minor" | "nit";

export type PrReviewCategory =
  | "bug"
  | "security"
  | "performance"
  | "maintainability"
  | "test"
  | "ux"
  | "accessibility"
  | "docs";

export type PrReviewSide = "LEFT" | "RIGHT";

export type PrReviewCommentStatus =
  | "draft"
  | "edited"
  | "approved"
  | "rejected"
  | "published"
  | "outdated"
  | "failed";

export type PrReviewRiskLevel = "low" | "medium" | "high";

export type PrReviewDecision = "comment" | "request_changes" | "approve";

export type GitHubInstallationRef = {
  id: string;
  orgId: string;
  installationId: number;
  accountLogin: string;
  accountType: GitHubAccountType;
  targetType?: string;
  permissions: Record<string, string>;
  repositorySelection?: GitHubRepositorySelection;
  suspendedAt?: string;
  createdAt: string;
  updatedAt: string;
};

export type GitHubRepositoryRef = {
  id: string;
  orgId: string;
  installationId: number;
  githubRepoId: number;
  owner: string;
  name: string;
  fullName: string;
  private: boolean;
  defaultBranch?: string;
  htmlUrl?: string;
  workspaceId?: string;
  defaultRunnerId?: string;
  autoReviewEnabled: boolean;
  autoReviewTrigger: AutoReviewTrigger;
  autoPublishEnabled: boolean;
  permissionProfile: PermissionProfile;
  runTests: boolean;
  maxComments: number;
  ignoredPaths: string[];
  createdAt: string;
  updatedAt: string;
};

export type AutoReviewTrigger = "review_requested" | "assigned" | "both" | "manual";

export type GitHubUserLinkRef = {
  id: string;
  orgId: string;
  userId: string;
  githubLogin: string;
  githubUserId?: number;
  createdAt: string;
  updatedAt: string;
};

export type GitHubPullRequestRef = {
  id: string;
  orgId: string;
  repoId: string;
  githubPrId: number;
  number: number;
  title: string;
  authorLogin?: string;
  state: string;
  draft: boolean;
  isFork: boolean;
  baseRef: string;
  baseSha: string;
  headRef: string;
  headSha: string;
  headRepoFullName?: string;
  htmlUrl?: string;
  status: GitHubPrStatus;
  additions?: number;
  deletions?: number;
  changedFiles?: number;
  lastSyncedAt?: string;
  createdAt: string;
  updatedAt: string;
  closedAt?: string;
};

export type GitHubPrReviewSubjectRef = {
  id: string;
  orgId: string;
  prId: string;
  githubLogin: string;
  userId?: string;
  subjectType: GitHubReviewSubjectType;
  state: GitHubReviewSubjectState;
  createdAt: string;
  updatedAt: string;
};

export type PrReviewRunRef = {
  id: string;
  orgId: string;
  prId: string;
  fusionRunId?: string;
  runnerId?: string;
  requestedByUserId?: string;
  headSha: string;
  baseSha: string;
  status: PrReviewRunStatus;
  reviewMode: PrReviewMode;
  riskLevel?: PrReviewRiskLevel;
  decision?: PrReviewDecision;
  summary?: string;
  diffObjectKey?: string;
  findingsObjectKey?: string;
  transcriptObjectKey?: string;
  error?: string;
  createdAt: string;
  startedAt?: string;
  completedAt?: string;
};

export type PrReviewCommentRef = {
  id: string;
  orgId: string;
  reviewRunId: string;
  prId: string;
  filePath: string;
  side: PrReviewSide;
  startLine?: number;
  line?: number;
  severity: PrReviewSeverity;
  category: PrReviewCategory;
  body: string;
  suggestedChange?: string;
  confidence?: number;
  evidence?: string;
  status: PrReviewCommentStatus;
  githubCommentId?: number;
  editedByUserId?: string;
  createdAt: string;
  updatedAt: string;
  publishedAt?: string;
};

export type GitHubWebhookEventRef = {
  id: string;
  orgId?: string;
  deliveryId: string;
  eventName: string;
  action?: string;
  installationId?: number;
  repoId?: string;
  prId?: string;
  payloadObjectKey?: string;
  processedAt?: string;
  error?: string;
  createdAt: string;
};

export type PrReviewFinding = {
  severity: PrReviewSeverity;
  category: PrReviewCategory;
  filePath: string;
  side: PrReviewSide;
  startLine?: number;
  line?: number;
  body: string;
  suggestedChange?: string;
  confidence?: number;
  evidence?: string;
};

export type PrReviewResult = {
  summary: string;
  riskLevel: PrReviewRiskLevel;
  decision: PrReviewDecision;
  findings: PrReviewFinding[];
  tests?: Array<{
    command: string;
    status: "not_run" | "passed" | "failed";
    outputSummary?: string;
  }>;
};

export type GitHubPrReviewQueueItem = GitHubPullRequestRef & {
  repoFullName: string;
  repoOwner: string;
  reviewSubject?: string;
  lastReviewRun?: PrReviewRunRef;
};

export type GitHubPrReviewDetail = GitHubPullRequestRef & {
  repo: GitHubRepositoryRef;
  subjects: GitHubPrReviewSubjectRef[];
  reviewRuns: PrReviewRunRef[];
  comments: PrReviewCommentRef[];
};

export type PrDiffFileStatus = "added" | "removed" | "modified" | "renamed" | "copied" | "changed" | "unchanged";

export type PrDiffFile = {
  filename: string;
  previousFilename?: string;
  status: PrDiffFileStatus;
  additions: number;
  deletions: number;
  changes: number;
  sha: string;
  patch?: string;
  blobUrl?: string;
  rawUrl?: string;
};

export type PrDiffSnapshot = {
  prId: string;
  headSha: string;
  baseSha: string;
  files: PrDiffFile[];
  fetchedAt: string;
  objectKey?: string;
};

export type PrFileContent = {
  filename: string;
  side: PrReviewSide;
  content: string;
  sha?: string;
};