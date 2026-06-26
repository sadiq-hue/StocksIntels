# StocksIntels API Documentation

Base URL: `http://localhost:3001/api`

**Authentication**: JWT Bearer token via `Authorization: Bearer <token>` header, `x-auth-token` header, or `access_token` cookie.

---

## Authentication

### `POST /api/auth/register`
Create a new user account.
- **Body**: `{ fullName, email, password, ref? }`
- **Response** `201`: `{ user: { id, full_name, email, role, ... }, token }`

### `POST /api/auth/send-verification-code`
Send 6-digit email verification code.
- **Body**: `{ email }`
- **Response**: `{ message, expiresIn: 600 }`

### `POST /api/auth/verify-email-and-register`
Verify code + register in one step.
- **Body**: `{ fullName, email, password, code, ref? }`
- **Response** `201`: `{ user, token }`

### `POST /api/auth/login`
Password-based login.
- **Body**: `{ email, password }`
- **Response**: `{ user, token }`

### `POST /api/auth/send-otp`
Send OTP to email for OTP-only login flow.
- **Body**: `{ email }`
- **Response**: `{ message, expiresIn: 600 }`

### `POST /api/auth/verify-otp`
Verify OTP — auto-creates account if new.
- **Body**: `{ email, code }`
- **Response**: `{ user, token }`

### `POST /api/auth/login-request-otp`
Step 1 of password+OTP flow — validates password then emails OTP.
- **Body**: `{ email, password }`
- **Response**: `{ message, expiresIn: 600 }`

### `POST /api/auth/login-verify-otp`
Step 2 of password+OTP flow — verify OTP and get token.
- **Body**: `{ email, code }`
- **Response**: `{ user, token }`

### `POST /api/auth/forgot-password`
Send password reset code.
- **Body**: `{ email }`
- **Response**: `{ message, expiresIn: 900 }`

### `POST /api/auth/reset-password`
Reset password with code.
- **Body**: `{ email, code, newPassword }`
- **Response**: `{ message }`

### `POST /api/auth/refresh`
Refresh expired JWT using httpOnly cookie.
- **Cookie**: `refresh_token`
- **Response**: `{ user, token }`

### `POST /api/auth/logout`
Revoke refresh token and clear cookie.
- **Response**: `{ message }`

### `GET /api/auth/me`
Get current authenticated user.
- **Auth**: Required
- **Response**: `{ user }`

---

## Health & Probes

| Method | Path | Description |
|--------|------|-------------|
| `GET` | `/healthz` | Liveness probe — checks DB |
| `GET` | `/readyz` | Readiness probe — checks DB + ML circuit breaker |
| `GET` | `/api/health` | General health check |

---

## Market Data

### `GET /api/market/indices`
All market indices with current values.

### `GET /api/market/movers`
Top gainers and losers (NSE + Global).

### `GET /api/market/active`
Most actively traded stocks.

### `GET /api/market/status`
Market open/close status.
- **Response**: `{ nse: bool, global: bool }`

### `GET /api/market/nse`
NSE-specific stock data.
- **Response**: Array of quotes with `volumeFormatted`, `turnoverFormatted`.

### `GET /api/market/us`
US market top stocks (AAPL, MSFT, GOOGL, AMZN, NVDA, META, TSLA, JPM, V, NFLX).

### `GET /api/market/sectors`
Sector performance data.

### `GET /api/market/pulse`
AI market sentiment analysis.

### `GET /api/market/premarket`
Pre-market trading data.

### `GET /api/market/turnover`
Market turnover data.

### `POST /api/market/quotes`
Batch quote fetching.
- **Body**: `{ symbols: string[] }`
- **Response**: `{ quotes: Record<string, RealtimeStockQuote> }`

### `GET /api/quote/:symbol`
Single stock quote by symbol.

### `GET /api/quotes`
Multiple quotes by symbols query param.

### `GET /api/stock/:symbol`
Real-time stock detail.
- **Query**: `market=nse|us`
- **Response**: `{ symbol, company_name, price, change, changePercent, volume, dayHigh, dayLow, previousClose, currency, provider, exchange, timestamp }`

### `GET /api/stock/:symbol/history`
Historical OHLCV price bars.
- **Query**: `range=6mo&interval=1d`
- **Response**: `{ symbol, bars: [{ date, timestamp, open, high, low, close, volume, adjclose }], count }`

### `GET /api/market/stream`
Server-Sent Events (SSE) stream for real-time market updates.

### `GET /api/stocks`
All stocks with AI signals.
- **Query**: `brief=true` for trimmed response
- **Response**: `Array<{ ticker, name, price, change, signal, confidence, market, sector, ... }>`

