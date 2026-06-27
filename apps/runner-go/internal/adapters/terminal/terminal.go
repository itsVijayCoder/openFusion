package terminal

import (
	"context"
	"fmt"
	"os/exec"

	"github.com/asthrix/openfusion/apps/runner-go/internal/adapters"
	"github.com/asthrix/openfusion/apps/runner-go/internal/discovery"
	"github.com/asthrix/openfusion/apps/runner-go/internal/localagents"
)

// GenericTerminalAdapter implements TerminalAdapter for any catalogued CLI.
// It builds a TerminalSessionSpec from the catalog's TerminalSpecHint,
// making all 23 agents executable without per-CLI Go code.
type GenericTerminalAdapter struct {
	AgentDef     localagents.AgentDef
	AllowedRoots []string
	ToolDirs     []string
}

func (a GenericTerminalAdapter) ID() string {
	return a.AgentDef.ID
}

func (a GenericTerminalAdapter) Detect(ctx context.Context) adapters.DetectionResult {
	tool := localagents.Detect(ctx, a.AgentDef, a.ToolDirs)
	return adapters.DetectionResult{
		Tool:    a.AgentDef.ID,
		Found:   tool.Found,
		Path:    tool.Path,
		Version: tool.Version,
		Status:  tool.Status,
		Error:   tool.Error,
		CanRun:  tool.Found,
	}
}

func (a GenericTerminalAdapter) ListModels(ctx context.Context) ([]adapters.ModelRef, error) {
	return nil, nil
}

func (a GenericTerminalAdapter) Run(ctx context.Context, input adapters.RunInput, emit func(adapters.RunEvent)) (*adapters.RunResult, error) {
	return &adapters.RunResult{
		Status: "failed",
		Error:  fmt.Sprintf("%s does not support headless Run; use terminal session mode", a.AgentDef.ID),
	}, nil
}

// SessionSpec builds a TerminalSessionSpec from the catalog hint and run input.
func (a GenericTerminalAdapter) SessionSpec(input adapters.RunInput) (adapters.TerminalSessionSpec, error) {
	hint := a.AgentDef.TerminalSpec

	binary, err := resolveBinary(a.AgentDef, a.ToolDirs)
	if err != nil {
		return adapters.TerminalSessionSpec{}, fmt.Errorf("binary not found for %s: %w", a.AgentDef.ID, err)
	}

	spec := adapters.TerminalSessionSpec{
		Binary:     binary,
		WorkingDir: input.WorkspacePath,
		Env:        input.Env,
		PromptMode: hint.PromptMode,
		PromptFlag: hint.PromptFlag,
		PromptText: input.Prompt,
		Model:      input.Model,
		ModelFlag:  hint.ModelFlag,
		OutputMode: hint.OutputMode,
		TimeoutMs:  input.TimeoutMs,
		Rows:       24,
		Cols:       80,
	}

	if hint.OutputMode == adapters.OutputModeJSON && len(hint.JSONRunArgs) > 0 {
		spec.Args = append([]string{}, hint.JSONRunArgs...)
		if input.Model != "" && input.Model != "default" && hint.ModelFlag != "" {
			spec.Args = append(spec.Args, hint.ModelFlag, input.Model)
		}
		spec.PromptMode = adapters.PromptModeStdin
	} else {
		spec.Args = []string{}
		if input.Model != "" && input.Model != "default" && hint.ModelFlag != "" {
			spec.Args = append(spec.Args, hint.ModelFlag, input.Model)
		}
	}

	return spec, nil
}

func resolveBinary(def localagents.AgentDef, toolDirs []string) (string, error) {
	tool := discovery.DetectCommandWithLookup(discovery.CommandLookup{
		Name:             def.ID,
		Binary:           def.Binary,
		FallbackBinaries: def.FallbackBinaries,
		EnvOverride:      def.EnvOverride,
		ExtraDirs:        toolDirs,
	})
	if !tool.Found {
		if path, err := exec.LookPath(def.Binary); err == nil {
			return path, nil
		}
		return "", fmt.Errorf("binary %q not found in PATH", def.Binary)
	}
	return tool.Path, nil
}
