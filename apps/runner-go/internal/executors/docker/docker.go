package docker

import (
	"context"
	"errors"
	"os/exec"
	"time"

	"github.com/asthrix/fusion-harness/apps/runner-go/internal/discovery"
	"github.com/asthrix/fusion-harness/apps/runner-go/internal/executors/host"
	"github.com/asthrix/fusion-harness/apps/runner-go/internal/workspace"
)

type CommandSpec struct {
	Image        string
	Command      []string
	WorkspaceDir string
	AllowedRoots []string
	Timeout      time.Duration
}

func Detect() discovery.Tool {
	return discovery.DetectCommandWithVersion(context.Background(), "docker", "--version")
}

func Available() bool {
	_, err := exec.LookPath("docker")
	return err == nil
}

func Run(ctx context.Context, spec CommandSpec) (host.Result, error) {
	if spec.Image == "" {
		return host.Result{ExitCode: -1}, errors.New("docker image is required")
	}
	if len(spec.Command) == 0 {
		return host.Result{ExitCode: -1}, errors.New("docker command is required")
	}
	if err := validateWorkspace(spec.WorkspaceDir, spec.AllowedRoots); err != nil {
		return host.Result{ExitCode: -1}, err
	}

	args := []string{
		"run",
		"--rm",
		"--network",
		"none",
		"--cap-drop",
		"ALL",
		"--security-opt",
		"no-new-privileges",
		"--memory",
		"4g",
		"--cpus",
		"2",
		"-v",
		spec.WorkspaceDir + ":/workspace",
		"-w",
		"/workspace",
		spec.Image,
	}
	args = append(args, spec.Command...)

	return host.Run(ctx, host.CommandSpec{
		Name:         "docker",
		Args:         args,
		WorkingDir:   spec.WorkspaceDir,
		AllowedRoots: spec.AllowedRoots,
		Timeout:      spec.Timeout,
	})
}

func validateWorkspace(workspaceDir string, allowedRoots []string) error {
	for _, root := range allowedRoots {
		if workspace.IsWithinRoot(root, workspaceDir) {
			return nil
		}
	}
	return errors.New("workspace directory is outside the configured workspace roots")
}
