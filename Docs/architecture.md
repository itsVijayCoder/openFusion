# Architecture

Fusion Harness uses Cloudflare as the control plane and a native Go binary as the local execution plane.

Cloudflare coordinates users, projects, runs, runners, presets, artifacts, audit logs, OpenAI-compatible APIs, and remote MCP.

The Go runner detects host tools, runs OpenCode and Codex, applies permission policy, executes commands through host or Docker executors, generates patches, and uploads sanitized artifacts.
