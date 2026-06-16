export type EntityPrefix =
  | "org"
  | "usr"
  | "ws"
  | "runner"
  | "model"
  | "tool"
  | "run"
  | "job"
  | "panel"
  | "artifact"
  | "approval"
  | "audit";

export function formatEntityId(prefix: EntityPrefix, id: string) {
  return `${prefix}_${id}`;
}
