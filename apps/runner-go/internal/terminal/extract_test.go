package terminal

import (
	"strings"
	"testing"
)

func TestSentinelStrategyExtractsAnswer(t *testing.T) {
	s := NewSentinelStrategy()
	stream := []byte("some reasoning here\n===FUSION_ANSWER_START===\nThis is the answer.\n===FUSION_ANSWER_END===\n")
	result := s.Process(stream)
	if result == nil {
		t.Fatal("expected result, got nil")
	}
	if result.Strategy != "sentinel" {
		t.Fatalf("strategy %s, want sentinel", result.Strategy)
	}
	if result.Answer != "This is the answer." {
		t.Fatalf("answer %q, want %q", result.Answer, "This is the answer.")
	}
	if result.Confidence < 0.6 {
		t.Fatalf("confidence %f too low", result.Confidence)
	}
}

func TestSentinelStrategyShortAnswer(t *testing.T) {
	s := NewSentinelStrategy()
	stream := []byte("===FUSION_ANSWER_START===\nhi\n===FUSION_ANSWER_END===\n")
	result := s.Process(stream)
	if result == nil {
		t.Fatal("expected result")
	}
	if result.Confidence > 0.6 {
		t.Fatalf("short answer confidence %f should be <= 0.6", result.Confidence)
	}
}

func TestSentinelStrategyNoMarkers(t *testing.T) {
	s := NewSentinelStrategy()
	s.Process([]byte("just some text without markers"))
	result := s.Finalize()
	if result != nil {
		t.Fatal("expected nil when no markers found")
	}
}

func TestSentinelStrategyStartOnlyFinalize(t *testing.T) {
	s := NewSentinelStrategy()
	s.Process([]byte("===FUSION_ANSWER_START===\npartial answer without end"))
	result := s.Finalize()
	if result == nil {
		t.Fatal("expected result from finalize")
	}
	if !strings.Contains(result.Answer, "partial answer") {
		t.Fatalf("answer %q should contain partial answer", result.Answer)
	}
	if result.Confidence > 0.5 {
		t.Fatalf("confidence %f should be <= 0.5 for incomplete markers", result.Confidence)
	}
}

func TestSentinelStrategyWithANSI(t *testing.T) {
	s := NewSentinelStrategy()
	stream := []byte("\x1b[32m===FUSION_ANSWER_START===\x1b[0m\n\x1b[33mcolored answer\x1b[0m\n\x1b[32m===FUSION_ANSWER_END===\x1b[0m\n")
	result := s.Process(stream)
	if result == nil {
		t.Fatal("expected result")
	}
	if strings.Contains(result.Answer, "\x1b") {
		t.Fatalf("ANSI not stripped: %q", result.Answer)
	}
}

func TestSentinelStrategyChunkedInput(t *testing.T) {
	s := NewSentinelStrategy()
	s.Process([]byte("===FUSION_ANSWER_START"))
	s.Process([]byte("===\nchunked "))
	s.Process([]byte("answer\n===FUSION_ANSWER_END===\n"))
	result := s.Process([]byte(""))
	if result == nil {
		result = s.Finalize()
	}
	if result == nil {
		t.Fatal("expected result from chunked input")
	}
	if result.Answer != "chunked answer" {
		t.Fatalf("answer %q, want %q", result.Answer, "chunked answer")
	}
}

func TestNDJSONStrategyExtractsText(t *testing.T) {
	s := NewNDJSONStrategy()
	stream := []byte(`{"type":"message","text":"hello world"}` + "\n" + `{"type":"result","text":"final answer"}` + "\n")
	s.Process(stream)
	result := s.Finalize()
	if result == nil {
		t.Fatal("expected result")
	}
	if result.Strategy != "ndjson" {
		t.Fatalf("strategy %s, want ndjson", result.Strategy)
	}
	if !strings.Contains(result.Answer, "hello world") {
		t.Fatalf("answer missing 'hello world': %q", result.Answer)
	}
	if !strings.Contains(result.Answer, "final answer") {
		t.Fatalf("answer missing 'final answer': %q", result.Answer)
	}
	if result.Confidence < 0.7 {
		t.Fatalf("confidence %f too low", result.Confidence)
	}
}

func TestNDJSONStrategyNestedText(t *testing.T) {
	s := NewNDJSONStrategy()
	stream := []byte(`{"type":"message","part":{"text":"nested content here"}}` + "\n")
	s.Process(stream)
	result := s.Finalize()
	if result == nil {
		t.Fatal("expected result")
	}
	if !strings.Contains(result.Answer, "nested content") {
		t.Fatalf("answer %q missing nested content", result.Answer)
	}
}

func TestNDJSONStrategyNoJSON(t *testing.T) {
	s := NewNDJSONStrategy()
	s.Process([]byte("just plain text\nno json here\n"))
	result := s.Finalize()
	if result != nil {
		t.Fatal("expected nil for non-JSON input")
	}
}

func TestNDJSONStrategyContentField(t *testing.T) {
	s := NewNDJSONStrategy()
	stream := []byte(`{"type":"completed","content":"answer via content field"}` + "\n")
	s.Process(stream)
	result := s.Finalize()
	if result == nil {
		t.Fatal("expected result")
	}
	if !strings.Contains(result.Answer, "answer via content field") {
		t.Fatalf("answer %q", result.Answer)
	}
}

