package main

import (
	"context"
	"encoding/json"
	"flag"
	"fmt"
	"io"
	"os"
	"os/signal"
	"runtime"
	"strings"
	"syscall"
	"time"

	"github.com/asthrix/fusion-harness/apps/runner-go/internal/cloud"
	"github.com/asthrix/fusion-harness/apps/runner-go/internal/config"
	"github.com/asthrix/fusion-harness/apps/runner-go/internal/discovery"
	"github.com/asthrix/fusion-harness/apps/runner-go/internal/executors/docker"
	"github.com/asthrix/fusion-harness/apps/runner-go/internal/executors/host"
	"github.com/asthrix/fusion-harness/apps/runner-go/internal/fusion"
	"github.com/asthrix/fusion-harness/apps/runner-go/internal/localagents"
	"github.com/asthrix/fusion-harness/apps/runner-go/internal/localui"
)

const version = "0.1.0"

func main() {
	if len(os.Args) < 2 {
		printUsage()
		os.Exit(1)
	}

	ctx := context.Background()
	switch os.Args[1] {
	case "doctor":
		exitOnError(runDoctor(ctx))
	case "discover":
		exitOnError(runDiscover(ctx, os.Args[2:]))
	case "login":
		exitOnError(runLogin(os.Args[2:]))
	case "logout":
		exitOnError(runLogout())
	case "serve":
		exitOnError(runServe(os.Args[2:]))
	case "run-test":
		exitOnError(runTest(ctx, os.Args[2:]))
	case "fuse":
		exitOnError(runFuse(ctx, os.Args[2:]))
	case "ui":
		exitOnError(runUI(os.Args[2:]))
	case "config":
		exitOnError(runConfig(os.Args[2:]))
	case "update":
		fmt.Println("fusion-runner update is reserved for signed updater integration")
	default:
		printUsage()
		os.Exit(1)
	}
}

func printUsage() {
	fmt.Println("usage: fusion-runner <login|logout|doctor|discover|serve|fuse|ui|run-test|config|update>")
}

func runDoctor(ctx context.Context) error {
	report, err := buildDiscoveryReport(ctx)
	if err != nil {
		return err
	}

	fmt.Printf("Fusion Runner %s\n", version)
	fmt.Printf("Runner: %s\n", report.RunnerID)
	fmt.Printf("OS: %s %s\n", report.OS, report.Arch)
	fmt.Println("Tools:")
	for _, tool := range report.Tools {
		marker := "!"
		if tool.Found {
			marker = "+"
		}
		versionText := ""
		if tool.Version != "" {
			versionText = " " + tool.Version
		}
		fmt.Printf("  %s %s %s%s %s\n", marker, tool.Tool, tool.Path, versionText, tool.Status)
	}
	fmt.Printf("Models: %d detected/configured\n", len(report.Models))
	return nil
}

func runDiscover(ctx context.Context, args []string) error {
	flags := flag.NewFlagSet("discover", flag.ContinueOnError)
	asJSON := flags.Bool("json", false, "write JSON output")
	if err := flags.Parse(args); err != nil {
		return err
	}

	report, err := buildDiscoveryReport(ctx)
	if err != nil {
		return err
	}
	if *asJSON {
		encoder := json.NewEncoder(os.Stdout)
		encoder.SetIndent("", "  ")
		return encoder.Encode(report)
	}
	return runDoctor(ctx)
}

func runLogin(args []string) error {
	flags := flag.NewFlagSet("login", flag.ContinueOnError)
	cloudURL := flags.String("cloud-url", "", "Fusion API base URL")
	token := flags.String("token", "", "runner token")
	if err := flags.Parse(args); err != nil {
		return err
	}

	cfg, err := config.Load()
	if err != nil {
		return err
	}
	if *cloudURL != "" {
		cfg.CloudURL = *cloudURL
	}
	if *token != "" {
		cfg.Token = *token
	}
	if cfg.RunnerID == "" {
		cfg.RunnerID = "runner_local"
	}
	if err := config.Save(cfg); err != nil {
		return err
	}

	path, _ := config.Path()
	fmt.Printf("saved runner config to %s\n", path)
	return nil
}

