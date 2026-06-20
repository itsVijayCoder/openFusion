# GitHub PR Review Feature Plan

**Status:** Planning draft for review  
**Date:** 2026-06-20  
**Target product:** Fusion Harness  
**Primary stack:** Next.js web app, Cloudflare Worker API, D1, Durable Objects, R2, Go local runner, Codex/OpenCode local agents

## 1. Goal

Add a GitHub PR Review Console to Fusion Harness.

The feature should let a team connect a GitHub account, organization, or repository, ingest pull request activity, track PR review status, and run the local Fusion Harness agent against assigned pull requests. The local agent should analyze the codebase and PR diff like a senior full-stack developer, create high-signal review findings, and let the user edit draft comments in a VS Code or GitHub-style diff UI before publishing anything back to GitHub.

## 2. Recommended Product Shape

Build this as a dedicated internal review workflow, not as a generic chat prompt.

Recommended page:

```text
/pr-reviews
/pr-reviews/:repoId/:pullNumber
/settings/github
```

Recommended name in the app nav:

```text
PR Reviews
```

Recommended core promise:

```text
When a PR is assigned or review-requested for a mapped Fusion user, Fusion Harness can run a local senior-engineer review and prepare editable review comments before publishing.
```

## 3. Existing Repo Fit

Current Fusion Harness pieces that should be reused:

| Area | Existing implementation | How this feature should use it |
| --- | --- | --- |
| Web app | `apps/web` Next.js App Router with product shell | Add PR Reviews nav item and pages under the existing shell |
| API | `workers/api` Hono routes | Add GitHub setup, webhook, PR sync, review run, and publish routes |
| Runner | `apps/runner-go` cloud job claim loop | Add GitHub PR review job execution path |
| Local agents | Codex and OpenCode adapters | Use them for codebase and diff review |
| D1 | `packages/db` schema and query helpers | Store GitHub installation, repo, PR, assignment, run, and draft comment metadata |
| R2 | Artifact storage | Store raw webhook payloads, diff snapshots, before/after file snapshots, transcripts, and generated review JSON |
| Durable Objects | Fusion run and runner session coordination | Add per-PR coordination for sync/review/publish state, or reuse run DO for live review trace |
| Audit | `audit_events` table | Record connect, sync, review start, comment edit, publish, and failure events |
| Permissions | runner permission profiles | Keep PR reviews read-only by default; require approval for shell/tests/write actions |

Important gap:

Current runner job kinds are `direct`, `panel`, `judge`, `final`, `command`, and `patch`. PR review needs GitHub-specific inputs, diff mapping, draft comments, and publishing state, so it should get its own workflow and probably a new job kind such as `pr_review`.

## 4. Recommended High-Level Architecture

```text
GitHub App
  -> webhook events
  -> Cloudflare Worker API
  -> D1 metadata + R2 raw payload/diff artifacts
  -> Durable Object per PR for serialized sync/review/publish state
  -> runner job queued for the selected local runner
  -> Go runner fetches PR refs in an allowlisted workspace/worktree
  -> Codex/OpenCode analyzes repo + before/after diff
  -> runner returns structured review findings
  -> web UI shows editable diff/comments
  -> user approves publish
  -> Worker publishes GitHub review comments/check run
```

Keep the existing control-plane/execution-plane split:

```text
Cloudflare decides, stores, coordinates, and publishes.
The local runner fetches code, analyzes files, runs local agents, and optionally runs tests.
```

The runner should not publish GitHub comments directly. It should produce drafts. The Cloudflare API should publish after policy checks and user approval. This gives a clean audit trail and avoids giving every runner long-lived GitHub write authority.

## 5. GitHub Integration Model

Use a GitHub App, not only a personal access token.

Reasons:

- Repository installation is explicit and auditable.
- Webhooks are first-class.
- Installation access tokens are short-lived.
- Checks API works naturally with GitHub Apps.
- Permissions can be limited per repository.

