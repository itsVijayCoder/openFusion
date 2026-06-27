package localagents

import (
	"context"
	"encoding/json"
	"fmt"
	"os"
	"strings"
	"time"

	"github.com/asthrix/openfusion/apps/runner-go/internal/acp"
	"github.com/asthrix/openfusion/apps/runner-go/internal/adapters"
	"github.com/asthrix/openfusion/apps/runner-go/internal/discovery"
	"github.com/asthrix/openfusion/apps/runner-go/internal/executors/host"
)

type AgentDef struct {
	ID               string
	Name             string
	Binary           string
	FallbackBinaries []string
	EnvOverride      string
	VersionArgs      []string
	ListModelsArgs   []string
	ListModelsParser func(string) []ModelOption
	FetchModels      func(ctx context.Context, def AgentDef, path string, allowedRoots []string) ([]ModelOption, error)
	FallbackModels   []ModelOption
	Provider         string
	TerminalSpec     TerminalSpecHint
}

// TerminalSpecHint declares how a CLI should be launched in a real PTY
// terminal session. This makes any catalogued agent executable without
// per-CLI Go code.
type TerminalSpecHint struct {
	PromptMode     adapters.PromptMode
	PromptFlag     string
	ModelFlag      string
	OutputMode     adapters.OutputMode
	JSONRunArgs    []string
	ChromePatterns []string
	ReadyDelayMs   int
}

type ModelOption struct {
	ID          string
	DisplayName string
	Provider    string
}

func Catalog() []AgentDef {
	return append(baseCatalog(), readLocalAgentProfiles(baseCatalog())...)
}

// FindByID returns the AgentDef with the given ID, or nil if not found.
func FindByID(id string) *AgentDef {
	for _, def := range Catalog() {
		if def.ID == id {
			return &def
		}
	}
	return nil
}

