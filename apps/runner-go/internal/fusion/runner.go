package fusion

import (
	"context"
	"errors"
	"fmt"
	"sort"
	"strings"
	"sync"
	"time"

	"github.com/asthrix/openfusion/apps/runner-go/internal/adapters"
	"github.com/asthrix/openfusion/apps/runner-go/internal/adapters/codex"
	"github.com/asthrix/openfusion/apps/runner-go/internal/adapters/opencode"
	"github.com/asthrix/openfusion/apps/runner-go/internal/localagents"
)

type Request struct {
	RunID          string   `json:"runId,omitempty"`
	Prompt         string   `json:"prompt"`
	WorkspacePath  string   `json:"workspacePath"`
	Mode           string   `json:"mode"`
	AnalysisModels []string `json:"analysisModels"`
	JudgeModel     string   `json:"judgeModel,omitempty"`
	// FinalModel is accepted for older clients, but the current flow uses the
	// judge model as the synthesis/final model.
	FinalModel        string            `json:"finalModel,omitempty"`
	PermissionProfile string            `json:"permissionProfile"`
	TimeoutMs         int               `json:"timeoutMs"`
	AllowedRoots      []string          `json:"-"`
	ToolDirs          []string          `json:"-"`
	Env               map[string]string `json:"-"`
}

type Result struct {
	RunID  string        `json:"runId"`
	Status string        `json:"status"`
	Mode   string        `json:"mode"`
	Panel  []ModelOutput `json:"panel"`
	Judge  *ModelOutput  `json:"judge,omitempty"`
	// Final is retained for response compatibility. New fusion runs complete in
	// the judge/synthesis step and expose the user-facing answer in FinalAnswer.
	Final       *ModelOutput `json:"final,omitempty"`
	FinalAnswer string       `json:"finalAnswer"`
	// Analysis is the programmatic pre-analysis computed from panel outputs.
	// It is a sidecar signal: zero token cost, used to hint the judge and to
	// surface a confidence badge to the user.
	Analysis *Analysis `json:"analysis,omitempty"`
	// SynthesisAnalysis is the Phase A thinking block extracted from the
	// two-phase judge output (FEATURE_SYNTHESIS_V2). Empty when the feature is
	// disabled or the model does not emit the block. Shown in the trace.
	SynthesisAnalysis string `json:"synthesisAnalysis,omitempty"`
	Error             string `json:"error,omitempty"`
	LatencyMs         int64  `json:"latencyMs"`
}

type ModelOutput struct {
	ModelID    string `json:"modelId"`
	Adapter    string `json:"adapter"`
	Model      string `json:"model"`
	Role       string `json:"role,omitempty"`
	Status     string `json:"status"`
	OutputText string `json:"outputText"`
	Error      string `json:"error,omitempty"`
	LatencyMs  int64  `json:"latencyMs"`
}

type selectedModel struct {
	ID      string
	Adapter string
	Model   string
}

var panelRoles = []string{"architect", "critic", "implementer", "risk-reviewer", "test-planner", "maintainer"}