### `GET /api/stocks/list`
Database stock list.
- **Query**: `market=nse|global`
- **Response**: `[{ ticker, name, sector, market, currency }]`

### `GET /api/stocks/search`
Search stocks by ticker or name.
- **Query**: `q=<search term>`
- **Response**: `[{ ticker, name, sector, market }]`

### `GET /api/stocks/search/yahoo`
Proxy search to Yahoo Finance.
- **Query**: `q=<search term>`

### `GET /api/screener`
Stock screener with filters.
- **Query**: Various filter params (market, sector, price range, etc.)

### `GET /api/top-stocks`
Top stocks ranked by AI score and volume.

---

## Trading Signals

### `GET /api/signals`
All trading signals (triggers async regeneration in background).
- **Response**: `{ success: true, signals: [...] }`

### `GET /api/signals/summary`
Signal summary statistics (totals by type, confidence distribution).

### `GET /api/signal/:symbol`
Signal for a specific stock.
- **Response**: Signal object or `404` if not found.

### `GET /api/signals/backtest`
Backtest statistics.
- **Query**: `days=30, limit=500, signal=, minConfidence=0`
- **Response**: `{ success, stats }`

### `GET /api/signals/forward-test`
Forward test predictions or stats.
- **Query**: `symbol=, resolved=true|false, limit=50, offset=0`
- **Response**: `{ success, stats }` or `{ success, predictions, total }`

### `POST /api/signals/forward-test/resolve`
Resolve all unresolved forward predictions.
- **Response**: `{ success, resolved, total }`

### `GET /api/signals/audit`
Signal audit log.
- **Query**: `type=, limit=100, offset=0`
- **Response**: Audit log entries.

### `GET /api/signals/engine/config`
Signal engine configuration.
- **Query**: `view=full|public`

### `PUT /api/signals/engine/config`
Update engine config.
- **Auth**: Admin
- **Body**: Engine config object.

### `GET /api/signals/engine/health`
Engine health status.

### `GET /api/signals/engine/diagnostics`
Engine diagnostic information.

### `POST /api/signals/engine/backfill`
Backfill signal outcomes.

### `POST /api/signals/engine/backtest/historical`
Run historical backtest.

---

## Watchlist

### `GET /api/watchlist`
Get user watchlist (uses in-memory fallback if DB unavailable).
- **Query**: `userId=<id>`
- **Response**: `Array<{ id, symbol, company_name, notes, target_price, user_id, created_at }>`

### `POST /api/watchlist`
Add to watchlist (upsert by symbol+userId).
- **Body**: `{ userId, symbol, company_name?, notes?, target_price? }`
- **Response** `201`: Created watchlist item.

### `DELETE /api/watchlist/:id`
Remove from watchlist.

---

## Portfolio & Paper Trading

### `GET /api/portfolio/statement`
Full portfolio statement with holdings, P&L, sector allocation, value history, best/worst performers.
- **Auth**: Ownership required
- **Query**: `userId=<id>&period=1M`
- **Response**: `{ generatedAt, holdings[], summary{...}, sectorAllocation[], valueHistory[], bestPerformers[], worstPerformers[], tradeHistory[], brokerEquity, brokerBalance }`

### `GET /api/portfolio/performance`
Portfolio performance vs NSE 20 and S&P 500 benchmarks.
- **Query**: `userId=<id>&period=6M`
- **Response**: `{ data[{ month, portfolio, nse20, sp500, ... }], period, hasHistory, currentValue, totalReturn, totalReturnPercent, fxRate }`

### `GET /api/portfolio/:userId`
User portfolio holdings + paper account.
- **Response**: `{ holdings: [...], account: {...} | null }`

### `GET /api/portfolio/:userId/holdings`
User holdings only.

### `POST /api/portfolio/holdings`
Add/update holding (upsert by user_id + ticker).
- **Body**: `{ user_id, ticker, shares, avg_cost, name?, sector?, market? }`

### `DELETE /api/portfolio/holdings/:id`
Remove holding.

### `POST /api/portfolio/optimize`
AI portfolio optimization.
- **Body**: `{ userId }`

### `POST /api/portfolio/var`
Value-at-risk calculation.
- **Body**: `{ userId }`

### `GET /api/paper/account`
Get paper trading account.

### `GET /api/paper/positions`
Paper trading open positions.

### `GET /api/paper/trades`
Paper trade history.

### `POST /api/paper/orders`
Place paper trade order.

### `POST /api/paper/reset`
Reset paper trading account.

