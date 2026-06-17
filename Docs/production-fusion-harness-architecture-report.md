# Fusion Harness Production Architecture Report

Date: 2026-06-17

Target product: a production-ready multi-model development harness that combines an OpenDesign-style local-agent shell, OpenRouter Fusion-style deliberation, and a Cloudflare + Next.js + Go execution stack.

## Executive Summary

The product should not be a direct clone of OpenDesign and should not try to make OpenRouter host local CLIs. The correct product shape is:

```text
Next.js web console
  -> Cloudflare control plane
  -> Durable run/session coordination
  -> Go local runner on the user's trusted machine
  -> local agent adapters: OpenCode, Codex, Claude Code, Gemini, etc.
  -> optional cloud model adapters: OpenRouter Fusion, OpenRouter direct models, Cloudflare AI Gateway
  -> panel outputs
  -> judge analysis
  -> final response or patch
  -> streamed trace, artifacts, audit log
```

OpenRouter Fusion should be treated as an external cloud capability and as the reference behavior for fusion, not as the only orchestrator. OpenRouter's official Fusion router runs OpenRouter-hosted panel models, then a judge model, then an outer model response. It does not automatically run local CLIs like Codex, Claude Code, Gemini CLI, or OpenCode installed on a user's laptop. To combine local agents, Fusion Harness needs its own orchestration layer that emulates the Fusion pattern and can call OpenRouter Fusion as one participant, judge, or fallback.

The current repo already has useful scaffolding: a Next.js app, Hono Worker API, D1 schema, R2 artifact metadata, Durable Objects, a Go runner, local agent discovery, OpenCode/Codex adapters, and a local harness UI. The main problem is that the cloud web path is not a real execution pipeline yet. It creates queued runs and event buffers, but it does not dispatch and complete panel, judge, and final jobs through the runner with leases, streamed deltas, artifact writes, and result persistence.

The MVP should focus on a narrow but complete loop:

1. Detect local agents reliably.
2. Let the user select panel, judge, and final models.
3. Dispatch jobs from Cloudflare to a local Go runner.
4. Stream real progress and typewriter output into the Next.js UI.
5. Persist prompt, panel, judge, final, patches, command logs, approvals, and audit events.
6. Support OpenRouter Fusion as an optional cloud mode, not as a replacement for the local harness.

## Product Vision

Fusion Harness should be the development console for "bring your own agents plus cloud fusion."

The user flow should feel like:

```text
User asks a development question or requests a code change
  -> selects local and cloud models/agents
  -> panel agents answer independently
  -> judge model compares consensus, contradictions, gaps, risks
  -> final model writes the best response or creates a patch
  -> UI streams thinking/status/tool/file/command/final events live
  -> user can inspect artifacts, approve risky actions, and apply/reject patches
```

The product claim should be careful. OpenRouter's benchmark says Fusion can surpass individual frontier models on deep research tasks, and its blog explicitly says Fusion is not a drop-in replacement for coding models. For this product, the defensible promise is:

- Better architecture, review, debugging, research, and implementation planning through multiple independent agent perspectives.
- Safer code changes because judge/final steps can identify conflicts and missing tests.
- More value from subscriptions the user already has, because local CLIs can be reused without copying credentials.
- An eval-backed path toward frontier-level quality on selected development workflows.

Avoid promising that every coding task will beat premium models. Prove it with your own benchmark suite.

## Sources Reviewed

Local source repositories:

- Current product repo: `/Users/vijay/Documents/Development/AsthriX/Fusion_Harness/fusion-harness`
- OpenDesign repo: `/Users/vijay/Documents/Development/Tools/open-design`

Current repo files reviewed:

- `README.md`
- `Docs/FH_PRODUCT_PLAN.md`
- `Docs/open-design-feature-implementation-report.md`
- `Docs/local-agents-model-selection-report.md`
- `apps/runner-go/internal/localagents/catalog.go`
- `apps/runner-go/internal/discovery/discovery.go`
- `apps/runner-go/internal/adapters/opencode/opencode.go`
- `apps/runner-go/internal/adapters/codex/codex.go`
- `apps/runner-go/internal/fusion/runner.go`
- `apps/runner-go/internal/localui/server.go`
- `apps/runner-go/cmd/fusion-runner/main.go`
- `workers/api/src/routes/fusion-runs.ts`
- `workers/api/src/routes/runners.ts`
- `workers/api/src/routes/models.ts`
- `workers/api/src/routes/openai-compatible.ts`
- `workers/api/src/durable-objects/FusionRunDO.ts`
- `workers/api/src/durable-objects/RunnerSessionDO.ts`
- `workers/api/src/services/runs.ts`
- `packages/core/src/fusion/orchestrator.ts`
- `packages/core/src/fusion/prompt-builder.ts`
- `packages/core/src/fusion/judge.ts`
- `packages/core/src/models/selection.ts`
- `packages/shared/src/types.ts`
- `packages/shared/src/events.ts`
- `packages/db/schema.sql`
- `packages/db/src/queries.ts`
- `apps/web/src/app/chat/task-console.tsx`
- `apps/web/src/app/runs/[runId]/page.tsx`
- `apps/web/src/app/runners/page.tsx`
- `apps/web/src/queries/runs.ts`
- `apps/web/src/lib/api.ts`

OpenDesign files reviewed:

