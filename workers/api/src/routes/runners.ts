import {
  createAuditEvent,
  deleteRunner,
  ensurePrincipal,
  getFusionRun,
  getRunner,
  getRunnerJob,
  heartbeatRunner,
  heartbeatRunnerLite,
  listRunners,
  markRunnerJobLeased,
  registerRunner,
  updatePanelOutput,
} from "@openfusion/db";
import {
  formatEntityId,
  runnerEventSchema,
  runnerJobCompletionSchema,
  runnerRegistrationRequestSchema,
  type ClaimedRunnerJob,
  type RunnerEvent,
  type RunnerJobStatus,
  type RunnerRef,
} from "@openfusion/shared";
import { Hono } from "hono";
import type { AppBindings } from "../env";
import { getOptionalAccessIdentity, requireAccessIdentity, requireRunnerAccessIdentity } from "../services/auth";
import { getCachedRunner, getCachedRunnersList, invalidateRunnerCache, invalidateRunnersListCache, setCachedRunner, setCachedRunnersList } from "../services/heartbeat-cache";
import { type JobWorkMessage } from "../services/job-work";
import { notifyRunnerSessionObject, seedRunnerSessionDO } from "../services/runner-session";
import { appendRunEvent } from "../services/runs";

export const runnerRoutes = new Hono<AppBindings>()
  .get("/", async (c) => {
    const principal = await requireAccessIdentity(c.env.DB, c.env, c.req.raw.headers);

    // Use KV cache to avoid the expensive listRunners() call which does
    // SELECT * FROM runners + SELECT installed_tools.* INNER JOIN runners
    const cached = await getCachedRunnersList(c.env.CONFIG_KV, principal.orgId);
    if (cached) return c.json({ data: cached, cached: true });

    const runners = await listRunners(c.env.DB, principal.orgId);
    await setCachedRunnersList(c.env.CONFIG_KV, principal.orgId, runners);
    return c.json({ data: runners });
  })
  .post("/register", async (c) => {
    const principal = await requireRunnerAccessIdentity(c.env.DB, c.env, c.req.raw.headers);
    const payload = runnerRegistrationRequestSchema.parse(await c.req.json());
    const now = new Date().toISOString();
    const runnerId = payload.runnerId ?? formatEntityId("runner", crypto.randomUUID());

    await ensurePrincipal(c.env.DB, {
      orgId: principal.orgId,
      orgName: principal.orgName,
      userId: principal.userId,
      email: principal.email,
      name: principal.name,
      now,
    });

    const runner = await registerRunner(c.env.DB, {
      ...payload,
      runnerId,
      orgId: principal.orgId,
      userId: principal.userId,
      now,
    });

    // Invalidate list cache so the new runner shows up immediately
    await invalidateRunnersListCache(c.env.CONFIG_KV, principal.orgId);

    // Seed the RunnerSessionDO with runner metadata so future heartbeats
    // can be served entirely from DO storage without D1 reads.
    await seedRunnerSessionDO(c.env, {
      id: runner.id,
      orgId: runner.orgId,
      name: runner.name,
      os: runner.os,
      arch: runner.arch,
      version: runner.version,
      capabilities: runner.capabilities as Record<string, unknown>,
      tools: runner.tools.map((t) => ({
        id: t.id,
        tool: t.tool,
        version: t.version,
        path: t.path,
        status: t.status,
        metadata: t.metadata as Record<string, unknown> | undefined,
        detectedAt: t.detectedAt,
      })),
      createdAt: runner.createdAt,
    });

    await createAuditEvent(c.env.DB, {
      id: formatEntityId("audit", crypto.randomUUID()),
      orgId: principal.orgId,
      userId: principal.userId,
      runnerId: runner.id,
      eventType: "runner.registered",
      metadata: {
        toolCount: runner.tools.length,
        modelCount: payload.models?.length ?? 0,
        os: runner.os,
        arch: runner.arch,
      },
      createdAt: now,
    });

    return c.json(runner, 202);
  })
  .delete("/:id", async (c) => {
    // Accept either a browser session (UI "Remove" button) or a runner token
    // (uninstall script). A runner token is scoped to the same org/user that
    // registered the runner, so it is allowed to deregister its own runner.
    const principal = await getOptionalAccessIdentity(c.env.DB, c.env, c.req.raw.headers);
    if (!principal) {
      return c.json({ error: "Authentication required" }, 401);
    }
    const runnerId = c.req.param("id");
    const now = new Date().toISOString();

    const removed = await deleteRunner(c.env.DB, principal.orgId, runnerId);
    if (!removed) {
      return c.json({ error: "Runner not found" }, 404);
    }

    await invalidateRunnerCache(c.env.CONFIG_KV, principal.orgId, runnerId);
    await invalidateRunnersListCache(c.env.CONFIG_KV, principal.orgId);

    await createAuditEvent(c.env.DB, {
      id: formatEntityId("audit", crypto.randomUUID()),
      orgId: principal.orgId,
      userId: principal.userId,
      runnerId,
      eventType: "runner.removed",
      metadata: { source: principal.authMethod === "runner_token" ? "uninstall_script" : "ui" },
      createdAt: now,
    });

    return c.json({ status: "removed", runnerId });
  })
  .post("/:id/heartbeat", async (c) => {
    const principal = await requireRunnerAccessIdentity(c.env.DB, c.env, c.req.raw.headers);
    const runnerId = c.req.param("id");
    const now = new Date().toISOString();

    // Strategy:
    // 1. Write timestamp to D1 for offline detection (1 write)
    // 2. Try RunnerSessionDO — it caches runner metadata in DO storage
    // 3. Fall back to KV cache → D1 getRunner() only on double miss
    //
    // This cuts per-heartbeat reads from ~272 to ~1 for DO-warm runners.

    const lite = await heartbeatRunnerLite(c.env.DB, principal.orgId, runnerId, now);
    if (!lite) {
      return c.json({ error: "Runner not found" }, 404);
    }

    // Try DO-based heartbeat first — this eliminates D1 reads entirely
    // when the DO is warm (which it is for any active runner).
    const doResponse = await notifyRunnerSessionObject(c.env, runnerId, "/heartbeat", {
      timestamp: now,
    }).catch(() => null);

    if (doResponse?.ok) {
      const doRunner = await doResponse.json().catch(() => ({})) as Record<string, unknown>;
      // If DO returned full metadata (has tools), use it directly
      if (doRunner && "tools" in doRunner) {
        return c.json({
          ...doRunner,
          status: lite.status as RunnerRef["status"],
          lastSeenAt: lite.last_seen_at ?? now,
          updatedAt: lite.updated_at,
        });
      }
    }

    // DO cold or returned minimal data — try KV cache
    const cached = await getCachedRunner(c.env.CONFIG_KV, principal.orgId, runnerId);
    if (cached) {
      const runner = {
        ...cached,
        status: lite.status as RunnerRef["status"],
        lastSeenAt: lite.last_seen_at ?? undefined,
        updatedAt: lite.updated_at,
      } satisfies RunnerRef;
      return c.json(runner);
    }

    // Double miss — do the full D1 read once and populate both caches
    const runner = await getRunner(c.env.DB, principal.orgId, runnerId);
    if (runner) {
      await Promise.allSettled([
        setCachedRunner(c.env.CONFIG_KV, principal.orgId, runnerId, runner),
        seedRunnerSessionDO(c.env, {
          id: runner.id,
          orgId: runner.orgId,
          name: runner.name,
          os: runner.os,
          arch: runner.arch,
          version: runner.version,
          capabilities: runner.capabilities as Record<string, unknown>,
          tools: runner.tools.map((t) => ({
            id: t.id,
            tool: t.tool,
            version: t.version,
            path: t.path,
            status: t.status,
            metadata: t.metadata as Record<string, unknown> | undefined,
            detectedAt: t.detectedAt,
          })),
          createdAt: runner.createdAt,
        }),
      ]);
    }
    return c.json(runner);
  })
  .post("/:id/jobs/claim", async (c) => {
    const principal = await requireRunnerAccessIdentity(c.env.DB, c.env, c.req.raw.headers);
    const runnerId = c.req.param("id");
    const runner = await getRunner(c.env.DB, principal.orgId, runnerId);

    if (!runner) {
      return c.json({ error: "Runner not found" }, 404);
    }

    const requestBody = (await c.req.json().catch(() => ({}))) as { leaseOwner?: string; leaseSeconds?: number };
    const claimResponse = await notifyRunnerSessionObject(c.env, runnerId, "/jobs/claim", {
      leaseOwner: requestBody.leaseOwner ?? runnerId,
      leaseSeconds: requestBody.leaseSeconds,
    });
    const claimBody = (await claimResponse.json().catch(() => ({ job: null }))) as { job: ClaimedRunnerJob | null };

    if (!claimBody.job) {
      return c.json({ job: null });
    }

    const now = new Date().toISOString();
    const leasedJob = await markRunnerJobLeased(c.env.DB, {
      orgId: principal.orgId,
      runnerId,
      jobId: claimBody.job.id,
      attempt: claimBody.job.attempt,
      leaseOwner: claimBody.job.leaseOwner ?? runnerId,
      leaseExpiresAt: claimBody.job.leaseExpiresAt ?? now,
      now,
    });

    if (!leasedJob) {
      return c.json({ error: "Claimed job is missing from D1", jobId: claimBody.job.id }, 409);
    }
    if (leasedJob.status !== "leased") {
      await notifyRunnerSessionObject(
        c.env,
        runnerId,
        `/jobs/${encodeURIComponent(claimBody.job.id)}/${leasedJob.status === "paused" ? "pause" : "cancel"}`,
        { reason: `Job is ${leasedJob.status}` },
      );
      return c.json({ job: null });
    }
    if (leasedJob.kind === "panel") {
      await updatePanelOutput(c.env.DB, {
        id: formatEntityId("panel", leasedJob.id),
        status: "running",
      });
    }

    return c.json({ job: { ...leasedJob, payload: claimBody.job.payload } satisfies ClaimedRunnerJob });
  })
  .get("/:id/jobs/:jobId", async (c) => {
    const principal = await requireRunnerAccessIdentity(c.env.DB, c.env, c.req.raw.headers);
    const runnerId = c.req.param("id");
    const jobId = c.req.param("jobId");
    const job = await getRunnerJob(c.env.DB, principal.orgId, runnerId, jobId);
    if (!job) {
      return c.json({ status: "cancelled", runStatus: "deleted" });
    }

    const run = await getFusionRun(c.env.DB, principal.orgId, job.runId);
    if (!run) {
      return c.json({ job, status: "cancelled", runStatus: "deleted" });
    }

    const status = run.status === "cancelled" ? "cancelled" : job.status;
    return c.json({ job, status, runStatus: run.status });
  })
  .post("/:id/jobs/:jobId/events", async (c) => {
    const principal = await requireRunnerAccessIdentity(c.env.DB, c.env, c.req.raw.headers);
    const runnerId = c.req.param("id");
    const jobId = c.req.param("jobId");
    const event = runnerEventSchema.parse(await c.req.json());
    const normalizedEvent = {
      ...event,
      jobId: event.jobId ?? jobId,
      runnerId: event.runnerId ?? runnerId,
      timestamp: event.timestamp || new Date().toISOString(),
      data: event.data ?? {},
    };

    const persisted = await appendRunEvent(c.env, principal.orgId, normalizedEvent);
    if (!persisted) {
      return c.json({ error: "Fusion run durable object did not return a sequenced event" }, 502);
    }
    return c.json({ status: "accepted", event: persisted }, 202);
  })
  .post("/:id/jobs/:jobId/complete", async (c) => {
    const principal = await requireRunnerAccessIdentity(c.env.DB, c.env, c.req.raw.headers);
    const runnerId = c.req.param("id");
    const jobId = c.req.param("jobId");
    const body = runnerJobCompletionSchema.parse(await c.req.json().catch(() => ({ status: "completed" })));
    const status: Extract<RunnerJobStatus, "completed" | "failed" | "timeout" | "cancelled"> =
      body.status === "completed" ? "completed" : body.status;

    await c.env.JOB_WORK.send({
      kind: "complete",
      orgId: principal.orgId,
      runnerId,
      jobId,
      status,
      outputText: body.outputText,
      error: body.error,
      latencyMs: body.latencyMs,
      usage: body.usage,
      artifactKeys: body.artifactKeys,
    } satisfies JobWorkMessage);

    return c.json({ status: "accepted", jobId }, 202);
  })
  .post("/:id/jobs/:jobId/fail", async (c) => {
    const principal = await requireRunnerAccessIdentity(c.env.DB, c.env, c.req.raw.headers);
    const runnerId = c.req.param("id");
    const jobId = c.req.param("jobId");
    const body = runnerJobCompletionSchema.parse(await c.req.json().catch(() => ({ status: "failed" })));
    const status: Extract<RunnerJobStatus, "completed" | "failed" | "timeout" | "cancelled"> =
      body.status === "completed" ? "failed" : body.status;

    await c.env.JOB_WORK.send({
      kind: "complete",
      orgId: principal.orgId,
      runnerId,
      jobId,
      status,
      outputText: body.outputText,
      error: body.error,
      latencyMs: body.latencyMs,
      usage: body.usage,
      artifactKeys: body.artifactKeys,
    } satisfies JobWorkMessage);

    return c.json({ status: "accepted", jobId }, 202);
  })
  .get("/:id/connect", async (c) => {
    if (c.req.raw.headers.get("upgrade") !== "websocket") {
      return c.json({ error: "WebSocket upgrade required" }, 426);
    }
    const principal = await requireRunnerAccessIdentity(c.env.DB, c.env, c.req.raw.headers);
    const runnerId = c.req.param("id");
    const id = c.env.RUNNER_SESSION.idFromName(runnerId);
    const headers = new Headers(c.req.raw.headers);
    headers.set("x-fusion-org-id", principal.orgId);
    headers.set("x-fusion-runner-id", runnerId);
    const upgradeRequest = new Request(c.req.raw.url, { method: c.req.raw.method, headers });
    return c.env.RUNNER_SESSION.get(id).fetch(upgradeRequest);
  });
