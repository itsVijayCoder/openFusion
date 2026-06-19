import type {
  AdapterId,
  ArtifactKind,
  ArtifactRef,
  AuditEventRef,
  AuditSeverity,
  AuthMode,
  DashboardSnapshot,
  FusionMode,
  FusionExecutionPlan,
  FusionRunDetail,
  FusionRunSummary,
  ModelAvailability,
  ModelRef,
  ModelSource,
  PanelOutputRef,
  PanelOutputStatus,
  PermissionProfile,
  RunEvent,
  RunnerRef,
  RunnerRegistrationRequest,
  RunnerJob,
  RunnerJobKind,
  RunnerJobStatus,
  RunnerStatus,
  ToolKind,
  ToolRef,
  ToolStatus,
  UserRole,
  WorkspaceRef,
} from "@fusion-harness/shared";
import type { D1DatabaseLike } from "./client";

type Nullable<T> = T | null | undefined;

type PrincipalInput = {
  orgId: string;
  orgName: string;
  userId: string;
  email: string;
  name?: string;
  role?: UserRole;
  now: string;
};

export type CreateFusionRunInput = {
  id: string;
  orgId: string;
  userId: string;
  workspaceId?: string;
  runnerId?: string;
  mode: FusionMode;
  preset?: string;
  permissionProfile: PermissionProfile;
  promptObjectKey?: string;
  executionPlan?: FusionExecutionPlan;
  parentRunId?: string;
  conversationId?: string;
  status?: FusionRunSummary["status"];
  createdAt: string;
};

export type RunnerRegistrationInput = RunnerRegistrationRequest & {
  orgId: string;
  userId?: string;
  runnerId: string;
  now: string;
};

export type CreateArtifactInput = {
  id: string;
  orgId: string;
  runId: string;
  kind: ArtifactKind;
  objectKey: string;
  contentType?: string;
  sizeBytes?: number;
  sha256?: string;
  createdAt: string;
};

export type CreateRunnerJobInput = {
  id: string;
  orgId: string;
  runId: string;
  runnerId: string;
  kind: RunnerJobKind;
  inputObjectKey?: string;
  createdAt: string;
};

export type CreatePanelOutputInput = {
  id: string;
  runId: string;
  modelId: string;
  adapter: AdapterId;
  status?: PanelOutputStatus;
  createdAt: string;
};

export type EnsureModelInput = {
  id: string;
  orgId: string;
  runnerId?: string;
  adapter: AdapterId;
  provider?: string;
  model: string;
  displayName?: string;
  authMode: AuthMode;
  availability?: ModelAvailability;
  source?: ModelSource;
  capabilities: ModelRef["capabilities"];
  now: string;
};

export type UpdatePanelOutputInput = {
  id: string;
  status: PanelOutputStatus;
  outputObjectKey?: string;
  error?: string;
  latencyMs?: number;
  usage?: Record<string, unknown>;
  completedAt?: string;
};

export type MarkRunnerJobLeasedInput = {
  orgId: string;
  runnerId: string;
  jobId: string;
  attempt: number;
  leaseOwner: string;
  leaseExpiresAt: string;
  now: string;
};

export type CompleteRunnerJobInput = {
  orgId: string;
  runnerId: string;
  jobId: string;
  status: Extract<RunnerJobStatus, "completed" | "failed" | "timeout" | "cancelled">;
  outputObjectKey?: string;
  error?: string;
  completedAt: string;
};

export type CreateRunEventInput = {
  id: string;
  orgId: string;
  runId: string;
  seq: number;
  type: RunEvent["type"];
  jobId?: string;
  runnerId?: string;
  payload: RunEvent;
  createdAt: string;
};

export type CreateAuditEventInput = {
  id: string;
  orgId: string;
  userId?: string;
  runnerId?: string;
  runId?: string;
  eventType: string;
  severity?: AuditSeverity;
  metadata?: Record<string, unknown>;
  createdAt: string;
};

type FusionRunRow = {
  id: string;
  org_id: string;
  workspace_id: string | null;
  user_id: string;
  runner_id: string | null;
  status: FusionRunSummary["status"];
  mode: FusionMode;
  preset: string | null;
  permission_profile: PermissionProfile;
  prompt_object_key: string | null;
  judge_object_key: string | null;
  final_object_key: string | null;
  execution_plan_json: string | null;
  parent_run_id: string | null;
  conversation_id: string | null;
  error: string | null;
  created_at: string;
  started_at: string | null;
  completed_at: string | null;
};

