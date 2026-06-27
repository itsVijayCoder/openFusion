package terminal

import (
	"regexp"
	"strings"
)

var (
	ansiRe         = regexp.MustCompile(`\x1b\[[0-9;]*[a-zA-Z]`)
	oscRe          = regexp.MustCompile(`\x1b\][^\x07\x1b]*(\x07|\x1b\\)`)
	charsetRe      = regexp.MustCompile(`\x1b[()][AB012]`)
	cursorRe       = regexp.MustCompile(`\x1b[7-9]`)
	eraseRe        = regexp.MustCompile(`\x1b[JK]`)
	osc52Re        = regexp.MustCompile(`\x1b\]52;c;[^\x07\x1b]*(\x07|\x1b\\)`)
	altScreenOnRe  = regexp.MustCompile(`\x1b\[\?1049h`)
	altScreenOffRe = regexp.MustCompile(`\x1b\[\?1049l`)
)

// stripANSI removes all ANSI escape sequences from a string, leaving plain text.
func stripANSI(s string) string {
	s = oscRe.ReplaceAllString(s, "")
	s = ansiRe.ReplaceAllString(s, "")
	s = charsetRe.ReplaceAllString(s, "")
	s = cursorRe.ReplaceAllString(s, "")
	s = eraseRe.ReplaceAllString(s, "")
	return s
}

// sanitizeForRelay strips dangerous ANSI sequences (OSC 52 clipboard injection)
// from a byte stream before relaying to WebSocket clients. Safe sequences
// (colors, cursor movement, screen modes) are preserved.
func sanitizeForRelay(b []byte) []byte {
	return osc52Re.ReplaceAll(b, []byte{})
}

// stripAlternateScreen removes alternate-screen content between \x1b[?1049h and
// \x1b[?1049l. Full-screen TUI apps use the alternate screen; the content is
// kept but the enter/exit markers are stripped so the text flows naturally.
func stripAlternateScreen(s string) string {
	s = altScreenOnRe.ReplaceAllString(s, "")
	s = altScreenOffRe.ReplaceAllString(s, "")
	return s
}

// collapseBlankLines collapses runs of 3+ consecutive newlines down to 2.
func collapseBlankLines(s string) string {
	for strings.Contains(s, "\n\n\n") {
		s = strings.ReplaceAll(s, "\n\n\n", "\n\n")
	}
	return s
}

// isBoxDrawingOnly returns true if a line consists only of box-drawing
// characters and whitespace (TUI borders).
func isBoxDrawingOnly(s string) bool {
	if strings.TrimSpace(s) == "" {
		return false
	}
	for _, r := range s {
		switch {
		case r == ' ' || r == '\t':
			continue
		case r >= 0x2500 && r <= 0x257F:
			continue
		case r >= 0x2550 && r <= 0x256C:
			continue
		default:
			return false
		}
	}
	return true
}
