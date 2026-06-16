package main

import (
	"encoding/json"
	"fmt"
	"os"
	"runtime"

	"github.com/asthrix/fusion-harness/apps/runner-go/internal/adapters/codex"
	"github.com/asthrix/fusion-harness/apps/runner-go/internal/adapters/opencode"
	"github.com/asthrix/fusion-harness/apps/runner-go/internal/discovery"
	"github.com/asthrix/fusion-harness/apps/runner-go/internal/executors/docker"
)

const version = "0.1.0"

func main() {
	if len(os.Args) < 2 {
		printUsage()
		os.Exit(1)
	}

	switch os.Args[1] {
	case "doctor":
		runDoctor()
	case "discover":
		runDiscover(hasFlag("--json"))
	case "login", "logout", "serve", "run-test", "update":
		fmt.Printf("fusion-runner %s is scaffolded but not implemented yet\n", os.Args[1])
	case "config":
		fmt.Println("fusion-runner config is scaffolded but not implemented yet")
	default:
		printUsage()
		os.Exit(1)
	}
}

func printUsage() {
	fmt.Println("usage: fusion-runner <login|logout|doctor|discover|serve|run-test|config|update>")
}

func runDoctor() {
	report := buildDiscoveryReport()
	fmt.Printf("Fusion Runner %s\n", version)
	fmt.Printf("OS: %s %s\n", report.OS, report.Arch)
	fmt.Println("Tools:")
	for _, tool := range report.Tools {
		marker := "!"
		if tool.Found {
			marker = "+"
		}
		fmt.Printf("  %s %s %s %s\n", marker, tool.Tool, tool.Path, tool.Status)
	}
}

func runDiscover(asJSON bool) {
	report := buildDiscoveryReport()
	if asJSON {
		encoder := json.NewEncoder(os.Stdout)
		encoder.SetIndent("", "  ")
		_ = encoder.Encode(report)
		return
	}
	runDoctor()
}

func buildDiscoveryReport() discovery.Report {
	return discovery.Report{
		RunnerID: "runner_local",
		OS:       runtime.GOOS,
		Arch:     runtime.GOARCH,
		Tools: []discovery.Tool{
			opencode.Detect(),
			codex.Detect(),
			docker.Detect(),
			discovery.DetectCommand("git"),
		},
	}
}

func hasFlag(flag string) bool {
	for _, arg := range os.Args[2:] {
		if arg == flag {
			return true
		}
	}
	return false
}
