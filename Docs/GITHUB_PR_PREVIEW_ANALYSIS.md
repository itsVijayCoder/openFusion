# GitHub PR Preview — Production Issue Analysis & System Design Review

**Date:** 2026-06-23  
**Status:** Analysis complete  
**Severity:** Critical — entire GitHub PR review feature is broken in production

---

## Table of Contents

1. [Executive Summary](#1-executive-summary)
2. [Confirmed Production Error](#2-confirmed-production-error)
3. [Root Cause Analysis](#3-root-cause-analysis)
4. [Cascade Impact Map](#4-cascade-impact-map)
5. [Current System Design](#5-current-system-design)
6. [Design Weaknesses That Need Upgrades](#6-design-weaknesses-that-need-upgrades)
7. [Pros and Cons of Current Approach](#7-pros-and-cons-of-current-approach)
8. [Alternative Methods (Efficient Approaches)](#8-alternative-methods-efficient-approaches)
9. [Recommended Fix Plan](#9-recommended-fix-plan)
10. [Verification Checklist](#10-verification-checklist)

---

## 1. Executive Summary

The GitHub PR preview feature works locally but is completely broken in production. The production API returns:

```json
{
  "configured": true,
  "appId": "4106706",
  "appSlug": "",
  "appName": "",
  "htmlUrl": "",
  "error": "ASN.1 parse error: content exceeds buffer"
}
```

**The root cause is a corrupted `GITHUB_APP_PRIVATE_KEY` Cloudflare Worker secret.** The PEM private key was truncated or mangled when set via `wrangler secret put`, causing the custom ASN.1 parser to fail. Because the GitHub App JWT cannot be generated, every downstream GitHub API call fails — app details, installations, repositories, and PR sync are all broken.

A secondary issue is that `GITHUB_APP_SLUG` (the only fallback when the API call fails) is not documented in the setup guide and is not set as a production secret, so there is zero graceful degradation.

---

## 2. Confirmed Production Error

### Live production response

```bash
$ curl https://fusion-api.asthrix.workers.dev/api/github/status
{"configured":true,"appId":"4106706","appSlug":"","appName":"","htmlUrl":"","error":"ASN.1 parse error: content exceeds buffer"}
```

### Error source

The error originates in `workers/api/src/services/github-app.ts:322`:

```typescript
function readAsn1(bytes: Uint8Array, offset: number): Asn1Element {
  // ...
  if (contentStart + contentLength > bytes.length) {
    throw new Error("ASN.1 parse error: content exceeds buffer");
  }
  // ...
}
```

This means the DER-encoded private key data is incomplete — the ASN.1 length header claims more bytes than are actually present in the buffer. The PEM key was truncated when stored as a Cloudflare secret.

### Local vs production comparison

| Aspect | Local (`.dev.vars`) | Production (Worker secret) |
| --- | --- | --- |
| `GITHUB_APP_ID` | `4106706` | `4106706` |
| `GITHUB_APP_PRIVATE_KEY` | Full multi-line PEM, correct | Truncated/corrupted |
| `GITHUB_APP_SLUG` | Not set (not needed — API call succeeds) | Not set (no fallback) |
| `getAppDetails()` | Succeeds — returns slug from GitHub API | Fails — ASN.1 parse error |
| App slug displayed | Correct slug from API | Empty string |
| Repos synced | Yes — installations and repos sync | No — all GitHub API calls fail |
| Install URL | `https://github.com/apps/<slug>/installations/new` | `null` (slug is empty) |

---

## 3. Root Cause Analysis

### Why the private key is corrupted in production

The `GITHUB_APP_SETUP.md` guide instructs:

```bash
npx wrangler secret put GITHUB_APP_PRIVATE_KEY
# Paste the full contents of the .pem file including BEGIN/END lines
```

When pasting a multi-line PEM key interactively into the terminal prompt:

1. **Terminal line buffering** can truncate the paste at the first newline or at a terminal width boundary.
2. **Some terminals** interpret pasted newlines as Enter key presses, causing premature submission.
3. **Shell escape sequences** in the key can be interpreted by the shell.
4. **The key may have been pasted without the `-----BEGIN` / `-----END`` markers** or with missing lines.

The correct method is to pipe the file directly:

```bash
cat private-key.pem | npx wrangler secret put GITHUB_APP_PRIVATE_KEY
```

### Why there is no fallback

The `/status` endpoint in `workers/api/src/routes/github.ts:24-50` has this logic:

```typescript
try {
  const auth = new GitHubAppAuth(c.env);
  const details = await auth.getAppDetails();
  return c.json({
    configured: true,
    appId: c.env.GITHUB_APP_ID,
    appSlug: details.slug,      // from GitHub API
    appName: details.name,
    htmlUrl: details.htmlUrl,
  });
} catch (error) {
  return c.json({
    configured: true,
    appId: c.env.GITHUB_APP_ID,
    appSlug: c.env.GITHUB_APP_SLUG ?? "",  // fallback — NOT SET in production
    appName: "",
    htmlUrl: "",
    error: error instanceof Error ? error.message : "GitHub App lookup failed",
  });
}
```

The `GITHUB_APP_SLUG` environment variable:
- Is declared as optional in `workers/api/src/env.ts:18`
- Is referenced only once in the fallback path of `routes/github.ts:44`
- Is **never mentioned** in `Docs/GITHUB_APP_SETUP.md`
- Is **not set** as a production secret

### Why repos don't show

The repo sync flow in `workers/api/src/services/github-sync.ts` uses the same `GitHubAppAuth` class:

```
syncAll()
  → syncInstallations()     → auth.fetchAsApp("/app/installations")
  → syncRepositoriesForInstallation() → auth.fetchAsInstallation(installationId, "/installation/repositories")
  → syncPullRequestsForRepository()   → auth.fetchAsInstallation(installationId, "/repos/.../pulls")
```

All of these call `getAppJwt()` or `getInstallationToken()`, both of which call `importPrivateKey()`, which calls `pemRsaPrivateKeyToJwk(pem)`, which calls `pemToDer(pem)`, which calls `parseRsaPrivateKeyDer(der)`, which calls `readAsn1()` — the exact function that throws the error.

**One corrupted secret breaks the entire GitHub integration.**

---

## 4. Cascade Impact Map

```
GITHUB_APP_PRIVATE_KEY (corrupted)
  │
  ├── getAppJwt() fails
  │     ├── getAppDetails() fails
  │     │     ├── /api/github/status returns empty appSlug, appName, htmlUrl
  │     │     ├── Frontend cannot build install URL
  │     │     └── Frontend shows "Not loaded" for App Slug
  │     │
  │     ├── getInstallationToken() fails
  │     │     ├── syncInstallations() fails → no installations in D1
  │     │     ├── syncRepositoriesForInstallation() fails → no repos in D1
  │     │     ├── syncPullRequestsForRepository() fails → no PRs in D1
  │     │     ├── fetchAndStorePrDiff() fails → no diff snapshots
  │     │     ├── publishPrReview() fails → cannot publish reviews
  │     │     └── Webhook processor cannot fetch PR details
  │     │
  │     └── Webhook signature verification may fail
  │           (webhook secret is separate, but app auth for API calls fails)
  │
  └── Entire /settings/github page shows:
        ├── App ID: 4106706 (correct — from env var, not API)
        ├── App Slug: "Not loaded" (empty fallback)
        ├── App Name: "Fusion GitHub App" (hardcoded fallback)
        ├── Install on GitHub button: hidden (no install URL)
        ├── Installed Accounts table: empty
        ├── Repositories table: empty
        └── PR Reviews queue: empty
```

---

## 5. Current System Design

### Architecture overview

```
┌─────────────────────────────────────────────────────────────┐
│  Browser (Next.js web app)                                  │
│  apps/web                                                   │
│  ┌─────────────┐  ┌──────────────┐  ┌────────────────────┐ │
│  │ /settings/  │  │ /pr-reviews  │  │ /pr-reviews/[id]   │ │
│  │ github      │  │ (queue)      │  │ (detail + diff)    │ │
│  └──────┬──────┘  └──────┬───────┘  └─────────┬──────────┘ │
│         │                │                     │            │
│         └────────────────┼─────────────────────┘            │
│                          │ fetch with credentials            │
└──────────────────────────┼──────────────────────────────────┘
                           │
┌──────────────────────────┼──────────────────────────────────┐
│  Cloudflare Worker API    ▼  (fusion-api)                   │
│  workers/api                                                │
│  ┌──────────────────────────────────────────────────────┐   │
│  │  Hono routes                                          │   │
│  │  /api/github/status    → GitHubAppAuth.getAppDetails()│   │
│  │  /api/github/sync      → syncAll()                    │   │
│  │  /api/github/installations → D1 query                 │   │
│  │  /api/github/repositories  → D1 query                 │   │
│  │  /api/pr-reviews       → D1 query                     │   │
│  │  /api/pr-reviews/:id   → D1 query                     │   │
│  │  /api/pr-reviews/:id/diff → GitHubAppAuth + R2        │   │
│  │  /api/pr-reviews/:id/publish → GitHubAppAuth          │   │
│  │  /api/github/webhook   → webhook processor            │   │
│  └──────────────────────────────────────────────────────┘   │
│  ┌────────────┐  ┌───┐  ┌────┐  ┌──────────────┐           │
│  │ D1 (meta)  │  │KV │  │ R2 │  │ Durable Objs │           │
│  └────────────┘  └───┘  └────┘  └──────────────┘           │
└─────────────────────────────────────────────────────────────┘
                           │
                           ▼ (JWT auth with private key)
              ┌────────────────────────┐
              │  GitHub API            │
              │  api.github.com        │
              │  /app                  │
              │  /app/installations    │
              │  /installation/repositories │
              │  /repos/:owner/:repo/pulls  │
              └────────────────────────┘
```

### Key components

| Component | File | Responsibility |
| --- | --- | --- |
| GitHub App Auth | `workers/api/src/services/github-app.ts` | JWT generation, installation tokens, app details, PEM key parsing |
| GitHub Sync | `workers/api/src/services/github-sync.ts` | Sync installations, repos, PRs from GitHub API to D1 |
| GitHub Webhook | `workers/api/src/services/github-webhook.ts` | Receive and verify webhook events |
| GitHub Webhook Processor | `workers/api/src/services/github-webhook-processor.ts` | Process PR, installation, and review events |
| GitHub Diff | `workers/api/src/services/github-diff.ts` | Fetch and store PR diff snapshots in R2 |
| PR Review Execution | `workers/api/src/services/pr-review-execution.ts` | Start review runs, coordinate with runner |
| PR Review Publish | `workers/api/src/services/pr-review-publish.ts` | Publish draft comments as GitHub review |
| GitHub Routes | `workers/api/src/routes/github.ts` | Status, installations, repositories, sync, user-links |
| PR Review Routes | `workers/api/src/routes/pr-reviews.ts` | Queue, detail, diff, start, publish, comments |
| GitHub Settings Page | `apps/web/src/app/settings/github/page.tsx` | Display app connection, installations, repos |
| PR Reviews Page | `apps/web/src/app/pr-reviews/page.tsx` | PR queue with filters |
| PR Review Detail | `apps/web/src/app/pr-reviews/[prId]/page.tsx` | PR detail with diff viewer, comments, runs |

### Auth flow

```
GitHub OAuth App (sign-in)
  → /api/auth/oauth/github/start
  → GitHub authorize page
  → /api/auth/oauth/github/callback
  → exchange code for token
  → fetch GitHub user
  → create D1 session
  → set fh_session cookie (HttpOnly, SameSite=None, Secure)
  → redirect to /dashboard

GitHub App (repo access)
  → JWT signed with GITHUB_APP_PRIVATE_KEY
  → GET /app (app details)
  → POST /app/installations/:id/access_tokens (installation token)
  → GET /installation/repositories (repo list)
  → GET /repos/:owner/:repo/pulls (PR list)
```

---

## 6. Design Weaknesses That Need Upgrades

### 6.1 Single point of failure: private key parsing

**Problem:** The entire GitHub integration depends on a single `GITHUB_APP_PRIVATE_KEY` secret being perfectly formatted. If it's corrupted, everything fails — status, sync, webhooks, diff fetching, publishing.

**Current parser:** A custom hand-written ASN.1/PEM parser in `github-app.ts` (lines 179-331). This is 150+ lines of manual DER parsing with no test coverage for edge cases.

**Risk:** Any formatting issue (truncated key, wrong line endings, extra whitespace, PKCS#1 vs PKCS#8 confusion) silently breaks the entire feature.

**Upgrade needed:**
- Use the Web Crypto API's native key import if possible
- Or use a battle-tested library like `node:crypto` (available via `nodejs_compat`)
- Add a startup health check that validates the key can be parsed
- Surface parse errors clearly in the `/status` endpoint with actionable messages

### 6.2 No graceful degradation

**Problem:** When `getAppDetails()` fails, the system has no fallback for the app slug. The `GITHUB_APP_SLUG` env var exists but is undocumented and unset in production.

**Impact:** The install URL can't be built, the app name shows a generic fallback, and the user has no way to install the app or navigate to it on GitHub.

**Upgrade needed:**
- Document `GITHUB_APP_SLUG` in the setup guide as a required secret
- Cache app details in D1 or KV after the first successful fetch
- If the API call fails but cached details exist, use the cache
- Show the error message in the UI so the user knows something is wrong

### 6.3 In-memory token cache is per-isolate

**Problem:** `tokenCache` in `github-app.ts:13` is a `Map<number, CachedInstallationToken>` stored in module-level memory. Cloudflare Workers run in multiple isolates, and each isolate has its own copy of this Map.

**Impact:** Installation tokens are re-fetched from GitHub on every isolate that handles a request. With 5+ isolates, this means 5+ token requests per hour per installation instead of 1. This wastes GitHub API rate limit budget.

**Upgrade needed:**
- Move token cache to KV (with TTL matching the token expiry)
- Or use Durable Object state for per-installation token caching
- Or accept the per-isolate cache but add a short KV-backed deduplication layer

### 6.4 No retry or circuit breaker for GitHub API calls

**Problem:** All GitHub API calls in `github-sync.ts` and `github-app.ts` are single-attempt `fetch()` calls with no retry logic. If GitHub returns a 5xx or a rate limit error, the entire sync fails.

**Impact:** A transient GitHub API error causes the sync to fail completely. The user has to manually click "Sync" again.

**Upgrade needed:**
- Add exponential backoff retry for 5xx and 429 responses
- Respect `Retry-After` header for rate limits
- Add a circuit breaker that temporarily stops API calls after consecutive failures
- Return partial sync results instead of failing the entire sync

### 6.5 Error messages are not user-actionable

**Problem:** The `/status` endpoint returns the raw error message (`ASN.1 parse error: content exceeds buffer`) which is meaningless to a user. The frontend displays it in a `DataNotice` component but doesn't explain what to do.

**Impact:** The user sees a cryptic error and doesn't know how to fix it.

**Upgrade needed:**
- Map known errors to user-friendly messages with remediation steps
- Example: "ASN.1 parse error" → "The GitHub App private key is malformed. Re-set it using: `cat key.pem | npx wrangler secret put GITHUB_APP_PRIVATE_KEY`"
- Show a "Fix this" link to the setup guide

### 6.6 No health check for GitHub App configuration

**Problem:** There is no endpoint that validates the full GitHub App configuration (key parseable, JWT generatable, app reachable, installation token obtainable). The `/status` endpoint only checks if the env vars are set and tries one API call.

**Impact:** The user has to discover configuration problems by navigating to the settings page and seeing broken data.

**Upgrade needed:**
- Add a `/api/github/health` endpoint that runs a full diagnostic:
  1. Can the private key be parsed?
  2. Can a JWT be generated?
  3. Can the app be reached via JWT auth?
  4. Are there installations?
  5. Can an installation token be obtained?
  6. Can repositories be listed?
- Return a structured health report with each step's status
- Show this in the UI as a diagnostic panel

### 6.7 Sync is all-or-nothing and blocking

**Problem:** `syncAll()` in `github-sync.ts:175-205` runs synchronously in the request handler. It syncs all installations, all repos, and all PRs in a single request. If any step fails, the entire sync returns an error.

**Impact:** 
- The request can time out for orgs with many repos/PRs
- A single repo sync failure aborts the entire sync
- The user sees a generic "Sync failed" error with no detail about what succeeded

**Upgrade needed:**
- Use Cloudflare Workflows or Queues for background sync
- Sync installations first, then queue repo syncs as separate jobs
- Return partial results with per-installation/per-repo status
- Add a sync status Durable Object or D1 table to track progress

### 6.8 Webhook secret is not verified in the route

**Problem:** The webhook route at `workers/api/src/routes/github-webhook.ts` needs to be checked for proper signature verification. The `GITHUB_WEBHOOK_SECRET` is set but the verification logic needs to be confirmed.

**Upgrade needed:**
- Verify `x-hub-signature-256` header using HMAC-SHA256 with `GITHUB_WEBHOOK_SECRET`
- Reject webhooks with invalid signatures with 401
- Log rejected webhooks for security monitoring

---

## 7. Pros and Cons of Current Approach

### 7.1 Custom PEM/ASN.1 parser (no external dependencies)

| Pros | Cons |
| --- | --- |
| Zero dependencies, small bundle size | 150+ lines of untested parsing code |
| Works in Workers runtime without `node:crypto` | No edge case handling (PKCS#1 vs PKCS#8, encrypted keys) |
| No polyfill needed | Error messages are cryptic |
| Fast startup | Hard to debug when it fails |
| | Any format deviation silently breaks everything |

### 7.2 In-memory installation token cache

| Pros | Cons |
| --- | --- |
| Simple implementation | Per-isolate, not shared across Worker instances |
| No external storage needed | Tokens re-fetched per isolate |
| Fast reads | No persistence across deploys |
| | No cache invalidation on revocation |

### 7.3 Synchronous sync in request handler

| Pros | Cons |
| --- | --- |
| Simple implementation | Can time out for large orgs |
| Immediate feedback to user | Blocks the request thread |
| No queue infrastructure needed | All-or-nothing failure |
| | No retry without manual user action |
| | No scheduled/background sync |

### 7.4 Per-request GitHub API calls (no caching of app details)

| Pros | Cons |
| --- | --- |
| Always fresh data | Extra API call on every status check |
| Simple implementation | Wastes rate limit budget |
| No cache invalidation needed | Fails when key is corrupted |
| | Latency on every page load |

### 7.5 Separate OAuth App and GitHub App

| Pros | Cons |
| --- | --- |
| Clean separation of concerns | Two GitHub apps to configure |
| OAuth for sign-in, App for repo access | Two sets of secrets to manage |
| Can revoke sign-in without losing repo access | Setup is more complex for users |
| Standard OAuth flow | Callback URL must be on API worker, not web worker |

### 7.6 D1 as metadata store with R2 for artifacts

| Pros | Cons |
| --- | --- |
| D1 is fast for metadata queries | D1 has row size limits |
| R2 handles large payloads (diffs, transcripts) | Two storage systems to query |
| Good separation of structured vs blob data | No transactions across D1 and R2 |
| Cost-effective on Cloudflare | D1 write limits can throttle sync |

---

## 8. Alternative Methods (Efficient Approaches)

### Alternative 1: Use `node:crypto` for key parsing (Recommended for immediate fix)

Instead of the custom 150-line ASN.1 parser, use the `nodejs_compat` flag (already enabled) to import the key natively:

```typescript
import { createPrivateKey, createSign } from "node:crypto";

private async importPrivateKey(): Promise<CryptoKey> {
  const pem = this.env.GITHUB_APP_PRIVATE_KEY;
  if (!pem) throw new Error("GITHUB_APP_PRIVATE_KEY is not configured");

  // node:crypto handles PKCS#1, PKCS#8, encrypted keys, all line endings
  const privateKey = createPrivateKey(pem);
  return privateKey.export({ format: "jwk" }) as unknown as CryptoKey;
}
```

Or even simpler — use `createSign` directly for JWT signing:

```typescript
async getAppJwt(): Promise<string> {
  const pem = this.env.GITHUB_APP_PRIVATE_KEY;
  if (!pem) throw new Error("GITHUB_APP_PRIVATE_KEY is not configured");

  const now = Math.floor(Date.now() / 1000);
  const payload = JSON.stringify({ iat: now - 60, exp: now + 540, iss: this.env.GITHUB_APP_ID });
  const header = JSON.stringify({ alg: "RS256", typ: "JWT" });

  const signingInput = `${base64UrlEncode(header)}.${base64UrlEncode(payload)}`;
  const sign = createSign("RSA-SHA256");
  sign.update(signingInput);
  const signature = sign.sign(pem, "base64url");

  return `${signingInput}.${signature}`;
}
```

| Pros | Cons |
| --- | --- |
| Battle-tested, handles all key formats | Requires `nodejs_compat` (already enabled) |
| 5 lines instead of 150 | Slightly larger bundle (node:crypto polyfill) |
| Handles PKCS#1, PKCS#8, encrypted keys | Still need to handle paste errors |
| Better error messages | |
| No ASN.1 parsing to maintain | |

### Alternative 2: Cache app details in KV

Store app details in KV after the first successful fetch, with a 1-hour TTL:

```typescript
async getAppDetails(): Promise<GitHubAppDetails> {
  const cached = await this.env.CONFIG_KV.get("github:app-details", "json");
  if (cached) return cached;

  const response = await this.fetchAsApp("/app");
  if (!response.ok) throw new Error(`GitHub App lookup failed (${response.status})`);

  const body = await response.json();
  const details = { id: body.id, slug: body.slug, name: body.name, htmlUrl: body.html_url, ownerId: body.owner?.id };

  await this.env.CONFIG_KV.put("github:app-details", JSON.stringify(details), { expirationTtl: 3600 });
  return details;
}
```

| Pros | Cons |
| --- | --- |
| Survives private key corruption | Data can be stale (1 hour) |
| Reduces GitHub API calls | KV is eventually consistent |
| Fast response on /status | Need to invalidate on app config change |
| Graceful degradation | |

### Alternative 3: Background sync via Cloudflare Workflows

Move sync logic to a Cloudflare Workflow that runs independently of the request:

```typescript
export class GitHubSyncWorkflow {
  async run(event: { orgId: string; type: "full" | "installations" | "repos" | "prs" }) {
    // Sync installations
    // Queue repo syncs as separate steps
    // Queue PR syncs as separate steps
    // Update sync status in D1
  }
}
```

| Pros | Cons |
| --- | --- |
| No request timeout | More infrastructure to manage |
| Partial failure recovery | Harder to debug |
| Can run on schedule (cron) | Need workflow status UI |
| Scales to large orgs | |
| Non-blocking for user | |

### Alternative 4: Use GitHub App webhook events instead of polling/sync

Instead of syncing on demand, rely entirely on webhooks to keep D1 up to date:

| Pros | Cons |
| --- | --- |
| Real-time updates | Requires reliable webhook delivery |
| No API rate limit usage | Need to handle missed/replayed events |
| No sync button needed | Still need initial sync on install |
| Less API calls | Webhook processor must be robust |

### Alternative 5: Store app slug as a required wrangler.jsonc var

Instead of relying on the API call or an optional secret, store the slug as a non-secret var in `wrangler.jsonc`:

```jsonc
{
  "vars": {
    "ENVIRONMENT": "production",
    "PUBLIC_APP_URL": "https://fusion-harness.asthrix.workers.dev",
    "GITHUB_APP_SLUG": "fusion-pr-review"
  }
}
```

| Pros | Cons |
| --- | --- |
| Always available, no API call needed | Slug is not secret, so this is safe |
| Survives key corruption | Must update on app rename |
| No secret management needed | |
| Instant /status response | |

### Alternative 6: Diagnostic endpoint with structured health report

```typescript
.get("/health", async (c) => {
  const report = {
    keyConfigured: Boolean(c.env.GITHUB_APP_PRIVATE_KEY),
    keyParseable: false,
    jwtGeneratable: false,
    appReachable: false,
    installationsCount: 0,
    error: null as string | null,
  };

  try {
    const auth = new GitHubAppAuth(c.env);
    report.keyParseable = true;

    const jwt = await auth.getAppJwt();
    report.jwtGeneratable = true;

    const details = await auth.getAppDetails();
    report.appReachable = true;
    report.appSlug = details.slug;

    const installations = await auth.fetchAsApp("/app/installations?per_page=1");
    report.installationsCount = installations.ok ? (await installations.json()).length : 0;
  } catch (error) {
    report.error = error instanceof Error ? error.message : String(error);
  }

  return c.json(report);
})
```

| Pros | Cons |
| --- | --- |
| Pinpoints exact failure point | Extra API calls on health check |
| User-friendly diagnostics | Should be rate-limited |
| Can power a fix-this UI | |
| Separates config from runtime issues | |

---

## 9. Recommended Fix Plan

### Phase 1: Immediate fix (unblock production)

**Step 1:** Re-set the private key correctly using pipe (not interactive paste):

```bash
cd workers/api
cat /path/to/your-app-private-key.pem | npx wrangler secret put GITHUB_APP_PRIVATE_KEY
```

**Step 2:** Set the app slug as a fallback var in `wrangler.jsonc`:

```jsonc
{
  "vars": {
    "ENVIRONMENT": "production",
    "PUBLIC_APP_URL": "https://fusion-harness.asthrix.workers.dev",
    "GITHUB_APP_SLUG": "<your-app-slug>"
  }
}
```

**Step 3:** Redeploy:

```bash
npm run api:deploy
```

**Step 4:** Verify:

```bash
curl https://fusion-api.asthrix.workers.dev/api/github/status
```

Expected response:

```json
{
  "configured": true,
  "appId": "4106706",
  "appSlug": "<your-app-slug>",
  "appName": "Fusion PR Review",
  "htmlUrl": "https://github.com/apps/<your-app-slug>"
}
```

**Step 5:** Sync installations and repos:

```bash
# Through the UI: /settings/github → click "Sync"
# Or through the API:
curl -X POST https://fusion-api.asthrix.workers.dev/api/github/sync \
  -H "Cookie: fh_session=<your-session>"
```

### Phase 2: Hardening (prevent recurrence)

1. **Replace custom ASN.1 parser with `node:crypto`** — removes 150 lines of fragile parsing code, handles all key formats, gives better error messages.

2. **Add `GITHUB_APP_SLUG` to `wrangler.jsonc` vars** — provides a non-secret fallback that always works.

3. **Cache app details in KV** — survive key corruption with a 1-hour TTL cache.

4. **Add `/api/github/health` diagnostic endpoint** — structured health report that pinpoints failures.

5. **Update `Docs/GITHUB_APP_SETUP.md`** — document the pipe method for setting the private key and the `GITHUB_APP_SLUG` var.

6. **Add error mapping in the frontend** — show user-friendly messages with fix instructions instead of raw ASN.1 errors.

### Phase 3: Architecture improvements (longer term)

1. **Move sync to Cloudflare Workflows** — background, resumable, partial-failure-tolerant.
2. **Move installation token cache to KV** — share across isolates, reduce API calls.
3. **Add retry with exponential backoff** — handle transient GitHub API failures.
4. **Add webhook signature verification** — security hardening.
5. **Add scheduled sync** — cron trigger every 5 minutes for active orgs.

---

## 10. Verification Checklist

After applying the fix:

- [ ] `curl https://fusion-api.asthrix.workers.dev/api/github/status` returns `appSlug` non-empty and no `error` field
- [ ] `/settings/github` page shows the correct app name, slug, and "View on GitHub" link
- [ ] `/settings/github` page shows the "Install on GitHub" button with correct URL
- [ ] Clicking "Sync" on `/settings/github` populates the "Installed Accounts" table
- [ ] Clicking "Sync" on `/settings/github` populates the "Repositories" table
- [ ] `/pr-reviews` page shows PRs after sync
- [ ] `/pr-reviews/:prId` page loads PR detail with diff viewer
- [ ] "Start Review" on a PR creates a review run without auth errors
- [ ] "Publish" on a PR with draft comments posts the review to GitHub
- [ ] Webhook delivery from GitHub is accepted (check Worker logs with `npx wrangler tail fusion-api`)

---

## Appendix: Key File References

| File | Lines | Purpose |
| --- | --- | --- |
| `workers/api/src/services/github-app.ts:97-116` | `getAppDetails()` | Fetches app slug/name from GitHub API |
| `workers/api/src/services/github-app.ts:118-132` | `importPrivateKey()` | Parses PEM key — failure point |
| `workers/api/src/services/github-app.ts:179-331` | PEM/ASN.1 parser | Custom parser — replace with `node:crypto` |
| `workers/api/src/routes/github.ts:24-50` | `/status` endpoint | Returns app details or fallback |
| `workers/api/src/services/github-sync.ts:175-205` | `syncAll()` | Syncs installations, repos, PRs |
| `workers/api/src/env.ts:15-18` | Env type | `GITHUB_APP_SLUG` is optional |
| `apps/web/src/app/settings/github/page.tsx:46-49` | Install URL | Built from `appSlug` — empty if API fails |
| `apps/web/src/app/settings/github/page.tsx:82` | App name display | Falls back to "Fusion GitHub App" |
| `apps/web/src/app/settings/github/page.tsx:92` | App slug display | Shows "Not loaded" when empty |
| `workers/api/wrangler.jsonc:10-13` | Worker vars | `GITHUB_APP_SLUG` should be added here |
| `workers/api/.dev.vars:46-74` | Local secrets | Has correct key for app ID 4106706 |
| `Docs/GITHUB_APP_SETUP.md:59-71` | Setup guide | Does not mention `GITHUB_APP_SLUG` or pipe method |