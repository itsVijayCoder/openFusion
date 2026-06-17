# Fusion Harness -- Deployment Plan

**Document status:** v1.0  
**Current date:** 2026-06-17  
**Target:** Internal team deployment  

---

## 1. Deployment Architecture Overview

Fusion Harness has **4 deployable units** spread across 3 environments:

| Unit | Type | Platform | Package Manager |
|---|---|---|---|
| `apps/web` | Next.js 16 web app | Cloudflare Workers (OpenNext) | npm |
| `workers/api` | Cloudflare Worker API | Cloudflare Workers | npm |
| `workers/mcp` | Cloudflare MCP Worker | Cloudflare Workers | npm |
| `apps/runner-go` | Go native binary | macOS/Windows/Linux | Go 1.24+ |

```
┌──────────────────────────────────────────────────┐
│                  Cloudflare                       │
│  ┌──────────┐  ┌──────────┐  ┌──────────────┐   │
│  │ Web App  │  │ API      │  │ MCP Worker   │   │
│  │(OpenNext)│  │ Worker   │  │ (JSON-RPC)   │   │
│  └────┬─────┘  └────┬─────┘  └──────┬───────┘   │
│       │             │               │            │
│       └─────────────┼───────────────┘            │
│                     │                            │
│  ┌──────────────────┼─────────────────────────┐  │
│  │   D1 ◄── Durable Objects ◄── KV ◄── R2    │  │
│  │   (metadata)   (live state)  (cache) (files)│  │
│  └──────────────────┼─────────────────────────┘  │
│                     │                            │
│  ┌──────────────────┼─────────────────────────┐  │
│  │  AI Gateway ◄── Workflows ◄── Access ◄───┐ │  │
│  │  (API routing)   (jobs)      (SSO/auth)   │  │
│  └───────────────────────────────────────────┘  │
└──────────────────────────────────────────────────┘
                     │
          ┌──────────┴──────────┐
          │    Go Local Runner   │
          │  (macOS/Win/Linux)   │
          └─────────────────────┘
```

---

## 2. Prerequisites

### 2.1 Accounts and Access

- [ ] Cloudflare account with Workers Paid plan (required for Durable Objects)
- [ ] GitHub repository with Actions enabled
- [ ] npm registry access (public npm is fine)
- [ ] Cloudflare API token with permissions:
  - `Account.Workers Scripts:Edit`
  - `Account.D1:Edit`
  - `Account.KV Storage:Edit`
  - `Account.R2 Storage:Edit`
  - `Account.Durable Objects:Edit`
  - `Account.Workflows:Edit`
  - `Account.Access:Apps and Policies:Edit`

### 2.2 Developer Machine Tools

```bash
node --version    # >= 22
npm --version     # >= 11
go version        # >= 1.24
```

### 2.3 Install and Verify

```bash
# Clone and install
git clone <repo-url> fusion-harness
cd fusion-harness
npm install

# Verify TypeScript builds
npm run typecheck

# Verify Go runner builds
cd apps/runner-go
go build ./cmd/fusion-runner
cd ../..

# Login to Cloudflare
npx wrangler login
```

---

## 3. Cloudflare Resource Creation

Resources must be created **per environment** (`dev`, `staging`, `prod`). Run each command once per environment.

### 3.1 D1 Database

```bash
# Create D1 database
npx wrangler d1 create fusion_harness_dev
npx wrangler d1 create fusion_harness_staging
npx wrangler d1 create fusion_harness_prod
```

**Output:** Each command returns a `database_id`. Copy it.

### 3.2 KV Namespace

```bash
npx wrangler kv namespace create CONFIG_KV_DEV
npx wrangler kv namespace create CONFIG_KV_STAGING
npx wrangler kv namespace create CONFIG_KV_PROD
```

**Output:** Each command returns an `id`. Copy it.

### 3.3 R2 Bucket

```bash
npx wrangler r2 bucket create fusion-artifacts-dev
npx wrangler r2 bucket create fusion-artifacts-staging
npx wrangler r2 bucket create fusion-artifacts-prod
```

### 3.4 Cloudflare Access (Optional, for team SSO)

