-- Add missing UNIQUE constraints so ON CONFLICT DO NOTHING actually deduplicates
-- signal_history: one row per ticker per generation cycle
ALTER TABLE public.signal_history ADD CONSTRAINT uq_signal_history_ticker_gen
  UNIQUE (ticker, generated_at);

-- signal_outcomes: one outcome per entry price per symbol
ALTER TABLE public.signal_outcomes ADD CONSTRAINT uq_signal_outcomes_ticker_entry
  UNIQUE (ticker, entry_price);

-- prediction_log: one prediction per ticker per creation timestamp
ALTER TABLE public.prediction_log ADD CONSTRAINT uq_prediction_log_ticker_created
  UNIQUE (ticker, created_at);

-- forward_predictions: one prediction per symbol per generation
ALTER TABLE public.forward_predictions ADD CONSTRAINT uq_forward_predictions_symbol_gen
  UNIQUE (symbol, generated_at);
