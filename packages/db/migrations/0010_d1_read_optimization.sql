-- =============================================================================
-- Migration 0010: D1 Read Budget Optimization
-- Fixes 15.37M row reads (3x over 5M limit) by adding missing indexes and
-- denormalizing hot read paths.
-- =============================================================================

-- 1. Fix the #1 culprit: installed_tools table scan (34.44%, 2.43M reads)
-- Every getRunner() call does SELECT * FROM installed_tools WHERE runner_id = ?
-- No existing index — full table scan every time
CREATE INDEX IF NOT EXISTS idx_installed_tools_runner_detected
  ON installed_tools(runner_id, detected_at DESC);

-- 2. Fix the installed_tools JOIN in listRunners()
-- listRunners() joins installed_tools INNER JOIN runners WHERE runners.org_id = ?
-- Without an index on installed_tools.runner_id, this is a full scan
-- (idx_installed_tools_runner_detected above handles this too)

-- 3. Fix auth_tokens lookup by token_hash (23.89% of reads)
-- Current idx_auth_tokens_user_kind is on (user_id, kind, revoked_at)
-- But the hot query looks up by token_hash — needs a covering index
-- The UNIQUE constraint on token_hash creates an internal index, but it doesn't
-- cover the filtering columns (revoked_at, expires_at)
CREATE INDEX IF NOT EXISTS idx_auth_tokens_token_lookup
  ON auth_tokens(token_hash, revoked_at, expires_at);

-- 4. Fix auth_sessions lookup by session_hash (0.24% but similar pattern)
CREATE INDEX IF NOT EXISTS idx_auth_sessions_hash_lookup
  ON auth_sessions(session_hash, revoked_at, expires_at);

-- 5. Fix dashboard snapshot aggregation that does full table counts
-- countRunsByStatus() does GROUP BY status on fusion_runs
-- idx_fusion_runs_org_created exists but doesn't cover status
CREATE INDEX IF NOT EXISTS idx_fusion_runs_org_status
  ON fusion_runs(org_id, status);

-- 6. Fix listModels() JOIN with runners (0.25%)
-- listModels() fetches all models + all runners for effective status calc
-- Add runner status lookup optimization
CREATE INDEX IF NOT EXISTS idx_models_org_runner
  ON models(org_id, runner_id);

-- 7. Fix artifact stats on dashboard (expensive COUNT + SUM)
-- Used in getDashboardSnapshot() for total + total_bytes
CREATE INDEX IF NOT EXISTS idx_artifacts_org
  ON artifacts(org_id, size_bytes);

-- 8. Fix runner_jobs queries — frequently accessed by runner claim flow
-- idx_runner_jobs_runner_status exists but uses (runner_id, status, created_at)
-- The claim query also filters by run_id in some paths
-- Add a composite that helps with the common "list jobs by run" pattern
CREATE INDEX IF NOT EXISTS idx_runner_jobs_org_run
  ON runner_jobs(org_id, run_id, status);

-- 9. Fix audit_events scan for dashboard (reads all audit_events for org)
-- idx_audit_org_created exists, but dashboard's limit(10) with DESC should work
-- No additional index needed if query uses ORDER BY created_at DESC properly