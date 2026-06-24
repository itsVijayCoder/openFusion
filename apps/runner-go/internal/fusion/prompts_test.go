package fusion

import (
	"strings"
	"testing"
)

func TestExtractSynthesisAnalysisNoBlock(t *testing.T) {
	output := "This is just a final answer with no analysis block."
	split := extractSynthesisAnalysis(output)
	if split.HasAnalysis {
		t.Fatalf("expected HasAnalysis false when no block present")
	}
	if split.Analysis != "" {
		t.Fatalf("expected empty analysis, got %q", split.Analysis)
	}
	if split.FinalAnswer != output {
		t.Fatalf("expected final answer to be full output, got %q", split.FinalAnswer)
	}
}

func TestExtractSynthesisAnalysisWithBlock(t *testing.T) {
	output := "<synthesis_analysis>\nConsensus: all agree.\nContradictions: none.\n</synthesis_analysis>\n\n# Final Answer\n\nHere is the answer."
	split := extractSynthesisAnalysis(output)
	if !split.HasAnalysis {
		t.Fatalf("expected HasAnalysis true")
	}
	if !strings.Contains(split.Analysis, "Consensus: all agree.") {
		t.Fatalf("expected analysis to contain consensus, got %q", split.Analysis)
	}
	if !strings.HasPrefix(split.FinalAnswer, "# Final Answer") {
		t.Fatalf("expected final answer to start with heading, got %q", split.FinalAnswer)
	}
}

func TestExtractSynthesisAnalysisEmptyOutput(t *testing.T) {
	split := extractSynthesisAnalysis("   ")
	if split.HasAnalysis || split.Analysis != "" || split.FinalAnswer != "" {
		t.Fatalf("expected empty split for blank output, got %+v", split)
	}
}

func TestExtractSynthesisAnalysisOpenTagOnlyNoClose(t *testing.T) {
	output := "<synthesis_analysis>\nConsensus but no close tag.\n\n# Final Answer\nHere it is."
	split := extractSynthesisAnalysis(output)
	if split.HasAnalysis {
		t.Fatalf("expected HasAnalysis false when close tag missing")
	}
	if split.FinalAnswer != output {
		t.Fatalf("expected fallback to full output, got %q", split.FinalAnswer)
	}
}

func TestExtractSynthesisAnalysisTrimsWhitespace(t *testing.T) {
	output := "  <synthesis_analysis>  consensus here  </synthesis_analysis>  answer here  "
	split := extractSynthesisAnalysis(output)
	if !split.HasAnalysis {
		t.Fatalf("expected HasAnalysis true")
	}
	if split.Analysis != "consensus here" {
		t.Fatalf("expected trimmed analysis, got %q", split.Analysis)
	}
	if split.FinalAnswer != "answer here" {
		t.Fatalf("expected trimmed final answer, got %q", split.FinalAnswer)
	}
}

func TestBuildJudgeSynthesisPromptV2ContainsPhases(t *testing.T) {
	panel := []ModelOutput{
		{ModelID: "m1", OutputText: "answer one", Role: "correctness"},
		{ModelID: "m2", OutputText: "answer two", Role: "performance"},
	}
	prompt := buildJudgeSynthesisPromptV2("do the thing", panel, "hint here")
	if !strings.Contains(prompt, "PHASE A — ANALYSIS") {
		t.Fatalf("prompt missing Phase A section")
	}
	if !strings.Contains(prompt, "PHASE B — FINAL ANSWER") {
		t.Fatalf("prompt missing Phase B section")
	}
	if !strings.Contains(prompt, "<synthesis_analysis>") {
		t.Fatalf("prompt missing analysis open tag")
	}
	if !strings.Contains(prompt, "</synthesis_analysis>") {
		t.Fatalf("prompt missing analysis close tag")
	}
	if !strings.Contains(prompt, "m1 (lens: correctness)") {
		t.Fatalf("prompt missing lens annotation for m1")
	}
	if !strings.Contains(prompt, "hint here") {
		t.Fatalf("prompt missing analysis hint")
	}
}

func TestBuildJudgeSynthesisPromptV2NoPanelOutputs(t *testing.T) {
	prompt := buildJudgeSynthesisPromptV2("do the thing", nil, "hint")
	if !strings.Contains(prompt, "No panel outputs were available.") {
		t.Fatalf("expected fallback panel text")
	}
}

func TestSynthesisV2DisabledByDefault(t *testing.T) {
	if synthesisV2Enabled() {
		t.Fatalf("expected synthesis V2 disabled by default")
	}
}
