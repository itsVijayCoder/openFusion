# Implementation Blueprint: Native PTY Terminal Session Architecture

> **Status:** Approved for Implementation
> **Date:** 2026-06-26
> **Author:** Senior Architecture — System Design & Full-Stack
> **Scope:** Production implementation of real, per-model PTY-backed terminal sessions for openFusion's fusion pipeline. Every model runs in its own isolated terminal — exactly like a developer running `opencode`, `codex`, or `pi` directly in their terminal.

---

## Table of Contents

1. [Architecture Overview](#1-architecture-overview)
2. [Core Data Structures](#2-core-data-structures)
3. [Component Specifications](#3-component-specifications)
4. [The Extraction Engine](#4-the-extraction-engine)
5. [The Byte Pump and Backpressure System](#5-the-byte-pump-and-backpressure-system)
6. [Session Lifecycle State Machine](#6-session-lifecycle-state-machine)
7. [Fusion Pipeline Integration](#7-fusion-pipeline-integration)
8. [Generic Terminal Adapter and Catalog System](#8-generic-terminal-adapter-and-catalog-system)
9. [Real-Time UI Terminal Layer](#9-real-time-ui-terminal-layer)
10. [Cloud Relay Architecture](#10-cloud-relay-architecture)
11. [Use Case Deep Dives](#11-use-case-deep-dives)
12. [Scalability Engineering](#12-scalability-engineering)
13. [Efficiency Engineering](#13-efficiency-engineering)
14. [Security Architecture](#14-security-architecture)
15. [Reliability and Failure Handling](#15-reliability-and-failure-handling)
16. [Implementation Phases](#16-implementation-phases)
17. [File Manifest](#17-file-manifest)
18. [Verification and SLOs](#18-verification-and-slos)

---

## 1. Architecture Overview

### 1.1 The Principle

Every model run in the fusion panel executes inside a **real PTY terminal session**. The runner allocates a pseudo-terminal, launches the CLI in its native interactive mode, streams live terminal bytes to the browser via xterm.js, and extracts the model's answer through a multi-strategy pipeline for the judge step.

The terminal is the contract. Not a JSON schema. Not a captured buffer. The terminal.

This means:
- The user sees the real CLI TUI — ANSI colors, cursor control, tool calls, diff viewers, streaming output.
- The user can interact — type approvals, send follow-up prompts, select from menus.
- Any CLI on the system can run with zero per-CLI Go code — the generic terminal adapter handles it.
- Sessions are persistent, re-attachable, and observable from the moment they start.

### 1.2 System Architecture Diagram

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                           fusion.Execute                                    │
│                    Panel → Judge → Final-Writer                             │
│                    (runner.go:84)                                           │
└──────────────────────────────┬──────────────────────────────────────────────┘
                               │
                               ▼
                    ┌─────────────────────┐
                    │  runSelectedModel   │
                    │  (runner.go:272)    │
                    └──────────┬──────────┘
                               │
                               ▼
                    ┌─────────────────────┐
                    │ GenericTerminal     │
                    │ Adapter.SessionSpec │
                    │ (catalog-driven)    │
                    └──────────┬──────────┘
                               │
                               ▼
              ┌────────────────────────────────┐
              │       SessionManager            │
              │       .Create(spec)             │
              │       (internal/terminal)       │
              └────────────────┬───────────────┘
                               │
          ┌────────────────────┼────────────────────┐
          │                    │                    │
          ▼                    ▼                    ▼
   ┌─────────────┐    ┌─────────────┐    ┌─────────────┐
   │  PTY Alloc  │    │  exec.Cmd   │    │  Process    │
   │  creack/pty │    │  (CLI native│    │  Group      │
   │  or ConPTY  │    │   mode)     │    │  Setpgid    │
   └──────┬──────┘    └──────┬──────┘    └──────┬──────┘
          │                  │                  │
          └──────────┬───────┘                  │
                     │                          │
                     ▼                          │
              ┌──────────────┐                  │
              │  Byte Pump   │◄─────────────────┘
              │  (goroutine) │  reads PTY master fd
              └──┬───┬───┬───┘
                 │   │   │
         ┌───────┘   │   └───────┐
         ▼           ▼           ▼
   ┌──────────┐ ┌─────────┐ ┌──────────────┐
   │  Ring    │ │Extract  │ │   Relay      │
   │  Buffer  │ │Engine   │ │   Layer      │
   │  (8MB)   │ │(multi-  │ │  (WS + cloud)│
   │          │ │strategy)│ │              │
   └────┬─────┘ └────┬────┘ └──────┬───────┘
        │            │             │
        ▼            ▼             ▼
   ┌──────────┐ ┌─────────┐ ┌──────────────┐
   │Scrollback│ │Answer + │ │xterm.js      │
   │(re-attach│ │Confidence│ │(browser)     │
   │  support)│ │(→ judge)│ │via WebSocket │
   └──────────┘ └─────────┘ └──────────────┘
                       │
                       ▼
              ┌─────────────────┐
              │  ModelOutput    │
              │  .OutputText    │
              │  .Confidence    │
              └────────┬────────┘
                       │
                       ▼
              ┌─────────────────┐
              │  Judge Model    │
              │  (weighted by   │
              │   confidence)   │
              └─────────────────┘
```

### 1.3 Key Design Decisions

| Decision | Rationale |
|---|---|
| PTY per session (not shared) | Full isolation. One model's crash never affects another. |
| Ring buffer (8MB, bounded) | Prevents OOM on long sessions. Scrollback for re-attach. |
| Non-blocking fan-out | Byte pump never stalls on slow consumers (UI, extractor). |
| Multi-strategy extraction | No single strategy is 100% reliable. Chain them with confidence scoring. |
| Process groups (`Setpgid`) | Clean kill of CLI + all its child processes (language servers, etc.). |
| Catalog-driven adapter | Adding agent #24 is a 5-line catalog entry, not 150 lines of Go. |
| Health monitor per session | Detects hung CLIs waiting for interactive input. Notifies UI. |
| Lazy cloud relay | PTY bytes sent to cloud only when a user is watching. Saves bandwidth. |

---

## 2. Core Data Structures

### 2.1 Session

The atomic unit of execution. One session = one model run.

```go
// internal/terminal/session.go

type Session struct {
    ID        string    // "run_123/architect:opencode/claude-sonnet-4"
    RunID     string
    JobID     string
    AdapterID string
    ModelID   string

    // PTY layer
    pty      PTYHandle       // platform abstraction (creack/pty / ConPTY)
    cmd      *exec.Cmd
    pgid     int             // process group ID for clean kill

    // Byte pump
    pumpDone   chan struct{} // closed when byte pump exits
    ringBuffer *RingBuffer   // 8MB bounded scrollback

    // Extraction
    extractor  *Extractor
    resultCh   chan ExtractionResult

    // Relay (live subscribers)
    relaySubs  map[chan []byte]struct{}
    relayMu    sync.RWMutex

    // Health
    lastOutput atomic.Int64  // unix nano of last PTY read
    deadline   time.Time

    // Lifecycle
    state      atomic.Int32  // SessionState enum
    createdAt  time.Time
    metrics    *SessionMetrics
}
```

### 2.2 SessionState

```go
type SessionState int32

const (
    StateCreated    SessionState = iota // PTY allocated, process not started
    StateRunning                        // Process running, byte pump active
    StateExtracting                     // Process exited, extractor finalizing
    StateCompleted                      // Extraction done, answer available
    StateFailed                         // Process crashed or extraction failed
    StateCancelled                      // Killed by timeout or user
)
```

### 2.3 ExtractionResult

```go
type ExtractionResult struct {
    Answer     string    // extracted answer text (never empty if PTY produced output)
    Confidence float64   // 0.0 to 1.0 — passed to judge for weighting
    Strategy   string    // "sentinel" | "ndjson" | "scrollback" | "process_exit"
    RawBytes   int       // total PTY bytes processed
    Duration   time.Duration
    Warnings   []string  // e.g., "sentinel not found, fell back to scrollback"
    ExitCode   int       // CLI process exit code
}
```

### 2.4 SessionSpec

The specification passed to `SessionManager.Create`:

```go
type SessionSpec struct {
    ID          string
    RunID       string
    JobID       string
    AdapterID   string
    ModelID     string
    Binary      string            // resolved CLI path
    Args        []string          // native-mode args (may be empty)
    Env         map[string]string
    WorkingDir  string
    AllowedRoots []string

    PromptMode  PromptMode        // keystrokes | flag | stdin
    PromptFlag  string            // "--prompt" / "-p" / ""
    PromptText  string            // the user's prompt
    ModelFlag   string            // "--model" / "-m" / ""
    Model       string            // model ID to pass to CLI

    TimeoutMs   int
    Rows        int               // terminal dimensions (default 24)
    Cols        int               // terminal dimensions (default 80)
}
```

### 2.5 ResourceLimits

```go
type ResourceLimits struct {
    MaxConcurrentSessions int           // default: 12
    MaxScrollbackBytes    int           // default: 8MB per session
    MaxSessionDuration    time.Duration // default: 10 minutes
    MaxTotalMemoryMB      int           // default: 256MB across all sessions
}
```

---

## 3. Component Specifications

### 3.1 SessionManager (`internal/terminal/manager.go`)

Thread-safe registry. Owns all sessions. Enforces resource limits.

```go
type SessionManager struct {
    mu       sync.RWMutex
    sessions map[string]*Session
    limits   ResourceLimits
    ptyAlloc PTYAllocator
    metrics  *ManagerMetrics
}

// Create allocates a PTY, starts the CLI process in a process group,
// launches the byte pump + health monitor + extractor, and returns
// the live session. Returns error if resource limits are exceeded.
func (m *SessionManager) Create(spec SessionSpec) (*Session, error)

// Get retrieves a session by ID (for re-attach, input, kill).
func (m *SessionManager) Get(id string) (*Session, bool)

// List returns all active sessions (for UI session picker).
func (m *SessionManager) List() []*Session

// Kill kills a specific session (process group SIGKILL + PTY close).
func (m *SessionManager) Kill(id string) error

// KillAll kills all sessions (graceful shutdown, called on SIGTERM).
func (m *SessionManager) KillAll()

// Metrics returns aggregate metrics (session count, memory, FDs).
func (m *SessionManager) Metrics() ManagerMetrics
```

**Create logic:**
1. Check `len(sessions) < MaxConcurrentSessions`. Reject if exceeded.
2. Allocate PTY via `ptyAlloc.StartWithSize(cmd, rows, cols)`.
3. Set `cmd.SysProcAttr = &syscall.SysProcAttr{Setpgid: true}` — process group for clean kill.
4. Start the process: `cmd.Start()`.
5. Record `pgid` for group kill.
6. Launch goroutines: `go s.bytePump()`, `go s.healthMonitor()`, `go s.extractor.Run()`.
7. If `PromptMode == flag`: prompt is already in `cmd.Args`. If `keystrokes`: write prompt to PTY after a short delay (wait for CLI to be ready). If `stdin`: write prompt to `cmd.Stdin`.
8. Register session in map. Return session.

### 3.2 PTY Abstraction (`internal/terminal/pty.go`)

```go
type PTYHandle interface {
    Read(p []byte) (n int, err error)
    Write(p []byte) (n int, err error)
    SetSize(rows, cols int) error
    Close() error
    File() *os.File
}

type PTYAllocator interface {
    Start(cmd *exec.Cmd) (PTYHandle, error)
    StartWithSize(cmd *exec.Cmd, rows, cols int) (PTYHandle, error)
}
```

**Platform implementations:**

| File | Build Tag | Backend | Notes |
|---|---|---|---|
| `pty_unix.go` | `!windows` | `github.com/creack/pty` | Mature, de facto standard. `pty.StartWithSize(cmd, rows, cols)`. |
| `pty_windows.go` | `windows` | Windows ConPTY | `CreatePseudoConsole` via syscall. Falls back to pipes if unavailable. |
| `pty_tmux.go` | (optional) | `tmux new-session` | Detected at runtime. Enables external terminal attach. |

**Runtime selection:**
1. If `--terminal tmux` flag set AND `tmux` binary found in PATH → tmux allocator.
2. Else on macOS/Linux → `creack/pty` allocator.
3. Else on Windows → ConPTY allocator (with pipe fallback).
4. Else → no PTY available, runner operates in headless capture mode.

### 3.3 RingBuffer (`internal/terminal/ringbuffer.go`)

Bounded byte buffer for scrollback. When full, oldest bytes are evicted.

```go
type RingBuffer struct {
    mu   sync.Mutex
    data []byte
    size int
    pos  int
    full bool
}

func NewRingBuffer(size int) *RingBuffer
func (r *RingBuffer) Write(p []byte) (int, error)  // non-blocking, evicts oldest
func (r *RingBuffer) Bytes() []byte                 // full scrollback in order
func (r *RingBuffer) Tail(n int) []byte             // last n bytes
func (r *RingBuffer) Len() int
```

**Why 8MB:**
- At ~1KB/sec of terminal output (typical CLI), 8MB = ~2 hours of scrollback.
- 12 sessions × 8MB = 96MB max. Well within the 256MB budget.
- A long opencode session with file reads and diffs can produce 2-5MB. 8MB covers it.

**Implementation detail:** `Write` acquires the mutex, copies bytes into `data` at `pos`, advances `pos` modulo `size`. If `pos` wraps, sets `full = true`. `Bytes()` reconstructs in-order: if `!full`, return `data[:pos]`. If `full`, return `data[pos:] + data[:pos]` (wrap-around).

### 3.4 Health Monitor (`internal/terminal/health.go`)

One goroutine per session. Watches for stalls and timeouts.

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
            case time.Now().After(s.deadline):
                s.transitionState(StateCancelled)
                s.killProcessGroup()
                s.emitEvent("session.timeout", map[string]any{
                    "idle_seconds": idle.Seconds(),
                })
                return

            case idle > 120*time.Second:
                s.handleInteractiveStall()

            case idle > 60*time.Second:
                s.emitEvent("session.idle", map[string]any{
                    "idle_seconds": idle.Seconds(),
                })
            }
        }
    }
}
```

**Interactive stall detection:**

```go
func (s *Session) handleInteractiveStall() {
    tail := s.ringBuffer.Tail(512)
    tailStr := stripANSI(string(tail))

    promptPatterns := []string{
        "? [y/n]", "[Y/n]", "yes/no",
        "Select", "Choose", "Enter choice",
        "Press any key", "Press ENTER",
        "Password:", "Token:",
        ">", "$", "#", "%",
    }

    for _, pattern := range promptPatterns {
        if strings.HasSuffix(strings.TrimSpace(tailStr), pattern) ||
           strings.Contains(tailStr, pattern) {
            s.emitEvent("approval.requested", map[string]any{
                "adapter":   s.AdapterID,
                "model":     s.ModelID,
                "prompt_snippet": tailStr,
                "message":   "session waiting for interactive input — click terminal to respond",
            })
            return
        }
    }
}
```

This is the key mechanism that prevents hung sessions. When a CLI waits for input (model selection, approval, ToS acceptance), the health monitor detects it and emits an `approval.requested` event. The UI shows a notification. The user clicks the terminal, types their response, and the session continues.

---

## 4. The Extraction Engine

### 4.1 Overview

The extraction engine is the most critical component. It determines whether the judge gets clean input. The engine runs as a goroutine consuming the PTY byte stream and producing an `ExtractionResult` with a confidence score.

The engine uses a **strategy chain** — four strategies in priority order. Each strategy processes chunks in real-time. On process exit, each strategy gets a `Finalize()` call. The highest-confidence result wins.

### 4.2 Strategy Interface

```go
type ExtractionStrategy interface {
    Name() string
    Process(chunk []byte) *ExtractionResult  // nil = not yet, non-nil = done
    Finalize() *ExtractionResult              // called on process exit
}
```

### 4.3 Strategy 1: Sentinel Markers

**How it works:** The user's prompt is wrapped with instructions to output answer markers:

```
You are participating in a fusion pipeline where multiple AI agents answer
the same prompt. A judge will compare answers.

After your complete answer, output these exact markers on their own lines:

===FUSION_ANSWER_START===
<your complete final answer here>
===FUSION_ANSWER_END===

Put your reasoning and work before the markers.
Put only your final answer between the markers.
```

The extractor scans the PTY stream for `===FUSION_ANSWER_START===` and `===FUSION_ANSWER_END===`.

**Implementation:**

```go
type SentinelStrategy struct {
    buffer   []byte
    startRe  *regexp.Regexp
    endRe    *regexp.Regexp
    found    bool
    answer   []byte
}

func (s *SentinelStrategy) Process(chunk []byte) *ExtractionResult {
    s.buffer = append(s.buffer, chunk...)

    // Look for START marker
    startIdx := s.startRe.FindIndex(s.buffer)
    if startIdx == nil {
        return nil  // not found yet
    }

    // Look for END marker after START
    endIdx := s.endRe.FindIndex(s.buffer[startIdx[1]:])
    if endIdx == nil {
        return nil  // START found but END not yet — keep waiting
    }

    // Extract answer between markers
    answerStart := startIdx[1]
    answerEnd := startIdx[1] + endIdx[0]
    raw := s.buffer[answerStart:answerEnd]
    clean := stripANSI(string(raw))
    clean = strings.TrimSpace(clean)

    s.found = true
    s.answer = []byte(clean)

    confidence := 0.85
    if len(clean) < 50 {
        confidence = 0.6
    }

    return &ExtractionResult{
        Answer:     clean,
        Confidence: confidence,
        Strategy:   "sentinel",
        Warnings:   []string{},
    }
}

func (s *SentinelStrategy) Finalize() *ExtractionResult {
    if s.found {
        return nil  // already returned via Process
    }
    // START found but no END — take everything after START
    startIdx := s.startRe.FindIndex(s.buffer)
    if startIdx != nil {
        raw := s.buffer[startIdx[1]:]
        clean := strings.TrimSpace(stripANSI(string(raw)))
        if len(clean) > 0 {
            return &ExtractionResult{
                Answer:     clean,
                Confidence: 0.5,
                Strategy:   "sentinel",
                Warnings:    []string{"end marker not found, took all text after start marker"},
            }
        }
    }
    return nil  // no markers found at all
}
```

**Edge cases handled:**
- Model echoes the instructions (including markers) before answering → search for the LAST `START...END` pair, not the first.
- Markers have trailing whitespace or ANSI → regex with `\s*` tolerance + ANSI stripping.
- Model outputs `START` without `END` → on `Finalize()`, take everything after `START`.
- Markers inside code blocks → the regex matches literal text, so code-block markers are still valid. The last match wins.

### 4.4 Strategy 2: NDJSON Parsing

**How it works:** If the CLI emits NDJSON (detected by `{"type":` or `{"event":` patterns), parse each line and accumulate text from message/result events.

**Implementation:**

```go
type NDJSONStrategy struct {
    lineBuf  []byte
    texts    []string
    jsonDetected bool
}

func (s *NDJSONStrategy) Process(chunk []byte) *ExtractionResult {
    s.lineBuf = append(s.lineBuf, chunk...)

    // Process complete lines
    for {
        idx := bytes.IndexByte(s.lineBuf, '\n')
        if idx == -1 {
            break
        }
        line := s.lineBuf[:idx]
        s.lineBuf = s.lineBuf[idx+1:]

        s.processLine(line)
    }
    return nil  // NDJSON strategy returns on Finalize, not per-chunk
}

func (s *NDJSONStrategy) processLine(line []byte) {
    trimmed := bytes.TrimSpace(line)
    if len(trimmed) == 0 || (trimmed[0] != '{' && trimmed[0] != '[') {
        return
    }

    s.jsonDetected = true

    var obj map[string]any
    if err := json.Unmarshal(trimmed, &obj); err != nil {
        return
    }

    // Extract text from known event types
    eventType, _ := obj["type"].(string)

    switch {
    case eventType == "message" || eventType == "result" ||
         eventType == "completed" || eventType == "final":
        if text := extractTextField(obj); text != "" {
            s.texts = append(s.texts, text)
        }

    case eventType == "reasoning_summary_text.done":
        if text := extractTextField(obj); text != "" {
            s.texts = append(s.texts, text)
        }
    }
}

func (s *NDJSONStrategy) Finalize() *ExtractionResult {
    if !s.jsonDetected || len(s.texts) == 0 {
        return nil
    }

    answer := strings.Join(s.texts, "\n\n")
    confidence := 0.95
    if len(answer) < 50 {
        confidence = 0.7
    }

    return &ExtractionResult{
        Answer:     answer,
        Confidence: confidence,
        Strategy:   "ndjson",
    }
}

// extractTextField searches an NDJSON object for text content.
// Priority: text > content > message > answer > response.
// Also checks nested: part.text, part.content, data.text, data.content.
func extractTextField(obj map[string]any) string {
    for _, key := range []string{"text", "content", "message", "answer", "response"} {
        if val, ok := obj[key].(string); ok && val != "" {
            return val
        }
    }
    // Check nested objects
    for _, nestedKey := range []string{"part", "data", "payload"} {
        if nested, ok := obj[nestedKey].(map[string]any); ok {
            for _, key := range []string{"text", "content"} {
                if val, ok := nested[key].(string); ok && val != "" {
                    return val
                }
            }
        }
    }
    return ""
}
```

**Why this is schema-tolerant:** The `extractTextField` function doesn't hardcode field names per CLI. It tries a priority list of common field names. This means if `opencode` changes `type: "message"` to `type: "assistant_message"`, the parser still finds the text field. The only thing that would break is if the `type` field value changes — and even then, the generic fallback (any object with a `text` field) catches it.

### 4.5 Strategy 3: Scrollback Scrape

**How it works:** If no sentinels and no JSON, take the ring buffer at process exit, strip ANSI, strip TUI chrome, return the remaining text.

**Implementation:**

```go
type ScrollbackStrategy struct {
    ringBuffer *RingBuffer
    chromePatterns []*regexp.Regexp
}

func (s *ScrollbackStrategy) Process(chunk []byte) *ExtractionResult {
    return nil  // scrollback only works on Finalize
}

func (s *ScrollbackStrategy) Finalize() *ExtractionResult {
    raw := s.ringBuffer.Bytes()
    text := string(raw)

    // 1. Strip alternate screen content (full-screen TUI apps)
    //    Between \x1b[?1049h and \x1b[?1049l, the app drew its TUI.
    //    Keep the content (the answer is usually there) but strip the chrome.
    text = stripAlternateScreen(text)

    // 2. Strip all ANSI escape sequences
    text = stripANSI(text)

    // 3. Drop TUI chrome lines
    lines := strings.Split(text, "\n")
    var kept []string
    for _, line := range lines {
        if s.isChrome(line) {
            continue
        }
        kept = append(kept, line)
    }
    text = strings.Join(kept, "\n")

    // 4. Collapse consecutive blank lines
    text = collapseBlankLines(text)
    text = strings.TrimSpace(text)

    if len(text) == 0 {
        return nil
    }

    confidence := 0.5
    if len(text) < 100 {
        confidence = 0.2
    } else if len(text) > 500 {
        confidence = 0.6
    }

    return &ExtractionResult{
        Answer:     text,
        Confidence: confidence,
        Strategy:   "scrollback",
        Warnings:   []string{"no sentinels or JSON detected, answer scraped from terminal output"},
    }
}

func (s *ScrollbackStrategy) isChrome(line string) bool {
    trimmed := strings.TrimSpace(line)
    if trimmed == "" {
        return false  // keep blank lines (collapsed later)
    }

    for _, re := range s.chromePatterns {
        if re.MatchString(trimmed) {
            return true
        }
    }

    // Box-drawing characters only (TUI borders)
    if isBoxDrawingOnly(trimmed) {
        return true
    }

    return false
}
```

**Chrome patterns** (regex, per-CLI configurable via catalog):

```go
var defaultChromePatterns = []*regexp.Regexp{
    regexp.MustCompile(`^\s*[░▒▓█]+\s*$`),           // progress bars
    regexp.MustCompile(`^\s*[╔╗╚╝║═╠╣╦╩╬]+\s*$`),    // box borders
    regexp.MustCompile(`^\s*\.{3,}\s*$`),              // spinner dots
    regexp.MustCompile(`^\s*(⠋|⠙|⠹|⠸|⠼|⠴|⠦|⠧|⠇|⠏)\s*$`), // braille spinners
    regexp.MustCompile(`^\s*\[[=|*\-]+\]\s*\d*%?\s*$`), // progress bars [====>   ] 45%
    regexp.MustCompile(`^\s*(Loading|Working|Thinking|Processing)\.\.\.\s*$`),
}
```

### 4.6 Strategy 4: Process Exit (Final Fallback)

If all strategies return nil on `Finalize()`, return whatever is in the ring buffer, stripped of ANSI. This is the "something is better than nothing" strategy.

```go
type ProcessExitStrategy struct {
    ringBuffer *RingBuffer
}

func (s *ProcessExitStrategy) Finalize() *ExtractionResult {
    raw := s.ringBuffer.Bytes()
    text := strings.TrimSpace(stripANSI(string(raw)))

    if len(text) == 0 {
        return &ExtractionResult{
            Answer:     "",
            Confidence: 0.0,
            Strategy:   "process_exit",
            Warnings:   []string{"no output produced by CLI"},
        }
    }

    return &ExtractionResult{
        Answer:     text,
        Confidence: 0.2,
        Strategy:   "process_exit",
        Warnings:   []string{"all extraction strategies failed, returning raw terminal output"},
    }
}
```

### 4.7 Extractor Assembly

```go
type Extractor struct {
    strategies []ExtractionStrategy  // ordered: sentinel, ndjson, scrollback, process_exit
    input      chan []byte            // fed by byte pump
    resultCh   chan ExtractionResult
    done       chan struct{}
}

func (e *Extractor) Run() {
    for {
        select {
        case chunk := <-e.input:
            // Feed chunk to each strategy in order
            for _, strategy := range e.strategies {
                result := strategy.Process(chunk)
                if result != nil {
                    e.resultCh <- *result
                    return
                }
            }

        case <-e.done:
            // Process exited — finalize all strategies, return best result
            var best *ExtractionResult
            for _, strategy := range e.strategies {
                result := strategy.Finalize()
                if result != nil {
                    if best == nil || result.Confidence > best.Confidence {
                        best = result
                    }
                }
            }
            if best != nil {
                e.resultCh <- *best
            } else {
                e.resultCh <- ExtractionResult{
                    Answer:     "",
                    Confidence: 0.0,
                    Strategy:   "none",
                    Warnings:   []string{"no extraction strategy produced a result"},
                }
            }
            return
        }
    }
}
```

**Critical rule:** The extractor NEVER returns an empty string if the PTY produced any output. Even at confidence 0.2, the judge gets *something*. The judge prompt includes the confidence score so it can weight panel inputs accordingly.

### 4.8 ANSI Stripping Utility

```go
var ansiRe = regexp.MustCompile(`\x1b\[[0-9;]*[a-zA-Z]`)
var oscRe = regexp.MustCompile(`\x1b\][^\x07\x1b]*(\x07|\x1b\\)`)
var charsetRe = regexp.MustCompile(`\x1b[()][AB012]`)
var cursorRe = regexp.MustCompile(`\x1b[7-9]`)
var eraseRe = regexp.MustCompile(`\x1b[JK]`)

func stripANSI(s string) string {
    s = oscRe.ReplaceAllString(s, "")
    s = ansiRe.ReplaceAllString(s, "")
    s = charsetRe.ReplaceAllString(s, "")
    s = cursorRe.ReplaceAllString(s, "")
    s = eraseRe.ReplaceAllString(s, "")
    return s
}
```

---

## 5. The Byte Pump and Backpressure System

### 5.1 The Byte Pump

The byte pump is the central goroutine that reads from the PTY master file descriptor and fans out to three consumers: ring buffer, extractor, and relay subscribers.

```go
func (s *Session) bytePump() {
    defer close(s.pumpDone)
    buf := make([]byte, 4096)

    for {
        n, err := s.pty.Read(buf)
        if n > 0 {
            chunk := make([]byte, n)
            copy(chunk, buf[:n])

            // Update health timestamp
            s.lastOutput.Store(time.Now().UnixNano())

            // 1. Ring buffer (non-blocking, bounded)
            s.ringBuffer.Write(chunk)

            // 2. Extractor (non-blocking, buffered channel)
            select {
            case s.extractor.input <- chunk:
            default:
                s.metrics.extractorDrops.Add(1)
                // Extractor is slow — chunk is in ring buffer for scrollback scrape
            }

            // 3. Relay subscribers (non-blocking per subscriber)
            s.relayMu.RLock()
            for sub := range s.relaySubs {
                select {
                case sub <- chunk:
                default:
                    s.metrics.relayDrops.Add(1)
                    // Subscriber is slow — disconnect if too far behind
                    if len(sub) > relayDropLimit {
                        close(sub)
                        delete(s.relaySubs, sub)
                        s.metrics.relayDisconnects.Add(1)
                    }
                }
            }
            s.relayMu.RUnlock()
        }
        if err != nil {
            break  // PTY closed (process exited or error)
        }
    }

    // Process exited — signal extractor to finalize
    close(s.extractor.done)
}
```

### 5.2 Backpressure Design

The byte pump is the **single producer**. It has three consumers:

| Consumer | Channel Type | Buffer Size | On Full | Impact of Drop |
|---|---|---|---|---|
| Ring buffer | Direct write (no channel) | 8MB ring | Evicts oldest | Oldest scrollback lost (acceptable) |
| Extractor | `chan []byte` | 256 chunks (~1MB) | Drop chunk | Extractor misses live chunk, but ring buffer has it for `Finalize()` |
| Relay subs | `chan []byte` per sub | 64 chunks (~256KB) | Drop + disconnect | xterm.js misses frames, shows "buffering", re-attaches from scrollback |

**Key invariant:** The byte pump NEVER blocks. If a consumer can't keep up, chunks are dropped from that consumer's path, but the ring buffer always retains the full output. This means:
- The CLI never stalls (PTY read always completes).
- The extractor can always recover via `Finalize()` (reads ring buffer).
- xterm.js can always re-attach (reads ring buffer scrollback + live stream).

### 5.3 Relay Subscriber Management

```go
const (
    relayChanSize      = 64    // 64 chunks buffered per subscriber
    relayDropLimit     = 56    // disconnect subscriber after 56 pending drops
)

func (s *Session) Subscribe() <-chan []byte {
    ch := make(chan []byte, relayChanSize)
    s.relayMu.Lock()
    s.relaySubs[ch] = struct{}{}
    s.relayMu.Unlock()
    return ch
}

func (s *Session) Unsubscribe(ch <-chan []byte) {
    s.relayMu.Lock()
    if ch, ok := (chan []byte)(ch); ok {
        if _, exists := s.relaySubs[ch]; exists {
            close(ch)
            delete(s.relaySubs, ch)
        }
    }
    s.relayMu.Unlock()
}
```

---

## 6. Session Lifecycle State Machine

```
                    ┌───────────┐
                    │  Created  │
                    │ (PTY alloc│
                    │  done)    │
                    └─────┬─────┘
                          │ cmd.Start()
                          ▼
                    ┌───────────┐
          ┌────────│  Running  │────────┐
          │        │ (byte pump│        │
          │        │  active)  │        │
          │        └─────┬─────┘        │
          │              │              │
          │    ┌─────────┼─────────┐   │
          │    │         │         │   │
          │    ▼         ▼         ▼   │
          │  Process   Timeout   User  │
          │   exits    fires    cancel │
          │    │         │         │   │
          │    ▼         ▼         ▼   │
          │  ┌──────────────────────┐ │
          │  │     Extracting       │ │
          │  │ (extractor.Finalize  │ │
          │  │  runs on ring buffer)│ │
          │  └──────────┬───────────┘ │
          │             │              │
          │             ▼              │
          │  ┌──────────────────────┐  │
          │  │     Completed        │  │
          │  │ (answer available,   │  │
          │  │  session kept for    │  │
          │  │  re-attach)          │  │
          │  └──────────────────────┘  │
          │                            │
          ▼                            ▼
    ┌───────────┐              ┌───────────┐
    │  Failed   │              │ Cancelled │
    │ (crash or │              │ (timeout  │
    │ extraction│              │ or user)  │
    │  failed)  │              │           │
    └───────────┘              └───────────┘
```

**State transitions:**
- `Created → Running`: `cmd.Start()` succeeds, byte pump launched.
- `Running → Extracting`: PTY read returns EOF (process exited).
- `Running → Cancelled`: Health monitor detects timeout, or user kills session.
- `Running → Failed`: Process crashes with non-zero exit AND no output produced.
- `Extracting → Completed`: Extractor produces a result (even low-confidence).
- `Extracting → Failed`: Extractor returns empty (no output at all).

**Post-completion behavior:** Sessions remain in memory after `Completed`/`Failed`/`Cancelled` state. The ring buffer is preserved. The UI can re-attach to view the scrollback. Sessions are garbage-collected after a configurable TTL (default: 30 minutes) or when the runner shuts down.

### 6.1 Process Group Kill

```go
func (s *Session) killProcessGroup() {
    if s.cmd.Process == nil {
        return
    }

    // Try graceful SIGTERM first
    _ = syscall.Kill(-s.pgid, syscall.SIGTERM)

    // Wait 3 seconds for graceful exit
    timer := time.NewTimer(3 * time.Second)
    defer timer.Stop()
    select {
    case <-s.pumpDone:
        return  // process exited
    case <-timer.C:
    }

    // Force SIGKILL the entire process group
    _ = syscall.Kill(-s.pgid, syscall.SIGKILL)

    // Close PTY
    _ = s.pty.Close()

    // Wait for process to fully exit
    _ = s.cmd.Wait()
}
```

**Why process groups:** CLIs spawn child processes. `opencode` may spawn `node`, which spawns a language server. Killing only the direct child leaves orphans. `Setpgid: true` puts the CLI in its own process group. `kill(-pgid, SIGKILL)` kills the entire group — CLI + all descendants.

---

## 7. Fusion Pipeline Integration

### 7.1 Changes to `runner.go`

The fusion pipeline (`fusion.Execute` at `runner.go:84`) currently calls `runSelectedModel` which has a switch with only `opencode` and `codex` cases. All other adapters return "execution is not implemented."

**New `runSelectedModel`:**

```go
func runSelectedModel(ctx context.Context, req Request, selected selectedModel, prompt string, role string) ModelOutput {
    if selected.Adapter == "" || selected.Model == "" {
        return ModelOutput{...error...}
    }

    // Look up the agent definition from the catalog
    agentDef := localagents.FindByID(selected.Adapter)
    if agentDef == nil {
        return ModelOutput{...error: "unknown adapter"...}
    }

    // Build session spec from the catalog's terminal hint
    spec := buildSessionSpec(req, selected, agentDef, prompt, role)

    // Create a session via the SessionManager
    session, err := req.SessionManager.Create(spec)
    if err != nil {
        return ModelOutput{...error: err...}
    }

    // Emit panel.terminal.delta with sessionId so the UI can attach
    // (the emit function is wired to the event system)

    // Wait for extraction to complete
    result := <-session.Wait()

    // Build ModelOutput
    output := ModelOutput{
        ModelID:    selected.ID,
        Adapter:    selected.Adapter,
        Model:      selected.Model,
        Role:       role,
        Status:     extractionToStatus(result),
        OutputText: result.Answer,
        LatencyMs:  time.Since(start).Milliseconds(),
    }

    if result.Confidence < 0.5 {
        output.Error = fmt.Sprintf("low extraction confidence (%.2f via %s)", result.Confidence, result.Strategy)
    }

    return output
}
```

**Key changes:**
1. No more `switch selected.Adapter` — the generic terminal adapter handles all 23 agents.
2. `req.SessionManager` is a new field on `Request` — passed in from `main.go`.
3. `session.Wait()` returns an `ExtractionResult` channel — the pipeline blocks on this (same as the current `wg.Wait()` pattern, but now waiting for extraction, not buffer capture).
4. The `OutputText` comes from the extractor, not from `result.Stdout + result.Stderr`.

### 7.2 Changes to `Request`

```go
type Request struct {
    // ...existing fields...
    SessionManager *terminal.SessionManager `json:"-"`
}
```

### 7.3 The Per-Adapter Semaphore (Preserved)

The existing per-adapter semaphore at `runner.go:144-150` is preserved. It serializes same-adapter runs (one opencode session at a time). Different adapters run in parallel. This is correct — a CLI subscription usually can't run two concurrent sessions.

### 7.4 Confidence-Aware Judge Prompt

The judge prompt is enriched with confidence scores:

```
You are judging a fusion pipeline. Multiple AI agents answered the same prompt.
Each answer has a confidence score (0.0-1.0) indicating how reliably the answer
was extracted from the agent's terminal output.

Panel answers:

[Agent: opencode/claude-sonnet-4 | Confidence: 0.85]
{answer text}

[Agent: codex/gpt-5 | Confidence: 0.95]
{answer text}

[Agent: pi/sonnet | Confidence: 0.40 | WARNING: low confidence, answer scraped from terminal]
{answer text}

Weight your analysis by confidence. High-confidence answers should carry more
weight. Low-confidence answers may contain terminal chrome or incomplete output.
```

This lets the judge intelligently weight panel inputs. A 0.95-confidence NDJSON answer is trusted. A 0.40-confidence scrollback scrape is treated with skepticism.

---

## 8. Generic Terminal Adapter and Catalog System

### 8.1 The TerminalSpecHint

Add a `TerminalSpec` field to `AgentDef` in `catalog.go`:

```go
type TerminalSpecHint struct {
    PromptMode     PromptMode    // keystrokes | flag | stdin
    PromptFlag     string        // "-p" | "--prompt" | ""
    ModelFlag      string        // "--model" | "-m" | ""
    OutputMode     OutputMode    // native | json | plain
    JSONRunArgs    []string      // args for JSON mode, e.g., ["run","--format","json","-"]
    ChromePatterns []string      // additional regex patterns for chrome stripping
    ReadyDelayMs   int           // ms to wait before sending prompt (keystrokes mode)
}
```

### 8.2 Catalog Entries for All 23 Agents

Each agent gets a `TerminalSpec` hint. Here are the key ones:

| Agent | PromptMode | PromptFlag | ModelFlag | OutputMode | JSONRunArgs | Notes |
|---|---|---|---|---|---|---|
| opencode | stdin | - | --model | json | `["run","--format","json","-"]` | Has stable JSON mode |
| codex | stdin | - | --model | json | `["exec","--json","--skip-git-repo-check","--sandbox","workspace-write","-"]` | Has stable JSON mode |
| claude | keystrokes | - | --model | native | `[]` | Interactive TUI, no JSON mode |
| gemini | keystrokes | - | --model | native | `[]` | Interactive TUI |
| pi | flag | -p | --model | native | `[]` | Accepts -p flag |
| aider | flag | --message | --model | native | `["--no-auto-commits"]` | Accepts --message |
| cursor-agent | keystrokes | - | - | native | `[]` | Interactive TUI |
| qwen | keystrokes | - | --model | native | `[]` | Interactive TUI |
| qoder | keystrokes | - | - | native | `[]` | Interactive TUI |
| copilot | keystrokes | - | - | native | `[]` | Interactive TUI |
| deepseek | keystrokes | - | --model | native | `[]` | Interactive TUI |
| kimi | keystrokes | - | --model | native | `[]` | Interactive TUI |
| (all others) | keystrokes | - | --model | native | `[]` | Default: native interactive |

**Default for any new agent:** `PromptMode: keystrokes, OutputMode: native`. Any CLI detected on the system can immediately run in a terminal with zero code changes.

### 8.3 The Generic Terminal Adapter

```go
// internal/adapters/terminal/terminal.go

type GenericTerminalAdapter struct {
    agentDef    localagents.AgentDef
    allowedRoots []string
    toolDirs    []string
}

func (a *GenericTerminalAdapter) ID() string {
    return a.agentDef.ID
}

func (a *GenericTerminalAdapter) SessionSpec(input adapters.RunInput) (terminal.SessionSpec, error) {
    hint := a.agentDef.TerminalSpec

    spec := terminal.SessionSpec{
        ID:          input.RunID + "/" + input.JobID,
        RunID:       input.RunID,
        JobID:       input.JobID,
        AdapterID:   a.agentDef.ID,
        ModelID:     input.Model,
        WorkingDir:  input.WorkspacePath,
        AllowedRoots: a.allowedRoots,
        Env:         input.Env,
        TimeoutMs:   input.TimeoutMs,
        PromptText:  input.Prompt,
        PromptMode:  hint.PromptMode,
        PromptFlag:  hint.PromptFlag,
        Model:       input.Model,
        ModelFlag:   hint.ModelFlag,
        Rows:        24,
        Cols:        80,
    }

    // Resolve binary path
    binary, err := findBinary(a.agentDef, a.toolDirs)
    if err != nil {
        return spec, fmt.Errorf("binary not found for %s: %w", a.agentDef.ID, err)
    }
    spec.Binary = binary

    // Build args based on output mode
    if hint.OutputMode == OutputModeJSON && len(hint.JSONRunArgs) > 0 {
        // JSON mode: use the JSON run args
        spec.Args = hint.JSONRunArgs
        if input.Model != "" && input.Model != "default" && hint.ModelFlag != "" {
            spec.Args = append(spec.Args, hint.ModelFlag, input.Model)
        }
        spec.PromptMode = PromptModeStdin  // JSON mode reads prompt from stdin
    } else {
        // Native mode: just the binary, optionally with --model
        spec.Args = []string{}
        if input.Model != "" && input.Model != "default" && hint.ModelFlag != "" {
            spec.Args = append(spec.Args, hint.ModelFlag, input.Model)
        }
    }

    return spec, nil
}
```

**This is the component that makes all 23 agents executable.** The catalog provides the hints. The generic adapter builds the spec. The SessionManager runs it. No per-CLI Go code needed.

### 8.4 Sentinel Preamble Injection

When `PromptMode` is `keystrokes` or `flag`, the prompt is wrapped with the sentinel preamble before being sent to the CLI:

```go
func buildPromptWithSentinels(prompt string) string {
    return fmt.Sprintf(`%s

---
You are participating in a fusion pipeline where multiple AI agents answer
the same prompt. A judge will compare answers.

After your complete answer, output these exact markers on their own lines:

===FUSION_ANSWER_START===
<your complete final answer here>
===FUSION_ANSWER_END===

Put your reasoning and work before the markers.
Put only your final answer between the markers.
`, prompt)
}
```

For `stdin` mode (JSON mode), the raw prompt is sent without sentinels — the NDJSON extractor handles it.

---

## 9. Real-Time UI Terminal Layer

### 9.1 Local UI WebSocket Endpoints

Add three endpoints to `localui/server.go`:

```go
// GET /api/sessions/:id/stream — WebSocket, relays live PTY bytes
mux.HandleFunc("GET /api/sessions/{id}/stream", func(w http.ResponseWriter, r *http.Request) {
    id := r.PathValue("id")
    session, ok := sessionManager.Get(id)
    if !ok {
        writeError(w, http.StatusNotFound, fmt.Errorf("session not found"))
        return
    }

    conn, err := upgrader.Upgrade(w, r, nil)
    if err != nil {
        return
    }
    defer conn.Close()

    // Send scrollback first (for re-attach)
    scrollback := session.Scrollback()
    if len(scrollback) > 0 {
        conn.WriteMessage(websocket.BinaryMessage, scrollback)
    }

    // Subscribe to live stream
    ch := session.Subscribe()
    defer session.Unsubscribe(ch)

    for {
        chunk, ok := <-ch
        if !ok {
            return  // session ended
        }
        if err := conn.WriteMessage(websocket.BinaryMessage, chunk); err != nil {
            return  // client disconnected
        }
    }
})

// POST /api/sessions/:id/input — sends keystrokes to PTY
mux.HandleFunc("POST /api/sessions/{id}/input", func(w http.ResponseWriter, r *http.Request) {
    id := r.PathValue("id")
    session, ok := sessionManager.Get(id)
    if !ok {
        writeError(w, http.StatusNotFound, fmt.Errorf("session not found"))
        return
    }

    var body struct{ Input string `json:"input"` }
    if err := json.NewDecoder(r.Body).Decode(&body); err != nil {
        writeError(w, http.StatusBadRequest, err)
        return
    }

    // Validate input length (prevent abuse)
    if len(body.Input) > 4096 {
        writeError(w, http.StatusBadRequest, fmt.Errorf("input too long"))
        return
    }

    session.Send(body.Input)
    writeJSON(w, map[string]any{"ok": true})
})

// POST /api/sessions/:id/resize — terminal resize
mux.HandleFunc("POST /api/sessions/{id}/resize", func(w http.ResponseWriter, r *http.Request) {
    id := r.PathValue("id")
    session, ok := sessionManager.Get(id)
    if !ok {
        writeError(w, http.StatusNotFound, fmt.Errorf("session not found"))
        return
    }

    var body struct {
        Rows int `json:"rows"`
        Cols int `json:"cols"`
    }
    if err := json.NewDecoder(r.Body).Decode(&body); err != nil {
        writeError(w, http.StatusBadRequest, err)
        return
    }

    session.Resize(body.Rows, body.Cols)
    writeJSON(w, map[string]any{"ok": true})
})
```

### 9.2 xterm.js Integration

The local UI's `indexHTML` (in `server.go`) includes xterm.js via CDN:

```html
<!-- xterm.js -->
<link rel="stylesheet" href="https://cdn.jsdelivr.net/npm/@xterm/xterm@5.5.0/css/xterm.css">
<script src="https://cdn.jsdelivr.net/npm/@xterm/xterm@5.5.0/lib/xterm.min.js"></script>
<script src="https://cdn.jsdelivr.net/npm/@xterm/addon-fit@0.10.0/lib/addon-fit.min.js"></script>
<script src="https://cdn.jsdelivr.net/npm/@xterm/addon-attach@0.10.0/lib/addon-attach.min.js"></script>
```

**Terminal initialization per panel model:**

```javascript
function createTerminal(sessionId, container) {
    const term = new Terminal({
        cursorBlink: true,
        fontSize: 13,
        fontFamily: 'Menlo, Monaco, "Courier New", monospace',
        scrollback: 10000,
        allowProposedApi: false,  // security: disable OSC 52 clipboard writes
    });

    const fitAddon = new FitAddon.FitAddon();
    term.loadAddon(fitAddon);
    term.open(container);
    fitAddon.fit();

    // Connect to session stream
    const protocol = location.protocol === 'https:' ? 'wss:' : 'ws:';
    const ws = new WebSocket(`${protocol}//${location.host}/api/sessions/${sessionId}/stream`);
    ws.binaryType = 'arraybuffer';

    ws.onmessage = function(event) {
        term.write(new Uint8Array(event.data));
    };

    ws.onclose = function() {
        term.write('\r\n\x1b[33m[session ended]\x1b[0m\r\n');
    };

    // Send user input to PTY
    term.onData(function(data) {
        fetch(`/api/sessions/${sessionId}/input`, {
            method: 'POST',
            headers: {'Content-Type': 'application/json'},
            body: JSON.stringify({input: data}),
        });
    });

    // Handle resize
    window.addEventListener('resize', function() {
        fitAddon.fit();
        fetch(`/api/sessions/${sessionId}/resize`, {
            method: 'POST',
            headers: {'Content-Type': 'application/json'},
            body: JSON.stringify({rows: term.rows, cols: term.cols}),
        });
    });

    return term;
}
```

### 9.3 Web App Integration (`run-chat.tsx`)

In the web app, replace the captured-text modal with xterm.js terminals:

```tsx
import { Terminal } from '@xterm/xterm';
import { FitAddon } from '@xterm/addon-fit';
import '@xterm/xterm/css/xterm.css';

function PanelTerminal({ sessionId, runId }: { sessionId: string; runId: string }) {
    const containerRef = useRef<HTMLDivElement>(null);
    const termRef = useRef<Terminal | null>(null);

    useEffect(() => {
        if (!containerRef.current) return;

        const term = new Terminal({
            cursorBlink: true,
            fontSize: 13,
            allowProposedApi: false,
        });
        const fitAddon = new FitAddon();
        term.loadAddon(fitAddon);
        term.open(containerRef.current);
        fitAddon.fit();
        termRef.current = term;

        // Connect via the cloud WebSocket relay
        const ws = new WebSocket(
            `${wsBaseUrl}/api/runs/${runId}/sessions/${sessionId}/stream`
        );
        ws.binaryType = 'arraybuffer';

        ws.onmessage = (e) => {
            const data = e.data;
            if (typeof data === 'string') {
                // JSON event (panel.terminal.delta with base64 bytes)
                const event = JSON.parse(data);
                if (event.type === 'panel.terminal.delta' && event.data?.bytes) {
                    const bytes = Uint8Array.from(atob(event.data.bytes), c => c.charCodeAt(0));
                    term.write(bytes);
                }
            } else {
                // Raw binary (local runner direct WS)
                term.write(new Uint8Array(data));
            }
        };

        ws.onclose = () => {
            term.write('\r\n\x1b[33m[session ended]\x1b[0m\r\n');
        };

        return () => {
            ws.close();
            term.dispose();
        };
    }, [sessionId, runId]);

    return <div ref={containerRef} style={{ height: '400px', width: '100%' }} />;
}
```

---

## 10. Cloud Relay Architecture

### 10.1 Event Payload Enrichment

The existing `panel.terminal.delta` event type (`events.ts:9`) is enriched:

```typescript
// Before (captured stdout lines):
{ type: "panel.terminal.delta", data: { stream: "stdout", text: "line of text" } }

// After (raw PTY bytes):
{
    type: "panel.terminal.delta",
    data: {
        sessionId: "run_123/architect:opencode/claude-sonnet-4",
        bytes: "G1tTG4o=",  // base64-encoded raw PTY bytes
        text: "optional text representation",  // for backward compat
    }
}
```

### 10.2 Lazy Relay

PTY bytes are only relayed to the cloud when a client is actively watching the terminal trace. This saves massive bandwidth — most users view the final answer, not the live terminal.

```go
// In the relay layer:
func (s *Session) relayToCloud(emit func(RunnerEvent)) {
    hasSubscriber := atomic.LoadInt32(&s.cloudSubscribers) > 0
    if !hasSubscriber {
        return  // no one watching — don't relay
    }

    // Batch PTY bytes into 50ms windows
    batch := s.collectBatch(50 * time.Millisecond)
    if len(batch) == 0 {
        return
    }

    emit(RunnerEvent{
        Type: "panel.terminal.delta",
        Data: map[string]any{
            "sessionId": s.ID,
            "bytes":     base64.StdEncoding.EncodeToString(batch),
        },
    })
}
```

### 10.3 Adaptive Compression

When byte rate exceeds 50KB/s, enable `permessage-deflate` on the WebSocket:

```go
upgrader = websocket.Upgrader{
    EnableCompression: true,
    CompressionLevel:   3,  // default compression
}
```

ANSI terminal output compresses ~60% with deflate (lots of repeated escape sequences).

### 10.4 Frame Batching

PTY bytes are batched into 50ms windows before sending as events. This reduces event volume by ~10x:

```
Without batching: 100 events/sec (one per PTY read)
With batching:    20 events/sec (one per 50ms window)
```

---

## 11. Use Case Deep Dives

### 11.1 Use Case: Local Multi-Model Fusion Run

**Scenario:** Developer runs `fusion-runner ui` and enters a prompt. Three panel models are selected: opencode/claude-sonnet-4, codex/gpt-5, pi/sonnet.

**Flow:**

1. User enters prompt in the local UI. Clicks "Run".
2. `POST /api/fuse` → `fusion.Execute`.
3. `Execute` gathers project context, creates panel goroutines with per-adapter semaphores.
4. For each panel model:
   - `runSelectedModel` looks up the agent in the catalog.
   - `GenericTerminalAdapter.SessionSpec` builds a `SessionSpec` from the catalog hint.
   - `SessionManager.Create(spec)` allocates a PTY, starts the CLI in native mode, launches byte pump + health monitor + extractor.
   - The session ID is returned to `Execute`, which emits `panel.terminal.delta` with `sessionId`.
5. The UI receives the `sessionId` and opens an xterm.js terminal per panel model.
6. xterm.js connects to `/api/sessions/:id/stream` WebSocket. Receives scrollback (empty, new session) then live PTY bytes.
7. The user sees three real terminals side by side, each showing a different CLI's TUI:
   - Terminal 1: opencode TUI with streaming reasoning, tool calls, file edits.
   - Terminal 2: codex TUI with its own rendering.
   - Terminal 3: pi TUI with its own rendering.
8. The user can click any terminal and type (approvals, follow-up prompts).
9. Each CLI works on the prompt. The byte pump streams bytes to xterm.js AND feeds the extractor.
10. As each CLI finishes, the extractor produces an `ExtractionResult` with answer + confidence.
11. `session.Wait()` unblocks. `ModelOutput.OutputText` is set.
12. `wg.Wait()` — all three panels done.
13. Judge runs on the three answers (weighted by confidence).
14. Final synthesis. Result returned to UI.

**Total overhead from our code:** ~20-70ms. The dominant cost is the CLIs' own execution (10-120 seconds each).

### 11.2 Use Case: Interactive Approval Mid-Run

**Scenario:** opencode is running and needs to write a file. It prompts: "Allow file write to src/main.go? [y/n]".

**Flow:**

1. opencode outputs the approval prompt to its TUI.
2. The byte pump reads the prompt bytes, writes to ring buffer, feeds extractor, relays to xterm.js.
3. xterm.js renders: "Allow file write to src/main.go? [y/n]"
4. The health monitor detects no output for 60 seconds. Checks the ring buffer tail. Finds "? [y/n]". Emits `approval.requested` event.
5. The UI shows a notification banner: "opencode/claude-sonnet-4 is waiting for approval — click terminal to respond."
6. The user clicks the opencode terminal. Types "y" and presses Enter.
7. xterm.js sends "y\n" to `/api/sessions/:id/input`.
8. The runner writes "y\n" to the PTY via `session.Send("y\n")`.
9. opencode receives "y" on its stdin (the PTY slave). Proceeds with the file write.
10. The session continues. No `--dangerously-skip-permissions` needed.

**This is the security improvement:** interactive approvals replace the hardcoded `--dangerously-skip-permissions` flag. The user approves each action in real-time.

### 11.3 Use Case: CLI Crashes Mid-Run

**Scenario:** codex crashes with a panic after 30 seconds of work. It produced partial output before crashing.

**Flow:**

1. codex is running. Byte pump streaming. Extractor accumulating.
2. codex panics. Process exits with code 2.
3. PTY read returns EOF. Byte pump exits. `close(s.extractor.done)`.
4. Extractor's `Finalize()` runs:
   - Sentinel strategy: no markers found → nil.
   - NDJSON strategy: partial JSON lines accumulated → returns answer with confidence 0.7.
   - (Scrollback and process_exit not reached — NDJSON returned a result.)
5. `ExtractionResult { Answer: "partial answer text", Confidence: 0.7, Strategy: "ndjson", ExitCode: 2 }`.
6. `ModelOutput.OutputText` = partial answer. `ModelOutput.Status` = "completed" (extraction succeeded, even though process crashed).
7. The judge receives the partial answer with confidence 0.7 and a warning: "codex crashed during execution (exit code 2). Partial output extracted."
8. The fusion pipeline continues with the other panels. If all panels crash, the run fails (`runner.go:178`).

**Key behavior:** A crashed CLI doesn't kill the run. Its partial output is preserved and passed to the judge with reduced confidence.

### 11.4 Use Case: Session Re-Attach After Answer

**Scenario:** A fusion run completed. The user wants to review what opencode did during the run.

**Flow:**

1. Run completed. Sessions are in `Completed` state, kept in memory (TTL: 30 min).
2. The user clicks "View Terminal" on the opencode panel card.
3. xterm.js connects to `/api/sessions/:id/stream`.
4. The WebSocket handler sends the ring buffer scrollback first: `conn.WriteMessage(BinaryMessage, session.Scrollback())`.
5. xterm.js renders the full terminal scrollback — the user sees everything opencode did.
6. If the session is still `Running` (long-running CLI), live bytes stream after the scrollback.
7. If the session is `Completed`, the WebSocket closes after sending scrollback. xterm.js shows "[session ended]".

**Key behavior:** Sessions persist after the run. The user can review any panel's terminal at any time within the TTL window.

### 11.5 Use Case: Cloud-Dispatched Job

**Scenario:** The cloud control plane dispatches a fusion job to a remote runner. The user watches from their browser.

**Flow:**

1. Cloud dispatches job to runner via `executeCloudJob` (`main.go:289`).
2. Runner creates sessions for each panel model (same as local).
3. PTY bytes flow to the byte pump. The relay layer checks: are there cloud subscribers?
4. Initially, no — the user hasn't opened the trace yet. No bytes relayed. Only the extractor runs.
5. Each CLI finishes. Extractor produces answers. Runner posts `panel.output.delta` with the extracted answer to the cloud.
6. Judge runs. Final answer posted to cloud.
7. User opens the run trace in their browser. They see the final answer + judge analysis.
8. User clicks "View Terminal" on a panel. The cloud sends a "subscribe" message to the runner.
9. The runner sets `cloudSubscribers = 1`. Now PTY bytes are relayed as `panel.terminal.delta` events (base64, batched, compressed).
10. But the session already completed! The runner sends the ring buffer scrollback as a series of `panel.terminal.delta` events, then closes the stream.

**Key behavior:** Cloud relay is lazy. Bandwidth is zero until a user watches. When they do, they get the full scrollback.

### 11.6 Use Case: Adding a New Agent (Agent #24)

**Scenario:** A new CLI called `supercode` is released. The developer wants to add it to openFusion.

**Flow:**

1. Developer adds a catalog entry in `catalog.go`:

```go
{
    ID:            "supercode",
    Name:          "SuperCode",
    Binary:        "supercode",
    EnvOverride:   "SUPERCODE_BIN",
    VersionArgs:   []string{"--version"},
    Provider:      "supercode",
    FallbackModels: models("sc-pro", "sc-flash"),
    TerminalSpec: localagents.TerminalSpecHint{
        PromptMode:  localagents.PromptModeKeystrokes,
        ModelFlag:   "--model",
        OutputMode:  localagents.OutputModeNative,
    },
},
```

2. That's it. 5 lines. No `Run()` function. No parser. No adapter code.
3. The generic terminal adapter picks it up. When the user selects `supercode/sc-pro` as a panel model, `SessionManager.Create` launches `supercode --model sc-pro` in a PTY.
4. The sentinel preamble is sent as keystrokes. The CLI works in its native TUI. The extractor extracts the answer.

**Key behavior:** Adding an agent is a declarative catalog change. O(1) cost. No code, no tests, no adapter.

### 11.7 Use Case: Headless CI Run

**Scenario:** A CI pipeline runs openFusion to analyze a PR. No display, no terminal, no human.

**Flow:**

1. CI runs `fusion-runner fuse --headless --workspace ... --prompt "Review this PR"`.
2. `--headless` flag sets `SessionManager = nil` (or a no-op manager).
3. `runSelectedModel` detects no SessionManager. Falls back to `adapter.Run()` (the existing T3 path).
4. `host.RunStreaming` runs the CLI with pipes (no PTY). Captures stdout/stderr.
5. `--dangerously-skip-permissions` is used (no human to approve).
6. `OutputText` = captured stdout. No extraction needed (buffer capture is 100% reliable).
7. Judge runs. Result returned as JSON.

**Key behavior:** Headless mode uses the existing pipe-capture path. No PTY, no xterm.js, no interactivity. This is the only path where `--dangerously-skip-permissions` is used.

### 11.8 Use Case: Multiple Models from Same Provider

**Scenario:** User selects 5 panel models, all using Anthropic Claude (opencode/claude-sonnet-4, claude/sonnet, aider/claude-sonnet-4, pi/sonnet, copilot/claude-sonnet-4.6).

**Flow:**

1. All 5 sessions start. Each uses a different adapter, so the per-adapter semaphore doesn't serialize them.
2. All 5 CLIs authenticate with the same Anthropic API key (the user's subscription).
3. Anthropic rate-limits: 3 of 5 sessions get HTTP 429.
4. The rate-limited CLIs output error messages. The extractor captures the errors.
5. 2 of 5 sessions succeed. The judge runs on 2 answers + 3 error messages.
6. The fusion result is degraded but not failed.

**Mitigation (provider-aware semaphore):**

```go
type SessionManager struct {
    // ...existing fields...
    providerSems map[string]chan struct{}  // per-provider semaphore
}

func (m *SessionManager) Create(spec SessionSpec) (*Session, error) {
    provider := getProvider(spec.AdapterID)
    sem := m.getProviderSem(provider)
    sem <- struct{}{}         // acquire
    defer func() { <-sem }()  // release

    // ...create session...
}
```

This serializes sessions using the same provider, even across different adapters. Prevents rate-limit contention.

---

## 12. Scalability Engineering

### 12.1 Agent Scalability

| Metric | Value |
|---|---|
| Code to add agent #24 | 5 lines (catalog entry) |
| Time to add agent #24 | 5 minutes |
| Max agents | Unlimited (catalog is a slice) |
| Marginal cost of agent N | O(1) — catalog entry only |

The generic terminal adapter makes agent addition a declarative change. The adapter doesn't care how many agents exist — it builds a `SessionSpec` from whatever the catalog says.

### 12.2 Session Scalability

| Resource | Per Session | 12 Sessions (max) | Budget |
|---|---|---|---|
| Ring buffer | 8 MB | 96 MB | 256 MB |
| Extractor channel | 1 MB | 12 MB | — |
| Relay channels | 256 KB/sub | ~3 MB | — |
| Goroutines | 4 | 48 | Negligible |
| File descriptors | 5 | 60 | 1024 (ulimit) |
| **Runner overhead** | **~9.3 MB** | **~111 MB** | **256 MB** |
| CLI process memory | 50-200 MB | 600 MB-2.4 GB | System RAM |

**Bottleneck: CLI process memory, not runner overhead.** Each CLI is a full application. 12 parallel CLIs need ~2.4GB of system RAM. The runner's own overhead (111 MB) is 4.6% of that.

**Scaling beyond 12:**
- Increase `MaxConcurrentSessions` if system RAM allows.
- The per-adapter semaphore naturally limits parallelism (one session per adapter).
- With 23 agents, max theoretical parallelism is 23 (one per adapter). In practice, users select 3-5 panel models.

### 12.3 Horizontal Scalability

```
                    ┌─────────────────┐
                    │  Cloud Control  │
                    │     Plane       │
                    └──┬───┬───┬──────┘
                       │   │   │
              ┌────────┘   │   └────────┐
              ▼            ▼            ▼
        ┌──────────┐ ┌──────────┐ ┌──────────┐
        │ Runner 1 │ │ Runner 2 │ │ Runner 3 │
        │ (local   │ │ (local   │ │ (local   │
        │ sessions)│ │ sessions)│ │ sessions)│
        └──────────┘ └──────────┘ └──────────┘
```

- Each runner has its own `SessionManager` with its own PTYs.
- Sessions are local to a runner (PTYs are kernel objects — can't migrate).
- If a runner dies, its sessions die. The cloud retries the job on another runner.
- No distributed PTY, no session migration. Sessions are ephemeral.

**This is the right design.** PTYs are inherently local. Trying to make them distributed would be massive over-engineering for a developer tool with 10-50 concurrent users.

### 12.4 Cloud Relay Scalability

| Concurrent Viewers | Bandwidth | Strategy |
|---|---|---|
| 1-5 | 25-100 KB/s | Direct relay, no issue |
| 5-20 | 100-400 KB/s | Lazy relay + compression |
| 20-50 | 400 KB/s-2 MB/s | T2 (JSON mode, less verbose) for cloud |
| 50+ | 2+ MB/s | T3 (answer-only, no terminal relay) |

**Realistic scale:** openFusion is a developer tool. Peak concurrent usage: 10-50 developers. The architecture handles this with lazy relay + compression. If it ever needs to scale higher, T3 (answer-only) mode is the escape hatch — no terminal relay, just the extracted answer.

---

## 13. Efficiency Engineering

### 13.1 Latency Budget

| Phase | Time | Owner |
|---|---|---|
| Session creation (PTY + exec) | 5-15 ms | Runner |
| CLI startup (auth, model load) | 1-5 s | CLI (not our code) |
| Prompt delivery | 1 ms | Runner |
| Agent execution | 10-120 s | CLI (not our code) |
| Answer extraction (sentinel) | 1 ms | Runner |
| Answer extraction (scrollback) | 5-50 ms | Runner |
| Relay to UI (per 50ms frame) | 1-5 ms | Runner |
| **Total runner overhead** | **20-70 ms** | **< 0.1% of total** |

The runner is not the bottleneck. The CLI's own execution (model inference, tool calls) dominates.

### 13.2 Memory Budget

| Component | Memory | Bounded? | Mechanism |
|---|---|---|---|
| Ring buffer | 8 MB | Yes | Ring, evicts oldest |
| Extractor channel | 1 MB | Yes | Drops on full |
| Relay channels | 256 KB/sub | Yes | Drops + disconnects |
| **Total per session** | **~9.3 MB** | **Yes** | |

All runner memory is bounded. The only unbounded memory is the CLI process itself, which is killed by the session timeout (10 min default).

### 13.3 CPU Budget

| Operation | Cost | Frequency |
|---|---|---|
| Byte pump (PTY read + fan-out) | 0.1% per 1KB/s | Continuous |
| Sentinel regex scan | 0.01 ms per 4KB | Per chunk |
| Ring buffer write | 0.001 ms per 4KB | Per chunk |
| ANSI stripping (finalization) | 1-5 ms per 8MB | Once per session |
| WS relay (base64 + send) | 0.05 ms per 4KB | Per chunk (when subscribed) |
| **Total per session** | **1-3% CPU** | |

12 sessions = 12-36% of one CPU core. Negligible on modern hardware.

### 13.4 Network Budget

| Mode | Bandwidth | When |
|---|---|---|
| T1 with subscriber | 5-20 KB/s | User watching terminal |
| T1 with compression | 2-8 KB/s | High byte rate |
| T1 without subscriber | 0 KB/s | Lazy relay — no one watching |
| Answer-only (post-run) | 2-20 KB | One-time, extracted answer |

The 50ms frame batching reduces event volume by 10x. Lazy relay eliminates bandwidth when no one is watching.

---

## 14. Security Architecture

### 14.1 Threat Model

| Threat | Vector | Mitigation |
|---|---|---|
| Clipboard injection (OSC 52) | Model outputs `\x1b]52;c;base64,...\x07` | `allowProposedApi: false` in xterm.js + strip OSC 52 in relay filter |
| Fake terminal prompts | Model output mimics input prompts | UI always shows which session is active; user must click to focus |
| PTY input injection | WebSocket client sends malicious keystrokes | Input validation: max 4096 chars, rate-limited per session |
| Process escape | CLI spawns processes outside workspace | Process group isolation + `validateWorkingDir` allowlist |
| Resource exhaustion | Many sessions consume all memory/FDs | `ResourceLimits` enforcement + `MaxConcurrentSessions` |
| Credential exfiltration | CLI reads env vars / files | CLIs run with user's own env — same as running manually. No additional risk. |

### 14.2 Security Decisions

1. **`--dangerously-skip-permissions` is REMOVED from the terminal path.** In a real terminal session, the user approves interactively. This is SAFER than the current headless mode. The flag is kept ONLY in headless CI mode behind `--headless`.

2. **OSC 52 stripping in relay:**

```go
var osc52Re = regexp.MustCompile(`\x1b\]52;c;[^\x07\x1b]*(\x07|\x1b\\)`)

func sanitizeForRelay(bytes []byte) []byte {
    return osc52Re.ReplaceAll(bytes, []byte{})
}
```

3. **Input validation:** Keystrokes sent to `/api/sessions/:id/input` are validated:
   - Max length: 4096 chars
   - Rate limited: 100 messages/sec per session
   - No null bytes

4. **Workspace isolation:** `validateWorkingDir` (`host.go:181`) already enforces an allowlist. This continues to apply to terminal sessions.

5. **No network sandboxing:** CLIs need network access to reach their model APIs. We don't sandbox network. The CLIs have the same network access as the user.

---

## 15. Reliability and Failure Handling

### 15.1 Failure Modes and Recovery

| Failure | Detection | Recovery | User Impact |
|---|---|---|---|
| CLI hangs on input | Health monitor (60s idle) | UI notification + user interacts | Brief pause, then continues |
| CLI crashes | PTY EOF + non-zero exit | Extractor finalizes on ring buffer | Partial answer to judge |
| PTY allocation fails | `ptyAlloc.Start` returns error | Fall back to headless capture (T3) | No terminal, but run completes |
| Extractor produces nothing | All strategies return nil | Process exit strategy returns raw text | Low-confidence answer to judge |
| Runner OOM | `MaxTotalMemoryMB` exceeded | Reject new sessions | User sees "resource limit" error |
| Runner crash | Process exits | Cloud retries job on another runner | Run fails, retried automatically |
| WebSocket disconnects | WS close event | xterm.js shows "reattaching", reconnects | Brief gap, scrollback fills in |
| CLI update breaks schema | Version mismatch warning | Schema-tolerant parsing + sentinel fallback | Degraded extraction, not a crash |

### 15.2 Defense in Depth

```
Layer 1: Prevention
  ├── Flag-based prompt delivery (bypasses interactive menus)
  ├── Sentinel preamble (explicit answer markers)
  └── Per-CLI catalog hints (best tier per CLI)

Layer 2: Detection
  ├── Health monitor (stall detection at 60s/120s)
  ├── Extraction confidence scoring
  ├── Version mismatch warnings
  └── Process crash detection (exit code)

Layer 3: Recovery
  ├── Multi-strategy extraction (sentinel → NDJSON → scrollback → exit)
  ├── Session retry on crash (MaxRetries: 1)
  ├── T3 headless fallback on PTY failure
  └── Partial answer preservation

Layer 4: Containment
  ├── Session timeout (10 min default)
  ├── Max concurrent sessions (12 default)
  ├── Max scrollback memory (8MB per session)
  └── Process group isolation (Setpgid + group kill)

Layer 5: Graceful Degradation
  ├── Panel failures don't kill the run (successfulPanel filter)
  ├── Low-confidence answers marked for the judge
  ├── Disconnected terminals show "reattaching"
  └── Runner crash → retry on another runner
```

### 15.3 Process Cleanup

```go
func (s *Session) killProcessGroup() {
    // 1. SIGTERM the process group (graceful)
    _ = syscall.Kill(-s.pgid, syscall.SIGTERM)

    // 2. Wait 3 seconds
    select {
    case <-s.pumpDone:
        return  // exited gracefully
    case <-time.After(3 * time.Second):
    }

    // 3. SIGKILL the process group (force)
    _ = syscall.Kill(-s.pgid, syscall.SIGKILL)

    // 4. Close PTY
    _ = s.pty.Close()

    // 5. Reap the process
    _ = s.cmd.Wait()
}
```

**Why this matters:** CLIs spawn child processes (language servers, formatters, etc.). Killing only the direct child leaves orphans that accumulate over time. Process group kill (`Setpgid` + `kill(-pgid)`) ensures the entire tree dies.

---

## 16. Implementation Phases

### Phase 1: Foundation (Days 1-5)

| Day | Task | Deliverable |
|---|---|---|
| 1 | `internal/terminal/` package skeleton: `session.go`, `manager.go`, `ringbuffer.go` | Compiles, empty structs |
| 1 | Add `github.com/creack/pty` to `go.mod` | Dependency available |
| 2 | `pty_unix.go` — PTY allocation via `creack/pty` | Can start a process in a PTY |
| 2 | `pump.go` — byte pump with ring buffer + non-blocking fan-out | Bytes flow from PTY to ring buffer |
| 3 | `extract.go` — all four extraction strategies | Can extract answers from fixture streams |
| 3 | `health.go` — health monitor with stall detection | Detects hung sessions |
| 4 | `adapters.go` — add `TerminalAdapter` interface, `TerminalSessionSpec` types | Interface defined |
| 4 | `internal/adapters/terminal/terminal.go` — generic adapter | Builds SessionSpec from catalog |
| 5 | Wire into `runner.go` — `runSelectedModel` uses sessions | End-to-end: prompt → session → extraction → OutputText |

**Phase 1 verification:**
```bash
fusion-runner fuse --workspace /path/to/repo \
  --analysis-model opencode/claude-sonnet-4 \
  --prompt "Explain the main function"
```
This should create a real PTY session, extract the answer, and produce a fusion result.

### Phase 2: UI + Catalog (Days 6-10)

| Day | Task | Deliverable |
|---|---|---|
| 6 | `localui/server.go` — session WS endpoints (`/stream`, `/input`, `/resize`) | WebSocket relay works |
| 7 | `localui/server.go` — xterm.js in `indexHTML` | Real terminal in browser |
| 8 | `catalog.go` — add `TerminalSpec` to all 23 agents | All 23 agents have hints |
| 8 | `main.go` — `--terminal` flag, wire `SessionManager` into `fuse`/`ui` | CLI flag works |
| 9 | Process group management — `Setpgid`, `killProcessGroup` | Clean process kill |
| 10 | Integration test: run all 23 agents, verify session launch | All 23 can launch |

**Phase 2 verification:**
```bash
fusion-runner ui --workspace /path/to/repo
```
Opens browser with real xterm.js terminals per panel model. All 23 agents can launch.

### Phase 3: Hardening (Days 11-15)

| Day | Task | Deliverable |
|---|---|---|
| 11 | `relay.go` — cloud relay with lazy subscribe + compression | Cloud path works |
| 12 | `events.ts` — enrich `panel.terminal.delta` with `bytes` + `sessionId` | Event payload updated |
| 13 | `run-chat.tsx` — xterm.js per panel model in web app | Web app has real terminals |
| 13 | Provider-aware semaphore | Rate limit mitigation |
| 14 | Security hardening — OSC 52 stripping, input validation | Security hardened |
| 15 | Integration tests with real CLIs | Tests pass |

**Phase 3 verification:** Cloud-dispatched jobs relay terminal bytes. Web app shows real terminals. Security hardened.

### Phase 4: Polish (Days 16-20)

| Day | Task | Deliverable |
|---|---|---|
| 16 | `pty_tmux.go` — tmux integration for external terminals | External terminal attach |
| 17 | `pty_windows.go` — Windows ConPTY support | Windows works |
| 18 | Session re-attachment (scrollback on reconnect) | Re-attach works |
| 19 | Metrics + observability | Metrics dashboard |
| 20 | Remove `--dangerously-skip-permissions` from terminal path, update docs | Security fix + docs |

**Phase 4 verification:** All platforms, all features, production-ready.

---

## 17. File Manifest

### New Files

| File | Purpose | Lines (est.) |
|---|---|---|
| `internal/terminal/session.go` | Session struct, lifecycle, Send/Wait/Kill/Resize | 250 |
| `internal/terminal/manager.go` | SessionManager, Create/Get/List/Kill/KillAll | 150 |
| `internal/terminal/pty.go` | PTYHandle + PTYAllocator interfaces | 40 |
| `internal/terminal/pty_unix.go` | creack/pty implementation (build tag `!windows`) | 60 |
| `internal/terminal/pty_windows.go` | ConPTY implementation (build tag `windows`) | 120 |
| `internal/terminal/pty_tmux.go` | tmux implementation (optional) | 100 |
| `internal/terminal/pump.go` | Byte pump goroutine, non-blocking fan-out | 100 |
| `internal/terminal/ringbuffer.go` | Bounded ring buffer for scrollback | 80 |
| `internal/terminal/extract.go` | Multi-strategy extraction engine | 300 |
| `internal/terminal/health.go` | Health monitor, stall detection | 100 |
| `internal/terminal/relay.go` | Cloud relay, lazy subscribe, compression | 120 |
| `internal/terminal/metrics.go` | Session + manager metrics | 80 |
| `internal/terminal/ansi.go` | ANSI stripping utilities | 50 |
| `internal/adapters/terminal/terminal.go` | Generic terminal adapter | 100 |
| **Total new** | | **~1650** |

### Modified Files

| File | Change | Effort |
|---|---|---|
| `go.mod` | Add `github.com/creack/pty` | 1 line |
| `internal/adapters/adapters.go` | Add `TerminalAdapter` interface, `TerminalSessionSpec`, types | 40 lines |
| `internal/adapters/opencode/opencode.go` | Add `SessionSpec()`, remove `--dangerously-skip-permissions` from terminal path | 30 lines |
| `internal/adapters/codex/codex.go` | Add `SessionSpec()` | 30 lines |
| `internal/localagents/catalog.go` | Add `TerminalSpecHint` to `AgentDef`, populate all 23 entries | 100 lines |
| `internal/fusion/runner.go` | `runSelectedModel` uses sessions, `Request` gains `SessionManager` | 50 lines |
| `internal/localui/server.go` | Session WS endpoints, xterm.js in `indexHTML` | 150 lines |
| `cmd/fusion-runner/main.go` | `--terminal` flag, wire `SessionManager` | 40 lines |
| `packages/shared/src/events.ts` | `panel.terminal.delta` payload enrichment (comment/doc) | 10 lines |
| `apps/web/src/app/runs/[runId]/run-chat.tsx` | xterm.js per panel model | 100 lines |
| `Docs/LIVE_TERMINAL_DESIGN.md` | Update: real PTY is primary | 30 lines |

### Unchanged Files

| File | Why |
|---|---|
| `internal/executors/host/host.go` | T3 fallback path stays as-is |
| `internal/adapters/opencode/opencode.go` `Run()` | Kept as T3 fallback |
| `internal/adapters/codex/codex.go` `Run()` | Kept as T3 fallback |

---

## 18. Verification and SLOs

### 18.1 Functional Verification

| Check | Command |
|---|---|
| Go tests pass | `go test ./internal/terminal/... ./internal/adapters/... ./internal/fusion/...` |
| All tests pass | `go test ./...` |
| gofmt clean | `gofmt -l .` |
| Single model run | `fusion-runner fuse --workspace ... --analysis-model opencode/claude-sonnet-4 --prompt "hello"` |
| UI with terminals | `fusion-runner ui --workspace ...` → browser shows xterm.js per model |
| All 23 agents launch | `fusion-runner discover` → each agent can create a session |
| No skip-permissions in terminal path | `grep -r "dangerously-skip-permissions" internal/` → only in T3 fallback |

### 18.2 Extraction Verification

| Check | How |
|---|---|
| Sentinel markers | Feed fixture with `===FUSION_ANSWER_START===...===FUSION_ANSWER_END===` → answer extracted, confidence ≥ 0.6 |
| NDJSON parsing | Feed opencode NDJSON fixture → text accumulated, confidence ≥ 0.7 |
| Scrollback scrape | Feed raw TUI output with ANSI → chrome stripped, text returned, confidence 0.2-0.6 |
| Process exit fallback | Feed empty stream → returns empty, confidence 0.0 |
| Never empty | Feed any non-empty stream → always returns non-empty (or confidence 0.0 with warning) |

### 18.3 Performance SLOs

| Metric | Target |
|---|---|
| Session creation latency | < 50ms |
| Byte pump overhead | < 3% CPU per session |
| Relay latency (local) | < 10ms PTY read → xterm.js render |
| Relay latency (cloud) | < 100ms PTY read → browser event |
| Ring buffer memory | ≤ 8MB per session |
| Total runner memory (12 sessions) | ≤ 300MB (excluding CLI processes) |

### 18.4 Reliability SLOs

| Metric | Target |
|---|---|
| Session cleanup (no zombies) | 100% — `pgrep` finds no orphaned CLI processes after kill |
| Stall detection | > 80% of actual stalls detected within 120s |
| Timeout enforcement | 100% — all sessions killed within `MaxSessionDuration + 5s` |
| Extraction success rate | > 90% of sessions produce confidence > 0.5 |

### 18.5 UX SLOs

| Metric | Target |
|---|---|
| Terminal connects on first try | > 98% |
| ANSI rendering correct | No visible bugs (colors, cursor, TUI layouts) |
| User can type into terminal | Keystrokes reach PTY within 50ms |
| Re-attach shows scrollback | Full scrollback rendered on reconnect |
| Multiple terminals in parallel | Different adapters run simultaneously, same adapter serializes |

---

## Appendix A — New Dependencies

| Dependency | Purpose | License | Maturity |
|---|---|---|---|
| `github.com/creack/pty` | Unix PTY allocation | MIT | De facto standard, used by VS Code, Docker |
| `@xterm/xterm` (npm) | Terminal rendering in browser | MIT | Used by VS Code, Hyper, Theia |
| `@xterm/addon-fit` (npm) | Terminal resize addon | MIT | Official xterm.js addon |
| `@xterm/addon-attach` (npm) | WebSocket attach addon | MIT | Official xterm.js addon |

No new binary dependencies. tmux is optional (detected at runtime).

## Appendix B — Component Dependency Graph

```
internal/terminal/
    ├── session.go ─────── pty.go, ringbuffer.go, extract.go, health.go, relay.go, metrics.go
    ├── manager.go ─────── session.go, pty.go (PTYAllocator)
    ├── pty_unix.go ────── pty.go (interface), creack/pty
    ├── pty_windows.go ─── pty.go (interface), syscall
    ├── pty_tmux.go ────── pty.go (interface), os/exec
    ├── pump.go ────────── session.go, ringbuffer.go
    ├── ringbuffer.go ──── (no deps)
    ├── extract.go ─────── ringbuffer.go, ansi.go
    ├── health.go ──────── session.go, ringbuffer.go, ansi.go
    ├── relay.go ───────── session.go, ansi.go
    ├── metrics.go ─────── (no deps)
    └── ansi.go ────────── (no deps)

internal/adapters/
    ├── adapters.go ────── (defines TerminalAdapter interface)
    └── terminal/
        └── terminal.go ── internal/terminal, internal/localagents

internal/fusion/
    └── runner.go ──────── internal/terminal (SessionManager), internal/adapters/terminal

internal/localui/
    └── server.go ──────── internal/terminal (relay endpoints)

cmd/fusion-runner/
    └── main.go ────────── internal/terminal (SessionManager wiring)
```

## Appendix C — The One-Sentence Summary

**Run each model in a real PTY terminal session, stream live bytes to xterm.js, extract the answer with a four-strategy confidence-scored pipeline (sentinel → NDJSON → scrollback → process-exit), support all 23 agents via a generic catalog-driven adapter with zero per-CLI code, kill cleanly with process groups, detect hung sessions with a health monitor, relay to the cloud lazily with compression, and let the judge weight panel inputs by extraction confidence.**

---

**End of document.**