import { sequenceRunnerEvent, type JobWorkMessage } from "../services/job-work";
import type { Env } from "../env";
import type { ClaimedRunnerJob, RunnerEvent } from "@openfusion/shared";

type RunnerJobCompletion = {
  status?: "completed" | "failed" | "timeout" | "cancelled";
  outputObjectKey?: string;
  outputText?: string;
  error?: string;
  latencyMs?: number;
  usage?: Record<string, unknown>;
  artifactKeys?: string[];
};

type ClaimRequest = {
  leaseOwner?: string;
  leaseSeconds?: number;
};

type RunnerMessage =
  | { type: "event"; event: RunnerEvent }
  | { type: "complete"; jobId: string; completion: RunnerJobCompletion }
  | { type: "fail"; jobId: string; completion: RunnerJobCompletion }
  | { type: "started"; jobId: string };

type CloudMessage =
  | { type: "job"; job: ClaimedRunnerJob }
  | { type: "ack"; jobId: string; seq: number }
  | { type: "cancel"; jobId: string; reason?: string }
  | { type: "pause"; jobId: string }
  | { type: "resume"; jobId: string };

type ConnectionAttachment = {
  orgId: string;
  runnerId: string;
};

const LEASE_TAG = "ws-push";

export class RunnerSessionDO {
  constructor(
    private readonly state: DurableObjectState,
    private readonly env: Env,
  ) {}

  async fetch(request: Request): Promise<Response> {
    const url = new URL(request.url);

    if (request.headers.get("upgrade") === "websocket") {
      return this.handleConnect(request, url);
    }

    if (url.pathname.endsWith("/heartbeat")) {
      const body = await request.json().catch(() => ({}));
      const now = new Date().toISOString();
      await this.state.storage.put("last_seen_at", now);
      await this.state.storage.put("last_heartbeat", body);
      return Response.json({ status: "online", lastSeenAt: now, environment: this.env.ENVIRONMENT });
    }

    if (url.pathname.endsWith("/dispatch")) {
      const job = (await request.json().catch(() => null)) as ClaimedRunnerJob | null;
      if (!job?.id || !job.runId || !job.runnerId || !job.payload) {
        return Response.json({ error: "Invalid runner job" }, { status: 400 });
      }

      await this.enqueue(job);
      return Response.json({ status: "queued", jobId: job.id }, { status: 202 });
    }

    if (url.pathname.endsWith("/jobs/claim")) {
      const body = (await request.json().catch(() => ({}))) as ClaimRequest;
      const job = await this.claim(body);
      return Response.json({ job });
    }

    const completionMatch = url.pathname.match(/\/jobs\/([^/]+)\/(complete|fail)$/);
    if (completionMatch) {
      const [, jobId, action] = completionMatch;
      const job = await this.finish(jobId, action === "complete" ? "completed" : "failed");
      return Response.json({ status: job ? "accepted" : "missing", jobId }, { status: job ? 202 : 404 });
    }

    const lifecycleMatch = url.pathname.match(/\/jobs\/([^/]+)\/(pause|resume|cancel)$/);
    if (lifecycleMatch) {
      const [, jobId, action] = lifecycleMatch;
      const job = await this.updateJobLifecycle(jobId, action as "pause" | "resume" | "cancel");
      return Response.json({ status: job ? "accepted" : "missing", jobId }, { status: job ? 202 : 404 });
    }

    if (url.pathname.endsWith("/state")) {
      const [lastSeenAt, queueDepth] = await Promise.all([this.state.storage.get<string>("last_seen_at"), this.queueDepth()]);
      return Response.json({
        status: lastSeenAt ? "online" : "offline",
        lastSeenAt,
        queueDepth,
      });
    }

    return Response.json({ error: "Not found" }, { status: 404 });
  }

  private handleConnect(request: Request, url: URL): Response {
    const orgId = request.headers.get("x-fusion-org-id") ?? "";
    const runnerId = request.headers.get("x-fusion-runner-id") ?? url.pathname.split("/")[2] ?? "";

    const pair = new WebSocketPair();
    const [client, server] = Object.values(pair);

    this.state.acceptWebSocket(server);
    server.serializeAttachment({ orgId, runnerId } satisfies ConnectionAttachment);

    return new Response(null, { status: 101, webSocket: client });
  }

