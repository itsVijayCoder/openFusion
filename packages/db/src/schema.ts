import { index, integer, real, sqliteTable, text } from "drizzle-orm/sqlite-core";

export const orgs = sqliteTable("orgs", {
  id: text("id").primaryKey(),
  name: text("name").notNull(),
  createdAt: text("created_at").notNull(),
  updatedAt: text("updated_at").notNull(),
});

export const users = sqliteTable("users", {
  id: text("id").primaryKey(),
  orgId: text("org_id").notNull(),
  email: text("email").notNull(),
  name: text("name"),
  role: text("role").notNull(),
  createdAt: text("created_at").notNull(),
  updatedAt: text("updated_at").notNull(),
});

export const authSessions = sqliteTable(
  "auth_sessions",
  {
    id: text("id").primaryKey(),
    orgId: text("org_id").notNull(),
    userId: text("user_id").notNull(),
    sessionHash: text("session_hash").notNull(),
    userAgent: text("user_agent"),
    ipHash: text("ip_hash"),
    expiresAt: text("expires_at").notNull(),
    revokedAt: text("revoked_at"),
    lastSeenAt: text("last_seen_at"),
    createdAt: text("created_at").notNull(),
    updatedAt: text("updated_at").notNull(),
  },
  (table) => [index("idx_auth_sessions_user").on(table.userId, table.revokedAt, table.expiresAt)],
);

export const authTokens = sqliteTable(
  "auth_tokens",
  {
    id: text("id").primaryKey(),
    orgId: text("org_id").notNull(),
    userId: text("user_id").notNull(),
    name: text("name").notNull(),
    tokenHash: text("token_hash").notNull(),
    kind: text("kind").notNull(),
    scopesJson: text("scopes_json").notNull(),
    expiresAt: text("expires_at"),
    revokedAt: text("revoked_at"),
    lastUsedAt: text("last_used_at"),
    createdAt: text("created_at").notNull(),
  },
  (table) => [index("idx_auth_tokens_user_kind").on(table.userId, table.kind, table.revokedAt)],
);

export const oauthAccounts = sqliteTable(
  "oauth_accounts",
  {
    id: text("id").primaryKey(),
    orgId: text("org_id").notNull(),
    userId: text("user_id").notNull(),
    provider: text("provider").notNull(),
    providerAccountId: text("provider_account_id").notNull(),
    email: text("email"),
    username: text("username"),
    avatarUrl: text("avatar_url"),
    createdAt: text("created_at").notNull(),
    updatedAt: text("updated_at").notNull(),
  },
  (table) => [index("idx_oauth_accounts_user").on(table.userId, table.provider)],
);

export const oauthStates = sqliteTable(
  "oauth_states",
  {
    id: text("id").primaryKey(),
    stateHash: text("state_hash").notNull(),
    provider: text("provider").notNull(),
    returnTo: text("return_to"),
    expiresAt: text("expires_at").notNull(),
    createdAt: text("created_at").notNull(),
  },
  (table) => [index("idx_oauth_states_expires").on(table.expiresAt)],
);

export const workspaces = sqliteTable("workspaces", {
  id: text("id").primaryKey(),
  orgId: text("org_id").notNull(),
  name: text("name").notNull(),
  repoUrl: text("repo_url"),
  defaultBranch: text("default_branch"),
  defaultRunnerPool: text("default_runner_pool"),
  permissionProfile: text("permission_profile").notNull().default("readonly"),
  createdAt: text("created_at").notNull(),
  updatedAt: text("updated_at").notNull(),
});

export const runners = sqliteTable(
  "runners",
  {
    id: text("id").primaryKey(),
    orgId: text("org_id").notNull(),
    userId: text("user_id"),
    name: text("name").notNull(),
    os: text("os").notNull(),
    arch: text("arch").notNull(),
    version: text("version").notNull(),
    status: text("status").notNull(),
    capabilitiesJson: text("capabilities_json").notNull(),
    lastSeenAt: text("last_seen_at"),
    createdAt: text("created_at").notNull(),
    updatedAt: text("updated_at").notNull(),
  },
  (table) => [index("idx_runners_org_status").on(table.orgId, table.status)],
);

export const installedTools = sqliteTable("installed_tools", {
  id: text("id").primaryKey(),
  runnerId: text("runner_id").notNull(),
  tool: text("tool").notNull(),
  version: text("version"),
  path: text("path"),
  status: text("status").notNull(),
  metadataJson: text("metadata_json"),
  detectedAt: text("detected_at").notNull(),
});

