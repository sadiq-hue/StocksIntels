-- Migration: Add missing signal engine columns
-- Safe to re-run (uses IF NOT EXISTS / IF EXISTS patterns)

ALTER TABLE IF EXISTS signal_history ADD COLUMN IF NOT EXISTS analysis_data JSONB;
ALTER TABLE IF EXISTS signal_outcomes ADD COLUMN IF NOT EXISTS resolved_at TIMESTAMP WITH TIME ZONE;
ALTER TABLE IF EXISTS forward_predictions ADD COLUMN IF NOT EXISTS resolved_at TIMESTAMP WITH TIME ZONE;
ALTER TABLE IF EXISTS forward_predictions ADD COLUMN IF NOT EXISTS stop_loss NUMERIC(15,2);
ALTER TABLE IF EXISTS forward_predictions ADD COLUMN IF NOT EXISTS target1 NUMERIC(15,2);
ALTER TABLE IF EXISTS forward_predictions ADD COLUMN IF NOT EXISTS action VARCHAR(10);
ALTER TABLE IF EXISTS forward_predictions ADD COLUMN IF NOT EXISTS trade_type VARCHAR(30);
CREATE INDEX IF NOT EXISTS idx_signal_history_analysis ON signal_history USING gin (analysis_data);
CREATE INDEX IF NOT EXISTS idx_signal_outcomes_resolved_at ON signal_outcomes(resolved_at);
