# Cloudflare Deploy

Cloudflare resource IDs in `wrangler.jsonc` files are placeholders.

Create environment-specific D1, KV, R2, Durable Object, Workflow, AI Gateway, Access, and optional Tunnel resources before deployment.

The web app deploys from `apps/web`. The API Worker deploys from `workers/api`. The MCP Worker deploys from `workers/mcp`.