- `README.md`
- `docs/architecture.md`
- `docs/agent-adapters.md`
- `deploy/README.md`
- `apps/daemon/src/agents.ts`
- `apps/daemon/src/runtimes/registry.ts`
- `apps/daemon/src/runtimes/types.ts`
- `apps/daemon/src/runtimes/detection.ts`
- `apps/daemon/src/runtimes/executables.ts`
- `apps/daemon/src/runtimes/launch.ts`
- `apps/daemon/src/runtimes/env.ts`
- `apps/daemon/src/runtimes/invocation.ts`
- `apps/daemon/src/runtimes/models.ts`
- `apps/daemon/src/runtimes/mcp.ts`
- `apps/daemon/src/runtimes/opencode-log.ts`
- `apps/daemon/src/runtimes/defs/opencode.ts`
- `apps/daemon/src/runtimes/defs/codex.ts`
- `apps/daemon/src/runtimes/defs/claude.ts`
- `apps/daemon/src/runtimes/defs/gemini.ts`
- `apps/daemon/src/json-event-stream.ts`
- `apps/daemon/src/claude-stream.ts`
- `packages/contracts/src/api/chat.ts`
- `packages/contracts/src/api/registry.ts`

Official external sources:

- OpenRouter Fusion Router: https://openrouter.ai/docs/guides/routing/routers/fusion-router
- OpenRouter Fusion Server Tool: https://openrouter.ai/docs/guides/features/server-tools/fusion
- OpenRouter Fusion announcement: https://openrouter.ai/blog/announcements/fusion-beats-frontier/
- OpenCode CLI: https://opencode.ai/docs/cli/
- OpenCode Server: https://opencode.ai/docs/server/
- OpenCode Permissions: https://opencode.ai/docs/permissions/
- OpenCode Config: https://opencode.ai/docs/config/
- Cloudflare Durable Objects: https://developers.cloudflare.com/durable-objects/concepts/what-are-durable-objects/
- Cloudflare Next.js on Workers: https://developers.cloudflare.com/workers/framework-guides/web-apps/nextjs/
- Cloudflare R2 uploads: https://developers.cloudflare.com/r2/objects/upload-objects/
- Cloudflare Workflows: https://developers.cloudflare.com/workflows/get-started/guide/
- Cloudflare AI Gateway coding agents: https://developers.cloudflare.com/ai-gateway/integrations/coding-agents/

## OpenRouter Fusion Findings

OpenRouter Fusion is the right behavioral reference.

Official Fusion behavior:

- `model: "openrouter/fusion"` auto-injects the Fusion tool.
- Explicit server tool usage is available through `{ "type": "openrouter:fusion" }`.
- A panel of models answers in parallel.
- A judge compares panel responses and returns structured analysis.
- The outer model writes the final answer.
- The panel and judge calls have web search and web fetch available.
- Custom parameters include `analysis_models`, judge `model`, `max_tool_calls`, `max_completion_tokens`, `reasoning`, and `temperature`.
- `analysis_models` allows 1 to 8 models.
- Fusion has recursion protection through a fusion-depth header.
- With the default 3-model panel, OpenRouter says cost is roughly 4-5x a single completion.
- The API response's `model` field is the concrete model, not the alias. Generation metadata is needed to confirm `router: "openrouter/fusion"`.

Important degradation behavior from the server-tool docs:

- If some panel models fail but at least one succeeds, Fusion can still return usable output with failed-model metadata.
- If the judge fails, Fusion does not necessarily fail the whole run; it can return raw panel responses without structured analysis.
- Hard failure is reserved for cases like all panel models failing, insufficient credits, rate limits, capped recursive invocation, or unexpected error.

This should be copied into Fusion Harness. Do not fail a whole run because one panel member fails. Do not fail a whole run because judge JSON is invalid if panel outputs are usable. Make partial success a first-class state.

Benchmark interpretation:

- The OpenRouter blog was published on June 12, 2026.
- OpenRouter reports strong results on 100 DRACO deep research tasks.
- The blog says Fable 5 + GPT-5.5 synthesized by Opus 4.8 scored 69.0%, while solo Fable 5 scored 65.3%.
- It also says a budget panel of Gemini 3 Flash, Kimi K2.6, and DeepSeek V4 Pro beat GPT-5.5 and Opus 4.8 on that benchmark.
- The blog warns Fusion is not a drop-in replacement for coding models. For coding, the base model should call Fusion selectively on architecture, research, and high-stakes questions.

Product implication:

Fusion Harness should expose three execution modes:

1. `direct`: one selected local/cloud model.
2. `fusion-required`: always panel -> judge -> final.
3. `fusion-auto`: route simple coding tasks directly, invoke fusion for architecture, risk, design decisions, production debugging, migrations, security, and large refactors.

## OpenDesign Findings

OpenDesign is useful mainly for its local-agent runtime and UI patterns. It is not a model-fusion product.

OpenDesign architecture:

- Web app plus local daemon.
- The daemon is the privileged process.
- The browser talks to the daemon through REST/SSE.
- The daemon owns agent detection, skills, design systems, artifact persistence, preview, export, and CLI spawning.
- Deployment modes include fully local, hosted web plus local daemon, and degraded direct API without daemon.
- Docker deployment exists, but the image intentionally does not bundle local coding-agent CLIs.

OpenDesign's key principle:

