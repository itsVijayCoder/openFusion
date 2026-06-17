package codex

import (
	"context"
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

	result, err := host.Run(ctx, host.CommandSpec{
		Name:         tool.Path,
		Args:         []string{"debug", "models"},
		WorkingDir:   firstAllowedRoot(adapter.AllowedRoots),
		AllowedRoots: adapter.AllowedRoots,
		Timeout:      10 * time.Second,
	})
	options := localagents.ParseCodexDebugModels(result.Stdout)
	live := err == nil && len(options) > 0
	if err != nil || len(options) == 0 {
		options = []localagents.ModelOption{
			{ID: "default", DisplayName: "Default (CLI config)"},
			{ID: "gpt-5.5", DisplayName: "gpt-5.5"},
			{ID: "gpt-5.4", DisplayName: "gpt-5.4"},
			{ID: "gpt-5.4-mini", DisplayName: "gpt-5.4-mini"},
			{ID: "gpt-5.3-codex", DisplayName: "gpt-5.3-codex"},
			{ID: "gpt-5.1", DisplayName: "gpt-5.1"},
			{ID: "gpt-5.1-codex-mini", DisplayName: "gpt-5.1-codex-mini"},
			{ID: "gpt-5-codex", DisplayName: "gpt-5-codex"},
			{ID: "gpt-5", DisplayName: "gpt-5"},
			{ID: "o3", DisplayName: "o3"},
			{ID: "o4-mini", DisplayName: "o4-mini"},
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
	source := "fallback"
	if live {
		availability = "listed"
		source = "live"
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

func firstAllowedRoot(roots []string) string {
	if len(roots) == 0 {
		return "."
	}
	return roots[0]
}
