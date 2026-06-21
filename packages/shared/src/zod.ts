import { z } from "zod";

export const adapterIdSchema = z.enum([
  "opencode",
  "claude",
  "codex",
  "cursor-agent",
  "gemini",
  "qwen",
  "qoder",
  "copilot",
  "deepseek",
  "kimi",
  "hermes",
  "pi",
  "aider",
  "devin",
  "grok-build",
  "amp",
  "kiro",
  "kilo",
  "vibe",
  "trae-cli",
  "codebuddy",
  "reasonix",
  "antigravity",
  "openrouter",
  "openrouter-fusion",
  "api-key",
  "cloudflare-ai-gateway",
]);
export const authModeSchema = z.enum(["cli_session", "api_key", "cloud_gateway", "unknown"]);
export const modelAvailabilitySchema = z.enum(["detected", "listed", "verified", "configured_unverified", "unavailable"]);
export const modelSourceSchema = z.enum(["live", "fallback", "suggested", "custom"]);
export const permissionProfileSchema = z.enum(["readonly", "workspace_write", "trusted_internal"]);
export const fusionModeSchema = z.enum(["direct", "auto", "required"]);
export const runStatusSchema = z.enum(["queued", "running", "paused", "waiting_approval", "completed", "failed", "cancelled"]);
export const runnerStatusSchema = z.enum(["online", "offline", "disabled"]);
export const toolKindSchema = z.enum(["opencode", "codex", "docker", "git", "custom"]);
export const toolStatusSchema = z.enum(["detected", "verified", "unavailable", "error"]);
export const runnerJobKindSchema = z.enum(["direct", "panel", "judge", "final", "command", "patch", "pr_review"]);
export const runnerJobStatusSchema = z.enum(["queued", "paused", "leased", "running", "completed", "failed", "timeout", "cancelled"]);
export const artifactKindSchema = z.enum([
  "prompt",
  "panel_output",
  "judge",
  "final",
  "patch",
  "log",
  "transcript",
  "generated_file",
  "test_output",
]);
export const auditSeveritySchema = z.enum(["info", "warning", "error"]);
export const providerPolicySchema = z.enum(["same_provider_first", "mixed_quality", "manual"]);

export const runEventTypeSchema = z.enum([
  "run.created",
  "run.started",
  "run.planning.started",
  "run.planning.completed",
  "panel.job.queued",
  "panel.job.started",
  "panel.thinking.delta",
  "panel.output.delta",
  "panel.tool_call",
  "panel.tool_result",
  "panel.usage",
  "panel.job.completed",
  "panel.job.failed",
  "judge.started",
  "judge.output.delta",
  "judge.completed",
  "judge.failed",
  "final.started",
  "final.thinking.delta",
  "final.delta",
  "final.tool_call",
  "final.tool_result",
  "final.completed",
  "approval.requested",
  "approval.granted",
  "approval.denied",
  "command.started",
  "command.output",
  "command.completed",
  "file.changed",
  "artifact.uploaded",
  "run.paused",
  "run.resumed",
  "run.completed",
  "run.failed",
  "run.cancelled",
  "run.deleted",
]);

export const chatMessageSchema = z.object({
  role: z.enum(["system", "user", "assistant"]),
  content: z.string().min(1),
});

export const modelCapabilitiesSchema = z.object({
  streaming: z.boolean(),
  tools: z.boolean(),
  fileEdits: z.boolean(),
  shell: z.boolean(),
  jsonOutput: z.boolean(),
  modelListing: z.boolean(),
});

export const modelRefSchema = z.object({
  id: z.string().min(1),
  runnerId: z.string().optional(),
  adapter: adapterIdSchema,
  provider: z.string().optional(),
  model: z.string().min(1),
  displayName: z.string().optional(),
  authMode: authModeSchema,
  availability: modelAvailabilitySchema,
  source: modelSourceSchema.optional(),
  capabilities: modelCapabilitiesSchema,
});

export const requestedModelIdSchema = z.string().transform((value, ctx) => {
  const trimmed = value.trim();
  if (trimmed.length === 0 || trimmed.length > 200 || /[\x00-\x1F\x7F]/.test(trimmed)) {
    ctx.addIssue({
      code: "custom",
      message: "Model ID must be 1-200 characters without control characters",
    });
    return z.NEVER;
  }
  return trimmed;
});

export const toolRefSchema = z.object({
  id: z.string().optional(),
  tool: toolKindSchema,
  version: z.string().optional(),
  path: z.string().optional(),
  status: toolStatusSchema,
  metadata: z.record(z.string(), z.unknown()).optional(),
  detectedAt: z.string().optional(),
});

