export type AdapterId =
  | "opencode"
  | "claude"
  | "codex"
  | "cursor-agent"
  | "gemini"
  | "qwen"
  | "qoder"
  | "copilot"
  | "deepseek"
  | "kimi"
  | "hermes"
  | "pi"
  | "aider"
  | "devin"
  | "grok-build"
  | "amp"
  | "kiro"
  | "kilo"
  | "vibe"
  | "trae-cli"
  | "codebuddy"
  | "reasonix"
  | "antigravity"
  | "openrouter"
  | "openrouter-fusion"
  | "api-key"
  | "cloudflare-ai-gateway";

export type AuthMode = "cli_session" | "api_key" | "cloud_gateway" | "unknown";

export type ModelAvailability = "detected" | "listed" | "verified" | "configured_unverified" | "unavailable";

export type ModelSource = "live" | "fallback" | "suggested" | "custom";

export type PermissionProfile = "readonly" | "workspace_write" | "trusted_internal";

export type FusionMode = "direct" | "auto" | "required";

export type RunStatus = "queued" | "running" | "paused" | "waiting_approval" | "completed" | "failed" | "cancelled";

export type UserRole = "owner" | "admin" | "developer" | "viewer";

export type RunnerStatus = "online" | "offline" | "disabled";

export type ToolKind = "opencode" | "codex" | "docker" | "git" | "custom";

export type ToolStatus = "detected" | "verified" | "unavailable" | "error";

export type PanelOutputStatus = "queued" | "running" | "completed" | "failed" | "timeout" | "cancelled";

export type RunnerJobKind = "direct" | "panel" | "judge" | "final" | "command" | "patch";

export type RunnerJobStatus = "queued" | "paused" | "leased" | "running" | "completed" | "failed" | "timeout" | "cancelled";

export type AuditSeverity = "info" | "warning" | "error";

export type ArtifactKind = "prompt" | "panel_output" | "judge" | "final" | "patch" | "log" | "transcript" | "generated_file" | "test_output";

export type FusionProviderPolicy = "same_provider_first" | "mixed_quality" | "manual";

export type FusionExecutionStep = {
  id: string;
  kind: RunnerJobKind;
  jobId: string;
  runnerId?: string;
  modelId?: string;
  adapter?: AdapterId;
  model?: string;
  role?: string;
  dependsOn?: string[];
};

export type FusionExecutionPlan = {
  version: 1;
  runId: string;
  mode: FusionMode;
  steps: FusionExecutionStep[];
  createdAt: string;
};

export type ChatMessage = {
  role: "system" | "user" | "assistant";
  content: string;
};

export type ModelRef = {
  id: string;
  runnerId?: string;
  adapter: AdapterId;
  provider?: string;
  model: string;
  displayName?: string;
  authMode: AuthMode;
  availability: ModelAvailability;
  source?: ModelSource;
  capabilities: {
    streaming: boolean;
    tools: boolean;
    fileEdits: boolean;
    shell: boolean;
    jsonOutput: boolean;
    modelListing: boolean;
  };
};

export type ToolRef = {
  id?: string;
  tool: ToolKind;
  version?: string;
  path?: string;
  status: ToolStatus;
  metadata?: Record<string, unknown>;
  detectedAt?: string;
};

export type RunnerRef = {
  id: string;
  orgId: string;
  userId?: string;
  name: string;
  os: string;
  arch: string;
  version: string;
  status: RunnerStatus;
  capabilities: {
    adapters: AdapterId[];
    executors: Array<"host" | "docker">;
    workspaceWrite: boolean;
    shell: boolean;
    docker: boolean;
  };
  tools: ToolRef[];
  lastSeenAt?: string;
  createdAt: string;
  updatedAt: string;
};

export type WorkspaceRef = {
  id: string;
  orgId: string;
  name: string;
  repoUrl?: string;
  defaultBranch?: string;
  defaultRunnerPool?: string;
  permissionProfile: PermissionProfile;
  createdAt: string;
  updatedAt: string;
};

