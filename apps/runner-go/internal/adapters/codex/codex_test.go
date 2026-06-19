package codex

import (
	"context"
	"os"
	"path/filepath"
	"strings"
	"testing"

	"github.com/asthrix/fusion-harness/apps/runner-go/internal/adapters"
)

func TestListModelsReturnsOnlyCliDefaultWhenListingFails(t *testing.T) {
	dir := t.TempDir()
	writeExecutable(t, dir, "codex")
	t.Setenv("PATH", "")

	models, err := (Adapter{ToolDirs: []string{dir}}).ListModels(context.Background())
	if err != nil {
		t.Fatal(err)
	}

	if len(models) != 1 {
		t.Fatalf("expected only default model, got %#v", models)
	}
	if models[0].ID != "codex/default" || models[0].Source != "live" || models[0].Availability != "detected" {
		t.Fatalf("expected detected CLI default model, got %#v", models[0])
	}
}

func TestListModelsUsesCodexDebugModels(t *testing.T) {
	workspace := t.TempDir()
	binDir := t.TempDir()
	t.Setenv("PATH", "")
	writeExecutable(
		t,
		binDir,
		"codex",
		"#!/bin/sh\nif [ \"$1\" = \"--version\" ]; then printf 'codex 0.0.0\\n'; exit 0; fi\nprintf '{\"models\":[{\"slug\":\"gpt-5-live\",\"display_name\":\"GPT 5 Live\"},{\"slug\":\"hidden-model\",\"visibility\":\"hidden\"}]}'\n",
	)

	models, err := (Adapter{AllowedRoots: []string{workspace}, ToolDirs: []string{binDir}}).ListModels(context.Background())
	if err != nil {
		t.Fatal(err)
	}

	ids := map[string]adapters.ModelRef{}
	for _, model := range models {
		ids[model.ID] = model
	}
	if ids["codex/default"].Source != "live" {
		t.Fatalf("expected default to be included in live list, got %#v", ids["codex/default"])
	}
	if ids["codex/gpt-5-live"].DisplayName != "GPT 5 Live" || ids["codex/gpt-5-live"].Availability != "listed" {
		t.Fatalf("expected live debug model, got %#v", ids["codex/gpt-5-live"])
	}
	if _, ok := ids["codex/hidden-model"]; ok {
		t.Fatalf("expected hidden model to be omitted")
	}
}

func TestRunPassesPromptViaStdin(t *testing.T) {
	workspace := t.TempDir()
	binDir := t.TempDir()
	t.Setenv("PATH", "")
	writeExecutable(
		t,
		binDir,
		"codex",
		"#!/bin/sh\nif [ \"$1\" = \"--version\" ]; then printf 'codex 0.0.0\\n'; exit 0; fi\nprintf 'args:%s\\n' \"$*\"\nprintf 'stdin:'\n/bin/cat\n",
	)

	result, err := (Adapter{AllowedRoots: []string{workspace}, ToolDirs: []string{binDir}}).Run(context.Background(), adaptersRunInput(workspace), nil)
	if err != nil {
		t.Fatal(err)
	}

	firstLine := strings.SplitN(result.OutputText, "\n", 2)[0]
	if !strings.Contains(firstLine, "args:exec --json --skip-git-repo-check --sandbox workspace-write --model gpt-5") {
		t.Fatalf("expected codex argv to include JSON flags and model, got %q", firstLine)
	}
	if strings.Contains(firstLine, "build a thing") {
		t.Fatalf("expected prompt to be omitted from argv, got %q", firstLine)
	}
	if !strings.Contains(result.OutputText, "stdin:build a thing") {
		t.Fatalf("expected prompt on stdin, got %q", result.OutputText)
	}
}

func adaptersRunInput(workspace string) adapters.RunInput {
	return adapters.RunInput{
		RunID:             "run_test",
		JobID:             "job_test",
		WorkspacePath:     workspace,
		Prompt:            "build a thing",
		Model:             "gpt-5",
		PermissionProfile: "workspace_write",
		TimeoutMs:         1000,
	}
}

func writeExecutable(t *testing.T, dir string, name string, content ...string) string {
	t.Helper()
	path := filepath.Join(dir, name)
	body := "#!/bin/sh\nprintf 'codex 0.0.0\\n'\n"
	if len(content) > 0 {
		body = content[0]
	}
	if err := os.WriteFile(path, []byte(body), 0o755); err != nil {
		t.Fatal(err)
	}
	return path
}
