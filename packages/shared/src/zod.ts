import { z } from "zod";

export const adapterIdSchema = z.enum(["opencode", "codex", "api-key", "cloudflare-ai-gateway"]);
export const authModeSchema = z.enum(["cli_session", "api_key", "cloud_gateway", "unknown"]);
export const modelAvailabilitySchema = z.enum(["detected", "listed", "verified", "configured_unverified", "unavailable"]);
export const modelSourceSchema = z.enum(["live", "fallback", "suggested", "custom"]);
export const permissionProfileSchema = z.enum(["readonly", "workspace_write", "trusted_internal"]);
export const fusionModeSchema = z.enum(["direct", "auto", "required"]);
export const runStatusSchema = z.enum(["queued", "running", "waiting_approval", "completed", "failed", "cancelled"]);
export const runnerStatusSchema = z.enum(["online", "offline", "disabled"]);
export const toolKindSchema = z.enum(["opencode", "codex", "docker", "git", "custom"]);
export const toolStatusSchema = z.enum(["detected", "verified", "unavailable", "error"]);
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
