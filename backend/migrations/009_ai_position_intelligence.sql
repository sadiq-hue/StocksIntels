-- Migration 009: AI position intelligence storage.
--
-- Stores structured AI-generated interpretation of existing StocksIntels
-- quantitative signal positions. The signal engine outputs (signal_history,
-- signal_snapshots) are never modified by this table -- AI output is stored
-- separately and is strictly interpretive.

CREATE TABLE IF NOT EXISTS ai_position_intelligence (
  id BIGSERIAL PRIMARY KEY,
  position_id VARCHAR(100) NOT NULL,
  ticker VARCHAR(20) NOT NULL,
  user_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
  model VARCHAR(100) NOT NULL DEFAULT 'gpt-5-mini',
  prompt_schema_version VARCHAR(20) NOT NULL DEFAULT 'v1',
  status VARCHAR(20) NOT NULL DEFAULT 'pending',
  input_snapshot JSONB NOT NULL,
  output_payload JSONB,
  error_message TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  completed_at TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS idx_ai_position_intelligence_ticker
  ON ai_position_intelligence (ticker, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_ai_position_intelligence_user
  ON ai_position_intelligence (user_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_ai_position_intelligence_status
  ON ai_position_intelligence (status);
