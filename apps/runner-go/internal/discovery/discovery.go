package discovery

import (
	"context"
	"fmt"
	"os"
	"os/exec"
	"path/filepath"
	"runtime"
	"strings"
	"time"
)

type Tool struct {
	Tool     string         `json:"tool"`
	Found    bool           `json:"found"`
	Path     string         `json:"path,omitempty"`
	Version  string         `json:"version,omitempty"`
	Status   string         `json:"status"`
	Error    string         `json:"error,omitempty"`
	Metadata map[string]any `json:"metadata,omitempty"`
}

type Report struct {
	RunnerID string `json:"runner_id"`
	OS       string `json:"os"`
	Arch     string `json:"arch"`
	Tools    []Tool `json:"tools"`
	Models   []any  `json:"models,omitempty"`
}

type CommandLookup struct {
	Name             string
	Binary           string
	FallbackBinaries []string
	EnvOverride      string
	ExtraDirs        []string
}

func DetectCommand(name string) Tool {
	return DetectCommandWithLookup(CommandLookup{Name: name})
}

func DetectCommandWithLookup(lookup CommandLookup) Tool {
	lookup = normalizeLookup(lookup)
	metadata := map[string]any{}

	if lookup.EnvOverride != "" {
		override := strings.TrimSpace(os.Getenv(lookup.EnvOverride))
		if override != "" {
			metadata["override_env"] = lookup.EnvOverride
			if !filepath.IsAbs(override) {
				return unavailableTool(lookup.Name, fmt.Sprintf("%s must be an absolute path", lookup.EnvOverride), metadata)
			}
			tool, err := toolFromPath(lookup.Name, override, metadata)
			if err != nil {
				return unavailableTool(lookup.Name, err.Error(), metadata)
			}
			return tool
		}
	}

	candidates := append([]string{lookup.Binary}, lookup.FallbackBinaries...)
	for _, binary := range candidates {
		path, source, err := lookPath(binary, lookup.ExtraDirs)
		if err != nil {
			continue
		}
		metadata["binary"] = binary
		metadata["source"] = source
		return Tool{Tool: lookup.Name, Found: true, Path: path, Status: "detected", Metadata: metadata}
	}

	return unavailableTool(lookup.Name, fmt.Sprintf("executable not found: %s", strings.Join(candidates, ", ")), nil)
}

func DetectCommandWithVersion(ctx context.Context, name string, versionArgs ...string) Tool {
	return DetectCommandWithVersionLookup(ctx, CommandLookup{Name: name}, versionArgs...)
}

func DetectCommandWithVersionLookup(ctx context.Context, lookup CommandLookup, versionArgs ...string) Tool {
	tool := DetectCommandWithLookup(lookup)
	if !tool.Found {
		return tool
	}

	if len(versionArgs) == 0 {
		versionArgs = []string{"--version"}
	}

	version, err := commandVersion(ctx, tool.Path, versionArgs...)
	if err != nil {
		tool.Status = "detected"
		tool.Error = err.Error()
		return tool
	}

	tool.Version = version
	tool.Status = "verified"
	return tool
}

