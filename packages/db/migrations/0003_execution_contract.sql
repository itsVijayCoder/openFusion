ALTER TABLE fusion_runs ADD COLUMN execution_plan_json TEXT;

CREATE TABLE runner_jobs (
  id TEXT PRIMARY KEY,
  org_id TEXT NOT NULL,
  run_id TEXT NOT NULL,
  runner_id TEXT NOT NULL,
  kind TEXT NOT NULL CHECK (kind IN ('direct', 'panel', 'judge', 'final', 'command', 'patch')),
  status TEXT NOT NULL CHECK (status IN ('queued', 'leased', 'running', 'completed', 'failed', 'timeout', 'cancelled')),
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

CREATE TABLE runner_tokens (
  id TEXT PRIMARY KEY,
  org_id TEXT NOT NULL,
  runner_id TEXT NOT NULL,
  token_hash TEXT NOT NULL,
  scopes_json TEXT NOT NULL,
  created_by TEXT,
  expires_at TEXT,
  revoked_at TEXT,
  created_at TEXT NOT NULL,
  FOREIGN KEY (org_id) REFERENCES orgs(id),
  FOREIGN KEY (runner_id) REFERENCES runners(id)
);

CREATE TABLE presets (
  id TEXT PRIMARY KEY,
  org_id TEXT NOT NULL,
  name TEXT NOT NULL,
  mode TEXT NOT NULL CHECK (mode IN ('direct', 'auto', 'required')),
  analysis_models_json TEXT NOT NULL,
  judge_model TEXT,
  final_model TEXT,
  provider_policy TEXT NOT NULL CHECK (provider_policy IN ('same_provider_first', 'mixed_quality', 'manual')),
  permission_profile TEXT NOT NULL CHECK (permission_profile IN ('readonly', 'workspace_write', 'trusted_internal')),
  timeout_ms INTEGER,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  FOREIGN KEY (org_id) REFERENCES orgs(id)
);

CREATE INDEX idx_runner_jobs_runner_status ON runner_jobs(runner_id, status, created_at);
CREATE INDEX idx_runner_jobs_run ON runner_jobs(run_id, created_at);
CREATE INDEX idx_run_events_run_seq ON run_events(run_id, seq);
CREATE INDEX idx_runner_tokens_runner ON runner_tokens(runner_id, revoked_at);
CREATE INDEX idx_presets_org_name ON presets(org_id, name);