func baseCatalog() []AgentDef {
	return []AgentDef{
		{
			ID:               "opencode",
			Name:             "OpenCode",
			Binary:           "opencode-cli",
			FallbackBinaries: []string{"opencode"},
			EnvOverride:      "OPENCODE_BIN",
			VersionArgs:      []string{"--version"},
			ListModelsArgs:   []string{"models"},
			FallbackModels: models(
				"anthropic/claude-sonnet-4-5",
				"openai/gpt-5",
				"google/gemini-2.5-pro",
				"minimax/minimax-m1",
				"deepseek/deepseek-chat",
				"moonshotai/kimi-k2",
			),
			TerminalSpec: TerminalSpecHint{
				PromptMode:  adapters.PromptModeStdin,
				ModelFlag:   "--model",
				OutputMode:  adapters.OutputModeJSON,
				JSONRunArgs: []string{"run", "--format", "json", "-"},
			},
		},
		{
			ID:               "claude",
			Name:             "Claude Code",
			Binary:           "claude",
			FallbackBinaries: []string{"openclaude"},
			EnvOverride:      "CLAUDE_BIN",
			VersionArgs:      []string{"--version"},
			Provider:         "anthropic",
			FallbackModels: models(
				"sonnet",
				"opus",
				"haiku",
				"claude-opus-4-5",
				"claude-sonnet-4-5",
				"claude-haiku-4-5",
			),
			TerminalSpec: TerminalSpecHint{
				PromptMode:   adapters.PromptModeKeystrokes,
				ModelFlag:    "--model",
				OutputMode:   adapters.OutputModeNative,
				ReadyDelayMs: 800,
			},
		},
		{
			ID:               "codex",
			Name:             "Codex CLI",
			Binary:           "codex",
			EnvOverride:      "CODEX_BIN",
			VersionArgs:      []string{"--version"},
			ListModelsArgs:   []string{"debug", "models"},
			ListModelsParser: ParseCodexDebugModels,
			Provider:         "openai",
			FallbackModels: models(
				"gpt-5.5",
				"gpt-5.4",
				"gpt-5.4-mini",
				"gpt-5.3-codex",
				"gpt-5.1",
				"gpt-5.1-codex-mini",
				"gpt-5-codex",
				"gpt-5",
				"o3",
				"o4-mini",
			),
			TerminalSpec: TerminalSpecHint{
				PromptMode:  adapters.PromptModeStdin,
				ModelFlag:   "--model",
				OutputMode:  adapters.OutputModeJSON,
				JSONRunArgs: []string{"exec", "--json", "--skip-git-repo-check", "--sandbox", "workspace-write", "-"},
			},
		},
		{
			ID:             "cursor-agent",
			Name:           "Cursor Agent",
			Binary:         "cursor-agent",
			EnvOverride:    "CURSOR_AGENT_BIN",
			VersionArgs:    []string{"--version"},
			ListModelsArgs: []string{"models"},
			FallbackModels: models("auto", "sonnet-4", "sonnet-4-thinking", "gpt-5"),
			TerminalSpec: TerminalSpecHint{
				PromptMode:   adapters.PromptModeKeystrokes,
				OutputMode:   adapters.OutputModeNative,
				ReadyDelayMs: 800,
			},
		},
		{
			ID:          "gemini",
			Name:        "Gemini CLI",
			Binary:      "gemini",
			EnvOverride: "GEMINI_BIN",
			VersionArgs: []string{"--version"},
			Provider:    "google",
			FallbackModels: models(
				"gemini-3-pro-preview",
				"gemini-3-flash-preview",
				"gemini-2.5-pro",
				"gemini-2.5-flash",
				"gemini-2.5-flash-lite",
			),
			TerminalSpec: TerminalSpecHint{
				PromptMode:   adapters.PromptModeKeystrokes,
				ModelFlag:    "--model",
				OutputMode:   adapters.OutputModeNative,
				ReadyDelayMs: 800,
			},
		},
		{
			ID:          "qwen",
			Name:        "Qwen Code",
			Binary:      "qwen",
			EnvOverride: "QWEN_BIN",
			VersionArgs: []string{"--version"},
			Provider:    "qwen",
			FallbackModels: models(
				"qwen3-coder-plus",
				"qwen3-coder-flash",
			),
			TerminalSpec: TerminalSpecHint{
				PromptMode:   adapters.PromptModeKeystrokes,
				ModelFlag:    "--model",
				OutputMode:   adapters.OutputModeNative,
				ReadyDelayMs: 800,
			},
		},
		{
			ID:          "qoder",
			Name:        "Qoder CLI",
			Binary:      "qodercli",
			EnvOverride: "QODER_BIN",
			VersionArgs: []string{"--version"},
			FallbackModels: labels(
				model("lite", "Lite"),
				model("efficient", "Efficient"),
				model("auto", "Auto"),
				model("performance", "Performance"),
				model("ultimate", "Ultimate"),
			),
			TerminalSpec: TerminalSpecHint{
				PromptMode:   adapters.PromptModeKeystrokes,
				OutputMode:   adapters.OutputModeNative,
				ReadyDelayMs: 800,
			},
		},
		{
			ID:          "copilot",
			Name:        "GitHub Copilot CLI",
			Binary:      "copilot",
			EnvOverride: "COPILOT_BIN",
			VersionArgs: []string{"--version"},
			FallbackModels: labels(
				model("claude-sonnet-4.6", "Claude Sonnet 4.6"),
				model("gpt-5.2", "GPT-5.2"),
			),
			TerminalSpec: TerminalSpecHint{
				PromptMode:   adapters.PromptModeKeystrokes,
				OutputMode:   adapters.OutputModeNative,
				ReadyDelayMs: 800,
			},
		},
		{
			ID:               "deepseek",
			Name:             "DeepSeek TUI",
			Binary:           "deepseek",
			FallbackBinaries: []string{"codewhale"},
			EnvOverride:      "DEEPSEEK_BIN",
			VersionArgs:      []string{"--version"},
			Provider:         "deepseek",
			FallbackModels:   models("deepseek-v4-pro", "deepseek-v4-flash"),
			TerminalSpec: TerminalSpecHint{
				PromptMode:   adapters.PromptModeKeystrokes,
				ModelFlag:    "--model",
				OutputMode:   adapters.OutputModeNative,
				ReadyDelayMs: 800,
			},
		},
		{
			ID:          "kimi",
			Name:        "Kimi CLI",
			Binary:      "kimi",
			EnvOverride: "KIMI_BIN",
			VersionArgs: []string{"--version"},
			Provider:    "moonshotai",
			FallbackModels: models(
				"kimi-k2-turbo-preview",
				"moonshot-v1-8k",
				"moonshot-v1-32k",
			),
			TerminalSpec: TerminalSpecHint{
				PromptMode:   adapters.PromptModeKeystrokes,
				ModelFlag:    "--model",
				OutputMode:   adapters.OutputModeNative,
				ReadyDelayMs: 800,
			},
		},
		{
			ID:          "hermes",
			Name:        "Hermes",
			Binary:      "hermes",
			EnvOverride: "HERMES_BIN",
			VersionArgs: []string{"--version"},
			FetchModels: acpFetchModels([]string{"acp", "--accept-hooks"}),
			FallbackModels: labels(
				model("grok-4.3", "grok-4.3 (xAI default)"),
				model("openai-codex:gpt-5.5", "gpt-5.5 (openai-codex)"),
				model("openai-codex:gpt-5.4", "gpt-5.4 (openai-codex)"),
			),
			TerminalSpec: TerminalSpecHint{
				PromptMode:   adapters.PromptModeKeystrokes,
				OutputMode:   adapters.OutputModeNative,
				ReadyDelayMs: 800,
			},
		},
		{
			ID:          "pi",
			Name:        "Pi",
			Binary:      "pi",
			EnvOverride: "PI_BIN",
			VersionArgs: []string{"--version"},
			FetchModels: fetchPiModels,
			FallbackModels: models(
				"anthropic/claude-sonnet-4-5",
				"anthropic/claude-opus-4-5",
				"openai/gpt-5",
				"openai/o4-mini",
				"google/gemini-2.5-pro",
				"google/gemini-2.5-flash",
			),
			TerminalSpec: TerminalSpecHint{
				PromptMode: adapters.PromptModeFlag,
				PromptFlag: "-p",
				ModelFlag:  "--model",
				OutputMode: adapters.OutputModeNative,
			},
		},
		{
			ID:          "aider",
			Name:        "Aider",
			Binary:      "aider",
			EnvOverride: "AIDER_BIN",
			VersionArgs: []string{"--version"},
			FallbackModels: models(
				"sonnet",
				"gpt-4o",
				"deepseek/deepseek-chat",
				"gemini/gemini-2.0-flash",
			),
			TerminalSpec: TerminalSpecHint{
				PromptMode:  adapters.PromptModeFlag,
				PromptFlag:  "--message",
				ModelFlag:   "--model",
				OutputMode:  adapters.OutputModeNative,
				JSONRunArgs: []string{"--no-auto-commits"},
			},
		},
		{
			ID:          "devin",
			Name:        "Devin for Terminal",
			Binary:      "devin",
			EnvOverride: "DEVIN_BIN",
			VersionArgs: []string{"--version"},
			FetchModels: acpFetchModels([]string{"--permission-mode", "dangerous", "--respect-workspace-trust", "false", "acp"}),
			FallbackModels: models(
				"adaptive",
				"swe",
				"opus",
				"sonnet",
				"codex",
				"gpt",
				"gemini",
			),
			TerminalSpec: TerminalSpecHint{
				PromptMode:   adapters.PromptModeKeystrokes,
				OutputMode:   adapters.OutputModeNative,
				ReadyDelayMs: 800,
			},
		},
		{
			ID:             "grok-build",
			Name:           "Grok Build",
			Binary:         "grok",
			EnvOverride:    "GROK_BIN",
			VersionArgs:    []string{"--version"},
			ListModelsArgs: []string{"models"},
			Provider:       "xai",
			FallbackModels: models(
				"grok-build",
				"grok-4.3",
				"grok-4.20-reasoning",
				"grok-4.20-non-reasoning",
				"grok-4.20-multi-agent",
			),
			TerminalSpec: TerminalSpecHint{
				PromptMode:   adapters.PromptModeKeystrokes,
				ModelFlag:    "--model",
				OutputMode:   adapters.OutputModeNative,
				ReadyDelayMs: 800,
			},
		},
		{
			ID:          "amp",
			Name:        "Amp",
			Binary:      "amp",
			EnvOverride: "AMP_BIN",
			VersionArgs: []string{"--version"},
			FallbackModels: labels(
				model("smart", "Smart (mode)"),
				model("deep", "Deep (mode)"),
				model("rush", "Rush (mode)"),
			),
			TerminalSpec: TerminalSpecHint{
				PromptMode:   adapters.PromptModeKeystrokes,
				OutputMode:   adapters.OutputModeNative,
				ReadyDelayMs: 800,
			},
		},
		{
			ID:          "kiro",
			Name:        "Kiro CLI",
			Binary:      "kiro-cli",
			EnvOverride: "KIRO_BIN",
			VersionArgs: []string{"--version"},
			FetchModels: acpFetchModels([]string{"acp"}),
			FallbackModels: labels(
				model("default", "Default (CLI config)"),
			),
			TerminalSpec: TerminalSpecHint{
				PromptMode:   adapters.PromptModeKeystrokes,
				OutputMode:   adapters.OutputModeNative,
				ReadyDelayMs: 800,
			},
		},
		{
			ID:          "kilo",
			Name:        "Kilo",
			Binary:      "kilo",
			EnvOverride: "KILO_BIN",
			VersionArgs: []string{"--version"},
			FetchModels: acpFetchModels([]string{"acp"}),
			FallbackModels: labels(
				model("default", "Default (CLI config)"),
			),
			TerminalSpec: TerminalSpecHint{
				PromptMode:   adapters.PromptModeKeystrokes,
				OutputMode:   adapters.OutputModeNative,
				ReadyDelayMs: 800,
			},
		},
		{
			ID:          "vibe",
			Name:        "Mistral Vibe CLI",
			Binary:      "vibe-acp",
			EnvOverride: "VIBE_BIN",
			VersionArgs: []string{"--version"},
			FetchModels: acpFetchModels([]string{}),
			FallbackModels: labels(
				model("default", "Default (CLI config)"),
			),
			TerminalSpec: TerminalSpecHint{
				PromptMode:   adapters.PromptModeKeystrokes,
				OutputMode:   adapters.OutputModeNative,
				ReadyDelayMs: 800,
			},
		},
		{
			ID:          "trae-cli",
			Name:        "Trae CLI",
			Binary:      "traecli",
			EnvOverride: "TRAE_CLI_BIN",
			VersionArgs: []string{"--version"},
			FetchModels: acpFetchModels([]string{"acp", "serve"}),
			FallbackModels: labels(
				model("default", "Default (CLI config)"),
			),
			TerminalSpec: TerminalSpecHint{
				PromptMode:   adapters.PromptModeKeystrokes,
				OutputMode:   adapters.OutputModeNative,
				ReadyDelayMs: 800,
			},
		},
		{
			ID:               "codebuddy",
			Name:             "Codebuddy Code",
			Binary:           "codebuddy",
			FallbackBinaries: []string{"cbc"},
			EnvOverride:      "CODEBUDDY_BIN",
			VersionArgs:      []string{"--version"},
			FallbackModels: models(
				"glm-5.1-ioa",
				"claude-sonnet-4.6-1m",
				"gpt-5.5",
				"gemini-3.5-flash",
				"deepseek-v4-pro-ioa",
				"kimi-k2.6-ioa",
				"minimax-m3-ioa",
			),
			TerminalSpec: TerminalSpecHint{
				PromptMode:   adapters.PromptModeKeystrokes,
				OutputMode:   adapters.OutputModeNative,
				ReadyDelayMs: 800,
			},
		},
		{
			ID:               "reasonix",
			Name:             "DeepSeek Reasonix",
			Binary:           "reasonix",
			FallbackBinaries: []string{"dsnix"},
			EnvOverride:      "REASONIX_BIN",
			VersionArgs:      []string{"--version"},
			Provider:         "deepseek",
			FetchModels:      acpFetchModels([]string{"acp"}),
			FallbackModels:   models("deepseek-v4-pro", "deepseek-v4-flash"),
			TerminalSpec: TerminalSpecHint{
				PromptMode:   adapters.PromptModeKeystrokes,
				OutputMode:   adapters.OutputModeNative,
				ReadyDelayMs: 800,
			},
		},
		{
			ID:          "antigravity",
			Name:        "Antigravity",
			Binary:      "agy",
			EnvOverride: "ANTIGRAVITY_BIN",
			VersionArgs: []string{"--version"},
			FallbackModels: labels(
				model("Gemini 3.1 Pro (High)", "Gemini 3.1 Pro (High)"),
				model("Gemini 3.1 Pro (Low)", "Gemini 3.1 Pro (Low)"),
				model("Claude Sonnet 4.6 (Thinking)", "Claude Sonnet 4.6 (Thinking)"),
				model("GPT-OSS 120B (Medium)", "GPT-OSS 120B (Medium)"),
			),
			TerminalSpec: TerminalSpecHint{
				PromptMode:   adapters.PromptModeKeystrokes,
				OutputMode:   adapters.OutputModeNative,
				ReadyDelayMs: 800,
			},
		},
	}
}

