import { listModels } from "@fusion-harness/db";
import { fusionRunRequestSchema, type ChatMessage, type FusionMode, type PermissionProfile } from "@fusion-harness/shared";
import { Hono } from "hono";
import type { AppBindings } from "../env";
import { localModelAliases } from "./models";
import { requireAccessIdentity } from "../services/auth";
import { createRunFromRequest } from "../services/runs";

type OpenAIChatCompletionRequest = {
  model?: string;
  messages?: ChatMessage[];
  stream?: boolean;
  fusion?: {
    mode?: FusionMode;
    preset?: string;
    provider_policy?: "same_provider_first" | "mixed_quality" | "manual";
    permission_profile?: PermissionProfile;
    analysis_models?: string[];
    judge_model?: string;
    final_model?: string;
    timeout_ms?: number;
  };
};

export const openAiRoutes = new Hono<AppBindings>()
  .get("/models", async (c) => {
    const principal = await requireAccessIdentity(c.env.DB, c.env, c.req.raw.headers);
    const discoveredModels = await listModels(c.env.DB, principal.orgId);

    return c.json({
      object: "list",
      data: [
        ...localModelAliases,
        ...discoveredModels.map((model) => ({
          id: `${model.adapter}/${model.model}`,
          object: "model",
          owned_by: model.provider ?? model.adapter,
        })),
      ],
    });
  })
  .post("/chat/completions", async (c) => {
    const principal = await requireAccessIdentity(c.env.DB, c.env, c.req.raw.headers);
    const body = (await c.req.json().catch(() => ({}))) as OpenAIChatCompletionRequest;
    const fusion = body.fusion ?? {};
    const payload = fusionRunRequestSchema.parse({
      mode: fusion.mode ?? inferMode(body.model),
      preset: fusion.preset ?? inferPreset(body.model),
      messages: body.messages ?? [],
      permissionProfile: fusion.permission_profile ?? "readonly",
      providerPolicy: fusion.provider_policy ?? "same_provider_first",
      analysisModels: fusion.analysis_models,
      judgeModel: fusion.judge_model,
      finalModel: fusion.final_model,
      stream: body.stream,
      timeoutMs: fusion.timeout_ms,
    });
    const { run } = await createRunFromRequest(c.env, principal, payload);
    const content = `Fusion run ${run.id} queued with preset ${run.preset ?? "same-provider-first"}.`;

    if (body.stream) {
      return streamQueuedRun(run.id, body.model ?? "local/fusion", content);
    }

    return c.json(
      {
        id: `chatcmpl_${run.id}`,
        object: "chat.completion",
        created: Math.floor(Date.now() / 1000),
        model: body.model ?? "local/fusion",
        choices: [
          {
            index: 0,
            message: {
              role: "assistant",
              content,
            },
            finish_reason: "stop",
          },
        ],
        fusion_run_id: run.id,
      },
      202,
    );
  });

function inferMode(model?: string): FusionMode {
  if (model === "local/opencode" || model === "local/codex") return "direct";
  if (model === "local/fusion-fast") return "auto";
  return "required";
}

function inferPreset(model?: string) {
  switch (model) {
    case "local/fusion-fast":
      return "fast";
    case "local/fusion-quality":
      return "mixed-coding";
    case "local/fusion-same-provider":
      return "same-provider-first";
    case "local/opencode":
      return "opencode-quality";
    case "local/codex":
      return "codex-quality";
    default:
      return "same-provider-first";
  }
}

function streamQueuedRun(runId: string, model: string, content: string) {
  const encoder = new TextEncoder();
  const created = Math.floor(Date.now() / 1000);
  const stream = new ReadableStream({
    start(controller) {
      controller.enqueue(
        encoder.encode(
          `data: ${JSON.stringify({
            id: `chatcmpl_${runId}`,
            object: "chat.completion.chunk",
            created,
            model,
            choices: [{ index: 0, delta: { content }, finish_reason: null }],
            fusion_run_id: runId,
          })}\n\n`,
        ),
      );
      controller.enqueue(
        encoder.encode(
          `data: ${JSON.stringify({
            id: `chatcmpl_${runId}`,
            object: "chat.completion.chunk",
            created,
            model,
            choices: [{ index: 0, delta: {}, finish_reason: "stop" }],
            fusion_run_id: runId,
          })}\n\n`,
        ),
      );
      controller.enqueue(encoder.encode("data: [DONE]\n\n"));
      controller.close();
    },
  });

  return new Response(stream, {
    status: 202,
    headers: {
      "content-type": "text/event-stream; charset=utf-8",
      "cache-control": "no-cache",
      connection: "keep-alive",
    },
  });
}
