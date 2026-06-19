import { createAuditEvent, getFusionRunDetail, listFusionRuns, listRunEvents, updateFusionRunStatus } from "@fusion-harness/db";
import { approvalRequestSchema, formatEntityId, fusionContinueRequestSchema, fusionRunRequestSchema } from "@fusion-harness/shared";
import { Hono } from "hono";
import type { AppBindings } from "../env";
import { recordApproval } from "../services/approvals";
import { requireAccessIdentity } from "../services/auth";
import { continueRun, createRunFromRequest, loadRunMessages, notifyFusionRunObject, reconcileFusionRun, RunCreationError } from "../services/runs";

export const fusionRunRoutes = new Hono<AppBindings>()
  .get("/", async (c) => {
    const principal = requireAccessIdentity(c.req.raw.headers);
    const limit = Number(c.req.query("limit") ?? 25);
    return c.json({ data: await listFusionRuns(c.env.DB, principal.orgId, Math.min(Math.max(limit, 1), 100)) });
  })
  .post("/", async (c) => {
    const principal = requireAccessIdentity(c.req.raw.headers);
    const payload = fusionRunRequestSchema.parse(await c.req.json());
    const { run, promptObjectKey } = await createRunFromRequest(c.env, principal, payload);

    return c.json({ ...run, promptObjectKey }, 202);
  })
  .get("/:id", async (c) => {
    const principal = requireAccessIdentity(c.req.raw.headers);
    const run = await getFusionRunDetail(c.env.DB, principal.orgId, c.req.param("id"));

    if (!run) {
      return c.json({ error: "Run not found" }, 404);
    }

    const messages = await loadRunMessages(c.env, run.promptObjectKey);

    return c.json({ ...run, messages });
  })
  .get("/:id/events", async (c) => {
    const runId = c.req.param("id");
    if (c.req.raw.headers.get("upgrade") === "websocket") {
      const id = c.env.FUSION_RUN.idFromName(runId);
      return c.env.FUSION_RUN.get(id).fetch(c.req.raw);
    }

    const principal = requireAccessIdentity(c.req.raw.headers);
    await reconcileFusionRun(c.env, principal.orgId, runId);
    const afterSeq = Number(c.req.query("afterSeq") ?? 0);
    const limit = Number(c.req.query("limit") ?? 1000);
    return c.json({
      data: await listRunEvents(c.env.DB, principal.orgId, runId, {
        afterSeq: Number.isFinite(afterSeq) ? Math.max(afterSeq, 0) : 0,
        limit: Number.isFinite(limit) ? Math.min(Math.max(limit, 1), 1000) : 1000,
      }),
    });
  })
  .post("/:id/continue", async (c) => {
    const principal = requireAccessIdentity(c.req.raw.headers);
    const runId = c.req.param("id");
    const body = fusionContinueRequestSchema.parse(await c.req.json());
    const { run, promptObjectKey } = await continueRun(c.env, principal, runId, body.message);

    return c.json({ ...run, promptObjectKey }, 202);
  })
  .post("/:id/approve", async (c) => {
    const principal = requireAccessIdentity(c.req.raw.headers);
    const runId = c.req.param("id");
    const body = approvalRequestSchema.parse(await c.req.json().catch(() => ({ action: "grant" })));
    await recordApproval(c.env, principal, runId, body);
    return c.json(await getFusionRunDetail(c.env.DB, principal.orgId, runId));
  })
  .post("/:id/cancel", async (c) => {
    const principal = requireAccessIdentity(c.req.raw.headers);
    const runId = c.req.param("id");
    const now = new Date().toISOString();

    await updateFusionRunStatus(c.env.DB, principal.orgId, runId, "cancelled", now);
    await createAuditEvent(c.env.DB, {
      id: formatEntityId("audit", crypto.randomUUID()),
      orgId: principal.orgId,
      userId: principal.userId,
      runId,
      eventType: "run.cancelled",
      severity: "warning",
      createdAt: now,
    });
    await notifyFusionRunObject(c.env, runId, "/runner-event", {
      type: "run.cancelled",
      runId,
      timestamp: now,
      data: {},
    });

    return c.json(await getFusionRunDetail(c.env.DB, principal.orgId, runId));
  });

fusionRunRoutes.onError((error, c) => {
  if (error instanceof RunCreationError) {
    return c.json({ error: error.message }, error.statusCode);
  }
  throw error;
});