### `POST /api/trade`
Execute a trade (paper).
- **Body**: `{ user_id, ticker, type, shares, price, name?, market?, sector?, currency? }`
- **Response** `201`: Trade record.

### `GET /api/trades/:userId`
User trade history.
- **Query**: `limit=50`
- **Response**: Array of trade records.

### `GET /api/holdings`
Get all holdings.

### `POST /api/holdings/bulk`
Bulk holdings update.

### `GET /api/orders/positions`
Order positions.

### `POST /api/orders/execute`
Execute order.

---

## Financial Reports

### `GET /api/financials/status`
Provider configuration status.
- **Response**: `{ providerConfigured, provider, edgarConfigured, simfinConfigured, yahooFinanceConfigured, ... }`

### `GET /api/financials/:symbol`
Full financial report.
- **Query**: `period=annual|quarterly&limit=4&provider=`

### `GET /api/financials/:symbol/income`
Income statement.

### `GET /api/financials/:symbol/balance`
Balance sheet.

### `GET /api/financials/:symbol/cashflow`
Cash flow statement.

### `GET /api/financials/:symbol/metrics`
Key financial metrics (P/E, P/B, ROE, EPS, EV/EBITDA, etc.).

### `GET /api/financials/:symbol/dividends`
Dividend history.
- **Query**: `limit=8`
- **Response**: `{ success, data: [...] }`

### `GET /api/financials/:symbol/filings`
SEC filings.

### `GET /api/financials/:symbol/edgar`
SEC EDGAR data.

### `GET /api/company/:symbol/profile`
Company profile.
- **Response**: Profile object or `{}`.

### `GET /api/company/:symbol/financials`
Income statement, balance sheet, and cash flow combined.
- **Response**: `{ incomeStatement, balanceSheet, cashFlow }`

---

## News

### `GET /api/news`
Aggregated financial news with sentiment analysis.
- **Query**: `limit=50&category=all|nse|global`
- **Response**: `Array<{ id, headline, excerpt, source, timestamp, publishedAt, category, relatedStocks, sentiment, url, imageUrl?, hot?, hotType? }>`

### `GET /api/news/summary`
News summary with counts and trending.
- **Response**: `{ total, nseCount, globalCount, positiveCount, negativeCount, neutralCount, hotCount, hotNews, sentimentRatio, trending, topSources }`

### `GET /api/news/kenyan`
Kenyan stock list.
- **Response**: `{ stocks: [...] }`

### `GET /api/news/hot`
Hot/trending news articles.
- **Query**: `limit=20`
- **Response**: Array of hot news articles.

### `GET /api/news/sentiment`
Aggregated sentiment data.

---

## Social (Groups & Chat)

### `GET /api/groups`
List trading groups with member count, message count, activity.
- **Query**: `userId=<id>` (to check membership)
- **Response**: `Array<{ id, name, description, icon, topic, created_by, members, message_count, activity_last_hour, isJoined, isAdmin, online_members, trending }>`

### `POST /api/groups`
Create or update a group (upsert by id).
- **Body**: `{ id, name, description?, icon?, topic?, created_by? }`

### `POST /api/groups/:id/join`
Join a group.
- **Body**: `{ userId }`

### `POST /api/groups/:id/leave`
Leave a group.
- **Body**: `{ userId }`

### `GET /api/groups/:id/members`
Group members with online status.
- **Response**: `Array<{ id, full_name, email, role, trader_type, is_verified, joined_at, online, last_seen }>`

### `GET /api/groups/:groupId/messages`
Group chat messages (newest first, reversed).
- **Query**: `limit=50`

### `POST /api/groups/:groupId/messages`
Send group message.
- **Body**: `{ sender_id, sender_name?, content, message_type? }`
- **WebSocket**: Emits `receive_message` to `group:<id>` room.

### `GET /api/chat/:userId/:otherUserId`
Private chat history.

### `GET /api/conversations/:userId/:otherUserId`
Alias for private chat history.

### `POST /api/chat/send`
Send private message.
- **Body**: `{ sender_id, recipient_id, content }`
- **WebSocket**: Emits `receive_message` to `user:<recipient_id>` room.

### `PUT /api/messages/:id`
Edit a message.
- **Auth**: Required

### `DELETE /api/messages/:id`
Delete a message.
- **Auth**: Required

---

## People / Community

### `GET /api/people`
User directory (visible profiles).
- **Response**: `Array<{ id, full_name, email, role, trader_type, is_verified, followers, online, last_seen }>`

### `POST /api/people/:id/follow`
Follow a user.
- **Body**: `{ userId }`

