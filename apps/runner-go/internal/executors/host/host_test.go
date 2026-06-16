package host

import (
	"context"
	"path/filepath"
	"testing"
)

func TestRunBlocksWorkingDirOutsideAllowedRoots(t *testing.T) {
	root := t.TempDir()
	outside := filepath.Join(t.TempDir(), "outside")

	_, err := Run(context.Background(), CommandSpec{
		Name:         "echo",
		Args:         []string{"hello"},
		WorkingDir:   outside,
		AllowedRoots: []string{root},
	})
	if err == nil {
		t.Fatalf("expected outside workspace to be blocked")
	}
}
