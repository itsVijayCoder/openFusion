package permissions

type Profile string

const (
	Readonly        Profile = "readonly"
	WorkspaceWrite  Profile = "workspace_write"
	TrustedInternal Profile = "trusted_internal"
)

type Decision string

const (
	Allow Decision = "allow"
	Ask   Decision = "ask"
	Deny  Decision = "deny"
)

func ShellDecision(profile Profile) Decision {
	switch profile {
	case TrustedInternal, WorkspaceWrite:
		return Ask
	default:
		return Deny
	}
}