### `POST /api/people/:id/unfollow`
Unfollow a user.
- **Body**: `{ userId }`

### `GET /api/users/search`
Search users.
- **Query**: `q=<query>&userId=<exclude_id>`

### `GET /api/users/:id`
User profile.

### `PUT /api/users/:id`
Update user profile.
- **Body**: `{ full_name?, email?, trader_type?, visible_in_directory? }`

### `GET /api/users/:userId/followers`
Get user's followers.

### `GET /api/users/:userId/following`
Get users the user follows.

### `POST /api/users/follow`
Follow a user (alternative endpoint).

### `DELETE /api/users/unfollow`
Unfollow a user (alternative endpoint).

---

## Notifications

### `GET /api/notifications/:userId`
Get user notifications.
- **Query**: `limit=50`

### `GET /api/notifications`
Get notifications for authenticated user.
- **Auth**: Required

### `POST /api/notifications/:id/read`
Mark notification as read.

### `POST /api/notifications/read-all`
Mark all notifications as read.
- **Body**: `{ userId }`

---

## Bonds & ETFs

### `GET /api/bonds`
All bonds.
- **Query**: `market=kenya|us`

### `GET /api/bonds/summary`
Bond market summary.

### `GET /api/bonds/:id`
Bond by ID.

### `GET /api/bonds/:type/access`
Market access info.
- **Query**: `market=kenya`

### `GET /api/etfs`
All ETFs.
- **Query**: `market=all|us|kenya`

### `GET /api/etfs/summary`
ETF market summary.

### `GET /api/etfs/:ticker`
ETF by ticker.

---

## Indices & FX

### `GET /api/indices/all`
All market indices.

### `GET /api/indices/nse`
NSE-specific indices (NSE 20, NSE 25).

### `GET /api/indices/global`
Global indices (S&P 500, NASDAQ, FTSE 100, etc.).

### `GET /api/fx/rate`
KES/USD exchange rate.
- **Response**: `{ rate: number }`

### `GET /api/fx/convert`
Currency conversion.
- **Query**: `amount=, from=KES, to=USD`

### `GET /api/analysts`
Analyst ratings and target prices.

### `GET /api/earnings/upcoming`
Earnings calendar.

---

## AI & ML

### `POST /api/ai/insights`
AI chat insights (conversational AI analyst).
- **Body**: `{ query, userId?, context? }`

### `GET /api/ai/market-summary`
AI-generated market summary with sentiment.

### `POST /api/ai/portfolio-advice`
AI portfolio advice.
- **Body**: `{ userId }`

### `POST /api/ai/portfolio-rebalance`
AI rebalancing suggestions.
- **Body**: `{ userId }`

### `GET /api/ai/recommendations`
AI stock recommendations.

### `POST /api/ml/predict`
ML model prediction for a stock.
- **Body**: `{ symbol, sector?, features? }`

### `POST /api/ml/train`
Trigger ML model training.

### `GET /api/ml/info`
ML model metadata and info.

### `GET /api/ml/circuit-breaker`
ML circuit breaker status.

---

## Support

### `GET /api/support/faq`
FAQ items.
- **Query**: `category=account|trading|markets|signals|portfolio|social|support|dashboard|stocks|data|news`

### `POST /api/support/tickets`
Create support ticket.
- **Body**: `{ email, subject, category?, priority?, message }`

### `GET /api/support/tickets`
Get tickets by email.
- **Query**: `email=<email>`

### `GET /api/support/tickets/:id`
Ticket detail with messages.

### `POST /api/support/tickets/:id/messages`
Reply to ticket.
- **Body**: `{ sender, message }`

### `PATCH /api/support/tickets/:id/status`
Update ticket status.
- **Body**: `{ status: open|in_progress|resolved|closed }`

### `GET /api/support/chat/messages`
Support chat messages.
- **Query**: `userId=<id>&limit=50`

### `POST /api/support/chat/messages`
Send support chat message.
- **Body**: `{ userId?, userName?, email?, message }`

### `GET /api/support/chats/active`
Active support conversations (last 24h).

### `GET /api/support/chats/:userId/messages`
User's support chat history.

### `POST /api/support/chatbot`
AI chatbot for support.
- **Body**: `{ message, userId? }`

---

## Broker Connections

### `GET /api/broker-connections`
List user's broker connections.
- **Query**: `userId=<id>`

### `POST /api/broker-connections`
Create broker connection.
- **Body**: `{ userId, brokerType, accountName, apiKey?, apiSecret?, config? }`
- **Supported brokers**: alpaca, ibkr, mt5, oanda, tradier, manual

