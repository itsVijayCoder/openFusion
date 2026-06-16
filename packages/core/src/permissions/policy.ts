import type { PermissionProfile } from "@fusion-harness/shared";

export type PermissionDecision = "allow" | "ask" | "deny";

export type PermissionPolicy = {
  profile: PermissionProfile;
  filesystemWrite: PermissionDecision;
  shell: PermissionDecision;
  network: PermissionDecision;
};

export function resolvePermissionPolicy(profile: PermissionProfile): PermissionPolicy {
  switch (profile) {
    case "trusted_internal":
      return { profile, filesystemWrite: "allow", shell: "ask", network: "ask" };
    case "workspace_write":
      return { profile, filesystemWrite: "allow", shell: "ask", network: "ask" };
    case "readonly":
      return { profile, filesystemWrite: "deny", shell: "deny", network: "deny" };
  }
}
