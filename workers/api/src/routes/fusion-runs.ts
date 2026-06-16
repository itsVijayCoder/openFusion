import { createFusionRun } from "@fusion-harness/db";
import { fusionRunRequestSchema } from "@fusion-harness/shared";
import { Hono } from "hono";
import type { AppBindings } from "../env";

export const fusionRunRoutes = new Hono<AppBindings>()
  .post("/", async (c) => {
    const payload = fusionRunRequestSchema.parse(await c.req.json());
    const runId = `run_${crypto.randomUUID()}`;

    await createFusionRun(c.env.DB, {
      id: runId,
      orgId: "org_placeholder",
      userId: "usr_placeholder",
      mode: payload.mode,
      permissionProfile: payload.permissionProfile,
      createdAt: new Date().toISOString(),
    });

    return c.json({ id: runId, status: "queued" }, 202);
  })
  .get("/:id", (c) => c.json({ id: c.req.param("id"), status: "queued" }))
  .get("/:id/events", (c) => {
    const id = c.env.FUSION_RUN.idFromName(c.req.param("id"));
    return c.env.FUSION_RUN.get(id).fetch(c.req.raw);
  })
  .post("/:id/approve", (c) => c.json({ id: c.req.param("id"), status: "approval_recorded" }))
  .post("/:id/cancel", (c) => c.json({ id: c.req.param("id"), status: "cancel_requested" }));