### `POST /api/broker-connections/validate`
Validate broker credentials.
- **Body**: `{ brokerType, apiKey?, apiSecret?, config? }`

### `POST /api/broker-connections/parse-email`
Parse broker credentials from welcome email text.
- **Body**: `{ emailText }`
- **Response**: `{ success, parsed: { brokerName, accountId, password, investorPassword, accountType, server, platform, platformType } }`

### `POST /api/broker-connections/:id/sync`
Sync broker data (positions, balance, trade history).
- **WebSocket**: Emits `broker:sync` to `user:<id>` room.

### `GET /api/broker-connections/:id/snapshots`
Account snapshots.
- **Query**: `limit=10`

### `DELETE /api/broker-connections/:id`
Remove broker connection.
- **Query**: `userId=<id>`

---

## Payments & Subscriptions

### `GET /api/payments/plans`
Subscription plans list.

### `POST /api/payments/mpesa-push`
Initiate M-Pesa STK push.
- **Body**: `{ phone, amount, userId, planId }`

### `POST /api/payments/callback`
M-Pesa payment callback (webhook).

### `POST /api/payments/paypal`
Create PayPal order.
- **Body**: `{ planId, userId }`

### `GET /api/payments/paypal-capture`
Capture PayPal order.

### `POST /api/payments/paypal-webhook`
PayPal webhook handler.

### `POST /api/payments/start-trial`
Start free trial.
- **Body**: `{ userId }`

### `POST /api/payments/activate-free`
Activate free plan.
- **Body**: `{ userId }`

### `GET /api/subscription-plans`
Public subscription plans (alternative).

---

## Activity & Admin

### `POST /api/activity/log`
Log user activity.
- **Auth**: Optional
- **Body**: `{ userId, action, details? }`
- **Valid actions**: page_view, signal_view, watchlist_add, watchlist_remove, search, news_read, portfolio_view, settings_change, logout

### `POST /api/upload`
File upload.
- **Auth**: Required
- **Type**: multipart/form-data
- **Allowed**: png, jpg, jpeg, gif, webp, svg, pdf, doc, docx, xlsx, csv, txt, mp4, mov, avi (max 10MB)

All admin routes are under `/api/admin` and require **admin role**:
- `POST /api/admin/send-otp`, `POST /api/admin/verify-otp` — Admin OTP login
- `GET /api/admin/dashboard` — Admin dashboard stats
- `GET/PUT/DELETE /api/admin/users` — User management
- `GET/PUT/DELETE /api/admin/signals` — Signal management
- `POST /api/admin/signals/generate` — Force signal generation
- `GET /api/admin/subscribers`, `/api/admin/subscriptions` — Subscription data
- `GET/POST/PUT/DELETE /api/admin/subscription-plans` — Plan CRUD
- `GET/PUT /api/admin/support-tickets` — Ticket management
- `GET /api/admin/payments` — Payment transactions
- `GET /api/admin/portfolio-history` — Portfolio snapshots
- `GET/POST/PUT/DELETE /api/admin/groups` — Group management
- `GET/DELETE /api/admin/messages` — Message management
- `GET /api/admin/broker-accounts` — Broker connections
- `GET /api/admin/notifications` — All notifications
- `GET /api/admin/signal-outcomes` — Signal outcome stats
- `GET/PUT /api/admin/affiliates` — Affiliate management
- `GET /api/admin/activity/recent` — Recent user activity

---

## WebSocket Events (Socket.IO)

**Connect**: `ws://localhost:3001`

| Event | Direction | Description |
|-------|-----------|-------------|
| `receive_message` | Server → Client | New group or private message |
| `broker:sync` | Server → Client | Broker data sync complete |
| `group_member_joined` | Server → Client | User joined a group |
| `group_member_left` | Server → Client | User left a group |
| `user_activity` | Server → Client (support staff) | User activity log entry |

**Client rooms**:
- `user:<userId>` — Private notifications and messages
- `group:<groupId>` — Group chat messages
- `support:staff` — Support staff activity feed

---

## Error Response Format

```json
{
  "error": "Human-readable error message",
  "code": "MACHINE_READABLE_CODE"
}
```

Common error codes: `NO_TOKEN`, `TOKEN_EXPIRED`, `INVALID_TOKEN`, `AUTH_FAILED`, `ADMIN_REQUIRED`, `FORBIDDEN`, `RATE_LIMITED`, `SUBSCRIPTION_REQUIRED`, `NO_REFRESH_TOKEN`, `INVALID_REFRESH_TOKEN`, `USER_NOT_FOUND`.
