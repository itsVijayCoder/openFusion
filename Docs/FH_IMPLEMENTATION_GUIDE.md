# Fusion Harness — Implementation Guide

**Document status:** v1.0 implementation blueprint  
**Prepared for:** Internal engineering team  
**Current date:** 2026-06-16  
**Goal:** Build a production-ready internal multi-model fusion chatbot and coding agent platform using Cloudflare, Next.js, Go, OpenCode, Codex, and optional Docker execution.

---

## 1. System Summary

Fusion Harness has two planes:

1. **Cloud control plane**
   - Next.js web app
   - Cloudflare Worker API
   - D1 metadata DB
   - Durable Objects for live run coordination
   - KV for cache/config
   - R2 for artifacts
   - Workflows for durable background jobs
   - AI Gateway for API-key model calls
   - Remote MCP server

2. **Local execution plane**
   - Go runner installed on team machines or internal hosts
   - OpenCode adapter
   - Codex adapter
   - host executor
   - Docker executor
   - workspace permission engine
   - artifact uploader

```text
Cloud decides and coordinates.
Runner detects and executes.
R2 stores large outputs.
D1 indexes metadata.
Durable Objects stream live state.
```

---

## 2. Monorepo Layout

```text
fusion-harness/
  apps/
    web/
      app/
      components/
      features/
      lib/
      stores/
      queries/
      public/
      wrangler.toml
      open-next.config.ts

    desktop/
      README.md
      # Later: Tauri or Electron wrapper around web UI + local runner

    runner-go/
      cmd/
        fusion-runner/
          main.go
      internal/
        cloud/
        config/
        discovery/
        adapters/
          opencode/
          codex/
        executors/
          host/
          docker/
        permissions/
        workspace/
        artifacts/
        audit/
        updater/
      go.mod
      go.sum

  workers/
    api/
      src/
        index.ts
        env.ts
        routes/
          health.ts
          runners.ts
          models.ts
          fusion-runs.ts
          openai-compatible.ts
          artifacts.ts
          approvals.ts
        durable-objects/
          FusionRunDO.ts
          RunnerSessionDO.ts
        workflows/
          FusionWorkflow.ts
        services/
          auth.ts
          model-selection.ts
          artifact-store.ts
          audit.ts
      wrangler.toml

    mcp/
      src/
        index.ts
        auth.ts
        tools/
          fusion-run.ts
          fusion-get-run.ts
          fusion-list-models.ts
          fusion-list-runners.ts
          fusion-get-artifacts.ts
      wrangler.toml

  packages/
    core/
      src/
        fusion/
          planner.ts
          orchestrator.ts
          judge.ts
          final-writer.ts
          prompt-builder.ts
        models/
          registry.ts
          selection.ts
        permissions/
          policy.ts
        runs/
          events.ts
          schema.ts

    db/
      migrations/
      schema.sql
      drizzle.config.ts
      src/
        client.ts
        queries.ts

    shared/
      src/
        types.ts
        ids.ts
        errors.ts
        zod.ts
        events.ts

    ui/
      components/
      theme/

  configs/
    presets.yaml
    permissions.yaml
    provider-catalog.yaml

  docs/
    architecture.md
    security.md
    local-runner.md
    cloudflare-deploy.md
    api.md
    mcp.md
```

---

## 3. Technology Choices

| Layer | Technology | Reason |
|---|---|---|
| Web app | Next.js | Full-stack React app; deployable to Cloudflare Workers through OpenNext.[^cf-next] |
| UI state | Zustand | Lightweight local UI state, selected runner/model/preset, drawer state.[^zustand] |
| Server state | TanStack Query | API fetching/caching/mutations for runs, models, runners, artifacts.[^tanstack-query] |
| UI components | shadcn/ui | Copy-in customizable component base, useful for internal product speed.[^shadcn] |
| Cloud API | Cloudflare Workers | API routing, streaming, auth middleware, OpenAI-compatible endpoints. |
| Live sessions | Durable Objects | Stateful coordination, WebSockets, per-run state.[^cf-do] |
| SQL metadata | D1 | Serverless SQL for orgs/users/runs/models/runners.[^cf-d1] |
| Artifacts | R2 | Large object storage for traces, patches, logs, generated files.[^cf-r2] |
| Config cache | KV | Read-heavy non-critical config cache; avoid critical state due to eventual consistency.[^cf-kv] |
| Durable jobs | Workflows | Multi-step jobs with retries and persisted state.[^cf-workflows] |
| AI API routing | AI Gateway | Analytics, caching, rate limiting, retries, fallback.[^cf-ai-gateway] |
| Runner | Go | Native cross-platform binary and strong process execution support.[^go-exec][^go-cross] |
| Sandboxed commands | Docker | Optional per-job container isolation for test/build commands.[^docker-security] |
| First agents | OpenCode, Codex | Both support local coding workflows; OpenCode has CLI/server modes, Codex has CLI execution/sandbox docs.[^opencode-cli][^opencode-server][^codex-cli][^codex-sandbox] |

---

## 4. Local Development Setup

### 4.1 Required tools

```bash
node --version
pnpm --version
go version
wrangler --version
docker --version
```

Recommended versions:

```text
Node.js: 22+
pnpm: 10+
Go: 1.24+
Docker Desktop / Docker Engine: current stable
Wrangler: current stable
```

### 4.2 First setup

```bash
git clone <repo-url> fusion-harness
cd fusion-harness
pnpm install
pnpm cf:login
pnpm db:migrate:local
pnpm dev
```

### 4.3 Runner local dev

```bash
cd apps/runner-go
go mod tidy
go run ./cmd/fusion-runner doctor
go run ./cmd/fusion-runner discover
go run ./cmd/fusion-runner serve --cloud-url http://localhost:8787
```

---

## 5. Cloudflare Resources

Create these resources per environment:

```text
dev
staging
prod
```

Each environment needs:

- D1 database
- KV namespace
- R2 bucket
- Durable Object namespaces
- Worker API
- Worker MCP
- AI Gateway
- Cloudflare Access application
- optional Queue for run events
- optional Workflows binding

### 5.1 API Worker `wrangler.toml`

