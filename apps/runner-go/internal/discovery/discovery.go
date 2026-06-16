package discovery

import "os/exec"

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
}

func DetectCommand(name string) Tool {
	path, err := exec.LookPath(name)
	if err != nil {
		return Tool{Tool: name, Found: false, Status: "unavailable", Error: err.Error()}
	}
	return Tool{Tool: name, Found: true, Path: path, Status: "detected"}
}
