import { index, integer, sqliteTable, text } from "drizzle-orm/sqlite-core";

export const orgs = sqliteTable("orgs", {
  id: text("id").primaryKey(),
  name: text("name").notNull(),
  createdAt: text("created_at").notNull(),
  updatedAt: text("updated_at").notNull(),
});

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
    error: text("error"),
    createdAt: text("created_at").notNull(),
    startedAt: text("started_at"),
    completedAt: text("completed_at"),
  },
  (table) => [index("idx_fusion_runs_org_created").on(table.orgId, table.createdAt)],
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
