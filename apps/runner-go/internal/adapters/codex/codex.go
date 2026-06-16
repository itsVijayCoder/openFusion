package codex

import "github.com/asthrix/fusion-harness/apps/runner-go/internal/discovery"

func Detect() discovery.Tool {
	tool := discovery.DetectCommand("codex")
	tool.Tool = "codex"
	return tool
}