type RunnerRow = {
  id: string;
  org_id: string;
  user_id: string | null;
  name: string;
  os: string;
  arch: string;
  version: string;
  status: RunnerStatus;
  capabilities_json: string;
  last_seen_at: string | null;
  created_at: string;
  updated_at: string;
};

type ToolRow = {
  id: string;
  runner_id: string;
  tool: ToolKind;
  version: string | null;
  path: string | null;
  status: ToolStatus;
  metadata_json: string | null;
  detected_at: string;
};

type ModelRow = {
  id: string;
  org_id: string;
  runner_id: string | null;
  adapter: AdapterId;
  provider: string | null;
  model: string;
  display_name: string | null;
  auth_mode: AuthMode;
  availability: ModelAvailability;
  source: ModelSource | null;
  capabilities_json: string;
  verified_at: string | null;
  created_at: string;
  updated_at: string;
};

type WorkspaceRow = {
  id: string;
  org_id: string;
  name: string;
  repo_url: string | null;
  default_branch: string | null;
  default_runner_pool: string | null;
  permission_profile: PermissionProfile;
  created_at: string;
  updated_at: string;
};

type PanelOutputRow = {
  id: string;
  run_id: string;
  model_id: string;
  adapter: AdapterId;
  status: PanelOutputStatus;
  output_object_key: string | null;
  error: string | null;
  latency_ms: number | null;
  usage_json: string | null;
  created_at: string;
  completed_at: string | null;
};

type RunnerJobRow = {
  id: string;
  org_id: string;
  run_id: string;
  runner_id: string;
  kind: RunnerJobKind;
  status: RunnerJobStatus;
  attempt: number;
  lease_owner: string | null;
  lease_expires_at: string | null;
  input_object_key: string | null;
  output_object_key: string | null;
  error: string | null;
  created_at: string;
  started_at: string | null;
  completed_at: string | null;
};

type RunEventRow = {
  id: string;
  org_id: string;
  run_id: string;
  seq: number;
  type: RunEvent["type"];
  job_id: string | null;
  runner_id: string | null;
  payload_json: string;
  created_at: string;
};

type ArtifactRow = {
  id: string;
  org_id: string;
  run_id: string;
  kind: ArtifactKind;
  object_key: string;
  content_type: string | null;
  size_bytes: number | null;
  sha256: string | null;
  created_at: string;
};

type AuditEventRow = {
  id: string;
  org_id: string;
  user_id: string | null;
  runner_id: string | null;
  run_id: string | null;
  event_type: string;
  severity: AuditSeverity;
  metadata_json: string | null;
  created_at: string;
};

export async function ensurePrincipal(db: D1DatabaseLike, input: PrincipalInput) {
  await db
    .prepare(
      `INSERT INTO orgs (id, name, created_at, updated_at)
       VALUES (?, ?, ?, ?)
       ON CONFLICT(id) DO UPDATE SET name = excluded.name, updated_at = excluded.updated_at`,
    )
    .bind(input.orgId, input.orgName, input.now, input.now)
    .run();

  await db
    .prepare(
      `INSERT INTO users (id, org_id, email, name, role, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT(id) DO UPDATE SET
         email = excluded.email,
         name = excluded.name,
         role = excluded.role,
         updated_at = excluded.updated_at`,
    )
    .bind(input.userId, input.orgId, input.email, input.name ?? null, input.role ?? "developer", input.now, input.now)
    .run();
}

export async function listFusionRuns(db: D1DatabaseLike, orgId: string, limit = 25) {
  const { results } = await db
    .prepare(
      `SELECT * FROM fusion_runs
       WHERE org_id = ?
       ORDER BY created_at DESC
       LIMIT ?`,
    )
    .bind(orgId, limit)
    .all<FusionRunRow>();

  return results.map(mapFusionRun);
}

export async function getFusionRun(db: D1DatabaseLike, orgId: string, runId: string) {
  const row = await db.prepare("SELECT * FROM fusion_runs WHERE org_id = ? AND id = ?").bind(orgId, runId).first<FusionRunRow>();
  return row ? mapFusionRun(row) : null;
}

export async function getFusionRunDetail(db: D1DatabaseLike, orgId: string, runId: string): Promise<FusionRunDetail | null> {
  const run = await getFusionRun(db, orgId, runId);
  if (!run) return null;

  const [panelOutputs, artifacts, auditEvents] = await Promise.all([
    listPanelOutputs(db, runId),
    listArtifactsByRun(db, orgId, runId),
    listAuditEvents(db, orgId, { runId, limit: 50 }),
  ]);

  return {
    ...run,
    panelOutputs,
    artifacts,
    auditEvents,
  };
}

