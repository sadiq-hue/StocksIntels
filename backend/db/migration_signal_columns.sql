-- Migration: Add missing signal engine columns
-- Safe to re-run (uses IF NOT EXISTS / IF EXISTS patterns)

ALTER TABLE IF EXISTS signal_history ADD COLUMN IF NOT EXISTS analysis_data JSONB;
ALTER TABLE IF EXISTS signal_history ADD COLUMN IF NOT EXISTS signal_bucket TIMESTAMPTZ;
ALTER TABLE IF EXISTS signal_outcomes ADD COLUMN IF NOT EXISTS resolved_at TIMESTAMP WITH TIME ZONE;
ALTER TABLE IF EXISTS signal_outcomes ADD COLUMN IF NOT EXISTS position_size NUMERIC(10,2);
ALTER TABLE IF EXISTS forward_predictions ADD COLUMN IF NOT EXISTS resolved_at TIMESTAMP WITH TIME ZONE;
ALTER TABLE IF EXISTS forward_predictions ADD COLUMN IF NOT EXISTS stop_loss NUMERIC(15,2);
ALTER TABLE IF EXISTS forward_predictions ADD COLUMN IF NOT EXISTS target1 NUMERIC(15,2);
ALTER TABLE IF EXISTS forward_predictions ADD COLUMN IF NOT EXISTS action VARCHAR(10);
ALTER TABLE IF EXISTS forward_predictions ADD COLUMN IF NOT EXISTS trade_type VARCHAR(30);
CREATE INDEX IF NOT EXISTS idx_signal_history_analysis ON signal_history USING gin (analysis_data);
ALTER TABLE IF EXISTS signal_outcomes ADD COLUMN IF NOT EXISTS signal_generated_at TIMESTAMP WITH TIME ZONE;
UPDATE signal_outcomes SET signal_generated_at = recorded_at WHERE signal_generated_at IS NULL;

-- Signal history hygiene: keep only current-engine actionable signals, deduplicated.
UPDATE signal_history SET signal_bucket = date_trunc('hour', generated_at) WHERE signal_bucket IS NULL;
DELETE FROM signal_history WHERE signal IN ('Hold', 'Accumulate', 'Reduce');
DELETE FROM signal_history WHERE ctid NOT IN (SELECT DISTINCT ON (ticker, signal_bucket) ctid FROM signal_history);
CREATE UNIQUE INDEX IF NOT EXISTS idx_signal_history_ticker_bucket ON signal_history (ticker, signal_bucket);
