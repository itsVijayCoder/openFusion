package config

type Config struct {
	CloudURL       string   `json:"cloud_url"`
	AllowedRoots   []string `json:"allowed_roots"`
	DefaultProfile string   `json:"default_profile"`
}
