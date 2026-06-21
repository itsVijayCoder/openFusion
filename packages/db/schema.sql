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

CREATE TABLE auth_sessions (
  id TEXT PRIMARY KEY,
  org_id TEXT NOT NULL,
  user_id TEXT NOT NULL,
  session_hash TEXT NOT NULL UNIQUE,
  user_agent TEXT,
  ip_hash TEXT,
  expires_at TEXT NOT NULL,
  revoked_at TEXT,
  last_seen_at TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  FOREIGN KEY (org_id) REFERENCES orgs(id),
  FOREIGN KEY (user_id) REFERENCES users(id)
);

CREATE TABLE auth_tokens (
  id TEXT PRIMARY KEY,
  org_id TEXT NOT NULL,
  user_id TEXT NOT NULL,
  name TEXT NOT NULL,
  token_hash TEXT NOT NULL UNIQUE,
  kind TEXT NOT NULL CHECK (kind IN ('runner', 'api')),
  scopes_json TEXT NOT NULL,
  expires_at TEXT,
  revoked_at TEXT,
  last_used_at TEXT,
  created_at TEXT NOT NULL,
  FOREIGN KEY (org_id) REFERENCES orgs(id),
  FOREIGN KEY (user_id) REFERENCES users(id)
);

CREATE TABLE oauth_accounts (
  id TEXT PRIMARY KEY,
  org_id TEXT NOT NULL,
  user_id TEXT NOT NULL,
  provider TEXT NOT NULL,
  provider_account_id TEXT NOT NULL,
  email TEXT,
  username TEXT,
  avatar_url TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  UNIQUE (provider, provider_account_id),
  FOREIGN KEY (org_id) REFERENCES orgs(id),
  FOREIGN KEY (user_id) REFERENCES users(id)
);

CREATE TABLE oauth_states (
  id TEXT PRIMARY KEY,
  state_hash TEXT NOT NULL UNIQUE,
  provider TEXT NOT NULL,
  return_to TEXT,
  expires_at TEXT NOT NULL,
  created_at TEXT NOT NULL
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
  source TEXT CHECK (source IN ('live', 'fallback', 'suggested', 'custom')),
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

CREATE TABLE runner_jobs (
  id TEXT PRIMARY KEY,
  org_id TEXT NOT NULL,
  run_id TEXT NOT NULL,
  runner_id TEXT NOT NULL,
  kind TEXT NOT NULL CHECK (kind IN ('direct', 'panel', 'judge', 'final', 'command', 'patch', 'pr_review')),
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
CREATE INDEX idx_auth_sessions_user ON auth_sessions(user_id, revoked_at, expires_at);
CREATE INDEX idx_auth_tokens_user_kind ON auth_tokens(user_id, kind, revoked_at);
CREATE INDEX idx_oauth_accounts_user ON oauth_accounts(user_id, provider);
CREATE INDEX idx_oauth_states_expires ON oauth_states(expires_at);
CREATE INDEX idx_models_org_adapter ON models(org_id, adapter);
CREATE INDEX idx_fusion_runs_org_created ON fusion_runs(org_id, created_at DESC);
CREATE INDEX idx_fusion_runs_conversation ON fusion_runs(conversation_id, created_at);
CREATE INDEX idx_panel_outputs_run ON panel_outputs(run_id);
CREATE INDEX idx_runner_jobs_runner_status ON runner_jobs(runner_id, status, created_at);
CREATE INDEX idx_runner_jobs_run ON runner_jobs(run_id, created_at);
CREATE INDEX idx_run_events_run_seq ON run_events(run_id, seq);
CREATE INDEX idx_runner_tokens_runner ON runner_tokens(runner_id, revoked_at);
CREATE INDEX idx_presets_org_name ON presets(org_id, name);
CREATE INDEX idx_audit_org_created ON audit_events(org_id, created_at DESC);