It does not ship its own general model router. It delegates the agent loop to the existing CLI. Fusion Harness should keep that principle for local agents but add a product-owned orchestration layer above them.

OpenDesign local agent detection:

- Central runtime registry: `AGENT_DEFS`.
- Each runtime definition declares id, display name, binary, fallback binaries, version args, fallback models, optional live model list command, optional custom fetcher, stream format, prompt delivery mode, and argument builder.
- Detection uses configured absolute binary overrides such as `CODEX_BIN`, `OPENCODE_BIN`, `CLAUDE_BIN`, and `GEMINI_BIN`.
- It searches normal `PATH` plus common user toolchain directories.
- It runs all agent probes concurrently and isolates failures so one broken adapter does not collapse the entire agent picker.
- It caches recently surfaced live model IDs so the chat route can validate user selections.
- It supports `default` as a synthetic model meaning "do not pass a model flag; let the CLI config decide."
- It validates custom model IDs with a strict syntax guard before passing them as process args.

OpenDesign hardening details worth porting:

- Metadata probes run in a neutral temporary working directory, not the daemon repo, to avoid CLIs mutating the project during `models` or `--version`.
- Spawn environment repairs `PATH` for GUI-launched apps.
- OpenCode has `OPENCODE_DISABLE_PROJECT_CONFIG=true` set for daemon launches to avoid project-config/plugin startup side effects.
- OpenCode model listing prefers `opencode-cli`, then `opencode`.
- Codex launch resolution tries to find the native Codex binary behind npm/node wrappers.
- Prompt delivery is via stdin for large prompts to avoid command-line length limits on Windows and Linux.
- OpenCode provider failures can be silent in `run --format json`; OpenDesign reads the latest OpenCode session log tail to recover rate-limit/auth/upstream errors.
- Stream parsers normalize many CLI formats into UI events: status, text deltas, thinking deltas, tool use, tool result, usage, raw, and errors.
- Role-marker hallucination guards terminate a run if the model emits fabricated user/assistant markers into visible text.

OpenDesign UI patterns worth using:

- A compact agent/model switcher.
- Model picker with live/fallback/custom model sources.
- Per-agent model persistence.
- Streamed run events, not only final text.
- Actionable diagnostics with install docs, binary override, rescan, and auth actions.
- Artifact-first trace views.
- Headless CLI parity: every UI function should have an API/event equivalent.

OpenDesign patterns not worth copying directly:

- Design systems, plugins, skills marketplace, artifact preview iframe, deck/video/image workflows. Those are core to OpenDesign but not core to Fusion Harness V1.
- Local Node daemon architecture. Fusion Harness already chose Go for local execution, which is better for cross-platform runner distribution.
- Product copy and landing-page structure. The Fusion Harness UI should be development-console oriented, not design-studio oriented.

## OpenCode Harness Behavior

OpenCode is the best first local model router because it already understands provider/model IDs.

Official OpenCode behavior:

- `opencode` without arguments starts the TUI.
- `opencode models [provider]` lists configured provider models in `provider/model` format.
- `opencode models --refresh` refreshes model cache.
- `opencode run [message..]` runs non-interactively.
- `opencode run --format json` emits raw JSON events.
- `opencode run --model provider/model` chooses a specific provider model.
- `opencode run --attach http://localhost:4096 ...` can attach to an existing `opencode serve` server.
- `opencode serve` starts a headless HTTP server on `127.0.0.1:4096` by default.
- The server exposes health, global event SSE, provider, session, message, file, MCP, agent, and other endpoints.
- `OPENCODE_SERVER_PASSWORD` enables HTTP basic auth for `serve` and `web`.
- OpenCode config is merged from remote, global, custom env path, project config, `.opencode` directories, inline `OPENCODE_CONFIG_CONTENT`, and managed/admin config.
- OpenCode permissions can `allow`, `ask`, or `deny` actions, including granular bash/edit rules and external directory rules.
- OpenCode config supports provider/model settings, provider timeouts/chunk timeouts, MCP servers, plugins, instructions, and compaction.

Fusion Harness OpenCode recommendations:

- Prefer CLI mode for MVP: `opencode-cli run --format json`.
- Use `--model` only when model is not `default`.
- Deliver prompt through stdin where supported.
- Use `OPENCODE_CONFIG_CONTENT` per run to inject controlled permissions and MCP servers.
- Do not rely on `--dangerously-skip-permissions` as the normal path. Use it only for a clearly labeled trusted mode. The production path should map Fusion Harness permission profiles into OpenCode permission config.
- Add optional persistent server mode later: start `opencode serve` per runner and use attach/server APIs to reduce cold-start and MCP boot cost.
- Parse JSON events into the same runner event schema used by other adapters.
- Capture usage/cost when OpenCode emits it.
- Recover provider failures from OpenCode logs if the CLI stalls silently.

## Current Fusion Harness State

Already present:

