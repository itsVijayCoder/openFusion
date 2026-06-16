package opencode

import (
	"context"
	"strings"
	"time"

	"github.com/asthrix/fusion-harness/apps/runner-go/internal/adapters"
	"github.com/asthrix/fusion-harness/apps/runner-go/internal/discovery"
	"github.com/asthrix/fusion-harness/apps/runner-go/internal/executors/host"
)

type Adapter struct {
	AllowedRoots []string
}

func (Adapter) ID() string {
	return "opencode"
}

func (Adapter) Detect(ctx context.Context) adapters.DetectionResult {
	tool := discovery.DetectCommandWithVersion(ctx, "opencode", "--version")
	return adapters.DetectionResult{
		Tool:    "opencode",
		Found:   tool.Found,
		Path:    tool.Path,
		Version: tool.Version,
		Status:  tool.Status,
		Error:   tool.Error,
		CanRun:  tool.Found,
	}
}

func Detect() discovery.Tool {
	return discovery.DetectCommandWithVersion(context.Background(), "opencode", "--version")
}

func (adapter Adapter) ListModels(ctx context.Context) ([]adapters.ModelRef, error) {
	tool := Detect()
	if !tool.Found {
		return nil, nil
	}

	result, err := host.Run(ctx, host.CommandSpec{
		Name:         "opencode",
		Args:         []string{"models"},
		WorkingDir:   firstAllowedRoot(adapter.AllowedRoots),
		AllowedRoots: adapter.AllowedRoots,
		Timeout:      10 * time.Second,
	})
	if err != nil && result.Stdout == "" {
		return defaultModels(), nil
	}

	models := parseModelLines(result.Stdout)
	if len(models) == 0 {
		return defaultModels(), nil
	}

	return models, nil
}

func (adapter Adapter) Run(ctx context.Context, input adapters.RunInput, emit func(adapters.RunEvent)) (*adapters.RunResult, error) {
	start := time.Now()
	if emit != nil {
		emit(adapters.RunEvent{Type: "panel.job.started", RunID: input.RunID, JobID: input.JobID, Timestamp: start.UTC().Format(time.RFC3339), Data: map[string]any{"adapter": "opencode"}})
	}

	args := []string{"run"}
	if input.Model != "" {
		args = append(args, "--model", input.Model)
	}
	args = append(args, input.Prompt)

	result, err := host.Run(ctx, host.CommandSpec{
		Name:         "opencode",
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

func parseModelLines(output string) []adapters.ModelRef {
	lines := strings.Split(output, "\n")
	models := make([]adapters.ModelRef, 0, len(lines))

	for _, line := range lines {
		model := strings.TrimSpace(strings.TrimPrefix(line, "-"))
		if model == "" || strings.Contains(strings.ToLower(model), "model") && len(strings.Fields(model)) == 1 {
			continue
		}
		models = append(models, modelRef(model, "listed"))
	}

	return models
}

func defaultModels() []adapters.ModelRef {
	return []adapters.ModelRef{
		modelRef("anthropic/claude-sonnet", "configured_unverified"),
		modelRef("openai/gpt-5", "configured_unverified"),
	}
}

func modelRef(model string, availability string) adapters.ModelRef {
	provider := ""
	if parts := strings.SplitN(model, "/", 2); len(parts) == 2 {
		provider = parts[0]
	}

	return adapters.ModelRef{
		ID:           "opencode/" + model,
		Adapter:      "opencode",
		Provider:     provider,
		Model:        model,
		DisplayName:  model,
		AuthMode:     "cli_session",
		Availability: availability,
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