Recommended GitHub App permissions:

| Permission | Access | Purpose |
| --- | --- | --- |
| Metadata | Read | Required baseline repository metadata |
| Contents | Read | Fetch repository content and PR refs when managed clone mode is enabled |
| Pull requests | Read and write | Read PRs, requested reviewers, changed files, reviews, and publish review comments |
| Checks | Read and write | Create/update `Fusion PR Review` check run |
| Issues | Read and write | Optional general PR timeline comments, because PRs are issue-backed in GitHub |
| Members | Read | Optional org/team reviewer mapping |

Recommended webhook events:

```text
installation
installation_repositories
repository
pull_request
pull_request_review
pull_request_review_comment
check_suite
check_run
```

Important `pull_request` actions to handle:

```text
opened
reopened
synchronize
ready_for_review
converted_to_draft
assigned
unassigned
review_requested
review_request_removed
closed
edited
```

## 6. Identity and Assignment Rules

The user asked for statuses like pending, reviewed, not assigned, and assigned. I recommend making these explicit and deterministic.

Recommended PR status values:

| Status | Meaning |
| --- | --- |
| `not_assigned` | PR exists, but no mapped Fusion user is an assignee or requested reviewer |
| `assigned` | Current mapped user is an assignee or requested reviewer and no active Fusion review is running |
| `pending` | Fusion review is queued/running, or generated comments are waiting for human approval |
| `reviewed` | Fusion review was published or manually marked reviewed for the current head SHA |
| `stale` | PR has new commits after the last Fusion review |
| `failed` | Last review run failed and needs retry |
| `ignored` | User/team explicitly skipped this PR |

Mapping rules:

```text
Fusion user email/login -> GitHub login
GitHub requested reviewer -> Fusion user/team
GitHub assignee -> Fusion user/team
GitHub review submitted -> reviewed for that reviewer on that head SHA
New PR head SHA -> stale if there was a prior review
Draft PR -> do not auto-review unless repo policy enables draft review
Closed/merged PR -> archived from active queue
```

Open decision:

GitHub has both assignees and requested reviewers. For code review automation, requested reviewer is usually the better trigger. I recommend supporting both, but defaulting auto-review to `review_requested`.

## 7. Database Plan

Add a new migration under `packages/db/migrations`.

Suggested D1 tables:

```sql
CREATE TABLE github_installations (
  id TEXT PRIMARY KEY,
  org_id TEXT NOT NULL,
  installation_id INTEGER NOT NULL,
  account_login TEXT NOT NULL,
  account_type TEXT NOT NULL,
  target_type TEXT,
  permissions_json TEXT NOT NULL,
  repository_selection TEXT,
  suspended_at TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  UNIQUE (org_id, installation_id)
);

CREATE TABLE github_repositories (
  id TEXT PRIMARY KEY,
  org_id TEXT NOT NULL,
  installation_id INTEGER NOT NULL,
  github_repo_id INTEGER NOT NULL,
  owner TEXT NOT NULL,
  name TEXT NOT NULL,
  full_name TEXT NOT NULL,
  private INTEGER NOT NULL DEFAULT 0,
  default_branch TEXT,
  html_url TEXT,
  workspace_id TEXT,
  default_runner_id TEXT,
  auto_review_enabled INTEGER NOT NULL DEFAULT 0,
  auto_publish_enabled INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  UNIQUE (org_id, github_repo_id)
);

CREATE TABLE github_user_links (
  id TEXT PRIMARY KEY,
  org_id TEXT NOT NULL,
  user_id TEXT NOT NULL,
  github_login TEXT NOT NULL,
  github_user_id INTEGER,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  UNIQUE (org_id, user_id),
  UNIQUE (org_id, github_login)
);

CREATE TABLE github_pull_requests (
  id TEXT PRIMARY KEY,
  org_id TEXT NOT NULL,
  repo_id TEXT NOT NULL,
  github_pr_id INTEGER NOT NULL,
  number INTEGER NOT NULL,
  title TEXT NOT NULL,
  author_login TEXT,
  state TEXT NOT NULL,
  draft INTEGER NOT NULL DEFAULT 0,
  base_ref TEXT NOT NULL,
  base_sha TEXT NOT NULL,
  head_ref TEXT NOT NULL,
  head_sha TEXT NOT NULL,
  head_repo_full_name TEXT,
  html_url TEXT,
  status TEXT NOT NULL,
  additions INTEGER,
  deletions INTEGER,
  changed_files INTEGER,
  last_synced_at TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  closed_at TEXT,
  UNIQUE (org_id, repo_id, number)
);

CREATE TABLE github_pr_review_subjects (
  id TEXT PRIMARY KEY,
  org_id TEXT NOT NULL,
  pr_id TEXT NOT NULL,
  github_login TEXT NOT NULL,
  user_id TEXT,
  subject_type TEXT NOT NULL,
  state TEXT NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  UNIQUE (org_id, pr_id, github_login, subject_type)
);

CREATE TABLE pr_review_runs (
  id TEXT PRIMARY KEY,
  org_id TEXT NOT NULL,
  pr_id TEXT NOT NULL,
  fusion_run_id TEXT,
  runner_id TEXT,
  requested_by_user_id TEXT,
  head_sha TEXT NOT NULL,
  base_sha TEXT NOT NULL,
  status TEXT NOT NULL,
  review_mode TEXT NOT NULL,
  diff_object_key TEXT,
  findings_object_key TEXT,
  transcript_object_key TEXT,
  error TEXT,
  created_at TEXT NOT NULL,
  started_at TEXT,
  completed_at TEXT
);

CREATE TABLE pr_review_comments (
  id TEXT PRIMARY KEY,
  org_id TEXT NOT NULL,
  review_run_id TEXT NOT NULL,
  pr_id TEXT NOT NULL,
  file_path TEXT NOT NULL,
  side TEXT NOT NULL,
  start_line INTEGER,
  line INTEGER,
  severity TEXT NOT NULL,
  category TEXT NOT NULL,
  body TEXT NOT NULL,
  suggested_change TEXT,
  confidence REAL,
  status TEXT NOT NULL,
  github_comment_id INTEGER,
  edited_by_user_id TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  published_at TEXT
);

CREATE TABLE github_webhook_events (
  id TEXT PRIMARY KEY,
  org_id TEXT,
  delivery_id TEXT NOT NULL,
  event_name TEXT NOT NULL,
  action TEXT,
  installation_id INTEGER,
  repo_id TEXT,
  pr_id TEXT,
  payload_object_key TEXT,
  processed_at TEXT,
  error TEXT,
  created_at TEXT NOT NULL,
  UNIQUE (delivery_id)
);
```

Suggested indexes:

```sql
CREATE INDEX idx_github_repositories_org ON github_repositories(org_id, updated_at DESC);
CREATE INDEX idx_github_prs_repo_status ON github_pull_requests(repo_id, status, updated_at DESC);
CREATE INDEX idx_github_prs_org_status ON github_pull_requests(org_id, status, updated_at DESC);
CREATE INDEX idx_pr_review_runs_pr_head ON pr_review_runs(pr_id, head_sha, created_at DESC);
CREATE INDEX idx_pr_review_comments_run_status ON pr_review_comments(review_run_id, status);
CREATE INDEX idx_github_webhook_events_delivery ON github_webhook_events(delivery_id);
```

## 8. API Plan

Add routes under `workers/api/src/routes/github.ts` and `workers/api/src/routes/pr-reviews.ts`.

GitHub setup:

```text
GET  /api/github/installations
GET  /api/github/repositories
POST /api/github/repositories/:repoId/link-workspace
PATCH /api/github/repositories/:repoId/settings
POST /api/github/sync
POST /api/github/webhook
```

PR review:

```text
GET  /api/pr-reviews
GET  /api/pr-reviews/:prId
POST /api/pr-reviews/:prId/sync
POST /api/pr-reviews/:prId/start
GET  /api/pr-reviews/:prId/events
GET  /api/pr-reviews/:prId/diff
GET  /api/pr-reviews/:prId/comments
PATCH /api/pr-reviews/:prId/comments/:commentId
POST /api/pr-reviews/:prId/comments/:commentId/resolve
POST /api/pr-reviews/:prId/publish
POST /api/pr-reviews/:prId/mark-reviewed
POST /api/pr-reviews/:prId/ignore
```

Recommended route behavior:

- `/api/github/webhook` must validate GitHub webhook signatures before parsing.
- Store every webhook delivery ID for idempotency.
- Store raw webhook payloads in R2 for debugging and replay.
- Convert webhook events into normalized D1 state.
- Do not send GitHub installation tokens to the browser.
- Do not publish comments until the user explicitly publishes, unless repo policy enables auto-publish.

## 9. Runner Workflow

Add PR review support to `apps/runner-go`.

Recommended new job kind:

```ts
type RunnerJobKind = "direct" | "panel" | "judge" | "final" | "command" | "patch" | "pr_review";
```

Recommended job payload metadata:

```json
{
  "kind": "pr_review",
  "workspaceId": "ws_...",
  "workspacePath": "/allowed/repo/path",
  "permissionProfile": "readonly",
  "metadata": {
    "provider": "github",
    "repoFullName": "owner/repo",
    "pullNumber": 123,
    "baseRef": "main",
    "baseSha": "abc123",
    "headRef": "feature-branch",
    "headSha": "def456",
    "headRepoFullName": "owner/repo",
    "diffObjectKey": "r2://...",
    "reviewRunId": "prrev_...",
    "reviewDepth": "standard",
    "runTests": false,
    "maxComments": 20
  }
}
```

Runner steps:

1. Validate workspace path is inside configured allowed roots.
2. Verify `git` is available.
3. Verify the local repository remote matches the configured GitHub repository.
4. Fetch base and head refs safely.
5. Create an isolated temporary worktree or detached checkout for the PR head.
6. Capture:
   - `git diff --name-status base...head`
   - `git diff --unified=80 base...head`
   - changed file contents at base and head where reasonable
   - package/test metadata such as `package.json`, `go.mod`, lockfiles, CI config, and relevant framework config
7. Build a concise repo intelligence context:
   - stack and frameworks
   - app boundaries
   - likely test commands
   - security-sensitive areas
   - existing patterns around touched files
8. Ask the selected local agent to review the PR.
9. Parse the agent output into strict JSON.
10. Return structured findings and raw transcript.
11. Optionally run tests only when policy allows it.

Recommended output schema:

```json
{
  "summary": "Short senior-review summary",
  "riskLevel": "low | medium | high",
  "decision": "comment | request_changes | approve",
  "findings": [
    {
      "severity": "blocker | major | minor | nit",
      "category": "bug | security | performance | maintainability | test | ux | accessibility | docs",
      "filePath": "apps/web/src/example.tsx",
      "side": "RIGHT",
      "startLine": 12,
      "line": 18,
      "body": "Review comment written for a human developer.",
      "suggestedChange": "Optional GitHub suggestion block content",
      "confidence": 0.86,
      "evidence": "Why the agent believes this is a real issue"
    }
  ],
  "tests": [
    {
      "command": "npm run typecheck",
      "status": "not_run | passed | failed",
      "outputSummary": "Short summary"
    }
  ]
}
```

Prompt requirements for the local agent:

- Review as a senior full-stack developer.
- Prioritize correctness, security, data integrity, accessibility, performance, and missing tests.
- Avoid style-only comments unless they prevent maintainability issues.
- Comment only on changed lines when possible.
- Return JSON only.
- Do not include secrets, tokens, or full private file contents in output.
- If a finding cannot be mapped to a diff line, put it in the overall summary instead of forcing a wrong line comment.