- Monorepo with `apps/web`, `workers/api`, `workers/mcp`, `packages/core`, `packages/db`, `packages/shared`, `packages/ui`, `apps/runner-go`.
- Next.js app deployed through OpenNext/Cloudflare configuration.
- Hono Worker API routes for health, dashboard, runners, models, workspaces, fusion runs, approvals, artifacts, and OpenAI-compatible `/v1`.
- D1 schema for orgs, users, runners, installed tools, models, fusion runs, panel outputs, artifacts, audit events, and workspaces.
- D1 query helpers to register runners, replace runner tools/models, list models/runners/runs, create artifacts, and create audit events.
- Durable Object `FusionRunDO` for event storage and WebSocket fanout.
- Durable Object `RunnerSessionDO` for heartbeat, dispatch, and simple queued jobs.
- Shared types for adapters, models, runners, tools, run requests, events, permissions, and statuses.
- Core model selection and fusion prompt builders.
- Web chat console with panel, judge, final model selection.
- Web runner diagnostics page.
- Go runner with config persistence, discovery, `doctor`, `discover`, `serve`, `fuse`, `ui`, host executor, Docker executor, and workspace allowlist checks.
- Go local agent catalog with many agents listed.
- Go discovery supports env-var binary overrides, fallback binaries, extra tool dirs, and well-known user toolchain paths.
- OpenCode adapter supports detection, model listing, and non-interactive run.
- Codex adapter supports detection, `debug models`, and `codex exec`.
- Local Go UI can run a blocking panel -> judge -> final pipeline through OpenCode/Codex.

Main production gaps:

- Cloud run creation does not start real execution.
- The Go runner `serve` command registers and heartbeats, but does not poll `/jobs/next`, claim jobs, execute jobs, or post results.
- `RunnerSessionDO` queue has no lease, retry, visibility timeout, dead-letter state, priority, or idempotency.
- `FusionRunDO` stores events but is not the run orchestrator.
- `FusionWorkflow` is only a scaffold.
- `/v1/chat/completions` only returns "queued" placeholder content.
- Web run detail page shows static DB data and does not subscribe to live events.
- Web chat redirects to run detail instead of streaming the current answer inline.
- Panel output rows are not created and updated through real execution.
- Judge/final artifacts are not written to R2 through the cloud path.
- OpenCode/Codex adapter output is returned as one combined stdout/stderr string, not normalized typed deltas.
- The Go runner has a broad local agent catalog but only OpenCode and Codex execution are implemented.
- Permission profiles are too coarse and are not yet mapped into OpenCode/Codex native permission controls.
- Auth detection is shallow. It proves a binary exists, not that it can make a model request.
- No OpenRouter API integration is implemented.
- No production runner token model, rotation, scoped auth, or Access policy is fully defined.

## Correct Product Architecture

### Components

```text
apps/web
  Next.js 16, Zustand, TanStack Query, Zod, shadcn/ui
  Development console, model picker, runner status, live trace, artifacts

workers/api
  Hono API Worker
  Auth, orgs, runners, models, runs, artifacts, OpenAI-compatible API
  Dispatches run plans to Durable Objects and runner sessions

Durable Objects
  FusionRunDO: one active run event bus and state machine
  RunnerSessionDO: one runner connection queue/state machine

D1
  durable metadata and query surfaces

R2
  prompts, transcripts, panel outputs, judge JSON, final output, patches, logs

Workflows
  optional durable supervision for long-running run graphs and cleanup

AI Gateway
  optional provider/API-key observability, routing, rate limits, guardrails

apps/runner-go
  local execution plane
  detects host CLIs
  executes adapter jobs
  streams normalized events
  applies workspace/command/file policies
  uploads artifacts

OpenRouter adapter
  cloud execution mode
  supports openrouter/fusion and direct OpenRouter models
```

### Control Plane vs Execution Plane

Cloudflare is the control plane:

- user/org/workspace state
- model inventory
- run plan
- event fanout
- audit
- artifact metadata
- OpenAI/MCP APIs
- cloud model calls

The Go runner is the execution plane:

- host CLI detection
- local subscription/session reuse
- process spawning
- file edits
- shell commands
- Docker test/build execution
- local filesystem access
- artifact upload

Do not make Workers responsible for detecting or running local binaries. Workers cannot inspect a user's laptop.

### Execution Modes

#### Local Agent Fusion

```text
POST /api/fusion/runs
  -> create run
  -> build plan from selected local models
  -> queue panel jobs to selected runner
  -> runner executes local CLIs
  -> runner streams panel deltas and writes panel artifacts
  -> judge job runs on selected local/cloud model
  -> final job runs on selected local/cloud model
  -> final answer and patch artifacts are persisted
```

This is the main product.

#### OpenRouter Native Fusion

```text
User selects OpenRouter Fusion mode
  -> Worker calls OpenRouter chat completions
  -> model: openrouter/fusion or explicit openrouter:fusion server tool
  -> stream response to UI
  -> store generation metadata
```

This is useful when the user has OpenRouter credits/API keys and wants the official hosted Fusion behavior.

#### Hybrid Fusion

```text
Panel:
  - local OpenCode model
  - local Codex model
  - OpenRouter Fusion result or direct OpenRouter model
Judge:
  - selected local/cloud model
Final:
  - selected coding agent, often Codex/OpenCode for patch workflows
```

This is the differentiator. It gives local coding agents access to cloud multi-model research without forcing everything through OpenRouter.

## Required Data Model Changes

The existing schema is a good start. Add the following tables or equivalent columns.

### `runner_jobs`

Needed because Durable Object storage alone is not enough for historical query, retries, or audits.

Fields:

