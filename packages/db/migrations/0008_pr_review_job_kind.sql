PRAGMA defer_foreign_keys = true;

DROP INDEX IF EXISTS idx_runner_jobs_runner_status;
DROP INDEX IF EXISTS idx_runner_jobs_run;

ALTER TABLE runner_jobs RENAME TO runner_jobs_old;

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

DROP TABLE runner_jobs_old;

CREATE INDEX idx_runner_jobs_runner_status ON runner_jobs(runner_id, status, created_at);
CREATE INDEX idx_runner_jobs_run ON runner_jobs(run_id, created_at);