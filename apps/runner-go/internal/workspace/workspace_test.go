package workspace

import (
	"path/filepath"
	"testing"
)

func TestIsWithinRootAllowsNestedPath(t *testing.T) {
	root := t.TempDir()
	nested := filepath.Join(root, "repo", "src")

	if !IsWithinRoot(root, nested) {
		t.Fatalf("expected nested path to be inside root")
	}
}

func TestIsWithinRootBlocksSiblingPrefix(t *testing.T) {
	root := filepath.Join(t.TempDir(), "project")
	sibling := root + "-other"

	if IsWithinRoot(root, sibling) {
		t.Fatalf("expected sibling prefix path to be outside root")
	}
}
