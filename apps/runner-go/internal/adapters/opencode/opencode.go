package opencode

import "github.com/asthrix/fusion-harness/apps/runner-go/internal/discovery"

func Detect() discovery.Tool {
	tool := discovery.DetectCommand("opencode")
	tool.Tool = "opencode"
	return tool
}