  async webSocketMessage(ws: WebSocket, data: ArrayBuffer | string): Promise<void> {
    const attachment = ws.deserializeAttachment() as ConnectionAttachment | null;
    if (!attachment) {
      return;
    }

    let message: RunnerMessage;
    try {
      message = JSON.parse(typeof data === "string" ? data : new TextDecoder().decode(data)) as RunnerMessage;
    } catch {
      return;
    }

    switch (message.type) {
      case "event":
        await this.handleRunnerEvent(ws, attachment, message.event);
        break;
      case "complete":
      case "fail":
        await this.handleRunnerCompletion(attachment, message);
        break;
      case "started":
        await this.markJobLeased(message.jobId, attachment.runnerId);
        break;
    }
  }

  async webSocketClose(ws: WebSocket, code: number, reason: string): Promise<void> {
    ws.close(code, reason);
  }

  async webSocketError(ws: WebSocket, error: unknown): Promise<void> {
    console.error(JSON.stringify({ level: "error", message: "runner websocket error", error: String(error) }));
    ws.close(1011, "runner websocket error");
  }

  private async handleRunnerEvent(ws: WebSocket, attachment: ConnectionAttachment, event: RunnerEvent): Promise<void> {
    const normalized: RunnerEvent = {
      ...event,
      runnerId: event.runnerId ?? attachment.runnerId,
      timestamp: event.timestamp || new Date().toISOString(),
      data: event.data ?? {},
    };
    const sequenced = await sequenceRunnerEvent(this.env, normalized);
    if (!sequenced) {
      return;
    }

    const ack: CloudMessage = { type: "ack", jobId: sequenced.jobId ?? "", seq: sequenced.seq };
    ws.send(JSON.stringify(ack));

    const work: JobWorkMessage = { kind: "event", orgId: attachment.orgId, event: sequenced };
    await this.env.JOB_WORK.send(work);
  }

  private async handleRunnerCompletion(attachment: ConnectionAttachment, message: Extract<RunnerMessage, { type: "complete" | "fail" }>): Promise<void> {
    const completion = message.completion ?? {};
    const rawStatus = completion.status;
    const status = message.type === "fail"
      ? (rawStatus === "completed" || rawStatus === undefined ? "failed" : rawStatus)
      : (rawStatus ?? "completed");

    const work: JobWorkMessage = {
      kind: "complete",
      orgId: attachment.orgId,
      runnerId: attachment.runnerId,
      jobId: message.jobId,
      status,
      outputText: completion.outputText,
      error: completion.error,
      latencyMs: completion.latencyMs,
      usage: completion.usage,
      artifactKeys: completion.artifactKeys,
    };
    await this.env.JOB_WORK.send(work);
  }

  private async enqueue(job: ClaimedRunnerJob): Promise<void> {
    const nextIndex = ((await this.state.storage.get<number>("queue_count")) ?? 0) + 1;
    const key = `job:${String(nextIndex).padStart(8, "0")}`;
    const now = new Date().toISOString();
    const leaseSeconds = 300;
    const leaseExpiresAt = new Date(Date.now() + leaseSeconds * 1000).toISOString();

    const queued: ClaimedRunnerJob = {
      ...job,
      status: "queued",
      attempt: job.attempt ?? 0,
      createdAt: job.createdAt || now,
    };
    await this.state.storage.put(key, queued);
    await this.state.storage.put(jobIndexKey(job.id), key);
    await this.state.storage.put("queue_count", nextIndex);

    const sockets = this.state.getWebSockets();
    if (sockets.length === 0) {
      return;
    }

    const leased: ClaimedRunnerJob = {
      ...queued,
      status: "leased",
      leaseOwner: LEASE_TAG,
      leaseExpiresAt,
    };
    await this.state.storage.put(key, leased);

    const push: CloudMessage = { type: "job", job: leased };
    for (const ws of sockets) {
      try {
        ws.send(JSON.stringify(push));
      } catch {
        // socket may have closed; lease will expire and claim will re-dispatch
      }
    }
  }