func Execute(ctx context.Context, req Request) (*Result, error) {
	start := time.Now()
	if strings.TrimSpace(req.Prompt) == "" {
		return nil, errors.New("prompt is required")
	}
	if strings.TrimSpace(req.WorkspacePath) == "" {
		return nil, errors.New("workspace path is required")
	}
	if req.RunID == "" {
		req.RunID = fmt.Sprintf("run_%d", time.Now().UnixNano())
	}
	if req.PermissionProfile == "" {
		req.PermissionProfile = "readonly"
	}
	if req.TimeoutMs <= 0 {
		req.TimeoutMs = int((10 * time.Minute).Milliseconds())
	}
	mode := req.Mode
	if mode == "" {
		mode = "required"
	}

	analysisModels := req.AnalysisModels
	if len(analysisModels) == 0 {
		analysisModels = defaultAnalysisModels(ctx, req.AllowedRoots, req.ToolDirs)
	}
	if len(analysisModels) == 0 {
		return nil, errors.New("no runnable analysis models were selected or detected")
	}

	panel := make([]ModelOutput, len(analysisModels))
	if mode == "direct" {
		selected := resolveModel(analysisModels[0], "")
		output := runSelectedModel(ctx, req, selected, req.Prompt, "direct")
		result := &Result{
			RunID:       req.RunID,
			Status:      output.Status,
			Mode:        mode,
			Panel:       []ModelOutput{output},
			Final:       &output,
			FinalAnswer: output.OutputText,
			LatencyMs:   time.Since(start).Milliseconds(),
		}
		if output.Status != "completed" {
			result.Error = output.Error
		}
		return result, nil
	}

	var wg sync.WaitGroup
	for index, modelID := range analysisModels {
		wg.Add(1)
		go func(index int, modelID string) {
			defer wg.Done()
			lens := Lens{}
			role := panelRole(index)
			if !noDiversityMode() {
				lens = lensForIndex(index)
				role = lens.Name
			}
			selected := resolveModel(modelID, "")
			panel[index] = runSelectedModel(ctx, req, selected, buildPanelPromptWithLens(req.Prompt, lens), role)
		}(index, modelID)
	}
	wg.Wait()

	successfulPanel := make([]ModelOutput, 0, len(panel))
	for _, output := range panel {
		if output.Status == "completed" && strings.TrimSpace(output.OutputText) != "" {
			successfulPanel = append(successfulPanel, output)
		}
	}
	if len(successfulPanel) == 0 {
		return &Result{
			RunID:     req.RunID,
			Status:    "failed",
			Mode:      mode,
			Panel:     panel,
			Error:     "all panel models failed or returned empty output",
			LatencyMs: time.Since(start).Milliseconds(),
		}, nil
	}

	judgeModelID := req.JudgeModel
	if judgeModelID == "" {
		judgeModelID = req.FinalModel
	}
	judgeSelection := resolveModel(judgeModelID, successfulPanel[0].Adapter)
	if judgeSelection.ID == "" {
		judgeSelection = resolveModel(successfulPanel[0].ModelID, "")
	}

	analysis := computeAnalysis(panelOutputsForAnalysis(panel))
	allCompleted := len(successfulPanel) == len(panel)
	analysisHint := buildAnalysisHint(analysis, allCompleted)

	judgePrompt := buildJudgeSynthesisPrompt(req.Prompt, successfulPanel, analysisHint)
	if synthesisV2Enabled() {
		judgePrompt = buildJudgeSynthesisPromptV2(req.Prompt, successfulPanel, analysisHint)
	}
	judge := runSelectedModel(ctx, req, judgeSelection, judgePrompt, "judge_synthesis")

	status := judge.Status
	errText := judge.Error
	if status == "" {
		status = "failed"
	}

	finalAnswer := extractFinalOutput(judge.OutputText)
	synthesisAnalysis := ""
	if synthesisV2Enabled() {
		split := extractSynthesisAnalysis(finalAnswer)
		if split.HasAnalysis {
			synthesisAnalysis = split.Analysis
			finalAnswer = split.FinalAnswer
		}
	}

	return &Result{
		RunID:             req.RunID,
		Status:            status,
		Mode:              mode,
		Panel:             panel,
		Judge:             &judge,
		FinalAnswer:       finalAnswer,
		Analysis:          &analysis,
		SynthesisAnalysis: synthesisAnalysis,
		Error:             errText,
		LatencyMs:         time.Since(start).Milliseconds(),
	}, nil
}

