ALTER TABLE fusion_runs ADD COLUMN parent_run_id TEXT;
ALTER TABLE fusion_runs ADD COLUMN conversation_id TEXT;

CREATE INDEX idx_fusion_runs_conversation ON fusion_runs(conversation_id, created_at);