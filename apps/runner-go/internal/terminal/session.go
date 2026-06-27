package terminal

import (
	"context"
	"fmt"
	"os/exec"
	"strings"
	"sync"
	"sync/atomic"
	"syscall"
	"time"
)

// SessionState represents the lifecycle state of a terminal session.
type SessionState int32

const (
	StateCreated SessionState = iota
	StateRunning
	StateExtracting
	StateCompleted
	StateFailed
	StateCancelled
)

func (s SessionState) String() string {
	switch s {
	case StateCreated:
		return "created"
	case StateRunning:
		return "running"
	case StateExtracting:
		return "extracting"
	case StateCompleted:
		return "completed"
	case StateFailed:
		return "failed"
	case StateCancelled:
		return "cancelled"
	default:
		return "unknown"
	}
}

// PromptMode determines how the prompt is delivered to the CLI.
type PromptMode int

const (
	PromptModeKeystrokes PromptMode = iota
	PromptModeFlag
	PromptModeStdin
)

// SessionSpec is the specification passed to SessionManager.Create.
type SessionSpec struct {
	ID           string
	RunID        string
	JobID        string
	AdapterID    string
	ModelID      string
	Binary       string
	Args         []string
	Env          map[string]string
	WorkingDir   string
	AllowedRoots []string

	PromptMode PromptMode
	PromptFlag string
	PromptText string
	ModelFlag  string
	Model      string

	TimeoutMs int
	Rows      int
	Cols      int
}

// Session is the atomic unit of execution: one model run in one PTY.
type Session struct {
	ID        string
	RunID     string
	JobID     string
	AdapterID string
	ModelID   string

	pty     PTYHandle
	cmd     *exec.Cmd
	pgid    int
	spec    SessionSpec
	metrics *SessionMetrics

	pumpDone   chan struct{}
	ringBuffer *RingBuffer
	extractor  *Extractor

	relaySubs map[chan []byte]struct{}
	relayMu   sync.RWMutex

	lastOutput atomic.Int64
	deadline   time.Time

	state     atomic.Int32
	createdAt time.Time

	resultOnce sync.Once
}

const (
	relayChanSize  = 64
	relayDropLimit = 56
)

// Send writes keystrokes to the PTY (for interactive input / prompt delivery).
func (s *Session) Send(data string) error {
	if s.pty == nil {
		return fmt.Errorf("session %s: PTY not available", s.ID)
	}
	_, err := s.pty.Write([]byte(data))
	return err
}

// Resize changes the terminal dimensions.
func (s *Session) Resize(rows, cols int) error {
	if s.pty == nil {
		return fmt.Errorf("session %s: PTY not available", s.ID)
	}
	return s.pty.SetSize(rows, cols)
}

// Scrollback returns the ring buffer contents for re-attach.
func (s *Session) Scrollback() []byte {
	return s.ringBuffer.Bytes()
}

// Subscribe registers a channel to receive live PTY byte chunks. The caller
// must call Unsubscribe when done to release resources.
func (s *Session) Subscribe() <-chan []byte {
	ch := make(chan []byte, relayChanSize)
	s.relayMu.Lock()
	s.relaySubs[ch] = struct{}{}
	s.relayMu.Unlock()
	return ch
}

// Unsubscribe removes a subscriber channel and closes it.
func (s *Session) Unsubscribe(ch <-chan []byte) {
	s.relayMu.Lock()
	defer s.relayMu.Unlock()
	for sub := range s.relaySubs {
		if sub == ch {
			close(sub)
			delete(s.relaySubs, sub)
			return
		}
	}
}

// State returns the current session state.
func (s *Session) State() SessionState {
	return SessionState(s.state.Load())
}

// Wait returns a channel that receives the ExtractionResult when the session
// completes (answer extracted, process exited, or timeout).
func (s *Session) Wait() <-chan ExtractionResult {
	return s.extractor.ResultCh
}

// Kill terminates the session's process group. It sends SIGTERM, waits 3
// seconds, then SIGKILL. Safe to call multiple times.
func (s *Session) Kill() {
	s.transitionState(StateCancelled)
	s.killProcessGroup()
}

// transitionState atomically updates the session state.
func (s *Session) transitionState(newState SessionState) {
	s.state.Store(int32(newState))
}

// bytePump reads from the PTY master and fans out to ring buffer, extractor,
// and relay subscribers. It never blocks on a slow consumer.
func (s *Session) bytePump() {
	defer close(s.pumpDone)
	buf := make([]byte, 4096)

	for {
		n, err := s.pty.Read(buf)
		if n > 0 {
			chunk := make([]byte, n)
			copy(chunk, buf[:n])

			s.lastOutput.Store(time.Now().UnixNano())
			s.metrics.BytesRead.Add(int64(n))
			s.metrics.ChunksProcessed.Add(1)

			s.ringBuffer.Write(chunk)

			select {
			case s.extractor.Input <- chunk:
			default:
				s.metrics.ExtractorDrops.Add(1)
			}

			s.relayMu.RLock()
			for sub := range s.relaySubs {
				select {
				case sub <- chunk:
				default:
					s.metrics.RelayDrops.Add(1)
					if len(sub) > relayDropLimit {
						close(sub)
						delete(s.relaySubs, sub)
						s.metrics.RelayDisconnects.Add(1)
					}
				}
			}
			s.relayMu.RUnlock()
		}
		if err != nil {
			break
		}
	}

	s.transitionState(StateExtracting)
	close(s.extractor.Done)
}

// killProcessGroup sends SIGTERM then SIGKILL to the entire process group.
func (s *Session) killProcessGroup() {
	if s.cmd == nil || s.cmd.Process == nil {
		return
	}

	_ = syscall.Kill(-s.pgid, syscall.SIGTERM)

	timer := time.NewTimer(3 * time.Second)
	defer timer.Stop()
	select {
	case <-s.pumpDone:
		return
	case <-timer.C:
	}

	_ = syscall.Kill(-s.pgid, syscall.SIGKILL)

	if s.pty != nil {
		_ = s.pty.Close()
	}
	_ = s.cmd.Wait()
}

// healthMonitor watches for stalled sessions and timeouts.
func (s *Session) healthMonitor(ctx context.Context) {
	ticker := time.NewTicker(5 * time.Second)
	defer ticker.Stop()

	for {
		select {
		case <-s.pumpDone:
			return
		case <-ctx.Done():
			s.Kill()
			return
		case <-ticker.C:
			last := time.Unix(0, s.lastOutput.Load())
			idle := time.Since(last)

			if time.Now().After(s.deadline) {
				s.Kill()
				return
			}

			if idle > 120*time.Second && s.State() == StateRunning {
				s.handleInteractiveStall()
			}
		}
	}
}

// handleInteractiveStall checks if the terminal output looks like a prompt
// and emits a warning. This detects CLIs waiting for interactive input.
func (s *Session) handleInteractiveStall() {
	tail := s.ringBuffer.Tail(512)
	tailStr := stripANSI(string(tail))

	promptPatterns := []string{
		"? [y/n]", "[Y/n]", "yes/no",
		"Select", "Choose", "Enter choice",
		"Press any key", "Press ENTER",
		"Password:", "Token:",
	}

	trimmed := strings.TrimSpace(tailStr)
	for _, pattern := range promptPatterns {
		if strings.HasSuffix(trimmed, pattern) || strings.Contains(trimmed, pattern) {
			s.metrics.ApprovalRequested.Add(1)
			return
		}
	}
}
