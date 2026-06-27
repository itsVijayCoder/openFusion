export const RUN_EVENT_TYPES = [
  "run.created",
  "run.started",
  "run.planning.started",
  "run.planning.completed",
  "panel.job.queued",
  "panel.job.started",
  "panel.thinking.delta",
  "panel.terminal.delta",
  "panel.output.delta",
  "panel.tool_call",
  "panel.tool_result",
  "panel.usage",
  "panel.job.completed",
  "panel.job.failed",
  "judge.started",
  "judge.output.delta",
  "judge.completed",
  "judge.failed",
  "judge.fallback",
  "final.started",
  "final.thinking.delta",
  "final.delta",
  "final.tool_call",
  "final.tool_result",
  "final.completed",
  "approval.requested",
  "approval.granted",
  "approval.denied",
  "command.started",
  "command.output",
  "command.completed",
  "file.changed",
  "artifact.uploaded",
  "run.paused",
  "run.resumed",
  "run.completed",
  "run.failed",
  "run.cancelled",
  "run.deleted",
] as const;

export type RunEventType = (typeof RUN_EVENT_TYPES)[number];

export type RunnerEvent = {
  type: RunEventType;
  runId: string;
  seq?: number;
  jobId?: string;
  runnerId?: string;
  timestamp: string;
  data: Record<string, unknown>;
};

export type RunEvent = RunnerEvent & {
  seq: number;
};

/**
 * panel.terminal.delta payload contract.
 *
 * In T3 (headless capture) mode, data carries:
 *   { stream: "stdout" | "stderr", text: string }
 *
 * In T1/T2 (real PTY terminal session) mode, data carries:
 *   { sessionId: string, bytes: string (base64), text?: string }
 *
 * The sessionId links a terminal delta to a live PTY session that can be
 * attached to via the session WebSocket endpoints. The bytes field contains
 * base64-encoded raw PTY output (ANSI, cursor control, colors) for xterm.js
 * rendering. The text field is optional and provides a plain-text fallback.
 */
export type PanelTerminalDeltaData = {
  stream?: string;
  text?: string;
  sessionId?: string;
  bytes?: string;
};