func DetectAll(ctx context.Context, toolDirs []string) []discovery.Tool {
	defs := Catalog()
	tools := make([]discovery.Tool, 0, len(defs))
	for _, def := range defs {
		tools = append(tools, Detect(ctx, def, toolDirs))
	}
	return tools
}

func ListModels(ctx context.Context, allowedRoots []string, toolDirs []string) []adapters.ModelRef {
	return listModels(ctx, Catalog(), allowedRoots, toolDirs)
}

func listModels(ctx context.Context, defs []AgentDef, allowedRoots []string, toolDirs []string) []adapters.ModelRef {
	models := make([]adapters.ModelRef, 0)
	for _, def := range defs {
		tool := detect(ctx, def, toolDirs)
		if !tool.Found {
			continue
		}
		source := "fallback"
		options := def.FallbackModels
		if len(options) == 0 {
			options = []ModelOption{model("default", "Default (CLI config)")}
		}
		if len(def.ListModelsArgs) > 0 {
			if liveOptions := listLiveModels(ctx, def, tool.Path, allowedRoots); len(liveOptions) > 0 {
				options = liveOptions
				source = "live"
			}
		}
		if def.FetchModels != nil {
			if fetched, err := def.FetchModels(ctx, def, tool.Path, allowedRoots); err == nil && len(fetched) > 0 {
				options = fetched
				source = "live"
			}
		}
		for _, option := range options {
			models = append(models, modelRef(def, option, source))
		}
	}
	return models
}

