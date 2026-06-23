# Contributing to Fusion Harness

Thank you for your interest in contributing to Fusion Harness. This document covers the development workflow, coding standards, and pull request process.

## Development Setup

### Prerequisites

- Node.js 22+
- npm 11+
- Go 1.23+
- Cloudflare account (for API and web deployment)

### Install and run

```bash
git clone https://github.com/asthrix/fusion-harness.git
cd fusion-harness
npm install
npm run dev
```

### Verify your changes

Before submitting a pull request, run all checks:

```bash
npm run typecheck
npm run lint
npm run test
```

For Go runner changes:

```bash
cd apps/runner-go
gofmt -w .
go test ./...
```

## Architecture

Fusion Harness is split into two planes:

- **Cloudflare control plane**: Next.js web app, Worker API, D1 metadata, Durable Objects for live run/session coordination, KV for config cache, R2 for artifacts, Workflows for durable jobs, AI Gateway for model routing, OpenAI-compatible API, and remote MCP.
- **Go local execution plane**: native runner, OpenCode adapter, Codex adapter, host executor, optional Docker executor, workspace permissions, artifact upload, audit events, and patch generation.

Cloud decides and coordinates. The runner detects and executes. See `Docs/FH_IMPLEMENTATION_GUIDE.md` and `Docs/FH_PRODUCT_PLAN.md` for the full architecture.

## Coding Standards

### General

- Keep each module focused on one responsibility.
- Prefer small pure functions and explicit interfaces over hidden coupling.
- Avoid duplicated business rules; centralize shared policy, schema, and formatting logic.
- Use dependency inversion for adapters, executors, model selection, artifact stores, and auth boundaries.
- Keep side effects at the edges: API handlers, runner command execution, storage, network, and filesystem.
- Prefer typed data contracts over loosely shaped objects.
- Validate untrusted input at boundaries before it reaches core logic.
- Do not add comments unless the code is genuinely non-obvious.

### Next.js and React

- Prefer Server Components by default. Add `"use client"` only for state, effects, browser APIs, or event handlers.
- Keep client component props small and serializable.
- Start independent async work early and await late. Use `Promise.all` for independent I/O.
- Avoid request waterfalls in routes, Server Components, and API calls.
- Use `React.cache()` or framework caching for per-request deduplication when server reads repeat.
- Keep heavy interactive components behind dynamic imports when they are not needed at initial load.
- Do not define React components inside other components.
- Derive state during render when possible; do not mirror derived values in effects.
- Use functional state updates for callbacks that depend on previous state.
- Use `startTransition` or deferred values for non-urgent expensive UI updates.

### shadcn and Tailwind

- Use existing shadcn components before custom markup.
- Use the aliases from `components.json`; do not hardcode a different import style.
- Use `cn()` from `@/lib/utils` for conditional classes.
- Use semantic tokens such as `bg-background`, `text-foreground`, `text-muted-foreground`, `border-border`, and `bg-primary`.
- Use Tailwind `gap-*` for spacing, not `space-x-*` or `space-y-*`.
- Use `size-*` when width and height are equal.
- Use `truncate` instead of manually combining overflow, ellipsis, and whitespace classes.
- Do not add manual dark-mode color overrides when semantic tokens can express the state.
- Buttons should use the project `Button` component and existing variants.
- Icons come from `@remixicon/react`; do not assume lucide.
- Dialogs, Sheets, and Drawers must have accessible titles.

### Cloudflare and API

- Keep Cloudflare as the control plane. Do not implement host tool detection or host command execution in Workers.
- Use Durable Objects for live run/session state, WebSocket fanout, active approvals, and runner coordination.
- Use D1 only for relational metadata and indexes.
- Store large outputs, transcripts, logs, patches, and generated files in R2 with object keys referenced from D1.
- Use KV only for read-heavy non-critical config. Never store critical run state or approval state in KV.
- Keep OpenAI-compatible endpoints under `/v1/models` and `/v1/chat/completions`.
- Keep native product APIs under `/api/...`.
- Stream events with stable event names from the documented event schema.
- Every command, file edit, approval, artifact upload, blocked action, and runner state transition must be auditable.

### Go Runner

- Use clear package boundaries under `cmd/` and `internal/`.
- Keep adapters behind an interface with `Detect`, `ListModels`, `HealthCheck`, and `Run`.
- Keep executors behind an interface with `Available` and `Run`.
- Use `context.Context` for cancellation and timeouts on every external operation.
- Use `os/exec` with explicit command paths and argument arrays; do not build shell strings for normal execution.
- Validate workspace paths before running commands or writing files.
- Sanitize environment variables before command execution.
- Stream stdout/stderr as structured events.
- Do not read `~/.codex`, `~/.opencode`, keychains, browser cookies, SSH keys, or provider token files directly.
- Use official CLI commands for auth/model status checks.
- Run `gofmt` and `go test ./...` for Go changes.

### Security

Security is a product feature, not an afterthought.

- Default permission profile is `readonly`.
- `danger-full-access` is never a default and requires explicit owner/admin override when implemented.
- Writes must stay inside approved workspaces.
- Commands outside the allowlist require approval or must be blocked.
- Docker execution must deny privileged mode, Docker socket mounts, secret mounts, and private credential directories by default.
- Do not upload raw local provider tokens, `.env` files, SSH keys, private package tokens, or full repo snapshots unless an explicit policy allows it.
- Redact artifacts before upload and include a redaction summary.
- Prefer temporary worktrees or copied snapshots for AI file edits, then generate patches for review.

## Pull Request Process

1. Fork the repository and create a branch from `main`.
2. Write clean, focused commits using Conventional Commit style:
   - `feat(runner): add discovery command skeleton`
   - `feat(api): add fusion run creation route`
   - `fix(web): correct dashboard status pill colors`
   - `docs: add agent engineering guide`
   - `refactor(models): isolate selection scoring`
3. Keep commits small and reviewable. Do not mix unrelated refactors, formatting, dependency churn, and feature work in one commit.
4. Run all checks before pushing:
   ```bash
   npm run typecheck && npm run lint && npm run test
   ```
5. For Go changes, also run:
   ```bash
   cd apps/runner-go && gofmt -w . && go test ./...
   ```
6. Open a pull request with a clear description of what changed and why.
7. Ensure your PR does not introduce secrets, tokens, or credentials.

## Commit Style

Use concise Conventional Commit messages:

```
feat(runner): add discovery command skeleton
fix(api): correct fusion run status transition
docs: add agent engineering guide
test(security): cover workspace path escapes
refactor(models): isolate selection scoring
```

## Definition of Done

A task is complete only when:

- The implementation follows the product docs and current repo conventions.
- Code is typed, scoped, and avoids unnecessary duplication.
- Security and permission behavior is explicit where relevant.
- Tests or appropriate verification commands were run, or the gap is documented.
- User-facing behavior, changed files, and verification results are summarized.
- A clean commit exists for the completed task when code or docs were changed.

## Questions

Open an issue with the `question` label if you need help getting started.