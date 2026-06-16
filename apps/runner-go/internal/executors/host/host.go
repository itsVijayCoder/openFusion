package host

import (
	"context"
	"os/exec"
)

type CommandSpec struct {
	Name       string
	Args       []string
	WorkingDir string
}

func Run(ctx context.Context, spec CommandSpec) ([]byte, error) {
	cmd := exec.CommandContext(ctx, spec.Name, spec.Args...)
	cmd.Dir = spec.WorkingDir
	return cmd.CombinedOutput()
}