  private async claim(request: ClaimRequest): Promise<ClaimedRunnerJob | null> {
    const now = new Date();
    const leaseSeconds = clampLeaseSeconds(request.leaseSeconds);
    const leaseExpiresAt = new Date(now.getTime() + leaseSeconds * 1000).toISOString();
    const leaseOwner = request.leaseOwner || `lease_${crypto.randomUUID()}`;
    const jobs = await this.state.storage.list<ClaimedRunnerJob>({ prefix: "job:", limit: 100 });

    for (const [key, job] of jobs) {
      if (!isClaimable(job, now)) {
        continue;
      }

      const claimed: ClaimedRunnerJob = {
        ...job,
        status: "leased",
        attempt: (job.attempt ?? 0) + 1,
        leaseOwner,
        leaseExpiresAt,
        payload: {
          ...job.payload,
          attempt: (job.attempt ?? 0) + 1,
        },
      };
      await this.state.storage.put(key, claimed);
      return claimed;
    }

    return null;
  }

  private async markJobLeased(jobId: string, leaseOwner: string): Promise<void> {
    const key = await this.state.storage.get<string>(jobIndexKey(jobId));
    if (!key) return;

    const job = await this.state.storage.get<ClaimedRunnerJob>(key);
    if (!job || job.status !== "queued") return;

    const now = new Date();
    const leaseExpiresAt = new Date(now.getTime() + 300 * 1000).toISOString();
    await this.state.storage.put(key, {
      ...job,
      status: "leased",
      leaseOwner,
      leaseExpiresAt,
    });
  }

  private async finish(jobId: string, status: "completed" | "failed") {
    const key = await this.state.storage.get<string>(jobIndexKey(jobId));
    if (!key) return null;

    const job = await this.state.storage.get<ClaimedRunnerJob>(key);
    if (!job) return null;

    await this.state.storage.put(key, {
      ...job,
      status,
      completedAt: new Date().toISOString(),
    });
    await this.state.storage.delete(jobIndexKey(jobId));
    await this.state.storage.delete(key);
    return job;
  }

  private async updateJobLifecycle(jobId: string, action: "pause" | "resume" | "cancel") {
    const key = await this.state.storage.get<string>(jobIndexKey(jobId));
    if (!key) return null;

    const job = await this.state.storage.get<ClaimedRunnerJob>(key);
    if (!job) return null;

    if (action === "cancel") {
      await this.state.storage.delete(jobIndexKey(jobId));
      await this.state.storage.delete(key);
      this.pushLifecycle(jobId, { type: "cancel", jobId });
      return job;
    }

    if (action === "pause") {
      this.pushLifecycle(jobId, { type: "pause", jobId });
    } else {
      this.pushLifecycle(jobId, { type: "resume", jobId });
    }

    const status = action === "pause" ? "paused" : "queued";
    await this.state.storage.put(key, {
      ...job,
      status,
    });
    return job;
  }

  private pushLifecycle(jobId: string, message: CloudMessage): void {
    for (const ws of this.state.getWebSockets()) {
      try {
        ws.send(JSON.stringify(message));
      } catch {
        // socket closed; lifecycle will reconcile on reconnect
      }
    }
  }

  private async queueDepth() {
    const jobs = await this.state.storage.list<ClaimedRunnerJob>({ prefix: "job:", limit: 100 });
    return jobs.size;
  }
}

function jobIndexKey(jobId: string) {
  return `job_index:${jobId}`;
}

function clampLeaseSeconds(value: number | undefined) {
  if (!value || Number.isNaN(value)) return 120;
  return Math.min(Math.max(Math.trunc(value), 30), 900);
}

function isClaimable(job: ClaimedRunnerJob, now: Date) {
  if (job.status === "queued") return true;
  if (job.status !== "leased" || !job.leaseExpiresAt) return false;
  return new Date(job.leaseExpiresAt).getTime() <= now.getTime();
}