package terminal

import "sync"

// RingBuffer is a bounded byte buffer for scrollback. When full, the oldest
// bytes are evicted. It is safe for concurrent use. Writes never block.
type RingBuffer struct {
	mu   sync.Mutex
	data []byte
	size int
	pos  int
	full bool
}

// NewRingBuffer creates a ring buffer with the given capacity in bytes.
func NewRingBuffer(size int) *RingBuffer {
	if size <= 0 {
		size = 8 * 1024 * 1024
	}
	return &RingBuffer{
		data: make([]byte, size),
		size: size,
	}
}

// Write appends bytes to the ring buffer. If the buffer is full, the oldest
// bytes are evicted. The write never blocks. Returns the number of bytes
// written (always len(p)).
func (r *RingBuffer) Write(p []byte) (int, error) {
	if len(p) == 0 {
		return 0, nil
	}
	r.mu.Lock()
	defer r.mu.Unlock()

	if len(p) >= r.size {
		copy(r.data, p[len(p)-r.size:])
		r.pos = 0
		r.full = true
		return len(p), nil
	}

	remaining := r.size - r.pos
	if len(p) <= remaining {
		copy(r.data[r.pos:], p)
		r.pos += len(p)
	} else {
		copy(r.data[r.pos:], p[:remaining])
		copy(r.data, p[remaining:])
		r.pos = len(p) - remaining
	}
	if r.pos >= r.size {
		r.pos = 0
	}
	if len(p) > 0 {
		r.full = r.full || r.pos == 0 && r.size > 0
	}
	return len(p), nil
}

// Bytes returns the full scrollback contents in chronological order. The
// returned slice is a copy; callers may modify it freely.
func (r *RingBuffer) Bytes() []byte {
	r.mu.Lock()
	defer r.mu.Unlock()

	if !r.full && r.pos == 0 {
		return nil
	}
	if !r.full {
		out := make([]byte, r.pos)
		copy(out, r.data[:r.pos])
		return out
	}
	out := make([]byte, r.size)
	copy(out, r.data[r.pos:])
	copy(out[r.size-r.pos:], r.data[:r.pos])
	return out
}

// Tail returns the last n bytes of the ring buffer. If n exceeds the buffer
// contents, the full contents are returned.
func (r *RingBuffer) Tail(n int) []byte {
	if n <= 0 {
		return nil
	}
	r.mu.Lock()
	defer r.mu.Unlock()

	available := r.size
	if !r.full {
		available = r.pos
	}
	if n > available {
		n = available
	}
	out := make([]byte, n)
	if !r.full {
		copy(out, r.data[r.pos-n:r.pos])
		return out
	}
	start := r.pos - n
	if start >= 0 {
		copy(out, r.data[start:r.pos])
		return out
	}
	copy(out, r.data[r.size+start:])
	copy(out[-start:], r.data[:r.pos])
	return out
}

// Len returns the number of bytes currently stored in the ring buffer.
func (r *RingBuffer) Len() int {
	r.mu.Lock()
	defer r.mu.Unlock()
	if r.full {
		return r.size
	}
	return r.pos
}
