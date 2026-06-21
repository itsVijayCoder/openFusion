package prreview

import (
	"context"
	"fmt"
	"os"
	"os/exec"
	"path/filepath"
	"strings"
	"time"

	"github.com/asthrix/fusion-harness/apps/runner-go/internal/workspace"
)

type GitOps struct {
	repoPath     string
	allowedRoots []string
}

type Worktree struct {
	Path string
	repo string
}

func NewGitOps(repoPath string, allowedRoots []string) (*GitOps, error) {
	abs, err := filepath.Abs(repoPath)
	if err != nil {
		return nil, fmt.Errorf("resolve repo path: %w", err)
	}

	if !isWithinAllowedRoots(abs, allowedRoots) {
		return nil, fmt.Errorf("workspace path %s is outside allowed roots", abs)
	}

	info, err := os.Stat(abs)
	if err != nil {
		return nil, fmt.Errorf("workspace stat: %w", err)
	}
	if !info.IsDir() {
		return nil, fmt.Errorf("workspace path is not a directory: %s", abs)
	}

	gitDir := filepath.Join(abs, ".git")
	if _, err := os.Stat(gitDir); err != nil {
		return nil, fmt.Errorf("workspace is not a git repository: %s", abs)
	}

	return &GitOps{repoPath: abs, allowedRoots: allowedRoots}, nil
}

func (g *GitOps) ValidateRemote(expectedFullName string) error {
	cmd := exec.CommandContext(context.Background(), "git", "-C", g.repoPath, "remote", "-v")
	output, err := cmd.Output()
	if err != nil {
		return fmt.Errorf("git remote check: %w", err)
	}

	remotes := string(output)
	if !strings.Contains(remotes, expectedFullName) {
		return fmt.Errorf("repository remote does not match %s", expectedFullName)
	}

	return nil
}

func (g *GitOps) FetchRefs(ctx context.Context, baseSha, headSha, headRepoFullName, headRef string) error {
	args := []string{"-C", g.repoPath, "fetch", "origin", baseSha, headSha}
	if err := g.runGit(ctx, args...); err != nil {
		return fmt.Errorf("fetch origin SHAs: %w", err)
	}

	if headRepoFullName != "" && headRef != "" {
		headRemote := headRepoFullName
		existingRemotes, _ := exec.CommandContext(ctx, "git", "-C", g.repoPath, "remote").Output()
		if !strings.Contains(string(existingRemotes), headRemote) {
			addCmd := exec.CommandContext(ctx, "git", "-C", g.repoPath, "remote", "add", headRemote, fmt.Sprintf("https://github.com/%s.git", headRepoFullName))
			_ = addCmd.Run()
		}
		fetchArgs := []string{"-C", g.repoPath, "fetch", headRemote, headRef}
		if err := g.runGit(ctx, fetchArgs...); err != nil {
			return fmt.Errorf("fetch head ref: %w", err)
		}
	}

	return nil
}

func (g *GitOps) CreateWorktree(ctx context.Context, headSha string) (*Worktree, error) {
	tempDir, err := os.MkdirTemp("", "fusion-pr-review-*")
	if err != nil {
		return nil, fmt.Errorf("create temp dir: %w", err)
	}

	args := []string{"-C", g.repoPath, "worktree", "add", "--detach", tempDir, headSha}
	if err := g.runGit(ctx, args...); err != nil {
		os.RemoveAll(tempDir)
		return nil, fmt.Errorf("git worktree add: %w", err)
	}

	return &Worktree{Path: tempDir, repo: g.repoPath}, nil
}

func (w *Worktree) Cleanup() {
	if w.Path == "" {
		return
	}
	ctx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
	defer cancel()
	_ = exec.CommandContext(ctx, "git", "-C", w.repo, "worktree", "remove", "--force", w.Path).Run()
	os.RemoveAll(w.Path)
}

func (g *GitOps) Diff(ctx context.Context, baseSha, headSha string) (string, error) {
	cmd := exec.CommandContext(ctx, "git", "-C", g.repoPath, "diff", "--unified=80", fmt.Sprintf("%s...%s", baseSha, headSha))
	output, err := cmd.Output()
	if err != nil {
		return "", fmt.Errorf("git diff: %w", err)
	}
	return string(output), nil
}

func (g *GitOps) ChangedFiles(ctx context.Context, baseSha, headSha string) ([]FileChange, error) {
	cmd := exec.CommandContext(ctx, "git", "-C", g.repoPath, "diff", "--name-status", "--numstat", fmt.Sprintf("%s...%s", baseSha, headSha))
	output, err := cmd.Output()
	if err != nil {
		return nil, fmt.Errorf("git diff name-status: %w", err)
	}

	lines := strings.Split(strings.TrimSpace(string(output)), "\n")
	changes := make([]FileChange, 0, len(lines))

	for _, line := range lines {
		line = strings.TrimSpace(line)
		if line == "" {
			continue
		}
		parts := strings.Split(line, "\t")
		if len(parts) < 3 {
			continue
		}

		additions := 0
		deletions := 0
		fmt.Sscanf(parts[0], "%d", &additions)
		fmt.Sscanf(parts[1], "%d", &deletions)

		status := "modified"
		path := parts[2]
		if len(parts) > 3 {
			status = parts[2]
			path = parts[3]
		}

		changes = append(changes, FileChange{
			Path:      path,
			Status:    normalizeStatus(status),
			Additions: additions,
			Deletions: deletions,
		})
	}

	return changes, nil
}

func (g *GitOps) FileContent(ctx context.Context, sha, path string) (string, error) {
	cmd := exec.CommandContext(ctx, "git", "-C", g.repoPath, "show", fmt.Sprintf("%s:%s", sha, path))
	output, err := cmd.Output()
	if err != nil {
		return "", err
	}
	return string(output), nil
}

func (g *GitOps) runGit(ctx context.Context, args ...string) error {
	cmd := exec.CommandContext(ctx, "git", args...)
	cmd.Dir = g.repoPath
	output, err := cmd.CombinedOutput()
	if err != nil {
		return fmt.Errorf("%s: %s", err, strings.TrimSpace(string(output)))
	}
	return nil
}

func isWithinAllowedRoots(candidate string, roots []string) bool {
	if len(roots) == 0 {
		return true
	}
	for _, root := range roots {
		if strings.TrimSpace(root) == "" {
			continue
		}
		if workspace.IsWithinRoot(root, candidate) {
			return true
		}
	}
	return false
}

func normalizeStatus(status string) string {
	switch status {
	case "A":
		return "added"
	case "D":
		return "removed"
	case "M":
		return "modified"
	case "R":
		return "renamed"
	case "C":
		return "copied"
	default:
		return "modified"
	}
}