- `id`
- `org_id`
- `run_id`
- `runner_id`
- `kind`: `direct | panel | judge | final | command | patch`
- `status`: `queued | leased | running | completed | failed | timeout | cancelled`
- `attempt`
- `lease_owner`
- `lease_expires_at`
- `input_object_key`
- `output_object_key`
- `error`
- `created_at`
- `started_at`
- `completed_at`

### `run_events`

Durable Object storage is fine for live buffers, but D1 or R2 JSONL should hold durable replay.

Fields:

- `id`
- `org_id`
- `run_id`
- `seq`
- `type`
- `job_id`
- `runner_id`
- `payload_json`
- `created_at`

For high-volume token streams, store compact event batches in R2 and retain summary events in D1.

### `runner_tokens`

Fields:

- `id`
- `org_id`
- `runner_id`
- `token_hash`
- `scopes_json`
- `created_by`
- `expires_at`
- `revoked_at`
- `created_at`

Never store runner tokens in plaintext.

### `agent_health_checks`

Fields:

- `id`
- `org_id`
- `runner_id`
- `adapter`
- `model_id`
- `status`
- `latency_ms`
- `error`
- `checked_at`

This separates "binary detected" from "model can answer."

### `provider_credentials`

Only for team-managed API keys, not local CLI secrets.

Fields:

- `id`
- `org_id`
- `provider`
- `credential_ref`
- `auth_mode`: `cloudflare_secret | ai_gateway | openrouter_key`
- `created_by`
- `created_at`
- `rotated_at`

Use Cloudflare Secrets or a secret manager. D1 stores references only.

### `presets`

Fields:

- `id`
- `org_id`
- `name`
- `mode`
- `analysis_models_json`
- `judge_model`
- `final_model`
- `provider_policy`
- `permission_profile`
- `timeout_ms`
- `created_at`
- `updated_at`

Presets should be user/team-editable, not hard-coded only.

## Durable Object Design

### `FusionRunDO`

Make this the live state machine for one run.

Responsibilities:

- assign event sequence numbers
- broadcast WebSocket/SSE events
- persist event snapshots/batches
- track active phase
- receive runner events
- coordinate transition from panel to judge to final
- handle cancellation
- tolerate partial panel failure
- expose `/events`, `/snapshot`, `/cancel`, `/runner-event`

Important: Durable Objects are a coordination atom. Keep one DO per run, not one global DO.

### `RunnerSessionDO`

Make this the coordination atom for one runner.

Responsibilities:

- runner heartbeat and online/offline state
- job queue for that runner
- job claim/lease
- visibility timeout
- cancellation messages
- queue depth/status
- optional WebSocket from runner for lower latency

Current `jobs/next` deletes a job immediately. Replace it with claim/ack:

```text
POST /jobs/claim
  -> returns job with lease_expires_at

POST /jobs/:id/event
  -> forwards typed event to FusionRunDO

POST /jobs/:id/complete
  -> marks job complete, records artifacts

POST /jobs/:id/fail
  -> marks job failed, optionally requeues
```

## Runner Design

### Required Runner Loop

`fusion-runner serve` should become:

```text
load config
discover tools/models
register runner
heartbeat loop
job claim loop
for each job:
  validate workspace root
  validate adapter/model
  build prompt from input object
  run adapter
  stream normalized events
  write output artifacts
  complete/fail job
```

### Adapter Interface

The Go adapter contract should move closer to OpenDesign's runtime contract:

```go
type AgentAdapter interface {
  ID() string
  Detect(ctx context.Context) DetectionResult
  ListModels(ctx context.Context) ([]ModelRef, error)
  HealthCheck(ctx context.Context, model string) HealthResult
  BuildCommand(input RunInput) CommandSpec
  ParseStream(stdout io.Reader, stderr io.Reader, emit func(RunEvent)) RunResult
  Cancel(jobID string) error
}
```

Keep the process spawn in a shared executor. Keep CLI-specific argv/env/stream parsing in adapters.

### Detection Requirements

Port these OpenDesign behaviors:

- registry-driven definitions
- binary env overrides
- fallback binaries
- PATH plus well-known toolchain dirs
- neutral cwd for metadata probes
- version probe
- help/capability probe where useful
- auth probe where the CLI has safe status/whoami command
- dynamic model list with timeout and fallback
- `default` model option
- strict custom model ID validation
- actionable diagnostics: not on PATH, invalid override, not executable, auth missing, auth unknown

### Initial Adapter Priorities

P0:

- OpenCode
- Codex
- OpenRouter cloud adapter

P1:

- Claude Code
- Gemini CLI

P2:

- Cursor Agent
- Qwen
- Qoder
- Copilot
- Kimi
- DeepSeek
- Aider
- Devin
- ACP runtimes

Do not try to support every OpenDesign-listed agent before the core run lifecycle works.

## Fusion Orchestration Requirements

### Plan Model

Each run should compile into an explicit graph:

```json
{
  "runId": "run_...",
  "mode": "required",
  "steps": [
    { "kind": "panel", "jobId": "panel_1", "modelId": "opencode/openai/gpt-5", "role": "architect" },
    { "kind": "panel", "jobId": "panel_2", "modelId": "codex/gpt-5-codex", "role": "critic" },
    { "kind": "judge", "jobId": "judge_1", "dependsOn": ["panel_1", "panel_2"], "modelId": "codex/gpt-5.5" },
    { "kind": "final", "jobId": "final_1", "dependsOn": ["judge_1"], "modelId": "codex/gpt-5-codex" }
  ]
}
```