## 10. Local Codebase Analysis Cache

The user specifically asked that when the agent starts, it should analyze the codebase.

Recommended approach:

```text
Repo analysis should be cached, but invalidated by meaningful repo changes.
```

Add a repo intelligence artifact per repository/default branch:

```text
repo_intelligence/:repoId/:baseSha.json
```

Contents:

- project type and frameworks
- package managers and build tools
- test commands
- important directories
- app boundaries
- database/migration patterns
- auth/security patterns
- frontend component and styling conventions
- known risky areas

For each PR review, combine:

```text
cached repo intelligence
+ PR metadata
+ changed file list
+ before/after file snippets
+ diff hunks
+ existing related tests
```

This avoids asking the model to rediscover the whole repository on every PR while still giving it enough local context.

## 11. Diff and Comment Mapping

This is one of the riskiest parts of the feature.

Rules:

- Use GitHub's modern line-based review comment fields: `line`, `side`, `start_line`, and `start_side`.
- Avoid deprecated diff-position fields.
- Store both the generated finding line and the parsed diff hunk it maps to.
- Validate every draft comment against the current PR diff before publishing.
- If validation fails after a new commit, mark the comment as `outdated` and require regeneration or manual remap.
- For multi-line comments, only publish when the range is valid on GitHub's diff.
- For file-level/general findings, use the overall review body or a supported file-level comment path, depending on GitHub API capability and current behavior.

Comment statuses:

```text
draft
edited
approved
rejected
published
outdated
failed
```

## 12. Publishing Strategy

Default publishing should be human-approved.

Recommended default:

```text
Generate draft comments -> user edits -> user publishes selected comments as one GitHub review.
```

Publishing options:

| Option | Behavior |
| --- | --- |
| `Comment` | Submit a neutral review with comments |
| `Request changes` | Submit a blocking review, only after explicit user selection |
| `Approve` | Submit approval only when there are no blocking findings and user chooses it |
| `Check only` | Update GitHub Checks without review comments |
| `Mark reviewed` | Mark as reviewed in Fusion only, no GitHub write |

Also create/update a GitHub Check Run:

```text
Name: Fusion PR Review
Status: queued | in_progress | completed
Conclusion: success | neutral | failure | action_required
Output summary: risk level, number of findings, link back to Fusion PR Review page
```

The check run helps make the review visible in GitHub even before comments are published.

## 13. UI Plan

### 13.1 Navigation

Add to `apps/web/src/features/shell/app-shell.tsx`:

```text
Application
- Workspaces
- PR Reviews
- Team
- API
- MCP
```

Use an existing icon from Remix Icon for now, such as a git pull request or branch icon.

### 13.2 Settings Page

Page:

```text
/settings/github
```

Sections:

- GitHub App connection status
- Install/connect button
- Installed accounts/orgs
- Repository list
- Link repository to Fusion workspace
- Default runner selection
- Auto-review policy
- Auto-publish policy
- Reviewer mapping table

Repository settings:

```text
auto_review_enabled: off by default
auto_review_trigger: review_requested | assigned | both | manual
auto_publish_enabled: off by default
default_runner_id
permission_profile: readonly by default
run_tests: off by default
max_comments: 20
ignored_paths: generated files, lockfiles, snapshots, vendored files
```

### 13.3 PR Queue Page

Page:

```text
/pr-reviews
```

Layout:

- Dense operational page under the existing shell.
- Filters across the top.
- Table for PR inventory.
- Right drawer or detail preview for selected PR.

Filters:

```text
Assigned to me
Review requested
Pending
Stale
Reviewed
Failed
Repository
Author
Draft/non-draft
```

Table columns:

```text
Repository
PR number/title
Author
Review subject
Status
Risk
Last review
Head SHA
Changed files
Runner
Actions
```

Row actions:

