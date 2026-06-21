package prreview

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"os"
	"path/filepath"
	"sort"
	"strings"
	"time"
)

type Request struct {
	WorkspacePath    string
	RepoFullName     string
	PullNumber       int
	BaseRef          string
	BaseSha          string
	HeadRef          string
	HeadSha          string
	HeadRepoFullName string
	ReviewDepth      string
	MaxComments      int
	IgnoredPaths     []string
	AllowedRoots     []string
	ToolDirs         []string
	Env              map[string]string
	TimeoutMs        int
}

type Result struct {
	Summary   string       `json:"summary"`
	RiskLevel string       `json:"riskLevel"`
	Decision  string       `json:"decision"`
	Findings  []Finding    `json:"findings"`
	Tests     []TestResult `json:"tests,omitempty"`
}

type Finding struct {
	Severity        string  `json:"severity"`
	Category        string  `json:"category"`
	FilePath        string  `json:"filePath"`
	Side            string  `json:"side"`
	StartLine       int     `json:"startLine,omitempty"`
	Line            int     `json:"line,omitempty"`
	Body            string  `json:"body"`
	SuggestedChange string  `json:"suggestedChange,omitempty"`
	Confidence      float64 `json:"confidence,omitempty"`
	Evidence        string  `json:"evidence,omitempty"`
}

type TestResult struct {
	Command       string `json:"command"`
	Status        string `json:"status"`
	OutputSummary string `json:"outputSummary,omitempty"`
}

type ReviewContext struct {
	RepoIntelligence string
	ChangedFiles     []FileChange
	DiffText         string
	FileContents     map[string]FileContentPair
}

type FileChange struct {
	Path      string
	Status    string
	Additions int
	Deletions int
}

type FileContentPair struct {
	Before string
	After  string
}

func Execute(ctx context.Context, req Request, runAgent func(ctx context.Context, prompt string) (string, error)) (*Result, error) {
	if strings.TrimSpace(req.WorkspacePath) == "" {
		return nil, errors.New("workspace path is required")
	}
	if strings.TrimSpace(req.RepoFullName) == "" {
		return nil, errors.New("repository full name is required")
	}
	if req.HeadSha == "" || req.BaseSha == "" {
		return nil, errors.New("base and head SHAs are required")
	}

	timeout := time.Duration(req.TimeoutMs) * time.Millisecond
	if timeout <= 0 {
		timeout = 10 * time.Minute
	}

	ctx, cancel := context.WithTimeout(ctx, timeout)
	defer cancel()

	gitOps, err := NewGitOps(req.WorkspacePath, req.AllowedRoots)
	if err != nil {
		return nil, fmt.Errorf("git workspace validation failed: %w", err)
	}

	if err := gitOps.ValidateRemote(req.RepoFullName); err != nil {
		return nil, fmt.Errorf("repository remote validation failed: %w", err)
	}

	if err := gitOps.FetchRefs(ctx, req.BaseSha, req.HeadSha, req.HeadRepoFullName, req.HeadRef); err != nil {
		return nil, fmt.Errorf("git fetch failed: %w", err)
	}

	worktree, err := gitOps.CreateWorktree(ctx, req.HeadSha)
	if err != nil {
		return nil, fmt.Errorf("worktree creation failed: %w", err)
	}
	defer worktree.Cleanup()

	diffText, err := gitOps.Diff(ctx, req.BaseSha, req.HeadSha)
	if err != nil {
		return nil, fmt.Errorf("diff generation failed: %w", err)
	}

	fileChanges, err := gitOps.ChangedFiles(ctx, req.BaseSha, req.HeadSha)
	if err != nil {
		return nil, fmt.Errorf("changed files list failed: %w", err)
	}

	fileChanges = filterIgnored(fileChanges, req.IgnoredPaths)

	fileContents, err := collectFileContents(ctx, gitOps, worktree.Path, fileChanges, req.BaseSha, req.HeadSha)
	if err != nil {
		return nil, fmt.Errorf("file content collection failed: %w", err)
	}

	intelligence := BuildIntelligence(req.WorkspacePath)

	reviewCtx := &ReviewContext{
		RepoIntelligence: intelligence,
		ChangedFiles:     fileChanges,
		DiffText:         diffText,
		FileContents:     fileContents,
	}

	prompt := BuildReviewPrompt(reviewCtx, req)

	output, err := runAgent(ctx, prompt)
	if err != nil {
		return nil, fmt.Errorf("agent execution failed: %w", err)
	}

	result, err := ParseResult(output)
	if err != nil {
		return nil, fmt.Errorf("output parsing failed: %w", err)
	}

	maxComments := req.MaxComments
	if maxComments <= 0 {
		maxComments = 20
	}
	if len(result.Findings) > maxComments {
		result.Findings = result.Findings[:maxComments]
	}

	return result, nil
}

