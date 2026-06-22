export class FusionHarnessError extends Error {
  constructor(
    message: string,
    readonly code: string,
    readonly status = 500,
  ) {
    super(message);
    this.name = "FusionHarnessError";
  }
}

type ErrorMapping = {
  message: string;
  hint?: string;
};

const ERROR_MAP: Array<{ pattern: string; mapping: ErrorMapping }> = [
  {
    pattern: "model selection is empty",
    mapping: {
      message: "No model was selected for this step.",
      hint: "Choose a model in the composer and try again.",
    },
  },
  {
    pattern: "model timed out",
    mapping: {
      message: "The model took too long to respond.",
      hint: "Try again, or choose a faster model.",
    },
  },
  {
    pattern: "runner unavailable",
    mapping: {
      message: "The local runner went offline.",
      hint: "Restart fusion-runner serve and retry.",
    },
  },
  {
    pattern: "all panel models failed",
    mapping: {
      message: "All models failed to respond.",
      hint: "Check that your local agents (OpenCode, Codex) are running and authenticated.",
    },
  },
  {
    pattern: "auth expired",
    mapping: {
      message: "Your session expired.",
      hint: "Refresh the page to log in again.",
    },
  },
  {
    pattern: "adapter not implemented",
    mapping: {
      message: "This model adapter is not yet supported.",
      hint: "Use OpenCode or Codex adapters, or add a custom model.",
    },
  },
  {
    pattern: "not implemented",
    mapping: {
      message: "This feature is not yet available.",
      hint: "Check back later or use a different model adapter.",
    },
  },
  {
    pattern: "execution plan is missing",
    mapping: {
      message: "The run plan could not be created.",
      hint: "Ensure a runner is online and models are registered.",
    },
  },
  {
    pattern: "no runnable",
    mapping: {
      message: "No runner is available for the selected models.",
      hint: "Start fusion-runner serve and refresh the model list.",
    },
  },
  {
    pattern: "parent run",
    mapping: {
      message: "The conversation run could not be found.",
      hint: "Start a new run instead of continuing this one.",
    },
  },
];

export type NormalizedError = {
  message: string;
  hint?: string;
  raw: string;
};

export function normalizeError(rawError: string): NormalizedError {
  const lower = rawError.toLowerCase();
  for (const entry of ERROR_MAP) {
    if (lower.includes(entry.pattern)) {
      return { ...entry.mapping, raw: rawError };
    }
  }
  return { message: "An unexpected error occurred.", raw: rawError };
}