```text
Open
Start review
Retry
Sync
Ignore
Mark reviewed
```

### 13.4 PR Detail Page

Page:

```text
/pr-reviews/:repoId/:pullNumber
```

Recommended layout:

```text
Header:
  repo, PR number, title, status, head SHA, GitHub link, Sync, Start Review, Publish

Left column:
  file tree with comment counts and risk markers

Center:
  Monaco Diff Editor or equivalent split diff viewer
  before on left, after on right
  line decorations for draft comments

Right column:
  Review summary
  Draft comments list
  Comment editor
  Agent trace
  Test results
```

The user requested "before and after what changes happens like VS Code or GitHub editor view it can be editable."

Recommended implementation:

- Use Monaco Diff Editor for the before/after code view because it feels closest to VS Code.
- Load it client-side only with dynamic import.
- Make review comment text editable immediately.
- Make suggested-change blocks editable.
- Do not make the PR branch itself editable in MVP. Instead, allow "suggested change" edits in review comments. Direct branch edits should be a later "apply fix" workflow with separate approval.

UI states:

```text
no_diff_loaded
syncing
ready_to_review
review_running
draft_comments_ready
publishing
published
stale_after_new_push
failed
```

## 14. Review Modes

Support multiple review depth modes.

| Mode | Use |
| --- | --- |
| `quick` | Diff-only review, no tests |
| `standard` | Diff plus surrounding code context and repo intelligence |
| `deep` | Standard review plus local test/build commands if allowed |
| `security` | Security-focused review for auth, data, secrets, injection, RLS, SSRF, XSS, dependency risk |

Default:

```text
standard
```

## 15. Security and Safety Plan

Required controls:

- Validate GitHub webhook signature.
- Store webhook delivery IDs and process idempotently.
- Keep GitHub App private key and webhook secret in Cloudflare secrets.
- Do not expose installation tokens to the browser.
- Prefer local Git credentials for existing workspaces.
- If managed clone is required, use short-lived installation tokens only.
- Redact tokens from runner logs and artifacts.
- Do not include secrets, `.env`, private keys, or full credentials in prompts.
- Do not auto-run shell commands for fork PRs.
- Run tests/builds in Docker where possible.
- Keep default permission profile `readonly`.
- Require explicit approval for publishing comments.
- Require stronger approval for `Request changes`.
- Audit every publish operation.
- Avoid uploading full repo snapshots to R2 unless policy explicitly allows it.

Fork PR handling:

```text
Default to metadata/diff-only analysis for fork PRs.
Do not pass repository write tokens to test commands.
Do not run untrusted scripts with secrets available.
Do not auto-publish request-changes reviews for fork PRs until a human approves.
```

## 16. Failure and Race Handling

Cases to handle:

| Case | Expected behavior |
| --- | --- |
| Duplicate webhook delivery | Ignore after first successful processing |
| New commits during review | Finish current run, mark drafts stale if head SHA changed |
| PR closed during review | Cancel publish, keep run artifact |
| Comment line no longer valid | Mark draft `outdated` |
| Runner offline | Keep PR `assigned`, show "runner unavailable" |
| Git fetch fails | Mark review run `failed`, show actionable error |
| GitHub rate limit | Back off, keep sync retry state |
| GitHub App uninstalled | Disable repo sync and hide publish actions |
| User not mapped to GitHub | Show PR but mark assignment unknown |

## 17. Implementation Phases

### Phase 0 - Product decisions

- Confirm GitHub App vs OAuth-only.
- Confirm whether auto-review triggers on requested reviewer, assignee, or both.
- Confirm whether publishing is always human-approved for MVP.
- Confirm private repo and fork PR scope.
- Confirm default local agent selection.

### Phase 1 - GitHub connection and PR inventory

Deliverables:

- GitHub App setup docs and config.
- `/settings/github` connection page.
- Webhook endpoint with signature verification.
- D1 tables for installations, repos, user links, PRs, webhook deliveries.
- Manual sync route.
- `/pr-reviews` queue with real PR statuses.

