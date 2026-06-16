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

const app = new Hono<{ Bindings: Env }>();

const tools = [runTool, getRunTool, listModelsTool, listRunnersTool, getArtifactsTool, applyPatchTool, cancelRunTool];

app.get("/", (c) =>
  c.json({
    name: "fusion-harness-mcp",
    environment: c.env.ENVIRONMENT,
    transport: "streamable-http",
    tools: tools.map((tool) => ({ name: tool.name, description: tool.description })),
  }),
);

app.post("/mcp", async (c) => {
  const auth = authenticateMcpRequest(c.req.raw.headers);
  const body = await c.req.json().catch(() => ({}));

  return c.json({
    auth,
    status: "mcp_scaffolded",
    request: body,
    apiUrl: c.env.FUSION_API_URL,
  });
});

export default app;
