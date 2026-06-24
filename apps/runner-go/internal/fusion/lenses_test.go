package fusion

import (
	"strings"
	"testing"
)

func TestLensForIndexRoundRobin(t *testing.T) {
	if len(panelLenses) == 0 {
		t.Fatal("expected non-empty panel lens set")
	}
	first := lensForIndex(0)
	if first.Name != panelLenses[0].Name {
		t.Fatalf("expected first lens %s, got %s", panelLenses[0].Name, first.Name)
	}
	wrapped := lensForIndex(len(panelLenses))
	if wrapped.Name != panelLenses[0].Name {
		t.Fatalf("expected wrap to first lens %s, got %s", panelLenses[0].Name, wrapped.Name)
	}
}

func TestBuildPanelPromptWithLensIncludesInstruction(t *testing.T) {
	lens := Lens{Name: "security", Instruction: "Emphasize security and attack surface."}
	prompt := buildPanelPromptWithLens("do the thing", lens)
	if !strings.Contains(prompt, "Emphasize: "+lens.Instruction) {
		t.Fatalf("prompt missing lens instruction: %s", prompt)
	}
	if !strings.Contains(prompt, "still cover the full question") {
		t.Fatalf("prompt missing full-coverage reminder")
	}
}

func TestBuildPanelPromptWithoutLensIsGeneric(t *testing.T) {
	prompt := buildPanelPromptWithLens("do the thing", Lens{})
	if strings.Contains(prompt, "Emphasize:") {
		t.Fatalf("generic prompt should not contain Emphasize line: %s", prompt)
	}
	if !strings.Contains(prompt, "100% best performance") {
		t.Fatalf("generic prompt missing best-performance line")
	}
}

func TestBuildPanelPromptBackwardCompatible(t *testing.T) {
	prompt := buildPanelPrompt("do the thing", "architect")
	if !strings.Contains(prompt, "100% best performance") {
		t.Fatalf("backward-compatible prompt missing expected content")
	}
}

func TestNoDiversityDisabledByDefault(t *testing.T) {
	if noDiversityMode() {
		t.Fatal("expected diversity enabled by default")
	}
}
