package discovery

import (
	"context"
	"os/exec"
	"strings"
	"time"
)

type Tool struct {
	Tool    string `json:"tool"`
	Found   bool   `json:"found"`
	Path    string `json:"path,omitempty"`
	Version string `json:"version,omitempty"`
	Status  string `json:"status"`
	Error   string `json:"error,omitempty"`
}

type Report struct {
	RunnerID string `json:"runner_id"`
	OS       string `json:"os"`
	Arch     string `json:"arch"`
	Tools    []Tool `json:"tools"`
	Models   []any  `json:"models,omitempty"`
}

func DetectCommand(name string) Tool {
	path, err := exec.LookPath(name)
	if err != nil {
		return Tool{Tool: name, Found: false, Status: "unavailable", Error: err.Error()}
	}
	return Tool{Tool: name, Found: true, Path: path, Status: "detected"}
}

func DetectCommandWithVersion(ctx context.Context, name string, versionArgs ...string) Tool {
	tool := DetectCommand(name)
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