### Judge Contract

Use structured JSON compatible with OpenRouter's semantics:

```json
{
  "status": "ok",
  "analysis": {
    "consensus": [],
    "contradictions": [],
    "partial_coverage": [],
    "unique_insights": [],
    "blind_spots": [],
    "risks": [],
    "confidence": 0.0,
    "recommended_final_strategy": ""
  },
  "responses": [],
  "failed_models": []
}
```

Current `packages/core/src/fusion/judge.ts` is close but should add:

- `status`
- `responses`
- `failed_models`
- `blind_spots`
- `partial_coverage`
- typed failure reasons

### Partial Failure Policy

Rules:

- If at least one panel model succeeds, continue.
- If all panel models fail, fail the run with `all_panels_failed`.
- If judge fails or returns invalid JSON, continue to final with raw panel outputs and `judge_degraded`.
- If final fails, keep panel and judge artifacts visible and mark final failed.
- If a model times out, capture timeout as a failed model, not a crash.

## Streaming Event Contract

The UI experience depends on events. Use typed events everywhere.

Minimum event types:

```text
run.created
run.started
run.planning.started
run.planning.completed
panel.job.queued
panel.job.started
panel.thinking.delta
panel.output.delta
panel.tool_call
panel.tool_result
panel.usage
panel.job.completed
panel.job.failed
judge.started
judge.output.delta
judge.completed
judge.failed
final.started
final.thinking.delta
final.delta
final.tool_call
final.tool_result
final.completed
command.started
command.output
command.completed
file.changed
approval.requested
approval.granted
approval.denied
artifact.uploaded
run.completed
run.failed
run.cancelled
```

Event requirements:

- Every event has `runId`, `seq`, `timestamp`, optional `jobId`, optional `runnerId`, and `data`.
- Final answer typewriter effect should be driven by `final.delta`.
- Thinking panels should use `*.thinking.delta`, status events, and tool events.
- Tool calls and command output should be expandable, not mixed into final answer.
- Store raw adapter logs as artifacts, not as the main UI event stream.
- Support event replay after refresh using `Last-Event-ID` or `after=seq`.

## Web UI Blueprint

The Next.js UI should combine OpenRouter Fusion's model/panel concept with OpenDesign's local-agent console patterns.

Main screen layout:

```text
Left rail:
  runs
  workspaces
  presets
  local agents
  settings

Top bar:
  runner status
  selected workspace
  model budget/cost estimate
  mode: direct / auto / required

Composer:
  prompt
  attachment button
  web/search toggle when cloud models support it
  permission profile
  run button

Model strip:
  panel model chips
  judge model
  final model
  preset selector

During run:
  live phase indicator
  panel columns/cards
  judge analysis panel
  final answer stream
  tool/command timeline
  artifacts/patch tabs
  approvals drawer
```

Model picker:

- Group by adapter: OpenCode, Codex, Claude, Gemini, OpenRouter, AI Gateway.
- Show source: live, fallback, suggested, custom.
- Show auth mode: CLI session, API key, cloud gateway.
- Show status: verified, listed, configured unverified, unavailable.
- Allow custom model IDs only for adapters that support them.
- Persist selections per workspace/user/preset, not only localStorage.

Run detail page:

- Subscribe to `/api/fusion/runs/:id/events`.
- Show replayed snapshot immediately.
- Stream final text live.
- Show panel outputs as they arrive.
- Render judge JSON as structured sections.
- Link artifacts.
- Show failed models and retries.
- Show commands/tests and approvals.

ChatGPT-like features:

- Typewriter final answer: append `final.delta`.
- Thinking/progress: show current phase, model names, tool calls, and status labels.
- Stop button: cancel run and propagate cancellation to runner/child process.
- Regenerate: create a new run with same request and current selections.
- Compare: show panel outputs side by side.
- Copy/export: final answer, judge JSON, patch, run package.
- Continue: start a follow-up turn with prior run artifacts as context.

## API Design

### Native API

Core endpoints:

```text
GET  /api/models
GET  /api/runners
POST /api/runners/register
POST /api/runners/:id/heartbeat
POST /api/runners/:id/jobs/claim
POST /api/runners/:id/jobs/:jobId/events
POST /api/runners/:id/jobs/:jobId/complete
POST /api/runners/:id/jobs/:jobId/fail

POST /api/fusion/runs
GET  /api/fusion/runs
GET  /api/fusion/runs/:id
GET  /api/fusion/runs/:id/events
POST /api/fusion/runs/:id/cancel
POST /api/fusion/runs/:id/approve

GET  /api/artifacts/:id
POST /api/artifacts/upload-url
GET  /api/presets
POST /api/presets
```

### OpenAI-Compatible API

Support these model aliases:

```text
local/fusion
local/fusion-auto
local/fusion-required
local/fusion-fast
local/opencode
local/codex
openrouter/fusion
```

For `/v1/chat/completions`:

- Non-streaming should wait for final answer if feasible, or return `202` only for async mode.
- Streaming should emit real SSE chunks from `final.delta`, not a queued placeholder.
- Include `fusion_run_id`.
- Include `fusion` metadata with panel, judge, final, failed models, and artifacts when complete.

## Cloudflare Stack Recommendation

Use:

