import { createAuditEvent, getFusionRun, getFusionRunDetail, listFusionRuns, listRunEvents, updateFusionRunTitle } from "@fusion-harness/db";
import { approvalRequestSchema, formatEntityId, fusionContinueRequestSchema, fusionRunRequestSchema, fusionRunTitleUpdateRequestSchema } from "@fusion-harness/shared";
import { Hono } from "hono";
import type { AppBindings } from "../env";
import { recordApproval } from "../services/approvals";
import { requireAccessIdentity } from "../services/auth";
import {
  cancelRun,
  continueRun,
  createRunFromRequest,
  deleteRun,
  loadRunMessages,
  pauseRun,
  reconcileFusionRun,
  resumeRun,
  retryPanelJob,
  retryRun,
  RunCreationError,
  RunLifecycleError,
} from "../services/runs";

export const fusionRunRoutes = new Hono<AppBindings>()
  .get("/", async (c) => {
    const principal = await requireAccessIdentity(c.env.DB, c.env, c.req.raw.headers);
    const limit = Number(c.req.query("limit") ?? 25);

    const cacheKey = `runs:list:${principal.orgId}:${limit}`;
    if (c.env.KV) {
      const cached = await c.env.KV.get(cacheKey);
      if (cached) {
        return c.json({ data: JSON.parse(cached), cached: true });
      }
    }

    const data = await listFusionRuns(c.env.DB, principal.orgId, Math.min(Math.max(limit, 1), 100));
    if (c.env.KV) {
      await c.env.KV.put(cacheKey, JSON.stringify(data), { expirationTtl: 10 });
    }
    return c.json({ data });
  })
  .post("/", async (c) => {
    const principal = await requireAccessIdentity(c.env.DB, c.env, c.req.raw.headers);
    const payload = fusionRunRequestSchema.parse(await c.req.json());
    const { run, promptObjectKey } = await createRunFromRequest(c.env, principal, payload);

    if (c.env.KV) {
      await c.env.KV.delete(`runs:list:${principal.orgId}:25`).catch(() => {});
      await c.env.KV.delete(`runs:list:${principal.orgId}:30`).catch(() => {});
    }

    return c.json({ ...run, promptObjectKey }, 202);
  })
  .get("/:id", async (c) => {
    const principal = await requireAccessIdentity(c.env.DB, c.env, c.req.raw.headers);
    const run = await getFusionRunDetail(c.env.DB, principal.orgId, c.req.param("id"));

    if (!run) {
      return c.json({ error: "Run not found" }, 404);
    }

    const messages = await loadRunMessages(c.env, run.promptObjectKey);

    return c.json({ ...run, messages });
  })
  .get("/:id/events", async (c) => {
    const runId = c.req.param("id");
    const principal = await requireAccessIdentity(c.env.DB, c.env, c.req.raw.headers);
    const run = await getFusionRun(c.env.DB, principal.orgId, runId);
    if (!run) {
      return c.json({ error: "Run not found" }, 404);
    }

    if (c.req.raw.headers.get("upgrade") === "websocket") {
      const id = c.env.FUSION_RUN.idFromName(runId);
      return c.env.FUSION_RUN.get(id).fetch(c.req.raw);
    }

    if (run.status === "running") {
      await reconcileFusionRun(c.env, principal.orgId, runId);
    }

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
    const principal = await requireAccessIdentity(c.env.DB, c.env, c.req.raw.headers);
    const runId = c.req.param("id");
    const body = fusionContinueRequestSchema.parse(await c.req.json());
    const { run, promptObjectKey } = await continueRun(c.env, principal, runId, body.message);

    return c.json({ ...run, promptObjectKey }, 202);
  })
  .post("/:id/retry", async (c) => {
    const principal = await requireAccessIdentity(c.env.DB, c.env, c.req.raw.headers);
    const { run, promptObjectKey } = await retryRun(c.env, principal, c.req.param("id"));
    return c.json({ ...run, promptObjectKey }, 202);
  })
  .post("/:id/jobs/:jobId/retry", async (c) => {
    const principal = await requireAccessIdentity(c.env.DB, c.env, c.req.raw.headers);
    await retryPanelJob(c.env, principal, c.req.param("id"), c.req.param("jobId"));
    return c.json({ status: "queued" }, 202);
  })
  .post("/:id/rename", async (c) => {
    const principal = await requireAccessIdentity(c.env.DB, c.env, c.req.raw.headers);
    const runId = c.req.param("id");
    const body = fusionRunTitleUpdateRequestSchema.parse(await c.req.json());
    const run = await updateFusionRunTitle(c.env.DB, principal.orgId, runId, body.title);

    if (!run) {
      return c.json({ error: "Run not found" }, 404);
    }

    await createAuditEvent(c.env.DB, {
      id: formatEntityId("audit", crypto.randomUUID()),
      orgId: principal.orgId,
      userId: principal.userId,
      runId,
      eventType: "run.renamed",
      metadata: { title: body.title },
      createdAt: new Date().toISOString(),
    });

    return c.json(run);
  })
  .post("/:id/approve", async (c) => {
    const principal = await requireAccessIdentity(c.env.DB, c.env, c.req.raw.headers);
    const runId = c.req.param("id");
    const body = approvalRequestSchema.parse(await c.req.json().catch(() => ({ action: "grant" })));
    await recordApproval(c.env, principal, runId, body);
    return c.json(await getFusionRunDetail(c.env.DB, principal.orgId, runId));
  })
  .post("/:id/pause", async (c) => {
    const principal = await requireAccessIdentity(c.env.DB, c.env, c.req.raw.headers);
    return c.json(await pauseRun(c.env, principal, c.req.param("id")), 202);
  })
  .post("/:id/resume", async (c) => {
    const principal = await requireAccessIdentity(c.env.DB, c.env, c.req.raw.headers);
    return c.json(await resumeRun(c.env, principal, c.req.param("id")), 202);
  })
  .post("/:id/cancel", async (c) => {
    const principal = await requireAccessIdentity(c.env.DB, c.env, c.req.raw.headers);
    return c.json(await cancelRun(c.env, principal, c.req.param("id")), 202);
  })
  .delete("/:id", async (c) => {
    const principal = await requireAccessIdentity(c.env.DB, c.env, c.req.raw.headers);
    await deleteRun(c.env, principal, c.req.param("id"));

    if (c.env.KV) {
      await c.env.KV.delete(`runs:list:${principal.orgId}:25`).catch(() => {});
      await c.env.KV.delete(`runs:list:${principal.orgId}:30`).catch(() => {});
    }

    return c.json({ status: "deleted" }, 202);
  });

fusionRunRoutes.onError((error, c) => {
  if (error instanceof RunCreationError) {
    return c.json({ error: error.message }, error.statusCode);
  }
  if (error instanceof RunLifecycleError) {
    return c.json({ error: error.message }, error.statusCode);
  }
  throw error;
});