export const models = sqliteTable(
  "models",
  {
    id: text("id").primaryKey(),
    orgId: text("org_id").notNull(),
    runnerId: text("runner_id"),
    adapter: text("adapter").notNull(),
    provider: text("provider"),
    model: text("model").notNull(),
    displayName: text("display_name"),
    authMode: text("auth_mode").notNull(),
    availability: text("availability").notNull(),
    source: text("source"),
    capabilitiesJson: text("capabilities_json").notNull(),
    verifiedAt: text("verified_at"),
    createdAt: text("created_at").notNull(),
    updatedAt: text("updated_at").notNull(),
  },
  (table) => [index("idx_models_org_adapter").on(table.orgId, table.adapter)],
);

export const fusionRuns = sqliteTable(
  "fusion_runs",
  {
    id: text("id").primaryKey(),
    orgId: text("org_id").notNull(),
    workspaceId: text("workspace_id"),
    userId: text("user_id").notNull(),
    runnerId: text("runner_id"),
    status: text("status").notNull(),
    mode: text("mode").notNull(),
    preset: text("preset"),
    permissionProfile: text("permission_profile").notNull(),
    promptObjectKey: text("prompt_object_key"),
    judgeObjectKey: text("judge_object_key"),
    finalObjectKey: text("final_object_key"),
    executionPlanJson: text("execution_plan_json"),
    parentRunId: text("parent_run_id"),
    conversationId: text("conversation_id"),
    title: text("title"),
    error: text("error"),
    createdAt: text("created_at").notNull(),
    startedAt: text("started_at"),
    completedAt: text("completed_at"),
  },
  (table) => [
    index("idx_fusion_runs_org_created").on(table.orgId, table.createdAt),
    index("idx_fusion_runs_conversation").on(table.conversationId, table.createdAt),
  ],
);

export const panelOutputs = sqliteTable(
  "panel_outputs",
  {
    id: text("id").primaryKey(),
    runId: text("run_id").notNull(),
    modelId: text("model_id").notNull(),
    adapter: text("adapter").notNull(),
    status: text("status").notNull(),
    outputObjectKey: text("output_object_key"),
    error: text("error"),
    latencyMs: integer("latency_ms"),
    usageJson: text("usage_json"),
    createdAt: text("created_at").notNull(),
    completedAt: text("completed_at"),
  },
  (table) => [index("idx_panel_outputs_run").on(table.runId)],
);

export const runnerJobs = sqliteTable(
  "runner_jobs",
  {
    id: text("id").primaryKey(),
    orgId: text("org_id").notNull(),
    runId: text("run_id").notNull(),
    runnerId: text("runner_id").notNull(),
    kind: text("kind").notNull(),
    status: text("status").notNull(),
    attempt: integer("attempt").notNull().default(0),
    leaseOwner: text("lease_owner"),
    leaseExpiresAt: text("lease_expires_at"),
    inputObjectKey: text("input_object_key"),
    outputObjectKey: text("output_object_key"),
    error: text("error"),
    createdAt: text("created_at").notNull(),
    startedAt: text("started_at"),
    completedAt: text("completed_at"),
  },
  (table) => [
    index("idx_runner_jobs_runner_status").on(table.runnerId, table.status, table.createdAt),
    index("idx_runner_jobs_run").on(table.runId, table.createdAt),
  ],
);

export const runEvents = sqliteTable(
  "run_events",
  {
    id: text("id").primaryKey(),
    orgId: text("org_id").notNull(),
    runId: text("run_id").notNull(),
    seq: integer("seq").notNull(),
    type: text("type").notNull(),
    jobId: text("job_id"),
    runnerId: text("runner_id"),
    payloadJson: text("payload_json").notNull(),
    createdAt: text("created_at").notNull(),
  },
  (table) => [index("idx_run_events_run_seq").on(table.runId, table.seq)],
);

export const runnerTokens = sqliteTable(
  "runner_tokens",
  {
    id: text("id").primaryKey(),
    orgId: text("org_id").notNull(),
    runnerId: text("runner_id").notNull(),
    tokenHash: text("token_hash").notNull(),
    scopesJson: text("scopes_json").notNull(),
    createdBy: text("created_by"),
    expiresAt: text("expires_at"),
    revokedAt: text("revoked_at"),
    createdAt: text("created_at").notNull(),
  },
  (table) => [index("idx_runner_tokens_runner").on(table.runnerId, table.revokedAt)],
);