func Detect(ctx context.Context, def AgentDef, toolDirs []string) discovery.Tool {
	tool := detect(ctx, def, toolDirs)
	metadata := tool.Metadata
	if metadata == nil {
		metadata = map[string]any{}
	}
	metadata["agentId"] = def.ID
	metadata["displayName"] = def.Name
	if def.EnvOverride != "" {
		metadata["envOverride"] = def.EnvOverride
	}
	tool.Metadata = metadata
	if def.ID != "opencode" && def.ID != "codex" {
		tool.Tool = "custom"
	}
	return tool
}

func detect(ctx context.Context, def AgentDef, toolDirs []string) discovery.Tool {
	versionArgs := def.VersionArgs
	if len(versionArgs) == 0 {
		versionArgs = []string{"--version"}
	}
	tool := discovery.DetectCommandWithLookup(discovery.CommandLookup{
		Name:             def.ID,
		Binary:           def.Binary,
		FallbackBinaries: def.FallbackBinaries,
		EnvOverride:      def.EnvOverride,
		ExtraDirs:        toolDirs,
	})
	if !tool.Found {
		return tool
	}
	if def.ID == "codex" {
		if nativePath := discovery.TryResolveCodexNativeBinary(tool.Path); nativePath != "" {
			tool.Path = nativePath
			if tool.Metadata == nil {
				tool.Metadata = map[string]any{}
			}
			tool.Metadata["codex_native"] = true
		}
	}
	version, err := discovery.ProbeVersion(ctx, tool.Path, versionArgs...)
	if err != nil {
		tool.Status = "detected"
		tool.Error = err.Error()
		return tool
	}
	tool.Version = version
	tool.Status = "verified"
	return tool
}

