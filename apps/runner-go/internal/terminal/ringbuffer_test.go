package terminal

import (
	"bytes"
	"testing"
)

func TestRingBufferWriteAndRead(t *testing.T) {
	rb := NewRingBuffer(1024)
	data := []byte("hello world")
	n, err := rb.Write(data)
	if err != nil {
		t.Fatalf("write failed: %v", err)
	}
	if n != len(data) {
		t.Fatalf("wrote %d bytes, want %d", n, len(data))
	}
	out := rb.Bytes()
	if !bytes.Equal(out, data) {
		t.Fatalf("read %q, want %q", out, data)
	}
}

func TestRingBufferEmpty(t *testing.T) {
	rb := NewRingBuffer(1024)
	out := rb.Bytes()
	if len(out) != 0 {
		t.Fatalf("expected empty, got %d bytes", len(out))
	}
}

func TestRingBufferOverflow(t *testing.T) {
	rb := NewRingBuffer(10)
	rb.Write([]byte("0123456789"))
	rb.Write([]byte("ABCDE"))

	out := rb.Bytes()
	if len(out) != 10 {
		t.Fatalf("expected 10 bytes, got %d", len(out))
	}
	// After writing "0123456789" (fills buffer), then "ABCDE" overwrites
	// the oldest 5 bytes ("01234"). Chronological order: "56789" (old)
	// then "ABCDE" (new).
	expected := []byte("56789ABCDE")
	if !bytes.Equal(out, expected) {
		t.Fatalf("after overflow got %q, want %q", out, expected)
	}
}

func TestRingBufferLargeWriteExceedsSize(t *testing.T) {
	rb := NewRingBuffer(10)
	large := []byte("0123456789ABCDEFGHIJ")
	rb.Write(large)

	out := rb.Bytes()
	if len(out) != 10 {
		t.Fatalf("expected 10 bytes, got %d", len(out))
	}
	expected := large[len(large)-10:]
	if !bytes.Equal(out, expected) {
		t.Fatalf("got %q, want %q", out, expected)
	}
}

func TestRingBufferTail(t *testing.T) {
	rb := NewRingBuffer(1024)
	rb.Write([]byte("hello world"))
	tail := rb.Tail(5)
	if !bytes.Equal(tail, []byte("world")) {
		t.Fatalf("tail %q, want %q", tail, "world")
	}
}

func TestRingBufferTailMoreThanAvailable(t *testing.T) {
	rb := NewRingBuffer(1024)
	rb.Write([]byte("hello"))
	tail := rb.Tail(100)
	if !bytes.Equal(tail, []byte("hello")) {
		t.Fatalf("tail %q, want %q", tail, "hello")
	}
}

func TestRingBufferLen(t *testing.T) {
	rb := NewRingBuffer(1024)
	if rb.Len() != 0 {
		t.Fatalf("expected len 0, got %d", rb.Len())
	}
	rb.Write([]byte("hello"))
	if rb.Len() != 5 {
		t.Fatalf("expected len 5, got %d", rb.Len())
	}
}

func TestRingBufferMultipleWrites(t *testing.T) {
	rb := NewRingBuffer(100)
	rb.Write([]byte("foo"))
	rb.Write([]byte("bar"))
	rb.Write([]byte("baz"))
	out := rb.Bytes()
	expected := []byte("foobarbaz")
	if !bytes.Equal(out, expected) {
		t.Fatalf("got %q, want %q", out, expected)
	}
}

func TestRingBufferWrapAround(t *testing.T) {
	rb := NewRingBuffer(5)
	rb.Write([]byte("ABCDE"))
	rb.Write([]byte("FGHIJ"))
	out := rb.Bytes()
	expected := []byte("FGHIJ")
	if !bytes.Equal(out, expected) {
		t.Fatalf("after wrap got %q, want %q", out, expected)
	}
}