export const presets = sqliteTable(
  "presets",
  {
    id: text("id").primaryKey(),
    orgId: text("org_id").notNull(),
    name: text("name").notNull(),
    mode: text("mode").notNull(),
    analysisModelsJson: text("analysis_models_json").notNull(),
    judgeModel: text("judge_model"),
    finalModel: text("final_model"),
    providerPolicy: text("provider_policy").notNull(),
    permissionProfile: text("permission_profile").notNull(),
    timeoutMs: integer("timeout_ms"),
    createdAt: text("created_at").notNull(),
    updatedAt: text("updated_at").notNull(),
  },
  (table) => [index("idx_presets_org_name").on(table.orgId, table.name)],
);

export const artifacts = sqliteTable("artifacts", {
  id: text("id").primaryKey(),
  orgId: text("org_id").notNull(),
  runId: text("run_id").notNull(),
  kind: text("kind").notNull(),
  objectKey: text("object_key").notNull(),
  contentType: text("content_type"),
  sizeBytes: integer("size_bytes"),
  sha256: text("sha256"),
  createdAt: text("created_at").notNull(),
});

export const auditEvents = sqliteTable(
  "audit_events",
  {
    id: text("id").primaryKey(),
    orgId: text("org_id").notNull(),
    userId: text("user_id"),
    runnerId: text("runner_id"),
    runId: text("run_id"),
    eventType: text("event_type").notNull(),
    severity: text("severity").notNull().default("info"),
    metadataJson: text("metadata_json"),
    createdAt: text("created_at").notNull(),
  },
  (table) => [index("idx_audit_org_created").on(table.orgId, table.createdAt)],
);

export const githubInstallations = sqliteTable(
  "github_installations",
  {
    id: text("id").primaryKey(),
    orgId: text("org_id").notNull(),
    installationId: integer("installation_id").notNull(),
    accountLogin: text("account_login").notNull(),
    accountType: text("account_type").notNull(),
    targetType: text("target_type"),
    permissionsJson: text("permissions_json").notNull(),
    repositorySelection: text("repository_selection"),
    suspendedAt: text("suspended_at"),
    createdAt: text("created_at").notNull(),
    updatedAt: text("updated_at").notNull(),
  },
  (table) => [index("idx_github_installations_org").on(table.orgId, table.updatedAt)],
);

export const githubRepositories = sqliteTable(
  "github_repositories",
  {
    id: text("id").primaryKey(),
    orgId: text("org_id").notNull(),
    installationId: integer("installation_id").notNull(),
    githubRepoId: integer("github_repo_id").notNull(),
    owner: text("owner").notNull(),
    name: text("name").notNull(),
    fullName: text("full_name").notNull(),
    private: integer("private").notNull().default(0),
    defaultBranch: text("default_branch"),
    htmlUrl: text("html_url"),
    workspaceId: text("workspace_id"),
    defaultRunnerId: text("default_runner_id"),
    autoReviewEnabled: integer("auto_review_enabled").notNull().default(0),
    autoReviewTrigger: text("auto_review_trigger").notNull().default("review_requested"),
    autoPublishEnabled: integer("auto_publish_enabled").notNull().default(0),
    permissionProfile: text("permission_profile").notNull().default("readonly"),
    runTests: integer("run_tests").notNull().default(0),
    maxComments: integer("max_comments").notNull().default(20),
    ignoredPathsJson: text("ignored_paths_json").notNull().default("[]"),
    createdAt: text("created_at").notNull(),
    updatedAt: text("updated_at").notNull(),
  },
  (table) => [
    index("idx_github_repositories_org").on(table.orgId, table.updatedAt),
    index("idx_github_repositories_installation").on(table.installationId),
  ],
);

export const githubUserLinks = sqliteTable(
  "github_user_links",
  {
    id: text("id").primaryKey(),
    orgId: text("org_id").notNull(),
    userId: text("user_id").notNull(),
    githubLogin: text("github_login").notNull(),
    githubUserId: integer("github_user_id"),
    createdAt: text("created_at").notNull(),
    updatedAt: text("updated_at").notNull(),
  },
  (table) => [index("idx_github_user_links_org").on(table.orgId, table.githubLogin)],
);

