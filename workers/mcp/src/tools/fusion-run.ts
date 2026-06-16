export const runTool = {
  name: "fusion.run",
  description: "Create a Fusion Harness run for a prompt, workspace, preset, mode, and permission profile.",
  inputSchema: {
    type: "object",
    properties: {
      prompt: { type: "string" },
      workspace_id: { type: "string" },
      preset: { type: "string" },
      mode: { type: "string", enum: ["direct", "auto", "required"] },
      permission_profile: { type: "string", enum: ["readonly", "workspace_write", "trusted_internal"] },
      stream: { type: "boolean" },
    },
    required: ["prompt"],
  },
} as const;
