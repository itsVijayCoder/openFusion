package prreview

import (
	"testing"
)

func TestParseResult_ValidJSON(t *testing.T) {
	input := `{
		"summary": "PR looks good with minor issues",
		"riskLevel": "low",
		"decision": "comment",
		"findings": [
			{
				"severity": "minor",
				"category": "performance",
				"filePath": "src/app.ts",
				"side": "RIGHT",
				"line": 42,
				"body": "Consider memoizing this value",
				"confidence": 0.8
			}
		]
	}`

	result, err := ParseResult(input)
	if err != nil {
		t.Fatalf("ParseResult failed: %v", err)
	}
	if result.Summary != "PR looks good with minor issues" {
		t.Errorf("unexpected summary: %s", result.Summary)
	}
	if result.RiskLevel != "low" {
		t.Errorf("unexpected riskLevel: %s", result.RiskLevel)
	}
	if len(result.Findings) != 1 {
		t.Fatalf("expected 1 finding, got %d", len(result.Findings))
	}
	if result.Findings[0].FilePath != "src/app.ts" {
		t.Errorf("unexpected filePath: %s", result.Findings[0].FilePath)
	}
}

func TestParseResult_JSONInCodeFence(t *testing.T) {
	input := "Here is my review:\n\n```json\n" + `{
		"summary": "Review complete",
		"riskLevel": "medium",
		"decision": "request_changes",
		"findings": []
	}` + "\n```\n"

	result, err := ParseResult(input)
	if err != nil {
		t.Fatalf("ParseResult failed: %v", err)
	}
	if result.Decision != "request_changes" {
		t.Errorf("unexpected decision: %s", result.Decision)
	}
}

func TestParseResult_JSONEmbeddedInText(t *testing.T) {
	input := `I reviewed the PR. Here are my findings:

{
	"summary": "Found issues",
	"riskLevel": "high",
	"decision": "request_changes",
	"findings": [
		{"severity": "blocker", "category": "security", "filePath": "auth.ts", "side": "RIGHT", "line": 10, "body": "SQL injection"}
	]
}

That's all.`

	result, err := ParseResult(input)
	if err != nil {
		t.Fatalf("ParseResult failed: %v", err)
	}
	if len(result.Findings) != 1 {
		t.Fatalf("expected 1 finding, got %d", len(result.Findings))
	}
	if result.Findings[0].Severity != "blocker" {
		t.Errorf("unexpected severity: %s", result.Findings[0].Severity)
	}
}

func TestParseResult_InvalidJSON(t *testing.T) {
	input := "This is not JSON at all"

	_, err := ParseResult(input)
	if err == nil {
		t.Fatal("expected error for non-JSON input")
	}
}

func TestParseResult_EmptyOutput(t *testing.T) {
	_, err := ParseResult("")
	if err == nil {
		t.Fatal("expected error for empty input")
	}
}

func TestParseResult_NormalizesInvalidValues(t *testing.T) {
	input := `{
		"summary": "Test",
		"riskLevel": "low",
		"decision": "comment",
		"findings": [
			{"severity": "critical", "category": "unknown", "filePath": "test.ts", "side": "INVALID", "line": 1, "body": "test"}
		]
	}`

	result, err := ParseResult(input)
	if err != nil {
		t.Fatalf("ParseResult failed: %v", err)
	}
	if result.Findings[0].Severity != "minor" {
		t.Errorf("expected severity normalized to minor, got %s", result.Findings[0].Severity)
	}
	if result.Findings[0].Category != "maintainability" {
		t.Errorf("expected category normalized to maintainability, got %s", result.Findings[0].Category)
	}
	if result.Findings[0].Side != "RIGHT" {
		t.Errorf("expected side normalized to RIGHT, got %s", result.Findings[0].Side)
	}
}

func TestParseResult_SortsBySeverity(t *testing.T) {
	input := `{
		"summary": "Test",
		"riskLevel": "low",
		"decision": "comment",
		"findings": [
			{"severity": "nit", "category": "docs", "filePath": "a.ts", "side": "RIGHT", "line": 1, "body": "1"},
			{"severity": "blocker", "category": "bug", "filePath": "b.ts", "side": "RIGHT", "line": 2, "body": "2"},
			{"severity": "major", "category": "bug", "filePath": "c.ts", "side": "RIGHT", "line": 3, "body": "3"}
		]
	}`

	result, err := ParseResult(input)
	if err != nil {
		t.Fatalf("ParseResult failed: %v", err)
	}
	if result.Findings[0].Severity != "blocker" {
		t.Errorf("expected blocker first, got %s", result.Findings[0].Severity)
	}
	if result.Findings[1].Severity != "major" {
		t.Errorf("expected major second, got %s", result.Findings[1].Severity)
	}
	if result.Findings[2].Severity != "nit" {
		t.Errorf("expected nit third, got %s", result.Findings[2].Severity)
	}
}

func TestParseResult_SkipsFindingsWithoutFilePath(t *testing.T) {
	input := `{
		"summary": "Test",
		"riskLevel": "low",
		"decision": "comment",
		"findings": [
			{"severity": "minor", "category": "docs", "filePath": "", "side": "RIGHT", "line": 1, "body": "no file"},
			{"severity": "minor", "category": "docs", "filePath": "real.ts", "side": "RIGHT", "line": 1, "body": "has file"}
		]
	}`

	result, err := ParseResult(input)
	if err != nil {
		t.Fatalf("ParseResult failed: %v", err)
	}
	if len(result.Findings) != 1 {
		t.Fatalf("expected 1 finding after filtering, got %d", len(result.Findings))
	}
	if result.Findings[0].FilePath != "real.ts" {
		t.Errorf("expected real.ts, got %s", result.Findings[0].FilePath)
	}
}