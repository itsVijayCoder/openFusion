import type { D1DatabaseLike } from "./client";

export type CreateFusionRunInput = {
  id: string;
  orgId: string;
  userId: string;
  mode: string;
  permissionProfile: string;
  createdAt: string;
};

export async function createFusionRun(db: D1DatabaseLike, input: CreateFusionRunInput) {
  return db
    .prepare(
      `INSERT INTO fusion_runs (id, org_id, user_id, status, mode, permission_profile, created_at)
       VALUES (?, ?, ?, 'queued', ?, ?, ?)`,
    )
    .bind(input.id, input.orgId, input.userId, input.mode, input.permissionProfile, input.createdAt)
    .run();
}
