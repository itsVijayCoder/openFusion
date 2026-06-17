package localagents

import (
	"context"
	"os"
	"path/filepath"
	"testing"
)

func TestDetectUsesCustomToolForCatalogAgents(t *testing.T) {
	dir := t.TempDir()
	writeExecutable(t, dir, "openclaude", "#!/bin/sh\nprintf 'claude 1.0.0\\n'\n")
	t.Setenv("PATH", "")

	tool := Detect(context.Background(), AgentDef{
		ID:               "claude",
		Name:             "Claude Code",
		Binary:           "claude",
		FallbackBinaries: []string{"openclaude"},
		VersionArgs:      []string{"--version"},
	}, []string{dir})

	if !tool.Found {
		t.Fatalf("expected fallback binary to be detected: %s", tool.Error)
	}
	if tool.Tool != "custom" {
		t.Fatalf("expected non-native agent to register as custom tool, got %q", tool.Tool)
	}
	if tool.Metadata["agentId"] != "claude" {
		t.Fatalf("expected agentId metadata, got %#v", tool.Metadata)
	}
}

func TestListModelsUsesLiveModelListing(t *testing.T) {
	dir := t.TempDir()
	workspace := t.TempDir()
	writeExecutable(
		t,
		dir,
		"cursor-agent",
		"#!/bin/sh\nif [ \"$1\" = \"--version\" ]; then printf 'cursor 1.0.0\\n'; exit 0; fi\nprintf 'gpt-5\\nsonnet-4\\n'\n",
	)
	t.Setenv("PATH", "")

	models := listModels(
		context.Background(),
		[]AgentDef{
			{
				ID:             "cursor-agent",
				Name:           "Cursor Agent",
				Binary:         "cursor-agent",
				VersionArgs:    []string{"--version"},
				ListModelsArgs: []string{"models"},
				FallbackModels: models("auto"),
			},
		},
		[]string{workspace},
		[]string{dir},
	)
	var found bool
	for _, model := range models {
		if model.ID == "cursor-agent/gpt-5" {
			found = true
			if model.Source != "live" || model.Availability != "listed" {
				t.Fatalf("expected live listed model, got source=%q availability=%q", model.Source, model.Availability)
			}
		}
	}
	if !found {
		t.Fatalf("expected cursor-agent/gpt-5 in live models")
	}
}

func TestParseCodexDebugModels(t *testing.T) {
	models := ParseCodexDebugModels(`{"models":[{"slug":"gpt-5-live","display_name":"GPT 5 Live"},{"id":"o4-mini"},{"slug":"hidden","visibility":"hidden"}]}`)

	if len(models) != 3 {
		t.Fatalf("expected default plus 2 visible models, got %d", len(models))
	}
	if models[0].ID != "default" {
		t.Fatalf("expected default option first, got %q", models[0].ID)
	}
	if models[1].ID != "gpt-5-live" || models[1].DisplayName != "GPT 5 Live" {
		t.Fatalf("expected display name from debug payload, got %#v", models[1])
	}
	if models[2].ID != "o4-mini" {
		t.Fatalf("expected id fallback, got %#v", models[2])
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
