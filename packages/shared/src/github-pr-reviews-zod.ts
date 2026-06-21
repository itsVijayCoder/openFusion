import { z } from "zod";
import { adapterIdSchema } from "./zod";

export const gitHubPrStatusSchema = z.enum([
  "not_assigned",
  "assigned",
  "pending",
  "reviewed",
  "stale",
  "failed",
  "ignored",
]);

export const gitHubAccountTypeSchema = z.enum(["User", "Organization", "Bot"]);

export const gitHubRepositorySelectionSchema = z.enum(["selected", "all"]);

export const gitHubReviewSubjectTypeSchema = z.enum(["assignee", "requested_reviewer"]);

export const gitHubReviewSubjectStateSchema = z.enum(["active", "removed"]);

export const prReviewRunStatusSchema = z.enum([
  "queued",
  "running",
  "completed",
  "failed",
  "cancelled",
]);

export const prReviewModeSchema = z.enum(["quick", "standard", "deep", "security"]);

export const prReviewSeveritySchema = z.enum(["blocker", "major", "minor", "nit"]);

export const prReviewCategorySchema = z.enum([
  "bug",
  "security",
  "performance",
  "maintainability",
  "test",
  "ux",
  "accessibility",
  "docs",
]);

export const prReviewSideSchema = z.enum(["LEFT", "RIGHT"]);

export const prReviewCommentStatusSchema = z.enum([
  "draft",
  "edited",
  "approved",
  "rejected",
  "published",
  "outdated",
  "failed",
]);

export const prReviewRiskLevelSchema = z.enum(["low", "medium", "high"]);

export const prReviewDecisionSchema = z.enum(["comment", "request_changes", "approve"]);

export const autoReviewTriggerSchema = z.enum([
  "review_requested",
  "assigned",
  "both",
  "manual",
]);

export const githubRepoSettingsUpdateSchema = z.object({
  workspaceId: z.string().min(1).optional(),
  defaultRunnerId: z.string().min(1).optional(),
  autoReviewEnabled: z.boolean().optional(),
  autoReviewTrigger: autoReviewTriggerSchema.optional(),
  autoPublishEnabled: z.boolean().optional(),
  permissionProfile: z.enum(["readonly", "workspace_write", "trusted_internal"]).optional(),
  runTests: z.boolean().optional(),
  maxComments: z.number().int().min(1).max(100).optional(),
  ignoredPaths: z.array(z.string().min(1)).optional(),
});

export const githubRepoLinkWorkspaceSchema = z.object({
  workspaceId: z.string().min(1),
});

export const githubUserLinkCreateSchema = z.object({
  userId: z.string().min(1),
  githubLogin: z.string().trim().min(1).max(100),
  githubUserId: z.number().int().positive().optional(),
});

export const prReviewStartSchema = z.object({
  reviewMode: prReviewModeSchema.default("standard"),
  runnerId: z.string().min(1).optional(),
  adapter: adapterIdSchema.optional(),
  model: z.string().min(1).optional(),
});

export const prReviewCommentUpdateSchema = z.object({
  body: z.string().min(1).max(20000).optional(),
  suggestedChange: z.string().max(20000).nullable().optional(),
  severity: prReviewSeveritySchema.optional(),
  category: prReviewCategorySchema.optional(),
  startLine: z.number().int().positive().nullable().optional(),
  line: z.number().int().positive().nullable().optional(),
  side: prReviewSideSchema.optional(),
  status: prReviewCommentStatusSchema.optional(),
});

export const prReviewPublishSchema = z.object({
  commentIds: z.array(z.string().min(1)).optional(),
  decision: prReviewDecisionSchema.default("comment"),
  event: z.enum(["COMMENT", "REQUEST_CHANGES", "APPROVE"]).default("COMMENT"),
  body: z.string().max(20000).optional(),
});

export const prReviewQueueQuerySchema = z.object({
  status: gitHubPrStatusSchema.optional(),
  repoId: z.string().min(1).optional(),
  assignedToMe: z.enum(["true", "false"]).optional(),
  reviewRequested: z.enum(["true", "false"]).optional(),
  limit: z.coerce.number().int().min(1).max(100).default(50),
});

export const prReviewFindingSchema = z.object({
  severity: prReviewSeveritySchema,
  category: prReviewCategorySchema,
  filePath: z.string().min(1),
  side: prReviewSideSchema,
  startLine: z.number().int().positive().optional(),
  line: z.number().int().positive().optional(),
  body: z.string().min(1),
  suggestedChange: z.string().optional(),
  confidence: z.number().min(0).max(1).optional(),
  evidence: z.string().optional(),
});

export const prReviewResultSchema = z.object({
  summary: z.string().min(1),
  riskLevel: prReviewRiskLevelSchema,
  decision: prReviewDecisionSchema,
  findings: z.array(prReviewFindingSchema),
  tests: z
    .array(
      z.object({
        command: z.string().min(1),
        status: z.enum(["not_run", "passed", "failed"]),
        outputSummary: z.string().optional(),
      }),
    )
    .optional(),
});