- Workers: API runtime.
- OpenNext on Workers: Next.js app.
- Durable Objects: live run and runner session coordination.
- D1: relational metadata.
- R2: large outputs and artifacts.
- Workflows: optional long-running supervision, retries, cleanup, scheduled reconciliation.
- AI Gateway: team-managed provider/API-key traffic observability, rate limits, DLP, caching where safe.
- Access: team auth and identity.
- Tunnel: optional private runner connectivity if you later need inbound local runner channels.

Use carefully:

- KV: read-mostly config cache only. Do not store active run state or queues in KV.
- Queues: useful for cloud-only background processing, but runner jobs already need runner-specific leases. Use DO/D1 first.
- AI Gateway caching: only for deterministic or repeated non-sensitive prompts. Most coding prompts are workspace-specific and should not be cached by default.

Not needed for V1:

- Cloudflare Containers/Sandbox SDK for local-agent execution. Local CLIs need the user's host machine and auth/session state.
- Vectorize. Not required until you build long-term semantic memory or codebase indexing.
- Browser Rendering. Not needed unless you add web preview/screenshots.
- Cloudflare Agents SDK. You already need custom orchestration and local runner control.
- Full desktop app. Web plus Go runner is enough for V1.

## Security Requirements

Non-negotiable rules:

- Never read local CLI credentials directly.
- Never scrape browser cookies, keychains, or private token files.
- Treat local CLI sessions as owned by the user and invoked through official CLIs only.
- Bind local runner UI/API to loopback by default.
- Use explicit workspace roots.
- Require permission profiles for file writes and shell commands.
- Require user approval for high-risk actions.
- Store runner tokens hashed.
- Scope runner tokens to org/runner.
- Redact secrets in logs and artifacts.
- Store large logs/transcripts in R2, not D1.
- Include audit events for run creation, runner registration, approvals, commands, file writes, artifact uploads, cancellation, and failures.

Permission profile mapping:

```text
readonly:
  no file writes
  no shell except safe read-only commands if explicitly allowed
  OpenCode permission: edit deny, bash ask/deny
  Codex sandbox: read-only

workspace_write:
  edits under workspace root
  test/build commands with approval or allowlist
  OpenCode permission: edit allow for workspace, bash ask/allowlist
  Codex sandbox: workspace-write

trusted_internal:
  broader command execution
  still audit everything
  only for trusted repos/runners
```

## What To Change In This Repo

### P0 - Make Cloud Runs Execute

Files/modules:

- `workers/api/src/services/runs.ts`
- `workers/api/src/routes/fusion-runs.ts`
- `workers/api/src/durable-objects/FusionRunDO.ts`
- `workers/api/src/durable-objects/RunnerSessionDO.ts`
- `workers/api/src/workflows/FusionWorkflow.ts`
- `apps/runner-go/cmd/fusion-runner/main.go`
- `apps/runner-go/internal/cloud/client.go`
- `apps/runner-go/internal/fusion/runner.go`
- `packages/db/schema.sql`
- `packages/db/src/queries.ts`

Tasks:

- Create run plan after inserting the run.
- Pick runner(s) based on selected models.
- Insert `runner_jobs` rows.
- Queue panel jobs with leases.
- Implement runner job claim loop.
- Stream runner events to `FusionRunDO`.
- Persist panel outputs and artifacts.
- Trigger judge after panel completion.
- Trigger final after judge or judge degradation.
- Mark run complete/failed/cancelled.

### P0 - Replace Placeholder Streaming

Files/modules:

- `workers/api/src/routes/openai-compatible.ts`
- `apps/web/src/app/runs/[runId]/page.tsx`
- `apps/web/src/queries/runs.ts`
- `apps/web/src/app/chat/task-console.tsx`

Tasks:

- Add event subscription hook.
- Use `final.delta` for typewriter output.
- Show panel/job progress.
- Show judge analysis.
- Implement stop/cancel.
- Make `/v1/chat/completions?stream=true` stream real final deltas.

### P0 - Harden OpenCode/Codex Adapters

Files/modules:

- `apps/runner-go/internal/adapters/opencode/opencode.go`
- `apps/runner-go/internal/adapters/codex/codex.go`
- `apps/runner-go/internal/discovery/discovery.go`
- `apps/runner-go/internal/localagents/catalog.go`

Tasks:

- Remove or gate OpenCode `--dangerously-skip-permissions`.
- Use per-run OpenCode permission config.
- Add stream parsers for OpenCode and Codex JSON events.
- Add neutral cwd for metadata probes.
- Add OpenCode log-tail provider failure recovery.
- Add health checks that run tiny model probes only with explicit user action.
- Normalize usage events.

### P1 - Add OpenRouter Adapter

Files/modules:

- `workers/api/src/services/openrouter.ts`
- `packages/shared/src/types.ts`
- `packages/db/schema.sql`
- `apps/web/src/app/chat/task-console.tsx`

Tasks:

- Store OpenRouter API key as secret/reference.
- Add `openrouter` and `openrouter-fusion` model refs.
- Support `model: "openrouter/fusion"`.
- Support explicit `openrouter:fusion` server tool.
- Store generation metadata and router confirmation.
- Surface cost estimate.

### P1 - Improve Local Agent Detection UX

Files/modules:

- `apps/runner-go/internal/localagents/catalog.go`
- `apps/runner-go/internal/discovery/discovery.go`
- `apps/web/src/app/runners/page.tsx`
- `packages/shared/src/types.ts`