1. Go to Cloudflare Dashboard > Zero Trust > Access > Applications
2. Create a Self-hosted application
3. Set application domain to your web app URL
4. Add identity provider (Google Workspace, GitHub, Okta, etc.)
5. Create a policy allowing your team's email domain

---

## 4. Configuration Files Setup

### 4.1 API Worker -- `workers/api/wrangler.jsonc`

Replace placeholders with actual resource IDs from step 3:

```jsonc
{
  "$schema": "../../node_modules/wrangler/config-schema.json",
  "name": "fusion-api",
  "main": "src/index.ts",
  "compatibility_date": "2026-06-16",
  "compatibility_flags": ["nodejs_compat"],
  "observability": { "enabled": true },
  "vars": {
    "ENVIRONMENT": "dev",
    "PUBLIC_APP_URL": "http://localhost:3000"
  },
  "d1_databases": [{
    "binding": "DB",
    "database_name": "fusion_harness_dev",
    "database_id": "<PASTE_D1_DATABASE_ID>",
    "migrations_dir": "../../packages/db/migrations"
  }],
  "kv_namespaces": [{
    "binding": "CONFIG_KV",
    "id": "<PASTE_KV_NAMESPACE_ID>"
  }],
  "r2_buckets": [{
    "binding": "ARTIFACTS",
    "bucket_name": "fusion-artifacts-dev"
  }],
  "durable_objects": {
    "bindings": [
      { "name": "FUSION_RUN", "class_name": "FusionRunDO" },
      { "name": "RUNNER_SESSION", "class_name": "RunnerSessionDO" }
    ]
  },
  "migrations": [{
    "tag": "v1",
    "new_sqlite_classes": ["FusionRunDO", "RunnerSessionDO"]
  }],
  "workflows": [{
    "binding": "FUSION_WORKFLOW",
    "name": "fusion-workflow",
    "class_name": "FusionWorkflow"
  }]
}
```

### 4.2 MCP Worker -- `workers/mcp/wrangler.jsonc`

```jsonc
{
  "$schema": "../../node_modules/wrangler/config-schema.json",
  "name": "fusion-mcp",
  "main": "src/index.ts",
  "compatibility_date": "2026-06-16",
  "compatibility_flags": ["nodejs_compat"],
  "observability": { "enabled": true },
  "vars": {
    "ENVIRONMENT": "dev",
    "FUSION_API_URL": "http://localhost:8787"
  }
}
```

**For staging/prod:** Update `FUSION_API_URL` to the production API Worker URL.

### 4.3 Web App -- `apps/web/open-next.config.ts`

```ts
import { defineCloudflareConfig } from "@opennextjs/cloudflare";

export default defineCloudflareConfig({
  // Uncomment to enable R2 cache:
  // incrementalCache: r2IncrementalCache,
});
```

**No changes needed** for initial deployment. The web app uses `opennextjs-cloudflare` which handles the Cloudflare Worker configuration automatically.

---

## 5. Deployment Order

Deploy in this exact sequence:

```
1. D1 Migrations      →  Create database tables
2. API Worker         →  Backend API
3. MCP Worker         →  MCP endpoint
4. Web App            →  Frontend UI
5. Go Runner          →  Local execution
```

### 5.1 D1 Migrations

```bash
# Apply migrations (runs SQL files in packages/db/migrations/ in order)
npx wrangler d1 migrations apply fusion_harness_dev --local
npx wrangler d1 migrations apply fusion_harness_dev --remote

# For staging/prod
npx wrangler d1 migrations apply fusion_harness_staging --remote
npx wrangler d1 migrations apply fusion_harness_prod --remote
```

**Migration files (run in order):**
- `0001_initial_schema.sql` -- Creates all 10 tables + indexes
- `0002_model_source.sql` -- Adds `source` column to `models` table

**Verify:**
```bash
npx wrangler d1 execute fusion_harness_dev --local --command "SELECT name FROM sqlite_master WHERE type='table';"
```

### 5.2 API Worker

