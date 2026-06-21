package prreview

import (
	"encoding/json"
	"fmt"
	"os"
	"path/filepath"
	"strings"
)

type RepoIntelligence struct {
	ProjectType      string   `json:"projectType"`
	Frameworks       []string `json:"frameworks"`
	PackageManager   string   `json:"packageManager"`
	BuildTools       []string `json:"buildTools"`
	TestCommands     []string `json:"testCommands"`
	ImportantDirs    []string `json:"importantDirs"`
	AppBoundaries    []string `json:"appBoundaries"`
	DatabasePatterns []string `json:"databasePatterns"`
	AuthPatterns     []string `json:"authPatterns"`
	RiskyAreas       []string `json:"riskyAreas"`
}

func BuildIntelligence(repoPath string) string {
	intel := analyzeRepo(repoPath)
	return formatIntelligence(intel)
}

func analyzeRepo(repoPath string) *RepoIntelligence {
	intel := &RepoIntelligence{
		Frameworks:    []string{},
		BuildTools:    []string{},
		TestCommands:  []string{},
		ImportantDirs: []string{},
		AppBoundaries: []string{},
	}

	if fileExists(filepath.Join(repoPath, "package.json")) {
		intel.ProjectType = "Node.js"
		intel.PackageManager = detectPackageManager(repoPath)
		analyzePackageJSON(repoPath, intel)
	}

	if fileExists(filepath.Join(repoPath, "go.mod")) {
		intel.ProjectType = "Go"
		intel.BuildTools = append(intel.BuildTools, "go")
		intel.TestCommands = append(intel.TestCommands, "go test ./...")
	}

	if fileExists(filepath.Join(repoPath, "Cargo.toml")) {
		intel.ProjectType = "Rust"
		intel.BuildTools = append(intel.BuildTools, "cargo")
		intel.TestCommands = append(intel.TestCommands, "cargo test")
	}

	if fileExists(filepath.Join(repoPath, "pyproject.toml")) || fileExists(filepath.Join(repoPath, "requirements.txt")) {
		intel.ProjectType = "Python"
		intel.TestCommands = append(intel.TestCommands, "pytest")
	}

	detectImportantDirs(repoPath, intel)
	detectPatterns(repoPath, intel)

	return intel
}

func detectPackageManager(repoPath string) string {
	if fileExists(filepath.Join(repoPath, "pnpm-lock.yaml")) {
		return "pnpm"
	}
	if fileExists(filepath.Join(repoPath, "yarn.lock")) {
		return "yarn"
	}
	if fileExists(filepath.Join(repoPath, "bun.lockb")) {
		return "bun"
	}
	if fileExists(filepath.Join(repoPath, "package-lock.json")) {
		return "npm"
	}
	return "npm"
}

func analyzePackageJSON(repoPath string, intel *RepoIntelligence) {
	data, err := os.ReadFile(filepath.Join(repoPath, "package.json"))
	if err != nil {
		return
	}

	var pkg struct {
		Scripts map[string]string   `json:"scripts"`
		Deps    map[string]struct{} `json:"dependencies"`
		DevDeps map[string]struct{} `json:"devDependencies"`
	}
	if err := json.Unmarshal(data, &pkg); err != nil {
		return
	}

	if _, ok := pkg.Deps["next"]; ok {
		intel.Frameworks = append(intel.Frameworks, "Next.js")
	}
	if _, ok := pkg.Deps["react"]; ok {
		intel.Frameworks = append(intel.Frameworks, "React")
	}
	if _, ok := pkg.Deps["hono"]; ok {
		intel.Frameworks = append(intel.Frameworks, "Hono")
	}
	if _, ok := pkg.Deps["express"]; ok {
		intel.Frameworks = append(intel.Frameworks, "Express")
	}
	if _, ok := pkg.Deps["drizzle-orm"]; ok {
		intel.DatabasePatterns = append(intel.DatabasePatterns, "Drizzle ORM")
	}

	if cmd, ok := pkg.Scripts["test"]; ok {
		intel.TestCommands = append(intel.TestCommands, "npm test ("+cmd+")")
	}
	if cmd, ok := pkg.Scripts["lint"]; ok {
		intel.BuildTools = append(intel.BuildTools, "eslint")
		_ = cmd
	}
	if cmd, ok := pkg.Scripts["build"]; ok {
		intel.BuildTools = append(intel.BuildTools, "build script")
		_ = cmd
	}
	if cmd, ok := pkg.Scripts["typecheck"]; ok {
		intel.BuildTools = append(intel.BuildTools, "tsc")
		_ = cmd
	}
}

