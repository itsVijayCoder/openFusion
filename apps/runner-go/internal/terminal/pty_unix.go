//go:build !windows

package terminal

import (
	"os"
	"os/exec"

	"github.com/creack/pty"
)

// unixPTY wraps a creack/pty PTY master file descriptor.
type unixPTY struct {
	file *os.File
}

func (u *unixPTY) Read(p []byte) (int, error)  { return u.file.Read(p) }
func (u *unixPTY) Write(p []byte) (int, error) { return u.file.Write(p) }
func (u *unixPTY) Close() error                { return u.file.Close() }
func (u *unixPTY) File() *os.File              { return u.file }

func (u *unixPTY) SetSize(rows, cols int) error {
	return pty.Setsize(u.file, &pty.Winsize{
		Rows: uint16(rows),
		Cols: uint16(cols),
	})
}

// unixAllocator implements PTYAllocator using creack/pty.
type unixAllocator struct{}

func (unixAllocator) Start(cmd *exec.Cmd) (PTYHandle, error) {
	f, err := pty.Start(cmd)
	if err != nil {
		return nil, err
	}
	return &unixPTY{file: f}, nil
}

func (unixAllocator) StartWithSize(cmd *exec.Cmd, rows, cols int) (PTYHandle, error) {
	f, err := pty.StartWithSize(cmd, &pty.Winsize{
		Rows: uint16(rows),
		Cols: uint16(cols),
	})
	if err != nil {
		return nil, err
	}
	return &unixPTY{file: f}, nil
}

// defaultAllocator returns the platform-default PTY allocator.
func defaultAllocator() PTYAllocator {
	return unixAllocator{}
}
