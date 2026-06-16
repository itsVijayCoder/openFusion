export type EntityPrefix = "org" | "usr" | "ws" | "runner" | "model" | "run" | "job" | "artifact" | "audit";

export function formatEntityId(prefix: EntityPrefix, id: string) {
  return `${prefix}_${id}`;
}
