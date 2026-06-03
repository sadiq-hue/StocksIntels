-- Initial Schema for StockIntel

-- Create Users table
CREATE TABLE IF NOT EXISTS users (
    id SERIAL PRIMARY KEY,
    username VARCHAR(50) UNIQUE NOT NULL,
    email VARCHAR(100) UNIQUE NOT NULL,
    password_hash TEXT NOT NULL,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

-- Create Stocks table
CREATE TABLE IF NOT EXISTS stocks (
    id SERIAL PRIMARY KEY,
    symbol VARCHAR(10) UNIQUE NOT NULL,
    company_name VARCHAR(255),
    sector VARCHAR(100),
    industry VARCHAR(100)
);

-- Create Watchlists table
CREATE TABLE IF NOT EXISTS watchlists (
    id SERIAL PRIMARY KEY,
    user_id INTEGER REFERENCES users(id) ON DELETE CASCADE,
    name VARCHAR(100) NOT NULL,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

-- Create Watchlist_Items table (Many-to-Many relationship)
CREATE TABLE IF NOT EXISTS watchlist_items (
    watchlist_id INTEGER REFERENCES watchlists(id) ON DELETE CASCADE,
    stock_id INTEGER REFERENCES stocks(id) ON DELETE CASCADE,
    added_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    PRIMARY KEY (watchlist_id, stock_id)
);

-- Create Market Data table for caching/historical tracking
CREATE TABLE IF NOT EXISTS market_data (
    id SERIAL PRIMARY KEY,
    stock_id INTEGER REFERENCES stocks(id) ON DELETE CASCADE,
    price DECIMAL(15, 2) NOT NULL,
    change_percent DECIMAL(10, 4),
    volume BIGINT,
    timestamp TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

-- Create Signal History table for high-frequency signal tracking
CREATE TABLE IF NOT EXISTS signal_history (
    id SERIAL PRIMARY KEY,
    ticker VARCHAR(20) NOT NULL,
    signal VARCHAR(20) NOT NULL,
    confidence INTEGER,
    price DECIMAL(15, 2),
    change_pct DECIMAL(10, 4),
    entry_price DECIMAL(15, 2),
    stop_loss DECIMAL(15, 2),
    target1 DECIMAL(15, 2),
    target2 DECIMAL(15, 2),
    risk_reward DECIMAL(5, 2),
    sector VARCHAR(100),
    market VARCHAR(20),
    currency VARCHAR(10),
    trade_type VARCHAR(20),
    timeframe VARCHAR(20),
    reason TEXT,
    generated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_signal_history_ticker ON signal_history(ticker);
CREATE INDEX IF NOT EXISTS idx_signal_history_generated_at ON signal_history(generated_at);