```toml
name = "fusion-api"
main = "src/index.ts"
compatibility_date = "2026-06-16"
compatibility_flags = ["nodejs_compat"]

[vars]
ENVIRONMENT = "dev"
PUBLIC_APP_URL = "http://localhost:3000"

[[d1_databases]]
binding = "DB"
database_name = "fusion_harness_dev"
database_id = "REPLACE_ME"

[[kv_namespaces]]
binding = "CONFIG_KV"
id = "REPLACE_ME"

[[r2_buckets]]
binding = "ARTIFACTS"
bucket_name = "fusion-artifacts-dev"

[[durable_objects.bindings]]
name = "FUSION_RUN"
class_name = "FusionRunDO"

[[durable_objects.bindings]]
name = "RUNNER_SESSION"
class_name = "RunnerSessionDO"

[[workflows]]
binding = "FUSION_WORKFLOW"
name = "fusion-workflow"
class_name = "FusionWorkflow"
```

### 5.2 Next.js app deployment

Cloudflare supports deploying Next.js apps to Workers using the OpenNext adapter.[^cf-next]

```bash
cd apps/web
pnpm add -D @opennextjs/cloudflare wrangler
```

`open-next.config.ts`:

```ts
import { defineCloudflareConfig } from "@opennextjs/cloudflare";

export default defineCloudflareConfig({});
```

`package.json` scripts:

```json
{
  "scripts": {
    "dev": "next dev",
    "build": "next build",
    "preview": "opennextjs-cloudflare build && wrangler dev",
    "deploy": "opennextjs-cloudflare build && wrangler deploy"
  }
}
```

---

## 6. Database Schema

Use D1 for metadata. Store large content in R2 and only keep object keys in D1.

```sql
CREATE TABLE orgs (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE users (
  id TEXT PRIMARY KEY,
  org_id TEXT NOT NULL,
  email TEXT NOT NULL,
  name TEXT,
  role TEXT NOT NULL CHECK (role IN ('owner', 'admin', 'developer', 'viewer')),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  FOREIGN KEY (org_id) REFERENCES orgs(id)
);

CREATE TABLE workspaces (
  id TEXT PRIMARY KEY,
  org_id TEXT NOT NULL,
  name TEXT NOT NULL,
  repo_url TEXT,
  default_branch TEXT,
  default_runner_pool TEXT,
  permission_profile TEXT NOT NULL DEFAULT 'readonly',
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  FOREIGN KEY (org_id) REFERENCES orgs(id)
);

CREATE TABLE runners (
  id TEXT PRIMARY KEY,
  org_id TEXT NOT NULL,
  user_id TEXT,
  name TEXT NOT NULL,
  os TEXT NOT NULL,
  arch TEXT NOT NULL,
  version TEXT NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('online', 'offline', 'disabled')),
  capabilities_json TEXT NOT NULL,
  last_seen_at TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  FOREIGN KEY (org_id) REFERENCES orgs(id)
);

CREATE TABLE installed_tools (
  id TEXT PRIMARY KEY,
  runner_id TEXT NOT NULL,
  tool TEXT NOT NULL CHECK (tool IN ('opencode', 'codex', 'docker', 'git', 'custom')),
  version TEXT,
  path TEXT,
  status TEXT NOT NULL CHECK (status IN ('detected', 'verified', 'unavailable', 'error')),
  metadata_json TEXT,
  detected_at TEXT NOT NULL,
  FOREIGN KEY (runner_id) REFERENCES runners(id)
);

CREATE TABLE models (
  id TEXT PRIMARY KEY,
  org_id TEXT NOT NULL,
  runner_id TEXT,
  adapter TEXT NOT NULL,
  provider TEXT,
  model TEXT NOT NULL,
  display_name TEXT,
  auth_mode TEXT NOT NULL CHECK (auth_mode IN ('cli_session', 'api_key', 'cloud_gateway', 'unknown')),
  availability TEXT NOT NULL CHECK (availability IN ('detected', 'listed', 'verified', 'configured_unverified', 'unavailable')),
  capabilities_json TEXT NOT NULL,
  verified_at TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  FOREIGN KEY (org_id) REFERENCES orgs(id),
  FOREIGN KEY (runner_id) REFERENCES runners(id)
);

CREATE TABLE fusion_runs (
  id TEXT PRIMARY KEY,
  org_id TEXT NOT NULL,
  workspace_id TEXT,
  user_id TEXT NOT NULL,
  runner_id TEXT,
  status TEXT NOT NULL CHECK (status IN ('queued', 'running', 'waiting_approval', 'completed', 'failed', 'cancelled')),
  mode TEXT NOT NULL CHECK (mode IN ('direct', 'auto', 'required')),
  preset TEXT,
  permission_profile TEXT NOT NULL,
  prompt_object_key TEXT,
  judge_object_key TEXT,
  final_object_key TEXT,
  error TEXT,
  created_at TEXT NOT NULL,
  started_at TEXT,
  completed_at TEXT,
  FOREIGN KEY (org_id) REFERENCES orgs(id),
  FOREIGN KEY (workspace_id) REFERENCES workspaces(id),
  FOREIGN KEY (user_id) REFERENCES users(id),
  FOREIGN KEY (runner_id) REFERENCES runners(id)
);

CREATE TABLE panel_outputs (
  id TEXT PRIMARY KEY,
  run_id TEXT NOT NULL,
  model_id TEXT NOT NULL,
  adapter TEXT NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('queued', 'running', 'completed', 'failed', 'timeout', 'cancelled')),
  output_object_key TEXT,
  error TEXT,
  latency_ms INTEGER,
  usage_json TEXT,
  created_at TEXT NOT NULL,
  completed_at TEXT,
  FOREIGN KEY (run_id) REFERENCES fusion_runs(id),
  FOREIGN KEY (model_id) REFERENCES models(id)
);

CREATE TABLE artifacts (
  id TEXT PRIMARY KEY,
  org_id TEXT NOT NULL,
  run_id TEXT NOT NULL,
  kind TEXT NOT NULL,
  object_key TEXT NOT NULL,
  content_type TEXT,
  size_bytes INTEGER,
  sha256 TEXT,
  created_at TEXT NOT NULL,
  FOREIGN KEY (org_id) REFERENCES orgs(id),
  FOREIGN KEY (run_id) REFERENCES fusion_runs(id)
);

CREATE TABLE audit_events (
  id TEXT PRIMARY KEY,
  org_id TEXT NOT NULL,
  user_id TEXT,
  runner_id TEXT,
  run_id TEXT,
  event_type TEXT NOT NULL,
  severity TEXT NOT NULL DEFAULT 'info',
  metadata_json TEXT,
  created_at TEXT NOT NULL,
  FOREIGN KEY (org_id) REFERENCES orgs(id)
);

CREATE INDEX idx_runners_org_status ON runners(org_id, status);
CREATE INDEX idx_models_org_adapter ON models(org_id, adapter);
CREATE INDEX idx_fusion_runs_org_created ON fusion_runs(org_id, created_at DESC);
CREATE INDEX idx_panel_outputs_run ON panel_outputs(run_id);
CREATE INDEX idx_audit_org_created ON audit_events(org_id, created_at DESC);
```

