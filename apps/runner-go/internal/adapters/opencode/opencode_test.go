package opencode

import (
	"context"
	"os"
	"path/filepath"
	"strings"
	"testing"

	"github.com/asthrix/fusion-harness/apps/runner-go/internal/adapters"
)

func TestParseModelLinesTagsLiveModels(t *testing.T) {
	models := parseModelLines("openai/gpt-5\n- anthropic/claude-sonnet-4-5\n")
	if len(models) != 3 {
		t.Fatalf("expected 3 models including default, got %d", len(models))
	}
	for _, model := range models {
		if model.Availability != "listed" {
			t.Fatalf("expected listed availability, got %q", model.Availability)
		}
		if model.Source != "live" {
			t.Fatalf("expected live source, got %q", model.Source)
		}
	}
}

func TestDefaultModelsOnlyIncludeCliDefault(t *testing.T) {
	models := defaultModels()
	if len(models) != 1 {
		t.Fatalf("expected only default model, got %#v", models)
	}
	if models[0].ID != "opencode/default" || models[0].Source != "live" || models[0].Availability != "detected" {
		t.Fatalf("expected detected CLI default model, got %#v", models[0])
	}
}

func TestRunPassesPromptViaStdin(t *testing.T) {
	workspace := t.TempDir()
	binDir := t.TempDir()
	t.Setenv("PATH", "")
	writeExecutable(
		t,
		binDir,
		"opencode-cli",
		"#!/bin/sh\nif [ \"$1\" = \"--version\" ]; then printf 'opencode 0.0.0\\n'; exit 0; fi\nprintf 'args:%s\\n' \"$*\"\nprintf 'stdin:'\n/bin/cat\n",
	)

	result, err := (Adapter{AllowedRoots: []string{workspace}, ToolDirs: []string{binDir}}).Run(context.Background(), adapters.RunInput{
		RunID:             "run_test",
		JobID:             "job_test",
		WorkspacePath:     workspace,
		Prompt:            "build a thing",
		Model:             "openai/gpt-5",
		PermissionProfile: "workspace_write",
		TimeoutMs:         1000,
	}, nil)
	if err != nil {
		t.Fatal(err)
	}

	firstLine := strings.SplitN(result.OutputText, "\n", 2)[0]
	if !strings.Contains(firstLine, "args:run --format json --dangerously-skip-permissions --model openai/gpt-5 -") {
		t.Fatalf("expected opencode argv to include JSON flags, model, and stdin sentinel, got %q", firstLine)
	}
	if strings.Contains(firstLine, "build a thing") {
		t.Fatalf("expected prompt to be omitted from argv, got %q", firstLine)
	}
	if !strings.Contains(result.OutputText, "stdin:build a thing") {
		t.Fatalf("expected prompt on stdin, got %q", result.OutputText)
	}
}

func writeExecutable(t *testing.T, dir string, name string, content string) string {
	t.Helper()
	path := filepath.Join(dir, name)
	if err := os.WriteFile(path, []byte(content), 0o755); err != nil {
		t.Fatal(err)
	}
	return path
}