Acceptance:

- Install GitHub App on a test repo.
- Open a PR.
- Fusion shows the PR with correct assigned/not-assigned/review-requested state.
- New commit updates status to stale or pending.

### Phase 2 - Diff viewer and detail page

Deliverables:

- PR detail route.
- Changed file list.
- Before/after file loading.
- Split diff viewer.
- Basic comment draft UI.
- R2 storage for diff snapshots.

Acceptance:

- User can open a PR and inspect changed files.
- UI shows before/after code.
- Comment text can be edited locally.

### Phase 3 - Local runner PR review job

Deliverables:

- New shared `pr_review` job type.
- Runner PR review execution path.
- Git fetch/worktree preparation.
- Repo intelligence context builder.
- Senior-review prompt and JSON schema parser.
- R2 artifacts for transcript/findings.
- D1 review run/comment records.
- Live events for review progress.

Acceptance:

- User clicks "Start Review".
- Local runner analyzes PR.
- UI receives draft comments with file/line mapping.

### Phase 4 - Human approval and GitHub publish

Deliverables:

- Edit/approve/reject draft comments.
- Publish selected comments as a GitHub review.
- Optional check run creation/update.
- Mark reviewed/ignored actions.
- Audit events.

Acceptance:

- User publishes comments from Fusion.
- GitHub PR shows review comments.
- Fusion marks the review as reviewed for the current head SHA.

### Phase 5 - Hardening

Deliverables:

- Idempotency tests.
- Webhook replay tests.
- Diff mapping tests.
- Fork PR safety tests.
- Token redaction tests.
- Rate-limit retry handling.
- Admin/repo policy controls.

Acceptance:

- Duplicate webhooks do not duplicate comments.
- New commits invalidate stale drafts.
- Fork PRs cannot access secrets through tests.

### Phase 6 - Advanced workflows

Potential later additions:

- Auto-review on every assigned/review-requested PR.
- Auto-publish low-risk comments.
- Apply-fix workflow that creates commits or suggested patches.
- Multi-agent review panel: architect, security, test planner, maintainer.
- Team reviewer load balancing.
- PR review analytics dashboard.
- IDE extension integration.

## 18. Suggested Model Strategy

MVP:

```text
One strong local agent, defaulting to Codex if available, otherwise OpenCode.
```

Next:

```text
Fusion mode with 2-4 reviewers:
- senior full-stack reviewer
- security reviewer
- test reviewer
- maintainer/style reviewer
judge/final step turns those into a deduplicated comment set
```

The final comment set should be conservative. A PR review tool that leaves too many weak comments will lose trust quickly.

Recommended comment budget:

```text
quick: max 8 comments
standard: max 20 comments
deep: max 30 comments
security: max 25 comments
```

## 19. Testing Plan

Unit tests:

- GitHub webhook signature validation.
- Webhook idempotency.
- PR status derivation.
- GitHub user mapping.
- Diff parser line mapping.
- Review finding schema validation.
- Comment stale detection.

Worker/API tests:

- Create/update installation.
- Upsert repository.
- Upsert PR from webhook.
- Start review route creates runner job.
- Publish route refuses invalid/outdated comments.

Runner tests:

- Workspace root validation.
- Git remote validation.
- Base/head fetch command generation.
- Worktree cleanup.
- JSON parser rejects non-JSON agent output.
- Token redaction from logs.

UI tests:

- PR queue filters.
- Detail page loads file tree and diff.
- Draft comment edit flow.
- Publish selected comments flow.
- Stale head SHA warning.

Manual test scenario:

1. Install GitHub App on a sandbox repo.
2. Link sandbox repo to a Fusion workspace.
3. Start local runner.
4. Open PR with one real bug and one harmless change.
5. Request review from mapped GitHub user.
6. Confirm Fusion status becomes `assigned`.
7. Start review.
8. Confirm draft comments are generated.
9. Edit one comment and reject one weak comment.
10. Publish.
11. Confirm GitHub shows only approved comments.
12. Push another commit.
13. Confirm Fusion marks old review as `stale`.

