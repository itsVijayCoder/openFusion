package terminal

import "sync/atomic"

// SessionMetrics tracks per-session counters for observability. All fields
// are accessed atomically and are safe for concurrent use.
type SessionMetrics struct {
	ExtractorDrops    atomic.Int64
	RelayDrops        atomic.Int64
	RelayDisconnects  atomic.Int64
	BytesRead         atomic.Int64
	ChunksProcessed   atomic.Int64
	ApprovalRequested atomic.Int64
}

// ManagerMetrics tracks aggregate counters across all sessions.
type ManagerMetrics struct {
	SessionsCreated   atomic.Int64
	SessionsCompleted atomic.Int64
	SessionsFailed    atomic.Int64
	SessionsCancelled atomic.Int64
	ActiveSessions    atomic.Int64
}
