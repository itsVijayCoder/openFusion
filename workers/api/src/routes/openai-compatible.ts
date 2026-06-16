import { Hono } from "hono";
import type { AppBindings } from "../env";

export const openAiRoutes = new Hono<AppBindings>()
  .get("/models", (c) =>
    c.json({
      object: "list",
      data: [
        { id: "local/fusion", object: "model", owned_by: "fusion-harness" },
        { id: "local/fusion-fast", object: "model", owned_by: "fusion-harness" },
        { id: "local/fusion-quality", object: "model", owned_by: "fusion-harness" },
        { id: "local/fusion-same-provider", object: "model", owned_by: "fusion-harness" },
        { id: "local/opencode", object: "model", owned_by: "fusion-harness" },
        { id: "local/codex", object: "model", owned_by: "fusion-harness" },
      ],
    }),
  )
  .post("/chat/completions", async (c) => {
    const body = await c.req.json().catch(() => ({}));
    return c.json(
      {
        id: `chatcmpl_${crypto.randomUUID()}`,
        object: "chat.completion",
        created: Math.floor(Date.now() / 1000),
        model: body.model ?? "local/fusion",
        choices: [
          {
            index: 0,
            message: {
              role: "assistant",
              content: "Fusion run orchestration is scaffolded but not implemented yet.",
            },
            finish_reason: "stop",
          },
        ],
      },
      202,
    );
  });
