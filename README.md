# Fusion Harness

Fusion Harness is an internal multi-model coding and reasoning platform.

The repository now follows the monorepo structure described in `Docs/fusion-harness-implementation-guide.md`.

## Workspaces

```text
apps/web        Next.js web app deployed through OpenNext on Cloudflare
apps/desktop    Future desktop wrapper
apps/runner-go  Native Go local runner
workers/api     Cloudflare Worker API and Durable Objects
workers/mcp     Cloudflare remote MCP Worker scaffold
packages/core   Fusion, model selection, permissions, and run contracts
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

## Runner

The Go runner scaffold is in `apps/runner-go`.

```bash
cd apps/runner-go
go test ./...
go run ./cmd/fusion-runner doctor
go run ./cmd/fusion-runner discover --json
```
