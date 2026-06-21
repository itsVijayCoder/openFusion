# GitHub OAuth Setup

This guide configures GitHub OAuth for browser sign-in to Fusion Harness.

This is separate from the GitHub App in `Docs/GITHUB_APP_SETUP.md`. The OAuth
App signs users into Fusion Harness. The GitHub App handles repository
installations, webhooks, and PR review permissions.

## Production Values

Use these values for the current Cloudflare deployment:

| Setting | Value |
| --- | --- |
| Web app URL | `https://fusion-harness.asthrix.workers.dev` |
| API URL | `https://fusion-api.asthrix.workers.dev` |
| Login URL | `https://fusion-harness.asthrix.workers.dev/login` |
| Authorization callback URL | `https://fusion-api.asthrix.workers.dev/api/auth/oauth/github/callback` |

The callback URL must point to the API Worker, not the web Worker. The API
Worker exchanges the GitHub authorization code, creates the D1-backed session,
and sets the `fh_session` HttpOnly cookie.

## 1. Confirm Worker URLs

Before creating the OAuth App, confirm the configured production URLs:

```bash
sed -n '1,40p' workers/api/wrangler.jsonc
sed -n '1,40p' apps/web/wrangler.jsonc
```

Check these values:

- `workers/api/wrangler.jsonc` has `PUBLIC_APP_URL` set to the deployed web URL.
- `apps/web/wrangler.jsonc` has `NEXT_PUBLIC_API_BASE_URL` set to the deployed API URL.
- `workers/api/wrangler.jsonc` keeps `ENVIRONMENT` as `production`.

For the current production deployment:

```jsonc
{
  "vars": {
    "ENVIRONMENT": "production",
    "PUBLIC_APP_URL": "https://fusion-harness.asthrix.workers.dev"
  }
}
```

## 2. Create the GitHub OAuth App

1. Open GitHub.
2. Click your profile picture.
3. Go to **Settings**.
4. Go to **Developer settings**.
5. Go to **OAuth apps**.
6. Click **New OAuth App** or **Register a new application**.
7. Fill in the app details:

| Field | Value |
| --- | --- |
| Application name | `Fusion Harness` |
| Homepage URL | `https://fusion-harness.asthrix.workers.dev` |
| Application description | `Fusion Harness browser sign-in` |
| Authorization callback URL | `https://fusion-api.asthrix.workers.dev/api/auth/oauth/github/callback` |

8. Leave **Enable Device Flow** disabled unless you explicitly add a device-flow
   implementation later.
9. Click **Register application**.

Important: a GitHub OAuth App has one authorization callback URL. Create a
separate OAuth App for staging or local development instead of reusing the
production one.

## 3. Copy OAuth Credentials

After registration:

1. Copy the **Client ID**.
2. Click **Generate a new client secret**.
3. Copy the secret immediately.

Treat the client secret as a production secret. Do not paste it into
`wrangler.jsonc`, docs, screenshots, tickets, or committed `.env` files.

## 4. Store Secrets in Cloudflare

Run these commands from the API Worker directory because its `wrangler.jsonc`
defines the `fusion-api` Worker:

```bash
cd workers/api
npx wrangler secret put GITHUB_OAUTH_CLIENT_ID
npx wrangler secret put GITHUB_OAUTH_CLIENT_SECRET
cd ../..
```

Paste the GitHub Client ID when Wrangler prompts for
`GITHUB_OAUTH_CLIENT_ID`. Paste the GitHub Client Secret when Wrangler prompts
for `GITHUB_OAUTH_CLIENT_SECRET`.

Production should keep development login disabled:

```text
AUTH_DEV_LOGIN_ENABLED unset or false
```

Only set this if Cloudflare Access is actually protecting the API route:

```text
AUTH_TRUST_CLOUDFLARE_ACCESS=true
```

For normal GitHub OAuth login, leave `AUTH_TRUST_CLOUDFLARE_ACCESS` unset.

## 5. Apply D1 Migration and Deploy

From the repository root:

```bash
npm run deploy:cloudflare
```

This runs typechecking, applies remote D1 migrations, deploys the API Worker,
deploys the MCP Worker, and deploys the web Worker.