Tasks:

- Add actionable diagnostics.
- Show searched dirs.
- Show env override key.
- Show install/docs links.
- Show auth unknown/missing.
- Add rescan/register button flow.

### P1 - Persist Presets and Model Choices

Files/modules:

- `packages/db/schema.sql`
- `workers/api/src/routes/presets.ts`
- `apps/web/src/app/chat/task-console.tsx`
- `apps/web/src/stores/ui-store.ts`

Tasks:

- Move selections from localStorage-only to D1-backed user settings/presets.
- Support workspace defaults.
- Let users save a panel/judge/final preset.

## Implementation Roadmap

### Phase 0 - Product Contract Reset

Goal: align contracts before writing more UI.

Deliverables:

- Update shared `RunEventType`.
- Add `runner_jobs`, `run_events`, `runner_tokens`, `presets`.
- Define `FusionExecutionPlan` persisted object.
- Define `RunnerJob` request/response schemas with Zod.
- Define OpenRouter adapter types.

Exit criteria:

- Typecheck passes.
- API/runner contracts are documented.
- No fake queued streaming path remains in docs as if it were complete.

### Phase 1 - Local Cloud Execution MVP

Goal: web-created run executes on local runner.

Deliverables:

- `fusion-runner serve` claims jobs.
- Worker creates panel jobs.
- Runner executes OpenCode/Codex jobs.
- Runner posts events and completion.
- Web run page streams events.
- Panel output artifacts are persisted.

Exit criteria:

- From web UI, select two models and get panel outputs in the run page.
- Cancel stops the runner child process.
- Refresh replays prior events.

### Phase 2 - Judge and Final Pipeline

Goal: full panel -> judge -> final.

Deliverables:

- Judge job runs after panel.
- Judge JSON parser handles degradation.
- Final job uses panel + judge content.
- Final answer streams in UI.
- `/v1/chat/completions` streams final deltas.

Exit criteria:

- Mixed OpenCode + Codex fusion completes from web.
- One failing panel model does not fail the run.
- Judge invalid JSON still produces a final answer with warning.

### Phase 3 - OpenRouter Integration

Goal: official OpenRouter Fusion and direct OpenRouter models.

Deliverables:

- OpenRouter credential setup.
- OpenRouter model list.
- `openrouter/fusion` mode.
- OpenRouter server-tool mode.
- Metadata shows whether Fusion router was actually used.

Exit criteria:

- Web can run a cloud OpenRouter Fusion task.
- Hybrid panel can include local and OpenRouter participants.

### Phase 4 - Production Hardening

Goal: reliable local-agent product.

Deliverables:

- OpenCode permission config mapping.
- Codex sandbox mapping.
- Runner token rotation.
- Health checks.
- Retry/lease/dead-letter behavior.
- R2 artifact packages.
- Audit trail complete.
- CI tests for DO queues and runner job loop.

Exit criteria:

- Runner can recover from network drop without losing job state.
- Restarted UI can replay events.
- Security review passes.

### Phase 5 - Broader Agent Support

Goal: add agents after core loop is stable.

Deliverables:

- Claude Code adapter.
- Gemini CLI adapter.
- Stream parsers and health checks.
- Per-adapter permission/auth guidance.

Exit criteria:

- At least four local agents are detected and at least three execute.
- Unsupported agents are clearly marked detection-only.

## Overbuilt Or Not Needed

Do not build these for V1:

- Full public SaaS billing.
- Full desktop app.
- Every local agent adapter.
- Vector DB/code memory.
- Browser automation.
- Cloud container execution.
- Plugin marketplace.
- Design-system marketplace.
- Multi-tenant hosted runner pool.
- Arbitrary remote shell access.
- Long-term autonomous agent scheduling.
- Fine-grained enterprise policy engine beyond workspace roots, permissions, audit, and runner tokens.

Defer these until the core web -> cloud -> runner -> local agent -> stream -> artifact loop is reliable.

## Acceptance Criteria For A Production-Ready MVP

The product is MVP-ready when all of this works:

- A user can install and run the Go runner.
- The runner detects OpenCode and Codex, including model lists.
- The web app shows real detected agents and models.
- The user can select panel, judge, and final models.
- A run created from the web executes through the local runner.
- The UI streams live panel progress, judge progress, and final answer.
- The final answer uses typewriter deltas.
- The run detail page survives refresh and replays events.
- Panel outputs, judge output, final answer, and logs are persisted as artifacts.
- Partial panel failure still produces a final answer.
- Cancellation stops the runner job.
- `/v1/chat/completions` works with `local/fusion`.
- OpenRouter Fusion can be used as a cloud mode.
- Workspace roots and permission profiles are enforced.
- No local secrets are read or stored.
- Audit events explain what happened.

## Recommended Immediate Next Step

Start with the active run lifecycle, not more UI polish.

Build this vertical slice:

```text
Web POST /api/fusion/runs
  -> API creates run plan
  -> API queues two panel jobs to RunnerSessionDO
  -> Go runner claims jobs
  -> Go runner runs OpenCode/Codex
  -> Go runner posts panel.output.delta and completion events
  -> FusionRunDO broadcasts events
  -> run page streams panel output live
```

After that, add judge and final. This prevents the product from becoming a polished shell around queued placeholders.