```bash
# Local dev
npx wrangler dev --config workers/api/wrangler.jsonc

# Deploy to Cloudflare
npx wrangler deploy --config workers/api/wrangler.jsonc

# For staging/prod (create separate wrangler.jsonc files per env)
npx wrangler deploy --config workers/api/wrangler.staging.jsonc
npx wrangler deploy --config workers/api/wrangler.prod.jsonc
```

**Verify:**
```bash
curl https://fusion-api.<your-subdomain>.workers.dev/api/health
# Expected: { "status": "ok", "environment": "dev" }
```

### 5.3 MCP Worker

```bash
# Local dev
npx wrangler dev --config workers/mcp/wrangler.jsonc

# Deploy
npx wrangler deploy --config workers/mcp/wrangler.jsonc
```

**Verify:**
```bash
curl -X POST https://fusion-mcp.<your-subdomain>.workers.dev/mcp \
  -H "Content-Type: application/json" \
  -d '{"jsonrpc":"2.0","method":"tools/list","id":1}'
```

### 5.4 Web App

```bash
cd apps/web

# Build and deploy in one command
npm run deploy

# Or step by step:
npm run build
npx opennextjs-cloudflare build
npx opennextjs-cloudflare deploy
```

**Verify:**
```bash
# Open the deployed URL in browser
# Check that the dashboard loads at /
# Check that the chat page loads at /chat
```

---

## 6. Go Runner Build and Distribution

### 6.1 Build for All Platforms

```bash
cd apps/runner-go

# macOS
GOOS=darwin  GOARCH=arm64 go build -o dist/fusion-runner-darwin-arm64   ./cmd/fusion-runner
GOOS=darwin  GOARCH=amd64 go build -o dist/fusion-runner-darwin-amd64   ./cmd/fusion-runner

# Linux
GOOS=linux   GOARCH=amd64 go build -o dist/fusion-runner-linux-amd64    ./cmd/fusion-runner
GOOS=linux   GOARCH=arm64 go build -o dist/fusion-runner-linux-arm64    ./cmd/fusion-runner

# Windows
GOOS=windows GOARCH=amd64 go build -o dist/fusion-runner-windows-amd64.exe ./cmd/fusion-runner
```

### 6.2 Distribute to Team

**Option A: Direct download**
Upload binaries to R2, GitHub Releases, or internal file server. Team members download and place in PATH.

**Option B: Homebrew (macOS)**
```bash
brew tap <org>/fusion-harness
brew install fusion-runner
```

**Option C: Install script**
```bash
curl -fsSL https://<internal-url>/install.sh | bash
```

### 6.3 Runner Setup on Team Machine

```bash
# Verify installation
fusion-runner doctor

# Expected output:
#   Fusion Runner 0.1.0
#   OS: darwin arm64
#   Cloud: not connected
#   Tools:
#     ✓ opencode .../opencode v1.x
#     ✓ codex .../codex v0.x
#     ✓ docker .../docker

# Login to cloud
fusion-runner login \
  --cloud-url https://fusion-api.<your-subdomain>.workers.dev \
  --token <runner-token>

# Start serving
fusion-runner serve
```

**Runner token** is managed by the API. The token is issued when a runner registers through the API. Until registration flow is fully implemented, you can bypass by running the runner in local-only mode.

---

## 7. Environment Variables Summary

### 7.1 API Worker (`workers/api/wrangler.jsonc`)

| Variable | Dev | Staging | Prod |
|---|---|---|---|
| `ENVIRONMENT` | `dev` | `staging` | `production` |
| `PUBLIC_APP_URL` | `http://localhost:3000` | `<staging-url>` | `<prod-url>` |
| `DB` (binding) | D1 database ID | D1 database ID | D1 database ID |
| `CONFIG_KV` (binding) | KV namespace ID | KV namespace ID | KV namespace ID |
| `ARTIFACTS` (binding) | R2 bucket name | R2 bucket name | R2 bucket name |

### 7.2 MCP Worker (`workers/mcp/wrangler.jsonc`)

| Variable | Dev | Staging | Prod |
|---|---|---|---|
| `ENVIRONMENT` | `dev` | `staging` | `production` |
| `FUSION_API_URL` | `http://localhost:8787` | `<staging-api-url>` | `<prod-api-url>` |

