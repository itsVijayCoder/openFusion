export type AdapterId = "opencode" | "codex" | "api-key" | "cloudflare-ai-gateway";

export type AuthMode = "cli_session" | "api_key" | "cloud_gateway" | "unknown";

export type ModelAvailability = "detected" | "listed" | "verified" | "configured_unverified" | "unavailable";

export type PermissionProfile = "readonly" | "workspace_write" | "trusted_internal";

export type FusionMode = "direct" | "auto" | "required";

export type RunStatus = "queued" | "running" | "waiting_approval" | "completed" | "failed" | "cancelled";

export type ModelRef = {
  id: string;
  adapter: AdapterId;
  provider?: string;
  model: string;
  displayName?: string;
  authMode: AuthMode;
  availability: ModelAvailability;
  capabilities: {
    streaming: boolean;
    tools: boolean;
    fileEdits: boolean;
    shell: boolean;
    jsonOutput: boolean;
    modelListing: boolean;
  };
};

export type FusionRunRequest = {
  workspaceId?: string;
  mode: FusionMode;
  preset?: string;
  messages: Array<{ role: "system" | "user" | "assistant"; content: string }>;
  permissionProfile: PermissionProfile;
  providerPolicy?: "same_provider_first" | "mixed_quality" | "manual";
  analysisModels?: string[];
  judgeModel?: string;
  finalModel?: string;
  stream?: boolean;
  timeoutMs?: number;
};
