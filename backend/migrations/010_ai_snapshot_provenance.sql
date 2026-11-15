-- Migration 010: AI snapshot provenance for exact payload parity.
--
-- Stores the identity and the exact recommendation snapshot that produced each
-- AI interpretation, so an analysis can never be served from a different
-- snapshot than the one requested.

ALTER TABLE ai_position_intelligence
  ADD COLUMN IF NOT EXISTS snapshot_hash VARCHAR(64);

ALTER TABLE ai_position_intelligence
  ADD COLUMN IF NOT EXISTS snapshot_payload JSONB;

CREATE INDEX IF NOT EXISTS idx_ai_pos_snapshot
  ON ai_position_intelligence (ticker, prompt_schema_version, snapshot_hash);
