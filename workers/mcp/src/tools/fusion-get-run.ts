export const getRunTool = {
  name: "fusion.get_run",
  description: "Get status and trace metadata for a Fusion Harness run.",
  inputSchema: {
    type: "object",
    properties: {
      run_id: { type: "string" },
    },
    required: ["run_id"],
  },
} as const;
