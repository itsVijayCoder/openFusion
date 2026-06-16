package codex

import (
	"context"
	"time"

	"github.com/asthrix/fusion-harness/apps/runner-go/internal/adapters"
	"github.com/asthrix/fusion-harness/apps/runner-go/internal/discovery"
	"github.com/asthrix/fusion-harness/apps/runner-go/internal/executors/host"
)

type Adapter struct {
	AllowedRoots []string
}

func (Adapter) ID() string {
	return "codex"
}

func (Adapter) Detect(ctx context.Context) adapters.DetectionResult {
	tool := discovery.DetectCommandWithVersion(ctx, "codex", "--version")
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
	return discovery.DetectCommandWithVersion(context.Background(), "codex", "--version")
}

func (Adapter) ListModels(context.Context) ([]adapters.ModelRef, error) {
	if !Detect().Found {
		return nil, nil
	}

	return []adapters.ModelRef{
		{
			ID:           "codex/gpt-5-codex",
			Adapter:      "codex",
			Provider:     "openai",
			Model:        "gpt-5-codex",
			DisplayName:  "GPT-5 Codex",
			AuthMode:     "cli_session",
			Availability: "configured_unverified",
			Capabilities: adapters.ModelCapability{
				Streaming:    true,
				Tools:        true,
				FileEdits:    true,
				Shell:        true,
				JSONOutput:   true,
				ModelListing: false,
			},
		},
	}, nil
}

func (adapter Adapter) Run(ctx context.Context, input adapters.RunInput, emit func(adapters.RunEvent)) (*adapters.RunResult, error) {
	start := time.Now()
	if emit != nil {
		emit(adapters.RunEvent{Type: "panel.job.started", RunID: input.RunID, JobID: input.JobID, Timestamp: start.UTC().Format(time.RFC3339), Data: map[string]any{"adapter": "codex"}})
	}

	args := []string{"exec", "--sandbox", sandboxForProfile(input.PermissionProfile)}
	if input.Model != "" {
		args = append(args, "--model", input.Model)
	}
	args = append(args, input.Prompt)

	result, err := host.Run(ctx, host.CommandSpec{
		Name:         "codex",
		Args:         args,
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
