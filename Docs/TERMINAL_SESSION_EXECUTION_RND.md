# Terminal-Session Execution Model — R&D and Redesign

> **Status:** Design / R&D
> **Date:** 2026-06-26
> **Scope:** Change the model-running methodology from headless subprocess capture to real, per-model terminal sessions (like running `opencode` / `codex` / `pi` directly in a terminal).
> **Author:** Engineering analysis

---

## Table of Contents

1. [Executive Summary](#1-executive-summary)
2. [The Core Feature openFusion Implements](#2-the-core-feature-openfusion-implements)
3. [How We Do It Today (Precise)](#3-how-we-do-it-today-precise)
4. [The Mistakes We Are Making (Out-of-the-Box Analysis)](#4-the-mistakes-we-are-making-out-of-the-box-analysis)
5. [The Proposed Methodology: Terminal-Session Execution](#5-the-proposed-methodology-terminal-session-execution)
6. [How We Do It Precisely (Target State)](#6-how-we-do-it-precisely-target-state)
7. [Precise Changes Required (File by File)](#7-precise-changes-required-file-by-file)
8. [Architecture: Current vs Target](#8-architecture-current-vs-target)
9. [Output Extraction: How the Judge Gets Its Input](#9-output-extraction-how-the-judge-gets-its-input)
10. [Session Lifecycle and Concurrency](#10-session-lifecycle-and-concurrency)
11. [Build Order](#11-build-order)
12. [Risks and Mitigations](#12-risks-and-mitigations)
13. [Verification Checklist](#13-verification-checklist)

---

## 1. Executive Summary

Today openFusion runs each model as a **headless captured subprocess**: the Go runner spawns `opencode-cli run --format json --dangerously-skip-permissions -` (prompt on stdin) or `codex exec --json --skip-git-repo-check --sandbox ...`, captures stdout/stderr into buffers, and emits the text as `panel.terminal.delta` events. The "terminal" the user sees in the UI is **not a real terminal** — it is captured stdout text rendered in a modal. There is no PTY, no interactivity, no ANSI fidelity, and no way for the user to interact with the running agent.

This is the wrong model. These CLIs (`opencode`, `codex`, `pi`, `claude`, `gemini`, ...) are **interactive TUI applications** designed to run in a real terminal with a PTY. Forcing them into headless `--format json` + stdin-pipe mode is a degraded mode that loses the TUI, interactive approvals, ANSI rendering, and the actual "agent working" experience. It also forces us to write **custom `Run()` Go code per adapter** (CLI-specific flags, parsers, permission flags), which is why only **2 of 23** catalogued agents can actually execute today.

**The redesign:** run each model in its own **real, PTY-backed terminal session** — one session per model, exactly like a user opening a terminal and running `opencode` or `codex` or `pi`. The runner allocates a PTY per model, launches the CLI in its native interactive mode, streams the live PTY bytes to `xterm.js` in the browser over WebSocket, and extracts the model's final answer for the judge step. Sessions are isolated, parallelizable, and re-attachable. Any detected CLI can run without custom adapter code, because the terminal is the contract, not a JSON schema.

This document specifies the core feature, the current methodology, the mistakes, and the precise file-by-file changes required.

---

## 2. The Core Feature openFusion Implements

openFusion's core feature is the **Panel → Judge → Final-Writer fusion pipeline**:

1. **Panel** — multiple AI coding agents (OpenCode, Codex, Pi, Claude, Gemini, ...) run the **same prompt** independently and in parallel.
2. **Judge** — a judge model evaluates, compares, and ranks the panel outputs (consensus, contradictions, missing coverage, unique insights, blind spots, risk).
3. **Final Writer** — a final model synthesizes the best answer from the judge's analysis.

The key product differentiation is **local-runner-awareness**: openFusion uses the developer's **own authenticated CLI sessions/subscriptions** (the CLIs they already have installed and logged in), not team-managed API keys. The Cloudflare control plane decides and coordinates; the Go local runner detects installed CLIs and executes them on the host.

The fusion pipeline is defined in `apps/runner-go/internal/fusion/runner.go:84` (`Execute`). The panel runs concurrently with per-adapter serialization (`runner.go:143-170`), then the judge/synthesis runs (`runner.go:206`), then an optional verification pass (`runner.go:228-255`).

The value the user sees is: **one prompt → multiple expert agents work independently → a judged, synthesized, high-quality answer**, with a full trace of what each agent did.

---

## 3. How We Do It Today (Precise)

### 3.1 The execution call chain

```
fusion.Execute (runner.go:84)
  └─ runSelectedModel (runner.go:272)
       └─ adapter.Run (opencode.go:84 / codex.go:87)
            └─ host.RunStreaming (host.go:96)
                 └─ exec.CommandContext → child process
                      stdin  = prompt
                      stdout = captured line-by-line → panel.terminal.delta
                      stderr = captured line-by-line → panel.terminal.delta
```

### 3.2 OpenCode adapter — headless JSON mode

`apps/runner-go/internal/adapters/opencode/opencode.go:84-148`

```go
args := []string{"run", "--format", "json", "--dangerously-skip-permissions"}
if input.Model != "" && input.Model != "default" {
    args = append(args, "--model", input.Model)
}
args = append(args, "-")   // read prompt from stdin

result, err := host.RunStreaming(ctx, host.CommandSpec{
    Name:   tool.Path,
    Args:   args,
    Stdin:  input.Prompt,          // prompt piped via stdin
    ...
}, func(chunk host.OutputChunk) {
    emit(adapters.RunEvent{Type: "panel.terminal.delta", ...})  // captured stdout
})
```

Key facts:
- Runs `opencode run --format json --dangerously-skip-permissions --model X -`.
- `--format json` = NDJSON event stream (non-interactive).
- `--dangerously-skip-permissions` = **hardcoded** to suppress interactive approval prompts (because there is no human at a terminal to approve).
- Prompt arrives on **stdin** (`-`).
- stdout/stderr are captured into `bytes.Buffer` AND streamed line-by-line.
- `extractThinking()` (`opencode.go:238`) parses NDJSON lines for `type: "reasoning"` to feed `panel.thinking.delta`.

### 3.3 Codex adapter — headless JSON mode

`apps/runner-go/internal/adapters/codex/codex.go:87-150`

```go
args := []string{"exec", "--json", "--skip-git-repo-check", "--sandbox", sandboxForProfile(...)}
if input.Model != "" && input.Model != "default" {
    args = append(args, "--model", input.Model)
}
// prompt on stdin
```

- Runs `codex exec --json --skip-git-repo-check --sandbox workspace-write --model Y`.
- `--json` = NDJSON event stream (non-interactive).
- Sandbox mapped from permission profile (`codex.go:152`: `workspace_write`/`trusted_internal` → `workspace-write`, else `read-only`).
- Same stdin-pipe + capture pattern.

### 3.4 The host executor — pipe capture, no PTY

`apps/runner-go/internal/executors/host/host.go:96-179` (`RunStreaming`)

- `exec.CommandContext(ctx, path, spec.Args...)` — **no PTY**. The child gets pipes, not a TTY.
- `cmd.Stdin = strings.NewReader(spec.Stdin)` — prompt piped in.
- `cmd.StdoutPipe()` / `cmd.StderrPipe()` — output read line-by-line via `bufio.Reader`.
- Each line → `onChunk(OutputChunk{Stream, Text})` → adapter emits `panel.terminal.delta`.
- Full buffer also collected into `Result.Stdout` / `Result.Stderr` for the final `OutputText`.
- `validateWorkingDir` (`host.go:181`) enforces workspace allowlist.

### 3.5 The "terminal" in the UI is captured text, not a terminal

`Docs/LIVE_TERMINAL_DESIGN.md` documents this honestly:
- Option A (shipped): line-stream stdout/stderr → `panel.terminal.delta` → render in a modal. "Gives the live typing feel without a true PTY."
- Option B (NOT shipped): true PTY with `creack/pty` + `xterm.js`. "Heaviest... Only worth it if you want full ANSI fidelity."

The current `panel.terminal.delta` event (`packages/shared/src/events.ts:9`) carries **raw stdout/stderr text**, not terminal bytes from a PTY. There is no PTY allocation anywhere in the codebase (confirmed: no `pty`, `tmux`, or `xterm` references in Go code). The UI modal renders this text monospace — it is a log viewer, not a terminal.

### 3.6 Only 2 of 23 agents can execute

`apps/runner-go/internal/fusion/runner.go:296-310` (`runSelectedModel`):

```go
switch selected.Adapter {
case "opencode":
    runner = opencode.Adapter{...}
case "codex":
    runner = codex.Adapter{...}
default:
    return ModelOutput{..., Error: fmt.Sprintf("%s execution is not implemented in the Go runner yet", ...)}
}
```

The catalog (`apps/runner-go/internal/localagents/catalog.go:41-356`) defines **23 agents** (opencode, claude, codex, cursor-agent, gemini, qwen, qoder, copilot, deepseek, kimi, hermes, pi, aider, devin, grok-build, amp, kiro, kilo, vibe, trae-cli, codebuddy, reasonix, antigravity). Only `opencode` and `codex` have `Run()` implementations. The other 21 are **detect-only** — they register models but cannot execute, because each would need custom Go code for its non-interactive flags and output format.

### 3.7 The fusion pipeline is synchronous and capture-coupled

`fusion.Execute` (`runner.go:84`):
1. Gathers project context (`runner.go:110-114`).
2. Fires all panel models concurrently with a `sync.WaitGroup` + per-adapter semaphore (`runner.go:143-170`).
3. `wg.Wait()` — **blocks until all panels finish** (`runner.go:170`).
4. Runs the judge on the captured `panel[].OutputText` (`runner.go:206`).
5. Optional verification/refinement (`runner.go:228-255`).

The entire pipeline assumes: **run → wait → get `OutputText` string → pass to next stage**. This is the "subprocess as synchronous function" model. It cannot accommodate an interactive, long-lived terminal session where the user might watch, intervene, or continue.

---

## 4. The Mistakes We Are Making (Out-of-the-Box Analysis)

### Mistake 1 — Treating interactive TUI CLIs as headless JSON APIs

`opencode`, `codex`, `pi`, `claude`, `gemini` are **interactive TUI applications**. Their primary mode is a rich terminal UI with ANSI rendering, streaming tool calls, diff viewers, and interactive approval prompts. We force them into `--format json` / `--json` + stdin-pipe mode, which is a **degraded, non-interactive fallback** designed for scripting, not for the product's core experience.

**What we lose:** the TUI, ANSI colors, cursor control, interactive approval flow, the visible "agent reading files / running commands / editing" experience, and the actual feeling of watching an agent work. The product's pitch is "watch multiple expert agents work in parallel" — but the user never sees agents work; they see captured JSON text.

### Mistake 2 — `--dangerously-skip-permissions` hardcoded as a security smell

`opencode.go:90` hardcodes `--dangerously-skip-permissions`. This exists **only because** there is no human at a terminal to approve actions in headless mode. In a real terminal session, the user (or a delegated approval flow) could approve interactively — which is **safer** than blanket-skipping all permissions. We are trading safety for headless convenience, when the headless mode itself is the wrong choice.

### Mistake 3 — Per-adapter `Run()` code makes execution O(n) in the number of agents

Every adapter needs custom Go code: CLI-specific subcommand (`run` vs `exec` vs nothing), flags (`--format json`, `--json`, `--sandbox`, `--skip-git-repo-check`), output parsers (`extractThinking` differs per CLI), and permission-flag mapping. This is why 21 of 23 agents cannot execute. Adding the 21st agent means writing and testing a new adapter — high marginal cost.

**The insight:** if the **terminal** is the contract (not a JSON schema), then **any detected CLI can run with zero adapter code**. You spawn `<cli>` (optionally with `--model X`) in a PTY, send the prompt, and stream the terminal. The CLI uses its own native UI and output format. No per-CLI parser needed for the *terminal*; only for *answer extraction* (and that can be generic — see §9).

### Mistake 4 — The "terminal" in the UI is a lie

`LIVE_TERMINAL_DESIGN.md` ships "Option A" (captured stdout text in a modal) and defers "Option B" (real PTY + xterm.js) as "later, optional." But Option A is **not a terminal** — it is a log viewer. Calling it "terminal" sets the wrong expectation. The user asked for models to "run via terminal like actually opencode cli, codex cli, pi cli runs" — Option A does not satisfy this. We should build the real thing (Option B) as the primary execution model, not as a future enhancement.

### Mistake 5 — Execution is coupled to synchronous capture

`fusion.Execute` does `wg.Wait()` then reads `panel[].OutputText`. This assumes each panel run is a synchronous function that returns a string. A real terminal session is **interactive and long-lived** — the agent may pause for approval, the user may interject, the session may stay open after the answer is produced. The pipeline cannot currently model this. We need to decouple "session lifecycle" from "answer extraction."

### Mistake 6 — No session persistence or re-attachment

Every run is fire-and-forget: spawn → capture → kill. There is no way to re-attach to a model's session, continue the conversation, inspect a live session after the run, or reuse a warm session for a follow-up. A terminal-session model gives **persistent, re-attachable sessions** for free (the PTY stays alive; the user can re-attach via xterm.js or even a local terminal multiplexer).

### Mistake 7 — stdin-piping the prompt breaks CLIs that expect interactive input

Some CLIs (especially in their native mode) read the prompt from an interactive prompt, not stdin. Piping via stdin works for `opencode run -` and `codex exec`, but not for `pi`, `claude`, `gemini` in interactive mode. This is another reason only 2 adapters work. A terminal-session model sends the prompt as **keystrokes to the PTY** (or via the CLI's `-p`/`--prompt` flag if available), which works for any interactive CLI.

### Mistake 8 — We capture instead of delegate

The runner tries to **own** the entire CLI lifecycle (spawn, feed, capture, parse, kill). But the CLIs are already complete applications with their own UIs, auth, model selection, and tooling. The runner should **delegate** to the CLI in a terminal and **observe**, not own. This is the philosophical root of all the above mistakes: we are building an LLM-orchestration layer that treats CLIs as dumb subprocess APIs, when the product's value is in the CLIs' native agent experience.

---

## 5. The Proposed Methodology: Terminal-Session Execution

### 5.1 The principle

**Each model run = one real terminal session.** The runner allocates a PTY, launches the CLI in its native interactive mode, streams the live terminal to the UI, and extracts the answer for the judge. The terminal is the contract — not a JSON schema.

### 5.2 What "run via terminal like opencode/codex/pi CLI" means concretely

When a user runs `opencode` in their terminal, they get: a TUI, model selection, streaming output, tool calls visible, approvals prompted, ANSI rendering. We want **that experience**, one per panel model, parallelizable, observable, and with the answer harvested for fusion.

### 5.3 Three execution tiers (choose per run / per adapter)

| Tier | How the CLI runs | Answer extraction | When to use |
|---|---|---|---|
| **T1 — Native interactive PTY** | `<cli>` (or `<cli> --model X`) in a PTY, prompt sent as keystrokes | Scrape terminal / sentinel markers (§9) | Default; maximum fidelity; any CLI |
| **T2 — JSON-in-PTY** | `<cli> run --format json -` (or `exec --json`) **inside a PTY** | Parse NDJSON from PTY stream | When the CLI has a stable JSON mode and we want reliable extraction |
| **T3 — Headless capture (current)** | `host.RunStreaming` pipes, no PTY | Buffer capture | Fallback only; CI/headless runners with no display |

T1 and T2 both produce a **real terminal** in the UI (xterm.js). T2 keeps the reliable JSON parsing but gains a real PTY (so ANSI, TTY detection, and interactive approval still work). T3 is the current behavior, kept as a fallback for headless/CI environments.

### 5.4 "Each model in a new session, in a specified terminal"

- **New session per model:** the runner's `SessionManager` creates a fresh PTY + process per panel model. Sessions are identified by `runID + jobID` (e.g., `run_123/architect:opencode/claude-sonnet-4`). No state leaks between models.
- **Specified terminal:** the UI renders one xterm.js terminal per panel model (in the model card / a terminal grid). Optionally, the runner can also spawn **external terminal windows** (Terminal.app, iTerm2, Windows Terminal, tmux windows) via a `--terminal` flag, so power users can watch in their own terminal emulator while the UI mirrors via the PTY stream.

---

## 6. How We Do It Precisely (Target State)

### 6.1 New package: `internal/terminal` — the SessionManager

A new Go package owns PTY allocation, process lifecycle, and byte streaming.

```
internal/terminal/
  session.go      — Session struct: PTY, process, runID, jobID, adapter, model
  manager.go      — SessionManager: create/attach/list/kill sessions
  pty_darwin.go   — PTY alloc via creack/pty (or syscall)
  pty_linux.go
  pty_windows.go  — Windows ConPTY
  extract.go      — answer extraction from terminal stream (§9)
```

**Session lifecycle:**
1. `manager.Create(spec)` → allocates PTY, starts `exec.Command` with `pty.Start(cmd)`, returns `*Session`.
2. A goroutine reads PTY bytes → fans out to: (a) WebSocket relay buffer, (b) answer extractor, (c) optional external terminal mirror.
3. The prompt is sent: either as `cmd.Args` (`--prompt`/`-p` flag) or written to the PTY as keystrokes (`session.Send(prompt + "\n")`).
4. The extractor watches for completion (sentinel marker, NDJSON `result` event, or process exit) → produces `OutputText`.
5. `session.Wait()` returns the final `RunResult`.

### 6.2 New adapter method: `RunSession`

Extend the `Adapter` interface (`adapters.go:54`) so adapters can opt into terminal sessions without abandoning the old path:

```go
type Adapter interface {
    ID() string
    Detect(ctx context.Context) DetectionResult
    ListModels(ctx context.Context) ([]ModelRef, error)
    Run(ctx context.Context, input RunInput, emit func(RunEvent)) (*RunResult, error)  // T3 fallback
}

// New: terminal-session execution. Adapters that implement this get T1/T2.
type TerminalAdapter interface {
    Adapter
    // SessionSpec returns how to launch this CLI in a terminal.
    SessionSpec(input RunInput) (TerminalSessionSpec, error)
}

type TerminalSessionSpec struct {
    Binary      string            // resolved CLI path
    Args        []string          // native-mode args (may be empty for pure interactive)
    PromptMode  PromptMode        // keystrokes | flag | stdin
    PromptFlag  string            // e.g., "--prompt" or "-p" (when PromptMode == flag)
    OutputMode  OutputMode        // native | json | plain
    WorkingDir  string
    Env         map[string]string
    Model       string            // passed as --model if non-empty
    TimeoutMs   int
}
```

Adapters that implement `TerminalAdapter` get real terminal execution. Adapters that don't fall back to `Run` (T3). **Critically, a generic `TerminalAdapter` can serve all 23 catalogued CLIs** — the only per-CLI knowledge is `Binary`, `Args`, `PromptMode`, and `OutputMode`, which can be derived from the catalog (`localagents/catalog.go`).

### 6.3 Generic terminal adapter for all catalogued CLIs

Add a `TerminalSessionSpec` to `AgentDef` (`localagents/catalog.go:17`) so every catalogued agent declares how it runs in a terminal:

```go
type AgentDef struct {
    // ...existing fields...
    TerminalSpec TerminalSpecHint  // how to run this CLI in a terminal
}

type TerminalSpecHint struct {
    PromptMode  PromptMode  // keystrokes | flag | stdin
    PromptFlag  string      // "-p" / "--prompt" / ""
    OutputMode  OutputMode  // native | json | plain
    RunArgs     []string    // subcommand for non-interactive JSON mode, e.g., ["run","--format","json","-"]
}
```

Then a single generic adapter, `internal/adapters/terminal/terminal.go`, implements `TerminalAdapter` for **any** `AgentDef`. This means all 23 agents become executable through the terminal path without 23 custom `Run()` functions. The catalog already has the binary, version args, and model list — we add the terminal hint and the generic adapter does the rest.

### 6.4 The fusion pipeline calls sessions, not synchronous captures

`fusion.Execute` (`runner.go:84`) changes so that `runSelectedModel` (`runner.go:272`):
1. Asks the `SessionManager` to create a session per panel model.
2. Streams `panel.terminal.delta` with **real PTY bytes** (not captured stdout lines).
3. Waits for the session's answer extraction (not the process buffer).
4. Passes the extracted `OutputText` to the judge.

The `wg.Wait()` at `runner.go:170` still works — it waits for all sessions to produce answers. But sessions can also be **observed live** in the UI before they complete, because the PTY stream flows from session creation, not from a post-hoc capture.

### 6.5 The UI gets a real terminal (xterm.js) per model

Replace the captured-text modal (`LIVE_TERMINAL_DESIGN.md` Option A) with **xterm.js** terminals:
- One xterm.js instance per panel model, in the model card or a terminal grid.
- A WebSocket endpoint on the runner (`/api/sessions/:id/stream`) relays raw PTY bytes.
- xterm.js renders ANSI, cursor control, colors — the real CLI TUI.
- The user can optionally **type into the terminal** (send keystrokes to the PTY) for interactive approval or follow-up.

For the cloud path, the runner relays PTY bytes as `panel.terminal.delta` events (the event type already exists at `events.ts:9`) — but now the payload carries **raw terminal bytes** (base64 or text) instead of captured stdout lines. The web `FusionRunDO` WebSocket already fans these out.

---

## 7. Precise Changes Required (File by File)

### 7.1 New Go package: `internal/terminal/`

| File | Purpose |
|---|---|
| `internal/terminal/session.go` | `Session` struct: PTY handle, `exec.Cmd`, runID/jobID, byte pump goroutine, `Send(string)`, `Wait() RunResult`, `Kill()`. |
| `internal/terminal/manager.go` | `SessionManager`: `Create(spec) (*Session, error)`, `Get(id)`, `List()`, `Kill(id)`. Thread-safe map of sessions. |
| `internal/terminal/pty_unix.go` | PTY alloc via `github.com/creack/pty` (`pty.Start(cmd)`). Build tag `!windows`. |
| `internal/terminal/pty_windows.go` | Windows ConPTY (`microsoft/go-crypto` ConPTY or `User32` wrapper). Build tag `windows`. |
| `internal/terminal/extract.go` | Answer extraction strategies (§9): sentinel markers, NDJSON parsing, scrollback scrape, process-exit fallback. |
| `internal/terminal/relay.go` | WebSocket relay: serves raw PTY bytes at `/api/sessions/:id/stream` for the local UI; converts to `panel.terminal.delta` for cloud. |

**New dependency:** `github.com/creack/pty` in `apps/runner-go/go.mod`.

### 7.2 `internal/adapters/adapters.go` — extend the interface

Add `TerminalAdapter` interface, `TerminalSessionSpec`, `PromptMode`, `OutputMode` types (§6.2). Keep `Adapter.Run` as the T3 fallback. Add `TerminalAdapter` type assertion in `runSelectedModel`.

### 7.3 `internal/adapters/terminal/terminal.go` (new) — generic terminal adapter

A single adapter that implements `TerminalAdapter` for any `AgentDef`. `SessionSpec()` builds a `TerminalSessionSpec` from the catalog entry + `RunInput`. This makes all 23 agents executable.

### 7.4 `internal/adapters/opencode/opencode.go` — add `SessionSpec`, keep `Run` as fallback

- Implement `TerminalAdapter.SessionSpec`: `Binary = opencode-cli`, `Args = []` (native interactive) or `["run","--format","json","-"]` for T2, `PromptMode = keystrokes` (T1) or `stdin` (T2), `OutputMode = native | json`.
- **Remove the hardcoded `--dangerously-skip-permissions`** from the terminal path (`opencode.go:90`). In a real terminal, approvals are interactive. Keep it only in the T3 fallback for headless CI.
- Keep `Run()` (`opencode.go:84`) as the T3 fallback.

### 7.5 `internal/adapters/codex/codex.go` — add `SessionSpec`, keep `Run` as fallback

- Implement `TerminalAdapter.SessionSpec`: `Binary = codex`, `Args = []` (native interactive) or `["exec","--json","--skip-git-repo-check","--sandbox",...]` for T2.
- Keep `Run()` (`codex.go:87`) as T3 fallback.

### 7.6 `internal/localagents/catalog.go` — add `TerminalSpec` hint to every `AgentDef`

Add a `TerminalSpecHint` to each of the 23 catalog entries (`catalog.go:41-356`). Most are trivial:
- `pi`: `PromptMode: flag, PromptFlag: "-p", OutputMode: native` (pi accepts `-p`).
- `claude`: `PromptMode: keystrokes, OutputMode: native`.
- `gemini`: `PromptMode: keystrokes, OutputMode: native`.
- ACP agents (kimi, hermes, devin, ...): `PromptMode: keystrokes, OutputMode: native` (ACP runs in the terminal natively).

This is the change that unlocks all 23 agents for execution — declarative, no per-agent Go code.

### 7.7 `internal/fusion/runner.go` — use sessions

- `runSelectedModel` (`runner.go:272`): if the adapter implements `TerminalAdapter`, create a session via `SessionManager` and stream real PTY bytes; else fall back to `Run` (T3).
- `Execute` (`runner.go:84`): the `wg.Wait()` (`runner.go:170`) now waits for session answer extraction, not buffer capture. The per-adapter semaphore (`runner.go:144-150`) still applies — same adapter serializes.
- Pass the `SessionManager` into `Execute` via `Request` (`runner.go:19`).

### 7.8 `internal/executors/host/host.go` — keep, but it becomes the T3 path

`RunStreaming` (`host.go:96`) stays as the headless fallback. No PTY here. Used when `TerminalAdapter` is not implemented or the runner is in `--headless` mode.

### 7.9 `internal/localui/server.go` — add session WebSocket + xterm.js

- Add `GET /api/sessions/:id/stream` WebSocket that upgrades and relays raw PTY bytes from the `SessionManager`.
- Add `POST /api/sessions/:id/input` to send keystrokes back to the PTY (interactive approval / follow-up).
- Replace the captured-text modal in `indexHTML` (`server.go:128`) with an xterm.js terminal per model. Add xterm.js + xterm-addon-attach via CDN or bundled.
- The existing `POST /api/fuse` (`server.go:55`) now creates sessions and returns session IDs; the UI attaches xterm.js to each.

### 7.10 `cmd/fusion-runner/main.go` — wire the SessionManager

- `runFuse` (`main.go:577`): create a `SessionManager`, pass into `fusion.Request`.
- `runUI` (`main.go:642`): create a `SessionManager`, pass into `localui.Serve`.
- `executeCloudJob` (`main.go:289`): if the adapter implements `TerminalAdapter`, use sessions and relay PTY bytes as `panel.terminal.delta` (base64-encoded raw bytes) to the cloud. Else fall back to `Run`.
- Add `--terminal native|json|headless` flag to `fuse` and `ui` to select the execution tier.
- Add `--external-terminal` flag: when set, the runner also opens a real terminal window (osascript for Terminal.app / iTerm2 on macOS; `wt.exe` on Windows; `xterm` on Linux) attached to the session, via tmux where available.

### 7.11 `packages/shared/src/events.ts` — enrich `panel.terminal.delta`

The event type already exists (`events.ts:9`). Change the **payload contract**: `data.bytes` (base64 raw PTY bytes) in addition to `data.text`. Add `data.sessionId`. This keeps backward compatibility (text still present) while enabling xterm.js to render raw bytes.

### 7.12 `apps/web/src/app/runs/[runId]/run-chat.tsx` — real xterm.js terminals

- Replace the captured-text `TerminalModal` (per `LIVE_TERMINAL_DESIGN.md` §5) with an xterm.js instance per panel.
- Attach to the runner's session stream (via the cloud relay or direct local WS).
- Render ANSI/colors/cursor. Allow input when the session is interactive.
- The existing `buildTrace` / `PanelTrace` (`LIVE_TERMINAL_DESIGN.md` §6) gains a `sessionId` field.

### 7.13 `Docs/LIVE_TERMINAL_DESIGN.md` — update

Mark Option B (real PTY + xterm.js) as the **primary** execution model, not "later, optional." Option A (captured text) becomes the headless fallback. This doc currently appears duplicated (two copies in one file); fix that.

---

## 8. Architecture: Current vs Target

### 8.1 Current

```
fusion.Execute
  └─ runSelectedModel
       └─ adapter.Run
            └─ host.RunStreaming  (pipes, NO pty)
                 ├─ stdin  ← prompt
                 ├─ stdout → bytes.Buffer + panel.terminal.delta (captured lines)
                 └─ stderr → bytes.Buffer + panel.terminal.delta (captured lines)
  └─ wg.Wait() → read OutputText → judge.Run → ...
```

UI: captured text in a modal. No interactivity. 2 of 23 agents execute.

### 8.2 Target

```
fusion.Execute
  └─ runSelectedModel
       ├─ if TerminalAdapter:
       │    └─ SessionManager.Create(spec)
       │         └─ pty.Start(cmd)  ← REAL PTY
       │              ├─ prompt: keystrokes OR --prompt flag OR stdin
       │              ├─ pty bytes → WS relay → xterm.js (real terminal)
       │              ├─ pty bytes → extract.go → OutputText (for judge)
       │              └─ optional: mirror to external terminal (tmux/Terminal.app)
       └─ else:
            └─ adapter.Run (host.RunStreaming, T3 fallback)
  └─ wg.Wait() → read extracted OutputText → judge session → ...
```

UI: real xterm.js terminal per model, ANSI, interactive. All 23 agents execute via the generic terminal adapter.

---

## 9. Output Extraction: How the Judge Gets Its Input

The fusion pipeline needs each panel model's **answer text** to feed the judge. In a real terminal session, the answer is mixed with TUI chrome, tool-call output, and ANSI escapes. Extraction strategies, in priority order:

### 9.1 Sentinel markers (T1, most reliable for native mode)

Wrap the user's prompt with sentinel markers before sending:

```
===FUSION_PROMPT_START===
<user prompt>
===FUSION_PROMPT_END===
```

Then instruct the model (in the prompt preamble) to wrap its final answer:

```
===FUSION_ANSWER_START===
<final answer>
===FUSION_ANSWER_END===
```

The extractor (`extract.go`) scans the PTY stream for `===FUSION_ANSWER_START===` ... `===FUSION_ANSWER_END===`, strips ANSI, and returns the content. This works for any CLI in native mode, regardless of its TUI.

### 9.2 NDJSON parsing (T2, for JSON-in-PTY mode)

When `OutputMode == json`, the CLI emits NDJSON. The extractor parses events:
- opencode: `type: "message"` / `type: "reasoning"` → `part.text`.
- codex: `type: "reasoning_summary_text.done"` / `type: "message"` → `text`.
- generic: look for a `text`/`content`/`message` field on items with a terminal type.

This reuses the existing `extractThinking` logic (`opencode.go:238`, `codex.go:222`) but reads from the PTY stream instead of a captured buffer.

### 9.3 Scrollback scrape (T1 fallback)

If no sentinels and no JSON, take the PTY scrollback at process exit, strip ANSI (`regexp` for `\x1b\[[0-9;]*[a-zA-Z]`), drop known TUI chrome lines (status bars, spinners), and return the remaining text. Less reliable; used only when the CLI doesn't support markers or JSON.

### 9.4 Process exit = done

Regardless of strategy, the session is "complete" when the CLI process exits (the agent finished) or the timeout fires. The extractor returns whatever it has at that point.

**Recommendation:** default to **T2 (JSON-in-PTY)** for opencode and codex (reliable extraction + real terminal), and **T1 (native + sentinels)** for all other agents. T3 (headless capture) only for CI.

---

## 10. Session Lifecycle and Concurrency

### 10.1 One session per model

`SessionManager.Create` is called once per panel model in `Execute` (`runner.go:151-169`). Each session has a unique ID (`runID/jobID`). No state shared between sessions. The per-adapter semaphore (`runner.go:144-150`) still serializes same-adapter runs — but now "serialize" means "one live session per adapter at a time," which is correct (a CLI subscription usually can't run two concurrent sessions).

### 10.2 Session states

```
created → running → extracting → completed
                  └→ failed
                  └→ cancelled (timeout / user cancel)
```

The UI shows the live terminal during `running`, a "extracting answer…" shimmer during `extracting`, and the final answer + terminal scrollback during `completed`.

### 10.3 Re-attachment

Sessions persist after the answer is extracted (until the run is deleted or the runner restarts). The UI can re-attach to any session's xterm.js stream to review what the agent did. A "continue in this session" action can send a follow-up prompt to the same PTY (if the CLI is still running interactively) — enabling multi-turn fusion.

### 10.4 External terminals

When `--external-terminal` is set, `SessionManager.Create` also opens a real terminal window:
- **macOS:** `osascript -e 'tell app "Terminal" to do script "tmux attach -t <session>"'` (or iTerm2).
- **Linux:** `xterm -e "tmux attach -t <session>"` or `gnome-terminal -- tmux attach ...`.
- **Windows:** `wt.exe -- wsl tmux attach -t <session>` (or ConPTY directly).

The runner uses **tmux** as the PTY host when available: `tmux new-session -d -s <id> "<cli> ..."`. This gives free external attach, scrollback, and window management. xterm.js in the UI attaches to the same tmux session via the byte relay. When tmux is absent, the runner uses `creack/pty` directly and only the UI terminal is available.

---

## 11. Build Order

1. **`internal/terminal/` skeleton + `creack/pty` dep.** Session, Manager, PTY alloc, byte pump. Unit-test with `echo`/`cat`. (~half day)
2. **`internal/adapters/terminal/terminal.go` generic adapter** + `TerminalAdapter` interface in `adapters.go`. (~half day)
3. **`internal/terminal/extract.go`** — sentinel + NDJSON + scrollback strategies. Unit-test with fixture streams. (~half day)
4. **Wire opencode + codex `SessionSpec`** (T2 JSON-in-PTY). Keep `Run()` as fallback. Integration-test: run a real prompt through a session, verify extraction. (~half day)
5. **`fusion/runner.go`** — `runSelectedModel` uses sessions when `TerminalAdapter`; `Request` carries `SessionManager`. Run `go test ./...`. (~2 hrs)
6. **`localui/server.go`** — `/api/sessions/:id/stream` WS + `/api/sessions/:id/input`; xterm.js in `indexHTML`. Manual test in browser. (~half day)
7. **`cmd/fusion-runner/main.go`** — `--terminal` and `--external-terminal` flags; wire `SessionManager` into `fuse`/`ui`/`executeCloudJob`. (~2 hrs)
8. **Catalog `TerminalSpec` hints** for all 23 agents (`catalog.go`). Verify all 23 can launch a session. (~half day)
9. **`packages/shared/src/events.ts`** — `panel.terminal.delta` payload gains `bytes` + `sessionId`. (~30 min)
10. **`apps/web/.../run-chat.tsx`** — xterm.js per panel model, attach to session stream. (~1 day)
11. **tmux integration** in `SessionManager` for external terminals. (~half day)
12. **Remove `--dangerously-skip-permissions`** from the terminal path; keep only in T3 fallback. (~15 min)
13. **Update `Docs/LIVE_TERMINAL_DESIGN.md`** — Option B is primary. (~30 min)

---

## 12. Risks and Mitigations

| Risk | Impact | Mitigation |
|---|---|---|
| **PTY on Windows is harder** (ConPTY, not `creack/pty`) | High | Use `microsoft/go-crypto` ConPTY or `User32` wrapper; gate Windows behind T3 until ConPTY path is stable. tmux is unavailable on native Windows. |
| **Answer extraction is unreliable in native mode** | High | Default to T2 (JSON-in-PTY) for opencode/codex where extraction is reliable. Use sentinels for T1. Always fall back to scrollback scrape. Never block the judge on perfect extraction — pass what we have. |
| **Interactive CLIs may hang waiting for input** | Medium | Send the prompt via `--prompt`/`-p` flag where available (avoids waiting for keystrokes). Set a session timeout (`TimeoutMs`). Detect "no output for N seconds" and prompt the user. |
| **PTY byte stream is large over WebSocket** | Medium | The stream is line-rate text; compress with `permessage-deflate`. For the cloud path, relay only when a client is watching the terminal (lazy subscribe). |
| **Same-adapter parallelism** | Medium | Keep the per-adapter semaphore (`runner.go:144`). One live session per adapter at a time. Different adapters run in parallel. |
| **Security: interactive approvals in a terminal** | Medium | This is **safer** than `--dangerously-skip-permissions`. The user approves in the terminal. For headless CI, keep T3 with the skip flag, gated behind an explicit `--headless` flag. |
| **tmux dependency for external terminals** | Low | tmux is optional. When absent, use `creack/pty` directly; external terminal windows are a nice-to-have, not required. |
| **Cloud path latency for PTY relay** | Medium | For cloud-dispatched jobs, prefer T2/T3 (the runner extracts locally and posts `panel.output.delta` with the answer). Relay PTY bytes only when a user is watching the trace. |

---

## 13. Verification Checklist

### Runner (Go)
- [ ] `go test ./internal/terminal/...` passes (session create, byte pump, extract strategies).
- [ ] `go test ./internal/adapters/...` passes (TerminalAdapter for opencode, codex, generic).
- [ ] `go test ./internal/fusion/...` passes (Execute uses sessions, falls back to Run).
- [ ] `go test ./...` green.
- [ ] `gofmt -l .` clean.
- [ ] `fusion-runner fuse --terminal json --workspace ... --analysis-model opencode/... --prompt "..."` produces a real terminal stream + extracted answer.
- [ ] `fusion-runner ui --terminal native --workspace ...` shows xterm.js per model in the browser.
- [ ] All 23 catalogued agents can launch a session (no "execution is not implemented" error).
- [ ] `--dangerously-skip-permissions` is absent from the terminal path; present only in `--headless` T3.
- [ ] `--external-terminal` opens a real Terminal.app/iTerm2 window attached to the session (macOS).

### Extraction
- [ ] Sentinel markers: answer extracted between `===FUSION_ANSWER_START/END===`.
- [ ] NDJSON: opencode `type:"message"` and codex `reasoning_summary_text.done` parsed correctly.
- [ ] Scrollback fallback: ANSI stripped, chrome dropped, returns non-empty text on a native session.
- [ ] Timeout: session killed at `TimeoutMs`, partial answer returned.

### UI
- [ ] xterm.js renders ANSI colors and cursor control for a running opencode session.
- [ ] User can type into the terminal (keystrokes reach the PTY).
- [ ] Multiple model terminals render in parallel (different adapters) and serialize (same adapter).
- [ ] Re-attaching to a completed session shows the scrollback.

### Cloud path
- [ ] `executeCloudJob` relays PTY bytes as `panel.terminal.delta` with `bytes` + `sessionId`.
- [ ] Cloud run trace shows the live terminal when a user opens the model card.

---

## Appendix A — Why this is the right call (product argument)

The product's pitch is: *"watch multiple expert agents work in parallel, then get a judged, synthesized answer."* Today the user **cannot watch** — they see captured JSON text after the fact. The terminal-session model makes the core product experience real: each agent works in its own terminal, visibly, interactively, like the user ran `opencode` / `codex` / `pi` themselves. It also collapses the 21-agent execution gap to zero (generic terminal adapter), removes a security smell (`--dangerously-skip-permissions`), and enables multi-turn sessions. The terminal is not a UI feature; it is the execution model.

## Appendix B — Key file reference

| Layer | File | Role |
|---|---|---|
| Fusion orchestration | `apps/runner-go/internal/fusion/runner.go` | `Execute`, `runSelectedModel` — calls sessions |
| Adapter interface | `apps/runner-go/internal/adapters/adapters.go` | Add `TerminalAdapter` |
| OpenCode adapter | `apps/runner-go/internal/adapters/opencode/opencode.go` | `SessionSpec`, remove hardcoded skip-permissions |
| Codex adapter | `apps/runner-go/internal/adapters/codex/codex.go` | `SessionSpec` |
| Generic terminal adapter | `apps/runner-go/internal/adapters/terminal/terminal.go` (new) | Runs any catalogued CLI |
| Terminal sessions | `apps/runner-go/internal/terminal/` (new) | PTY, Manager, extract, relay |
| Host executor (T3 fallback) | `apps/runner-go/internal/executors/host/host.go` | `RunStreaming` unchanged |
| Agent catalog | `apps/runner-go/internal/localagents/catalog.go` | Add `TerminalSpec` to all 23 agents |
| Runner CLI | `apps/runner-go/cmd/fusion-runner/main.go` | `--terminal`, `--external-terminal`, wire `SessionManager` |
| Local UI | `apps/runner-go/internal/localui/server.go` | Session WS, xterm.js |
| Event types | `packages/shared/src/events.ts` | `panel.terminal.delta` payload + `sessionId` |
| Run page | `apps/web/src/app/runs/[runId]/run-chat.tsx` | xterm.js per panel |
| Existing design doc | `Docs/LIVE_TERMINAL_DESIGN.md` | Update: Option B is primary |

---

**End of document.**