package config

import (
	"encoding/json"
	"errors"
	"os"
	"path/filepath"
)

const (
	DefaultCloudURL = "https://fusion-api.asthrix.workers.dev"
	DefaultProfile = "readonly"
)

type Config struct {
	RunnerID       string   `json:"runner_id"`
	CloudURL       string   `json:"cloud_url"`
	Token          string   `json:"token,omitempty"`
	AllowedRoots   []string `json:"allowed_roots"`
	ToolDirs       []string `json:"tool_dirs,omitempty"`
	DefaultProfile string   `json:"default_profile"`
}

func Default() Config {
	home, _ := os.UserHomeDir()
	allowedRoots := []string{}
	if home != "" {
		allowedRoots = append(allowedRoots, filepath.Join(home, "Projects"))
	}

	return Config{
		RunnerID:       "runner_local",
		CloudURL:       envOr("FUSION_CLOUD_URL", DefaultCloudURL),
		Token:          os.Getenv("FUSION_RUNNER_TOKEN"),
		AllowedRoots:   allowedRoots,
		DefaultProfile: DefaultProfile,
	}
}

func Path() (string, error) {
	home, err := os.UserHomeDir()
	if err != nil {
		return "", err
	}

	return filepath.Join(home, ".fusion-harness", "config.json"), nil
}

func Load() (Config, error) {
	cfg := Default()
	path, err := Path()
	if err != nil {
		return cfg, err
	}

	data, err := os.ReadFile(path)
	if errors.Is(err, os.ErrNotExist) {
		return cfg, nil
	}
	if err != nil {
		return cfg, err
	}
	if err := json.Unmarshal(data, &cfg); err != nil {
		return cfg, err
	}

	if envCloudURL := os.Getenv("FUSION_CLOUD_URL"); envCloudURL != "" {
		cfg.CloudURL = envCloudURL
	}
	if envToken := os.Getenv("FUSION_RUNNER_TOKEN"); envToken != "" {
		cfg.Token = envToken
	}
	if envToolDirs := os.Getenv("FUSION_AGENT_TOOL_DIRS"); envToolDirs != "" {
		cfg.ToolDirs = append(cfg.ToolDirs, filepath.SplitList(envToolDirs)...)
	}

	return cfg, nil
}

func Save(cfg Config) error {
	path, err := Path()
	if err != nil {
		return err
	}
	if err := os.MkdirAll(filepath.Dir(path), 0o700); err != nil {
		return err
	}

	data, err := json.MarshalIndent(cfg, "", "  ")
	if err != nil {
		return err
	}

	return os.WriteFile(path, append(data, '\n'), 0o600)
}

func envOr(key string, fallback string) string {
	if value := os.Getenv(key); value != "" {
		return value
	}
	return fallback
}
