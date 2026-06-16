import type { Env } from "../env";

export class RunnerSessionDO {
  constructor(
    private readonly state: DurableObjectState,
    private readonly env: Env,
  ) {}

  async fetch(request: Request): Promise<Response> {
    const url = new URL(request.url);

    if (url.pathname.endsWith("/heartbeat")) {
      await this.state.storage.put("last_seen_at", new Date().toISOString());
      return Response.json({ status: "online", environment: this.env.ENVIRONMENT });
    }

    return Response.json({ error: "Not found" }, { status: 404 });
  }
}
