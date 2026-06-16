import type { Env } from "../env";

export class FusionRunDO {
  constructor(
    private readonly state: DurableObjectState,
    private readonly env: Env,
  ) {}

  async fetch(request: Request): Promise<Response> {
    const url = new URL(request.url);

    if (url.pathname.endsWith("/events")) {
      return Response.json({ status: "events_not_started", sockets: 0 });
    }

    if (url.pathname.endsWith("/start")) {
      const payload = await request.json().catch(() => ({}));
      await this.state.storage.put("last_start_payload", payload);
      return Response.json({ status: "started" }, { status: 202 });
    }

    if (url.pathname.endsWith("/runner-event")) {
      const event = await request.json().catch(() => ({}));
      await this.state.storage.put(`event:${Date.now()}`, event);
      return Response.json({ status: "accepted" }, { status: 202 });
    }

    return Response.json({ error: "Not found", environment: this.env.ENVIRONMENT }, { status: 404 });
  }
}
