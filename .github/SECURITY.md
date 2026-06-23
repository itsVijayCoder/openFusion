# Security Policy

## Reporting a Vulnerability

If you discover a security vulnerability in Fusion Harness, please report it responsibly.

**Do not open a public GitHub issue for security vulnerabilities.**

Instead, email **security@asthrix.com** with:

1. A description of the vulnerability
2. Steps to reproduce
3. The potential impact
4. Any suggested fixes (optional)

You should receive a response within 48 hours. If the vulnerability is confirmed, we will work on a fix and coordinate disclosure with you.

## Scope

The following are in scope:

- The Cloudflare Worker API (`workers/api`)
- The web app (`apps/web`)
- The Go runner (`apps/runner-go`)
- The shared packages (`packages/*`)

The following are out of scope:

- Vulnerabilities in third-party dependencies (report to the upstream project)
- Self-hosted instances with non-default configurations that weaken security
- Social engineering attacks

## Security Defaults

Fusion Harness ships with conservative security defaults:

- Default permission profile is `readonly`
- Docker execution denies privileged mode, Docker socket mounts, and secret mounts
- Runner tokens are scoped per user
- Sessions use HttpOnly cookies
- Workspace paths are validated before command execution
- Artifacts are redacted before upload