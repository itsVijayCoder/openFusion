package terminal

import (
	"io"
	"os"
	"os/exec"
)

// PTYHandle abstracts a platform-specific pseudo-terminal. Implementations
// exist for Unix (creack/pty) and Windows (ConPTY). The handle owns the PTY
// master file descriptor and the child process.
type PTYHandle interface {
	io.ReadWriteCloser
	SetSize(rows, cols int) error
	File() *os.File
}

// PTYAllocator creates PTY handles by starting a command inside a
// pseudo-terminal.
type PTYAllocator interface {
	Start(cmd *exec.Cmd) (PTYHandle, error)
	StartWithSize(cmd *exec.Cmd, rows, cols int) (PTYHandle, error)
}