### 7.3 Go Runner (`~/.fusion-harness/config.json`)

| Variable | Default | Description |
|---|---|---|
| `FUSION_CLOUD_URL` | `http://localhost:8787` | API Worker URL |
| `FUSION_RUNNER_TOKEN` | (from login) | Auth token for cloud |
| `FUSION_AGENT_TOOL_DIRS` | (empty) | Extra PATH dirs for agent discovery |

### 7.4 Web App

No additional env vars needed. The web app uses `opennextjs-cloudflare` which auto-configures.

---

## 8. Multi-Environment Strategy

Create separate `wrangler.jsonc` files or use `wrangler.toml` with environments:

```
workers/api/
  wrangler.jsonc          # Dev (default)
  wrangler.staging.jsonc  # Staging (copy with different IDs)
  wrangler.prod.jsonc     # Production (copy with different IDs)
```

Deploy commands:
```bash
# Dev (default wrangler.jsonc)
npx wrangler deploy --config workers/api/wrangler.jsonc

# Staging
npx wrangler deploy --config workers/api/wrangler.staging.jsonc

# Production
npx wrangler deploy --config workers/api/wrangler.prod.jsonc
```

---

## 9. CI/CD Pipeline

### 9.1 GitHub Actions Workflow

Create `.github/workflows/deploy.yml`:

```yaml
name: deploy

on:
  push:
    branches: [main]
  workflow_dispatch:
    inputs:
      environment:
        description: 'Deploy target'
        required: true
        type: choice
        options: [dev, staging, prod]

jobs:
  typecheck-and-build:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with:
          node-version: 22
      - run: npm ci
      - run: npm run typecheck
      - run: npm run lint
      - run: npm run build 2>/dev/null || true

  deploy-api:
    needs: typecheck-and-build
    runs-on: ubuntu-latest
    if: github.event.inputs.environment != 'dev' || github.ref == 'refs/heads/main'
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with:
          node-version: 22
      - run: npm ci
      - name: Deploy API Worker
        run: |
          npx wrangler deploy \
            --config workers/api/wrangler.${{ github.event.inputs.environment }}.jsonc
        env:
          CLOUDFLARE_API_TOKEN: ${{ secrets.CF_API_TOKEN }}

  deploy-mcp:
    needs: typecheck-and-build
    runs-on: ubuntu-latest
    if: github.event.inputs.environment != 'dev' || github.ref == 'refs/heads/main'
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with:
          node-version: 22
      - run: npm ci
      - name: Deploy MCP Worker
        run: |
          npx wrangler deploy \
            --config workers/mcp/wrangler.${{ github.event.inputs.environment }}.jsonc
        env:
          CLOUDFLARE_API_TOKEN: ${{ secrets.CF_API_TOKEN }}

  deploy-web:
    needs: typecheck-and-build
    runs-on: ubuntu-latest
    if: github.event.inputs.environment != 'dev' || github.ref == 'refs/heads/main'
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with:
          node-version: 22
      - run: npm ci
      - name: Deploy Web App
        run: npm run deploy -w @fusion-harness/web
        env:
          CLOUDFLARE_API_TOKEN: ${{ secrets.CF_API_TOKEN }}

  build-runner:
    needs: typecheck-and-build
    runs-on: ubuntu-latest
    strategy:
      matrix:
        goos: [darwin, linux, windows]
        goarch: [amd64, arm64]
        exclude:
          - goos: windows
            goarch: arm64
          - goos: darwin
            goarch: amd64  # keep only arm64 for macOS
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-go@v5
        with:
          go-version: '1.24'
      - name: Build runner
        run: |
          cd apps/runner-go
          mkdir -p dist
          GOOS=${{ matrix.goos }} GOARCH=${{ matrix.goarch }} \
            go build -o dist/fusion-runner-${{ matrix.goos }}-${{ matrix.goarch }}${{ matrix.goos == 'windows' && '.exe' || '' }} \
            ./cmd/fusion-runner
      - name: Upload artifact
        uses: actions/upload-artifact@v4
        with:
          name: runner-${{ matrix.goos }}-${{ matrix.goarch }}
          path: apps/runner-go/dist/
```

