# Fusion Harness

Fusion Harness is an internal multi-model coding and reasoning platform.

The repository follows the monorepo structure described in `Docs/FH_IMPLEMENTATION_GUIDE.md` and `Docs/FH_PRODUCT_PLAN.md`.

## Workspaces

```text
apps/web        Next.js web app deployed through OpenNext on Cloudflare
apps/desktop    Future desktop wrapper
apps/runner-go  Native Go local runner
workers/api     Cloudflare Worker API and Durable Objects
workers/mcp     Cloudflare remote MCP Worker
packages/core   Fusion planning, model selection, permissions, and prompt contracts
packages/db     D1 schema, migrations, and query helpers
packages/shared Shared types, IDs, errors, events, and Zod schemas
packages/ui     Future shared UI package
configs         Presets, permissions, and provider catalog
Docs            Product and implementation planning docs
```

## Development

Install dependencies:

```bash
npm install
```

Run the web app:

```bash
npm run dev
```

Run workspace checks:

```bash
npm run typecheck
npm run lint
npm run runner:test
```

Build all JavaScript/TypeScript workspaces:

```bash
npm run build
```

## Cloudflare

The web app keeps its OpenNext config in `apps/web`.

The API and MCP Workers keep separate `wrangler.jsonc` files under `workers/api` and `workers/mcp`. Cloudflare resource IDs are placeholders until dev/staging/prod resources are created.

Current Worker API coverage:

- Native APIs for health, dashboard, runners, models, workspaces, fusion runs, approvals, and artifacts.
- OpenAI-compatible `/v1/models` and `/v1/chat/completions`.
- Durable Objects for fusion run event buffers and runner session queues.
- R2 prompt/artifact object storage with D1 metadata.
- Remote MCP `/mcp` JSON-RPC tool listing and tool-call proxying.

## Runner

The Go runner is in `apps/runner-go`.

```bash
cd apps/runner-go
go test ./...
go run ./cmd/fusion-runner doctor
go run ./cmd/fusion-runner discover --json
go run ./cmd/fusion-runner login --cloud-url http://localhost:8787 --token <runner-token>
go run ./cmd/fusion-runner serve --once
```

Runner capabilities include config persistence, OpenCode/Codex/Docker/Git discovery, adapter model metadata, host execution with workspace validation, Docker execution with conservative sandbox flags, API registration, and heartbeat support.

Run the local Go harness UI:

```bash
cd apps/runner-go
go run ./cmd/fusion-runner ui --workspace /path/to/workspace
```

Then open `http://127.0.0.1:7457`. The UI detects local agent CLIs, lets you choose panel, judge, and final models, and runs the OpenRouter-style panel -> judge -> final-writer pipeline through local OpenCode/Codex sessions. Choose `default` to let the selected CLI use its own configured model.

Run the same fusion flow from the terminal:

```bash
cd apps/runner-go
go run ./cmd/fusion-runner fuse \
  --workspace /path/to/workspace \
  --analysis-model opencode/openai/gpt-5 \
  --analysis-model codex/gpt-5-codex \
  --judge-model codex/gpt-5.5 \
  --final-model codex/gpt-5-codex \
  --prompt "Compare the options and produce the best answer."
```

## Phase Status

| Phase | Status |
| --- | --- |
| Phase 0 - Discovery and hardening | Product docs, security defaults, monorepo, and schema are present. |
| Phase 1 - Cloud shell | Worker API, D1 schema, R2 artifact metadata, Durable Objects, OpenAI aliases, and web shell are implemented. |
| Phase 2 - Go local runner MVP | Doctor, discover, login/logout, config, serve heartbeat, and run-test are implemented. |
| Phase 3 - OpenCode adapter | Detection, model listing fallback, and non-interactive run command are implemented. |
| Phase 4 - Codex adapter | Detection, configured model metadata, sandbox mapping, and `codex exec` command are implemented. |
| Phase 5 - Fusion orchestration | Core planning, selection, panel/judge/final prompts, judge parsing, and execution plan generation are implemented. |
| Phase 6 - File edits, patches, Docker | Workspace allowlist checks, safe host executor, Docker executor defaults, artifact records, and approval flow are implemented. |
| Phase 7 - OpenAI-compatible API and MCP | `/v1` API, streaming queued response, remote MCP tools, and tool proxying are implemented. |
| Phase 8 - Team product polish | Dashboard, trace views, settings, audit surfaces, docs, build/lint/typecheck, and runner tests are implemented. |
