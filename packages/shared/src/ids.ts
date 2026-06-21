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
  | "event"
  | "audit"
  | "sess"
  | "tok"
  | "oauth"
  | "oauth_state"
  | "gh_install"
  | "gh_repo"
  | "gh_link"
  | "gh_pr"
  | "gh_subject"
  | "gh_webhook"
  | "prrev_run"
  | "prrev_comment";

export function formatEntityId(prefix: EntityPrefix, id: string) {
  return `${prefix}_${id}`;
}