---

## 7. Core Shared Types

`packages/shared/src/types.ts`:

```ts
export type AdapterId = "opencode" | "codex" | "api-key" | "cloudflare-ai-gateway";

export type AuthMode = "cli_session" | "api_key" | "cloud_gateway" | "unknown";

export type ModelAvailability =
  | "detected"
  | "listed"
  | "verified"
  | "configured_unverified"
  | "unavailable";

export type PermissionProfile = "readonly" | "workspace_write" | "trusted_internal";

export type FusionMode = "direct" | "auto" | "required";

export type RunStatus =
  | "queued"
  | "running"
  | "waiting_approval"
  | "completed"
  | "failed"
  | "cancelled";

export type ModelRef = {
  id: string;
  adapter: AdapterId;
  provider?: string;
  model: string;
  displayName?: string;
  authMode: AuthMode;
  availability: ModelAvailability;
  capabilities: {
    streaming: boolean;
    tools: boolean;
    fileEdits: boolean;
    shell: boolean;
    jsonOutput: boolean;
    modelListing: boolean;
  };
};

export type FusionRunRequest = {
  workspaceId?: string;
  mode: FusionMode;
  preset?: string;
  messages: Array<{ role: "system" | "user" | "assistant"; content: string }>;
  permissionProfile: PermissionProfile;
  providerPolicy?: "same_provider_first" | "mixed_quality" | "manual";
  analysisModels?: string[];
  judgeModel?: string;
  finalModel?: string;
  stream?: boolean;
  timeoutMs?: number;
};
```

---

## 8. Fusion Pipeline

### 8.1 Pipeline states

```text
created
queued
planning
dispatching_panel
panel_running
judging
final_writing
artifact_collection
completed
```

### 8.2 Run sequence

```mermaid
sequenceDiagram
  participant UI as Web App
  participant API as Worker API
  participant DO as FusionRunDO
  participant R as Go Runner
  participant OC as OpenCode/Codex
  participant R2 as R2
  participant DB as D1

  UI->>API: POST /api/fusion/runs
  API->>DB: insert fusion_runs
  API->>DO: start run
  DO->>DO: select models
  DO->>R: dispatch panel jobs
  R->>OC: run adapter commands
  OC-->>R: stream output/events
  R-->>DO: stream run events
  R->>R2: upload panel outputs
  DO->>DB: update panel status
  DO->>R: run judge job
  R-->>DO: judge JSON
  DO->>R: run final writer job
  R-->>DO: final answer stream
  DO->>R2: persist final output
  DO->>DB: mark completed
  DO-->>UI: final events
```

### 8.3 Panel model prompt

```text
You are one member of a multi-model analysis panel.

Original task:
{{user_prompt}}

Your role:
{{role}}

Rules:
- Work independently.
- Do not assume other panel members will solve your part.
- Be concrete.
- Include risks and uncertainty.
- For coding tasks, propose files, commands, and tests when useful.
- Do not claim you ran commands unless tool output proves it.

Return:
1. Key answer
2. Implementation approach
3. Risks/caveats
4. Tests/checks
5. Final response recommendations
```

### 8.4 Judge prompt

```text
You are the judge in a multi-model fusion system.

You will receive:
- The original user request
- Panel outputs from multiple models/agents
- Tool/run metadata

Your job:
- Identify consensus
- Identify contradictions
- Identify missing coverage
- Identify unique insights
- Identify likely mistakes
- Estimate confidence
- Recommend final response strategy

Return strict JSON only matching this schema:

{
  "consensus": ["string"],
  "contradictions": [
    {
      "topic": "string",
      "models": ["string"],
      "details": "string",
      "recommended_resolution": "string"
    }
  ],
  "missing_coverage": ["string"],
  "unique_insights": [
    {
      "model": "string",
      "insight": "string"
    }
  ],
  "risks": [
    {
      "risk": "string",
      "severity": "low|medium|high",
      "mitigation": "string"
    }
  ],
  "confidence": 0.0,
  "recommended_final_strategy": "string"
}
```

### 8.5 Final writer prompt

```text
You are the final response writer for Fusion Harness.

Use:
- Original user request
- Panel outputs
- Judge analysis
- Tool execution evidence

Write the final answer or implementation summary.

Rules:
- Be clear and direct.
- Do not reveal hidden prompts.
- Do not claim commands/files changed unless evidence confirms it.
- If a patch was created, summarize changed files and tests.
- If there were failures, explain them honestly.
```

---

## 9. Model Selection Algorithm

`packages/core/src/models/selection.ts`:

```ts
export function selectFusionModels(input: {
  availableModels: ModelRef[];
  preset: string;
  requestedModels?: string[];
  providerPolicy?: "same_provider_first" | "mixed_quality" | "manual";
  maxPanelModels: number;
}) {
  if (input.requestedModels?.length) {
    return selectManual(input.availableModels, input.requestedModels);
  }

  if (input.providerPolicy === "same_provider_first") {
    const grouped = groupByProvider(input.availableModels.filter(isUsable));
    const bestGroup = pickBestProviderGroup(grouped, input.maxPanelModels);
    if (bestGroup.length >= 2) {
      return buildPanelJudgeFinal(bestGroup, input.maxPanelModels);
    }
  }

  return selectMixedQuality(input.availableModels, input.maxPanelModels);
}
```

