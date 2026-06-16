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
