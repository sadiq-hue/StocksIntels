-- Migration: NSE Stock Financial Statements
-- Creates tables for PDF uploads and extracted fundamentals

-- Ensure updated_at trigger function exists
CREATE OR REPLACE FUNCTION set_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = CURRENT_TIMESTAMP;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Financial statements table (stores PDF metadata and extracted data)
CREATE TABLE IF NOT EXISTS financial_statements (
  id SERIAL PRIMARY KEY,
  stock_id INTEGER NOT NULL REFERENCES stocks(id) ON DELETE CASCADE,
  period_type VARCHAR(10) NOT NULL DEFAULT 'annual' CHECK (period_type IN ('annual', 'quarterly', 'half-yearly')),
  period_end_date DATE,
  file_name VARCHAR(255) NOT NULL,
  file_data BYTEA,
  file_size INTEGER,
  mime_type VARCHAR(100) DEFAULT 'application/pdf',
  status VARCHAR(20) NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'processing', 'completed', 'failed')),
  raw_text TEXT,
  parsed_data JSONB,
  error_message TEXT,
  uploaded_by INTEGER REFERENCES users(id),
  uploaded_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP,
  parsed_at TIMESTAMPTZ,
  processed_by VARCHAR(50)
);

CREATE INDEX IF NOT EXISTS idx_financial_statements_stock_id ON financial_statements(stock_id);
CREATE INDEX IF NOT EXISTS idx_financial_statements_status ON financial_statements(status);
CREATE INDEX IF NOT EXISTS idx_financial_statements_uploaded_at ON financial_statements(uploaded_at DESC);

-- Stock fundamentals table (stores extracted metrics from PDFs)
CREATE TABLE IF NOT EXISTS stock_fundamentals (
  symbol VARCHAR(20) PRIMARY KEY,
  pe_ratio NUMERIC(10,4),
  pb_ratio NUMERIC(10,4),
  market_cap NUMERIC(20,4),
  dividend_yield NUMERIC(10,4),
  roe NUMERIC(10,4),
  revenue_growth NUMERIC(10,4),
  eps_growth NUMERIC(10,4),
  created_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP
);

-- Seed NSE stocks if not already present
INSERT INTO stocks (ticker, name, sector, market, currency, is_active) VALUES
  ('SCOM', 'Safaricom PLC', 'Telecommunications', 'NSE', 'KES', true),
  ('EQTY', 'Equity Group Holdings PLC', 'Banking', 'NSE', 'KES', true),
  ('KCB', 'KCB Group PLC', 'Banking', 'NSE', 'KES', true),
  ('COOP', 'Co-operative Bank of Kenya Ltd', 'Banking', 'NSE', 'KES', true),
  ('ABSA', 'Absa Bank Kenya PLC', 'Banking', 'NSE', 'KES', true),
  ('BBK', 'Bank of Baroda (K) Ltd', 'Banking', 'NSE', 'KES', true),
  ('KUKU', 'Kuku Foods Group PLC', 'Agriculture', 'NSE', 'KES', true),
  ('KAPC', 'KAP Automotive PLC', 'Automotive', 'NSE', 'KES', true),
  ('EABL', 'East African Breweries PLC', 'Beverages & Tobacco', 'NSE', 'KES', true),
  ('BAT', 'British American Tobacco Kenya PLC', 'Beverages & Tobacco', 'NSE', 'KES', true),
  ('TOTL', 'Total Energies Marketing Kenya PLC', 'Energy & Petroleum', 'NSE', 'KES', true),
  ('KPLC', 'Kenya Power & Lighting Co PLC', 'Energy & Petroleum', 'NSE', 'KES', true),
  ('KNRE', 'Kenya Reinsurance Corporation Ltd', 'Insurance', 'NSE', 'KES', true),
  ('CIC', 'CIC Insurance Group Ltd', 'Insurance', 'NSE', 'KES', true),
  ('JUB', 'Jubilee Holdings Ltd', 'Insurance', 'NSE', 'KES', true),
  ('SLAM', 'Sanlam Kenya PLC', 'Insurance', 'NSE', 'KES', true),
  ('SASN', 'Sasini PLC', 'Agriculture', 'NSE', 'KES', true),
  ('UNGA', 'Unga Group PLC', 'Agriculture', 'NSE', 'KES', true),
  ('LKL', 'LKL International PLC', 'Energy & Petroleum', 'NSE', 'KES', true),
  ('PORT', 'Portland Cement Ltd', 'Construction & Allied', 'NSE', 'KES', true),
  ('BAMB', 'Bamburi Cement PLC', 'Construction & Allied', 'NSE', 'KES', true),
  ('CABL', 'Carbacid Investments PLC', 'Chemicals', 'NSE', 'KES', true),
  ('MSC', 'Mumias Sugar Company Ltd', 'Agriculture', 'NSE', 'KES', true),
  ('NMG', 'Nation Media Group PLC', 'Media & Publishing', 'NSE', 'KES', true),
  ('SCAN', 'Scangroup Ltd', 'Media & Publishing', 'NSE', 'KES', true),
  ('TPRI', 'TPS Eastern Africa Ltd', 'Hospitality', 'NSE', 'KES', true),
  ('CGEN', 'Sameer Africa PLC', 'Automotive', 'NSE', 'KES', true),
  ('WTK', 'W.E.C. Investments Ltd', 'Investment', 'NSE', 'KES', true),
  ('CFCI', 'CFC Insurance Holdings Ltd', 'Insurance', 'NSE', 'KES', true),
  ('HAFC', 'HF Group PLC', 'Banking', 'NSE', 'KES', true)
ON CONFLICT (ticker) DO UPDATE SET
  market = EXCLUDED.market,
  currency = EXCLUDED.currency,
  is_active = true;

-- Add updated_at trigger to stock_fundamentals if not exists
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgname = 'set_updated_at_stock_fundamentals') THEN
    CREATE TRIGGER set_updated_at_stock_fundamentals
      BEFORE UPDATE ON stock_fundamentals
      FOR EACH ROW
      EXECUTE FUNCTION set_updated_at();
  END IF;
END;
$$;
