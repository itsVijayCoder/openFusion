package adapters

import "context"

type ModelRef struct {
	ID           string          `json:"id"`
	Adapter      string          `json:"adapter"`
	Provider     string          `json:"provider,omitempty"`
	Model        string          `json:"model"`
	DisplayName  string          `json:"displayName,omitempty"`
	AuthMode     string          `json:"authMode"`
	Availability string          `json:"availability"`
	Source       string          `json:"source,omitempty"`
	Capabilities ModelCapability `json:"capabilities"`
}

type ModelCapability struct {
	Streaming    bool `json:"streaming"`
	Tools        bool `json:"tools"`
	FileEdits    bool `json:"fileEdits"`
	Shell        bool `json:"shell"`
	JSONOutput   bool `json:"jsonOutput"`
	ModelListing bool `json:"modelListing"`
}

type RunInput struct {
	RunID             string            `json:"run_id"`
	JobID             string            `json:"job_id"`
	WorkspacePath     string            `json:"workspace_path"`
	Prompt            string            `json:"prompt"`
	Model             string            `json:"model"`
	PermissionProfile string            `json:"permission_profile"`
	Env               map[string]string `json:"env,omitempty"`
	TimeoutMs         int               `json:"timeout_ms"`
}

type RunEvent struct {
	Type      string         `json:"type"`
	RunID     string         `json:"run_id"`
	JobID     string         `json:"job_id"`
	Timestamp string         `json:"timestamp"`
	Data      map[string]any `json:"data"`
}

type RunResult struct {
	Status       string         `json:"status"`
	OutputText   string         `json:"output_text"`
	Error        string         `json:"error,omitempty"`
	LatencyMs    int64          `json:"latency_ms"`
	Usage        map[string]any `json:"usage,omitempty"`
	ArtifactKeys []string       `json:"artifact_keys,omitempty"`
}

type Adapter interface {
	ID() string
	Detect(ctx context.Context) DetectionResult
	ListModels(ctx context.Context) ([]ModelRef, error)
	Run(ctx context.Context, input RunInput, emit func(RunEvent)) (*RunResult, error)
}

// TerminalAdapter is implemented by adapters that can run in a real PTY
// terminal session. When the fusion pipeline has a SessionManager available,
// it prefers SessionSpec over Run (T1/T2 execution). Adapters that don't
// implement this interface fall back to Run (T3 headless capture).
type TerminalAdapter interface {
	Adapter
	SessionSpec(input RunInput) (TerminalSessionSpec, error)
}

// PromptMode determines how the prompt is delivered to the CLI.
type PromptMode int

const (
	PromptModeKeystrokes PromptMode = iota
	PromptModeFlag
	PromptModeStdin
)

// OutputMode determines how the CLI's output is interpreted.
type OutputMode int

const (
	OutputModeNative OutputMode = iota
	OutputModeJSON
	OutputModePlain
)

// TerminalSessionSpec describes how to launch a CLI inside a PTY terminal
// session. The generic terminal adapter builds this from the catalog hint.
type TerminalSessionSpec struct {
	Binary     string
	Args       []string
	Env        map[string]string
	WorkingDir string
	PromptMode PromptMode
	PromptFlag string
	PromptText string
	Model      string
	ModelFlag  string
	OutputMode OutputMode
	TimeoutMs  int
	Rows       int
	Cols       int
}

type DetectionResult struct {
	Tool     string `json:"tool"`
	Found    bool   `json:"found"`
	Path     string `json:"path,omitempty"`
	Version  string `json:"version,omitempty"`
	Status   string `json:"status"`
	Error    string `json:"error,omitempty"`
	AuthMode string `json:"auth_mode,omitempty"`
	CanRun   bool   `json:"can_run"`
}