func runSelectedModel(ctx context.Context, req Request, selected selectedModel, prompt string, role string) ModelOutput {
	if selected.Adapter == "" || selected.Model == "" {
		return ModelOutput{
			ModelID: selected.ID,
			Adapter: selected.Adapter,
			Model:   selected.Model,
			Role:    role,
			Status:  "failed",
			Error:   "model selection is empty",
		}
	}

	input := adapters.RunInput{
		RunID:             req.RunID,
		JobID:             role + ":" + selected.ID,
		WorkspacePath:     req.WorkspacePath,
		Prompt:            prompt,
		Model:             modelArg(selected.Model),
		PermissionProfile: req.PermissionProfile,
		Env:               req.Env,
		TimeoutMs:         req.TimeoutMs,
	}

	var runner adapters.Adapter
	switch selected.Adapter {
	case "opencode":
		runner = opencode.Adapter{AllowedRoots: req.AllowedRoots, ToolDirs: req.ToolDirs}
	case "codex":
		runner = codex.Adapter{AllowedRoots: req.AllowedRoots, ToolDirs: req.ToolDirs}
	default:
		return ModelOutput{
			ModelID: selected.ID,
			Adapter: selected.Adapter,
			Model:   selected.Model,
			Role:    role,
			Status:  "failed",
			Error:   fmt.Sprintf("%s execution is not implemented in the Go runner yet", selected.Adapter),
		}
	}

	result, err := runner.Run(ctx, input, nil)
	output := ModelOutput{
		ModelID: selected.ID,
		Adapter: selected.Adapter,
		Model:   selected.Model,
		Role:    role,
		Status:  "failed",
	}
	if result != nil {
		output.Status = result.Status
		output.OutputText = strings.TrimSpace(result.OutputText)
		output.Error = result.Error
		output.LatencyMs = result.LatencyMs
	}
	if err != nil && output.Error == "" {
		output.Error = err.Error()
	}
	if output.Status == "" {
		output.Status = "failed"
	}
	return output
}

func defaultAnalysisModels(ctx context.Context, allowedRoots []string, toolDirs []string) []string {
	models := localagents.ListModels(ctx, allowedRoots, toolDirs)
	supported := make([]string, 0, len(models))
	for _, model := range models {
		if model.Adapter != "opencode" && model.Adapter != "codex" {
			continue
		}
		if model.Availability == "unavailable" || model.AuthMode == "unknown" {
			continue
		}
		supported = append(supported, model.ID)
	}
	sort.Strings(supported)
	if len(supported) > 4 {
		return supported[:4]
	}
	return supported
}

func resolveModel(raw string, fallbackAdapter string) selectedModel {
	trimmed := strings.TrimSpace(raw)
	if trimmed == "" {
		return selectedModel{}
	}
	parts := strings.SplitN(trimmed, "/", 2)
	if len(parts) == 2 && isRunnableAdapter(parts[0]) {
		return selectedModel{ID: trimmed, Adapter: parts[0], Model: parts[1]}
	}
	adapter := fallbackAdapter
	if adapter == "" {
		if strings.Contains(trimmed, "/") {
			adapter = "opencode"
		} else {
			adapter = "codex"
		}
	}
	return selectedModel{ID: adapter + "/" + trimmed, Adapter: adapter, Model: trimmed}
}

func isRunnableAdapter(adapter string) bool {
	return adapter == "opencode" || adapter == "codex"
}

func modelArg(model string) string {
	if model == "default" {
		return ""
	}
	return model
}

func panelRole(index int) string {
	if index >= 0 && index < len(panelRoles) {
		return panelRoles[index]
	}
	return fmt.Sprintf("panel-%d", index+1)
}

func panelOutputsForAnalysis(panel []ModelOutput) []PanelOutputForAnalysis {
	out := make([]PanelOutputForAnalysis, len(panel))
	for i, o := range panel {
		out[i] = PanelOutputForAnalysis{
			Model:     o.ModelID,
			Output:    o.OutputText,
			Completed: o.Status == "completed" && strings.TrimSpace(o.OutputText) != "",
		}
	}
	return out
}
