import { index, integer, sqliteTable, text } from "drizzle-orm/sqlite-core";

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
    error: text("error"),
    createdAt: text("created_at").notNull(),
    startedAt: text("started_at"),
    completedAt: text("completed_at"),
  },
  (table) => [index("idx_fusion_runs_org_created").on(table.orgId, table.createdAt)],
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
