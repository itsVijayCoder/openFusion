export const cancelRunTool = {
  name: "fusion.cancel_run",
  description: "Cancel a queued or running Fusion Harness run.",
  inputSchema: {
    type: "object",
    properties: {
      run_id: { type: "string" },
    },
    required: ["run_id"],
  },
} as const;
