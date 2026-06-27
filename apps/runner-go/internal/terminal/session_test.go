package terminal

import (
	"context"
	"strings"
	"testing"
	"time"
)

func TestSessionManagerCreateAndExtract(t *testing.T) {
	if testing.Short() {
		t.Skip("skipping PTY test in short mode")
	}

	mgr := NewSessionManager(DefaultResourceLimits(), nil)
	if !mgr.Available() {
		t.Skip("PTY not available on this platform")
	}

	ctx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
	defer cancel()

	spec := SessionSpec{
		ID:         "test/echo",
		RunID:      "test",
		JobID:      "echo",
		AdapterID:  "test",
		ModelID:    "echo",
		Binary:     "echo",
		Args:       []string{"hello from the terminal"},
		WorkingDir: ".",
		TimeoutMs:  5000,
	}

	session, err := mgr.Create(ctx, spec)
	if err != nil {
		if strings.Contains(err.Error(), "operation not permitted") || strings.Contains(err.Error(), "not permitted") {
			t.Skip("PTY allocation not permitted in this environment (sandbox/CI)")
		}
		t.Fatalf("Create failed: %v", err)
	}

	select {
	case result := <-session.Wait():
		if result.Answer == "" {
			t.Fatal("expected non-empty answer")
		}
		if !strings.Contains(result.Answer, "hello from the terminal") {
			t.Fatalf("answer %q does not contain expected text", result.Answer)
		}
	case <-time.After(5 * time.Second):
		t.Fatal("session timed out")
	}
}

func TestSessionManagerKillAll(t *testing.T) {
	if testing.Short() {
		t.Skip("skipping PTY test in short mode")
	}

	mgr := NewSessionManager(DefaultResourceLimits(), nil)
	if !mgr.Available() {
		t.Skip("PTY not available on this platform")
	}

	mgr.KillAll()
}

func TestSessionManagerGetNotFound(t *testing.T) {
	mgr := NewSessionManager(DefaultResourceLimits(), nil)
	_, ok := mgr.Get("nonexistent")
	if ok {
		t.Fatal("expected not found for nonexistent session")
	}
}

func TestSessionManagerListEmpty(t *testing.T) {
	mgr := NewSessionManager(DefaultResourceLimits(), nil)
	sessions := mgr.List()
	if len(sessions) != 0 {
		t.Fatalf("expected 0 sessions, got %d", len(sessions))
	}
}

func TestBuildSessionID(t *testing.T) {
	id := BuildSessionID("run_123", "architect:opencode/claude")
	if id != "run_123/architect:opencode/claude" {
		t.Fatalf("got %q, want %q", id, "run_123/architect:opencode/claude")
	}
}

func TestSessionStateString(t *testing.T) {
	cases := []struct {
		state    SessionState
		expected string
	}{
		{StateCreated, "created"},
		{StateRunning, "running"},
		{StateExtracting, "extracting"},
		{StateCompleted, "completed"},
		{StateFailed, "failed"},
		{StateCancelled, "cancelled"},
	}
	for _, c := range cases {
		if got := c.state.String(); got != c.expected {
			t.Fatalf("%d.String() = %q, want %q", c.state, got, c.expected)
		}
	}
}

func TestSessionManagerRejectsEmptyBinary(t *testing.T) {
	mgr := NewSessionManager(DefaultResourceLimits(), nil)
	ctx := context.Background()
	_, err := mgr.Create(ctx, SessionSpec{
		ID:     "test/empty",
		Binary: "",
	})
	if err == nil {
		t.Fatal("expected error for empty binary")
	}
}

func TestSessionManagerRejectsMaxConcurrent(t *testing.T) {
	mgr := NewSessionManager(ResourceLimits{
		MaxConcurrentSessions: 0,
		MaxScrollbackBytes:    1024,
		MaxSessionDuration:    time.Minute,
	}, nil)

	ctx := context.Background()
	_, err := mgr.Create(ctx, SessionSpec{
		ID:     "test/max",
		Binary: "echo",
	})
	if err == nil {
		t.Fatal("expected error when max concurrent sessions reached")
	}
}

func TestRingBufferConcurrentAccess(t *testing.T) {
	if testing.Short() {
		t.Skip("skipping concurrent test in short mode")
	}
	rb := NewRingBuffer(1024)
	done := make(chan struct{})

	go func() {
		for i := 0; i < 100; i++ {
			rb.Write([]byte("x"))
		}
		close(done)
	}()

	for i := 0; i < 100; i++ {
		rb.Bytes()
		rb.Tail(10)
	}

	<-done
}
