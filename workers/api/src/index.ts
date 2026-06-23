import { Hono } from "hono";
import { cors } from "hono/cors";
import { ZodError } from "zod";
import { artifactRoutes } from "./routes/artifacts";
import { approvalRoutes } from "./routes/approvals";
import { authRoutes } from "./routes/auth";
import { dashboardRoutes } from "./routes/dashboard";
import { fusionRunRoutes } from "./routes/fusion-runs";
import { githubRoutes } from "./routes/github";
import { githubWebhookRoutes } from "./routes/github-webhook";
import { healthRoutes } from "./routes/health";
import { modelRoutes } from "./routes/models";
import { openAiRoutes } from "./routes/openai-compatible";
import { prReviewRoutes } from "./routes/pr-reviews";
import { runnerRoutes } from "./routes/runners";
import { workspaceRoutes } from "./routes/workspaces";
import { AuthenticationError } from "./services/auth";
import type { AppBindings } from "./env";

const app = new Hono<AppBindings>();

app.use(
  "*",
  cors({
    origin: (origin, c) => allowedOrigin(origin, c.env.PUBLIC_APP_URL),
    allowHeaders: ["authorization", "content-type", "x-fusion-dev-email", "x-fusion-dev-name", "x-github-event", "x-github-delivery", "x-hub-signature-256"],
    allowMethods: ["GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"],
    credentials: true,
  }),
);

app.use("*", async (c, next) => {
  if (!requiresOriginCheck(c.req.method)) {
    return next();
  }
  if (c.req.path === "/api/github/webhook") {
    return next();
  }
  if (c.req.header("authorization")?.match(/^Bearer\s+/i)) {
    return next();
  }
  if (c.env.ENVIRONMENT !== "production" && c.req.path.startsWith("/api/runners")) {
    return next();
  }

  const origin = c.req.header("origin");
  if (!origin || allowedOrigin(origin, c.env.PUBLIC_APP_URL) !== origin) {
    return c.json({ error: "Invalid request origin" }, 403);
  }

  return next();
});

app.route("/api/health", healthRoutes);
app.route("/api/auth", authRoutes);
app.route("/api/dashboard", dashboardRoutes);
app.route("/api/runners", runnerRoutes);
app.route("/api/models", modelRoutes);
app.route("/api/fusion/runs", fusionRunRoutes);
app.route("/api/artifacts", artifactRoutes);
app.route("/api/approvals", approvalRoutes);
app.route("/api/workspaces", workspaceRoutes);
app.route("/api/github", githubRoutes);
app.route("/api/github", githubWebhookRoutes);
app.route("/api/pr-reviews", prReviewRoutes);
app.route("/v1", openAiRoutes);

app.notFound((c) => c.json({ error: "Not found" }, 404));

app.onError((error, c) => {
  if (error instanceof AuthenticationError) {
    return c.json({ error: error.message }, error.statusCode);
  }
  if (error instanceof ZodError) {
    return c.json({ error: "Invalid request", issues: error.issues }, 400);
  }

  console.error(JSON.stringify({
    level: "error",
    message: error.message,
    name: error.name,
    stack: error.stack,
    path: c.req.path,
    method: c.req.method,
  }));
  return c.json({ error: "Internal server error", detail: error.message }, 500);
});

export default app;
export { FusionRunDO } from "./durable-objects/FusionRunDO";
export { RunnerSessionDO } from "./durable-objects/RunnerSessionDO";
export { FusionWorkflow } from "./workflows/FusionWorkflow";

function allowedOrigin(origin: string | undefined, publicAppUrl: string) {
  if (!origin) return publicAppUrl;
  if (origin === publicAppUrl) return origin;

  try {
    const url = new URL(origin);
    if (url.hostname === "localhost" || url.hostname === "127.0.0.1" || url.hostname === "::1") {
      return origin;
    }
  } catch {
    // fall through
  }

  return publicAppUrl;
}

function requiresOriginCheck(method: string) {
  return method !== "GET" && method !== "HEAD" && method !== "OPTIONS";
}
