# Architecture Decision Report: Terminal-Session Execution Model

> **Status:** Final Recommendation
> **Date:** 2026-06-26
> **Author:** Senior System Architecture Review
> **Scope:** Choose the best execution methodology for openFusion's model-running layer, analyze scalability/efficiency, document worst-case real-world scenarios, and specify the production-grade architecture to implement.
> **Input:** `Docs/TERMINAL_SESSION_EXECUTION_RND.md` (R&D analysis with 3-tier proposal)

---

## Table of Contents

1. [Executive Decision](#1-executive-decision)
2. [Approach Comparison Matrix](#2-approach-comparison-matrix)
3. [The Recommended Architecture: Hybrid T1-Primary with Parallel Extraction](#3-the-recommended-architecture-hybrid-t1-primary-with-parallel-extraction)
4. [Component Design (System Design)](#4-component-design-system-design)
5. [Data Flow Architecture](#5-data-flow-architecture)
6. [Scalability Analysis](#6-scalability-analysis)
7. [Efficiency Analysis](#7-efficiency-analysis)
8. [Worst-Case Real-World Scenarios (10 Deep Dives)](#8-worst-case-real-world-scenarios-10-deep-dives)
9. [Risk Mitigation Architecture](#9-risk-mitigation-architecture)
10. [Security Architecture](#10-security-architecture)
11. [Implementation Priority Matrix (Phased Rollout)](#11-implementation-priority-matrix-phased-rollout)
12. [Success Metrics and SLOs](#12-success-metrics-and-slos)
13. [Migration Strategy](#13-migration-strategy)
14. [Cost of Wrong Decision](#14-cost-of-wrong-decision)
15. [Final Verdict](#15-final-verdict)

---

## 1. Executive Decision

### The Question

The R&D document (`TERMINAL_SESSION_EXECUTION_RND.md`) proposes three execution tiers:

| Tier | Description | Extraction Method |
|---|---|---|
| **T1** | Native interactive PTY — CLI runs in its real TUI mode | Sentinel markers / scrollback scrape |
| **T2** | JSON-in-PTY — CLI runs with `--format json` inside a real PTY | NDJSON parsing |
| **T3** | Headless capture (current) — pipes, no PTY | Buffer capture |

Which tier(s) should we implement as the primary execution model for openFusion?

### The Decision

**T1 (Native Interactive PTY) is the primary execution model, backed by a multi-strategy parallel extraction pipeline. T2 is the secondary path for CLIs with stable JSON modes. T3 is the fallback for headless/CI.**

This is a **hybrid architecture** — not a single tier — because no single tier satisfies all requirements simultaneously:

| Requirement | T1 alone | T2 alone | T3 alone | **Hybrid (chosen)** |
|---|---|---|---|---|
| Real terminal experience (user's explicit ask) | YES | No (JSON text, not TUI) | No | **YES** |
| Reliable answer extraction for judge | Weak (sentinels) | YES | YES | **YES (multi-strategy)** |
| All 23 agents supported | YES | No (not all have JSON mode) | No (only 2 work) | **YES** |
| Interactive approvals (no `--dangerously-skip-permissions`) | YES | Partial | No | **YES** |
| Scalable to N agents | YES | No (per-CLI JSON parser) | No (per-CLI Run code) | **YES** |
| Cloud-relay efficient | No (TUI is verbose) | YES (structured) | YES | **YES (adaptive)** |

### Why T1 as Primary (Not T2)

The user's requirement is unambiguous: *"each model must run in a new, isolated terminal session"* and *"must work like opencode CLI, codex CLI, pi CLI run natively."*

T2 (`opencode run --format json -` inside a PTY) produces **NDJSON text in the terminal**, not the rich TUI. The user would see `{"type":"reasoning","text":"..."}` scrolling by — that is NOT "like opencode CLI runs natively." T2 is a **better-extracted T3**, not a real terminal experience.

T1 runs `<cli>` or `<cli> --model X` in its **native interactive mode** — the user sees the real TUI, real tool calls, real ANSI, real approvals. This is the product promise: *"watch multiple expert agents work in parallel."*

The weakness of T1 — answer extraction — is an **engineering problem we can solve** (see §4.4), not a fundamental architectural flaw. The weakness of T2 — degraded UX — is a **product problem we cannot engineer around**.

### Why Not T1 Alone

T1's extraction is unreliable for CLIs that:
- Don't obey sentinel markers (some models ignore instructions)
- Have complex TUI chrome that's hard to strip (full-screen apps with alternate screen buffers)
- Use alternate screen modes (ANSI `\x1b[?1049h`) that clear on exit

For these cases, T2 (JSON-in-PTY) is the **reliable fallback** that still provides a real terminal (PTY) while giving us structured extraction. And T3 remains for headless CI where no display exists.

**The architecture chooses T1 by default, falls back to T2 when extraction confidence is low or the CLI has a stable JSON mode, and falls back to T3 in headless environments.**

---

## 2. Approach Comparison Matrix

### 2.1 Detailed Tier Comparison

| Dimension | T1 (Native PTY) | T2 (JSON-in-PTY) | T3 (Headless Capture) | Hybrid (Recommended) |
|---|---|---|---|---|
| **User sees** | Real CLI TUI with ANSI, colors, cursor | NDJSON text stream | Captured stdout lines | Real TUI (T1) or JSON (T2) |
| **PTY allocation** | YES (`creack/pty` / ConPTY) | YES | NO (pipes) | YES (T1/T2) or NO (T3) |
| **Prompt delivery** | Keystrokes to PTY or `--prompt` flag | stdin pipe into PTY | stdin pipe | Per-CLI best method |
| **Extraction reliability** | 60-85% (sentinels + scrape) | 95-99% (NDJSON parse) | 95-99% (buffer) | 90-99% (multi-strategy) |
| **Per-CLI Go code needed** | ZERO (generic adapter) | LOW (JSON schema per CLI) | HIGH (full Run() per CLI) | LOW (catalog hints only) |
| **Agents supported** | ALL 23 (any CLI) | ~5-8 (JSON-mode CLIs) | 2 (opencode, codex) | ALL 23 |
| **Interactive approvals** | YES (user types in terminal) | Partial (flags still needed) | NO (`--dangerously-skip-permissions`) | YES (T1) / flags (T2/T3) |
| **Multi-turn sessions** | YES (PTY stays alive) | NO (one-shot JSON mode) | NO | YES (T1) |
| **External terminal attach** | YES (tmux mirror) | YES | NO | YES |
| **Cloud relay cost** | HIGH (TUI is verbose) | LOW (structured) | LOW | ADAPTIVE (lazy + compress) |
| **Memory per session** | ~2-8 MB (scrollback ring) | ~1-4 MB | ~0.5-2 MB | ~2-8 MB |
| **Cross-platform** | macOS/Linux good, Windows hard | Same | All (pipes) | Platform-adaptive |
| **Implementation effort** | Medium (PTY + extraction) | Medium (PTY + JSON) | DONE (exists) | Medium-High (but phased) |

### 2.2 Decision Scoring (Weighted)

Weights reflect openFusion's product priorities:

| Criterion | Weight | T1 | T2 | T3 | Hybrid |
|---|---|---|---|---|---|
| User experience (real terminal) | 25% | 10 | 5 | 2 | **10** |
| Extraction reliability | 20% | 6 | 9 | 9 | **9** |
| Agent coverage (all 23) | 20% | 10 | 4 | 1 | **10** |
| Scalability (N agents, O(1) code) | 15% | 10 | 5 | 2 | **10** |
| Security (no skip-permissions) | 10% | 10 | 5 | 2 | **9** |
| Cloud relay efficiency | 5% | 3 | 8 | 8 | **7** |
| Implementation speed | 5% | 6 | 6 | 10 | **5** |
| **Weighted Total** | 100% | **8.35** | **5.85** | **3.35** | **9.35** |

**Hybrid wins decisively.** T1 is second. T3 (current) is the worst option by a wide margin.

---

## 3. The Recommended Architecture: Hybrid T1-Primary with Parallel Extraction

### 3.1 Architecture Overview

```
┌─────────────────────────────────────────────────────────────────────────┐
│                         fusion.Execute (runner.go)                      │
│                    Panel → Judge → Final-Writer Pipeline                │
└──────────────────────────────┬──────────────────────────────────────────┘
                               │
                               ▼
                    ┌─────────────────────┐
                    │  runSelectedModel   │
                    │  (runner.go:272)    │
                    └──────────┬──────────┘
                               │
                ┌──────────────┼──────────────┐
                │              │              │
                ▼              ▼              ▼
         TerminalAdapter?  TerminalAdapter?  No
            (T1/T2)          (T1/T2)       (T3 fallback)
                │              │              │
                ▼              ▼              ▼
     ┌─────────────────┐ ┌─────────────────┐ ┌─────────────┐
     │ SessionManager  │ │ SessionManager  │ │ host.Run    │
     │ .Create(spec)   │ │ .Create(spec)   │ │ Streaming   │
     └────────┬────────┘ └────────┬────────┘ └──────┬──────┘
              │                   │                 │
              ▼                   ▼                 │
     ┌─────────────────────────────────────┐        │
     │           PTY Session               │        │
     │  ┌─────────────────────────────┐   │        │
     │  │   creack/pty / ConPTY       │   │        │
     │  │   exec.CommandContext       │   │        │
     │  │   (CLI in native mode)      │   │        │
     │  └──────────┬──────────────────┘   │        │
     │             │                       │        │
     │     ┌───────┴────────┐              │        │
     │     │  Byte Pump     │              │        │
     │     │  (goroutine)   │              │        │
     │     └───┬───┬───┬────┘              │        │
     │         │   │   │                    │        │
     │    ┌────┘   │   └────┐               │        │
     │    ▼        ▼        ▼               │        │
     │  Ring    Extract   Relay              │        │
     │  Buffer  Pipeline  (WS/cloud)         │        │
     │  (8MB)  (multi-     │                 │        │
     │         strategy)   │                 │        │
     │    │           │    │                 │        │
     │    ▼           ▼    ▼                 │        │
     │  Scrollback  Answer  panel.terminal   │        │
     │  (re-attach) (for    .delta           │        │
     │              judge)  (bytes+b64)      │        │
     └─────────────────────────────────────┘        │
              │                                      │
              ▼                                      ▼
     ┌─────────────────┐                    ┌──────────────┐
     │  Extraction     │                    │  OutputText  │
     │  Result +       │                    │  (buffer)    │
     │  Confidence     │                    └──────┬───────┘
     │  Score          │                           │
     └────────┬────────┘                           │
              │                                    │
              ▼                                    ▼
     ┌─────────────────────────────────────────────────┐
     │            ModelOutput.OutputText               │
     │     (highest-confidence extraction wins)        │
     └─────────────────────────────────────────────────┘
              │
              ▼
     ┌─────────────────┐
     │   Judge Model   │
     │   (receives     │
     │    OutputText   │
     │    per panel)   │
     └─────────────────┘
```

### 3.2 Key Architectural Principles

1. **Terminal is the contract, not JSON** — any CLI runs with zero per-CLI adapter code.
2. **Extraction is decoupled from execution** — the byte pump fans out to relay (UI) AND extraction (judge) independently.
3. **Confidence-scored extraction** — the judge knows how reliable each panel's answer is.
4. **Backpressure-aware** — the byte pump never blocks on a slow consumer (ring buffer drops oldest, relay uses non-blocking send).
5. **Session-first, not capture-first** — sessions are long-lived, re-attachable, and observable from creation.
6. **Platform-adaptive** — Unix PTY, Windows ConPTY, or T3 fallback, chosen at runtime.
7. **Lazy cloud relay** — PTY bytes relay to cloud only when a user is watching; otherwise, only the extracted answer is sent.

### 3.3 Tier Selection Logic (Per Session)

```
┌──────────────────────────────────────────────┐
│         Tier Selection Algorithm             │
├──────────────────────────────────────────────┤
│                                              │
│  1. Is headless mode (--headless)?           │
│     → YES: use T3 (host.RunStreaming)        │
│                                              │
│  2. Does the CLI have a stable JSON mode     │
│     AND is this a cloud-dispatched job?      │
│     → YES: use T2 (JSON-in-PTY)              │
│     (cloud needs reliable extraction +       │
│      low relay bandwidth)                    │
│                                              │
│  3. Does the CLI have a stable JSON mode     │
│     AND no native TUI value?                 │
│     → YES: use T2                            │
│                                              │
│  4. Default: use T1 (native interactive)     │
│     → Real TUI, sentinels for extraction,    │
│       scrollback scrape as fallback          │
│                                              │
│  5. If T1 extraction confidence < 0.5:       │
│     → Auto-escalate: re-run with T2          │
│       (if CLI supports JSON mode)            │
│     → Or: mark as "needs review" and         │
│       show terminal to user for manual       │
│       answer identification                  │
│                                              │
└──────────────────────────────────────────────┘
```

This means:
- **Local UI runs** default to T1 (best UX, user is watching).
- **Cloud-dispatched runs** default to T2 (reliable extraction, low bandwidth).
- **CI/headless runs** use T3 (no display, reliable capture).
- **T1 extraction failure** triggers automatic T2 re-run or human review.

---

## 4. Component Design (System Design)

### 4.1 `internal/terminal/session.go` — The Session

The Session is the atomic unit of execution. One session = one model run.

```go
type Session struct {
    ID          string                 // "run_123/architect:opencode/claude-sonnet-4"
    RunID       string
    JobID       string
    AdapterID   string
    ModelID     string
    Tier        ExecutionTier          // T1, T2, T3

    // PTY
    ptyHandle   PTYHandle              // platform abstraction (creack/pty or ConPTY)
    cmd         *exec.Cmd
    stdin       io.WriteCloser         // for writing keystrokes / prompt

    // Byte pump
    pumpDone    chan struct{}          // closed when byte pump exits
    ringBuffer  *RingBuffer            // 8MB scrollback ring (see §4.6)

    // Extraction
    extractor   *Extractor             // multi-strategy (see §4.4)
    extractCh   chan ExtractionResult  // extractor reports here

    // Relay
    relaySubs   map[chan []byte]struct{} // WebSocket subscribers
    relayMu     sync.RWMutex

    // Lifecycle
    state       atomic.Int32           // created|running|extracting|completed|failed|cancelled
    createdAt   time.Time
    deadline    time.Time              // timeout
    healthTicker *time.Ticker          // health check (see §4.7)
}
```

**Key methods:**
- `Send(data string)` — writes keystrokes to PTY (for interactive input / prompt delivery)
- `Wait() <-chan ExtractionResult` — blocks until extraction produces an answer or session ends
- `Kill()` — kills process group (not just the process — see §8.6)
- `Scrollback() []byte` — returns ring buffer contents (for re-attach)
- `Subscribe() <-chan []byte` — subscribes to live PTY byte stream (for xterm.js)
- `Unsubscribe(ch)` — unsubscribes

### 4.2 `internal/terminal/manager.go` — SessionManager

Thread-safe registry of all active sessions.

```go
type SessionManager struct {
    mu         sync.RWMutex
    sessions   map[string]*Session
    limits     ResourceLimits         // max sessions, max memory, max FDs
    metrics    *MetricsCollector      // for observability
    ptyAlloc   PTYAllocator           // platform-specific PTY allocation
}

type ResourceLimits struct {
    MaxConcurrentSessions  int           // default: 12
    MaxSessionsPerAdapter  int           // default: 1 (enforced by fusion's semaphore)
    MaxScrollbackBytes     int           // default: 8MB per session
    MaxSessionDuration     time.Duration // default: 10 minutes
    MaxTotalMemoryMB       int           // default: 256MB across all sessions
}
```

**Key methods:**
- `Create(spec SessionSpec) (*Session, error)` — allocates PTY, starts process, launches byte pump + extractor
- `Get(id string) (*Session, bool)` — retrieve a session
- `List() []*Session` — list all active sessions
- `Kill(id string)` — kill a specific session
- `KillAll()` — kill all sessions (graceful shutdown)
- `Metrics() ManagerMetrics` — returns session count, memory usage, FD usage

### 4.3 `internal/terminal/pty.go` — Platform Abstraction

```go
// PTYHandle abstracts platform-specific PTY implementations.
type PTYHandle interface {
    Read(p []byte) (n int, err error)
    Write(p []byte) (n int, err error)
    SetSize(rows, cols int) error       // terminal resize
    Close() error                        // closes both PTY master and kills child
    File() *os.File                      // underlying file (for select/poll)
}

// PTYAllocator creates PTY handles.
type PTYAllocator interface {
    Start(cmd *exec.Cmd) (PTYHandle, error)
    StartWithSize(cmd *exec.Cmd, rows, cols int) (PTYHandle, error)
}
```

**Implementations:**
- `pty_unix.go` (build tag `!windows`): wraps `github.com/creack/pty`. `pty.Start(cmd)` / `pty.StartWithSize(cmd, rows, cols)`.
- `pty_windows.go` (build tag `windows`): wraps Windows ConPTY (`CreatePseudoConsole` via syscall or `microsoft/go-winio`). Falls back to T3 if ConPTY unavailable.
- `pty_tmux.go` (optional, all platforms with tmux): `tmux new-session -d -s <id> "<cmd>"`. PTY bytes read via `tmux capture-pane -p`. External attach via `tmux attach -t <id>`.

**Selection logic at startup:**
1. If `--terminal tmux` and tmux binary exists → use tmux allocator (best: external attach, scrollback, window management).
2. Else on macOS/Linux → use `creack/pty` allocator.
3. Else on Windows → use ConPTY allocator.
4. Else → T3 fallback (no PTY, host.RunStreaming).

### 4.4 `internal/terminal/extract.go` — Multi-Strategy Extractor

This is the **most critical component** — it determines whether the fusion pipeline gets clean input. The extractor runs as a goroutine consuming the PTY byte stream and producing an `ExtractionResult`.

```go
type ExtractionResult struct {
    Answer      string    // the extracted answer text
    Confidence  float64   // 0.0 to 1.0
    Strategy    string    // "sentinel" | "ndjson" | "scrollback" | "process_exit"
    RawBytes    int       // total PTY bytes processed
    Duration    time.Duration
    Warnings    []string  // e.g., "sentinel not found, fell back to scrollback"
}

type Extractor struct {
    strategies  []ExtractionStrategy  // ordered by priority
    ringBuffer  *RingBuffer           // shared with session
    resultCh    chan ExtractionResult
    promptPreamble string             // sentinel instructions
}

type ExtractionStrategy interface {
    Name() string
    Process(chunk []byte) *ExtractionResult  // nil = not yet, non-nil = done
    Finalize() *ExtractionResult             // called on process exit
}
```

**Strategy chain (in priority order):**

#### Strategy 1: Sentinel Markers (T1 primary)

The prompt is wrapped with sentinel instructions:

```
You are participating in a fusion pipeline. Multiple AI agents are answering the same prompt.
After your complete answer, output these exact markers on their own lines:

===FUSION_ANSWER_START===
<your complete final answer here>
===FUSION_ANSWER_END===

Everything between the markers will be extracted as your answer. Put your reasoning
before the markers, and your final answer between them.
```

The extractor scans the PTY stream for `===FUSION_ANSWER_START===\n` ... `===FUSION_ANSWER_END===`, strips ANSI escapes from the content, and returns it.

**Confidence:** 0.85 if markers found and content is non-empty and > 50 chars. 0.6 if markers found but content is short. 0.0 if markers not found.

**Edge cases handled:**
- Model outputs markers inside a code block → search for the LAST occurrence of start/end markers (models sometimes echo the instructions).
- Model outputs only `START` without `END` → on process exit, take everything after `START`.
- Model outputs markers with extra whitespace/ANSI → regex with `\s*` and ANSI stripping.
- Model outputs markers in wrong order → ignore, take last valid `START...END` pair.

#### Strategy 2: NDJSON Parsing (T2 / T1 fallback for JSON-capable CLIs)

If the CLI emits NDJSON (detected by `{"type":` patterns), parse each line:
- Look for fields: `text`, `content`, `message`, `answer`, `response`.
- Accumulate text from `type: "message"` / `type: "result"` / `type: "completed"` events.
- Strip JSON-specific wrapper text.

**Confidence:** 0.95 if valid NDJSON with text fields. 0.7 if partial JSON.

**CLI-specific parsers** (reused from existing `extractThinking` in `opencode.go:238` and `codex.go:222`):
- opencode: `type: "message"` → `part.text`
- codex: `type: "reasoning_summary_text.done"` / `type: "message"` → `text`
- generic: any line matching `{"type":"...","text":"..."}` pattern

#### Strategy 3: Scrollback Scrape (T1 fallback)

If no sentinels and no JSON, take the ring buffer at process exit:
1. Strip all ANSI escape sequences (regex: `\x1b\[[0-9;]*[a-zA-Z]`, `\x1b\][^\x07]*\x07`, `\x1b[()][AB012]`).
2. Strip alternate-screen content (between `\x1b[?1049h` and `\x1b[?1049l`) if present — this removes full-screen TUI chrome.
3. Drop lines matching known TUI chrome patterns (status bars, spinners, progress indicators, box-drawing characters).
4. Collapse consecutive blank lines.
5. Return the remaining text.

**Confidence:** 0.4-0.6 depending on how much text remains after stripping. If < 100 chars remain, confidence = 0.2.

#### Strategy 4: Process Exit (final fallback)

If all strategies fail, return whatever text is in the ring buffer at process exit, stripped of ANSI. Mark confidence as 0.1-0.3.

**Extraction pipeline assembly:**

```
PTY byte stream
    │
    ├──▶ Strategy 1 (Sentinel) ──▶ if found: return (confidence ≥ 0.6)
    │                              if not found: continue
    │
    ├──▶ Strategy 2 (NDJSON)  ──▶ if JSON detected: return (confidence ≥ 0.7)
    │                              if no JSON: continue
    │
    ├──▶ Strategy 3 (Scrape)  ──▶ on process exit: return (confidence 0.2-0.6)
    │
    └──▶ Strategy 4 (Exit)    ──▶ always returns something (confidence 0.1-0.3)
```

**Critical rule:** The extractor NEVER returns an empty string if the PTY produced any output. Even at confidence 0.1, the judge gets *something* to work with. The judge prompt includes the confidence score so it can weight panel inputs accordingly.

### 4.5 `internal/terminal/pump.go` — Backpressure-Aware Byte Pump

The byte pump is the central goroutine that reads from the PTY and fans out to consumers. It must handle backpressure without blocking the PTY read (which would stall the CLI).

```go
func (s *Session) bytePump() {
    defer close(s.pumpDone)
    buf := make([]byte, 4096)

    for {
        n, err := s.ptyHandle.Read(buf)
        if n > 0 {
            chunk := make([]byte, n)
            copy(chunk, buf[:n])

            // 1. Write to ring buffer (non-blocking, drops oldest if full)
            s.ringBuffer.Write(chunk)

            // 2. Feed extractor (non-blocking, buffered channel)
            select {
            case s.extractor.input <- chunk:
            default:
                // extractor is slow — drop chunk to extraction
                // (ring buffer still has it for scrollback)
                s.metrics.extractorDrops.Inc()
            }

            // 3. Relay to subscribers (non-blocking per subscriber)
            s.relayMu.RLock()
            for sub := range s.relaySubs {
                select {
                case sub <- chunk:
                default:
                    // subscriber is slow — drop and mark
                    // (xterm.js will show a "buffering..." indicator)
                    s.metrics.relayDrops.Inc()
                    // If subscriber is too slow, unsubscribe it
                    if len(sub) > relayDropLimit {
                        close(sub)
                        delete(s.relaySubs, sub)
                    }
                }
            }
            s.relayMu.RUnlock()

            // 4. Health monitor (update last-output timestamp)
            s.lastOutput.Store(time.Now().UnixNano())
        }
        if err != nil {
            break  // PTY closed (process exited)
        }
    }

    // Process exited — finalize extraction
    s.extractor.Finalize()
}
```

**Key design decisions:**
- **Ring buffer is write-through, non-blocking.** If full, oldest bytes are evicted. This bounds memory at `MaxScrollbackBytes` (8MB default).
- **Extractor channel is buffered (capacity 256 chunks = ~1MB).** If the extractor is slow, chunks are dropped from the live extraction path but preserved in the ring buffer for scrollback scrape at finalization.
- **Relay subscribers get non-blocking sends.** A slow xterm.js client doesn't stall the PTY. After N consecutive drops, the subscriber is disconnected (it can re-attach and read from scrollback).
- **Health monitor** updates `lastOutput` on every read. A separate goroutine checks for stalls (see §4.7).

### 4.6 `internal/terminal/ringbuffer.go` — Bounded Scrollback

```go
type RingBuffer struct {
    mu   sync.Mutex
    data []byte
    size int          // total capacity
    pos  int          // write position
    full bool         // has wrapped?
}

func NewRingBuffer(size int) *RingBuffer

func (r *RingBuffer) Write(p []byte) (int, error)   // non-blocking, evicts oldest
func (r *RingBuffer) Bytes() []byte                  // returns full scrollback in order
func (r *RingBuffer) Tail(n int) []byte              // returns last n bytes
```

**Why a ring buffer, not an unbounded buffer:**
- A long-running opencode session can produce megabytes of ANSI output (tool calls, file reads, diffs). An unbounded buffer would OOM the runner.
- The ring buffer caps memory at a known limit (8MB default). When full, oldest bytes are evicted.
- The extractor reads from the live stream (not the ring buffer) during execution. The ring buffer is only read at finalization (for scrollback scrape) and for re-attachment (xterm.js initial render).

**Capacity sizing:**
- 8MB per session × 12 max sessions = 96MB max scrollback. Acceptable.
- At ~1KB/sec of terminal output, 8MB = ~2 hours of scrollback. More than enough for a single model run.

### 4.7 `internal/terminal/health.go` — Session Health Monitor

A goroutine per session that watches for stalled sessions:

```go
func (s *Session) healthMonitor() {
    ticker := time.NewTicker(5 * time.Second)
    defer ticker.Stop()

    for {
        select {
        case <-s.pumpDone:
            return  // session ended normally
        case <-ticker.C:
            last := time.Unix(0, s.lastOutput.Load())
            idle := time.Since(last)

            switch {
            case idle > 120*time.Second && s.state == Running:
                // Session is stalled — likely waiting for interactive input
                s.handleInteractiveStall()

            case idle > 60*time.Second && s.state == Running:
                // Session is idle — warn the UI
                s.emitWarning("session idle for 60s, may be waiting for input")

            case time.Now().After(s.deadline):
                // Timeout — kill the session
                s.Kill()
                s.emitWarning("session killed: timeout exceeded")
                return
            }
        }
    }
}

func (s *Session) handleInteractiveStall() {
    // 1. Check if the PTY's last output looks like a prompt
    //    (ends with ": ", "? [y/n]", ">", "#", "$")
    tail := s.ringBuffer.Tail(256)
    if looksLikePrompt(tail) {
        s.emitWarning("session appears to be waiting for interactive input")
        // 2. Emit an approval.requested event (events.ts:27)
        // 3. UI shows a notification: "opencode is waiting for approval — click to interact"
    }
}
```

**This solves Mistake 7 from the R&D doc** (CLIs that hang waiting for input). Instead of silently hanging, the system detects the stall, notifies the UI, and lets the user interact with the terminal to unblock it.

### 4.8 `internal/terminal/relay.go` — Cloud and WebSocket Relay

Two relay modes:

**Local UI relay (WebSocket):**
```
xterm.js ──WS──▶ /api/sessions/:id/stream ──▶ Session.Subscribe()
                                                 │
                                                 ▼
                                            PTY byte stream
```

- `GET /api/sessions/:id/stream` — WebSocket upgrade, subscribes to live PTY bytes.
- `POST /api/sessions/:id/input` — sends keystrokes from xterm.js back to PTY.
- `POST /api/sessions/:id/resize` — terminal resize (rows, cols) → `ptyHandle.SetSize()`.

**Cloud relay (existing event system):**
```
Session ──▶ panel.terminal.delta ──▶ FusionRunDO WebSocket ──▶ Browser
              (bytes + sessionId)
```

- PTY bytes are base64-encoded and sent as `panel.terminal.delta` events.
- **Lazy relay:** bytes are only sent to the cloud when a client is actively watching the terminal trace. When no client is subscribed to the run's WebSocket, the relay pauses (saves bandwidth).
- **Adaptive compression:** if byte rate > 50KB/s, switch to `permessage-deflate` compression on the WebSocket.
- **Frame throttling:** batch PTY bytes into 50ms windows before sending as events (reduces event volume by ~10x).

### 4.9 `internal/adapters/terminal/terminal.go` — Generic Terminal Adapter

A single adapter that implements `TerminalAdapter` for **any** catalogued CLI:

```go
type GenericTerminalAdapter struct {
    agentDef  localagents.AgentDef
    roots     []string
    toolDirs  []string
}

func (a *GenericTerminalAdapter) ID() string { return a.agentDef.ID }

func (a *GenericTerminalAdapter) SessionSpec(input adapters.RunInput) (TerminalSessionSpec, error) {
    spec := TerminalSessionSpec{
        Binary:     a.agentDef.Binary,
        WorkingDir: input.WorkspacePath,
        Model:      input.Model,
        TimeoutMs:  input.TimeoutMs,
        Env:        input.Env,
    }

    // Apply terminal hints from the catalog
    hint := a.agentDef.TerminalSpec
    spec.PromptMode = hint.PromptMode
    spec.PromptFlag = hint.PromptFlag
    spec.OutputMode = hint.OutputMode

    // Build args based on tier
    switch hint.DefaultTier {
    case TierT2JSONInPTY:
        spec.Args = hint.JSONRunArgs  // e.g., ["run","--format","json","-"]
        spec.PromptMode = PromptModeStdin
    case TierT1Native:
        spec.Args = []string{}  // native interactive
        if input.Model != "" && hint.ModelFlag != "" {
            spec.Args = append(spec.Args, hint.ModelFlag, input.Model)
        }
    }

    return spec, nil
}
```

**This is the component that makes all 23 agents executable.** The catalog provides the hints; the generic adapter builds the spec; the SessionManager runs it. No per-CLI Go code.

### 4.10 Catalog Hints (`localagents/catalog.go`)

Add a `TerminalSpec` to each of the 23 `AgentDef` entries:

```go
type TerminalSpecHint struct {
    PromptMode    PromptMode    // keystrokes | flag | stdin
    PromptFlag    string        // "-p" | "--prompt" | ""
    ModelFlag     string        // "--model" | "-m" | ""
    OutputMode    OutputMode    // native | json | plain
    DefaultTier   ExecutionTier // T1 | T2 | T3
    JSONRunArgs   []string      // args for T2 mode, e.g., ["run","--format","json","-"]
    ChromePatterns []string     // regex patterns for TUI chrome stripping (T1 fallback)
}
```

**Catalog entries (examples):**

| Agent | PromptMode | PromptFlag | ModelFlag | DefaultTier | JSONRunArgs |
|---|---|---|---|---|---|
| opencode | stdin | - | --model | T2 (cloud) / T1 (local) | `["run","--format","json","-"]` |
| codex | stdin | - | --model | T2 (cloud) / T1 (local) | `["exec","--json","--skip-git-repo-check","--sandbox","workspace-write","-"]` |
| pi | flag | -p | --model | T1 | `[]` |
| claude | keystrokes | - | --model | T1 | `[]` |
| gemini | keystrokes | - | --model | T1 | `[]` |
| aider | flag | --message | --model | T1 | `["--no-auto-commits"]` |
| copilot | keystrokes | - | - | T1 | `[]` |
| deepseek | keystrokes | - | --model | T1 | `[]` |
| qwen | keystrokes | - | --model | T1 | `[]` |
| (all others) | keystrokes | - | --model | T1 | `[]` |

**Default for unknown agents:** `PromptMode: keystrokes, OutputMode: native, DefaultTier: T1`. This means any new CLI detected on the system can immediately run in a terminal with zero code changes.

---

## 5. Data Flow Architecture

### 5.1 Local UI Run (T1 — Native PTY)

```
User enters prompt in UI
    │
    ▼
POST /api/fuse
    │
    ▼
fusion.Execute (runner.go:84)
    │
    ├──▶ For each panel model (parallel, per-adapter semaphore):
    │    │
    │    ▼
    │    runSelectedModel (runner.go:272)
    │    │
    │    ▼
    │    GenericTerminalAdapter.SessionSpec(input)
    │    │
    │    ▼
    │    SessionManager.Create(spec)
    │    │
    │    │   ├── ptyAlloc.Start(cmd)          ← REAL PTY allocated
    │    │   ├── cmd.Start()                   ← CLI launched in native mode
    │    │   ├── go bytePump()                 ← reads PTY bytes
    │    │   ├── go healthMonitor()            ← watches for stalls
    │    │   └── extractor.Run()               ← scans for answer
    │    │
    │    ▼
    │    Session created → return session ID to fusion
    │    │
    │    ▼
    │    fusion emits panel.terminal.delta with sessionId
    │    │
    │    ▼
    │    UI opens xterm.js per sessionId
    │    │
    │    ▼
    │    xterm.js ←WS→ /api/sessions/:id/stream ← Session.Subscribe()
    │    │                                            │
    │    │                                     PTY bytes flow live
    │    │                                     User sees real TUI
    │    │                                     User can type (approvals, follow-up)
    │    │
    │    ▼
    │    Session.Wait() ← blocks until extraction complete
    │    │
    │    ▼
    │    ExtractionResult { Answer, Confidence, Strategy }
    │    │
    │    ▼
    │    ModelOutput { OutputText: result.Answer, Confidence: result.Confidence }
    │
    ├──▶ wg.Wait() ← all panel sessions done
    │
    ▼
    Judge.Run(panel[].OutputText + panel[].Confidence)
    │
    ▼
    Final synthesis
    │
    ▼
    Result returned to UI
```

### 5.2 Cloud-Dispatched Run (T2 — JSON-in-PTY)

```
Cloud dispatches job → executeCloudJob (main.go:289)
    │
    ▼
For each panel model:
    │
    ▼
    SessionManager.Create(spec) with T2 tier
    │
    │   ├── PTY allocated (real terminal)
    │   ├── CLI launched with --format json (inside PTY)
    │   ├── byte pump reads NDJSON from PTY
    │   └── NDJSON extractor parses answer
    │
    ▼
    PTY bytes → panel.terminal.delta (base64, lazy relay)
    │   (only relayed when user opens the trace in browser)
    │
    ▼
    Extraction complete → OutputText
    │
    ▼
    POST panel.output.delta to cloud
```

### 5.3 Headless CI Run (T3 — Current Fallback)

```
fusion.Execute with --headless flag
    │
    ▼
For each panel model:
    │
    ▼
    adapter.Run(ctx, input, emit)  ← existing path
    │
    ▼
    host.RunStreaming (pipes, no PTY)
    │
    ▼
    Buffer capture → OutputText
```

No change from current behavior. T3 keeps `--dangerously-skip-permissions` for headless CI only.

---

## 6. Scalability Analysis

### 6.1 Agent Scalability (O(1) per new agent)

| Metric | Current (T3) | Hybrid Architecture |
|---|---|---|
| Code to add a new agent | ~150 lines (full `Run()` + parser) | ~5 lines (catalog hint) |
| Time to add a new agent | ~4 hours (implement + test) | ~5 minutes (catalog entry) |
| Max agents supported | Unlimited in theory, but 21 of 23 have no code | ALL (generic adapter) |
| Marginal cost of agent N | O(N) Go code | O(1) (catalog entry only) |

**The generic terminal adapter makes agent addition a declarative catalog change, not a code change.** This is the single biggest scalability improvement.

### 6.2 Session Scalability (Concurrent Sessions)

| Resource | Per Session | 12 Sessions (max) | Limit |
|---|---|---|---|
| Memory (ring buffer) | 8 MB | 96 MB | 256 MB budget |
| Memory (process) | ~50-200 MB (varies by CLI) | ~600 MB-2.4 GB | System dependent |
| File descriptors | ~5 (PTY master/slave, pipes, etc.) | ~60 | ulimit (usually 256-1024) |
| Goroutines | ~4 (pump, health, extractor, relay) | ~48 | Negligible |
| CPU (idle) | ~0% | ~0% | N/A |
| CPU (active) | ~1-3% (extraction + relay) | ~12-36% | Burst acceptable |

**Bottleneck: process memory, not our infrastructure.** Each CLI (opencode, codex, etc.) is a full application that may use 100-200MB. Running 12 in parallel requires ~2.4GB of system memory. This is the real constraint, not the Go runner.

**Mitigation:**
- `MaxConcurrentSessions` defaults to 12 but is configurable.
- The per-adapter semaphore (`runner.go:144`) already serializes same-adapter runs (one opencode session at a time).
- Different adapters run in parallel (opencode + codex + pi simultaneously).
- If system memory is low, reduce `MaxConcurrentSessions` or use T2/T3 (lighter weight).

### 6.3 Horizontal Scalability (Multiple Runners)

The architecture supports multiple runners:
- Each runner has its own `SessionManager` with its own sessions.
- The cloud control plane dispatches jobs to runners (existing architecture).
- Sessions are local to a runner (PTYs can't be migrated between machines).
- If a runner dies, its sessions die too — but the extracted answers are already posted to the cloud (or the job is retried on another runner).

**This is acceptable because sessions are ephemeral** (one per model run, killed after extraction). There's no need for session migration or distributed PTY — that would be over-engineering.

### 6.4 Cloud Relay Scalability

| Scenario | Bandwidth | Mitigation |
|---|---|---|
| 1 user watching 1 terminal (T1) | ~5-20 KB/s | Direct WS, no issue |
| 1 user watching 5 terminals (T1) | ~25-100 KB/s | Acceptable |
| 10 users watching 10 terminals (cloud) | ~500 KB/s-2 MB/s | Lazy relay + compression |
| 50 users watching 50 terminals | ~2.5-10 MB/s | **Problem** — see below |

**At 50+ concurrent terminal viewers, the cloud relay becomes a bottleneck.** Mitigations:
1. **Lazy relay** — only relay when a user has the terminal open. Most users view the final answer, not the live terminal.
2. **T2 for cloud** — JSON-in-PTY produces less output than native TUI. Default cloud runs to T2.
3. **T3 for cloud (answer-only)** — for high-scale cloud runs, use T3 (headless capture) and only send `panel.output.delta` with the extracted answer. No terminal relay at all.
4. **Regional runners** — dispatch jobs to runners geographically close to the user (reduces relay latency).

**Realistic scale assessment:** openFusion is a developer tool (not a consumer product). Peak concurrent usage is likely 10-50 developers. The architecture handles this comfortably. If it ever needs to scale to hundreds of concurrent terminal viewers, T3 (answer-only) mode is the escape hatch.

---

## 7. Efficiency Analysis

### 7.1 Latency Breakdown (T1 Local Run)

| Phase | Time | Notes |
|---|---|---|
| Session creation (PTY alloc + exec) | ~5-15 ms | `pty.Start()` is fast |
| CLI startup (auth, model load) | ~1-5 s | CLI-dependent, not our code |
| Prompt delivery (keystrokes) | ~1 ms | `pty.Write(prompt + "\n")` |
| Agent execution | ~10-120 s | Model working (out of our control) |
| Answer extraction (sentinel) | ~1 ms | Regex scan on final chunk |
| Answer extraction (scrollback) | ~5-50 ms | Ring buffer scan + ANSI strip |
| Relay to UI (per frame) | ~1-5 ms | 50ms batched, WS send |
| Total overhead (our code) | ~20-70 ms | vs. 10-120s agent time |

**Our overhead is < 0.1% of total run time.** The dominant cost is the CLI's own execution (model inference, tool calls, file operations). We are not the bottleneck.

### 7.2 Memory Efficiency

| Component | Memory | Bounded? |
|---|---|---|
| Ring buffer per session | 8 MB | Yes (ring, evicts oldest) |
| Extractor input channel | ~1 MB (256 × 4KB) | Yes (drops on full) |
| Relay subscriber channels | ~256 KB per subscriber | Yes (drops + disconnects on full) |
| Process (CLI itself) | ~50-200 MB | NO (CLI's own memory) |
| Total runner overhead per session | ~9.3 MB | Yes |

**The runner's memory overhead is ~9.3 MB per session, fully bounded.** The CLI process memory is unbounded but out of our control. If a CLI leaks memory, the session timeout (10 min default) kills it.

### 7.3 CPU Efficiency

| Operation | CPU Cost | Frequency |
|---|---|---|
| Byte pump (PTY read + fan-out) | ~0.1% per 1KB/s | Continuous |
| ANSI stripping (extraction finalization) | ~1-5 ms per 8MB | Once per session |
| Regex scan (sentinel detection) | ~0.01 ms per 4KB chunk | Per chunk |
| Ring buffer write | ~0.001 ms per 4KB | Per chunk |
| WS relay (base64 + send) | ~0.05 ms per 4KB | Per chunk (when subscribed) |

**Total CPU overhead: ~1-3% per active session.** With 12 sessions, ~12-36% of one CPU core. Negligible on modern hardware.

### 7.4 Network Efficiency (Cloud Relay)

| Mode | Bytes/sec | Notes |
|---|---|---|
| T1 with active subscriber | ~5-20 KB/s | Raw PTY bytes, base64-encoded |
| T1 with compression | ~2-8 KB/s | 60% compression on ANSI text |
| T1 without subscriber | 0 KB/s | Lazy relay — no bytes sent |
| T2 (JSON-in-PTY) | ~1-5 KB/s | Less verbose than TUI |
| T3 (answer only) | ~0 KB/s during run, ~2-20 KB at end | Just the extracted answer |

**T1 with lazy relay is efficient enough for normal usage.** The 50ms frame batching reduces event volume by ~10x (from ~100 events/sec to ~20 events/sec for a 5KB/s stream).

### 7.5 Comparison: Current vs Hybrid

| Metric | Current (T3) | Hybrid (T1+T2) | Improvement |
|---|---|---|---|
| Agents executable | 2 / 23 | 23 / 23 | 11.5x |
| User experience | Log viewer | Real terminal | Qualitative leap |
| Per-agent code | ~150 lines | ~5 lines | 30x reduction |
| Interactive approvals | No (skip-permissions) | Yes | Security improvement |
| Multi-turn sessions | No | Yes (T1) | New capability |
| Memory per session | ~0.5-2 MB | ~9.3 MB | 4-18x more (acceptable) |
| CPU per session | ~0.5% | ~1-3% | 2-6x more (negligible) |
| Extraction reliability | ~95% (buffer) | ~90% (multi-strategy) | Slightly lower but acceptable |

**The memory and CPU increase is negligible compared to the agent's own resource usage.** A 9.3 MB overhead on a 200 MB CLI process is 4.6%.

---

## 8. Worst-Case Real-World Scenarios (10 Deep Dives)

### 8.1 Scenario: Model Ignores Sentinel Markers

**What happens:** The model (e.g., a weaker model running via `pi` or `aider`) doesn't output `===FUSION_ANSWER_START===` / `===FUSION_ANSWER_END===` markers. It just answers the prompt directly in its TUI.

**Impact:** Strategy 1 (sentinel) fails. The extractor falls through to Strategy 3 (scrollback scrape). The scraped text includes TUI chrome, tool call logs, and the answer mixed together. The judge receives noisy input with confidence ~0.4.

**Cascading failure:** The judge, seeing low-confidence input, may produce a poor synthesis. The final answer is degraded.

**Mitigation architecture:**
1. **Extraction confidence threshold:** If confidence < 0.5, the fusion pipeline marks the panel output as `low_confidence: true` in the judge prompt. The judge weights it lower.
2. **Auto-escalation to T2:** If the CLI supports JSON mode (per catalog hint), the system can optionally re-run with T2 for reliable extraction. This costs an extra run but only triggers on T1 failure.
3. **Prompt engineering:** The sentinel preamble is strong and explicit. Testing across models during implementation will reveal which models comply. For non-compliant models, default them to T2 or add a CLI-specific extraction pattern (e.g., "last code block in the output" for `aider`).
4. **Human review fallback:** If confidence < 0.3 and T2 is not available, the UI shows a "manual review needed" indicator on that panel's terminal. The user can read the terminal and manually approve the answer.

**Likelihood:** Medium (~30% of models may not comply with sentinels on first try). Fixable with prompt tuning and per-model catalog overrides.

**Severity:** Medium. Degrades fusion quality but doesn't crash.

---

### 8.2 Scenario: CLI Hangs Waiting for Interactive Input

**What happens:** `opencode` launches in native mode, displays its TUI, and waits for the user to select a model from a menu. Or `claude` waits for terms-of-service acceptance. Or `codex` waits for an approval prompt on a file write.

**Impact:** The session produces no output for 60+ seconds. The byte pump reads nothing. The health monitor detects the stall. The session hangs indefinitely (until timeout).

**Cascading failure:** `wg.Wait()` in `fusion.Execute` blocks. The entire pipeline is stuck waiting for one panel model. The judge never runs. The user sees a frozen UI with one terminal showing a prompt and no progress.

**Mitigation architecture:**
1. **Health monitor (§4.7):** Detects the stall after 60 seconds. Emits a warning. After 120 seconds, checks if the terminal output looks like a prompt (regex: ends with `: `, `? [y/n]`, `>`, `#`, `$`, `Select`, `Choose`).
2. **UI notification:** The UI shows a banner: "Session `opencode/claude-sonnet-4` is waiting for input. Click to interact." The user can click, the xterm.js terminal gains focus, and the user types their response (model selection, approval, etc.).
3. **Prompt delivery via flag:** For CLIs that accept `--model X` and `--prompt "..."` (or `-p`), pass these as CLI args instead of interactive keystrokes. This skips model selection menus and ToS prompts entirely. The catalog hint `PromptMode: flag, PromptFlag: "-p"` handles this.
4. **Auto-approval for known prompts:** For known approval prompts (e.g., opencode's "Allow file write? [y/n]"), the system can auto-send "y" if the permission profile allows. This is configurable per `PermissionProfile`.
5. **Timeout:** If the stall persists beyond `MaxSessionDuration` (10 min default), the session is killed and marked as failed. The pipeline continues with the remaining panels (existing logic at `runner.go:178` handles `successfulPanel` filtering).

**Likelihood:** High — this WILL happen on the first run of many CLIs in native mode. It's the expected behavior for interactive TUIs.

**Severity:** High if not mitigated (pipeline hangs). Low with mitigation (user interacts, or timeout kills it).

**Critical implementation note:** The prompt delivery method matters enormously. If we use `--model X` and `--prompt "..."` flags, we bypass most interactive menus. If we use keystrokes, we must handle the interactive prompts. **Default to flag-based prompt delivery wherever the CLI supports it.** Use keystrokes only for CLIs without a prompt flag.

---

### 8.3 Scenario: PTY Buffer Overflow / Backpressure

**What happens:** A CLI produces output very fast (e.g., `opencode` dumps a large file's contents as part of a tool call). The PTY read buffer fills. The byte pump reads 4KB chunks, but the xterm.js WebSocket client is slow to consume (user's network is laggy).

**Impact without backpressure handling:** The byte pump blocks on the WebSocket send. The PTY read stalls. The CLI's `write()` to stdout blocks (PTY buffer full). The CLI effectively pauses — it thinks the terminal is slow. This actually works (flow control), but it means the CLI slows down to match the slowest subscriber's network speed.

**Impact with our non-blocking relay (§4.5):** The byte pump drops chunks to the slow subscriber (after N consecutive drops, disconnects the subscriber). The CLI continues at full speed. The subscriber sees gaps in the terminal output. The ring buffer retains the full output for scrollback. The subscriber can re-attach and see the scrollback.

**Cascading failure:** The disconnected subscriber's xterm.js shows a "connection lost, reattaching..." message. On re-attach, it receives the ring buffer scrollback (up to 8MB) and then the live stream. This is correct behavior.

**Mitigation architecture:**
1. **Non-blocking sends (§4.5):** Relay subscribers never block the byte pump.
2. **Drop counter:** Metrics track relay drops. If drops are high, the UI can suggest "terminal output is being throttled — try closing other terminals."
3. **Ring buffer as safety net:** Even if a subscriber is disconnected, the ring buffer retains the scrollback for re-attachment.
4. **Frame batching:** 50ms batching reduces the number of WS sends by ~10x, reducing per-send overhead.

**Likelihood:** Medium (happens on slow networks or when a CLI produces very fast output).

**Severity:** Low (ring buffer + re-attach mechanism handles it gracefully).

---

### 8.4 Scenario: CLI Process Crash / Non-Zero Exit

**What happens:** The CLI crashes (segfault, panic, OOM kill, auth failure, rate limit). The process exits with a non-zero code. The PTY closes. The byte pump reads `EOF`.

**Impact:** The session ends. The extractor's `Finalize()` is called. It returns whatever it has in the ring buffer (possibly partial output, possibly just an error message). The `ExtractionResult` has low confidence.

**Cascading failure:** The panel model's `OutputText` may be empty or contain an error message. The `successfulPanel` filter (`runner.go:174`) excludes it if `OutputText` is empty. If ALL panels fail, the run fails (`runner.go:178-187`). If some succeed, the judge runs on the successful ones.

**Mitigation architecture:**
1. **Exit code capture:** The session records the exit code. If non-zero, the `ExtractionResult.Warnings` includes `"process exited with code N"`.
2. **Error detection:** The extractor's scrollback scrape checks the last few lines for known error patterns (`"error"`, `"panic"`, `"fatal"`, `"unauthorized"`, `"rate limit"`, `"quota exceeded"`). If found, the `OutputText` is set to the error message and confidence is 0.0.
3. **Retry logic:** The fusion pipeline can optionally retry a failed panel model (configurable: `MaxRetries: 1`). The retry creates a new session (fresh PTY, fresh CLI launch).
4. **Partial answer preservation:** If the CLI produced some output before crashing, the extractor returns it. The judge prompt includes `"This model crashed during execution. Partial output:"` so the judge can still use whatever the model produced before the crash.

**Likelihood:** Medium-high (CLIs crash, auth tokens expire, rate limits hit).

**Severity:** Medium (one panel fails, pipeline continues with others). High if all panels fail simultaneously (e.g., auth token expired for all agents of the same provider).

---

### 8.5 Scenario: Auth Token / Rate Limit Contention

**What happens:** The user selects 5 panel models, all backed by the same provider (e.g., 5 different agents that all use Anthropic Claude under the hood). All 5 sessions start simultaneously. They all use the same auth token (the user's Claude subscription). The provider rate-limits them.

**Impact:** Some sessions get rate-limited (HTTP 429), producing error output. Others succeed. The fusion pipeline gets a mix of successful and failed panel outputs.

**Cascading failure:** If the rate limit is strict, all 5 sessions fail. The entire run fails (`runner.go:178-187`).

**Mitigation architecture:**
1. **Per-adapter semaphore (existing, `runner.go:144-150`):** Serializes same-adapter runs. But different adapters using the same provider (e.g., `opencode` with Claude and `aider` with Claude) are NOT serialized — they use different adapters.
2. **Provider-aware scheduling (new):** The SessionManager can track which provider each session uses (from the catalog's `Provider` field, `catalog.go:28`). A per-provider semaphore serializes sessions using the same provider, even across different adapters. This prevents rate limit contention.
3. **Exponential backoff retry:** If a session fails with a rate-limit error, retry with exponential backoff (1s, 2s, 4s). Limited to 2 retries.
4. **UI warning:** If the user selects multiple models from the same provider, the UI warns: "5 models use Anthropic — you may hit rate limits. Consider diversifying providers."

**Likelihood:** Medium (happens when users select many same-provider models).

**Severity:** Medium (degrades run quality, doesn't crash).

---

### 8.6 Scenario: Zombie / Orphan Processes

**What happens:** The runner kills a session (timeout, cancel, shutdown). `cmd.Process.Kill()` sends SIGKILL to the direct child process. But the CLI may have spawned child processes (e.g., `opencode` spawns `node`, which spawns a language server). These grandchildren survive as orphans.

**Impact:** Orphaned processes accumulate. They hold file descriptors, memory, and possibly locks. Over time (many runs), the system runs out of resources.

**Cascading failure:** System resource exhaustion. The runner can't allocate new PTYs. New sessions fail.

**Mitigation architecture:**
1. **Process groups:** Launch the CLI in its own process group: `cmd.SysProcAttr = &syscall.SysProcAttr{Setpgid: true}`. Then kill the entire group: `syscall.Kill(-pgid, syscall.SIGKILL)`. This kills the CLI and all its children.
2. **`pty.Close()`:** The `creack/pty` library's `Close()` sends SIGHUP to the process group, which terminates most child processes.
3. **Cleanup goroutine:** On session kill, a goroutine waits for the process to exit (with a 5-second grace period). If it hasn't exited, SIGKILL the process group.
4. **Runner shutdown hook:** `KillAll()` is registered with `signal.Notify(SIGINT, SIGTERM)`. On runner shutdown, all sessions are killed cleanly.
5. **Reaper (Linux):** On Linux, the runner can use `prctl(PR_SET_CHILD_SUBREAPER)` to become a subreaper, receiving SIGCHLD for orphaned grandchildren. This allows cleanup of any orphans that escape process group kill.

**Likelihood:** High (CLIs spawn child processes regularly).

**Severity:** Medium (slow accumulation, doesn't crash immediately but degrades over time).

**Critical:** This must be implemented correctly from day one. Process group kill (`Setpgid: true` + `kill(-pgid, SIGKILL)`) is the standard, reliable approach.

---

### 8.7 Scenario: Windows ConPTY Unreliability

**What happens:** On Windows, `creack/pty` doesn't work (it's Unix-only). We use Windows ConPTY (`CreatePseudoConsole`). ConPTY has known issues:
- Terminal resize race conditions
- Incomplete ANSI sequence handling
- Occasional deadlocks on large output
- No `tmux` available for external terminal attach

**Impact:** Windows users get a degraded terminal experience. Sessions may hang or produce garbled output. Extraction fails more often (ANSI sequences not properly handled by ConPTY).

**Cascading failure:** Extraction confidence is lower on Windows. The fusion pipeline gets lower-quality panel inputs. If ConPTY deadlocks, the session hangs forever (until timeout).

**Mitigation architecture:**
1. **Platform detection at startup:** `pty_windows.go` (build tag `windows`) uses ConPTY. `pty_unix.go` (build tag `!windows`) uses `creack/pty`. The correct implementation is compiled in automatically.
2. **ConPTY availability check:** At startup, the runner tests ConPTY by allocating a dummy PTY and writing/reading a test string. If it fails, fall back to T3 (headless capture) for all Windows sessions.
3. **WSL2 as recommended path:** On Windows, the runner can detect WSL2 and use the Unix PTY path inside WSL. This is the most reliable Windows experience. The runner can optionally launch CLIs inside WSL: `wsl -e bash -c "opencode ..."`.
4. **T3 default for Windows cloud jobs:** Cloud-dispatched jobs on Windows runners default to T3 (headless capture). No PTY needed, reliable extraction, lower risk.
5. **xterm.js rendering:** xterm.js is a full terminal emulator in the browser. It handles ANSI correctly regardless of what ConPTY does. The rendering layer is not affected by ConPTY issues — only the PTY byte stream quality is affected.

**Likelihood:** High on Windows (ConPTY is finicky). Low on macOS/Linux (`creack/pty` is mature).

**Severity:** Medium on Windows (degraded experience, not a crash). Low on macOS/Linux.

**Recommendation:** Support Windows but don't optimize for it. The primary development/usage platform for openFusion is macOS/Linux (developer machines). Windows users get T2/T3 with ConPTY as a best-effort T1.

---

### 8.8 Scenario: Terminal Injection / ANSI Security Attack

**What happens:** A malicious model (or a model processing malicious user input) outputs ANSI escape sequences designed to exploit xterm.js or the terminal:
- **OSC 52:** clipboard injection (`\x1b]52;c;base64,PAYLOAD\x07` — writes to the user's clipboard)
- **Title bar manipulation:** `\x1b]0;FAKE TITLE\x07`
- **Fake prompts:** ANSI sequences that make the terminal look like it's asking for a password
- **Buffer overflow attempts:** extremely long escape sequences

**Impact:** The user's clipboard is hijacked, or the user is tricked into entering credentials into a fake prompt rendered by the model's output.

**Cascading failure:** This is a security vulnerability, not a functional one. But if exploited, it could lead to credential theft.

**Mitigation architecture:**
1. **xterm.js sanitization:** xterm.js has built-in protection against most ANSI injection attacks. Ensure xterm.js is configured to disable OSC 52 clipboard writes: `new Terminal({ allowProposedApi: false })` and custom addon filtering.
2. **PTY output filtering (optional):** The relay layer can optionally strip dangerous ANSI sequences:
   - Strip OSC 52 sequences (`\x1b]52;[^\x07\x1b]*\x07`)
   - Strip OSC 0/2 title sequences (or replace with sanitized text)
   - Allow SGR (colors), cursor movement, and screen modes (safe)
3. **Input validation:** User keystrokes sent to the PTY via `/api/sessions/:id/input` are validated (max length, no control characters except standard terminal input).
4. **Sandboxing:** The CLI runs in the user's workspace directory (validated by `validateWorkingDir`, `host.go:181`). It has the same permissions as the user. This is the existing security model — we're not making it worse.
5. **Security note in UI:** The terminal displays a warning when a model outputs clipboard or title-bar sequences.

**Likelihood:** Low (requires a malicious model or adversarial input). But openFusion runs multiple AI agents that process untrusted user prompts — the attack surface is real.

**Severity:** High if exploited (credential theft). Low likelihood, high impact = medium risk.

**Recommendation:** Disable OSC 52 in xterm.js by default. Strip OSC sequences in the relay filter. This is a 10-line change with high security value.

---

### 8.9 Scenario: CLI Update Breaks Extraction

**What happens:** `opencode-cli` updates and its NDJSON schema changes (e.g., `type: "message"` becomes `type: "assistant_message"`). Or the TUI layout changes, breaking the scrollback chrome patterns. Or a new flag replaces `--format json`.

**Impact:** The NDJSON extractor (Strategy 2) fails to find text fields. The scrollback scrape (Strategy 3) returns noisy output. Extraction confidence drops.

**Cascading failure:** The fusion pipeline gets degraded panel inputs. The judge may produce poor synthesis. The user notices quality degradation over time as CLIs update.

**Mitigation architecture:**
1. **Version detection:** At session creation, the runner checks the CLI version (`agentDef.VersionArgs`, e.g., `opencode-cli --version`). The version is stored with the session. If the version doesn't match the expected schema, a warning is emitted.
2. **Schema-tolerant parsing:** The NDJSON extractor doesn't hardcode field names. It uses a priority list: try `text`, then `content`, then `message`, then `answer`, then `response`. It looks for these fields on any JSON object with a `type` field containing `message`, `result`, `completed`, or `final`. This is resilient to schema changes.
3. **Sentinel markers as primary:** T1's sentinel markers don't depend on the CLI's internal schema. As long as the model outputs the markers (which is in the prompt, not the CLI's code), extraction works. This is why T1+sentinels is more resilient to CLI updates than T2+JSON.
4. **Integration tests:** The test suite includes integration tests that run a simple prompt through each supported CLI and verify extraction. Run these tests in CI with the latest CLI versions. If a CLI update breaks extraction, the test fails before users are affected.
5. **Extraction confidence scoring:** If confidence drops below 0.5 for a CLI that usually scores 0.9, the system logs a warning: "opencode extraction confidence dropped — CLI may have updated." This is an early warning signal.

**Likelihood:** Medium (CLIs update regularly).

**Severity:** Medium (gradual quality degradation, not a crash).

**Key insight:** This is actually an argument FOR T1 (sentinels) over T2 (JSON). Sentinels depend on the model's behavior (prompt compliance), which is stable. JSON schemas depend on the CLI's code, which changes. **T1 is more future-proof than T2.**

---

### 8.10 Scenario: Session Manager Crash / Runner Restart

**What happens:** The runner process crashes (panic, OOM, SIGKILL) while sessions are active. All PTYs are closed. All CLI processes are killed (or orphaned — see §8.6). All in-memory session state is lost.

**Impact:** All active runs fail. The cloud control plane marks the jobs as failed (existing retry logic handles this). Sessions cannot be re-attached (they're gone).

**Cascading failure:** If the runner was in the middle of a fusion run (panel sessions active, `wg.Wait()` pending), the run fails. The user sees an error. If the runner was serving the local UI, all xterm.js terminals disconnect.

**Mitigation architecture:**
1. **Existing retry:** The cloud control plane already retries failed jobs on other runners. This is the primary recovery mechanism.
2. **Session state to disk (optional):** The SessionManager can optionally persist session metadata (not full PTY streams — too large) to disk: `~/.openfusion/sessions/<id>.json`. On restart, the manager loads this and marks sessions as `failed: runner_restart`. The UI shows "session lost due to runner restart."
3. **Graceful shutdown:** On SIGTERM/SIGINT, the runner calls `SessionManager.KillAll()` which kills all sessions cleanly (process group kill, PTY close). This prevents orphans.
4. **No session recovery:** We do NOT attempt to recover sessions after a crash. PTYs are kernel objects tied to the process — they can't be migrated or re-attached after the parent process dies. This is a fundamental limitation of PTYs. The only recovery is retry (re-run the job).

**Likelihood:** Low (runner crashes are rare — it's a simple Go process with no complex state).

**Severity:** Medium (active runs fail, but retry handles it).

**Key decision:** Do NOT invest in session persistence/migration. It's not possible with PTYs, and the retry mechanism is sufficient. Sessions are ephemeral by design.

---

## 9. Risk Mitigation Architecture

### 9.1 Risk Matrix

| Risk | Likelihood | Impact | Risk Score | Mitigation | Residual Risk |
|---|---|---|---|---|---|
| Model ignores sentinels | Medium | Medium | **Medium** | Multi-strategy extraction + T2 fallback + prompt tuning | Low |
| CLI hangs on interactive input | High | High | **High** | Health monitor + UI notification + flag-based prompt + timeout | Low |
| PTY buffer overflow | Medium | Low | **Low** | Non-blocking relay + ring buffer + subscriber disconnect | Very Low |
| CLI crash / non-zero exit | Medium-High | Medium | **Medium** | Exit code capture + error detection + retry + partial answer | Low |
| Auth/rate limit contention | Medium | Medium | **Medium** | Provider-aware semaphore + backoff retry + UI warning | Low |
| Zombie processes | High | Medium | **Medium-High** | Process groups + `Setpgid` + group kill + cleanup goroutine | Very Low |
| Windows ConPTY issues | High (Win) | Medium | **Medium** | Platform detection + WSL2 path + T3 fallback | Low |
| Terminal injection attack | Low | High | **Medium** | xterm.js OSC 52 disable + PTY output filter + input validation | Very Low |
| CLI update breaks extraction | Medium | Medium | **Medium** | Version detection + schema-tolerant parsing + sentinel primary + integration tests | Low |
| Runner crash | Low | Medium | **Low-Medium** | Existing retry + graceful shutdown + no session recovery | Low |

### 9.2 Defense in Depth

The architecture uses **defense in depth** — multiple layers of protection for each risk:

```
┌─────────────────────────────────────────────────────────┐
│ Layer 1: Prevention (catalog hints, prompt engineering)  │
│   - Flag-based prompt delivery avoids interactive menus  │
│   - Sentinel preamble is strong and explicit              │
│   - Per-CLI catalog hints specify the best tier           │
├─────────────────────────────────────────────────────────┤
│ Layer 2: Detection (health monitor, metrics)             │
│   - Stall detection at 60s / 120s                         │
│   - Extraction confidence scoring                         │
│   - Version mismatch warnings                              │
│   - Process crash detection                                │
├─────────────────────────────────────────────────────────┤
│ Layer 3: Recovery (retry, fallback, auto-escalation)     │
│   - T1 → T2 auto-escalation on low confidence             │
│   - Session retry on crash (MaxRetries: 1)                │
│   - T3 headless fallback on ConPTY failure                 │
│   - Partial answer preservation on crash                  │
├─────────────────────────────────────────────────────────┤
│ Layer 4: Containment (timeouts, resource limits)         │
│   - Session timeout (10 min default)                      │
│   - Max concurrent sessions (12 default)                  │
│   - Max scrollback memory (8MB per session)               │
│   - Process group isolation                               │
├─────────────────────────────────────────────────────────┤
│ Layer 5: Graceful degradation                             │
│   - Panel failures don't kill the run (successfulPanel)   │
│   - Low-confidence answers are marked for the judge       │
│   - Disconnected terminals show "reattaching"             │
│   - Runner crash → retry on another runner                │
└─────────────────────────────────────────────────────────┘
```

---

## 10. Security Architecture

### 10.1 Threat Model

| Threat | Source | Mitigation |
|---|---|---|
| Clipboard injection (OSC 52) | Malicious model output | Disable OSC 52 in xterm.js + strip in relay filter |
| Fake terminal prompts | Model output mimicking input prompts | UI always shows which session is active; user must click to focus terminal |
| Credential exfiltration | CLI reading env vars / files | CLIs run with user's own env — same as running them manually. No additional risk. |
| Process escape | CLI spawning processes outside workspace | Process group isolation + `validateWorkingDir` + workspace allowlist |
| PTY input injection | WebSocket client sending malicious keystrokes | Input validation (max length, rate limit per session) |
| Resource exhaustion | Many sessions consuming all memory/FDs | `ResourceLimits` enforcement + `MaxConcurrentSessions` |

### 10.2 Key Security Decisions

1. **`--dangerously-skip-permissions` is REMOVED from T1/T2 paths.** In a real terminal session, the user approves interactively. This is SAFER than the current headless mode. The flag is kept ONLY in T3 (headless CI) behind an explicit `--headless` flag.

2. **Workspace isolation is preserved.** `validateWorkingDir` (`host.go:181`) already enforces an allowlist of workspace roots. This continues to apply to terminal sessions. The CLI can only operate within the allowed workspace.

3. **No network isolation.** The CLI has the same network access as the user. This is intentional — the CLIs need network access to reach their model APIs. We are not sandboxing network.

4. **Env var passthrough.** The CLI receives the user's environment (plus optional overrides). This includes auth tokens. This is the existing model — openFusion uses the developer's own authenticated CLIs. We don't add or remove env vars.

---

## 11. Implementation Priority Matrix (Phased Rollout)

### Phase 1: Foundation (Week 1-2) — Critical Path

| Task | Component | Effort | Blocks |
|---|---|---|---|
| `internal/terminal/` package skeleton | session.go, manager.go | 1 day | Everything |
| PTY allocation (Unix) | `pty_unix.go` with `creack/pty` | 0.5 day | Sessions |
| Byte pump + ring buffer | pump.go, ringbuffer.go | 1 day | Relay + extraction |
| Multi-strategy extractor | extract.go | 1.5 days | Fusion pipeline |
| `TerminalAdapter` interface | adapters.go | 0.5 day | Generic adapter |
| Generic terminal adapter | terminal/terminal.go | 0.5 day | All 23 agents |
| Wire into fusion runner | runner.go `runSelectedModel` | 0.5 day | End-to-end |
| **Phase 1 deliverable:** T1 sessions for opencode + codex, local only, no UI | | | |

**Phase 1 verification:** `fusion-runner fuse --terminal native --workspace ... --prompt "..."` creates real PTY sessions, extracts answers, and produces a fusion result.

### Phase 2: UI + Catalog (Week 2-3)

| Task | Component | Effort |
|---|---|---|
| Session WebSocket endpoints | localui/server.go | 0.5 day |
| xterm.js integration in local UI | server.go `indexHTML` | 1 day |
| Catalog `TerminalSpec` hints (all 23) | catalog.go | 0.5 day |
| `--terminal` and `--external-terminal` CLI flags | main.go | 0.5 day |
| Health monitor | health.go | 0.5 day |
| Process group management | session.go `Kill()` | 0.5 day |
| **Phase 2 deliverable:** All 23 agents launchable, xterm.js in local UI, health monitoring | | |

**Phase 2 verification:** `fusion-runner ui` shows real xterm.js terminals per panel model. All 23 agents can launch a session. Hung sessions are detected.

### Phase 3: Hardening (Week 3-4)

| Task | Component | Effort |
|---|---|---|
| Cloud relay (lazy subscribe + compression) | relay.go | 1 day |
| `panel.terminal.delta` payload enrichment | events.ts | 0.5 day |
| xterm.js in web app (run-chat.tsx) | run-chat.tsx | 1.5 days |
| Provider-aware semaphore | manager.go | 0.5 day |
| Security hardening (OSC 52, input validation) | relay.go, server.go | 0.5 day |
| ANSI sanitization in extraction | extract.go | 0.5 day |
| Integration tests (real CLIs) | tests | 1 day |
| **Phase 3 deliverable:** Cloud path works, web UI has xterm.js, security hardened | | |

### Phase 4: Polish (Week 4-5)

| Task | Component | Effort |
|---|---|---|
| tmux integration (external terminals) | pty_tmux.go | 1 day |
| Windows ConPTY support | pty_windows.go | 1.5 days |
| Auto-escalation T1→T2 on low confidence | runner.go | 0.5 day |
| Session re-attachment (scrollback) | server.go, run-chat.tsx | 1 day |
| Metrics + observability | metrics.go | 0.5 day |
| Documentation update | LIVE_TERMINAL_DESIGN.md | 0.5 day |
| Remove `--dangerously-skip-permissions` from T1/T2 | opencode.go | 0.25 day |
| **Phase 4 deliverable:** Production-ready, all platforms, all features | | |

### Phase 5: Optional Enhancements (Future)

| Task | Effort |
|---|---|
| Multi-turn fusion (continue in same session) | 2 days |
| External terminal windows (Terminal.app, iTerm2) | 1 day |
| Session recording/replay (asciinema format) | 1 day |
| Per-model extraction pattern tuning | Ongoing |
| Provider rate-limit awareness (query provider APIs) | 2 days |

---

## 12. Success Metrics and SLOs

### 12.1 Functional Metrics

| Metric | Target | Measurement |
|---|---|---|
| Agents executable | 23 / 23 | Session launch success rate per catalog agent |
| Extraction success rate | > 90% | % of sessions where confidence > 0.5 |
| Terminal rendering fidelity | No visible bugs | Manual QA: ANSI colors, cursor, TUI layouts |
| Interactive input works | Yes | Manual QA: type in xterm.js, verify PTY receives |

### 12.2 Performance SLOs

| Metric | Target | Measurement |
|---|---|---|
| Session creation latency | < 50ms | Time from `Create()` to PTY allocated |
| Byte pump overhead | < 3% CPU | Per-session CPU usage during active output |
| Relay latency (local) | < 10ms | PTY read to xterm.js render |
| Relay latency (cloud) | < 100ms | PTY read to browser event |
| Ring buffer memory | ≤ 8MB | Per session, measured |
| Total runner memory (12 sessions) | ≤ 300MB | Excluding CLI processes |

### 12.3 Reliability SLOs

| Metric | Target | Measurement |
|---|---|---|
| Session cleanup (no zombies) | 100% | Orphaned process count after session kill |
| Stall detection accuracy | > 80% | % of actual stalls detected within 120s |
| Timeout enforcement | 100% | All sessions killed within `MaxSessionDuration + 5s` |
| Crash recovery (retry) | > 95% | % of failed jobs successfully retried |

### 12.4 User Experience Metrics

| Metric | Target | Measurement |
|---|---|---|
| "It feels like a real terminal" | User feedback | Qualitative survey |
| Terminal connects on first try | > 98% | xterm.js WS connection success rate |
| Re-attach shows scrollback | Yes | Manual QA |
| External terminal opens | Yes (macOS/Linux) | Manual QA |

---

## 13. Migration Strategy

### 13.1 Zero-Downtime Migration

The migration is **backward compatible by design:**

1. **T3 (current path) remains functional.** `host.RunStreaming` is unchanged. `opencode.go:Run()` and `codex.go:Run()` are kept as T3 fallback. If `TerminalAdapter` is not implemented or `--terminal headless` is set, the current code path runs.

2. **Feature flag:** `--terminal native|json|headless` controls the tier. Default is `native` (T1). Users can opt into `headless` (T3) if T1 has issues.

3. **Gradual rollout:**
   - Phase 1: T1 for opencode + codex only, local UI only, no cloud.
   - Phase 2: T1 for all 23 agents, local UI.
   - Phase 3: T1/T2 for cloud-dispatched jobs.
   - Phase 4: T1 everywhere, T3 explicitly for CI only.

4. **Fallback at runtime:** If PTY allocation fails (e.g., on Windows without ConPTY), the SessionManager falls back to T3 automatically. The run continues, just without a real terminal.

### 13.2 What Changes for the User

| Before (T3) | After (T1/T2 Hybrid) |
|---|---|
| Captured text in a modal | Real xterm.js terminal per model |
| 2 of 23 agents can run | All 23 agents can run |
| `--dangerously-skip-permissions` hardcoded | Interactive approvals (user types in terminal) |
| No interactivity | User can interact with running agents |
| No session persistence | Sessions re-attachable (scrollback) |
| Per-adapter Go code (O(n)) | Generic adapter + catalog hints (O(1)) |

### 13.3 What Changes for the Developer (Codebase)

| Before | After |
|---|---|
| Adding an agent = 150 lines of Go | Adding an agent = 5-line catalog hint |
| `runSelectedModel` switch with 2 cases | `runSelectedModel` asks `TerminalAdapter` |
| `host.RunStreaming` is the only path | `SessionManager.Create` is primary, `host.RunStreaming` is T3 fallback |
| `panel.terminal.delta` carries captured lines | `panel.terminal.delta` carries raw PTY bytes + sessionId |
| `--dangerously-skip-permissions` in opencode adapter | Removed from T1/T2, kept only in T3 headless path |

---

## 14. Cost of Wrong Decision

### What if we choose T2 (JSON-in-PTY) as primary instead of T1?

- User sees JSON text, not TUI → **product promise broken** ("watch agents work" = watching JSON scroll)
- CLIs without JSON mode can't run → **agent coverage drops** from 23 to ~5-8
- We still need per-CLI JSON parsers → **O(n) code per agent**
- Interactive approvals still need `--dangerously-skip-permissions` → **security smell remains**
- No multi-turn sessions (JSON mode is one-shot) → **feature regression**

**Cost: Medium.** Wrong UX, limited agent coverage, but functional.

### What if we choose T3 (current) and just improve it?

- User still sees captured text → **product promise broken**
- Only 2 of 23 agents work → **stuck at 8.7% coverage**
- `--dangerously-skip-permissions` remains → **security smell**
- No interactivity, no sessions, no multi-turn → **no new features**

**Cost: High.** The product doesn't deliver on its core promise. Competitors with real terminal integration will win.

### What if we choose T1 alone (no T2/T3 fallback)?

- Extraction is unreliable for CLIs that don't obey sentinels → **degraded fusion quality**
- No headless/CI support → **can't run in pipelines**
- Windows ConPTY issues are unmitigated → **Windows is broken**

**Cost: Medium.** Good UX but fragile. The hybrid avoids this.

### What if we invest in T1 only and skip the multi-strategy extractor?

- Sentinels work 70-85% of the time → **15-30% of runs have degraded fusion**
- No fallback when sentinels fail → **judge gets garbage input**
- User loses trust in fusion quality → **product failure**

**Cost: High.** The extractor is the critical path. Skipping it is not an option.

---

## 15. Final Verdict

### The Recommendation

**Implement the Hybrid T1-Primary Architecture with the following priorities:**

1. **T1 (Native Interactive PTY) as the primary execution model** for all local UI runs and any CLI with a native TUI. This delivers the product promise: "watch multiple expert agents work in parallel, each in a real terminal."

2. **Multi-strategy extraction pipeline** (sentinel → NDJSON → scrollback → process-exit) with confidence scoring. This is the most critical component — it determines fusion quality. Invest heavily here.

3. **T2 (JSON-in-PTY) as the secondary path** for cloud-dispatched jobs and CLIs with stable JSON modes where T1 extraction is unreliable.

4. **T3 (Headless capture) as the fallback** for CI, headless, and Windows-without-ConPTY environments.

5. **Generic terminal adapter** for all 23 agents via catalog hints. This collapses the O(n) agent support problem to O(1).

6. **Defense in depth** for all worst-case scenarios: health monitoring, process group management, resource limits, security hardening, backpressure handling.

### Why This Is the Best of Better

| What the R&D doc proposed | What this report adds |
|---|---|
| Three tiers (T1/T2/T3) | Hybrid with automatic tier selection per session |
| Single extraction strategy per tier | Multi-strategy pipeline with confidence scoring |
| No backpressure handling | Ring buffer + non-blocking relay + subscriber disconnect |
| No health monitoring | Stall detection + interactive prompt detection + UI notification |
| No process group management | `Setpgid` + group kill + cleanup goroutine |
| No security hardening | OSC 52 stripping + input validation + terminal injection prevention |
| No extraction confidence for judge | Confidence score passed to judge prompt for weighted synthesis |
| No provider-aware scheduling | Per-provider semaphore for rate limit avoidance |
| No auto-escalation | T1→T2 re-run on low confidence |
| No cloud relay optimization | Lazy subscribe + compression + frame batching |

### The One-Sentence Summary

**Run each model in a real PTY terminal session (T1), extract the answer with a multi-strategy confidence-scored pipeline, fall back to JSON-in-PTY (T2) or headless capture (T3) when needed, support all 23 agents via a generic catalog-driven adapter, and harden against every identified worst-case with defense in depth.**

---

## Appendix A — Component Dependency Graph

```
internal/terminal/
    ├── session.go ──────── depends on ──┐
    ├── manager.go ──────── depends on ──┤
    ├── pty_unix.go ─────── depends on ──┤── creack/pty
    ├── pty_windows.go ──── depends on ──┤── win32 syscall
    ├── pty_tmux.go ─────── depends on ──┤── tmux binary
    ├── pump.go ─────────── depends on ──┤── ringbuffer.go
    ├── ringbuffer.go ───── no deps      │
    ├── extract.go ──────── depends on ──┤── ringbuffer.go
    ├── health.go ───────── depends on ──┤── session.go
    ├── relay.go ────────── depends on ──┤── session.go
    └── metrics.go ──────── no deps      │
                                          │
internal/adapters/                        │
    ├── adapters.go ────── defines TerminalAdapter interface
    └── terminal/                         │
        └── terminal.go ── depends on ──┘── internal/terminal + localagents

internal/fusion/
    └── runner.go ──────── depends on ── internal/terminal (SessionManager)
                                     └── internal/adapters (TerminalAdapter)

internal/localui/
    └── server.go ──────── depends on ── internal/terminal (relay endpoints)

cmd/fusion-runner/
    └── main.go ────────── depends on ── internal/terminal (SessionManager wiring)

packages/shared/
    └── events.ts ──────── modified: panel.terminal.delta payload

apps/web/
    └── run-chat.tsx ───── depends on ── xterm.js + session stream
```

## Appendix B — New Dependencies

| Dependency | Purpose | License | Maturity |
|---|---|---|---|
| `github.com/creack/pty` | Unix PTY allocation | MIT | Very mature, de facto standard |
| `xterm.js` (npm) | Terminal rendering in browser | MIT | Very mature, used by VS Code |
| `xterm-addon-attach` (npm) | xterm.js WebSocket attach addon | MIT | Mature |
| `xterm-addon-fit` (npm) | xterm.js terminal resize addon | MIT | Mature |
| `xterm-addon-search` (npm) | xterm.js search addon | MIT | Mature |

No new binary dependencies. tmux is optional (detected at runtime).

## Appendix C — File Change Summary

| File | Change Type | Effort |
|---|---|---|
| `internal/terminal/session.go` | NEW | 1 day |
| `internal/terminal/manager.go` | NEW | 0.5 day |
| `internal/terminal/pty_unix.go` | NEW | 0.5 day |
| `internal/terminal/pty_windows.go` | NEW | 1.5 days |
| `internal/terminal/pty_tmux.go` | NEW | 1 day |
| `internal/terminal/pump.go` | NEW | 1 day |
| `internal/terminal/ringbuffer.go` | NEW | 0.5 day |
| `internal/terminal/extract.go` | NEW | 1.5 days |
| `internal/terminal/health.go` | NEW | 0.5 day |
| `internal/terminal/relay.go` | NEW | 1 day |
| `internal/terminal/metrics.go` | NEW | 0.5 day |
| `internal/adapters/adapters.go` | MODIFY (add TerminalAdapter) | 0.5 day |
| `internal/adapters/terminal/terminal.go` | NEW | 0.5 day |
| `internal/adapters/opencode/opencode.go` | MODIFY (add SessionSpec, remove skip-perm) | 0.5 day |
| `internal/adapters/codex/codex.go` | MODIFY (add SessionSpec) | 0.5 day |
| `internal/localagents/catalog.go` | MODIFY (add TerminalSpec to 23 agents) | 0.5 day |
| `internal/fusion/runner.go` | MODIFY (use sessions in runSelectedModel) | 0.5 day |
| `internal/executors/host/host.go` | NO CHANGE (T3 fallback stays) | 0 |
| `internal/localui/server.go` | MODIFY (session WS + xterm.js) | 1.5 days |
| `cmd/fusion-runner/main.go` | MODIFY (wire SessionManager, --terminal flag) | 0.5 day |
| `packages/shared/src/events.ts` | MODIFY (panel.terminal.delta payload) | 0.25 day |
| `apps/web/.../run-chat.tsx` | MODIFY (xterm.js per panel) | 1.5 days |
| `Docs/LIVE_TERMINAL_DESIGN.md` | MODIFY (Option B is primary) | 0.25 day |
| **Total** | | **~15 days** |

---

**End of report.**