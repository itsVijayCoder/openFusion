import { Hono } from "hono";
import { authenticateMcpRequest } from "./auth";
import { applyPatchTool } from "./tools/fusion-apply-patch";
import { cancelRunTool } from "./tools/fusion-cancel-run";
import { getArtifactsTool } from "./tools/fusion-get-artifacts";
import { getRunTool } from "./tools/fusion-get-run";
import { listModelsTool } from "./tools/fusion-list-models";
import { listRunnersTool } from "./tools/fusion-list-runners";
import { runTool } from "./tools/fusion-run";

type Env = {
  ENVIRONMENT: string;
  FUSION_API_URL: string;
};

type JsonRpcRequest = {
  jsonrpc?: "2.0";
  id?: string | number | null;
  method?: string;
  params?: {
    name?: string;
    arguments?: Record<string, unknown>;
  };
};

type ToolDefinition = {
  name: string;
  description: string;
  inputSchema?: Record<string, unknown>;
};

const app = new Hono<{ Bindings: Env }>();

const tools = [runTool, getRunTool, listModelsTool, listRunnersTool, getArtifactsTool, applyPatchTool, cancelRunTool] satisfies ToolDefinition[];

app.get("/", (c) =>
  c.json({
    name: "fusion-harness-mcp",
    environment: c.env.ENVIRONMENT,
    transport: "streamable-http",
    endpoint: "/mcp",
    tools,
  }),
);

app.post("/mcp", async (c) => {
  const auth = authenticateMcpRequest(c.req.raw.headers);
  if (!auth.authenticated) {
    return c.json(rpcError(null, -32001, "Authentication required"), 401);
  }

  const body = (await c.req.json().catch(() => ({}))) as JsonRpcRequest;

  if (body.method === "tools/list") {
    return c.json(rpcResult(body.id, { tools }));
  }

  if (body.method === "tools/call") {
    const name = body.params?.name;
    const args = body.params?.arguments ?? {};
    if (!name) {
      return c.json(rpcError(body.id, -32602, "Tool name is required"), 400);
    }

    try {
      const result = await callTool(c.env, c.req.raw.headers, name, args);
      return c.json(rpcResult(body.id, toMcpContent(result)));
    } catch (error) {
      return c.json(rpcError(body.id, -32000, error instanceof Error ? error.message : "Tool call failed"), 500);
    }
  }

  return c.json(rpcError(body.id, -32601, "Unsupported MCP method"), 404);
});

export default app;

async function callTool(env: Env, headers: Headers, name: string, args: Record<string, unknown>) {
  switch (name) {
    case "fusion.run":
      return fusionApi(env, headers, "/api/fusion/runs", {
        method: "POST",
        body: {
          mode: stringArg(args, "mode") ?? "auto",
          preset: stringArg(args, "preset") ?? "same-provider-first",
          workspaceId: stringArg(args, "workspace_id"),
          permissionProfile: stringArg(args, "permission_profile") ?? "readonly",
          stream: Boolean(args.stream),
          messages: [{ role: "user", content: requiredStringArg(args, "prompt") }],
        },
      });
    case "fusion.get_run":
      return fusionApi(env, headers, `/api/fusion/runs/${requiredStringArg(args, "run_id")}`, { method: "GET" });
    case "fusion.list_models":
      return fusionApi(env, headers, "/api/models", { method: "GET" });
    case "fusion.list_runners":
      return fusionApi(env, headers, "/api/runners", { method: "GET" });
    case "fusion.get_artifacts":
      return fusionApi(env, headers, `/api/artifacts/runs/${requiredStringArg(args, "run_id")}`, { method: "GET" });
    case "fusion.apply_patch":
      return fusionApi(env, headers, `/api/approvals/${requiredStringArg(args, "run_id")}`, {
        method: "POST",
        body: {
          action: stringArg(args, "action") ?? "grant",
          reason: stringArg(args, "reason"),
        },
      });
    case "fusion.cancel_run":
      return fusionApi(env, headers, `/api/fusion/runs/${requiredStringArg(args, "run_id")}/cancel`, { method: "POST" });
    default:
      throw new Error(`Unknown tool: ${name}`);
  }
}

async function fusionApi(env: Env, inboundHeaders: Headers, path: string, init: { method: "GET" | "POST"; body?: unknown }) {
  const headers = new Headers({
    accept: "application/json",
  });
  const devEmail = inboundHeaders.get("x-fusion-dev-email") ?? inboundHeaders.get("cf-access-authenticated-user-email");
  const devName = inboundHeaders.get("x-fusion-dev-name");
  if (devEmail) headers.set("x-fusion-dev-email", devEmail);
  if (devName) headers.set("x-fusion-dev-name", devName);
  if (init.body !== undefined) headers.set("content-type", "application/json");

  const response = await fetch(`${env.FUSION_API_URL.replace(/\/$/, "")}${path}`, {
    method: init.method,
    headers,
    body: init.body === undefined ? undefined : JSON.stringify(init.body),
  });
  const text = await response.text();
  const data = parseJson(text);

  if (!response.ok) {
    throw new Error(typeof data === "object" && data && "error" in data ? String(data.error) : `Fusion API returned ${response.status}`);
  }

  return data;
}

function rpcResult(id: JsonRpcRequest["id"], result: unknown) {
  return {
    jsonrpc: "2.0",
    id: id ?? null,
    result,
  };
}

function rpcError(id: JsonRpcRequest["id"], code: number, message: string) {
  return {
    jsonrpc: "2.0",
    id: id ?? null,
    error: {
      code,
      message,
    },
  };
}

function toMcpContent(result: unknown) {
  return {
    content: [
      {
        type: "text",
        text: typeof result === "string" ? result : JSON.stringify(result, null, 2),
      },
    ],
  };
}

function requiredStringArg(args: Record<string, unknown>, key: string) {
  const value = stringArg(args, key);
  if (!value) {
    throw new Error(`${key} is required`);
  }
  return value;
}

function stringArg(args: Record<string, unknown>, key: string) {
  const value = args[key];
  return typeof value === "string" && value.trim() ? value : undefined;
}

function parseJson(text: string) {
  try {
    return JSON.parse(text) as unknown;
  } catch {
    return text;
  }
}
