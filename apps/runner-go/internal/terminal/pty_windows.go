//go:build windows

package terminal

import (
	"errors"
	"os/exec"
)

// windowsAllocator is a stub. Windows ConPTY support is deferred; the runner
// falls back to T3 (headless capture) when no PTY allocator is available.
type windowsAllocator struct{}

func (windowsAllocator) Start(cmd *exec.Cmd) (PTYHandle, error) {
	return nil, errors.New("conpty not available: install WSL2 or use --terminal headless")
}

func (windowsAllocator) StartWithSize(cmd *exec.Cmd, rows, cols int) (PTYHandle, error) {
	return nil, errors.New("conpty not available: install WSL2 or use --terminal headless")
}

func defaultAllocator() PTYAllocator {
	return windowsAllocator{}
}