func runLogout() error {
	cfg, err := config.Load()
	if err != nil {
		return err
	}
	cfg.Token = ""
	return config.Save(cfg)
}

func runConfig(args []string) error {
	if len(args) == 0 || args[0] == "show" {
		cfg, err := config.Load()
		if err != nil {
			return err
		}
		cfg.Token = redact(cfg.Token)
		encoder := json.NewEncoder(os.Stdout)
		encoder.SetIndent("", "  ")
		return encoder.Encode(cfg)
	}

	if args[0] != "set" || len(args) < 3 {
		return fmt.Errorf("usage: fusion-runner config set <cloud-url|token|runner-id|default-profile|allowed-root|tool-dir> <value>")
	}

	cfg, err := config.Load()
	if err != nil {
		return err
	}

	switch args[1] {
	case "cloud-url":
		cfg.CloudURL = args[2]
	case "token":
		cfg.Token = args[2]
	case "runner-id":
		cfg.RunnerID = args[2]
	case "default-profile":
		cfg.DefaultProfile = args[2]
	case "allowed-root":
		cfg.AllowedRoots = append(cfg.AllowedRoots, args[2])
	case "tool-dir":
		cfg.ToolDirs = append(cfg.ToolDirs, args[2])
	default:
		return fmt.Errorf("unknown config key %q", args[1])
	}

	return config.Save(cfg)
}

func runServe(args []string) error {
	flags := flag.NewFlagSet("serve", flag.ContinueOnError)
	cloudURL := flags.String("cloud-url", "", "Fusion API base URL")
	interval := flags.Duration("heartbeat-interval", 30*time.Second, "heartbeat interval")
	once := flags.Bool("once", false, "register and send one heartbeat, then exit")
	if err := flags.Parse(args); err != nil {
		return err
	}

	cfg, err := config.Load()
	if err != nil {
		return err
	}
	if *cloudURL != "" {
		cfg.CloudURL = *cloudURL
	}

	ctx, stop := signal.NotifyContext(context.Background(), os.Interrupt, syscall.SIGTERM)
	defer stop()

	client := cloud.NewClient(cfg.CloudURL, cfg.Token)
	report, err := buildDiscoveryReport(ctx)
	if err != nil {
		return err
	}

	payload := registrationPayload(cfg, report)
	if err := client.RegisterRunner(ctx, payload); err != nil {
		return err
	}
	fmt.Printf("registered runner %s with %s\n", cfg.RunnerID, cfg.CloudURL)

	if *once {
		return client.Heartbeat(ctx, cfg.RunnerID, map[string]any{"runner_id": cfg.RunnerID})
	}

	ticker := time.NewTicker(*interval)
	defer ticker.Stop()

	for {
		select {
		case <-ctx.Done():
			return nil
		case <-ticker.C:
			if err := client.Heartbeat(ctx, cfg.RunnerID, map[string]any{"runner_id": cfg.RunnerID}); err != nil {
				fmt.Fprintf(os.Stderr, "heartbeat failed: %v\n", err)
			}
		}
	}
}

func runTest(ctx context.Context, args []string) error {
	flags := flag.NewFlagSet("run-test", flag.ContinueOnError)
	executor := flags.String("executor", "host", "host or docker")
	workspaceDir := flags.String("workspace", "", "workspace directory")
	image := flags.String("image", "node:22", "docker image for docker executor")
	timeout := flags.Duration("timeout", 5*time.Minute, "command timeout")
	if err := flags.Parse(args); err != nil {
		return err
	}
	if *workspaceDir == "" {
		return fmt.Errorf("--workspace is required")
	}
	command := flags.Args()
	if len(command) == 0 {
		return fmt.Errorf("command is required after flags")
	}

	cfg, err := config.Load()
	if err != nil {
		return err
	}

	var result host.Result
	if *executor == "docker" {
		result, err = docker.Run(ctx, docker.CommandSpec{
			Image:        *image,
			Command:      command,
			WorkspaceDir: *workspaceDir,
			AllowedRoots: cfg.AllowedRoots,
			Timeout:      *timeout,
		})
	} else {
		result, err = host.Run(ctx, host.CommandSpec{
			Name:         command[0],
			Args:         command[1:],
			WorkingDir:   *workspaceDir,
			AllowedRoots: cfg.AllowedRoots,
			Timeout:      *timeout,
		})
	}

	if result.Stdout != "" {
		fmt.Print(result.Stdout)
	}
	if result.Stderr != "" {
		fmt.Fprint(os.Stderr, result.Stderr)
	}
	return err
}