func collectFileContents(ctx context.Context, gitOps *GitOps, worktreePath string, changes []FileChange, baseSha, headSha string) (map[string]FileContentPair, error) {
	contents := make(map[string]FileContentPair, len(changes))

	for _, change := range changes {
		if shouldSkipFile(change.Path) {
			continue
		}

		pair := FileContentPair{}

		if change.Status != "added" {
			before, err := gitOps.FileContent(ctx, baseSha, change.Path)
			if err == nil {
				pair.Before = before
			}
		}

		if change.Status != "removed" {
			afterPath := filepath.Join(worktreePath, change.Path)
			data, err := os.ReadFile(afterPath)
			if err == nil {
				pair.After = string(data)
			}
		}

		contents[change.Path] = pair
	}

	return contents, nil
}

func filterIgnored(changes []FileChange, ignoredPatterns []string) []FileChange {
	if len(ignoredPatterns) == 0 {
		return changes
	}

	filtered := make([]FileChange, 0, len(changes))
	for _, change := range changes {
		if matchesAnyPattern(change.Path, ignoredPatterns) {
			continue
		}
		filtered = append(filtered, change)
	}
	return filtered
}

func matchesAnyPattern(path string, patterns []string) bool {
	for _, pattern := range patterns {
		pattern = strings.TrimSpace(pattern)
		if pattern == "" {
			continue
		}
		if strings.Contains(path, pattern) {
			return true
		}
	}
	return false
}

func shouldSkipFile(path string) bool {
	lower := strings.ToLower(path)
	skipSuffixes := []string{".lock", ".min.js", ".min.css", ".map", ".png", ".jpg", ".jpeg", ".gif", ".svg", ".ico", ".pdf", ".zip", ".gz", ".tar"}
	for _, suffix := range skipSuffixes {
		if strings.HasSuffix(lower, suffix) {
			return true
		}
	}
	skipDirs := []string{"node_modules/", "vendor/", "dist/", "build/", ".next/", "__pycache__/"}
	for _, dir := range skipDirs {
		if strings.HasPrefix(path, dir) {
			return true
		}
	}
	return false
}

func ParseResult(output string) (*Result, error) {
	jsonText := extractJSON(output)
	if jsonText == "" {
		return nil, errors.New("no JSON found in agent output")
	}

	var result Result
	if err := json.Unmarshal([]byte(jsonText), &result); err != nil {
		return nil, fmt.Errorf("JSON parse error: %w", err)
	}

	if result.Summary == "" {
		return nil, errors.New("review result is missing summary")
	}

	validSeverities := map[string]bool{"blocker": true, "major": true, "minor": true, "nit": true}
	validCategories := map[string]bool{
		"bug": true, "security": true, "performance": true, "maintainability": true,
		"test": true, "ux": true, "accessibility": true, "docs": true,
	}
	validSides := map[string]bool{"LEFT": true, "RIGHT": true}

	cleaned := make([]Finding, 0, len(result.Findings))
	for _, f := range result.Findings {
		if !validSeverities[f.Severity] {
			f.Severity = "minor"
		}
		if !validCategories[f.Category] {
			f.Category = "maintainability"
		}
		if !validSides[f.Side] {
			f.Side = "RIGHT"
		}
		if f.FilePath == "" {
			continue
		}
		cleaned = append(cleaned, f)
	}

	sort.Slice(cleaned, func(i, j int) bool {
		severityOrder := map[string]int{"blocker": 0, "major": 1, "minor": 2, "nit": 3}
		return severityOrder[cleaned[i].Severity] < severityOrder[cleaned[j].Severity]
	})

	result.Findings = cleaned
	return &result, nil
}

func extractJSON(text string) string {
	trimmed := strings.TrimSpace(text)

	if strings.HasPrefix(trimmed, "{") && strings.HasSuffix(trimmed, "}") {
		return trimmed
	}

	fenceStart := strings.Index(trimmed, "```json")
	if fenceStart < 0 {
		fenceStart = strings.Index(trimmed, "```")
	}
	if fenceStart >= 0 {
		rest := trimmed[fenceStart+3:]
		if strings.HasPrefix(rest, "json") {
			rest = rest[4:]
		}
		fenceEnd := strings.Index(rest, "```")
		if fenceEnd > 0 {
			return strings.TrimSpace(rest[:fenceEnd])
		}
	}

	start := strings.Index(trimmed, "{")
	end := strings.LastIndex(trimmed, "}")
	if start >= 0 && end > start {
		return trimmed[start : end+1]
	}

	return ""
}