func detectImportantDirs(repoPath string, intel *RepoIntelligence) {
	entries, err := os.ReadDir(repoPath)
	if err != nil {
		return
	}

	for _, entry := range entries {
		if !entry.IsDir() {
			continue
		}
		name := entry.Name()
		if strings.HasPrefix(name, ".") {
			continue
		}
		switch name {
		case "src", "app", "lib", "internal", "cmd", "packages", "apps", "workers", "api":
			intel.ImportantDirs = append(intel.ImportantDirs, name)
		}
	}
}

func detectPatterns(repoPath string, intel *RepoIntelligence) {
	if dirExists(filepath.Join(repoPath, "migrations")) || dirExists(filepath.Join(repoPath, "packages", "db", "migrations")) {
		intel.DatabasePatterns = append(intel.DatabasePatterns, "SQL migrations")
	}

	authIndicators := []string{
		"auth", "middleware", "clerk", "auth0", "next-auth", "lucia",
	}
	for _, indicator := range authIndicators {
		if pathContainsFile(repoPath, indicator) {
			intel.AuthPatterns = append(intel.AuthPatterns, indicator)
		}
	}

	riskyIndicators := []string{
		"secrets", "keys", "tokens", "payments", "billing", "webhooks",
	}
	for _, indicator := range riskyIndicators {
		if pathContainsFile(repoPath, indicator) {
			intel.RiskyAreas = append(intel.RiskyAreas, indicator)
		}
	}
}

func formatIntelligence(intel *RepoIntelligence) string {
	var b strings.Builder
	b.WriteString("## Repository Intelligence\n\n")
	b.WriteString(fmt.Sprintf("Project type: %s\n", intel.ProjectType))
	if len(intel.Frameworks) > 0 {
		b.WriteString(fmt.Sprintf("Frameworks: %s\n", strings.Join(intel.Frameworks, ", ")))
	}
	if intel.PackageManager != "" {
		b.WriteString(fmt.Sprintf("Package manager: %s\n", intel.PackageManager))
	}
	if len(intel.BuildTools) > 0 {
		b.WriteString(fmt.Sprintf("Build tools: %s\n", strings.Join(intel.BuildTools, ", ")))
	}
	if len(intel.TestCommands) > 0 {
		b.WriteString(fmt.Sprintf("Test commands: %s\n", strings.Join(intel.TestCommands, ", ")))
	}
	if len(intel.ImportantDirs) > 0 {
		b.WriteString(fmt.Sprintf("Important directories: %s\n", strings.Join(intel.ImportantDirs, ", ")))
	}
	if len(intel.DatabasePatterns) > 0 {
		b.WriteString(fmt.Sprintf("Database patterns: %s\n", strings.Join(intel.DatabasePatterns, ", ")))
	}
	if len(intel.AuthPatterns) > 0 {
		b.WriteString(fmt.Sprintf("Auth patterns: %s\n", strings.Join(intel.AuthPatterns, ", ")))
	}
	if len(intel.RiskyAreas) > 0 {
		b.WriteString(fmt.Sprintf("Risky areas: %s\n", strings.Join(intel.RiskyAreas, ", ")))
	}
	return b.String()
}

func fileExists(path string) bool {
	info, err := os.Stat(path)
	return err == nil && !info.IsDir()
}

func dirExists(path string) bool {
	info, err := os.Stat(path)
	return err == nil && info.IsDir()
}

func pathContainsFile(root, name string) bool {
	found := false
	filepath.WalkDir(root, func(path string, d os.DirEntry, err error) error {
		if err != nil || d.IsDir() {
			return nil
		}
		if strings.Contains(strings.ToLower(path), name) {
			found = true
			return filepath.SkipAll
		}
		return nil
	})
	return found
}
