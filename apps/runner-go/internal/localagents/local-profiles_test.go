package localagents

import (
	"os"
	"path/filepath"
	"testing"
)

func TestReadLocalAgentProfilesEmpty(t *testing.T) {
	t.Setenv("FH_AGENT_PROFILES_CONFIG", "")
	home := t.TempDir()
	t.Setenv("HOME", home)
	defs := readLocalAgentProfiles(baseCatalog())
	if len(defs) != 0 {
		t.Fatalf("expected no profiles when file missing, got %d", len(defs))
	}
}

func TestReadLocalAgentProfilesArray(t *testing.T) {
	dir := t.TempDir()
	configPath := filepath.Join(dir, "agents.local.json")
	config := `[
		{
			"id": "my-claude-fork",
			"baseAgent": "claude",
			"bin": "my-claude",
			"name": "My Claude Fork",
			"models": ["sonnet", "opus"]
		},
		{
			"id": "custom-gemini",
			"baseAgent": "gemini",
			"models": ["gemini-3-pro", "gemini-3-flash"]
		}
	]`
	if err := os.WriteFile(configPath, []byte(config), 0o644); err != nil {
		t.Fatal(err)
	}
	t.Setenv("FH_AGENT_PROFILES_CONFIG", configPath)

	defs := readLocalAgentProfiles(baseCatalog())
	if len(defs) != 2 {
		t.Fatalf("expected 2 profiles, got %d: %#v", len(defs), defs)
	}
	if defs[0].ID != "my-claude-fork" {
		t.Fatalf("expected my-claude-fork, got %q", defs[0].ID)
	}
	if defs[0].Name != "My Claude Fork" {
		t.Fatalf("expected My Claude Fork, got %q", defs[0].Name)
	}
	if defs[0].Binary != "my-claude" {
		t.Fatalf("expected my-claude binary, got %q", defs[0].Binary)
	}
	if defs[0].Provider != "anthropic" {
		t.Fatalf("expected inherited provider anthropic, got %q", defs[0].Provider)
	}
	if len(defs[0].FallbackModels) != 3 {
		t.Fatalf("expected default + 2 fallback models, got %d: %#v", len(defs[0].FallbackModels), defs[0].FallbackModels)
	}
	if defs[1].ID != "custom-gemini" {
		t.Fatalf("expected custom-gemini, got %q", defs[1].ID)
	}
	if defs[1].Binary != "gemini" {
		t.Fatalf("expected inherited gemini binary, got %q", defs[1].Binary)
	}
}

func TestReadLocalAgentProfilesWrapperObject(t *testing.T) {
	dir := t.TempDir()
	configPath := filepath.Join(dir, "agents.local.json")
	config := `{"agents": [{"id": "wrapped-agent", "baseAgent": "codex"}]}`
	if err := os.WriteFile(configPath, []byte(config), 0o644); err != nil {
		t.Fatal(err)
	}
	t.Setenv("FH_AGENT_PROFILES_CONFIG", configPath)

	defs := readLocalAgentProfiles(baseCatalog())
	if len(defs) != 1 {
		t.Fatalf("expected 1 profile, got %d", len(defs))
	}
	if defs[0].ID != "wrapped-agent" {
		t.Fatalf("expected wrapped-agent, got %q", defs[0].ID)
	}
}

func TestReadLocalAgentProfilesSkipsInvalidID(t *testing.T) {
	dir := t.TempDir()
	configPath := filepath.Join(dir, "agents.local.json")
	config := `[
		{"id": "valid-agent", "baseAgent": "claude"},
		{"id": "", "baseAgent": "claude"},
		{"id": "invalid space", "baseAgent": "claude"}
	]`
	if err := os.WriteFile(configPath, []byte(config), 0o644); err != nil {
		t.Fatal(err)
	}
	t.Setenv("FH_AGENT_PROFILES_CONFIG", configPath)

	defs := readLocalAgentProfiles(baseCatalog())
	if len(defs) != 1 {
		t.Fatalf("expected 1 valid profile, got %d: %#v", len(defs), defs)
	}
	if defs[0].ID != "valid-agent" {
		t.Fatalf("expected valid-agent, got %q", defs[0].ID)
	}
}

