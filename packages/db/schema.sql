CREATE TABLE orgs (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE users (
  id TEXT PRIMARY KEY,
  org_id TEXT NOT NULL,
  email TEXT NOT NULL,
  name TEXT,
  role TEXT NOT NULL CHECK (role IN ('owner', 'admin', 'developer', 'viewer')),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  FOREIGN KEY (org_id) REFERENCES orgs(id)
);

CREATE TABLE workspaces (
  id TEXT PRIMARY KEY,
  org_id TEXT NOT NULL,
  name TEXT NOT NULL,
  repo_url TEXT,
  default_branch TEXT,
  default_runner_pool TEXT,
  permission_profile TEXT NOT NULL DEFAULT 'readonly',
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  FOREIGN KEY (org_id) REFERENCES orgs(id)
);

CREATE TABLE runners (
  id TEXT PRIMARY KEY,
  org_id TEXT NOT NULL,
  user_id TEXT,
  name TEXT NOT NULL,
  os TEXT NOT NULL,
  arch TEXT NOT NULL,
  version TEXT NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('online', 'offline', 'disabled')),
  capabilities_json TEXT NOT NULL,
  last_seen_at TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  FOREIGN KEY (org_id) REFERENCES orgs(id)
);

CREATE TABLE installed_tools (
  id TEXT PRIMARY KEY,
  runner_id TEXT NOT NULL,
  tool TEXT NOT NULL CHECK (tool IN ('opencode', 'codex', 'docker', 'git', 'custom')),
  version TEXT,
  path TEXT,
  status TEXT NOT NULL CHECK (status IN ('detected', 'verified', 'unavailable', 'error')),
  metadata_json TEXT,
  detected_at TEXT NOT NULL,
  FOREIGN KEY (runner_id) REFERENCES runners(id)
);

CREATE TABLE models (
  id TEXT PRIMARY KEY,
  org_id TEXT NOT NULL,
  runner_id TEXT,
  adapter TEXT NOT NULL,
  provider TEXT,
  model TEXT NOT NULL,
  display_name TEXT,
  auth_mode TEXT NOT NULL CHECK (auth_mode IN ('cli_session', 'api_key', 'cloud_gateway', 'unknown')),
  availability TEXT NOT NULL CHECK (availability IN ('detected', 'listed', 'verified', 'configured_unverified', 'unavailable')),
  capabilities_json TEXT NOT NULL,
  verified_at TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  FOREIGN KEY (org_id) REFERENCES orgs(id),
  FOREIGN KEY (runner_id) REFERENCES runners(id)
);

CREATE TABLE fusion_runs (
  id TEXT PRIMARY KEY,
  org_id TEXT NOT NULL,
  workspace_id TEXT,
  user_id TEXT NOT NULL,
  runner_id TEXT,
  status TEXT NOT NULL CHECK (status IN ('queued', 'running', 'waiting_approval', 'completed', 'failed', 'cancelled')),
  mode TEXT NOT NULL CHECK (mode IN ('direct', 'auto', 'required')),
  preset TEXT,
  permission_profile TEXT NOT NULL,
  prompt_object_key TEXT,
  judge_object_key TEXT,
  final_object_key TEXT,
  error TEXT,
  created_at TEXT NOT NULL,
  started_at TEXT,
  completed_at TEXT,
  FOREIGN KEY (org_id) REFERENCES orgs(id),
  FOREIGN KEY (workspace_id) REFERENCES workspaces(id),
  FOREIGN KEY (user_id) REFERENCES users(id),
  FOREIGN KEY (runner_id) REFERENCES runners(id)
);

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

CREATE TABLE audit_events (
  id TEXT PRIMARY KEY,
  org_id TEXT NOT NULL,
  user_id TEXT,
  runner_id TEXT,
  run_id TEXT,
  event_type TEXT NOT NULL,
  severity TEXT NOT NULL DEFAULT 'info',
  metadata_json TEXT,
  created_at TEXT NOT NULL,
  FOREIGN KEY (org_id) REFERENCES orgs(id)
);

CREATE INDEX idx_runners_org_status ON runners(org_id, status);
CREATE INDEX idx_models_org_adapter ON models(org_id, adapter);
CREATE INDEX idx_fusion_runs_org_created ON fusion_runs(org_id, created_at DESC);
CREATE INDEX idx_panel_outputs_run ON panel_outputs(run_id);
CREATE INDEX idx_audit_org_created ON audit_events(org_id, created_at DESC);
