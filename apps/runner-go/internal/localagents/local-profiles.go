package localagents

import (
	"encoding/json"
	"os"
	"path/filepath"
	"regexp"
	"strings"
)

var localProfileIDPattern = regexp.MustCompile(`^[A-Za-z0-9][A-Za-z0-9._-]{0,79}$`)

type localProfile struct {
	ID            string            `json:"id"`
	BaseAgent     string            `json:"baseAgent"`
	Bin           string            `json:"bin"`
	Name          string            `json:"name"`
	Args          []string          `json:"args"`
	PrefixArgs    []string          `json:"prefixArgs"`
	Env           map[string]string `json:"env"`
	Models        []string          `json:"models"`
	FallbackModels []string         `json:"fallbackModels"`
	VersionArgs   []string          `json:"versionArgs"`
	DefaultModel  string            `json:"defaultModel"`
}

func localProfilesFile() string {
	if explicit := strings.TrimSpace(os.Getenv("FH_AGENT_PROFILES_CONFIG")); explicit != "" {
		if filepath.IsAbs(explicit) {
			return explicit
		}
		abs, err := filepath.Abs(explicit)
		if err == nil {
			return abs
		}
	}
	home, err := os.UserHomeDir()
	if err != nil {
		return ""
	}
	return filepath.Join(home, ".fusion-harness", "agents.local.json")
}

func readLocalAgentProfiles(baseDefs []AgentDef) []AgentDef {
	path := localProfilesFile()
	if path == "" {
		return nil
	}
	data, err := os.ReadFile(path)
	if err != nil {
		return nil
	}
	var profiles []localProfile
	if err := json.Unmarshal(data, &profiles); err != nil {
		var wrapper struct {
			Agents []localProfile `json:"agents"`
		}
		if err2 := json.Unmarshal(data, &wrapper); err2 != nil {
			return nil
		}
		profiles = wrapper.Agents
	}

	baseByID := make(map[string]AgentDef, len(baseDefs))
	for _, def := range baseDefs {
		baseByID[def.ID] = def
	}
	seen := make(map[string]bool, len(baseDefs))
	for _, def := range baseDefs {
		seen[def.ID] = true
	}

	var defs []AgentDef
	for _, profile := range profiles {
		def, ok := buildLocalAgentDef(profile, baseByID)
		if !ok {
			continue
		}
		if seen[def.ID] {
			continue
		}
		seen[def.ID] = true
		defs = append(defs, def)
	}
	return defs
}

func buildLocalAgentDef(profile localProfile, baseByID map[string]AgentDef) (AgentDef, bool) {
	id := strings.TrimSpace(profile.ID)
	if !localProfileIDPattern.MatchString(id) {
		return AgentDef{}, false
	}
	baseID := strings.TrimSpace(profile.BaseAgent)
	if baseID == "" {
		baseID = "claude"
	}
	base, ok := baseByID[baseID]
	if !ok {
		return AgentDef{}, false
	}
	def := base
	def.ID = id
	def.Name = strings.TrimSpace(profile.Name)
	if def.Name == "" {
		def.Name = id
	}
	if bin := strings.TrimSpace(profile.Bin); bin != "" {
		def.Binary = bin
		def.FallbackBinaries = nil
	}
	if len(profile.VersionArgs) > 0 {
		def.VersionArgs = profile.VersionArgs
	}
	models := profile.Models
	if len(models) == 0 {
		models = profile.FallbackModels
	}
	if len(models) > 0 {
		def.FallbackModels = modelsFromStrings(models)
	}
	def.EnvOverride = ""
	def.ListModelsArgs = nil
	def.ListModelsParser = nil
	def.FetchModels = nil
	return def, true
}

func modelsFromStrings(ids []string) []ModelOption {
	options := []ModelOption{model("default", "Default (CLI config)")}
	seen := map[string]bool{"default": true}
	for _, id := range ids {
		id = strings.TrimSpace(id)
		if id == "" || seen[id] {
			continue
		}
		seen[id] = true
		options = append(options, ModelOption{ID: id, DisplayName: id})
	}
	return options
}