export async function listRunsByConversation(db: D1DatabaseLike, orgId: string, conversationId: string): Promise<FusionRunSummary[]> {
  const { results } = await db
    .prepare(
      `SELECT * FROM fusion_runs
       WHERE org_id = ? AND conversation_id = ?
       ORDER BY created_at ASC`,
    )
    .bind(orgId, conversationId)
    .all<FusionRunRow>();

  return results.map(mapFusionRun);
}

export async function createFusionRun(db: D1DatabaseLike, input: CreateFusionRunInput) {
  return db
    .prepare(
      `INSERT INTO fusion_runs (
         id, org_id, workspace_id, user_id, runner_id, status, mode, preset,
         permission_profile, prompt_object_key, execution_plan_json,
         parent_run_id, conversation_id, created_at
       )
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    )
    .bind(
      input.id,
      input.orgId,
      input.workspaceId ?? null,
      input.userId,
      input.runnerId ?? null,
      input.status ?? "queued",
      input.mode,
      input.preset ?? null,
      input.permissionProfile,
      input.promptObjectKey ?? null,
      input.executionPlan ? JSON.stringify(input.executionPlan) : null,
      input.parentRunId ?? null,
      input.conversationId ?? null,
      input.createdAt,
    )
    .run();
}

export async function updateFusionRunPlan(db: D1DatabaseLike, orgId: string, runId: string, plan: FusionExecutionPlan) {
  return db
    .prepare("UPDATE fusion_runs SET execution_plan_json = ? WHERE org_id = ? AND id = ?")
    .bind(JSON.stringify(plan), orgId, runId)
    .run();
}

export async function updateFusionRunStatus(
  db: D1DatabaseLike,
  orgId: string,
  runId: string,
  status: FusionRunSummary["status"],
  now: string,
  error?: string,
) {
  const startedAt = status === "running" ? now : null;
  const completedAt = ["completed", "failed", "cancelled"].includes(status) ? now : null;

  return db
    .prepare(
      `UPDATE fusion_runs
       SET status = ?,
           started_at = COALESCE(started_at, ?),
           completed_at = COALESCE(?, completed_at),
           error = COALESCE(?, error)
       WHERE org_id = ? AND id = ?`,
    )
    .bind(status, startedAt, completedAt, error ?? null, orgId, runId)
    .run();
}

export async function registerRunner(db: D1DatabaseLike, input: RunnerRegistrationInput): Promise<RunnerRef> {
  await db
    .prepare(
      `INSERT INTO runners (
         id, org_id, user_id, name, os, arch, version, status,
         capabilities_json, last_seen_at, created_at, updated_at
       )
       VALUES (?, ?, ?, ?, ?, ?, ?, 'online', ?, ?, ?, ?)
       ON CONFLICT(id) DO UPDATE SET
         user_id = excluded.user_id,
         name = excluded.name,
         os = excluded.os,
         arch = excluded.arch,
         version = excluded.version,
         status = 'online',
         capabilities_json = excluded.capabilities_json,
         last_seen_at = excluded.last_seen_at,
         updated_at = excluded.updated_at`,
    )
    .bind(
      input.runnerId,
      input.orgId,
      input.userId ?? null,
      input.name,
      input.os,
      input.arch,
      input.version,
      JSON.stringify(input.capabilities),
      input.now,
      input.now,
      input.now,
    )
    .run();

  await replaceRunnerTools(db, input.runnerId, input.tools, input.now);
  await replaceRunnerModels(db, input);

  const runner = await getRunner(db, input.orgId, input.runnerId);
  if (!runner) {
    throw new Error("Runner registration did not produce a readable runner");
  }

  return runner;
}

export async function heartbeatRunner(db: D1DatabaseLike, orgId: string, runnerId: string, now: string) {
  await db
    .prepare("UPDATE runners SET status = 'online', last_seen_at = ?, updated_at = ? WHERE org_id = ? AND id = ?")
    .bind(now, now, orgId, runnerId)
    .run();

  return getRunner(db, orgId, runnerId);
}

export async function listRunners(db: D1DatabaseLike, orgId: string): Promise<RunnerRef[]> {
  const [{ results: runnerRows }, { results: toolRows }] = await Promise.all([
    db.prepare("SELECT * FROM runners WHERE org_id = ? ORDER BY last_seen_at DESC, created_at DESC").bind(orgId).all<RunnerRow>(),
    db
      .prepare(
        `SELECT installed_tools.*
         FROM installed_tools
         INNER JOIN runners ON runners.id = installed_tools.runner_id
         WHERE runners.org_id = ?
         ORDER BY installed_tools.detected_at DESC`,
      )
      .bind(orgId)
      .all<ToolRow>(),
  ]);

  const toolsByRunner = groupBy(toolRows, (row) => row.runner_id);
  return runnerRows.map((row) => mapRunner(row, toolsByRunner.get(row.id) ?? []));
}

export async function getRunner(db: D1DatabaseLike, orgId: string, runnerId: string): Promise<RunnerRef | null> {
  const row = await db.prepare("SELECT * FROM runners WHERE org_id = ? AND id = ?").bind(orgId, runnerId).first<RunnerRow>();
  if (!row) return null;

  const { results } = await db
    .prepare("SELECT * FROM installed_tools WHERE runner_id = ? ORDER BY detected_at DESC")
    .bind(runnerId)
    .all<ToolRow>();

  return mapRunner(row, results);
}

export async function createRunnerJob(db: D1DatabaseLike, input: CreateRunnerJobInput): Promise<RunnerJob> {
  await db
    .prepare(
      `INSERT OR IGNORE INTO runner_jobs (
         id, org_id, run_id, runner_id, kind, status, attempt, input_object_key, created_at
       )
       VALUES (?, ?, ?, ?, ?, 'queued', 0, ?, ?)`,
    )
    .bind(input.id, input.orgId, input.runId, input.runnerId, input.kind, input.inputObjectKey ?? null, input.createdAt)
    .run();

  const job = await getRunnerJob(db, input.orgId, input.runnerId, input.id);
  if (!job) {
    throw new Error("Runner job insert did not produce a readable job");
  }
  return job;
}

export async function createPanelOutput(db: D1DatabaseLike, input: CreatePanelOutputInput): Promise<PanelOutputRef> {
  await db
    .prepare(
      `INSERT INTO panel_outputs (
         id, run_id, model_id, adapter, status, created_at
       )
       VALUES (?, ?, ?, ?, ?, ?)`,
    )
    .bind(input.id, input.runId, input.modelId, input.adapter, input.status ?? "queued", input.createdAt)
    .run();

  const panelOutput = await getPanelOutput(db, input.id);
  if (!panelOutput) {
    throw new Error("Panel output insert did not produce a readable row");
  }
  return panelOutput;
}

export async function updatePanelOutput(db: D1DatabaseLike, input: UpdatePanelOutputInput): Promise<PanelOutputRef | null> {
  await db
    .prepare(
      `UPDATE panel_outputs
       SET status = ?,
           output_object_key = COALESCE(?, output_object_key),
           error = COALESCE(?, error),
           latency_ms = COALESCE(?, latency_ms),
           usage_json = COALESCE(?, usage_json),
           completed_at = COALESCE(?, completed_at)
       WHERE id = ?`,
    )
    .bind(
      input.status,
      input.outputObjectKey ?? null,
      input.error ?? null,
      input.latencyMs ?? null,
      input.usage ? JSON.stringify(input.usage) : null,
      input.completedAt ?? null,
      input.id,
    )
    .run();

  return getPanelOutput(db, input.id);
}

export async function getRunnerJob(
  db: D1DatabaseLike,
  orgId: string,
  runnerId: string,
  jobId: string,
): Promise<RunnerJob | null> {
  const row = await db
    .prepare("SELECT * FROM runner_jobs WHERE org_id = ? AND runner_id = ? AND id = ?")
    .bind(orgId, runnerId, jobId)
    .first<RunnerJobRow>();
  return row ? mapRunnerJob(row) : null;
}

export async function listRunnerJobsByRun(db: D1DatabaseLike, orgId: string, runId: string): Promise<RunnerJob[]> {
  const { results } = await db
    .prepare("SELECT * FROM runner_jobs WHERE org_id = ? AND run_id = ? ORDER BY created_at ASC")
    .bind(orgId, runId)
    .all<RunnerJobRow>();

  return results.map(mapRunnerJob);
}

export async function markRunnerJobLeased(db: D1DatabaseLike, input: MarkRunnerJobLeasedInput): Promise<RunnerJob | null> {
  await db
    .prepare(
      `UPDATE runner_jobs
       SET status = 'leased',
           attempt = ?,
           lease_owner = ?,
           lease_expires_at = ?,
           started_at = COALESCE(started_at, ?)
       WHERE org_id = ? AND runner_id = ? AND id = ? AND status IN ('queued', 'leased')`,
    )
    .bind(input.attempt, input.leaseOwner, input.leaseExpiresAt, input.now, input.orgId, input.runnerId, input.jobId)
    .run();

  return getRunnerJob(db, input.orgId, input.runnerId, input.jobId);
}

export async function completeRunnerJob(db: D1DatabaseLike, input: CompleteRunnerJobInput): Promise<RunnerJob | null> {
  await db
    .prepare(
      `UPDATE runner_jobs
       SET status = ?,
           output_object_key = COALESCE(?, output_object_key),
           error = COALESCE(?, error),
           completed_at = ?
       WHERE org_id = ? AND runner_id = ? AND id = ?`,
    )
    .bind(
      input.status,
      input.outputObjectKey ?? null,
      input.error ?? null,
      input.completedAt,
      input.orgId,
      input.runnerId,
      input.jobId,
    )
    .run();

  return getRunnerJob(db, input.orgId, input.runnerId, input.jobId);
}

export async function createRunEvent(db: D1DatabaseLike, input: CreateRunEventInput): Promise<RunEvent> {
  await db
    .prepare(
      `INSERT OR IGNORE INTO run_events (
         id, org_id, run_id, seq, type, job_id, runner_id, payload_json, created_at
       )
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    )
    .bind(
      input.id,
      input.orgId,
      input.runId,
      input.seq,
      input.type,
      input.jobId ?? null,
      input.runnerId ?? null,
      JSON.stringify(input.payload),
      input.createdAt,
    )
    .run();

  return input.payload;
}

