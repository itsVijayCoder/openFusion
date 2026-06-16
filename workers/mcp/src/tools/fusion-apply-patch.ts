export const applyPatchTool = {
  name: "fusion.apply_patch",
  description: "Request application of a reviewed patch through the runner approval flow.",
  inputSchema: {
    type: "object",
    properties: {
      run_id: { type: "string" },
      action: { type: "string", enum: ["grant", "deny"] },
      reason: { type: "string" },
    },
    required: ["run_id", "action"],
  },
} as const;
