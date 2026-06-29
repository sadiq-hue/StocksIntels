-- Migration 004: Email sequences and stock tracking for conversion prompts
-- Adds tables for onboarding email campaigns and repeated stock view tracking

-- Stock views tracking (for in-product prompts)
CREATE TABLE IF NOT EXISTS user_stock_views (
    id SERIAL PRIMARY KEY,
    user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    ticker VARCHAR(20) NOT NULL,
    viewed_date DATE NOT NULL DEFAULT CURRENT_DATE,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    UNIQUE(user_id, ticker, viewed_date)
);

CREATE INDEX IF NOT EXISTS idx_user_stock_views_user_ticker
    ON user_stock_views (user_id, ticker, viewed_date DESC);

-- Dismissed prompts (so we don't show the same prompt repeatedly)
CREATE TABLE IF NOT EXISTS user_dismissed_prompts (
    id SERIAL PRIMARY KEY,
    user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    prompt_type VARCHAR(50) NOT NULL,
    ticker VARCHAR(20),
    dismissed_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    UNIQUE(user_id, prompt_type, ticker)
);

-- Email campaign definitions
CREATE TABLE IF NOT EXISTS email_campaigns (
    id SERIAL PRIMARY KEY,
    name VARCHAR(100) NOT NULL,
    description TEXT,
    trigger_event VARCHAR(50) NOT NULL DEFAULT 'signup',
    is_active BOOLEAN DEFAULT true,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

-- Individual steps within a campaign
CREATE TABLE IF NOT EXISTS email_campaign_steps (
    id SERIAL PRIMARY KEY,
    campaign_id INTEGER NOT NULL REFERENCES email_campaigns(id) ON DELETE CASCADE,
    step_order INTEGER NOT NULL,
    day_offset INTEGER NOT NULL,
    subject VARCHAR(255) NOT NULL,
    template_name VARCHAR(100) NOT NULL,
    is_active BOOLEAN DEFAULT true,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    UNIQUE(campaign_id, step_order)
);

-- Tracks which users are enrolled in which campaigns
CREATE TABLE IF NOT EXISTS user_email_campaigns (
    id SERIAL PRIMARY KEY,
    user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    campaign_id INTEGER NOT NULL REFERENCES email_campaigns(id) ON DELETE CASCADE,
    started_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    completed_at TIMESTAMP WITH TIME ZONE,
    UNIQUE(user_id, campaign_id)
);

-- Tracks which steps have been sent to which user
CREATE TABLE IF NOT EXISTS user_email_steps (
    id SERIAL PRIMARY KEY,
    user_campaign_id INTEGER NOT NULL REFERENCES user_email_campaigns(id) ON DELETE CASCADE,
    step_id INTEGER NOT NULL REFERENCES email_campaign_steps(id) ON DELETE CASCADE,
    sent_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    opened_at TIMESTAMP WITH TIME ZONE,
    clicked_at TIMESTAMP WITH TIME ZONE,
    UNIQUE(user_campaign_id, step_id)
);

-- Seed the onboarding campaign
INSERT INTO email_campaigns (name, description, trigger_event)
VALUES ('Free Onboarding Sequence', '5-email onboarding sequence over 2 weeks for free users', 'signup');

-- Day 0 (immediate): Welcome
INSERT INTO email_campaign_steps (campaign_id, step_order, day_offset, subject, template_name)
VALUES
    (1, 1, 0, 'Welcome to StocksIntels — Your Market Intelligence Starts Here', 'onboarding_day1_welcome'),
    (1, 2, 3, 'Build Your Watchlist — Track What Matters', 'onboarding_day3_watchlist'),
    (1, 3, 6, 'See What the AI Sees — Smart Signals You Can Use', 'onboarding_day6_signals'),
    (1, 4, 10, 'Real-Time Alerts & Market Sentiment — Only on Pro', 'onboarding_day10_pro'),
    (1, 5, 14, 'You''ve Been Watching [Stock] — Here''s What You''re Missing', 'onboarding_day14_conversion');
