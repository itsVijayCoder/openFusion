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
	"sync/atomic"
	"syscall"
	"time"

	"github.com/asthrix/openfusion/apps/runner-go/internal/adapters"
	"github.com/asthrix/openfusion/apps/runner-go/internal/adapters/codex"
	"github.com/asthrix/openfusion/apps/runner-go/internal/adapters/opencode"
	"github.com/asthrix/openfusion/apps/runner-go/internal/cloud"
	"github.com/asthrix/openfusion/apps/runner-go/internal/config"
	"github.com/asthrix/openfusion/apps/runner-go/internal/discovery"
	"github.com/asthrix/openfusion/apps/runner-go/internal/executors/docker"
	"github.com/asthrix/openfusion/apps/runner-go/internal/executors/host"
	"github.com/asthrix/openfusion/apps/runner-go/internal/fusion"
	"github.com/asthrix/openfusion/apps/runner-go/internal/localagents"
	"github.com/asthrix/openfusion/apps/runner-go/internal/localui"
	"github.com/asthrix/openfusion/apps/runner-go/internal/terminal"
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
		cfg.AllowedRoots = appendUniqueString(cfg.AllowedRoots, args[2])
	case "tool-dir":
		cfg.ToolDirs = appendUniqueString(cfg.ToolDirs, args[2])
	default:
		return fmt.Errorf("unknown config key %q", args[1])
	}

	return config.Save(cfg)
}

