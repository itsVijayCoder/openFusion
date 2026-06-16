package host

import (
	"bytes"
	"context"
	"errors"
	"os"
	"os/exec"
	"strings"
	"time"

	"github.com/asthrix/fusion-harness/apps/runner-go/internal/workspace"
)

type CommandSpec struct {
	Name         string
	Args         []string
	WorkingDir   string
	AllowedRoots []string
	Env          map[string]string
	Timeout      time.Duration
}

type Result struct {
	Stdout   string `json:"stdout"`
	Stderr   string `json:"stderr"`
	ExitCode int    `json:"exit_code"`
}

func Available() bool {
	return true
}

func Run(ctx context.Context, spec CommandSpec) (Result, error) {
	if spec.Name == "" {
		return Result{ExitCode: -1}, errors.New("command name is required")
	}
	if err := validateWorkingDir(spec.WorkingDir, spec.AllowedRoots); err != nil {
		return Result{ExitCode: -1}, err
	}

	if spec.Timeout > 0 {
		var cancel context.CancelFunc
		ctx, cancel = context.WithTimeout(ctx, spec.Timeout)
		defer cancel()
	}

	path, err := exec.LookPath(spec.Name)
	if err != nil {
		return Result{ExitCode: -1}, err
	}

	cmd := exec.CommandContext(ctx, path, spec.Args...)
	cmd.Dir = spec.WorkingDir
	cmd.Env = sanitizedEnv(spec.Env)

	var stdout bytes.Buffer
	var stderr bytes.Buffer
	cmd.Stdout = &stdout
	cmd.Stderr = &stderr

	err = cmd.Run()
	result := Result{
		Stdout: stdout.String(),
		Stderr: stderr.String(),
	}

	if cmd.ProcessState != nil {
		result.ExitCode = cmd.ProcessState.ExitCode()
	}

	return result, err
}

func validateWorkingDir(workingDir string, allowedRoots []string) error {
	if workingDir == "" {
		return errors.New("working directory is required")
	}
	if len(allowedRoots) == 0 {
		return errors.New("no allowed workspace roots configured")
	}

	for _, root := range allowedRoots {
		if workspace.IsWithinRoot(root, workingDir) {
			return nil
		}
	}

	return errors.New("working directory is outside the configured workspace roots")
}

func sanitizedEnv(extra map[string]string) []string {
	deny := []string{"TOKEN", "SECRET", "PASSWORD", "COOKIE", "KEY", "CREDENTIAL"}
	env := make([]string, 0, len(os.Environ())+len(extra))

	for _, item := range os.Environ() {
		name := strings.SplitN(item, "=", 2)[0]
		if containsSensitiveMarker(name, deny) {
			continue
		}
		env = append(env, item)
	}

	for key, value := range extra {
		if containsSensitiveMarker(key, deny) {
			continue
		}
		env = append(env, key+"="+value)
	}

	return env
}

func containsSensitiveMarker(name string, deny []string) bool {
	upper := strings.ToUpper(name)
	for _, marker := range deny {
		if strings.Contains(upper, marker) {
			return true
		}
	}
	return false
}
