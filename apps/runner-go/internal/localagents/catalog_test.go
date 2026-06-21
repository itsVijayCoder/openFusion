package localagents

import (
	"context"
	"fmt"
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

func TestListModelsFallsBackToFallbackModels(t *testing.T) {
	dir := t.TempDir()
	workspace := t.TempDir()
	writeExecutable(
		t,
		dir,
		"cursor-agent",
		"#!/bin/sh\nif [ \"$1\" = \"--version\" ]; then printf 'cursor 1.0.0\\n'; exit 0; fi\nprintf 'No models\\n'\n",
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
				FallbackModels: models("auto", "gpt-5"),
			},
		},
		[]string{workspace},
		[]string{dir},
	)
	if len(models) != 3 {
		t.Fatalf("expected default + 2 fallback models, got %d: %#v", len(models), models)
	}
	for _, m := range models {
		if m.Source != "fallback" {
			t.Fatalf("expected source=fallback for %q, got %q", m.ID, m.Source)
		}
		if m.Availability != "detected" {
			t.Fatalf("expected availability=detected for %q, got %q", m.ID, m.Availability)
		}
	}
	if models[0].ID != "cursor-agent/default" {
		t.Fatalf("expected default model first, got %q", models[0].ID)
	}
}

func TestListModelsUsesFallbackModelsWhenNoListArgs(t *testing.T) {
	dir := t.TempDir()
	workspace := t.TempDir()
	writeExecutable(
		t,
		dir,
		"claude",
		"#!/bin/sh\nif [ \"$1\" = \"--version\" ]; then printf 'claude 1.0.0\\n'; exit 0; fi\n",
	)
	t.Setenv("PATH", "")

	models := listModels(
		context.Background(),
		[]AgentDef{
			{
				ID:            "claude",
				Name:          "Claude Code",
				Binary:        "claude",
				VersionArgs:   []string{"--version"},
				Provider:      "anthropic",
				FallbackModels: models("sonnet", "opus", "haiku"),
			},
		},
		[]string{workspace},
		[]string{dir},
	)
	if len(models) != 4 {
		t.Fatalf("expected default + 3 fallback models, got %d: %#v", len(models), models)
	}
	for _, m := range models {
		if m.Source != "fallback" {
			t.Fatalf("expected source=fallback for %q, got %q", m.ID, m.Source)
		}
		if m.Availability != "detected" {
			t.Fatalf("expected availability=detected for %q, got %q", m.ID, m.Availability)
		}
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

func TestListModelsUsesFetchModels(t *testing.T) {
	dir := t.TempDir()
	workspace := t.TempDir()
	writeExecutable(
		t,
		dir,
		"kiro",
		"#!/bin/sh\nif [ \"$1\" = \"--version\" ]; then printf 'kiro 1.0.0\\n'; exit 0; fi\n",
	)
	t.Setenv("PATH", "")

	called := false
	defs := []AgentDef{
		{
			ID:          "kiro",
			Name:        "Kiro CLI",
			Binary:      "kiro",
			VersionArgs: []string{"--version"},
			FetchModels: func(ctx context.Context, def AgentDef, path string, allowedRoots []string) ([]ModelOption, error) {
				called = true
				return []ModelOption{
					model("default", "Default (CLI config)"),
					model("claude-sonnet-4", "Claude Sonnet 4"),
					model("claude-opus-4", "Claude Opus 4"),
				}, nil
			},
			FallbackModels: models("default"),
		},
	}

	models := listModels(context.Background(), defs, []string{workspace}, []string{dir})
	if !called {
		t.Fatal("expected FetchModels to be called")
	}
	if len(models) != 3 {
		t.Fatalf("expected 3 models from FetchModels, got %d: %#v", len(models), models)
	}
	for _, m := range models {
		if m.Source != "live" {
			t.Fatalf("expected source=live for %q, got %q", m.ID, m.Source)
		}
		if m.Availability != "listed" {
			t.Fatalf("expected availability=listed for %q, got %q", m.ID, m.Availability)
		}
	}
}

func TestListModelsFallsBackWhenFetchModelsErrors(t *testing.T) {
	dir := t.TempDir()
	workspace := t.TempDir()
	writeExecutable(
		t,
		dir,
		"kiro",
		"#!/bin/sh\nif [ \"$1\" = \"--version\" ]; then printf 'kiro 1.0.0\\n'; exit 0; fi\n",
	)
	t.Setenv("PATH", "")

	defs := []AgentDef{
		{
			ID:          "kiro",
			Name:        "Kiro CLI",
			Binary:      "kiro",
			VersionArgs: []string{"--version"},
			FetchModels: func(ctx context.Context, def AgentDef, path string, allowedRoots []string) ([]ModelOption, error) {
				return nil, fmt.Errorf("acp handshake failed")
			},
			FallbackModels: models("sonnet", "opus"),
		},
	}

	models := listModels(context.Background(), defs, []string{workspace}, []string{dir})
	if len(models) != 3 {
		t.Fatalf("expected default + 2 fallback models, got %d: %#v", len(models), models)
	}
	for _, m := range models {
		if m.Source != "fallback" {
			t.Fatalf("expected source=fallback for %q, got %q", m.ID, m.Source)
		}
	}
}

func TestParsePiModels(t *testing.T) {
	output := "provider         model                  context  max-out  thinking  images\n" +
		"anthropic        claude-sonnet-4-5      200K      64K      yes        yes\n" +
		"openai           gpt-5                  128K      32K      yes        no\n" +
		"google           gemini-2.5-pro        1M        128K     yes        yes\n"
	models := ParsePiModels(output)
	if len(models) != 4 {
		t.Fatalf("expected default + 3 models, got %d: %#v", len(models), models)
	}
	if models[0].ID != "default" {
		t.Fatalf("expected default first, got %q", models[0].ID)
	}
	if models[1].ID != "anthropic/claude-sonnet-4-5" {
		t.Fatalf("expected anthropic/claude-sonnet-4-5, got %q", models[1].ID)
	}
	if models[2].ID != "openai/gpt-5" {
		t.Fatalf("expected openai/gpt-5, got %q", models[2].ID)
	}
	if models[3].ID != "google/gemini-2.5-pro" {
		t.Fatalf("expected google/gemini-2.5-pro, got %q", models[3].ID)
	}
}

func TestParsePiModelsEmpty(t *testing.T) {
	models := ParsePiModels("")
	if models != nil {
		t.Fatalf("expected nil for empty output, got %#v", models)
	}
}

func TestParsePiModelsHeaderOnly(t *testing.T) {
	models := ParsePiModels("provider         model                  context\n")
	if models != nil {
		t.Fatalf("expected nil for header-only output, got %#v", models)
	}
}

func TestParsePiModelsSkipsComments(t *testing.T) {
	output := "# comment line\n" +
		"provider         model\n" +
		"anthropic        claude-sonnet-4-5\n"
	models := ParsePiModels(output)
	if len(models) != 2 {
		t.Fatalf("expected default + 1 model, got %d: %#v", len(models), models)
	}
	if models[1].ID != "anthropic/claude-sonnet-4-5" {
		t.Fatalf("expected anthropic/claude-sonnet-4-5, got %q", models[1].ID)
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