func runServe(args []string) error {
	flags := flag.NewFlagSet("serve", flag.ContinueOnError)
	cloudURL := flags.String("cloud-url", "", "Fusion API base URL")
	token := flags.String("token", "", "runner token")
	interval := flags.Duration("heartbeat-interval", 30*time.Second, "heartbeat interval")
	pollInterval := flags.Duration("poll-interval", 2*time.Second, "job claim poll interval")
	leaseSeconds := flags.Int("lease-seconds", 300, "job lease duration in seconds")
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
	if *token != "" {
		cfg.Token = *token
		if err := config.Save(cfg); err != nil {
			return err
		}
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

	go heartbeatLoop(ctx, client, cfg.RunnerID, *interval)
	return jobClaimLoop(ctx, client, cfg, *pollInterval, *leaseSeconds)
}

func heartbeatLoop(ctx context.Context, client cloud.Client, runnerID string, interval time.Duration) {
	ticker := time.NewTicker(interval)
	defer ticker.Stop()

	for {
		select {
		case <-ctx.Done():
			return
		case <-ticker.C:
			if err := client.Heartbeat(ctx, runnerID, map[string]any{"runner_id": runnerID}); err != nil {
				fmt.Fprintf(os.Stderr, "heartbeat failed: %v\n", err)
			}
		}
	}
}

func jobClaimLoop(ctx context.Context, client cloud.Client, cfg config.Config, pollInterval time.Duration, leaseSeconds int) error {
	if pollInterval <= 0 {
		pollInterval = 2 * time.Second
	}
	if leaseSeconds <= 0 {
		leaseSeconds = 300
	}

	ticker := time.NewTicker(pollInterval)
	defer ticker.Stop()

	for {
		job, err := client.ClaimJob(ctx, cfg.RunnerID, cfg.RunnerID, leaseSeconds)
		if err != nil {
			fmt.Fprintf(os.Stderr, "job claim failed: %v\n", err)
		} else if job != nil {
			if err := executeCloudJob(ctx, client, cfg, *job); err != nil {
				fmt.Fprintf(os.Stderr, "job %s failed: %v\n", job.ID, err)
			}
			continue
		}

		select {
		case <-ctx.Done():
			return nil
		case <-ticker.C:
		}
	}
}

func executeCloudJob(ctx context.Context, client cloud.Client, cfg config.Config, job cloud.ClaimedJob) error {
	payload := job.Payload
	if payload.JobID == "" {
		payload.JobID = job.ID
	}
	if payload.RunID == "" {
		payload.RunID = job.RunID
	}
	if payload.PermissionProfile == "" {
		payload.PermissionProfile = cfg.DefaultProfile
	}
	if payload.TimeoutMs <= 0 {
		payload.TimeoutMs = int((10 * time.Minute).Milliseconds())
	}
	jobCtx, stopJobContext, cancelledByCloud := cloudCancellableJobContext(ctx, client, cfg.RunnerID, payload.JobID)
	defer stopJobContext()

	workspacePath, allowedRoots, err := workspacePathForJob(payload, cfg)
	if err != nil {
		failErr := client.FailJob(ctx, cfg.RunnerID, payload.JobID, cloud.JobCompletion{
			Status: "failed",
			Error:  err.Error(),
		})
		if failErr != nil {
			return fmt.Errorf("%w; additionally failed to report job failure: %v", err, failErr)
		}
		return err
	}

	runner, err := adapterForCloudJob(payload.Adapter, cfg, allowedRoots)
	if err != nil {
		failErr := client.FailJob(ctx, cfg.RunnerID, payload.JobID, cloud.JobCompletion{
			Status: "failed",
			Error:  err.Error(),
		})
		if failErr != nil {
			return fmt.Errorf("%w; additionally failed to report job failure: %v", err, failErr)
		}
		return err
	}

	if payload.Kind == "pr_review" {
		return fmt.Errorf("pr_review jobs are not supported in this build")
	}

	input := adapters.RunInput{
		RunID:             payload.RunID,
		JobID:             payload.JobID,
		WorkspacePath:     workspacePath,
		Prompt:            payload.Prompt,
		Model:             modelArg(payload.Model),
		PermissionProfile: payload.PermissionProfile,
		TimeoutMs:         payload.TimeoutMs,
	}
	emit := func(event adapters.RunEvent) {
		event.Type = eventTypeForKind(event.Type, payload.Kind)
		if err := client.PostJobEvent(ctx, cfg.RunnerID, payload.JobID, cloudEventFromAdapter(event, cfg.RunnerID)); err != nil {
			fmt.Fprintf(os.Stderr, "failed to post job event %s: %v\n", event.Type, err)
		}
	}

	result, runErr := runner.Run(jobCtx, input, emit)
	if result == nil {
		result = &adapters.RunResult{Status: "failed"}
	}
	if cancelledByCloud.Load() {
		result.Status = "cancelled"
		if result.Error == "" {
			result.Error = "job cancelled by user"
		}
	}
	if runErr != nil && result.Error == "" {
		result.Error = runErr.Error()
	}
	if result.OutputText != "" {
		if err := client.PostJobEvent(ctx, cfg.RunnerID, payload.JobID, cloud.RunnerEvent{
			Type:      outputEventType(payload.Kind),
			RunID:     payload.RunID,
			JobID:     payload.JobID,
			RunnerID:  cfg.RunnerID,
			Timestamp: time.Now().UTC().Format(time.RFC3339),
			Data: map[string]any{
				"text":      result.OutputText,
				"modelId":   payload.ModelID,
				"adapter":   payload.Adapter,
				"model":     payload.Model,
				"role":      payload.Role,
				"fullChunk": true,
			},
		}); err != nil {
			fmt.Fprintf(os.Stderr, "failed to post output event for job %s: %v\n", payload.JobID, err)
		}
	}

	completion := cloud.JobCompletion{
		Status:       result.Status,
		OutputText:   result.OutputText,
		Error:        result.Error,
		LatencyMs:    result.LatencyMs,
		Usage:        result.Usage,
		ArtifactKeys: result.ArtifactKeys,
	}
	if result.Status == "completed" && runErr == nil {
		return client.CompleteJob(ctx, cfg.RunnerID, payload.JobID, completion)
	}
	if completion.Status == "" || completion.Status == "completed" {
		completion.Status = "failed"
	}
	return client.FailJob(ctx, cfg.RunnerID, payload.JobID, completion)
}

func cloudCancellableJobContext(ctx context.Context, client cloud.Client, runnerID string, jobID string) (context.Context, func(), *atomic.Bool) {
	jobCtx, cancel := context.WithCancel(ctx)
	done := make(chan struct{})
	cancelledByCloud := &atomic.Bool{}

	go func() {
		ticker := time.NewTicker(2 * time.Second)
		defer ticker.Stop()

		for {
			select {
			case <-jobCtx.Done():
				return
			case <-done:
				return
			case <-ticker.C:
				state, err := client.GetJobState(ctx, runnerID, jobID)
				if err != nil {
					continue
				}
				if shouldCancelLocalJob(state) {
					cancelledByCloud.Store(true)
					cancel()
					return
				}
			}
		}
	}()

	stop := func() {
		close(done)
		cancel()
	}
	return jobCtx, stop, cancelledByCloud
}

func shouldCancelLocalJob(state cloud.JobState) bool {
	return state.Status == "cancelled" || state.RunStatus == "cancelled" || state.RunStatus == "deleted"
}

func adapterForCloudJob(adapter string, cfg config.Config, allowedRoots []string) (adapters.Adapter, error) {
	switch adapter {
	case "opencode":
		return opencode.Adapter{AllowedRoots: allowedRoots, ToolDirs: cfg.ToolDirs}, nil
	case "codex":
		return codex.Adapter{AllowedRoots: allowedRoots, ToolDirs: cfg.ToolDirs}, nil
	default:
		if strings.TrimSpace(adapter) == "" {
			return nil, fmt.Errorf("job adapter is required")
		}
		return nil, fmt.Errorf("%s execution is not implemented in the Go runner yet", adapter)
	}
}

func workspacePathForJob(payload cloud.JobPayload, cfg config.Config) (string, []string, error) {
	if strings.TrimSpace(payload.WorkspacePath) != "" {
		return payload.WorkspacePath, allowedRootsWithWorkspace(cfg.AllowedRoots, payload.WorkspacePath), nil
	}

	for _, root := range cfg.AllowedRoots {
		if strings.TrimSpace(root) == "" {
			continue
		}
		if info, err := os.Stat(root); err == nil && info.IsDir() {
			return root, cfg.AllowedRoots, nil
		}
	}

	cwd, err := os.Getwd()
	if err != nil {
		return "", nil, err
	}
	return cwd, allowedRootsWithWorkspace(cfg.AllowedRoots, cwd), nil
}

func cloudEventFromAdapter(event adapters.RunEvent, runnerID string) cloud.RunnerEvent {
	timestamp := event.Timestamp
	if timestamp == "" {
		timestamp = time.Now().UTC().Format(time.RFC3339)
	}
	data := event.Data
	if data == nil {
		data = map[string]any{}
	}

	return cloud.RunnerEvent{
		Type:      event.Type,
		RunID:     event.RunID,
		JobID:     event.JobID,
		RunnerID:  runnerID,
		Timestamp: timestamp,
		Data:      data,
	}
}

func outputEventType(kind string) string {
	switch kind {
	case "direct", "final":
		return "final.delta"
	case "judge":
		return "judge.output.delta"
	default:
		return "panel.output.delta"
	}
}

func eventTypeForKind(eventType string, kind string) string {
	if eventType != "panel.job.started" {
		return eventType
	}
	switch kind {
	case "judge":
		return "judge.started"
	case "direct", "final":
		return "final.started"
	default:
		return eventType
	}
}

func modelArg(model string) string {
	if model == "default" {
		return ""
	}
	return model
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
	terminalMode := flags.String("terminal", "native", "terminal execution mode: native, json, or headless")
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

	var sessionMgr *terminal.SessionManager
	if *terminalMode != "headless" {
		sessionMgr = terminal.NewSessionManager(terminal.DefaultResourceLimits(), nil)
		if !sessionMgr.Available() {
			fmt.Fprintf(os.Stderr, "warning: PTY not available on this platform, falling back to headless mode\n")
			sessionMgr = nil
		}
	}
	defer func() {
		if sessionMgr != nil {
			sessionMgr.KillAll()
		}
	}()

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
		SessionManager:    sessionMgr,
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
	terminalMode := flags.String("terminal", "native", "terminal execution mode: native, json, or headless")
	if err := flags.Parse(args); err != nil {
		return err
	}
	cfg, err := config.Load()
	if err != nil {
		return err
	}
	cfg.AllowedRoots = allowedRootsWithWorkspace(cfg.AllowedRoots, *workspaceDir)

	var sessionMgr *terminal.SessionManager
	if *terminalMode != "headless" {
		sessionMgr = terminal.NewSessionManager(terminal.DefaultResourceLimits(), nil)
		if !sessionMgr.Available() {
			fmt.Fprintf(os.Stderr, "warning: PTY not available on this platform, falling back to headless mode\n")
			sessionMgr = nil
		}
	}

	ctx, stop := signal.NotifyContext(context.Background(), os.Interrupt, syscall.SIGTERM)
	defer stop()
	defer func() {
		if sessionMgr != nil {
			sessionMgr.KillAll()
		}
	}()
	fmt.Printf("Open %s in your browser\n", localui.FormatAddress(*address))
	return localui.Serve(ctx, localui.Options{
		Address:           *address,
		WorkspacePath:     *workspaceDir,
		PermissionProfile: *permissionProfile,
		Timeout:           *timeout,
		Config:            cfg,
		SessionManager:    sessionMgr,
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

func appendUniqueString(items []string, value string) []string {
	trimmed := strings.TrimSpace(value)
	if trimmed == "" {
		return items
	}
	for _, item := range items {
		if item == trimmed {
			return items
		}
	}
	return append(items, trimmed)
}
