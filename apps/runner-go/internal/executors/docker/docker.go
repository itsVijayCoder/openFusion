package docker

import "github.com/asthrix/fusion-harness/apps/runner-go/internal/discovery"

func Detect() discovery.Tool {
	tool := discovery.DetectCommand("docker")
	tool.Tool = "docker"
	return tool
}
