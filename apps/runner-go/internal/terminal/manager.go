package terminal

import (
	"context"
	"fmt"
	"os/exec"
	"strings"
	"sync"
	"syscall"
	"time"
)

// ResourceLimits bounds the resources a SessionManager will allocate.
type ResourceLimits struct {
	MaxConcurrentSessions int
	MaxScrollbackBytes    int
	MaxSessionDuration    time.Duration
}

// DefaultResourceLimits returns production-safe defaults.
func DefaultResourceLimits() ResourceLimits {
	return ResourceLimits{
		MaxConcurrentSessions: 12,
		MaxScrollbackBytes:    8 * 1024 * 1024,
		MaxSessionDuration:    10 * time.Minute,
	}
}

// SessionManager is a thread-safe registry of all active terminal sessions.
// It owns PTY allocation and enforces resource limits.
type SessionManager struct {
	mu       sync.RWMutex
	sessions map[string]*Session
	limits   ResourceLimits
	ptyAlloc PTYAllocator
	metrics  *ManagerMetrics
}

// NewSessionManager creates a manager with the given limits and PTY allocator.
// If alloc is nil, the platform-default allocator is used.
func NewSessionManager(limits ResourceLimits, alloc PTYAllocator) *SessionManager {
	if alloc == nil {
		alloc = defaultAllocator()
	}
	if limits.MaxConcurrentSessions <= 0 {
		limits = DefaultResourceLimits()
	}
	return &SessionManager{
		sessions: make(map[string]*Session),
		limits:   limits,
		ptyAlloc: alloc,
		metrics:  &ManagerMetrics{},
	}
}

// Available reports whether the manager can allocate PTYs on this platform.
func (m *SessionManager) Available() bool {
	return m.ptyAlloc != nil
}

// Create allocates a PTY, starts the CLI process in a process group, launches
// the byte pump + health monitor + extractor, and returns the live session.
func (m *SessionManager) Create(ctx context.Context, spec SessionSpec) (*Session, error) {
	m.mu.Lock()
	if len(m.sessions) >= m.limits.MaxConcurrentSessions {
		m.mu.Unlock()
		return nil, fmt.Errorf("max concurrent sessions reached (%d)", m.limits.MaxConcurrentSessions)
	}
	m.mu.Unlock()

	if spec.Binary == "" {
		return nil, fmt.Errorf("session spec binary is required")
	}
	rows := spec.Rows
	if rows <= 0 {
		rows = 24
	}
	cols := spec.Cols
	if cols <= 0 {
		cols = 80
	}

	args := append([]string{}, spec.Args...)
	if spec.Model != "" && spec.Model != "default" && spec.ModelFlag != "" {
		args = append(args, spec.ModelFlag, spec.Model)
	}

	cmd := exec.CommandContext(ctx, spec.Binary, args...)
	cmd.Dir = spec.WorkingDir
	cmd.Env = buildEnv(spec.Env)
	cmd.SysProcAttr = &syscall.SysProcAttr{Setpgid: true}

	ptyHandle, err := m.ptyAlloc.StartWithSize(cmd, rows, cols)
	if err != nil {
		return nil, fmt.Errorf("pty allocation failed: %w", err)
	}

	pgid := 0
	if cmd.Process != nil {
		pgid = cmd.Process.Pid
	}

	scrollbackSize := m.limits.MaxScrollbackBytes
	ringBuffer := NewRingBuffer(scrollbackSize)
	extractor := NewExtractor(ringBuffer)

	timeout := time.Duration(spec.TimeoutMs) * time.Millisecond
	if timeout <= 0 {
		timeout = m.limits.MaxSessionDuration
	}

	session := &Session{
		ID:         spec.ID,
		RunID:      spec.RunID,
		JobID:      spec.JobID,
		AdapterID:  spec.AdapterID,
		ModelID:    spec.ModelID,
		pty:        ptyHandle,
		cmd:        cmd,
		pgid:       pgid,
		spec:       spec,
		metrics:    &SessionMetrics{},
		pumpDone:   make(chan struct{}),
		ringBuffer: ringBuffer,
		extractor:  extractor,
		relaySubs:  make(map[chan []byte]struct{}),
		deadline:   time.Now().Add(timeout),
		createdAt:  time.Now(),
	}
	session.transitionState(StateRunning)

	m.mu.Lock()
	m.sessions[session.ID] = session
	m.metrics.SessionsCreated.Add(1)
	m.metrics.ActiveSessions.Add(1)
	m.mu.Unlock()

	go session.bytePump()
	go session.healthMonitor(ctx)
	go extractor.Run()

	if spec.PromptMode == PromptModeStdin && spec.PromptText != "" {
		_, _ = ptyHandle.Write([]byte(spec.PromptText))
	} else if spec.PromptMode == PromptModeKeystrokes && spec.PromptText != "" {
		go func() {
			time.Sleep(500 * time.Millisecond)
			_ = session.Send(spec.PromptText + "\n")
		}()
	}

	return session, nil
}

// Get retrieves a session by ID.
func (m *SessionManager) Get(id string) (*Session, bool) {
	m.mu.RLock()
	defer m.mu.RUnlock()
	s, ok := m.sessions[id]
	return s, ok
}

// List returns all active sessions.
func (m *SessionManager) List() []*Session {
	m.mu.RLock()
	defer m.mu.RUnlock()
	out := make([]*Session, 0, len(m.sessions))
	for _, s := range m.sessions {
		out = append(out, s)
	}
	return out
}

// Kill terminates a specific session.
func (m *SessionManager) Kill(id string) error {
	m.mu.RLock()
	s, ok := m.sessions[id]
	m.mu.RUnlock()
	if !ok {
		return fmt.Errorf("session %s not found", id)
	}
	s.Kill()
	return nil
}

// KillAll terminates all sessions (graceful shutdown).
func (m *SessionManager) KillAll() {
	m.mu.RLock()
	sessions := make([]*Session, 0, len(m.sessions))
	for _, s := range m.sessions {
		sessions = append(sessions, s)
	}
	m.mu.RUnlock()

	for _, s := range sessions {
		s.Kill()
	}
}

// Remove deletes a completed session from the registry.
func (m *SessionManager) Remove(id string) {
	m.mu.Lock()
	defer m.mu.Unlock()
	delete(m.sessions, id)
	m.metrics.ActiveSessions.Add(-1)
}

// Metrics returns aggregate manager metrics.
func (m *SessionManager) Metrics() ManagerMetrics {
	return *m.metrics
}

func buildEnv(extra map[string]string) []string {
	env := make([]string, 0, len(extra))
	for key, value := range extra {
		env = append(env, key+"="+value)
	}
	return env
}

// BuildSessionID creates a deterministic session ID from run/job identifiers.
func BuildSessionID(runID, jobID string) string {
	return strings.TrimSuffix(runID+"/"+jobID, "/")
}