func TestScrollbackStrategyStripsChrome(t *testing.T) {
	rb := NewRingBuffer(8 * 1024 * 1024)
	output := "Loading...\n" +
		"░░░░░░░░\n" +
		"real answer line one\n" +
		"⠋\n" +
		"real answer line two\n" +
		"╔══════╗\n"
	rb.Write([]byte(output))

	s := NewScrollbackStrategy(rb)
	result := s.Finalize()
	if result == nil {
		t.Fatal("expected result")
	}
	if !strings.Contains(result.Answer, "real answer line one") {
		t.Fatalf("answer missing real content: %q", result.Answer)
	}
	if strings.Contains(result.Answer, "Loading...") {
		t.Fatalf("chrome not stripped: %q", result.Answer)
	}
	if strings.Contains(result.Answer, "░") {
		t.Fatalf("progress bar not stripped: %q", result.Answer)
	}
}

func TestScrollbackStrategyEmptyBuffer(t *testing.T) {
	rb := NewRingBuffer(1024)
	s := NewScrollbackStrategy(rb)
	result := s.Finalize()
	if result != nil {
		t.Fatal("expected nil for empty buffer")
	}
}

func TestScrollbackStrategyStripsANSI(t *testing.T) {
	rb := NewRingBuffer(8 * 1024 * 1024)
	rb.Write([]byte("\x1b[32mcolored text\x1b[0m\nmore text\n"))
	s := NewScrollbackStrategy(rb)
	result := s.Finalize()
	if result == nil {
		t.Fatal("expected result")
	}
	if strings.Contains(result.Answer, "\x1b") {
		t.Fatalf("ANSI not stripped: %q", result.Answer)
	}
}

func TestProcessExitStrategyReturnsRawText(t *testing.T) {
	rb := NewRingBuffer(8 * 1024 * 1024)
	rb.Write([]byte("\x1b[32mraw output\x1b[0m\n"))
	s := NewProcessExitStrategy(rb)
	result := s.Finalize()
	if result == nil {
		t.Fatal("expected result")
	}
	if result.Answer != "raw output" {
		t.Fatalf("answer %q, want %q", result.Answer, "raw output")
	}
	if result.Confidence > 0.3 {
		t.Fatalf("confidence %f should be low", result.Confidence)
	}
}

func TestProcessExitStrategyEmptyBuffer(t *testing.T) {
	rb := NewRingBuffer(1024)
	s := NewProcessExitStrategy(rb)
	result := s.Finalize()
	if result == nil {
		t.Fatal("expected result even for empty buffer")
	}
	if result.Answer != "" {
		t.Fatalf("expected empty answer, got %q", result.Answer)
	}
	if result.Confidence != 0.0 {
		t.Fatalf("confidence %f should be 0", result.Confidence)
	}
}

func TestExtractorSentinelWinsOverScrollback(t *testing.T) {
	rb := NewRingBuffer(8 * 1024 * 1024)
	extractor := NewExtractor(rb)

	go extractor.Run()

	chunk := []byte("some chrome here\n===FUSION_ANSWER_START===\nextracted answer\n===FUSION_ANSWER_END===\n")
	rb.Write(chunk)
	extractor.Input <- chunk
	close(extractor.Done)

	result := <-extractor.ResultCh
	if result.Strategy != "sentinel" {
		t.Fatalf("expected sentinel strategy, got %s", result.Strategy)
	}
	if result.Answer != "extracted answer" {
		t.Fatalf("answer %q, want %q", result.Answer, "extracted answer")
	}
}

func TestExtractorNDJSONWhenNoSentinel(t *testing.T) {
	rb := NewRingBuffer(8 * 1024 * 1024)
	extractor := NewExtractor(rb)

	go extractor.Run()

	chunk := []byte(`{"type":"message","text":"json answer"}` + "\n")
	rb.Write(chunk)
	extractor.Input <- chunk
	close(extractor.Done)

	result := <-extractor.ResultCh
	if result.Strategy != "ndjson" {
		t.Fatalf("expected ndjson strategy, got %s", result.Strategy)
	}
	if !strings.Contains(result.Answer, "json answer") {
		t.Fatalf("answer %q", result.Answer)
	}
}

func TestExtractorScrollbackFallback(t *testing.T) {
	rb := NewRingBuffer(8 * 1024 * 1024)
	extractor := NewExtractor(rb)

	go extractor.Run()

	chunk := []byte("plain text answer with enough length to pass threshold here\n")
	rb.Write(chunk)
	extractor.Input <- chunk
	close(extractor.Done)

	result := <-extractor.ResultCh
	if result.Strategy != "scrollback" && result.Strategy != "process_exit" {
		t.Fatalf("expected scrollback or process_exit, got %s", result.Strategy)
	}
	if !strings.Contains(result.Answer, "plain text answer") {
		t.Fatalf("answer %q", result.Answer)
	}
}

func TestExtractorNeverReturnsEmptyWhenOutputExists(t *testing.T) {
	rb := NewRingBuffer(8 * 1024 * 1024)
	extractor := NewExtractor(rb)

	go extractor.Run()

	chunk := []byte("some output\n")
	rb.Write(chunk)
	extractor.Input <- chunk
	close(extractor.Done)

	result := <-extractor.ResultCh
	if result.Answer == "" {
		t.Fatal("extractor returned empty answer when output existed")
	}
}
