package discovery

import (
	"os"
	"path/filepath"
	"testing"
)

func TestDetectCommandReportsUnavailable(t *testing.T) {
	result := DetectCommand("definitely-not-a-fusion-harness-command")
	if result.Found {
		t.Fatalf("expected command to be unavailable")
	}
	if result.Status != "unavailable" {
		t.Fatalf("expected unavailable status, got %q", result.Status)
	}
}

func TestDetectCommandWithLookupPrefersPrimaryBinary(t *testing.T) {
	dir := t.TempDir()
	fallbackPath := writeExecutable(t, dir, "opencode")
	primaryPath := writeExecutable(t, dir, "opencode-cli")
	t.Setenv("PATH", dir)

	result := DetectCommandWithLookup(CommandLookup{
		Name:             "opencode",
		Binary:           "opencode-cli",
		FallbackBinaries: []string{"opencode"},
	})

	if !result.Found {
		t.Fatalf("expected command to be found: %s", result.Error)
	}
	if result.Path != primaryPath {
		t.Fatalf("expected primary binary %q, got %q; fallback was %q", primaryPath, result.Path, fallbackPath)
	}
	if result.Tool != "opencode" {
		t.Fatalf("expected stable tool name opencode, got %q", result.Tool)
	}
}

func TestDetectCommandWithLookupUsesAbsoluteOverride(t *testing.T) {
	dir := t.TempDir()
	overridePath := writeExecutable(t, dir, "custom-codex")
	t.Setenv("PATH", "")
	t.Setenv("CODEX_BIN", overridePath)

	result := DetectCommandWithLookup(CommandLookup{Name: "codex", Binary: "codex", EnvOverride: "CODEX_BIN"})

	if !result.Found {
		t.Fatalf("expected override to be found: %s", result.Error)
	}
	if result.Path != overridePath {
		t.Fatalf("expected override path %q, got %q", overridePath, result.Path)
	}
	if result.Metadata["override_env"] != "CODEX_BIN" {
		t.Fatalf("expected override metadata, got %#v", result.Metadata)
	}
}

func TestDetectCommandWithLookupRejectsRelativeOverride(t *testing.T) {
	t.Setenv("CODEX_BIN", "codex")

	result := DetectCommandWithLookup(CommandLookup{Name: "codex", Binary: "codex", EnvOverride: "CODEX_BIN"})

	if result.Found {
		t.Fatalf("expected relative override to be rejected")
	}
	if result.Status != "unavailable" {
		t.Fatalf("expected unavailable status, got %q", result.Status)
	}
}

func TestDetectCommandWithLookupSearchesExtraDirs(t *testing.T) {
	dir := t.TempDir()
	binaryPath := writeExecutable(t, dir, "opencode-cli")
	t.Setenv("PATH", "")

	result := DetectCommandWithLookup(CommandLookup{Name: "opencode", Binary: "opencode-cli", ExtraDirs: []string{dir}})

	if !result.Found {
		t.Fatalf("expected command in extra dir to be found: %s", result.Error)
	}
	if result.Path != binaryPath {
		t.Fatalf("expected %q, got %q", binaryPath, result.Path)
	}
	if result.Metadata["source"] != "extra_dir" {
		t.Fatalf("expected extra_dir source metadata, got %#v", result.Metadata)
	}
}

func TestWellKnownUserToolchainBinsIncludesCommonDirs(t *testing.T) {
	home := t.TempDir()
	t.Setenv("HOME", home)
	t.Setenv("FH_AGENT_HOME", "")
	t.Setenv("NPM_CONFIG_PREFIX", "")
	t.Setenv("npm_config_prefix", "")
	t.Setenv("MISE_DATA_DIR", "")
	t.Setenv("FNM_DIR", "")
	t.Setenv("VOLTA_HOME", "")

	dirs := WellKnownUserToolchainBins()

	expected := []string{
		filepath.Join(home, ".local", "bin"),
		filepath.Join(home, ".npm-global", "bin"),
		filepath.Join(home, ".bun", "bin"),
		filepath.Join(home, ".cargo", "bin"),
		filepath.Join(home, ".volta", "bin"),
		filepath.Join(home, ".asdf", "shims"),
		filepath.Join(home, "Library", "pnpm"),
		filepath.Join(home, ".deno", "bin"),
		filepath.Join(home, "go", "bin"),
		filepath.Join(home, ".pyenv", "shims"),
		filepath.Join(home, ".local", "share", "mise", "shims"),
		filepath.Join(home, ".mise", "shims"),
		filepath.Join(home, ".opencode", "bin"),
		filepath.Join(home, ".kimi-code", "bin"),
		filepath.Join(home, ".vite-plus", "bin"),
	}
	dirSet := make(map[string]bool, len(dirs))
	for _, d := range dirs {
		dirSet[d] = true
	}
	for _, e := range expected {
		if !dirSet[e] {
			t.Errorf("expected %q in toolchain bins, not found", e)
		}
	}
}

func TestWellKnownUserToolchainBinsResolvesEnvOverrides(t *testing.T) {
	t.Setenv("HOME", t.TempDir())
	t.Setenv("NPM_CONFIG_PREFIX", "/custom/npm-prefix")
	t.Setenv("MISE_DATA_DIR", "/custom/mise")
	t.Setenv("VOLTA_HOME", "/custom/volta")
	t.Setenv("FH_AGENT_HOME", "/custom/agent-home")

	dirs := WellKnownUserToolchainBins()

	dirSet := make(map[string]bool, len(dirs))
	for _, d := range dirs {
		dirSet[d] = true
	}
	expected := []string{
		"/custom/npm-prefix/bin",
		"/custom/mise/shims",
		"/custom/volta/bin",
		"/custom/agent-home",
		"/custom/agent-home/bin",
	}
	for _, e := range expected {
		if !dirSet[e] {
			t.Errorf("expected %q in toolchain bins, not found", e)
		}
	}
}

func TestWellKnownUserToolchainBinsScansNvmVersions(t *testing.T) {
	home := t.TempDir()
	nvmBase := filepath.Join(home, ".nvm", "versions", "node")
	if err := os.MkdirAll(filepath.Join(nvmBase, "v20.0.0", "bin"), 0o755); err != nil {
		t.Fatal(err)
	}
	if err := os.MkdirAll(filepath.Join(nvmBase, "v22.0.0", "bin"), 0o755); err != nil {
		t.Fatal(err)
	}
	t.Setenv("HOME", home)

	dirs := WellKnownUserToolchainBins()

	dirSet := make(map[string]bool, len(dirs))
	for _, d := range dirs {
		dirSet[d] = true
	}
	if !dirSet[filepath.Join(nvmBase, "v20.0.0", "bin")] {
		t.Errorf("expected nvm v20.0.0 bin dir in toolchain bins")
	}
	if !dirSet[filepath.Join(nvmBase, "v22.0.0", "bin")] {
		t.Errorf("expected nvm v22.0.0 bin dir in toolchain bins")
	}
}

func writeExecutable(t *testing.T, dir string, name string) string {
	t.Helper()
	path := filepath.Join(dir, name)
	if err := os.WriteFile(path, []byte("#!/bin/sh\nexit 0\n"), 0o755); err != nil {
		t.Fatal(err)
	}
	return path
}