export const githubPullRequests = sqliteTable(
  "github_pull_requests",
  {
    id: text("id").primaryKey(),
    orgId: text("org_id").notNull(),
    repoId: text("repo_id").notNull(),
    githubPrId: integer("github_pr_id").notNull(),
    number: integer("number").notNull(),
    title: text("title").notNull(),
    authorLogin: text("author_login"),
    state: text("state").notNull(),
    draft: integer("draft").notNull().default(0),
    isFork: integer("is_fork").notNull().default(0),
    baseRef: text("base_ref").notNull(),
    baseSha: text("base_sha").notNull(),
    headRef: text("head_ref").notNull(),
    headSha: text("head_sha").notNull(),
    headRepoFullName: text("head_repo_full_name"),
    htmlUrl: text("html_url"),
    status: text("status").notNull().default("not_assigned"),
    additions: integer("additions"),
    deletions: integer("deletions"),
    changedFiles: integer("changed_files"),
    lastSyncedAt: text("last_synced_at"),
    createdAt: text("created_at").notNull(),
    updatedAt: text("updated_at").notNull(),
    closedAt: text("closed_at"),
  },
  (table) => [
    index("idx_github_prs_repo_status").on(table.repoId, table.status, table.updatedAt),
    index("idx_github_prs_org_status").on(table.orgId, table.status, table.updatedAt),
  ],
);

export const githubPrReviewSubjects = sqliteTable(
  "github_pr_review_subjects",
  {
    id: text("id").primaryKey(),
    orgId: text("org_id").notNull(),
    prId: text("pr_id").notNull(),
    githubLogin: text("github_login").notNull(),
    userId: text("user_id"),
    subjectType: text("subject_type").notNull(),
    state: text("state").notNull().default("active"),
    createdAt: text("created_at").notNull(),
    updatedAt: text("updated_at").notNull(),
  },
  (table) => [index("idx_github_pr_review_subjects_pr").on(table.prId, table.state)],
);

export const prReviewRuns = sqliteTable(
  "pr_review_runs",
  {
    id: text("id").primaryKey(),
    orgId: text("org_id").notNull(),
    prId: text("pr_id").notNull(),
    fusionRunId: text("fusion_run_id"),
    runnerId: text("runner_id"),
    requestedByUserId: text("requested_by_user_id"),
    headSha: text("head_sha").notNull(),
    baseSha: text("base_sha").notNull(),
    status: text("status").notNull().default("queued"),
    reviewMode: text("review_mode").notNull().default("standard"),
    riskLevel: text("risk_level"),
    decision: text("decision"),
    summary: text("summary"),
    diffObjectKey: text("diff_object_key"),
    findingsObjectKey: text("findings_object_key"),
    transcriptObjectKey: text("transcript_object_key"),
    error: text("error"),
    createdAt: text("created_at").notNull(),
    startedAt: text("started_at"),
    completedAt: text("completed_at"),
  },
  (table) => [
    index("idx_pr_review_runs_pr_head").on(table.prId, table.headSha, table.createdAt),
    index("idx_pr_review_runs_org_status").on(table.orgId, table.status, table.createdAt),
  ],
);

export const prReviewComments = sqliteTable(
  "pr_review_comments",
  {
    id: text("id").primaryKey(),
    orgId: text("org_id").notNull(),
    reviewRunId: text("review_run_id").notNull(),
    prId: text("pr_id").notNull(),
    filePath: text("file_path").notNull(),
    side: text("side").notNull(),
    startLine: integer("start_line"),
    line: integer("line"),
    severity: text("severity").notNull(),
    category: text("category").notNull(),
    body: text("body").notNull(),
    suggestedChange: text("suggested_change"),
    confidence: real("confidence"),
    evidence: text("evidence"),
    status: text("status").notNull().default("draft"),
    githubCommentId: integer("github_comment_id"),
    editedByUserId: text("edited_by_user_id"),
    createdAt: text("created_at").notNull(),
    updatedAt: text("updated_at").notNull(),
    publishedAt: text("published_at"),
  },
  (table) => [
    index("idx_pr_review_comments_run_status").on(table.reviewRunId, table.status),
    index("idx_pr_review_comments_pr").on(table.prId, table.status),
  ],
);

export const githubWebhookEvents = sqliteTable(
  "github_webhook_events",
  {
    id: text("id").primaryKey(),
    orgId: text("org_id"),
    deliveryId: text("delivery_id").notNull(),
    eventName: text("event_name").notNull(),
    action: text("action"),
    installationId: integer("installation_id"),
    repoId: text("repo_id"),
    prId: text("pr_id"),
    payloadObjectKey: text("payload_object_key"),
    processedAt: text("processed_at"),
    error: text("error"),
    createdAt: text("created_at").notNull(),
  },
  (table) => [
    index("idx_github_webhook_events_delivery").on(table.deliveryId),
    index("idx_github_webhook_events_org").on(table.orgId, table.createdAt),
  ],
);
