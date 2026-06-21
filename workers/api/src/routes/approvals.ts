import { approvalRequestSchema } from "@fusion-harness/shared";
import { Hono } from "hono";
import type { AppBindings } from "../env";
import { recordApproval } from "../services/approvals";
import { requireAccessIdentity } from "../services/auth";

export const approvalRoutes = new Hono<AppBindings>().post("/:runId", async (c) => {
  const principal = await requireAccessIdentity(c.env.DB, c.env, c.req.raw.headers);
  const runId = c.req.param("runId");
  const body = approvalRequestSchema.parse(await c.req.json().catch(() => ({ action: "grant" })));
  return c.json(await recordApproval(c.env, principal, runId, body));
});