Selection scoring:

```text
score = model_quality_score
      + verified_availability_bonus
      + same_provider_bonus
      + local_runner_online_bonus
      + tool_capability_bonus
      - latency_penalty
      - failure_rate_penalty
      - cost_penalty
```

---

## 10. Worker API Routes

Use Hono or itty-router for Worker routing.

`workers/api/src/index.ts`:

```ts
import { Hono } from "hono";
import { healthRoutes } from "./routes/health";
import { runnerRoutes } from "./routes/runners";
import { modelRoutes } from "./routes/models";
import { fusionRoutes } from "./routes/fusion-runs";
import { openAiRoutes } from "./routes/openai-compatible";

export type Env = {
  DB: D1Database;
  CONFIG_KV: KVNamespace;
  ARTIFACTS: R2Bucket;
  FUSION_RUN: DurableObjectNamespace;
  RUNNER_SESSION: DurableObjectNamespace;
  ENVIRONMENT: string;
};

const app = new Hono<{ Bindings: Env }>();

app.route("/api/health", healthRoutes);
app.route("/api/runners", runnerRoutes);
app.route("/api/models", modelRoutes);
app.route("/api/fusion/runs", fusionRoutes);
app.route("/v1", openAiRoutes);

export default app;
export { FusionRunDO } from "./durable-objects/FusionRunDO";
export { RunnerSessionDO } from "./durable-objects/RunnerSessionDO";
export { FusionWorkflow } from "./workflows/FusionWorkflow";
```

---

## 11. Durable Object Design

### 11.1 `FusionRunDO`

Responsibilities:

- maintain live run state
- accept UI WebSocket subscriptions
- accept runner event streams
- dispatch jobs to runner sessions
- buffer recent events
- update D1 status
- trigger finalization

Pseudo-implementation:

```ts
export class FusionRunDO {
  state: DurableObjectState;
  env: Env;
  sockets = new Set<WebSocket>();

  constructor(state: DurableObjectState, env: Env) {
    this.state = state;
    this.env = env;
  }

  async fetch(request: Request): Promise<Response> {
    const url = new URL(request.url);

    if (url.pathname.endsWith("/events")) {
      return this.handleWebSocket(request);
    }

    if (url.pathname.endsWith("/start")) {
      const payload = await request.json();
      return this.startRun(payload);
    }

    if (url.pathname.endsWith("/runner-event")) {
      const event = await request.json();
      return this.handleRunnerEvent(event);
    }

    return new Response("Not found", { status: 404 });
  }
}
```

### 11.2 `RunnerSessionDO`

Responsibilities:

- one runner connection/session
- heartbeat tracking
- job assignment
- runner capability cache
- secure message delivery

---

## 12. OpenAI-Compatible API

### 12.1 `GET /v1/models`

Return aliases and discovered models:

```json
{
  "object": "list",
  "data": [
    { "id": "local/fusion", "object": "model", "owned_by": "fusion-harness" },
    { "id": "local/fusion-quality", "object": "model", "owned_by": "fusion-harness" },
    { "id": "opencode/anthropic/claude-sonnet", "object": "model", "owned_by": "opencode" },
    { "id": "codex/gpt-5-codex", "object": "model", "owned_by": "codex" }
  ]
}
```

### 12.2 `POST /v1/chat/completions`

Request:

```json
{
  "model": "local/fusion-quality",
  "messages": [
    { "role": "user", "content": "Review this architecture and produce an implementation plan." }
  ],
  "stream": true,
  "fusion": {
    "mode": "required",
    "provider_policy": "same_provider_first",
    "permission_profile": "workspace_write",
    "analysis_models": ["opencode/*", "codex/*"],
    "max_parallel": 4,
    "timeout_ms": 120000
  }
}
```

Response should follow OpenAI-style chunks for streaming:

```json
{
  "id": "chatcmpl_run_123",
  "object": "chat.completion.chunk",
  "created": 1781596800,
  "model": "local/fusion-quality",
  "choices": [
    {
      "index": 0,
      "delta": { "content": "..." },
      "finish_reason": null
    }
  ]
}
```

---

## 13. Go Runner CLI

### 13.1 Commands

```text
fusion-runner login
fusion-runner logout
fusion-runner doctor
fusion-runner discover
fusion-runner serve
fusion-runner run-test
fusion-runner config show
fusion-runner config set
fusion-runner update
```

### 13.2 Example outputs

```bash
fusion-runner doctor
```

```text
Fusion Runner 0.1.0
OS: darwin arm64
Cloud: connected
Workspace roots:
  ✓ /Users/alex/Projects
Tools:
  ✓ opencode /opt/homebrew/bin/opencode v1.x
  ✓ codex /opt/homebrew/bin/codex v0.x
  ✓ docker /usr/local/bin/docker
Auth:
  ✓ opencode providers detected
  ✓ codex auth available
Executors:
  ✓ host
  ✓ docker
```

```bash
fusion-runner discover --json
```

```json
{
  "runner_id": "runner_abc",
  "os": "darwin",
  "arch": "arm64",
  "tools": [
    { "tool": "opencode", "path": "/opt/homebrew/bin/opencode", "version": "1.x", "status": "verified" },
    { "tool": "codex", "path": "/opt/homebrew/bin/codex", "version": "0.x", "status": "verified" }
  ],
  "models": [
    { "adapter": "opencode", "model": "anthropic/claude-sonnet", "availability": "listed" },
    { "adapter": "codex", "model": "gpt-5-codex", "availability": "verified" }
  ]
}
```

---

## 14. Go Runner Interfaces

### 14.1 Adapter interface