func listLiveModels(ctx context.Context, def AgentDef, path string, allowedRoots []string) []ModelOption {
	workingDir, roots, cleanup := neutralProbeWorkspace(def.ID, allowedRoots)
	defer cleanup()
	env := map[string]string{}
	if def.ID == "opencode" {
		env["OPENCODE_DISABLE_PROJECT_CONFIG"] = "true"
	}

	result, err := host.Run(ctx, host.CommandSpec{
		Name:         path,
		Args:         def.ListModelsArgs,
		WorkingDir:   workingDir,
		AllowedRoots: roots,
		Env:          env,
		Timeout:      10 * time.Second,
	})
	if err != nil && result.Stdout == "" {
		return nil
	}
	if def.ListModelsParser != nil {
		return def.ListModelsParser(result.Stdout)
	}
	return ParseModelLines(result.Stdout)
}

func acpFetchModels(args []string) func(ctx context.Context, def AgentDef, path string, allowedRoots []string) ([]ModelOption, error) {
	return func(ctx context.Context, def AgentDef, path string, allowedRoots []string) ([]ModelOption, error) {
		workingDir, _, cleanup := acp.NeutralWorkspace(def.ID, allowedRoots)
		defer cleanup()
		acpOpts := acp.DetectOptions{
			Bin:  path,
			Args: args,
			Cwd:  workingDir,
		}
		acpModels, err := acp.DetectModels(ctx, acpOpts)
		if err != nil {
			return nil, err
		}
		options := make([]ModelOption, 0, len(acpModels))
		for _, m := range acpModels {
			options = append(options, ModelOption{ID: m.ID, DisplayName: m.DisplayName})
		}
		return options, nil
	}
}

