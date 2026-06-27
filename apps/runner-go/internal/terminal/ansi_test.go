package terminal

import (
	"strings"
	"testing"
)

func TestStripANSI(t *testing.T) {
	input := "\x1b[32mgreen text\x1b[0m"
	out := stripANSI(input)
	if out != "green text" {
		t.Fatalf("got %q, want %q", out, "green text")
	}
}

func TestStripANSIWithCursor(t *testing.T) {
	input := "\x1b[2J\x1b[Hhello\x1b[2K"
	out := stripANSI(input)
	if !strings.Contains(out, "hello") {
		t.Fatalf("expected 'hello' in %q", out)
	}
}

func TestStripANSIOSC(t *testing.T) {
	input := "\x1b]0;title\x07hello"
	out := stripANSI(input)
	if out != "hello" {
		t.Fatalf("got %q, want %q", out, "hello")
	}
}

func TestSanitizeForRelayStripsOSC52(t *testing.T) {
	input := []byte("\x1b]52;c;base64,aGVsbG8=\x07hello")
	out := sanitizeForRelay(input)
	if strings.Contains(string(out), "52") {
		t.Fatalf("OSC 52 not stripped: %q", out)
	}
	if !strings.Contains(string(out), "hello") {
		t.Fatalf("expected 'hello' preserved in %q", out)
	}
}

func TestCollapseBlankLines(t *testing.T) {
	input := "a\n\n\n\n\nb"
	out := collapseBlankLines(input)
	if out != "a\n\nb" {
		t.Fatalf("got %q, want %q", out, "a\n\nb")
	}
}

func TestIsBoxDrawingOnly(t *testing.T) {
	if !isBoxDrawingOnly("╔══╗") {
		t.Fatal("expected box drawing to be detected")
	}
	if isBoxDrawingOnly("hello") {
		t.Fatal("expected text to not be box drawing")
	}
}

func TestStripAlternateScreen(t *testing.T) {
	input := "\x1b[?1049hTUI content\x1b[?1049l"
	out := stripAlternateScreen(input)
	if strings.Contains(out, "1049") {
		t.Fatalf("alternate screen markers not stripped: %q", out)
	}
	if !strings.Contains(out, "TUI content") {
		t.Fatalf("content not preserved: %q", out)
	}
}
