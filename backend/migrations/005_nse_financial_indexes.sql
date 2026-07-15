-- Migration 005: Indexes for fast NSE financial-report loads
-- The financials page calls getFinancialReport -> buildLocalNseReport, which
-- runs: (1) a stocks lookup by UPPER(ticker)+market, (2) a financial_statements
-- query filtered by stock_id+status ordered by period_end_date, and (3) a
-- stock_fundamentals lookup by symbol/stock_id. These indexes let all three be
-- served by index scans (no sequential scan / no sort) as the table grows.

-- (1) NSE stocks lookup: WHERE UPPER(ticker) = $1 AND market = $2
CREATE INDEX IF NOT EXISTS idx_stocks_upper_ticker_market
    ON stocks (UPPER(ticker), market);

-- (2) Financial statements: WHERE stock_id = $1 AND status = 'completed'
--     ORDER BY period_end_date DESC NULLS LAST, uploaded_at DESC
--     (leading stock_id+status satisfy the filter; the trailing period_end_date/
--      uploaded_at columns satisfy the ORDER BY so DISTINCT ON needs no sort)
CREATE INDEX IF NOT EXISTS idx_financial_statements_stock_status_period
    ON financial_statements (stock_id, status, period_end_date DESC, uploaded_at DESC);

-- (3) Fundamentals lookup used to enrich the NSE report
-- (stock_fundamentals is keyed by symbol; there is no stock_id column)
CREATE INDEX IF NOT EXISTS idx_stock_fundamentals_symbol
    ON stock_fundamentals (symbol);