func ParseModelLines(output string) []ModelOption {
	lines := strings.Split(output, "\n")
	models := []ModelOption{model("default", "Default (CLI config)")}
	seen := map[string]bool{"default": true}
	for _, line := range lines {
		id := strings.TrimSpace(strings.TrimPrefix(line, "-"))
		if id == "" {
			continue
		}
		lowerID := strings.ToLower(id)
		if (strings.Contains(lowerID, "model") || strings.Contains(lowerID, "no models")) && len(strings.Fields(id)) <= 2 {
			continue
		}
		if seen[id] {
			continue
		}
		seen[id] = true
		models = append(models, ModelOption{ID: id, DisplayName: id})
	}
	if len(models) <= 1 {
		return nil
	}
	return models
}

func ParseCodexDebugModels(output string) []ModelOption {
	var payload struct {
		Models []struct {
			Slug        string `json:"slug"`
			ID          string `json:"id"`
			DisplayName string `json:"display_name"`
			Name        string `json:"name"`
			Visibility  string `json:"visibility"`
		} `json:"models"`
	}
	if err := json.Unmarshal([]byte(output), &payload); err != nil {
		return nil
	}
	options := []ModelOption{model("default", "Default (CLI config)")}
	seen := map[string]bool{"default": true}
	for _, entry := range payload.Models {
		if entry.Visibility == "hidden" {
			continue
		}
		id := strings.TrimSpace(entry.Slug)
		if id == "" {
			id = strings.TrimSpace(entry.ID)
		}
		if id == "" || seen[id] {
			continue
		}
		label := strings.TrimSpace(entry.DisplayName)
		if label == "" {
			label = strings.TrimSpace(entry.Name)
		}
		if label == "" {
			label = id
		}
		seen[id] = true
		options = append(options, ModelOption{ID: id, DisplayName: label})
	}
	if len(options) <= 1 {
		return nil
	}
	return options
}

func ParsePiModels(output string) []ModelOption {
	lines := strings.Split(output, "\n")
	filtered := make([]string, 0, len(lines))
	for _, line := range lines {
		line = strings.TrimSpace(line)
		if line == "" || strings.HasPrefix(line, "#") {
			continue
		}
		filtered = append(filtered, line)
	}
	if len(filtered) == 0 {
		return nil
	}
	options := []ModelOption{model("default", "Default (CLI config)")}
	seen := map[string]bool{"default": true}
	for _, line := range filtered[1:] {
		parts := strings.Fields(line)
		if len(parts) < 2 {
			continue
		}
		provider := parts[0]
		modelID := parts[1]
		fullID := provider + "/" + modelID
		if seen[fullID] {
			continue
		}
		seen[fullID] = true
		options = append(options, ModelOption{ID: fullID, DisplayName: fullID})
	}
	if len(options) <= 1 {
		return nil
	}
	return options
}

