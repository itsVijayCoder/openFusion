import { z } from "zod";

export const permissionProfileSchema = z.enum(["readonly", "workspace_write", "trusted_internal"]);
export const fusionModeSchema = z.enum(["direct", "auto", "required"]);
export const runStatusSchema = z.enum(["queued", "running", "waiting_approval", "completed", "failed", "cancelled"]);

export const fusionRunRequestSchema = z.object({
  workspaceId: z.string().optional(),
  mode: fusionModeSchema,
  preset: z.string().optional(),
  messages: z.array(
    z.object({
      role: z.enum(["system", "user", "assistant"]),
      content: z.string().min(1),
    }),
  ),
  permissionProfile: permissionProfileSchema,
  providerPolicy: z.enum(["same_provider_first", "mixed_quality", "manual"]).optional(),
  analysisModels: z.array(z.string()).optional(),
  judgeModel: z.string().optional(),
  finalModel: z.string().optional(),
  stream: z.boolean().optional(),
  timeoutMs: z.number().int().positive().optional(),
});