export async function listRunEvents(
  db: D1DatabaseLike,
  orgId: string,
  runId: string,
  options: { afterSeq?: number; limit?: number } = {},
): Promise<RunEvent[]> {
  const { results } = await db
    .prepare(
      `SELECT * FROM run_events
       WHERE org_id = ? AND run_id = ? AND seq > ?
       ORDER BY seq ASC
       LIMIT ?`,
    )
    .bind(orgId, runId, options.afterSeq ?? 0, options.limit ?? 500)
    .all<RunEventRow>();

  return results.map(mapRunEvent);
}

export async function listModels(db: D1DatabaseLike, orgId: string): Promise<ModelRef[]> {
  const { results } = await db
    .prepare("SELECT * FROM models WHERE org_id = ? ORDER BY availability DESC, adapter ASC, model ASC")
    .bind(orgId)
    .all<ModelRow>();

  return results.map(mapModel).filter(isUserVisibleModel);
}

export async function ensureModel(db: D1DatabaseLike, input: EnsureModelInput): Promise<ModelRef> {
  await db
    .prepare(
      `INSERT INTO models (
         id, org_id, runner_id, adapter, provider, model, display_name, auth_mode,
         availability, source, capabilities_json, verified_at, created_at, updated_at
       )
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT(id) DO UPDATE SET
         runner_id = COALESCE(excluded.runner_id, models.runner_id),
         adapter = excluded.adapter,
         provider = excluded.provider,
         model = excluded.model,
         display_name = excluded.display_name,
         auth_mode = excluded.auth_mode,
         availability = excluded.availability,
         source = excluded.source,
         capabilities_json = excluded.capabilities_json,
         updated_at = excluded.updated_at`,
    )
    .bind(
      input.id,
      input.orgId,
      input.runnerId ?? null,
      input.adapter,
      input.provider ?? null,
      input.model,
      input.displayName ?? input.model,
      input.authMode,
      input.availability ?? "configured_unverified",
      input.source ?? "custom",
      JSON.stringify(input.capabilities),
      input.availability === "verified" ? input.now : null,
      input.now,
      input.now,
    )
    .run();

  const model = await db.prepare("SELECT * FROM models WHERE org_id = ? AND id = ?").bind(input.orgId, input.id).first<ModelRow>();
  if (!model) {
    throw new Error("Model upsert did not produce a readable row");
  }
  return mapModel(model);
}