func fetchPiModels(ctx context.Context, def AgentDef, path string, allowedRoots []string) ([]ModelOption, error) {
	workingDir, roots, cleanup := neutralProbeWorkspace(def.ID, allowedRoots)
	defer cleanup()
	result, err := host.Run(ctx, host.CommandSpec{
		Name:         path,
		Args:         []string{"--list-models"},
		WorkingDir:   workingDir,
		AllowedRoots: roots,
		Timeout:      20 * time.Second,
	})
	if err != nil && result.Stderr == "" {
		return nil, err
	}
	parsed := ParsePiModels(result.Stderr)
	if len(parsed) == 0 {
		return nil, fmt.Errorf("pi --list-models returned no models")
	}
	return parsed, nil
}

func modelRef(def AgentDef, option ModelOption, source string) adapters.ModelRef {
	provider := option.Provider
	if provider == "" {
		provider = inferProvider(def, option.ID)
	}
	availability := "detected"
	if source == "live" {
		availability = "listed"
	}
	return adapters.ModelRef{
		ID:           def.ID + "/" + option.ID,
		Adapter:      def.ID,
		Provider:     provider,
		Model:        option.ID,
		DisplayName:  displayName(option),
		AuthMode:     "cli_session",
		Availability: availability,
		Source:       source,
		Capabilities: adapters.ModelCapability{
			Streaming:    true,
			Tools:        true,
			FileEdits:    true,
			Shell:        true,
			JSONOutput:   def.ID == "opencode" || def.ID == "codex" || def.ID == "gemini",
			ModelListing: len(def.ListModelsArgs) > 0,
		},
	}
}

func inferProvider(def AgentDef, modelID string) string {
	if def.Provider != "" {
		return def.Provider
	}
	if parts := strings.SplitN(modelID, "/", 2); len(parts) == 2 && parts[0] != "" {
		return parts[0]
	}
	if strings.HasPrefix(modelID, "claude") || modelID == "sonnet" || modelID == "opus" || modelID == "haiku" {
		return "anthropic"
	}
	if strings.HasPrefix(modelID, "gpt") || strings.HasPrefix(modelID, "o3") || strings.HasPrefix(modelID, "o4") {
		return "openai"
	}
	if strings.HasPrefix(modelID, "gemini") {
		return "google"
	}
	if strings.HasPrefix(modelID, "deepseek") {
		return "deepseek"
	}
	if strings.HasPrefix(modelID, "kimi") || strings.HasPrefix(modelID, "moonshot") {
		return "moonshotai"
	}
	if strings.HasPrefix(modelID, "grok") {
		return "xai"
	}
	return def.ID
}

func neutralProbeWorkspace(agentID string, roots []string) (string, []string, func()) {
	dir, err := os.MkdirTemp("", "fusion-"+agentID+"-probe-*")
	if err == nil {
		return dir, appendIfMissing(roots, dir), func() { _ = os.RemoveAll(dir) }
	}

	for _, root := range roots {
		if info, statErr := os.Stat(root); statErr == nil && info.IsDir() {
			return root, roots, func() {}
		}
	}

	cwd, cwdErr := os.Getwd()
	if cwdErr == nil {
		return cwd, appendIfMissing(roots, cwd), func() {}
	}
	return ".", appendIfMissing(roots, "."), func() {}
}

func appendIfMissing(items []string, item string) []string {
	for _, existing := range items {
		if existing == item {
			return items
		}
	}
	return append(append([]string{}, items...), item)
}

func displayName(option ModelOption) string {
	if option.DisplayName != "" {
		return option.DisplayName
	}
	return option.ID
}

func models(ids ...string) []ModelOption {
	options := []ModelOption{model("default", "Default (CLI config)")}
	for _, id := range ids {
		options = append(options, ModelOption{ID: id, DisplayName: id})
	}
	return options
}

func labels(options ...ModelOption) []ModelOption {
	return ensureDefaultOption(options)
}

func model(id string, label string) ModelOption {
	return ModelOption{ID: id, DisplayName: label}
}

func ensureDefaultOption(options []ModelOption) []ModelOption {
	for _, option := range options {
		if option.ID == "default" {
			return options
		}
	}
	return append([]ModelOption{model("default", "Default (CLI config)")}, options...)
}