```go
package adapters

import "context"

type ModelRef struct {
    ID           string            `json:"id"`
    Adapter      string            `json:"adapter"`
    Provider     string            `json:"provider,omitempty"`
    Model        string            `json:"model"`
    DisplayName  string            `json:"display_name,omitempty"`
    AuthMode     string            `json:"auth_mode"`
    Availability string            `json:"availability"`
    Capabilities map[string]bool   `json:"capabilities"`
}

type DetectionResult struct {
    Tool      string `json:"tool"`
    Found     bool   `json:"found"`
    Path      string `json:"path,omitempty"`
    Version   string `json:"version,omitempty"`
    Status    string `json:"status"`
    Error     string `json:"error,omitempty"`
}

type RunInput struct {
    RunID             string            `json:"run_id"`
    JobID             string            `json:"job_id"`
    WorkspacePath     string            `json:"workspace_path"`
    Prompt            string            `json:"prompt"`
    Model             string            `json:"model"`
    PermissionProfile string            `json:"permission_profile"`
    Env               map[string]string `json:"env,omitempty"`
    TimeoutMs         int               `json:"timeout_ms"`
}

type RunEvent struct {
    Type      string         `json:"type"`
    RunID     string         `json:"run_id"`
    JobID     string         `json:"job_id"`
    Timestamp string         `json:"timestamp"`
    Data      map[string]any `json:"data"`
}

type RunResult struct {
    Status       string         `json:"status"`
    OutputText   string         `json:"output_text"`
    Error        string         `json:"error,omitempty"`
    LatencyMs    int64          `json:"latency_ms"`
    Usage        map[string]any `json:"usage,omitempty"`
    ArtifactKeys []string       `json:"artifact_keys,omitempty"`
}

type Adapter interface {
    ID() string
    Detect(ctx context.Context) (*DetectionResult, error)
    ListModels(ctx context.Context) ([]ModelRef, error)
    HealthCheck(ctx context.Context, model ModelRef) error
    Run(ctx context.Context, input RunInput, emit func(RunEvent)) (*RunResult, error)
}
```

### 14.2 Executor interface

```go
package executors

import "context"

type CommandSpec struct {
    Name          string
    Args          []string
    WorkingDir    string
    Env           map[string]string
    TimeoutMs     int
    Stdin         string
    AllowNetwork  bool
    CaptureStdout bool
    CaptureStderr bool
}

type CommandResult struct {
    ExitCode  int
    Stdout    string
    Stderr    string
    DurationMs int64
}

type Executor interface {
    ID() string
    Available(ctx context.Context) bool
    Run(ctx context.Context, spec CommandSpec, emit func(line string)) (*CommandResult, error)
}
```

---

## 15. Discovery Implementation

### 15.1 PATH detection

```go
func FindCommand(name string) (string, bool) {
    path, err := exec.LookPath(name)
    if err != nil {
        return "", false
    }
    return path, true
}
```

### 15.2 Version check

```go
func CommandVersion(ctx context.Context, path string, args ...string) (string, error) {
    ctx, cancel := context.WithTimeout(ctx, 5*time.Second)
    defer cancel()

    cmd := exec.CommandContext(ctx, path, args...)
    out, err := cmd.CombinedOutput()
    if err != nil {
        return "", err
    }
    return strings.TrimSpace(string(out)), nil
}
```

### 15.3 Authentication check rule

Allowed:

```text
Run official CLI commands that report auth/model status.
```

Denied:

```text
Reading ~/.codex auth files directly.
Reading ~/.opencode credentials directly.
Reading keychains.
Reading browser cookies.
Copying tokens into cloud.
```

---

## 16. OpenCode Adapter

OpenCode supports `opencode models`, non-interactive `opencode run`, JSON output for raw events, and a headless `opencode serve` server with an OpenAPI endpoint.[^opencode-cli][^opencode-server]

### 16.1 Detect

```bash
opencode --version
```

### 16.2 Auth/provider list

```bash
opencode auth list
```

### 16.3 Model list

```bash
opencode models --refresh
opencode models anthropic
```

### 16.4 Run analysis

```bash
opencode run \
  --dir /path/to/workspace \
  --model anthropic/claude-sonnet \
  --format json \
  "Analyze this repository and propose an implementation plan."
```

### 16.5 Attach to server mode

```bash
OPENCODE_SERVER_PASSWORD=<generated> opencode serve --hostname 127.0.0.1 --port 4096

opencode run \
  --attach http://localhost:4096 \
  --password <generated> \
  --dir /path/to/workspace \
  --model anthropic/claude-sonnet \
  --format json \
  "Explain this codebase."
```

### 16.6 Per-job OpenCode permission config

OpenCode permissions can allow, ask, or deny actions, including granular bash/edit rules.[^opencode-permissions]

Generate a temporary project config:

```json
{
  "$schema": "https://opencode.ai/config.json",
  "permission": {
    "*": "ask",
    "read": "allow",
    "grep": "allow",
    "edit": {
      "*": "deny",
      "src/**": "allow",
      "packages/**": "allow"
    },
    "bash": {
      "*": "ask",
      "git status": "allow",
      "git diff *": "allow",
      "pnpm test": "allow",
      "npm test": "allow",
      "rm *": "deny"
    }
  }
}
```

---

## 17. Codex Adapter

Codex CLI supports both ChatGPT subscription sign-in and API-key sign-in. Its CLI reference documents commands and flags, including non-interactive execution and sandbox-related options.[^codex-auth][^codex-cli]

### 17.1 Detect

```bash
codex --version
```

### 17.2 Model discovery

```bash
codex debug models
```

Use this if available. If not available or unstable, fallback to configured/team model aliases.

### 17.3 Run analysis

```bash
codex exec \
  --cd /path/to/workspace \
  --model gpt-5-codex \
  --json \
  --sandbox read-only \
  "Analyze this codebase and suggest an implementation plan."
```

### 17.4 Run workspace-write task

```bash
codex exec \
  --cd /path/to/workspace \
  --model gpt-5-codex \
  --json \
  --sandbox workspace-write \
  "Implement the requested change and summarize the patch."
```

### 17.5 Sandbox mapping

Codex sandboxing is the safety boundary for autonomous local command execution.[^codex-sandbox]

```yaml
permission_mapping:
  readonly:
    codex_sandbox: read-only
  workspace_write:
    codex_sandbox: workspace-write
  trusted_internal:
    codex_sandbox: workspace-write
    approvals: reduced_for_allowlisted_commands
  danger_full_access:
    codex_sandbox: danger-full-access
    allowed: false_by_default
    requires: org_owner_manual_override
```