func WellKnownUserToolchainBins() []string {
	home, _ := os.UserHomeDir()
	dirs := []string{}
	if home != "" {
		dirs = append(dirs,
			filepath.Join(home, ".local", "bin"),
			filepath.Join(home, ".npm-global", "bin"),
			filepath.Join(home, ".npm-packages", "bin"),
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
		)
		nvmDir := filepath.Join(home, ".nvm", "versions", "node")
		if entries, err := os.ReadDir(nvmDir); err == nil {
			for _, entry := range entries {
				if entry.IsDir() {
					dirs = append(dirs, filepath.Join(nvmDir, entry.Name(), "bin"))
				}
			}
		}
	}
	if prefix := strings.TrimSpace(os.Getenv("NPM_CONFIG_PREFIX")); prefix != "" {
		dirs = append(dirs, filepath.Join(prefix, "bin"))
	}
	if npmPrefix := strings.TrimSpace(os.Getenv("npm_config_prefix")); npmPrefix != "" {
		dirs = append(dirs, filepath.Join(npmPrefix, "bin"))
	}
	if miseDir := strings.TrimSpace(os.Getenv("MISE_DATA_DIR")); miseDir != "" {
		dirs = append(dirs, filepath.Join(miseDir, "shims"))
	}
	if fnmDir := strings.TrimSpace(os.Getenv("FNM_DIR")); fnmDir != "" {
		if entries, err := os.ReadDir(filepath.Join(fnmDir, "node-versions")); err == nil {
			for _, entry := range entries {
				binDir := filepath.Join(fnmDir, "node-versions", entry.Name(), "installation", "bin")
				if info, err := os.Stat(binDir); err == nil && info.IsDir() {
					dirs = append(dirs, binDir)
				}
			}
		}
	}
	if voltaHome := strings.TrimSpace(os.Getenv("VOLTA_HOME")); voltaHome != "" {
		dirs = append(dirs, filepath.Join(voltaHome, "bin"))
	}
	if agentHome := strings.TrimSpace(os.Getenv("FH_AGENT_HOME")); agentHome != "" {
		dirs = append(dirs, agentHome, filepath.Join(agentHome, "bin"))
	}
	if runtime.GOOS == "darwin" {
		dirs = append(dirs, "/opt/homebrew/bin", "/usr/local/bin")
	}
	return dedupeStrings(dirs)
}

func commandVersion(parent context.Context, path string, args ...string) (string, error) {
	ctx, cancel := context.WithTimeout(parent, 3*time.Second)
	defer cancel()

	output, err := exec.CommandContext(ctx, path, args...).CombinedOutput()
	if err != nil {
		return "", err
	}

	return normalizeVersionOutput(string(output)), nil
}

func normalizeVersionOutput(output string) string {
	fields := strings.Fields(strings.TrimSpace(output))
	if len(fields) == 0 {
		return ""
	}
	if len(fields) == 1 {
		return fields[0]
	}
	return strings.Join(fields[:min(len(fields), 4)], " ")
}

func normalizeLookup(lookup CommandLookup) CommandLookup {
	if lookup.Name == "" {
		lookup.Name = lookup.Binary
	}
	if lookup.Binary == "" {
		lookup.Binary = lookup.Name
	}
	lookup.ExtraDirs = dedupeStrings(append(lookup.ExtraDirs, WellKnownUserToolchainBins()...))
	return lookup
}

func lookPath(binary string, extraDirs []string) (string, string, error) {
	if filepath.IsAbs(binary) {
		tool, err := toolFromPath(binary, binary, nil)
		if err != nil {
			return "", "", err
		}
		return tool.Path, "absolute", nil
	}

	if path, err := exec.LookPath(binary); err == nil {
		return path, "path", nil
	}

	for _, dir := range extraDirs {
		if dir == "" {
			continue
		}
		candidate := filepath.Join(dir, binary)
		if _, err := toolFromPath(binary, candidate, nil); err == nil {
			return candidate, "extra_dir", nil
		}
	}

	return "", "", exec.ErrNotFound
}

func toolFromPath(name string, path string, metadata map[string]any) (Tool, error) {
	info, err := os.Stat(path)
	if err != nil {
		return Tool{}, err
	}
	if info.IsDir() {
		return Tool{}, fmt.Errorf("%s is a directory", path)
	}
	if runtime.GOOS != "windows" && info.Mode()&0o111 == 0 {
		return Tool{}, fmt.Errorf("%s is not executable", path)
	}
	if metadata == nil {
		metadata = map[string]any{}
	}
	metadata["binary"] = filepath.Base(path)
	return Tool{Tool: name, Found: true, Path: path, Status: "detected", Metadata: metadata}, nil
}

func unavailableTool(name string, message string, metadata map[string]any) Tool {
	return Tool{Tool: name, Found: false, Status: "unavailable", Error: message, Metadata: metadata}
}

func dedupeStrings(values []string) []string {
	seen := map[string]bool{}
	deduped := make([]string, 0, len(values))
	for _, value := range values {
		if value == "" || seen[value] {
			continue
		}
		seen[value] = true
		deduped = append(deduped, value)
	}
	return deduped
}
