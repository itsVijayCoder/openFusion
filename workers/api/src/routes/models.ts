import { createAuditEvent, ensurePrincipal, listModels } from "@fusion-harness/db";
import { formatEntityId } from "@fusion-harness/shared";
import { Hono } from "hono";
import type { AppBindings } from "../env";
import { requireAccessIdentity } from "../services/auth";

export const localModelAliases = [
  { id: "local/fusion", object: "model", owned_by: "fusion-harness" },
  { id: "local/fusion-fast", object: "model", owned_by: "fusion-harness" },
  { id: "local/fusion-quality", object: "model", owned_by: "fusion-harness" },
  { id: "local/fusion-same-provider", object: "model", owned_by: "fusion-harness" },
  { id: "local/opencode", object: "model", owned_by: "fusion-harness" },
  { id: "local/codex", object: "model", owned_by: "fusion-harness" },
] as const;

export const modelRoutes = new Hono<AppBindings>()
  .get("/", async (c) => {
    const principal = await requireAccessIdentity(c.env.DB, c.env, c.req.raw.headers);
    const models = await listModels(c.env.DB, principal.orgId);

    return c.json({
      aliases: localModelAliases,
      data: models,
    });
  })
  .post("/discover", async (c) => {
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

    await createAuditEvent(c.env.DB, {
      id: formatEntityId("audit", crypto.randomUUID()),
      orgId: principal.orgId,
      userId: principal.userId,
      eventType: "models.discovery_requested",
      severity: "info",
      createdAt: now,
    });

    return c.json({ status: "queued", requestedAt: now }, 202);
  });