---

## 18. Host Executor

Use host executor when the job must use host-installed OpenCode/Codex or existing authenticated CLI sessions.

### 18.1 Security checks before execution

1. Validate workspace path is under allowed root.
2. Validate command matches adapter command pattern.
3. Validate environment variables.
4. Block known dangerous paths.
5. Attach timeout.
6. Stream stdout/stderr.
7. Record audit event.

### 18.2 Go command execution

```go
cmd := exec.CommandContext(ctx, commandPath, args...)
cmd.Dir = workspacePath
cmd.Env = sanitizedEnv(os.Environ(), job.Env)

stdout, _ := cmd.StdoutPipe()
stderr, _ := cmd.StderrPipe()

if err := cmd.Start(); err != nil {
    return nil, err
}

go streamLines(stdout, emit)
go streamLines(stderr, emit)

err := cmd.Wait()
```

---

## 19. Docker Executor

Docker executor should run project commands, not the full runner.

Docker bind mounts mount host paths into containers; use them only for approved workspace paths and prefer read-only when possible.[^docker-bind]

### 19.1 Secure default command

```bash
docker run --rm \
  --network=none \
  --read-only \
  --cap-drop=ALL \
  --security-opt=no-new-privileges \
  --memory=4g \
  --cpus=2 \
  --mount type=bind,src="$WORKSPACE",dst=/workspace \
  -w /workspace \
  fusion-exec-node:20 \
  pnpm test
```

### 19.2 Executor policies

```yaml
docker_executor:
  default_network: none
  allow_network_for:
    - package_install_with_approval
  mount_workspace:
    default: readonly
    write_allowed_when: workspace_write_profile
  forbidden_mounts:
    - /var/run/docker.sock
    - ~/.ssh
    - ~/.aws
    - ~/.config
    - ~/.codex
    - ~/.opencode
    - .env
```

### 19.3 Image strategy

Initial images:

```text
fusion-exec-node:20
fusion-exec-node:22
fusion-exec-python:3.12
fusion-exec-go:1.24
fusion-exec-rust:stable
fusion-exec-base:ubuntu
```

Each image should include:

- git
- common shell tools
- language runtime
- package manager
- non-root user
- no secrets
- no Docker socket

---

## 20. Workspace Strategy

### 20.1 Safe edit flow

```text
real workspace
  -> temporary Git worktree or copied snapshot
  -> agent edits temp workspace
  -> runner generates patch
  -> user reviews patch
  -> apply patch to real workspace
```

### 20.2 Commands

```bash
git worktree add /tmp/fusion-runs/run_123 <branch>
# run agent task
cd /tmp/fusion-runs/run_123
git diff --binary > /tmp/fusion-runs/run_123.patch
```

### 20.3 Artifact upload

Artifacts:

```text
runs/{org_id}/{run_id}/prompt.json
runs/{org_id}/{run_id}/panel/{job_id}.json
runs/{org_id}/{run_id}/judge.json
runs/{org_id}/{run_id}/final.md
runs/{org_id}/{run_id}/logs/{job_id}.log
runs/{org_id}/{run_id}/patches/final.patch
runs/{org_id}/{run_id}/bundle.zip
```

---

## 21. Event Schema

### 21.1 Runner event

```json
{
  "type": "panel.output.delta",
  "run_id": "run_123",
  "job_id": "job_abc",
  "runner_id": "runner_xyz",
  "timestamp": "2026-06-16T10:00:00.000Z",
  "data": {
    "model": "codex/gpt-5-codex",
    "content": "partial output"
  }
}
```

### 21.2 Standard event types

```text
run.created
run.started
run.planning.started
run.planning.completed
panel.job.queued
panel.job.started
panel.output.delta
panel.job.completed
panel.job.failed
judge.started
judge.completed
final.started
final.delta
final.completed
approval.requested
approval.granted
approval.denied
command.started
command.output
command.completed
file.changed
artifact.uploaded
run.completed
run.failed
run.cancelled
```

---

## 22. Artifact Redaction

Before uploading artifacts:

1. Remove known secret patterns.
2. Exclude denylisted files.
3. Apply max file size limits.
4. Store raw local logs temporarily only if policy allows.
5. Attach redaction summary.

### 22.1 Denylist

```text
.env
.env.*
*.pem
*.key
id_rsa
id_ed25519
.aws/**
.ssh/**
.npmrc
.pypirc
.netrc
```

### 22.2 Secret pattern examples

```text
OPENAI_API_KEY=
ANTHROPIC_API_KEY=
GITHUB_TOKEN=
AWS_SECRET_ACCESS_KEY=
-----BEGIN PRIVATE KEY-----
```

---

## 23. Web App Implementation

### 23.1 App routes

```text
/
/login
/dashboard
/chat
/runs/[runId]
/runners
/models
/workspaces
/presets
/artifacts/[artifactId]
/settings/team
/settings/api
/settings/mcp
```

### 23.2 Zustand stores

`apps/web/stores/ui-store.ts`:

```ts
import { create } from "zustand";

export type UiState = {
  sidebarOpen: boolean;
  selectedWorkspaceId?: string;
  selectedPreset: string;
  tracePanelOpen: boolean;
  setSidebarOpen: (open: boolean) => void;
  setSelectedWorkspaceId: (id?: string) => void;
  setSelectedPreset: (preset: string) => void;
};

export const useUiStore = create<UiState>((set) => ({
  sidebarOpen: true,
  selectedPreset: "same-provider-first",
  tracePanelOpen: true,
  setSidebarOpen: (sidebarOpen) => set({ sidebarOpen }),
  setSelectedWorkspaceId: (selectedWorkspaceId) => set({ selectedWorkspaceId }),
  setSelectedPreset: (selectedPreset) => set({ selectedPreset }),
}));
```

### 23.3 TanStack Query hooks

`apps/web/queries/runs.ts`:

```ts
import { useMutation, useQuery } from "@tanstack/react-query";

export function useRun(runId: string) {
  return useQuery({
    queryKey: ["run", runId],
    queryFn: async () => {
      const res = await fetch(`/api/fusion/runs/${runId}`);
      if (!res.ok) throw new Error("Failed to fetch run");
      return res.json();
    },
  });
}

export function useCreateRun() {
  return useMutation({
    mutationFn: async (body: unknown) => {
      const res = await fetch("/api/fusion/runs", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(body),
      });
      if (!res.ok) throw new Error("Failed to create run");
      return res.json();
    },
  });
}
```

---

## 24. MCP Server

Cloudflare supports remote MCP servers using Streamable HTTP; MCP also supports local stdio connections.[^cf-mcp]

### 24.1 Remote MCP tools

```text
fusion.run
fusion.get_run
fusion.list_models
fusion.list_runners
fusion.get_artifacts
fusion.apply_patch
fusion.cancel_run
```

### 24.2 Tool: `fusion.run`

Input schema:

```json
{
  "type": "object",
  "properties": {
    "prompt": { "type": "string" },
    "workspace_id": { "type": "string" },
    "preset": { "type": "string" },
    "mode": { "type": "string", "enum": ["direct", "auto", "required"] },
    "permission_profile": { "type": "string", "enum": ["readonly", "workspace_write", "trusted_internal"] },
    "stream": { "type": "boolean" }
  },
  "required": ["prompt"]
}
```

Output:

```json
{
  "run_id": "run_123",
  "status": "queued",
  "url": "https://fusion.example.com/runs/run_123"
}
```

---

## 25. Security Implementation

### 25.1 AuthN/AuthZ

Use Cloudflare Access for the web app and API. Internally map Access identity to `users` table.

Roles:

```text
owner: all org operations
admin: manage users, runners, presets, workspaces
developer: run tasks, approve own workspace commands
viewer: read runs/artifacts only
```

### 25.2 Runner authentication

Runner token flow:

```text
1. Admin creates runner registration token.
2. Runner runs `fusion-runner login`.
3. Runner exchanges token for scoped runner credential.
4. Credential is stored locally by OS user.
5. Runner heartbeat includes runner_id and signed proof.
6. Cloud can revoke runner.
```

### 25.3 Runner token scope

```json
{
  "runner_id": "runner_123",
  "org_id": "org_123",
  "allowed_workspaces": ["ws_123"],
  "expires_at": "2026-09-16T00:00:00Z",
  "scopes": [
    "runner:heartbeat",
    "runner:discover",
    "runner:execute",
    "artifact:upload"
  ]
}
```

### 25.4 Approval flow

```text
Agent requests command/edit
  -> runner checks local policy
  -> if allow: execute + audit
  -> if deny: block + audit
  -> if ask: send approval.requested to DO
  -> UI prompts user/admin
  -> user approves/denies
  -> runner executes or blocks
```

---

## 26. Observability

### 26.1 Log categories

```text
cloud.api.request
cloud.do.event
runner.heartbeat
runner.discovery
runner.command
runner.adapter
fusion.planner
fusion.panel
fusion.judge
fusion.final
artifact.upload
security.approval
security.block
```

### 26.2 Metrics

```text
runs_started_total
runs_completed_total
runs_failed_total
runner_online_count
panel_job_duration_ms
judge_duration_ms
final_writer_duration_ms
artifact_upload_bytes
approval_requests_total
blocked_commands_total
model_failure_rate
```

### 26.3 Trace view

Every run should show:

```text
- prompt summary
- selected preset
- selected models
- runner used
- command/file permissions
- panel outputs
- judge JSON
- final response
- changed files
- executed commands
- artifacts
- timings
- errors
```

---

## 27. Testing Strategy

### 27.1 Unit tests

```text
packages/core:
  - model selection
  - prompt building
  - judge JSON parsing
  - permissions
  - event schemas

workers/api:
  - route validation
  - auth middleware
  - D1 query layer
  - artifact object keys

runner-go:
  - discovery
  - command policy
  - path allowlist
  - adapter command construction
  - Docker command construction
```

### 27.2 Integration tests

```text
- create run through API
- runner receives job
- fake adapter returns output
- judge step completes
- final output stored
- artifact uploaded
- trace view can load run
```

### 27.3 Adapter contract tests

For each adapter:

```text
Detect()
ListModels()
HealthCheck()
Run(readonly)
Run(workspace_write)
Timeout handling
JSON parsing
Error normalization
```

### 27.4 Security tests

```text
- block `rm -rf /`
- block path escape with `../`
- block writes outside workspace
- block Docker socket mount
- redact .env
- deny secret artifact upload
- deny unauthenticated runner
- revoke runner token
```

### 27.5 Evaluation suite

Create evaluation tasks:

```text
architecture_decision_001
repo_review_001
small_bugfix_001
migration_plan_001
security_review_001
unit_test_generation_001
```

Score:

```text
correctness
completeness
patch applies
tests pass
security issues
human rating
latency
cost
```

---

## 28. CI/CD

### 28.1 GitHub Actions pipeline

```yaml
name: ci

on:
  pull_request:
  push:
    branches: [main]

jobs:
  web-and-workers:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: pnpm/action-setup@v4
      - uses: actions/setup-node@v4
        with:
          node-version: 22
          cache: pnpm
      - run: pnpm install --frozen-lockfile
      - run: pnpm lint
      - run: pnpm typecheck
      - run: pnpm test
      - run: pnpm build

  runner-go:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-go@v5
        with:
          go-version: '1.24'
      - run: cd apps/runner-go && go test ./...
      - run: cd apps/runner-go && go build ./cmd/fusion-runner
```

### 28.2 Runner release builds

```bash
GOOS=darwin  GOARCH=arm64 go build -o dist/fusion-runner-darwin-arm64 ./cmd/fusion-runner
GOOS=darwin  GOARCH=amd64 go build -o dist/fusion-runner-darwin-amd64 ./cmd/fusion-runner
GOOS=linux   GOARCH=amd64 go build -o dist/fusion-runner-linux-amd64 ./cmd/fusion-runner
GOOS=linux   GOARCH=arm64 go build -o dist/fusion-runner-linux-arm64 ./cmd/fusion-runner
GOOS=windows GOARCH=amd64 go build -o dist/fusion-runner-windows-amd64.exe ./cmd/fusion-runner
```

