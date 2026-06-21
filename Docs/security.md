# Security

Default execution starts at `readonly`.

Workspace writes, shell commands, network access, Docker mounts, and artifact uploads must flow through explicit policy checks and audit events.

The runner must never read provider credential files, browser cookies, keychains, SSH keys, or raw token stores directly. It may use official CLI commands that report auth or model availability.

## Authentication and User Isolation

Fusion Harness uses server-side D1 sessions for browser users and scoped bearer
tokens for native runners.

- Browser auth is stored in the `fh_session` HttpOnly cookie and backed by the
  `auth_sessions` D1 table.
- Runner auth uses `auth_tokens` rows with hashed bearer tokens. The web app
  creates a token when the user copies an install command, and the runner stores
  it via `fusion-runner login --token`.
- OAuth identities are tracked in `oauth_accounts`; GitHub OAuth requires
  `GITHUB_OAUTH_CLIENT_ID` and `GITHUB_OAUTH_CLIENT_SECRET` Worker secrets.
- Each authenticated user receives a deterministic personal org namespace:
  `org_<user_id>`. Existing org-scoped tables therefore remain isolated per
  user while rows such as runs and runners also keep their explicit `user_id`.
- Runner bearer tokens are accepted only on runner endpoints. Browser APIs
  require a session-backed identity by default.
- Cookie-authenticated mutating requests must come from `PUBLIC_APP_URL`.
  Signed GitHub webhooks and bearer-token runner traffic are exempt from this
  origin check.
- Production should leave `AUTH_DEV_LOGIN_ENABLED` unset or `false`. Set it to
  `true` only for controlled development environments.
- Cloudflare Access headers are ignored unless
  `AUTH_TRUST_CLOUDFLARE_ACCESS=true`. Only enable this when the Worker route is
  actually protected by Cloudflare Access; GitHub OAuth is the default browser
  login path.

Required production secrets:

```bash
npx wrangler secret put GITHUB_OAUTH_CLIENT_ID
npx wrangler secret put GITHUB_OAUTH_CLIENT_SECRET
```

The GitHub OAuth callback URL is:

```text
https://fusion-api.asthrix.workers.dev/api/auth/oauth/github/callback
```