### 9.2 GitHub Secrets

Set these in the repository settings:

| Secret | Value |
|---|---|
| `CF_API_TOKEN` | Cloudflare API token with Workers/D1/KV/R2/DO permissions |

---

## 10. Verification Checklist

After each deployment, verify:

### 10.1 API Worker

```bash
# Health check
curl https://fusion-api.<subdomain>.workers.dev/api/health

# List models
curl https://fusion-api.<subdomain>.workers.dev/api/models

# List runners
curl https://fusion-api.<subdomain>.workers.dev/api/runners

# OpenAI-compatible endpoint
curl https://fusion-api.<subdomain>.workers.dev/v1/models
```

### 10.2 MCP Worker

```bash
# List MCP tools
curl -X POST https://fusion-mcp.<subdomain>.workers.dev/mcp \
  -H "Content-Type: application/json" \
  -d '{"jsonrpc":"2.0","method":"tools/list","id":1}'
```

### 10.3 Web App

- [ ] Dashboard loads at `/`
- [ ] Chat/Task Console loads at `/chat`
- [ ] Models page loads at `/models`
- [ ] Runners page loads at `/runners`
- [ ] Runs page loads at `/runs`
- [ ] Settings pages load at `/settings/api`, `/settings/mcp`, `/settings/team`

### 10.4 Go Runner

```bash
# Doctor check
fusion-runner doctor

# Discovery
fusion-runner discover --json

# Local UI
fusion-runner ui --workspace /path/to/workspace
# Open http://127.0.0.1:7457

# Local fusion run
fusion-runner fuse \
  --workspace /path/to/workspace \
  --analysis-model opencode/openai/gpt-5 \
  --judge-model codex/gpt-5.5 \
  --final-model codex/gpt-5-codex \
  --prompt "Explain this repository."
```

---

## 11. Troubleshooting

### 11.1 "REPLACE_ME" errors in wrangler.jsonc

The `database_id` and KV `id` fields must be set to actual Cloudflare resource IDs. Run the creation commands in Section 3 and copy the output IDs.

### 11.2 Durable Object migration fails

```bash
# If DO migration fails, delete and recreate:
npx wrangler d1 migrations list fusion_harness_dev --remote
npx wrangler d1 migrations apply fusion_harness_dev --remote
```

### 11.3 OpenNext deployment fails

```bash
# Clear build cache
cd apps/web
rm -rf .open-next
npm run build
npx opennextjs-cloudflare build
```

### 11.4 Runner can't connect to API

```bash
# Check cloud URL
fusion-runner config show

# Test connectivity
curl https://fusion-api.<subdomain>.workers.dev/api/health

# Set correct cloud URL
fusion-runner config set cloud-url https://fusion-api.<subdomain>.workers.dev
```

### 11.5 CORS errors in browser

The API worker has CORS configured to allow the `PUBLIC_APP_URL` origin. Make sure the `PUBLIC_APP_URL` variable in `workers/api/wrangler.jsonc` matches the actual web app URL.

---

## 12. Quick Start (Single Command)

For local development only:

```bash
# Terminal 1: API Worker
npm run api:dev

# Terminal 2: Web App
npm run dev

# Terminal 3: Go Runner UI
cd apps/runner-go && go run ./cmd/fusion-runner ui --workspace /path/to/workspace

# Open http://localhost:3000 for web app
# Open http://127.0.0.1:7457 for local runner UI
```

For production deployment, follow the steps in Section 3 through Section 5 in order.

---

## 13. Resource Cleanup

To tear down a deployment:

```bash
# Delete workers
npx wrangler delete --config workers/api/wrangler.jsonc
npx wrangler delete --config workers/mcp/wrangler.jsonc

# Delete D1 database
npx wrangler d1 delete fusion_harness_dev

# Delete KV namespace
npx wrangler kv namespace delete CONFIG_KV_DEV

# Delete R2 bucket (must be empty first)
npx wrangler r2 bucket delete fusion-artifacts-dev
```