export type PresetConfig = {
  id: string;
  name: string;
  description: string;
  mode: FusionMode;
  providerPolicy: FusionProviderPolicy;
  maxPanelModels: number;
  timeoutMs: number;
  adapters?: AdapterId[];
  permissionProfile: PermissionProfile;
};

export type PanelOutputRef = {
  id: string;
  runId: string;
  modelId: string;
  adapter: AdapterId;
  status: PanelOutputStatus;
  outputObjectKey?: string;
  error?: string;
  latencyMs?: number;
  usage?: Record<string, unknown>;
  createdAt: string;
  completedAt?: string;
};

export type ArtifactRef = {
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

export type AuditEventRef = {
  id: string;
  orgId: string;
  userId?: string;
  runnerId?: string;
  runId?: string;
  eventType: string;
  severity: AuditSeverity;
  metadata?: Record<string, unknown>;
  createdAt: string;
};

export type FusionRunSummary = {
  id: string;
  orgId: string;
  workspaceId?: string;
  userId: string;
  runnerId?: string;
  status: RunStatus;
  mode: FusionMode;
  preset?: string;
  permissionProfile: PermissionProfile;
  promptObjectKey?: string;
  judgeObjectKey?: string;
  finalObjectKey?: string;
  executionPlan?: FusionExecutionPlan;
  parentRunId?: string;
  conversationId?: string;
  title?: string;
  error?: string;
  createdAt: string;
  startedAt?: string;
  completedAt?: string;
};

export type FusionRunDetail = FusionRunSummary & {
  panelOutputs: PanelOutputRef[];
  artifacts: ArtifactRef[];
  auditEvents: AuditEventRef[];
  messages?: ChatMessage[];
};

export type RunnerRegistrationRequest = {
  runnerId?: string;
  name: string;
  os: string;
  arch: string;
  version: string;
  capabilities: RunnerRef["capabilities"];
  tools: ToolRef[];
  models?: ModelRef[];
};

export type RunnerJob = {
  id: string;
  orgId: string;
  runId: string;
  runnerId: string;
  kind: RunnerJobKind;
  status: RunnerJobStatus;
  attempt: number;
  leaseOwner?: string;
  leaseExpiresAt?: string;
  inputObjectKey?: string;
  outputObjectKey?: string;
  error?: string;
  createdAt: string;
  startedAt?: string;
  completedAt?: string;
};

export type RunnerJobPayload = {
  jobId: string;
  runId: string;
  kind: RunnerJobKind;
  modelId?: string;
  adapter?: AdapterId;
  model?: string;
  role?: string;
  prompt?: string;
  promptObjectKey?: string;
  workspaceId?: string;
  workspacePath?: string;
  permissionProfile: PermissionProfile;
  timeoutMs?: number;
  attempt: number;
  metadata?: Record<string, unknown>;
};

export type ClaimedRunnerJob = RunnerJob & {
  payload: RunnerJobPayload;
};

export type ApprovalAction = "grant" | "deny";

export type ApprovalRequest = {
  action: ApprovalAction;
  reason?: string;
};

export type DashboardSnapshot = {
  runs: {
    total: number;
    queued: number;
    running: number;
    paused: number;
    waitingApproval: number;
    completed: number;
    failed: number;
    cancelled: number;
  };
  runners: {
    total: number;
    online: number;
    offline: number;
    disabled: number;
  };
  models: {
    total: number;
    verified: number;
    cliSession: number;
    cloudGateway: number;
  };
  artifacts: {
    total: number;
    totalBytes: number;
  };
  recentRuns: FusionRunSummary[];
  recentAuditEvents: AuditEventRef[];
};

export type FusionRunRequest = {
  workspaceId?: string;
  mode: FusionMode;
  preset?: string;
  messages: ChatMessage[];
  permissionProfile: PermissionProfile;
  providerPolicy?: FusionProviderPolicy;
  analysisModels?: string[];
  judgeModel?: string;
  finalModel?: string;
  stream?: boolean;
  timeoutMs?: number;
};

export type FusionContinueRequest = {
  message: string;
};
