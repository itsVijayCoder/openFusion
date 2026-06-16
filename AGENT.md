# Fusion Harness Agent Guide

This file defines how coding agents should work in this repository. Treat the two planning docs as the product source of truth:

- `Docs/fusion-harness-product-plan.md`
- `Docs/fusion-harness-implementation-guide.md`

## Product Direction

Fusion Harness is an internal multi-model coding and reasoning platform. The core architecture is split into two planes:

- Cloudflare control plane: Next.js web app, Worker API, D1 metadata, Durable Objects for live run/session coordination, KV for non-critical config cache, R2 for artifacts, Workflows for durable jobs, AI Gateway for team API-key model routing, Access/Tunnel, OpenAI-compatible API, and remote MCP.
- Go local execution plane: native runner, OpenCode adapter, Codex adapter, host executor, optional Docker executor, workspace permissions, artifact upload, audit events, and patch generation.

Cloud decides and coordinates. The runner detects and executes. R2 stores large outputs. D1 indexes metadata. Durable Objects stream live run state.

## Current Repository Shape

The repository is an npm workspace monorepo that follows the implementation guide.

Current stack details:

- Next.js `16.2.6`
- React `19.1.7`
- TypeScript strict mode
- Web app under `apps/web`
- Tailwind CSS v4 through `apps/web/src/app/globals.css`
- shadcn configured by `apps/web/components.json` with `radix-rhea`, RSC enabled, `@/` aliases, and `remixicon`
- Cloudflare/OpenNext via `@opennextjs/cloudflare`, `apps/web/wrangler.jsonc`, and `apps/web/open-next.config.ts`
- Cloudflare Worker API under `workers/api`
- Remote MCP Worker scaffold under `workers/mcp`
- Shared TypeScript packages under `packages/*`
- Go runner under `apps/runner-go`
- Current package manager is npm because `package-lock.json` is present. Use `npm run ...` unless a dedicated migration changes this.

## Engineering Standards

Write clean, maintainable code that follows DRY and SOLID principles:

- Keep each module focused on one responsibility.
- Prefer small pure functions and explicit interfaces over hidden coupling.
- Avoid duplicated business rules; centralize shared policy, schema, and formatting logic.
- Use dependency inversion for adapters, executors, model selection, artifact stores, and auth boundaries.
- Keep side effects at the edges: API handlers, runner command execution, storage, network, and filesystem.
- Prefer typed data contracts over loosely shaped objects.
- Validate untrusted input at boundaries before it reaches core logic.
- Name things by product concepts from the docs: runner, adapter, model, fusion run, panel output, judge, final writer, artifact, permission profile, audit event.

## Next.js and React Rules

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
- Do not claim a command ran or a file changed unless the tool output or diff proves it.

## shadcn and Tailwind Rules

- Use existing shadcn components before custom markup.
- Use the aliases from `components.json`; do not hardcode a different import style.
- Use `cn()` from `@/lib/utils` for conditional classes.
- Use semantic tokens such as `bg-background`, `text-foreground`, `text-muted-foreground`, `border-border`, and `bg-primary`.
- Use Tailwind `gap-*` for spacing, not `space-x-*` or `space-y-*`.
- Use `size-*` when width and height are equal.
- Use `truncate` instead of manually combining overflow, ellipsis, and whitespace classes.
- Do not add manual dark-mode color overrides when semantic tokens can express the state.
- Buttons should use the project `Button` component and existing variants.
- Icons come from the configured icon library, currently `@remixicon/react`; do not assume lucide.
- Dialogs, Sheets, and Drawers must have accessible titles.
- Forms should use the project/shadcn form primitives when added, with `aria-invalid` and data-state attributes for validation.

## Cloudflare and API Rules

- Keep Cloudflare as the control plane. Do not implement host tool detection or host command execution in Workers.
- Use Durable Objects for live run/session state, WebSocket fanout, active approvals, and runner coordination.
- Use D1 only for relational metadata and indexes.
- Store large outputs, transcripts, logs, patches, and generated files in R2 with object keys referenced from D1.
- Use KV only for read-heavy non-critical config. Never store critical run state or approval state in KV.
- Keep OpenAI-compatible endpoints under `/v1/models` and `/v1/chat/completions`.
- Keep native product APIs under `/api/...` as described in the implementation guide.
- Stream events with stable event names from the documented event schema.
- Every command, file edit, approval, artifact upload, blocked action, and runner state transition must be auditable.

## Go Runner Rules

When adding the runner code, keep it as a native Go execution plane:

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

## Security Rules

Security is a product feature, not an afterthought.

- Default permission profile is `readonly`.
- `danger-full-access` is never a default and requires explicit owner/admin override when implemented.
- Writes must stay inside approved workspaces.
- Commands outside the allowlist require approval or must be blocked.
- Docker execution must deny privileged mode, Docker socket mounts, secret mounts, and private credential directories by default.
- Do not upload raw local provider tokens, `.env` files, SSH keys, private package tokens, or full repo snapshots unless an explicit policy allows it.
- Redact artifacts before upload and include a redaction summary.
- Prefer temporary worktrees or copied snapshots for AI file edits, then generate patches for review.

## Testing and Verification

Match verification to the change:

- Frontend changes: run `npm run lint` and `npm run build` when practical.
- Type/schema changes: run TypeScript checks through the available project scripts or `npx tsc --noEmit`.
- Cloudflare/OpenNext changes: run `npm run build`; use preview/deploy commands only when requested or required.
- Go runner changes: run `gofmt` and `go test ./...` in the runner module.
- Adapter changes: add contract tests for detect, model listing, run, timeout, JSON parsing, and error normalization.
- Security-sensitive changes: add tests for blocked paths, blocked commands, secret redaction, token revocation, and unauthenticated runner denial.

If a verification command cannot be run, document the reason in the final response.

## Git and Commit Policy

Keep commits clean, small, and reviewable.

- Commit each task, phase, feature, or tightly related set of code changes separately.
- Do not mix unrelated refactors, formatting, dependency churn, and feature work in one commit.
- Stage only files that belong to the current task.
- Before committing, review `git diff --staged`.
- Use concise Conventional Commit style messages, for example:
  - `docs: add agent engineering guide`
  - `feat(runner): add discovery command skeleton`
  - `feat(api): add fusion run creation route`
  - `test(security): cover workspace path escapes`
  - `refactor(models): isolate selection scoring`
- Do not rewrite or revert user changes unless explicitly asked.
- If the working tree contains unrelated changes, leave them untouched and commit only the current task files.

## Definition of Done

A task is complete only when:

- The implementation follows the product docs and current repo conventions.
- Code is typed, scoped, and avoids unnecessary duplication.
- Security and permission behavior is explicit where relevant.
- Tests or appropriate verification commands were run, or the gap is documented.
- User-facing behavior, changed files, and verification results are summarized.
- A clean commit exists for the completed task when code or docs were changed.
