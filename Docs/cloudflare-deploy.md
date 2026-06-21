# Cloudflare Deploy

Fusion Harness deploys the hosted control plane to Cloudflare and keeps local
agent execution on a trusted user machine.

## Deployment shape

Cloudflare hosts these services:

- `fusion-harness`: Next.js web app compiled by OpenNext and deployed as a Worker.
- `fusion-api`: Hono API Worker with D1, KV, Durable Objects, and optional R2.
- `fusion-mcp`: optional MCP Worker that points at `fusion-api`.

The Go runner is not deployed to Cloudflare. Install it once on the user's
trusted machine:

```bash
curl -fsSL https://fusion-harness.asthrix.workers.dev/install/macos.sh | bash -s -- --cloud-url https://fusion-api.asthrix.workers.dev --token <runner-token>
```

```powershell
powershell.exe -NoProfile -ExecutionPolicy Bypass -Command "& ([scriptblock]::Create((irm 'https://fusion-harness.asthrix.workers.dev/install/windows.ps1'))) --cloud-url 'https://fusion-api.asthrix.workers.dev' --token '<runner-token>'"
```

The macOS installer registers a LaunchAgent. The Windows installer registers a
current-user scheduled task. Both keep the runner available after login without a
manual terminal command. The runner detects local CLIs, registers models, polls
jobs from the API, runs panel/judge/final jobs locally, and streams results back
to Cloudflare.

## Scripts

Root deployment scripts:

```bash
npm run api:migrate:remote
npm run api:deploy
npm run mcp:deploy
npm run web:deploy
npm run deploy:cloudflare
```

`npm run deploy:cloudflare` runs typechecking, applies remote D1 migrations,
deploys the API Worker, deploys the MCP Worker, then deploys the OpenNext web
Worker. `npm run deploy` is an alias for the same production path. The web
deploy script forces the production API URL so a local `.env.local` cannot be
accidentally baked into the deployed OpenNext bundle.

For local D1 migrations used by `wrangler dev`:

```bash
npm run api:migrate:local
```

## One-time Cloudflare setup

Configure GitHub OAuth before exposing the production login page. Follow
`Docs/GITHUB_OAUTH_SETUP.md` to create the GitHub OAuth App, set Worker
secrets, and verify `/api/auth/me`.

1. Authenticate Wrangler:

```bash
npx wrangler login
```

2. Confirm `workers/api/wrangler.jsonc` has real resource IDs for:

- D1 binding `DB`
- KV binding `CONFIG_KV`
- Durable Objects `FUSION_RUN` and `RUNNER_SESSION`

3. Create and bind an R2 bucket if artifact body storage is required:

```jsonc
"r2_buckets": [
  {
    "binding": "ARTIFACTS",
    "bucket_name": "fusion-harness-artifacts"
  }
]
```

The API treats `ARTIFACTS` as optional. Without it, run metadata still persists
in D1, but artifact body reads/writes are degraded.

4. Keep cross-service URLs aligned:

- `workers/api/wrangler.jsonc`: `PUBLIC_APP_URL` should point at the deployed web URL.
- `apps/web/wrangler.jsonc`: `NEXT_PUBLIC_API_BASE_URL` should point at the deployed API URL.
- `workers/mcp/wrangler.jsonc`: `FUSION_API_URL` should point at the deployed API URL.

## Deploy

From the repository root:

```bash
npm ci
npm run deploy:cloudflare
```

For a web-only redeploy after UI changes:

```bash
npm run web:deploy
```

For an API-only redeploy after Worker or schema changes:

```bash
npm run api:migrate:remote
npm run api:deploy
```

## Verify

```bash
curl https://fusion-api.asthrix.workers.dev/api/health
curl https://fusion-api.asthrix.workers.dev/api/runners
```

Then install or refresh a local runner:

```bash
curl -fsSL https://fusion-harness.asthrix.workers.dev/install/macos.sh | bash -s -- --cloud-url https://fusion-api.asthrix.workers.dev --token <runner-token>
```

```powershell
powershell.exe -NoProfile -ExecutionPolicy Bypass -Command "& ([scriptblock]::Create((irm 'https://fusion-harness.asthrix.workers.dev/install/windows.ps1'))) --cloud-url 'https://fusion-api.asthrix.workers.dev' --token '<runner-token>'"
```

Open the deployed web app and check `/runners`. The runner should appear with
detected tools and model counts. A hosted browser cannot scan local binaries on
its own; the native runner process is the trusted local execution plane.

## OpenDesign comparison

OpenDesign does not let a purely deployed browser detect local agents natively.
Its packaged app starts native Electron sidecars: a web sidecar and a privileged
daemon sidecar. The daemon scans PATH, repairs GUI launch environments, runs
CLI probes, and spawns local agents.

Fusion Harness uses the same trust boundary with a different implementation:
Cloudflare hosts the control plane, and the Go runner replaces OpenDesign's
local daemon for agent detection and execution. To get an OpenDesign-like
one-click startup experience, Fusion Harness needs a signed desktop helper or a
registered `fusion-runner://` protocol handler that launches the Go runner.

References:

- Cloudflare Next.js on Workers: https://developers.cloudflare.com/workers/framework-guides/web-apps/nextjs/
- Cloudflare D1 migrations: https://developers.cloudflare.com/d1/reference/migrations/
