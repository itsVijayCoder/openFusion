# Security

Default execution starts at `readonly`.

Workspace writes, shell commands, network access, Docker mounts, and artifact uploads must flow through explicit policy checks and audit events.

The runner must never read provider credential files, browser cookies, keychains, SSH keys, or raw token stores directly. It may use official CLI commands that report auth or model availability.