func runFuse(ctx context.Context, args []string) error {
	flags := flag.NewFlagSet("fuse", flag.ContinueOnError)
	workspaceDir := flags.String("workspace", "", "workspace directory")
	prompt := flags.String("prompt", "", "prompt text")
	promptFile := flags.String("prompt-file", "", "file containing prompt text")
	judgeModel := flags.String("judge-model", "", "judge model id")
	finalModel := flags.String("final-model", "", "final writer model id")
	mode := flags.String("mode", "required", "direct, auto, or required")
	permissionProfile := flags.String("permission-profile", "", "readonly, workspace_write, or trusted_internal")
	timeout := flags.Duration("timeout", 10*time.Minute, "per-model timeout")
	asJSON := flags.Bool("json", false, "write full JSON output")
	var analysisModels stringListFlag
	flags.Var(&analysisModels, "analysis-model", "analysis model id; repeat for multiple panel models")
	if err := flags.Parse(args); err != nil {
		return err
	}
	if *workspaceDir == "" {
		return fmt.Errorf("--workspace is required")
	}
	promptText, err := resolvePrompt(*prompt, *promptFile)
	if err != nil {
		return err
	}
	if strings.TrimSpace(promptText) == "" {
		return fmt.Errorf("--prompt or --prompt-file is required")
	}

	cfg, err := config.Load()
	if err != nil {
		return err
	}
	profile := *permissionProfile
	if profile == "" {
		profile = cfg.DefaultProfile
	}
	result, err := fusion.Execute(ctx, fusion.Request{
		Prompt:            promptText,
		WorkspacePath:     *workspaceDir,
		Mode:              *mode,
		AnalysisModels:    analysisModels,
		JudgeModel:        *judgeModel,
		FinalModel:        *finalModel,
		PermissionProfile: profile,
		TimeoutMs:         int(timeout.Milliseconds()),
		AllowedRoots:      allowedRootsWithWorkspace(cfg.AllowedRoots, *workspaceDir),
		ToolDirs:          cfg.ToolDirs,
	})
	if err != nil {
		return err
	}
	if *asJSON {
		encoder := json.NewEncoder(os.Stdout)
		encoder.SetIndent("", "  ")
		return encoder.Encode(result)
	}
	if result.FinalAnswer != "" {
		fmt.Println(result.FinalAnswer)
		return nil
	}
	if result.Error != "" {
		return fmt.Errorf("%s", result.Error)
	}
	return nil
}

func runUI(args []string) error {
	flags := flag.NewFlagSet("ui", flag.ContinueOnError)
	address := flags.String("addr", "127.0.0.1:7457", "local UI address")
	workspaceDir := flags.String("workspace", "", "default workspace directory")
	permissionProfile := flags.String("permission-profile", "", "readonly, workspace_write, or trusted_internal")
	timeout := flags.Duration("timeout", 10*time.Minute, "per-model timeout")
	if err := flags.Parse(args); err != nil {
		return err
	}
	cfg, err := config.Load()
	if err != nil {
		return err
	}
	cfg.AllowedRoots = allowedRootsWithWorkspace(cfg.AllowedRoots, *workspaceDir)
	ctx, stop := signal.NotifyContext(context.Background(), os.Interrupt, syscall.SIGTERM)
	defer stop()
	fmt.Printf("Open %s in your browser\n", localui.FormatAddress(*address))
	return localui.Serve(ctx, localui.Options{
		Address:           *address,
		WorkspacePath:     *workspaceDir,
		PermissionProfile: *permissionProfile,
		Timeout:           *timeout,
		Config:            cfg,
	})
}