If you only need to refresh the API after setting secrets:

```bash
npm run api:migrate:remote
npm run api:deploy
```

The auth migration creates:

- `auth_sessions`
- `auth_tokens`
- `oauth_accounts`
- `oauth_states`

## 6. Verify OAuth Configuration

Check the API reports OAuth as configured:

```bash
curl https://fusion-api.asthrix.workers.dev/api/auth/me
```

Expected production shape:

```json
{
  "authenticated": false,
  "user": null,
  "githubOAuthConfigured": true,
  "devLoginEnabled": false
}
```

Then verify the browser flow:

1. Open `https://fusion-harness.asthrix.workers.dev/login`.
2. Click **Continue with GitHub**.
3. Authorize the OAuth App in GitHub.
4. Confirm GitHub redirects back to Fusion Harness.
5. Confirm the app lands on `/dashboard`.
6. Open `/runners` and copy an install command. The copy action should mint a
   user-scoped runner token.

The API domain should set an HttpOnly `fh_session` cookie with `Secure` and
`SameSite=None` in production.

## 7. Local Development OAuth

Use a separate GitHub OAuth App for local development.

Local values:

| Setting | Value |
| --- | --- |
| Homepage URL | `http://localhost:3000` |
| Authorization callback URL | `http://localhost:8787/api/auth/oauth/github/callback` |

Create `workers/api/.dev.vars` and keep it uncommitted:

```bash
ENVIRONMENT=dev
PUBLIC_APP_URL=http://localhost:3000
AUTH_DEV_LOGIN_ENABLED=true
GITHUB_OAUTH_CLIENT_ID=<local-oauth-client-id>
GITHUB_OAUTH_CLIENT_SECRET=<local-oauth-client-secret>
```

Start local services:

```bash
npm run api:migrate:local
npm run api:dev
npm run dev
```

Then open:

```text
http://localhost:3000/login
```

## Troubleshooting

| Symptom | Cause | Fix |
| --- | --- | --- |
| `githubOAuthConfigured: false` | Missing OAuth secrets on the API Worker | Re-run `wrangler secret put` from `workers/api` |
| GitHub shows redirect/callback mismatch | OAuth App callback URL does not match the API callback URL | Set the exact callback URL from this guide |
| App returns to `/login?error=github_oauth_state_expired` | OAuth state expired, was already consumed, or a stale tab was used | Start sign-in again from `/login` |
| App returns to `/login?error=github_oauth_failed` | Code exchange or GitHub user lookup failed | Check Worker logs and confirm Client ID/Secret |
| Email login is disabled | Expected in production | Use GitHub OAuth, or enable dev login only in controlled dev environments |
| Mutating API requests return `Invalid request origin` | `PUBLIC_APP_URL` does not match the browser origin | Update `workers/api/wrangler.jsonc` and redeploy API |
| Login succeeds but pages show fallback data | Web/API URL mismatch or cookies not sent to API domain | Confirm `NEXT_PUBLIC_API_BASE_URL`, `PUBLIC_APP_URL`, HTTPS, and browser third-party cookie policy |

Useful log command:

```bash
cd workers/api
npx wrangler tail fusion-api
```

## Security Checklist

- Keep the GitHub OAuth Client Secret only in Cloudflare Worker secrets.
- Do not commit `.dev.vars`, `.env`, screenshots, or copied secrets.
- Use separate OAuth Apps for production, staging, and local development.
- Keep production `AUTH_DEV_LOGIN_ENABLED` unset or `false`.
- Keep `AUTH_TRUST_CLOUDFLARE_ACCESS` unset unless Cloudflare Access protects
  the API route.
- Keep the production callback on HTTPS.
- Do not enable GitHub Device Flow unless a device-flow auth path is implemented.

## References

- GitHub OAuth App creation: https://docs.github.com/en/apps/oauth-apps/building-oauth-apps/creating-an-oauth-app
- GitHub OAuth redirect URL rules: https://docs.github.com/en/apps/oauth-apps/building-oauth-apps/authorizing-oauth-apps
- Cloudflare Worker secrets and local dev vars: https://developers.cloudflare.com/workers/wrangler/configuration/
