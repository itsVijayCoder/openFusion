package discovery

import "testing"

func TestDetectCommandReportsUnavailable(t *testing.T) {
	result := DetectCommand("definitely-not-a-fusion-harness-command")
	if result.Found {
		t.Fatalf("expected command to be unavailable")
	}
	if result.Status != "unavailable" {
		t.Fatalf("expected unavailable status, got %q", result.Status)
	}
}