## 20. Risks and Mitigations

| Risk | Mitigation |
| --- | --- |
| Bad line mapping creates comments on wrong lines | Validate every comment against current diff before publishing |
| Too many low-quality comments | Use severity/confidence thresholds and max comment budget |
| New commits invalidate review | Store head SHA on every run and mark stale on mismatch |
| Private repo secrets leak into prompts/artifacts | Redaction, ignored paths, no full snapshot upload by default |
| Runner executes untrusted fork code | Read-only by default, Docker for tests, no secrets for forks |
| GitHub API rate limits | Store sync state, use webhook-first updates, retry with backoff |
| User expects comments from their personal account | Decide upfront between GitHub App identity and user OAuth identity |
| Monaco editor bundle size | Client-only load on PR detail page and keep queue page lightweight |
| Duplicate webhook events duplicate reviews/comments | Delivery ID idempotency and publish idempotency keys |

## 21. My Recommended MVP Scope

Build this first:

1. GitHub App connection.
2. Repo/workspace linking.
3. PR queue with `not_assigned`, `assigned`, `pending`, `reviewed`, `stale`, `failed`.
4. Manual "Start Review" button.
5. Local runner PR review job.
6. Monaco split diff viewer.
7. Editable draft comments.
8. Human-approved publish to GitHub.
9. GitHub Check Run status.
10. Full audit trail.

Do not build in MVP:

1. Direct branch editing or auto-commits.
2. Auto-publish by default.
3. Complex reviewer load balancing.
4. Full repo snapshot upload.
5. Cloud-only code execution.

## 22. Questions To Confirm Before Implementation

1. Should GitHub review comments be published as the Fusion GitHub App, or should users connect OAuth so comments can be attributed to their personal GitHub account?
2. Should auto-review trigger on GitHub `assignee`, `requested reviewer`, or both?
3. Should MVP always require human approval before publishing comments?
4. Are private repositories in scope for MVP?
5. Are fork pull requests in scope for MVP?
6. Which local agent should be the default reviewer: Codex, OpenCode, or Fusion multi-agent?
7. Should the agent be allowed to run tests/build commands during review, or only inspect code and diffs?
8. Should the editable view only edit draft comments and suggested changes, or should it also allow committing fixes back to the PR branch later?
9. Do you want statuses exactly as `pending`, `reviewed`, `not_assigned`, `assigned`, or should we include `stale`, `failed`, and `ignored` too?
10. Should this support GitHub Enterprise Server later, or only github.com for MVP?

## 23. Source References

- GitHub App installation authentication: https://docs.github.com/en/apps/creating-github-apps/authenticating-with-a-github-app/authenticating-as-a-github-app-installation
- GitHub App webhooks: https://docs.github.com/en/apps/creating-github-apps/registering-a-github-app/using-webhooks-with-github-apps
- GitHub webhook events and payloads: https://docs.github.com/en/webhooks/webhook-events-and-payloads
- GitHub pull request reviews API: https://docs.github.com/rest/pulls/reviews
- GitHub pull request review comments API: https://docs.github.com/rest/pulls/comments
- GitHub review requests API: https://docs.github.com/en/rest/pulls/review-requests
- GitHub Checks API: https://docs.github.com/rest/checks/runs
- GitHub pull request files API: https://docs.github.com/en/rest/pulls/pulls
- Cloudflare Durable Objects guidance: https://developers.cloudflare.com/durable-objects/best-practices/rules-of-durable-objects/
- Cloudflare D1: https://developers.cloudflare.com/d1/
- Cloudflare R2: https://developers.cloudflare.com/r2/
- Cloudflare Workflows: https://developers.cloudflare.com/workflows/