func TestReadLocalAgentProfilesSkipsDuplicateID(t *testing.T) {
	dir := t.TempDir()
	configPath := filepath.Join(dir, "agents.local.json")
	config := `[
		{"id": "claude", "baseAgent": "gemini"},
		{"id": "unique-agent", "baseAgent": "claude"}
	]`
	if err := os.WriteFile(configPath, []byte(config), 0o644); err != nil {
		t.Fatal(err)
	}
	t.Setenv("FH_AGENT_PROFILES_CONFIG", configPath)

	defs := readLocalAgentProfiles(baseCatalog())
	if len(defs) != 1 {
		t.Fatalf("expected 1 profile (duplicate claude skipped), got %d: %#v", len(defs), defs)
	}
	if defs[0].ID != "unique-agent" {
		t.Fatalf("expected unique-agent, got %q", defs[0].ID)
	}
}

func TestReadLocalAgentProfilesSkipsUnknownBaseAgent(t *testing.T) {
	dir := t.TempDir()
	configPath := filepath.Join(dir, "agents.local.json")
	config := `[{"id": "orphan", "baseAgent": "nonexistent-agent"}]`
	if err := os.WriteFile(configPath, []byte(config), 0o644); err != nil {
		t.Fatal(err)
	}
	t.Setenv("FH_AGENT_PROFILES_CONFIG", configPath)

	defs := readLocalAgentProfiles(baseCatalog())
	if len(defs) != 0 {
		t.Fatalf("expected 0 profiles for unknown base, got %d: %#v", len(defs), defs)
	}
}

func TestReadLocalAgentProfilesDefaultsToClaudeBase(t *testing.T) {
	dir := t.TempDir()
	configPath := filepath.Join(dir, "agents.local.json")
	config := `[{"id": "no-base-specified"}]`
	if err := os.WriteFile(configPath, []byte(config), 0o644); err != nil {
		t.Fatal(err)
	}
	t.Setenv("FH_AGENT_PROFILES_CONFIG", configPath)

	defs := readLocalAgentProfiles(baseCatalog())
	if len(defs) != 1 {
		t.Fatalf("expected 1 profile, got %d", len(defs))
	}
	if defs[0].Binary != "claude" {
		t.Fatalf("expected inherited claude binary, got %q", defs[0].Binary)
	}
	if defs[0].Provider != "anthropic" {
		t.Fatalf("expected inherited anthropic provider, got %q", defs[0].Provider)
	}
}

func TestReadLocalAgentProfilesInvalidJSON(t *testing.T) {
	dir := t.TempDir()
	configPath := filepath.Join(dir, "agents.local.json")
	if err := os.WriteFile(configPath, []byte("not json"), 0o644); err != nil {
		t.Fatal(err)
	}
	t.Setenv("FH_AGENT_PROFILES_CONFIG", configPath)

	defs := readLocalAgentProfiles(baseCatalog())
	if len(defs) != 0 {
		t.Fatalf("expected 0 profiles for invalid JSON, got %d", len(defs))
	}
}

func TestCatalogIncludesLocalProfiles(t *testing.T) {
	dir := t.TempDir()
	configPath := filepath.Join(dir, "agents.local.json")
	config := `[{"id": "catalog-test-agent", "baseAgent": "claude"}]`
	if err := os.WriteFile(configPath, []byte(config), 0o644); err != nil {
		t.Fatal(err)
	}
	t.Setenv("FH_AGENT_PROFILES_CONFIG", configPath)

	all := Catalog()
	found := false
	for _, def := range all {
		if def.ID == "catalog-test-agent" {
			found = true
			break
		}
	}
	if !found {
		t.Fatal("expected local profile to appear in Catalog()")
	}
}