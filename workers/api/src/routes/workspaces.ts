import { ensurePrincipal, listWorkspaces } from "@fusion-harness/db";
import { Hono } from "hono";
import type { AppBindings } from "../env";
import { requireAccessIdentity } from "../services/auth";

export const workspaceRoutes = new Hono<AppBindings>().get("/", async (c) => {
  const principal = await requireAccessIdentity(c.env.DB, c.env, c.req.raw.headers);
  const now = new Date().toISOString();

  await ensurePrincipal(c.env.DB, {
    orgId: principal.orgId,
    orgName: principal.orgName,
    userId: principal.userId,
    email: principal.email,
    name: principal.name,
    now,
  });

  return c.json({ data: await listWorkspaces(c.env.DB, principal.orgId) });
});