---

## 29. Deployment Plan

### 29.1 Environments

```text
dev: local testing and preview
staging: internal QA
prod: team daily use
```

### 29.2 Deploy cloud API

```bash
cd workers/api
wrangler deploy --env staging
wrangler deploy --env production
```

### 29.3 Deploy web app

```bash
cd apps/web
pnpm deploy
```

### 29.4 Run migrations

```bash
wrangler d1 migrations apply fusion_harness_staging --remote
wrangler d1 migrations apply fusion_harness_prod --remote
```

### 29.5 Register first runner

```bash
fusion-runner login --org <org-id> --token <registration-token>
fusion-runner doctor
fusion-runner serve
```

---

## 30. MVP Build Checklist

### Week 1–2: Foundation

- [ ] Create monorepo
- [ ] Set up Next.js web app
- [ ] Set up Worker API
- [ ] Set up D1 schema
- [ ] Set up R2 bucket
- [ ] Set up KV namespace
- [ ] Set up basic Durable Object
- [ ] Set up Cloudflare Access
- [ ] Create basic dashboard layout

### Week 3–4: Runner MVP

- [ ] Go runner CLI skeleton
- [ ] `doctor` command
- [ ] `discover` command
- [ ] cloud login
- [ ] heartbeat
- [ ] runner dashboard
- [ ] detect OpenCode
- [ ] detect Codex
- [ ] detect Docker

### Week 5–6: Adapters

- [ ] OpenCode adapter detect/list/run
- [ ] Codex adapter detect/list/run
- [ ] event streaming
- [ ] artifact upload
- [ ] run details screen

### Week 7–8: Fusion engine

- [ ] model selection
- [ ] panel execution
- [ ] judge prompt/schema
- [ ] final writer
- [ ] partial failure handling
- [ ] timeout/cancel
- [ ] fusion trace UI

### Week 9–10: Coding-agent safety

- [ ] permission profiles
- [ ] workspace allowlist
- [ ] approval flow
- [ ] patch generation
- [ ] Docker executor
- [ ] redaction
- [ ] audit log

### Week 11–12: Integrations

- [ ] `/v1/models`
- [ ] `/v1/chat/completions`
- [ ] streaming chunks
- [ ] remote MCP server
- [ ] local stdio MCP prototype
- [ ] staging rollout

---

## 31. Definition of Done for V1

V1 is done when:

1. A team user can log in to the web app.
2. A Go runner can connect from macOS, Windows, and Linux.
3. The runner can detect OpenCode and Codex.
4. The web app shows runner/model availability.
5. A user can run a direct OpenCode task.
6. A user can run a direct Codex task.
7. A user can run a mixed OpenCode + Codex fusion task.
8. The judge produces structured JSON.
9. The final response streams in the UI.
10. Raw panel outputs are saved to R2.
11. Metadata is saved to D1.
12. The system records command/file/audit events.
13. A patch can be generated and reviewed.
14. Tests/build commands can run in Docker.
15. `/v1/chat/completions` works for `local/fusion`.
16. Remote MCP `fusion.run` works.
17. Admin can disable a runner.
18. Secrets are not uploaded by default.

---

## 32. Future Enhancements

1. Desktop app using Tauri or Electron.
2. Cloudflare Sandbox/Containers for team-managed cloud execution.
3. Claude, Gemini, Copilot, and custom CLI adapters.
4. IDE extension.
5. Policy-as-code for org security.
6. Fine-grained cost budgets per team/user/workspace.
7. Evals dashboard.
8. Long-running autonomous task delegation.
9. Multi-run comparison and regression tracking.

---

## 33. Source References

[^cf-next]: Cloudflare Next.js on Workers docs: https://developers.cloudflare.com/workers/framework-guides/web-apps/nextjs/
[^cf-do]: Cloudflare Durable Objects docs: https://developers.cloudflare.com/durable-objects/
[^cf-d1]: Cloudflare D1 docs: https://developers.cloudflare.com/d1/
[^cf-d1-limits]: Cloudflare D1 limits: https://developers.cloudflare.com/d1/platform/limits/
[^cf-kv]: Cloudflare KV consistency docs: https://developers.cloudflare.com/kv/concepts/how-kv-works/
[^cf-r2]: Cloudflare R2 docs: https://developers.cloudflare.com/r2/
[^cf-workflows]: Cloudflare Workflows docs: https://developers.cloudflare.com/workflows/
[^cf-ai-gateway]: Cloudflare AI Gateway docs: https://developers.cloudflare.com/ai-gateway/
[^cf-mcp]: Cloudflare MCP docs: https://developers.cloudflare.com/agents/model-context-protocol/
[^cf-sandbox]: Cloudflare Sandbox SDK docs: https://developers.cloudflare.com/sandbox/
[^zustand]: Zustand docs: https://zustand.docs.pmnd.rs/
[^tanstack-query]: TanStack Query docs: https://tanstack.com/query/latest/docs/framework/react/overview
[^shadcn]: shadcn/ui docs: https://ui.shadcn.com/docs
[^go-exec]: Go `os/exec` package docs: https://pkg.go.dev/os/exec
[^go-cross]: Go cross-compilation wiki: https://go.dev/wiki/WindowsCrossCompiling
[^docker-security]: Docker Engine security docs: https://docs.docker.com/engine/security/
[^docker-rootless]: Docker rootless mode docs: https://docs.docker.com/engine/security/rootless/
[^docker-bind]: Docker bind mounts docs: https://docs.docker.com/engine/storage/bind-mounts/
[^opencode-cli]: OpenCode CLI docs: https://opencode.ai/docs/cli/
[^opencode-server]: OpenCode server docs: https://opencode.ai/docs/server/
[^opencode-permissions]: OpenCode permissions docs: https://opencode.ai/docs/permissions/
[^codex-auth]: OpenAI Codex authentication docs: https://developers.openai.com/codex/auth
[^codex-cli]: OpenAI Codex CLI reference: https://developers.openai.com/codex/cli/reference
[^codex-sandbox]: OpenAI Codex sandboxing docs: https://developers.openai.com/codex/concepts/sandboxing
