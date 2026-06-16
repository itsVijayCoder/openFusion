import { Hono } from "hono";
import { artifactRoutes } from "./routes/artifacts";
import { approvalRoutes } from "./routes/approvals";
import { fusionRunRoutes } from "./routes/fusion-runs";
import { healthRoutes } from "./routes/health";
import { modelRoutes } from "./routes/models";
import { openAiRoutes } from "./routes/openai-compatible";
import { runnerRoutes } from "./routes/runners";
import type { AppBindings } from "./env";

const app = new Hono<AppBindings>();

app.route("/api/health", healthRoutes);
app.route("/api/runners", runnerRoutes);
app.route("/api/models", modelRoutes);
app.route("/api/fusion/runs", fusionRunRoutes);
app.route("/api/artifacts", artifactRoutes);
app.route("/api/approvals", approvalRoutes);
app.route("/v1", openAiRoutes);

export default app;
export { FusionRunDO } from "./durable-objects/FusionRunDO";
export { RunnerSessionDO } from "./durable-objects/RunnerSessionDO";
export { FusionWorkflow } from "./workflows/FusionWorkflow";
