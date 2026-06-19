package codex

import (
	"context"
	"os"
	"time"

	"github.com/asthrix/fusion-harness/apps/runner-go/internal/adapters"
	"github.com/asthrix/fusion-harness/apps/runner-go/internal/discovery"
	"github.com/asthrix/fusion-harness/apps/runner-go/internal/executors/host"
	"github.com/asthrix/fusion-harness/apps/runner-go/internal/localagents"
)

type Adapter struct {
	AllowedRoots []string
	ToolDirs     []string
}

func (Adapter) ID() string {
	return "codex"
}

func (adapter Adapter) Detect(ctx context.Context) adapters.DetectionResult {
	tool := detect(ctx, adapter.ToolDirs)
	return adapters.DetectionResult{
		Tool:     "codex",
		Found:    tool.Found,
		Path:     tool.Path,
		Version:  tool.Version,
		Status:   tool.Status,
		Error:    tool.Error,
		AuthMode: "cli_session",
		CanRun:   tool.Found,
	}
}

func Detect() discovery.Tool {
	return DetectWithDirs(context.Background(), nil)
}

func DetectWithDirs(ctx context.Context, toolDirs []string) discovery.Tool {
	return detect(ctx, toolDirs)
}

func detect(ctx context.Context, toolDirs []string) discovery.Tool {
	return discovery.DetectCommandWithVersionLookup(ctx, discovery.CommandLookup{
		Name:        "codex",
		Binary:      "codex",
		EnvOverride: "CODEX_BIN",
		ExtraDirs:   toolDirs,
	}, "--version")
}

func (adapter Adapter) ListModels(ctx context.Context) ([]adapters.ModelRef, error) {
	tool := detect(ctx, adapter.ToolDirs)
	if !tool.Found {
		return nil, nil
	}

	workingDir, allowedRoots, cleanup := neutralProbeWorkspace(adapter.AllowedRoots)
	defer cleanup()

	result, err := host.Run(ctx, host.CommandSpec{
		Name:         tool.Path,
		Args:         []string{"debug", "models"},
		WorkingDir:   workingDir,
		AllowedRoots: allowedRoots,
		Timeout:      10 * time.Second,
	})
	options := localagents.ParseCodexDebugModels(result.Stdout)
	live := err == nil && len(options) > 0
	if err != nil || len(options) == 0 {
		options = []localagents.ModelOption{
			{ID: "default", DisplayName: "Default (CLI config)"},
		}
	}

	refs := make([]adapters.ModelRef, 0, len(options))
	for _, option := range options {
		refs = append(refs, modelRef(option.ID, option.DisplayName, live))
	}
	return refs, nil
}

func (adapter Adapter) Run(ctx context.Context, input adapters.RunInput, emit func(adapters.RunEvent)) (*adapters.RunResult, error) {
	start := time.Now()
	if emit != nil {
		emit(adapters.RunEvent{Type: "panel.job.started", RunID: input.RunID, JobID: input.JobID, Timestamp: start.UTC().Format(time.RFC3339), Data: map[string]any{"adapter": "codex"}})
	}

	args := []string{"exec", "--json", "--skip-git-repo-check", "--sandbox", sandboxForProfile(input.PermissionProfile)}
	if input.Model != "" && input.Model != "default" {
		args = append(args, "--model", input.Model)
	}

	tool := detect(ctx, adapter.ToolDirs)
	if !tool.Found {
		return &adapters.RunResult{
			Status:    "failed",
			Error:     tool.Error,
			LatencyMs: time.Since(start).Milliseconds(),
		}, nil
	}

	result, err := host.Run(ctx, host.CommandSpec{
		Name:         tool.Path,
		Args:         args,
		Stdin:        input.Prompt,
		WorkingDir:   input.WorkspacePath,
		AllowedRoots: adapter.AllowedRoots,
		Env:          input.Env,
		Timeout:      time.Duration(input.TimeoutMs) * time.Millisecond,
	})

	status := "completed"
	errText := ""
	if err != nil {
		status = "failed"
		errText = err.Error()
	}

	return &adapters.RunResult{
		Status:     status,
		OutputText: result.Stdout + result.Stderr,
		Error:      errText,
		LatencyMs:  time.Since(start).Milliseconds(),
	}, err
}

func sandboxForProfile(profile string) string {
	switch profile {
	case "trusted_internal", "workspace_write":
		return "workspace-write"
	default:
		return "read-only"
	}
}

func modelRef(model string, displayName string, live bool) adapters.ModelRef {
	availability := "configured_unverified"
	source := "live"
	if live {
		availability = "listed"
	} else {
		availability = "detected"
	}
	return adapters.ModelRef{
		ID:           "codex/" + model,
		Adapter:      "codex",
		Provider:     "openai",
		Model:        model,
		DisplayName:  displayName,
		AuthMode:     "cli_session",
		Availability: availability,
		Source:       source,
		Capabilities: adapters.ModelCapability{
			Streaming:    true,
			Tools:        true,
			FileEdits:    true,
			Shell:        true,
			JSONOutput:   true,
			ModelListing: true,
		},
	}
}

func neutralProbeWorkspace(roots []string) (string, []string, func()) {
	dir, err := os.MkdirTemp("", "fusion-codex-probe-*")
	if err == nil {
		return dir, appendIfMissing(roots, dir), func() { _ = os.RemoveAll(dir) }
	}

	for _, root := range roots {
		if info, statErr := os.Stat(root); statErr == nil && info.IsDir() {
			return root, roots, func() {}
		}
	}

	cwd, cwdErr := os.Getwd()
	if cwdErr == nil {
		return cwd, appendIfMissing(roots, cwd), func() {}
	}
	return ".", appendIfMissing(roots, "."), func() {}
}

func appendIfMissing(items []string, item string) []string {
	for _, existing := range items {
		if existing == item {
			return items
		}
	}
	return append(append([]string{}, items...), item)
}
