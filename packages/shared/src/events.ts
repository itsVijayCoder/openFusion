export const RUN_EVENT_TYPES = [
  "run.created",
  "run.started",
  "run.planning.started",
  "run.planning.completed",
  "panel.job.queued",
  "panel.job.started",
  "panel.output.delta",
  "panel.job.completed",
  "panel.job.failed",
  "judge.started",
  "judge.completed",
  "final.started",
  "final.delta",
  "final.completed",
  "approval.requested",
  "approval.granted",
  "approval.denied",
  "command.started",
  "command.output",
  "command.completed",
  "file.changed",
  "artifact.uploaded",
  "run.completed",
  "run.failed",
  "run.cancelled",
] as const;

export type RunEventType = (typeof RUN_EVENT_TYPES)[number];

export type RunnerEvent = {
  type: RunEventType;
  runId: string;
  jobId?: string;
  runnerId?: string;
  timestamp: string;
  data: Record<string, unknown>;
};
