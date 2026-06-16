export type AuditEventInput = {
  orgId: string;
  eventType: string;
  severity?: "info" | "warning" | "error";
  metadata?: Record<string, unknown>;
};

export function normalizeAuditEvent(input: AuditEventInput) {
  return {
    ...input,
    severity: input.severity ?? "info",
    createdAt: new Date().toISOString(),
  };
}
