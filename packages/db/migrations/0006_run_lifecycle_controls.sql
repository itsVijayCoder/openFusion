PRAGMA defer_foreign_keys = true;

DROP INDEX IF EXISTS idx_fusion_runs_org_created;
DROP INDEX IF EXISTS idx_fusion_runs_conversation;
DROP INDEX IF EXISTS idx_panel_outputs_run;
DROP INDEX IF EXISTS idx_runner_jobs_runner_status;
DROP INDEX IF EXISTS idx_runner_jobs_run;
DROP INDEX IF EXISTS idx_run_events_run_seq;

ALTER TABLE panel_outputs RENAME TO panel_outputs_old;
ALTER TABLE runner_jobs RENAME TO runner_jobs_old;
ALTER TABLE run_events RENAME TO run_events_old;
ALTER TABLE artifacts RENAME TO artifacts_old;
ALTER TABLE fusion_runs RENAME TO fusion_runs_old;

CREATE TABLE fusion_runs (
  id TEXT PRIMARY KEY,
  org_id TEXT NOT NULL,
  workspace_id TEXT,
  user_id TEXT NOT NULL,
  runner_id TEXT,
  status TEXT NOT NULL CHECK (status IN ('queued', 'running', 'paused', 'waiting_approval', 'completed', 'failed', 'cancelled')),
  mode TEXT NOT NULL CHECK (mode IN ('direct', 'auto', 'required')),
  preset TEXT,
  permission_profile TEXT NOT NULL,
  prompt_object_key TEXT,
  judge_object_key TEXT,
  final_object_key TEXT,
  execution_plan_json TEXT,
  parent_run_id TEXT,
  conversation_id TEXT,
  title TEXT,
  error TEXT,
  created_at TEXT NOT NULL,
  started_at TEXT,
  completed_at TEXT,
  FOREIGN KEY (org_id) REFERENCES orgs(id),
  FOREIGN KEY (workspace_id) REFERENCES workspaces(id),
  FOREIGN KEY (user_id) REFERENCES users(id),
  FOREIGN KEY (runner_id) REFERENCES runners(id)
);

INSERT INTO fusion_runs (
  id, org_id, workspace_id, user_id, runner_id, status, mode, preset,
  permission_profile, prompt_object_key, judge_object_key, final_object_key,
  execution_plan_json, parent_run_id, conversation_id, title, error,
  created_at, started_at, completed_at
)
SELECT
  id, org_id, workspace_id, user_id, runner_id, status, mode, preset,
  permission_profile, prompt_object_key, judge_object_key, final_object_key,
  execution_plan_json, parent_run_id, conversation_id, title, error,
  created_at, started_at, completed_at
FROM fusion_runs_old;

CREATE TABLE panel_outputs (
  id TEXT PRIMARY KEY,
  run_id TEXT NOT NULL,
  model_id TEXT NOT NULL,
  adapter TEXT NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('queued', 'running', 'completed', 'failed', 'timeout', 'cancelled')),
  output_object_key TEXT,
  error TEXT,
  latency_ms INTEGER,
  usage_json TEXT,
  created_at TEXT NOT NULL,
  completed_at TEXT,
  FOREIGN KEY (run_id) REFERENCES fusion_runs(id),
  FOREIGN KEY (model_id) REFERENCES models(id)
);

INSERT INTO panel_outputs (
  id, run_id, model_id, adapter, status, output_object_key, error,
  latency_ms, usage_json, created_at, completed_at
)
SELECT
  id, run_id, model_id, adapter, status, output_object_key, error,
  latency_ms, usage_json, created_at, completed_at
FROM panel_outputs_old;

CREATE TABLE runner_jobs (
  id TEXT PRIMARY KEY,
  org_id TEXT NOT NULL,
  run_id TEXT NOT NULL,
  runner_id TEXT NOT NULL,
  kind TEXT NOT NULL CHECK (kind IN ('direct', 'panel', 'judge', 'final', 'command', 'patch')),
  status TEXT NOT NULL CHECK (status IN ('queued', 'paused', 'leased', 'running', 'completed', 'failed', 'timeout', 'cancelled')),
  attempt INTEGER NOT NULL DEFAULT 0,
  lease_owner TEXT,
  lease_expires_at TEXT,
  input_object_key TEXT,
  output_object_key TEXT,
  error TEXT,
  created_at TEXT NOT NULL,
  started_at TEXT,
  completed_at TEXT,
  FOREIGN KEY (org_id) REFERENCES orgs(id),
  FOREIGN KEY (run_id) REFERENCES fusion_runs(id),
  FOREIGN KEY (runner_id) REFERENCES runners(id)
);

INSERT INTO runner_jobs (
  id, org_id, run_id, runner_id, kind, status, attempt, lease_owner,
  lease_expires_at, input_object_key, output_object_key, error,
  created_at, started_at, completed_at
)
SELECT
  id, org_id, run_id, runner_id, kind, status, attempt, lease_owner,
  lease_expires_at, input_object_key, output_object_key, error,
  created_at, started_at, completed_at
FROM runner_jobs_old;

CREATE TABLE run_events (
  id TEXT PRIMARY KEY,
  org_id TEXT NOT NULL,
  run_id TEXT NOT NULL,
  seq INTEGER NOT NULL,
  type TEXT NOT NULL,
  job_id TEXT,
  runner_id TEXT,
  payload_json TEXT NOT NULL,
  created_at TEXT NOT NULL,
  FOREIGN KEY (org_id) REFERENCES orgs(id),
  FOREIGN KEY (run_id) REFERENCES fusion_runs(id),
  UNIQUE (run_id, seq)
);

INSERT INTO run_events (
  id, org_id, run_id, seq, type, job_id, runner_id, payload_json, created_at
)
SELECT
  id, org_id, run_id, seq, type, job_id, runner_id, payload_json, created_at
FROM run_events_old;

CREATE TABLE artifacts (
  id TEXT PRIMARY KEY,
  org_id TEXT NOT NULL,
  run_id TEXT NOT NULL,
  kind TEXT NOT NULL,
  object_key TEXT NOT NULL,
  content_type TEXT,
  size_bytes INTEGER,
  sha256 TEXT,
  created_at TEXT NOT NULL,
  FOREIGN KEY (org_id) REFERENCES orgs(id),
  FOREIGN KEY (run_id) REFERENCES fusion_runs(id)
);

INSERT INTO artifacts (
  id, org_id, run_id, kind, object_key, content_type, size_bytes, sha256, created_at
)
SELECT
  id, org_id, run_id, kind, object_key, content_type, size_bytes, sha256, created_at
FROM artifacts_old;

DROP TABLE panel_outputs_old;
DROP TABLE runner_jobs_old;
DROP TABLE run_events_old;
DROP TABLE artifacts_old;
DROP TABLE fusion_runs_old;

CREATE INDEX idx_fusion_runs_org_created ON fusion_runs(org_id, created_at DESC);
CREATE INDEX idx_fusion_runs_conversation ON fusion_runs(conversation_id, created_at);
CREATE INDEX idx_panel_outputs_run ON panel_outputs(run_id);
CREATE INDEX idx_runner_jobs_runner_status ON runner_jobs(runner_id, status, created_at);
CREATE INDEX idx_runner_jobs_run ON runner_jobs(run_id, created_at);
CREATE INDEX idx_run_events_run_seq ON run_events(run_id, seq);