export async function listWorkspaces(db: D1DatabaseLike, orgId: string): Promise<WorkspaceRef[]> {
  const { results } = await db
    .prepare("SELECT * FROM workspaces WHERE org_id = ? ORDER BY updated_at DESC, name ASC")
    .bind(orgId)
    .all<WorkspaceRow>();

  return results.map(mapWorkspace);
}

export async function createArtifact(db: D1DatabaseLike, input: CreateArtifactInput): Promise<ArtifactRef> {
  await db
    .prepare(
      `INSERT INTO artifacts (id, org_id, run_id, kind, object_key, content_type, size_bytes, sha256, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    )
    .bind(
      input.id,
      input.orgId,
      input.runId,
      input.kind,
      input.objectKey,
      input.contentType ?? null,
      input.sizeBytes ?? null,
      input.sha256 ?? null,
      input.createdAt,
    )
    .run();

  const artifact = await getArtifact(db, input.orgId, input.id);
  if (!artifact) {
    throw new Error("Artifact insert did not produce a readable artifact");
  }
  return artifact;
}

export async function getArtifact(db: D1DatabaseLike, orgId: string, artifactId: string): Promise<ArtifactRef | null> {
  const row = await db.prepare("SELECT * FROM artifacts WHERE org_id = ? AND id = ?").bind(orgId, artifactId).first<ArtifactRow>();
  return row ? mapArtifact(row) : null;
}

export async function listArtifactsByRun(db: D1DatabaseLike, orgId: string, runId: string): Promise<ArtifactRef[]> {
  const { results } = await db
    .prepare("SELECT * FROM artifacts WHERE org_id = ? AND run_id = ? ORDER BY created_at DESC")
    .bind(orgId, runId)
    .all<ArtifactRow>();

  return results.map(mapArtifact);
}

export async function createAuditEvent(db: D1DatabaseLike, input: CreateAuditEventInput): Promise<AuditEventRef> {
  await db
    .prepare(
      `INSERT INTO audit_events (id, org_id, user_id, runner_id, run_id, event_type, severity, metadata_json, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    )
    .bind(
      input.id,
      input.orgId,
      input.userId ?? null,
      input.runnerId ?? null,
      input.runId ?? null,
      input.eventType,
      input.severity ?? "info",
      input.metadata ? JSON.stringify(input.metadata) : null,
      input.createdAt,
    )
    .run();

  return {
    id: input.id,
    orgId: input.orgId,
    userId: input.userId,
    runnerId: input.runnerId,
    runId: input.runId,
    eventType: input.eventType,
    severity: input.severity ?? "info",
    metadata: input.metadata,
    createdAt: input.createdAt,
  };
}

export async function listAuditEvents(
  db: D1DatabaseLike,
  orgId: string,
  options: { runId?: string; limit?: number } = {},
): Promise<AuditEventRef[]> {
  if (options.runId) {
    const { results } = await db
      .prepare(
        `SELECT * FROM audit_events
         WHERE org_id = ? AND run_id = ?
         ORDER BY created_at DESC
         LIMIT ?`,
      )
      .bind(orgId, options.runId, options.limit ?? 50)
      .all<AuditEventRow>();
    return results.map(mapAuditEvent);
  }

  const { results } = await db
    .prepare(
      `SELECT * FROM audit_events
       WHERE org_id = ?
       ORDER BY created_at DESC
       LIMIT ?`,
    )
    .bind(orgId, options.limit ?? 50)
    .all<AuditEventRow>();

  return results.map(mapAuditEvent);
}

export async function getDashboardSnapshot(db: D1DatabaseLike, orgId: string): Promise<DashboardSnapshot> {
  const [recentRuns, runStatusCounts, runners, models, artifactStats, recentAuditEvents] = await Promise.all([
    listFusionRuns(db, orgId, 10),
    countRunsByStatus(db, orgId),
    listRunners(db, orgId),
    listModels(db, orgId),
    db
      .prepare("SELECT COUNT(*) as total, COALESCE(SUM(size_bytes), 0) as total_bytes FROM artifacts WHERE org_id = ?")
      .bind(orgId)
      .first<{ total: number; total_bytes: number }>(),
    listAuditEvents(db, orgId, { limit: 10 }),
  ]);

  return {
    runs: {
      total: sumCounts(runStatusCounts),
      queued: runStatusCounts.queued ?? 0,
      running: runStatusCounts.running ?? 0,
      waitingApproval: runStatusCounts.waiting_approval ?? 0,
      completed: runStatusCounts.completed ?? 0,
      failed: runStatusCounts.failed ?? 0,
      cancelled: runStatusCounts.cancelled ?? 0,
    },
    runners: {
      total: runners.length,
      online: runners.filter((runner) => runner.status === "online").length,
      offline: runners.filter((runner) => runner.status === "offline").length,
      disabled: runners.filter((runner) => runner.status === "disabled").length,
    },
    models: {
      total: models.length,
      verified: models.filter((model) => model.availability === "verified").length,
      cliSession: models.filter((model) => model.authMode === "cli_session").length,
      cloudGateway: models.filter((model) => model.authMode === "cloud_gateway").length,
    },
    artifacts: {
      total: artifactStats?.total ?? 0,
      totalBytes: artifactStats?.total_bytes ?? 0,
    },
    recentRuns,
    recentAuditEvents,
  };
}

async function countRunsByStatus(db: D1DatabaseLike, orgId: string) {
  const { results } = await db
    .prepare("SELECT status, COUNT(*) as total FROM fusion_runs WHERE org_id = ? GROUP BY status")
    .bind(orgId)
    .all<{ status: FusionRunSummary["status"]; total: number }>();

  return Object.fromEntries(results.map((row) => [row.status, row.total])) as Partial<Record<FusionRunSummary["status"], number>>;
}

async function listPanelOutputs(db: D1DatabaseLike, runId: string): Promise<PanelOutputRef[]> {
  const { results } = await db
    .prepare("SELECT * FROM panel_outputs WHERE run_id = ? ORDER BY created_at ASC")
    .bind(runId)
    .all<PanelOutputRow>();

  return results.map(mapPanelOutput);
}

async function getPanelOutput(db: D1DatabaseLike, id: string): Promise<PanelOutputRef | null> {
  const row = await db.prepare("SELECT * FROM panel_outputs WHERE id = ?").bind(id).first<PanelOutputRow>();
  return row ? mapPanelOutput(row) : null;
}

async function replaceRunnerTools(db: D1DatabaseLike, runnerId: string, tools: ToolRef[], now: string) {
  await db.prepare("DELETE FROM installed_tools WHERE runner_id = ?").bind(runnerId).run();

  for (const [index, tool] of tools.entries()) {
    await db
      .prepare(
        `INSERT INTO installed_tools (id, runner_id, tool, version, path, status, metadata_json, detected_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .bind(
        tool.id ?? `tool_${runnerId}_${tool.tool}_${index}`,
        runnerId,
        tool.tool,
        tool.version ?? null,
        tool.path ?? null,
        tool.status,
        tool.metadata ? JSON.stringify(tool.metadata) : null,
        tool.detectedAt ?? now,
      )
      .run();
  }
}

async function replaceRunnerModels(db: D1DatabaseLike, input: RunnerRegistrationInput) {
  await db
    .prepare(
      `DELETE FROM models
       WHERE runner_id = ?
         AND id NOT IN (SELECT model_id FROM panel_outputs)`,
    )
    .bind(input.runnerId)
    .run();

  for (const model of input.models ?? []) {
    if (!isUserVisibleModel(model)) {
      continue;
    }

    await db
      .prepare(
        `INSERT INTO models (
           id, org_id, runner_id, adapter, provider, model, display_name, auth_mode,
           availability, source, capabilities_json, verified_at, created_at, updated_at
         )
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
         ON CONFLICT(id) DO UPDATE SET
           runner_id = excluded.runner_id,
           adapter = excluded.adapter,
           provider = excluded.provider,
           model = excluded.model,
           display_name = excluded.display_name,
           auth_mode = excluded.auth_mode,
           availability = excluded.availability,
           source = excluded.source,
           capabilities_json = excluded.capabilities_json,
           verified_at = excluded.verified_at,
           updated_at = excluded.updated_at`,
      )
      .bind(
        model.id,
        input.orgId,
        input.runnerId,
        model.adapter,
        model.provider ?? null,
        model.model,
        model.displayName ?? null,
        model.authMode,
        model.availability,
        model.source ?? null,
        JSON.stringify(model.capabilities),
        model.availability === "verified" ? input.now : null,
        input.now,
        input.now,
      )
      .run();
  }
}

function isUserVisibleModel(model: Pick<ModelRef, "model" | "source">) {
  if (model.model === "default") return true;
  return model.source !== "custom" && model.source !== "suggested" && model.source !== "fallback";
}

function mapFusionRun(row: FusionRunRow): FusionRunSummary {
  return {
    id: row.id,
    orgId: row.org_id,
    workspaceId: optional(row.workspace_id),
    userId: row.user_id,
    runnerId: optional(row.runner_id),
    status: row.status,
    mode: row.mode,
    preset: optional(row.preset),
    permissionProfile: row.permission_profile,
    promptObjectKey: optional(row.prompt_object_key),
    judgeObjectKey: optional(row.judge_object_key),
    finalObjectKey: optional(row.final_object_key),
    executionPlan: parseJson<FusionExecutionPlan | undefined>(row.execution_plan_json, undefined),
    parentRunId: optional(row.parent_run_id),
    conversationId: optional(row.conversation_id),
    error: optional(row.error),
    createdAt: row.created_at,
    startedAt: optional(row.started_at),
    completedAt: optional(row.completed_at),
  };
}

function mapRunnerJob(row: RunnerJobRow): RunnerJob {
  return {
    id: row.id,
    orgId: row.org_id,
    runId: row.run_id,
    runnerId: row.runner_id,
    kind: row.kind,
    status: row.status,
    attempt: row.attempt,
    leaseOwner: optional(row.lease_owner),
    leaseExpiresAt: optional(row.lease_expires_at),
    inputObjectKey: optional(row.input_object_key),
    outputObjectKey: optional(row.output_object_key),
    error: optional(row.error),
    createdAt: row.created_at,
    startedAt: optional(row.started_at),
    completedAt: optional(row.completed_at),
  };
}

function mapRunEvent(row: RunEventRow): RunEvent {
  const payload = parseJson<RunEvent | undefined>(row.payload_json, undefined);
  return {
    type: payload?.type ?? row.type,
    runId: payload?.runId ?? row.run_id,
    seq: row.seq,
    jobId: payload?.jobId ?? optional(row.job_id),
    runnerId: payload?.runnerId ?? optional(row.runner_id),
    timestamp: payload?.timestamp ?? row.created_at,
    data: payload?.data ?? {},
  };
}

function mapRunner(row: RunnerRow, tools: ToolRow[]): RunnerRef {
  return {
    id: row.id,
    orgId: row.org_id,
    userId: optional(row.user_id),
    name: row.name,
    os: row.os,
    arch: row.arch,
    version: row.version,
    status: row.status,
    capabilities: parseJson<RunnerRef["capabilities"]>(row.capabilities_json, {
      adapters: [],
      executors: [],
      workspaceWrite: false,
      shell: false,
      docker: false,
    }),
    tools: tools.map(mapTool),
    lastSeenAt: optional(row.last_seen_at),
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function mapTool(row: ToolRow): ToolRef {
  return {
    id: row.id,
    tool: row.tool,
    version: optional(row.version),
    path: optional(row.path),
    status: row.status,
    metadata: parseJson<Record<string, unknown> | undefined>(row.metadata_json, undefined),
    detectedAt: row.detected_at,
  };
}

function mapModel(row: ModelRow): ModelRef {
  return {
    id: row.id,
    runnerId: optional(row.runner_id),
    adapter: row.adapter,
    provider: optional(row.provider),
    model: row.model,
    displayName: optional(row.display_name),
    authMode: row.auth_mode,
    availability: row.availability,
    source: optional(row.source),
    capabilities: parseJson<ModelRef["capabilities"]>(row.capabilities_json, {
      streaming: false,
      tools: false,
      fileEdits: false,
      shell: false,
      jsonOutput: false,
      modelListing: false,
    }),
  };
}

function mapWorkspace(row: WorkspaceRow): WorkspaceRef {
  return {
    id: row.id,
    orgId: row.org_id,
    name: row.name,
    repoUrl: optional(row.repo_url),
    defaultBranch: optional(row.default_branch),
    defaultRunnerPool: optional(row.default_runner_pool),
    permissionProfile: row.permission_profile,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function mapPanelOutput(row: PanelOutputRow): PanelOutputRef {
  return {
    id: row.id,
    runId: row.run_id,
    modelId: row.model_id,
    adapter: row.adapter,
    status: row.status,
    outputObjectKey: optional(row.output_object_key),
    error: optional(row.error),
    latencyMs: row.latency_ms ?? undefined,
    usage: parseJson<Record<string, unknown> | undefined>(row.usage_json, undefined),
    createdAt: row.created_at,
    completedAt: optional(row.completed_at),
  };
}

function mapArtifact(row: ArtifactRow): ArtifactRef {
  return {
    id: row.id,
    orgId: row.org_id,
    runId: row.run_id,
    kind: row.kind,
    objectKey: row.object_key,
    contentType: optional(row.content_type),
    sizeBytes: row.size_bytes ?? undefined,
    sha256: optional(row.sha256),
    createdAt: row.created_at,
  };
}

function mapAuditEvent(row: AuditEventRow): AuditEventRef {
  return {
    id: row.id,
    orgId: row.org_id,
    userId: optional(row.user_id),
    runnerId: optional(row.runner_id),
    runId: optional(row.run_id),
    eventType: row.event_type,
    severity: row.severity,
    metadata: parseJson<Record<string, unknown> | undefined>(row.metadata_json, undefined),
    createdAt: row.created_at,
  };
}

function parseJson<T>(value: Nullable<string>, fallback: T): T {
  if (!value) return fallback;

  try {
    return JSON.parse(value) as T;
  } catch {
    return fallback;
  }
}

function optional<T extends string>(value: Nullable<T>) {
  return value ?? undefined;
}

function groupBy<T, K>(items: T[], keyFn: (item: T) => K) {
  const groups = new Map<K, T[]>();
  for (const item of items) {
    const key = keyFn(item);
    groups.set(key, [...(groups.get(key) ?? []), item]);
  }
  return groups;
}

function sumCounts(counts: Partial<Record<string, number>>): number {
  return Object.values(counts).reduce<number>((sum, count) => sum + (count ?? 0), 0);
}