export const runnerCapabilitiesSchema = z.object({
  adapters: z.array(adapterIdSchema),
  executors: z.array(z.enum(["host", "docker"])),
  workspaceWrite: z.boolean(),
  shell: z.boolean(),
  docker: z.boolean(),
});

export const runnerRegistrationRequestSchema = z.object({
  runnerId: z.string().optional(),
  name: z.string().min(1),
  os: z.string().min(1),
  arch: z.string().min(1),
  version: z.string().min(1),
  capabilities: runnerCapabilitiesSchema,
  tools: z.array(toolRefSchema),
  models: z.array(modelRefSchema).optional(),
});

export const fusionRunRequestSchema = z.object({
  workspaceId: z.string().optional(),
  mode: fusionModeSchema,
  preset: z.string().optional(),
  messages: z.array(chatMessageSchema).min(1),
  permissionProfile: permissionProfileSchema,
  providerPolicy: providerPolicySchema.optional(),
  analysisModels: z.array(requestedModelIdSchema).optional(),
  judgeModel: requestedModelIdSchema.optional(),
  finalModel: requestedModelIdSchema.optional(),
  stream: z.boolean().optional(),
  timeoutMs: z.number().int().positive().optional(),
});

export const fusionContinueRequestSchema = z.object({
  message: z.string().min(1),
});

export const fusionRunTitleUpdateRequestSchema = z.object({
  title: z.string().trim().min(1).max(120),
});

export const fusionExecutionStepSchema = z.object({
  id: z.string().min(1),
  kind: runnerJobKindSchema,
  jobId: z.string().min(1),
  runnerId: z.string().optional(),
  modelId: requestedModelIdSchema.optional(),
  adapter: adapterIdSchema.optional(),
  model: requestedModelIdSchema.optional(),
  role: z.string().optional(),
  dependsOn: z.array(z.string().min(1)).optional(),
});

export const fusionExecutionPlanSchema = z.object({
  version: z.literal(1),
  runId: z.string().min(1),
  mode: fusionModeSchema,
  steps: z.array(fusionExecutionStepSchema),
  createdAt: z.string().min(1),
});

export const runnerEventSchema = z.object({
  type: runEventTypeSchema,
  runId: z.string().min(1),
  seq: z.number().int().positive().optional(),
  jobId: z.string().optional(),
  runnerId: z.string().optional(),
  timestamp: z.string().min(1),
  data: z.record(z.string(), z.unknown()).default({}),
});

export const runnerJobPayloadSchema = z.object({
  jobId: z.string().min(1),
  runId: z.string().min(1),
  kind: runnerJobKindSchema,
  modelId: requestedModelIdSchema.optional(),
  adapter: adapterIdSchema.optional(),
  model: requestedModelIdSchema.optional(),
  role: z.string().optional(),
  prompt: z.string().optional(),
  promptObjectKey: z.string().optional(),
  workspaceId: z.string().optional(),
  workspacePath: z.string().optional(),
  permissionProfile: permissionProfileSchema,
  timeoutMs: z.number().int().positive().optional(),
  attempt: z.number().int().positive(),
  metadata: z.record(z.string(), z.unknown()).optional(),
});

export const runnerJobSchema = z.object({
  id: z.string().min(1),
  orgId: z.string().min(1),
  runId: z.string().min(1),
  runnerId: z.string().min(1),
  kind: runnerJobKindSchema,
  status: runnerJobStatusSchema,
  attempt: z.number().int().nonnegative(),
  leaseOwner: z.string().optional(),
  leaseExpiresAt: z.string().optional(),
  inputObjectKey: z.string().optional(),
  outputObjectKey: z.string().optional(),
  error: z.string().optional(),
  createdAt: z.string().min(1),
  startedAt: z.string().optional(),
  completedAt: z.string().optional(),
});

export const claimedRunnerJobSchema = runnerJobSchema.extend({
  payload: runnerJobPayloadSchema,
});

export const runnerJobCompletionSchema = z.object({
  status: z.enum(["completed", "failed", "timeout", "cancelled"]).default("completed"),
  outputObjectKey: z.string().optional(),
  outputText: z.string().optional(),
  error: z.string().optional(),
  latencyMs: z.number().int().nonnegative().optional(),
  usage: z.record(z.string(), z.unknown()).optional(),
  artifactKeys: z.array(z.string()).optional(),
});

export const approvalRequestSchema = z.object({
  action: z.enum(["grant", "deny"]),
  reason: z.string().optional(),
});

export const artifactCreateRequestSchema = z.object({
  runId: z.string().min(1),
  kind: artifactKindSchema,
  objectKey: z.string().min(1),
  contentType: z.string().optional(),
  sizeBytes: z.number().int().nonnegative().optional(),
  sha256: z.string().optional(),
});