func buildDiscoveryReport(ctx context.Context) (discovery.Report, error) {
	cfg, err := config.Load()
	if err != nil {
		return discovery.Report{}, err
	}

	models := make([]any, 0)

	for _, model := range localagents.ListModels(ctx, cfg.AllowedRoots, cfg.ToolDirs) {
		models = append(models, model)
	}

	tools := localagents.DetectAll(ctx, cfg.ToolDirs)
	tools = append(
		tools,
		docker.Detect(),
		discovery.DetectCommandWithVersion(ctx, "git", "--version"),
	)

	return discovery.Report{
		RunnerID: cfg.RunnerID,
		OS:       runtime.GOOS,
		Arch:     runtime.GOARCH,
		Tools:    tools,
		Models:   models,
	}, nil
}

func registrationPayload(cfg config.Config, report discovery.Report) map[string]any {
	adaptersAvailable := make([]string, 0)
	executors := []string{"host"}
	dockerAvailable := false

	for _, tool := range report.Tools {
		if tool.Found {
			if tool.Tool == "opencode" || tool.Tool == "codex" {
				adaptersAvailable = append(adaptersAvailable, tool.Tool)
			} else if agentID, ok := tool.Metadata["agentId"].(string); ok && agentID != "" {
				adaptersAvailable = append(adaptersAvailable, agentID)
			}
		}
		if tool.Found && tool.Tool == "docker" {
			dockerAvailable = true
			executors = append(executors, "docker")
		}
	}

	return map[string]any{
		"runnerId": cfg.RunnerID,
		"name":     cfg.RunnerID,
		"os":       report.OS,
		"arch":     report.Arch,
		"version":  version,
		"capabilities": map[string]any{
			"adapters":       adaptersAvailable,
			"executors":      executors,
			"workspaceWrite": cfg.DefaultProfile != "readonly",
			"shell":          cfg.DefaultProfile == "trusted_internal",
			"docker":         dockerAvailable,
		},
		"tools":  report.Tools,
		"models": report.Models,
	}
}

func redact(value string) string {
	if value == "" {
		return ""
	}
	if len(value) <= 8 {
		return "********"
	}
	return value[:4] + strings.Repeat("*", len(value)-8) + value[len(value)-4:]
}

func exitOnError(err error) {
	if err == nil {
		return
	}
	fmt.Fprintln(os.Stderr, err)
	os.Exit(1)
}

type stringListFlag []string

func (value *stringListFlag) String() string {
	return strings.Join(*value, ",")
}

func (value *stringListFlag) Set(item string) error {
	trimmed := strings.TrimSpace(item)
	if trimmed == "" {
		return fmt.Errorf("model id cannot be empty")
	}
	*value = append(*value, trimmed)
	return nil
}

func resolvePrompt(prompt string, promptFile string) (string, error) {
	if prompt != "" {
		return prompt, nil
	}
	if promptFile != "" {
		data, err := os.ReadFile(promptFile)
		if err != nil {
			return "", err
		}
		return string(data), nil
	}
	stat, err := os.Stdin.Stat()
	if err == nil && stat.Mode()&os.ModeCharDevice == 0 {
		data, readErr := io.ReadAll(os.Stdin)
		if readErr != nil {
			return "", readErr
		}
		return string(data), nil
	}
	return "", nil
}

func allowedRootsWithWorkspace(roots []string, workspaceDir string) []string {
	if strings.TrimSpace(workspaceDir) == "" {
		return roots
	}
	for _, root := range roots {
		if root == workspaceDir {
			return roots
		}
	}
	return append(append([]string{}, roots...), workspaceDir)
}
