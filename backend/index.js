// StocksIntels Backend Server
// Rewritten clean version with all routes from original
require('dotenv').config();
const express = require('express');
const http = require('http');
const cors = require('cors');
const cookieParser = require('cookie-parser');
const axios = require('axios');
const bcrypt = require('bcryptjs');
const { Server } = require('socket.io');
const { getAllNews, getNewsSummary, getAggregatedSentiment, KENYAN_STOCKS, STOCK_SYMBOLS } = require('./newsService');
const { generateWeeklyDigestContent, generateDailyBriefContent, generateEarningsContent } = require('./contentGenerator');
const { getBonds, getBondById, getBondSummary, getMarketAccess } = require('./bondsService');
const { getETFs, getETFByTicker, getETFSummary } = require('./etfsService');
const { generateSignals, getSignalForStock, getSignalsSummary, warmFMPCache, ALL_SYMBOLS, searchStocks, mlModel, executeOrder, getPortfolioValue: getOrderPortfolioValue, getAllPositions, updatePositions, getQualityScore, triggerAlert, getEngineHealth, computeBacktestStats, getForwardTestStats, getForwardTestPredictions, resolveAllForwardPredictions, getAuditLog, logAuditEvent, getEngineConfig, updateEngineConfig } = require('./signalService');
const { getStockQuote, getQuotesBatch, getCompanyName } = require('./marketService');
const { pool, testConnection } = require('./db');
const queueService = require('./queueService');
const signalPublisher = require('./signalPublisher');
const { createSignalNotifications } = require('./signalPublisher');
const { sendResetCode, sendOtpEmail, sendVerificationEmail, sendWelcomeEmail, sendPortfolioReportEmail, sendDailySentimentEmail, sendHotNewsEmail, sendPaymentReceiptEmail, sendSubscriptionExpiryReminder, sendSubscriptionExpiredEmail, sendSubscriptionExpiryEmail1, sendSubscriptionExpiryEmail2, sendWeeklyDigestEmail, sendDailyBriefEmail, sendEarningsReportEmail } = require('./mailer');
const emailSequenceService = require('./emailSequenceService');
const cron = require('node-cron');
const {
  getCompanyProfile, getQuote, getIncomeStatement, getBalanceSheet,
  getCashFlowStatement, getKeyMetrics, getDividendHistory, getFinancialReport,
  simfinService, clearCache: clearFinancialCache
} = require('./financialReportsService');
const brokerService = require('./services/brokerService');
const { fetchAnalystData } = require('./analystService');
const fxService = require('./fxService');
const payheroService = require('./payheroService');
const paypalService = require('./paypalService');
const tripleAService = require('./tripleAService');
const indicesService = require('./indicesService');
const { generalLimiter, authLimiter, marketDataLimiter, aiLimiter } = require('./rateLimiter');
const path = require('path');
const helmet = require('helmet');
const { JSDOM } = require('jsdom');
const createDOMPurify = require('dompurify');
const { authenticateToken, requireAdmin, requireOwnership, generateToken, generateRefreshToken, setRefreshCookie, clearRefreshCookie, revokeRefreshTokenByHash } = require('./auth');
const jwt = require('jsonwebtoken');
const multer = require('multer');
const crypto = require('crypto');

const USD_TO_KES_RATE = 130;

const uploadStorage = multer.diskStorage({
  destination: (_req, _file, cb) => cb(null, path.join(__dirname, 'uploads')),
  filename: (_req, file, cb) => {
    const ext = path.extname(file.originalname);
    cb(null, crypto.randomUUID() + ext);
  },
});
const upload = multer({
  storage: uploadStorage,
  limits: { fileSize: 10 * 1024 * 1024 },
  fileFilter: (_req, file, cb) => {
    const allowed = /\.(png|jpg|jpeg|gif|webp|svg|pdf|doc|docx|xlsx|csv|txt|mp4|mov|avi)$/i;
    if (allowed.test(path.extname(file.originalname))) return cb(null, true);
    cb(new Error('File type not allowed'));
  },
});

const app = express();
app.set('trust proxy', 1);
const server = http.createServer(app);

// Support single origin or comma-separated list (e.g. "https://app.netlify.app,http://localhost:5173")
const rawCorsOrigin = process.env.CORS_ORIGIN || "http://localhost:5173";
const allowedOrigins = rawCorsOrigin.split(',').map(o => o.trim()).filter(Boolean);
const corsOrigin = allowedOrigins.length === 1 ? allowedOrigins[0] : allowedOrigins;

const io = new Server(server, {
  cors: { origin: corsOrigin, methods: ["GET", "POST", "PATCH"] }
});

// ── Liveness & Readiness Probes ──────────────────────────────────
// Used by Kubernetes, Docker health checks, and load balancers
app.get('/healthz', async (_req, res) => {
  try {
    const dbResult = await pool.query('SELECT NOW() AS t');
    res.status(200).json({ status: 'ok', db: 'connected', time: dbResult.rows[0].t });
  } catch (e) {
    res.status(200).json({ status: 'ok', db: 'disconnected', error: e.message, code: e.code, detail: `${e}` });
  }
});
app.get('/readyz', async (_req, res) => {
  const checks = {};
  try { await pool.query('SELECT 1'); checks.db = 'ok'; } catch { checks.db = 'fail'; }
  try {
    const modalBridge = require('./modalBridge');
    const st = await modalBridge.health();
    checks.ml = st && st.status === 'ok' ? 'ok' : 'degraded';
  } catch { checks.ml = 'unknown'; }
  const allOk = Object.values(checks).every(v => v === 'ok' || v === 'unknown');
  res.status(allOk ? 200 : 503).json({ status: allOk ? 'ok' : 'degraded', checks, uptime: process.uptime() });
});

// Security headers
app.use(helmet({
  contentSecurityPolicy: {
    directives: {
      defaultSrc: ["'self'"],
      scriptSrc: ["'self'", "'unsafe-inline'", "https://cdn.tailwindcss.com", "https://s3.tradingview.com", "https://*.tradingview.com"],
      scriptSrcAttr: ["'unsafe-inline'"],
      styleSrc: ["'self'", "'unsafe-inline'", "https://cdn.tailwindcss.com", "https://s3.tradingview.com"],
      imgSrc: ["'self'", "data:", "https:", "https://*.tradingview.com"],
      connectSrc: ["'self'", "https:", "wss://*.tradingview.com", "https://*.tradingview.com"],
      frameSrc: ["'self'", "https://*.tradingview.com"],
      workerSrc: ["'self'", "https://*.tradingview.com", "blob:"],
      mediaSrc: ["'self'", "https://*.tradingview.com"],
      fontSrc: ["'self'", "https:", "data:"],
    },
  },
  crossOriginEmbedderPolicy: false,
}));

app.use(cors({
  origin: corsOrigin,
  credentials: true,
  methods: ["GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"],
  allowedHeaders: ["Content-Type", "Authorization", "X-Requested-With"]
}));
app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(cookieParser());
app.use(generalLimiter);
app.use('/api/auth', authLimiter);
app.use('/api/ai', aiLimiter);
app.use('/uploads', express.static(path.join(__dirname, 'uploads')));

// Prevent NoSQL-style operator injection in query parameters
// e.g. ?symbol[$ne]=null makes req.query.symbol an object
app.use((req, res, next) => {
  for (const [key, value] of Object.entries(req.query)) {
    if (value !== null && typeof value === 'object' && !Array.isArray(value)) {
      return res.status(400).json({ error: 'Invalid query parameter format' });
    }
  }
  next();
});

// Structured request logging
const logger = require('./logger');
if (process.env.NODE_ENV !== 'production' || process.env.LOG_REQUESTS) {
  app.use((req, res, next) => {
    const start = Date.now();
    res.on('finish', () => {
      const ms = Date.now() - start;
      logger.info(`${req.method} ${req.originalUrl} ${res.statusCode} ${ms}ms`);
    });
    next();
  });
}

// DOMPurify setup for server-side sanitization
const window = new JSDOM('').window;
const DOMPurify = createDOMPurify(window);
function sanitizeText(text) {
  if (!text || typeof text !== 'string') return '';
  return DOMPurify.sanitize(text, { ALLOWED_TAGS: [], ALLOWED_ATTR: [] });
}

// ── Frontend Static Serving ───────────────────────────────────────
// When the frontend is deployed separately (e.g. Vercel), the backend
// runs in API-only mode and does not try to serve a local dist folder.
const fs = require('fs');
const frontendDist = path.join(__dirname, '..', 'frontend', 'dist');
const serveFrontend = fs.existsSync(frontendDist);
if (serveFrontend) {
  app.use(express.static(frontendDist));
}

// ── Admin API Routes ─────────────────────────────────────────────
// Extra security headers for admin endpoints
app.use('/api/admin', (req, res, next) => {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('X-Frame-Options', 'DENY');
  res.setHeader('Referrer-Policy', 'same-origin');
  res.setHeader('Permissions-Policy', 'camera=(), microphone=(), geolocation=()');
  res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate, proxy-revalidate');
  res.setHeader('Pragma', 'no-cache');
  next();
});
// Admin OTP login routes (no auth required)
app.post('/api/admin/send-otp', async (req, res) => {
  try {
    const { email } = req.body;
    if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return res.status(400).json({ error: 'Valid email required' });
    const ip = getClientIp(req);
    const ua = req.headers['user-agent'] || '';
    const limit = checkLoginRateLimit(email, ip);
    if (limit.blocked) {
      const banSecs = Math.ceil((limit.banExpires - Date.now()) / 1000);
      await logAdminAction(null, email, 'otp_blocked', ip, ua, { reason: 'rate_limit' }, false);
      return res.status(429).json({ error: `Too many attempts. Try again in ${banSecs}s.`, code: 'RATE_LIMITED', banExpires: limit.banExpires });
    }
    const user = await pool.query('SELECT id, role FROM users WHERE email = $1', [email]);
    if (user.rows.length === 0) {
      await logAdminAction(null, email, 'otp_failed', ip, ua, { reason: 'user_not_found' }, false);
      return res.status(401).json({ error: 'No account found with this email' });
    }
    if (user.rows[0].role !== 'admin') {
      await logAdminAction(user.rows[0].id, email, 'otp_denied', ip, ua, { reason: 'not_admin' }, false);
      return res.status(403).json({ error: 'Admin access required.' });
    }
    const code = Math.floor(100000 + Math.random() * 900000).toString();
    const expiresAt = new Date(Date.now() + 10 * 60 * 1000);
    await pool.query('DELETE FROM otp_codes WHERE email = $1 AND type = $2', [email, 'admin_login']);
    await pool.query('INSERT INTO otp_codes (email, code, type, expires_at) VALUES ($1, $2, $3, $4)', [email, code, 'admin_login', expiresAt]);
    console.log(`[OTP] Admin login code for ${email}: ${code}`);
    await sendOtpEmail(email, code).catch(e => console.error('[MAILER] admin send-otp failed:', e.message));
    await logAdminAction(user.rows[0].id, email, 'otp_sent', ip, ua, null, true);
    res.json({ message: 'OTP sent to email', expiresIn: 600 });
  } catch (error) {
    console.error('admin send-otp error:', error.message);
    res.status(500).json({ error: 'Failed to send OTP' });
  }
});

app.post('/api/admin/verify-otp', async (req, res) => {
  try {
    const { email, code } = req.body;
    if (!email || !code) return res.status(400).json({ error: 'Email and code required' });
    const ip = getClientIp(req);
    const ua = req.headers['user-agent'] || '';
    const result = await pool.query(
      'SELECT * FROM otp_codes WHERE email = $1 AND code = $2 AND type = $3 AND used = FALSE AND expires_at > NOW()',
      [email, code, 'admin_login']
    );
    if (result.rows.length === 0) {
      await logAdminAction(null, email, 'otp_verify_failed', ip, ua, { reason: 'invalid_or_expired' }, false);
      return res.status(401).json({ error: 'Invalid or expired OTP' });
    }
    await pool.query('UPDATE otp_codes SET used = TRUE WHERE id = $1', [result.rows[0].id]);
    const userResult = await pool.query(
      'SELECT id, full_name, email, role, is_verified, created_at, subscription_tier, subscription_status, trial_start_date, subscription_end_date FROM users WHERE email = $1',
      [email]
    );
    if (userResult.rows.length === 0 || userResult.rows[0].role !== 'admin') {
      return res.status(403).json({ error: 'Admin access required.' });
    }
    const user = userResult.rows[0];
    const token = jwt.sign({ userId: user.id }, process.env.JWT_SECRET, { expiresIn: '24h', algorithm: 'HS256' });
    await logAdminAction(user.id, email, 'login_success', ip, ua, null, true);
    loginAttempts.delete(email.toLowerCase());
    res.json({ user, token });
  } catch (error) {
    console.error('admin verify-otp error:', error.message);
    res.status(500).json({ error: 'OTP verification failed' });
  }
});

// All admin routes require authentication + admin role
app.use('/api/admin', authenticateToken, requireAdmin);

app.get('/api/admin/dashboard', async (req, res) => {
  try {
    const [totalUsers, newToday, totalTrades, activeSubs, chatCount, recentReg, totalSubs, totalTickets, totalGroups, totalMessages, totalBrokerConns, totalPortSnaps, signalPredictions, signalHistory, signalTotal] = await Promise.all([
      pool.query('SELECT COUNT(*)::int as cnt FROM users'),
      pool.query("SELECT COUNT(*)::int as cnt FROM users WHERE created_at >= CURRENT_DATE"),
      pool.query('SELECT COUNT(*)::int as cnt FROM paper_trades'),
      pool.query("SELECT COUNT(*)::int as cnt FROM users WHERE subscription_status = 'active'"),
      pool.query('SELECT COUNT(*)::int as cnt FROM support_chat_messages'),
      pool.query('SELECT id, full_name, email, is_verified, created_at FROM users ORDER BY created_at DESC LIMIT 10'),
      pool.query(`SELECT COUNT(*)::int as cnt FROM (
        SELECT id FROM subscriptions
        UNION ALL
        SELECT u.id FROM users u
        WHERE u.subscription_status = 'active' AND u.subscription_tier != 'free'
          AND NOT EXISTS (SELECT 1 FROM subscriptions s WHERE s.user_id = u.id)
      ) combined`),
      pool.query('SELECT COUNT(*)::int as cnt FROM support_tickets'),
      pool.query('SELECT COUNT(*)::int as cnt FROM trading_groups'),
      pool.query('SELECT COUNT(*)::int as cnt FROM messages'),
      pool.query('SELECT COUNT(*)::int as cnt FROM broker_connections'),
      pool.query('SELECT COUNT(*)::int as cnt FROM portfolio_value_history'),
      pool.query(`SELECT COUNT(*)::int as total,
        COALESCE(SUM(CASE WHEN result = 'win' THEN 1 ELSE 0 END), 0)::int as wins,
        COALESCE(SUM(CASE WHEN result = 'loss' THEN 1 ELSE 0 END), 0)::int as losses
        FROM signal_outcomes`),
      pool.query('SELECT COUNT(*)::int as cnt FROM signal_history'),
      pool.query('SELECT COUNT(*)::int as cnt FROM signal_outcomes'),
    ]);
    const paperAccts = await pool.query('SELECT COALESCE(SUM(cash_balance),0) as kes, COALESCE(SUM(cash_balance_usd),0) as usd FROM paper_accounts');
    const fx = await getFxRate();
    const totalPortfolioValue = parseFloat(paperAccts.rows[0].kes) + parseFloat(paperAccts.rows[0].usd) * fx;
    res.json({
      totalUsers: totalUsers.rows[0].cnt,
      newToday: newToday.rows[0].cnt,
      totalTrades: totalTrades.rows[0].cnt,
      activeSubscriptions: activeSubs.rows[0].cnt,
      totalPortfolioValue: Math.round(totalPortfolioValue * 100) / 100,
      totalChatMessages: chatCount.rows[0].cnt,
      recentRegistrations: recentReg.rows,
      totalSubscriptions: totalSubs.rows[0].cnt,
      totalTickets: totalTickets.rows[0].cnt,
      totalGroups: totalGroups.rows[0].cnt,
      totalMessages: totalMessages.rows[0].cnt,
      totalBrokerConnections: totalBrokerConns.rows[0].cnt,
      totalPortfolioSnapshots: totalPortSnaps.rows[0].cnt,
      totalPredictions: signalPredictions.rows[0].total,
      wins: signalPredictions.rows[0].wins,
      losses: signalPredictions.rows[0].losses,
      totalSignals: signalHistory.rows[0].cnt,
    });
  } catch (err) { console.error('Admin dashboard error:', err.message); res.status(500).json({ error: 'An unexpected error occurred' }); }
});

app.get('/api/admin/users', async (req, res) => {
  try {
    const page = Math.max(1, parseInt(req.query.page) || 1);
    const limit = Math.min(100, Math.max(1, parseInt(req.query.limit) || 20));
    const search = (req.query.search || '').trim();
    const offset = (page - 1) * limit;
    let whereClause = '';
    const params = [];
    if (search) {
      whereClause = 'WHERE (u.full_name ILIKE $1 OR u.email ILIKE $1)';
      params.push(`%${search}%`);
    }
    const countResult = await pool.query(`SELECT COUNT(*)::int as cnt FROM users u ${whereClause}`, params);
    const total = countResult.rows[0].cnt;
    const userParams = [...params, limit, offset];
    const userResult = await pool.query(`
      SELECT u.id, u.full_name, u.email, u.role, u.trader_type, u.is_verified, u.created_at,
             u.subscription_tier, u.subscription_status,
             COALESCE(pa.cash_balance,0) as cash_balance,
             COALESCE(pt.trades_count,0) as trades_count,
             COALESCE(ph.holdings_count,0) as holdings_count,
             COALESCE(wl.watchlist_count,0) as watchlist_count
      FROM users u
      LEFT JOIN paper_accounts pa ON pa.user_id = u.id
      LEFT JOIN (SELECT user_id, COUNT(*)::int as trades_count FROM paper_trades GROUP BY user_id) pt ON pt.user_id = u.id
      LEFT JOIN (SELECT user_id, COUNT(*)::int as holdings_count FROM portfolio_holdings GROUP BY user_id) ph ON ph.user_id = u.id
      LEFT JOIN (SELECT user_id, COUNT(*)::int as watchlist_count FROM watchlist_items GROUP BY user_id) wl ON wl.user_id = u.id
      ${whereClause}
      ORDER BY u.created_at DESC
      LIMIT $${params.length + 1} OFFSET $${params.length + 2}
    `, userParams);
    res.json({ users: userResult.rows, total, page, limit });
  } catch (err) { console.error('Admin users error:', err.message); res.status(500).json({ error: 'An unexpected error occurred' }); }
});

app.get('/api/admin/users/:id', async (req, res) => {
  try {
    const { id } = req.params;
    const [userRes, accountRes, tradesRes, holdingsRes, chatRes, notifRes, subRes] = await Promise.all([
      pool.query('SELECT * FROM users WHERE id = $1', [id]),
      pool.query('SELECT * FROM paper_accounts WHERE user_id = $1', [id]),
      pool.query('SELECT * FROM paper_trades WHERE user_id = $1 ORDER BY created_at DESC LIMIT 20', [id]),
      pool.query('SELECT * FROM portfolio_holdings WHERE user_id = $1 ORDER BY ticker', [id]),
      pool.query("SELECT * FROM support_chat_messages WHERE user_id = $1 ORDER BY created_at DESC LIMIT 20", [id]),
      pool.query('SELECT COUNT(*)::int as cnt FROM notifications WHERE user_id = $1', [id]),
      pool.query('SELECT * FROM subscriptions WHERE user_id = $1 ORDER BY created_at DESC LIMIT 1', [id]),
    ]);
    if (userRes.rows.length === 0) return res.status(404).json({ error: 'User not found' });
    res.json({
      user: userRes.rows[0],
      paperAccount: accountRes.rows[0] || null,
      recentTrades: tradesRes.rows,
      portfolioHoldings: holdingsRes.rows,
      supportMessages: chatRes.rows,
      notificationsCount: notifRes.rows[0].cnt,
      subscription: subRes.rows[0] || null,
    });
  } catch (err) { console.error('Admin user detail error:', err.message); res.status(500).json({ error: 'An unexpected error occurred' }); }
});

app.post('/api/admin/users/:id/role', async (req, res) => {
  try {
    const { id } = req.params;
    const { role } = req.body;
    if (!role || !['admin', 'trader'].includes(role)) return res.status(400).json({ error: 'Role must be "admin" or "trader"' });
    const result = await pool.query('UPDATE users SET role = $1 WHERE id = $2 RETURNING id, full_name, email, role, trader_type, is_verified', [role, id]);
    if (result.rows.length === 0) return res.status(404).json({ error: 'User not found' });
    res.json(result.rows[0]);
  } catch (err) { console.error('Admin set role error:', err.message); res.status(500).json({ error: 'An unexpected error occurred' }); }
});

app.put('/api/admin/users/:id/toggle-verify', async (req, res) => {
  try {
    const { id } = req.params;
    const result = await pool.query('UPDATE users SET is_verified = NOT is_verified WHERE id = $1 RETURNING id, full_name, email, role, is_verified', [id]);
    if (result.rows.length === 0) return res.status(404).json({ error: 'User not found' });
    res.json(result.rows[0]);
  } catch (err) { console.error('Admin toggle verify error:', err.message); res.status(500).json({ error: 'An unexpected error occurred' }); }
});

// ── Admin Signals API ──
app.get('/api/admin/signals/stats', async (req, res) => {
  try {
    const [total, bySignal, bySector, latest, tickerCount] = await Promise.all([
      pool.query('SELECT COUNT(*)::int as cnt FROM signal_history'),
      pool.query('SELECT signal, COUNT(*)::int as cnt FROM signal_history GROUP BY signal ORDER BY cnt DESC'),
      pool.query('SELECT sector, COUNT(*)::int as cnt FROM signal_history WHERE sector IS NOT NULL GROUP BY sector ORDER BY cnt DESC LIMIT 20'),
      pool.query('SELECT MAX(generated_at) as last_generated FROM signal_history'),
      pool.query('SELECT COUNT(DISTINCT ticker)::int as cnt FROM signal_history'),
    ]);
    res.json({
      totalSignals: total.rows[0].cnt,
      distinctTickers: tickerCount.rows[0].cnt,
      bySignal: bySignal.rows,
      bySector: bySector.rows,
      lastGenerated: latest.rows[0].last_generated,
    });
  } catch (err) { console.error('Admin signals stats error:', err.message); res.status(500).json({ error: 'An unexpected error occurred' }); }
});

app.get('/api/admin/signals', async (req, res) => {
  try {
    const page = Math.max(1, parseInt(req.query.page) || 1);
    const limit = Math.min(200, Math.max(1, parseInt(req.query.limit) || 50));
    const ticker = (req.query.ticker || '').trim().toUpperCase();
    const signal = (req.query.signal || '').trim();
    const sector = (req.query.sector || '').trim();
    const market = (req.query.market || '').trim().toUpperCase();
    const dateFrom = req.query.dateFrom || '';
    const dateTo = req.query.dateTo || '';
    const offset = (page - 1) * limit;
    const conditions = [];
    const params = [];
    let idx = 1;
    if (ticker) { conditions.push(`ticker = $${idx++}`); params.push(ticker); }
    if (signal) { conditions.push(`signal = $${idx++}`); params.push(signal); }
    if (sector) { conditions.push(`sector ILIKE $${idx++}`); params.push(`%${sector}%`); }
    if (market) { conditions.push(`market = $${idx++}`); params.push(market); }
    if (dateFrom) { conditions.push(`generated_at >= $${idx++}::date`); params.push(dateFrom); }
    if (dateTo) { conditions.push(`generated_at <= $${idx++}::date + interval '1 day'`); params.push(dateTo); }
    const whereClause = conditions.length > 0 ? 'WHERE ' + conditions.join(' AND ') : '';
    const countResult = await pool.query(`SELECT COUNT(*)::int as cnt FROM signal_history ${whereClause}`, params);
    const dataParams = [...params, limit, offset];
    const dataResult = await pool.query(`
      SELECT id, ticker, signal, confidence, price, change_pct, entry_price, stop_loss,
             target1, target2, risk_reward, sector, market, currency, trade_type, timeframe, reason, generated_at
      FROM signal_history ${whereClause}
      ORDER BY generated_at DESC
      LIMIT $${idx++} OFFSET $${idx}
    `, dataParams);
    res.json({ signals: dataResult.rows, total: countResult.rows[0].cnt, page, limit });
  } catch (err) { console.error('Admin signals error:', err.message); res.status(500).json({ error: 'An unexpected error occurred' }); }
});

// ── Admin Signal Detail ──
app.get('/api/admin/signals/:id', async (req, res) => {
  try {
    const { id } = req.params;
    const result = await pool.query('SELECT * FROM signal_history WHERE id = $1', [id]);
    if (result.rows.length === 0) return res.status(404).json({ error: 'Signal not found' });
    res.json(result.rows[0]);
  } catch (err) { console.error('Admin signal detail error:', err.message); res.status(500).json({ error: 'An unexpected error occurred' }); }
});

// ── Admin Signal Update ──
app.put('/api/admin/signals/:id', async (req, res) => {
  try {
    const { id } = req.params;
    const { signal, confidence, entry_price, stop_loss, target1, target2, risk_reward, timeframe } = req.body;
    const fields = []; const params = []; let idx = 1;
    if (signal !== undefined) { fields.push(`signal = $${idx++}`); params.push(signal); }
    if (confidence !== undefined) { fields.push(`confidence = $${idx++}`); params.push(confidence); }
    if (entry_price !== undefined) { fields.push(`entry_price = $${idx++}`); params.push(entry_price); }
    if (stop_loss !== undefined) { fields.push(`stop_loss = $${idx++}`); params.push(stop_loss); }
    if (target1 !== undefined) { fields.push(`target1 = $${idx++}`); params.push(target1); }
    if (target2 !== undefined) { fields.push(`target2 = $${idx++}`); params.push(target2); }
    if (risk_reward !== undefined) { fields.push(`risk_reward = $${idx++}`); params.push(risk_reward); }
    if (timeframe !== undefined) { fields.push(`timeframe = $${idx++}`); params.push(timeframe); }
    if (fields.length === 0) return res.status(400).json({ error: 'No fields to update' });
    params.push(id);
    const result = await pool.query(`UPDATE signal_history SET ${fields.join(', ')} WHERE id = $${idx} RETURNING *`, params);
    if (result.rows.length === 0) return res.status(404).json({ error: 'Signal not found' });
    res.json(result.rows[0]);
  } catch (err) { console.error('Admin signal update error:', err.message); res.status(500).json({ error: 'An unexpected error occurred' }); }
});

// ── Admin Signal Delete ──
app.delete('/api/admin/signals/:id', async (req, res) => {
  try {
    const { id } = req.params;
    const result = await pool.query('DELETE FROM signal_history WHERE id = $1 RETURNING id', [id]);
    if (result.rows.length === 0) return res.status(404).json({ error: 'Signal not found' });
    res.json({ success: true });
  } catch (err) { console.error('Admin signal delete error:', err.message); res.status(500).json({ error: 'An unexpected error occurred' }); }
});

// ── Admin Generate Signals ──
app.post('/api/admin/signals/generate', async (req, res) => {
  try {
    const { force } = req.body || {};
    const marketData = await getQuotesBatch(ALL_SYMBOLS).catch((e) => { console.error('[Admin] getQuotesBatch failed:', e.message); return {}; });
    console.log(`[Admin] Generate signals: received ${Object.keys(marketData).length} live quotes`);
    const liveMarketData = {};
    for (const [symbol, quote] of Object.entries(marketData)) {
      const ticker = symbol.replace('NSE:', '');
      liveMarketData[ticker] = {
        price: quote.price,
        changePercent: quote.changePercent,
        volume: quote.volume,
      };
    }
    // If live quotes are unavailable, fall back to force-generating from cached/fundamental data
    const hasLiveData = Object.keys(liveMarketData).length > 0;
    const signals = hasLiveData
      ? await generateSignals(liveMarketData, false, !!force)
      : await generateSignals(null, false, true);

    // Publish via Redis if available
    if (signals.length > 0) {
      await queueService.publishBatchSignalUpdate(signals);
      const notifications = await createSignalNotifications(signals);
      if (notifications.length > 0) {
        await queueService.publishSignalNotifications(notifications);
      }
    }

    const historyCount = await pool.query('SELECT COUNT(*)::int as cnt FROM signal_history').catch(() => ({ rows: [{ cnt: 0 }] }));
    res.json({ success: true, count: signals.length, notifications: signals.length > 0, source: hasLiveData ? 'live_quotes' : 'force_cached', signalHistoryRows: historyCount.rows[0].cnt });
  } catch (err) { console.error('Admin generate signals error:', err.message); res.status(500).json({ error: 'An unexpected error occurred' }); }
});

// ── Admin Subscribers ──
app.get('/api/admin/subscribers', async (req, res) => {
  try {
    const plansResult = await pool.query(`
      SELECT sp.id, sp.name, sp.price_kes, sp.price_usd, sp.duration_months,
        COALESCE((SELECT COUNT(*)::int FROM subscriptions s WHERE s.plan_id = sp.id), 0) +
        COALESCE((SELECT COUNT(*)::int FROM users u WHERE u.subscription_status = 'active' AND LOWER(u.subscription_tier) = LOWER(sp.name)), 0) as subscriber_count
      FROM subscription_plans sp ORDER BY sp.id
    `);
    const totalResult = await pool.query(`
      SELECT COUNT(*)::int as cnt FROM (
        SELECT id FROM subscriptions WHERE status IN ('active', 'pending')
        UNION ALL
        SELECT id FROM users WHERE subscription_status = 'active' AND subscription_tier != 'free'
      ) combined
    `);
    res.json({ plans: plansResult.rows, totalSubscribers: totalResult.rows[0].cnt });
  } catch (err) { console.error('Admin subscribers error:', err.message); res.status(500).json({ error: 'An unexpected error occurred' }); }
});

app.get('/api/admin/subscriptions', async (req, res) => {
  try {
    const page = Math.max(1, parseInt(req.query.page) || 1);
    const limit = Math.min(100, Math.max(1, parseInt(req.query.limit) || 20));
    const offset = (page - 1) * limit;
    // Count: subscriptions table + users with active non-free subscription not in subscriptions
    const countResult = await pool.query(`
      SELECT COUNT(*)::int as cnt FROM (
        SELECT id FROM subscriptions
        UNION ALL
        SELECT u.id FROM users u
        WHERE u.subscription_status = 'active' AND u.subscription_tier != 'free'
          AND NOT EXISTS (SELECT 1 FROM subscriptions s WHERE s.user_id = u.id)
      ) combined
    `);
    const dataResult = await pool.query(`
      SELECT * FROM (
        SELECT s.id, s.user_id, s.plan_id, s.status, s.start_date, s.end_date, s.created_at, s.updated_at,
               u.full_name, u.email, sp.name as plan_name, sp.price_kes as amount, sp.duration_months
        FROM subscriptions s
        JOIN users u ON u.id = s.user_id
        JOIN subscription_plans sp ON sp.id = s.plan_id
        UNION ALL
        SELECT (-u.id)::int as id, u.id as user_id, NULL::int as plan_id,
               u.subscription_status as status, u.created_at as start_date,
               u.subscription_end_date as end_date,
               u.created_at, u.updated_at,
               u.full_name, u.email,
               COALESCE(sp.name, u.subscription_tier) as plan_name, sp.price_kes as amount, sp.duration_months
        FROM users u
        LEFT JOIN subscription_plans sp ON LOWER(sp.name) = LOWER(u.subscription_tier)
        WHERE u.subscription_status = 'active' AND u.subscription_tier != 'free'
          AND NOT EXISTS (SELECT 1 FROM subscriptions s WHERE s.user_id = u.id)
      ) combined
      ORDER BY created_at DESC LIMIT $1 OFFSET $2
    `, [limit, offset]);
    res.json({ subscriptions: dataResult.rows, total: countResult.rows[0].cnt, page, limit });
  } catch (err) { console.error('Admin subscriptions error:', err.message); res.status(500).json({ error: 'An unexpected error occurred' }); }
});

// ── Admin Portfolio History ──
app.get('/api/admin/portfolio-history', async (req, res) => {
  try {
    const page = Math.max(1, parseInt(req.query.page) || 1);
    const limit = Math.min(100, Math.max(1, parseInt(req.query.limit) || 20));
    const offset = (page - 1) * limit;
    const countResult = await pool.query('SELECT COUNT(*)::int as cnt FROM portfolio_value_history');
    const dataResult = await pool.query(`
      SELECT p.*, u.full_name, u.email
      FROM portfolio_value_history p
      JOIN users u ON u.id = p.user_id
      ORDER BY p.snapshot_date DESC LIMIT $1 OFFSET $2
    `, [limit, offset]);
    res.json({ history: dataResult.rows, total: countResult.rows[0].cnt, page, limit });
  } catch (err) { console.error('Admin portfolio-history error:', err.message); res.status(500).json({ error: 'An unexpected error occurred' }); }
});

// ── Admin Payments ──
app.get('/api/admin/payments', async (req, res) => {
  try {
    const page = Math.max(1, parseInt(req.query.page) || 1);
    const limit = Math.min(100, Math.max(1, parseInt(req.query.limit) || 20));
    const offset = (page - 1) * limit;
    const countResult = await pool.query('SELECT COUNT(*)::int as cnt FROM payment_transactions');
    const dataResult = await pool.query(`
      SELECT p.*, u.full_name, u.email
      FROM payment_transactions p
      LEFT JOIN users u ON u.id = p.user_id
      ORDER BY p.created_at DESC LIMIT $1 OFFSET $2
    `, [limit, offset]);
    res.json({ transactions: dataResult.rows, total: countResult.rows[0].cnt, page, limit });
  } catch (err) { console.error('Admin payments error:', err.message); res.status(500).json({ error: 'An unexpected error occurred' }); }
});

// ── Admin Support Tickets ──
app.get('/api/admin/support-tickets', async (req, res) => {
  try {
    const page = Math.max(1, parseInt(req.query.page) || 1);
    const limit = Math.min(100, Math.max(1, parseInt(req.query.limit) || 20));
    const offset = (page - 1) * limit;
    const countResult = await pool.query('SELECT COUNT(*)::int as cnt FROM support_tickets');
    const dataResult = await pool.query(`
      SELECT t.*, (SELECT COUNT(*)::int FROM support_messages sm WHERE sm.ticket_id = t.id) as message_count
      FROM support_tickets t
      ORDER BY t.created_at DESC LIMIT $1 OFFSET $2
    `, [limit, offset]);
    const statusCounts = await pool.query(`
      SELECT status, COUNT(*)::int as cnt FROM support_tickets GROUP BY status
    `);
    const counts = { open: 0, in_progress: 0, resolved: 0, closed: 0 };
    statusCounts.rows.forEach(r => { if (counts[r.status] !== undefined) counts[r.status] = r.cnt; });
    res.json({ tickets: dataResult.rows, total: countResult.rows[0].cnt, page, limit, statusCounts: counts });
  } catch (err) { console.error('Admin tickets error:', err.message); res.status(500).json({ error: 'An unexpected error occurred' }); }
});

// ── Admin Groups ──
app.get('/api/admin/groups', async (req, res) => {
  try {
    const dataResult = await pool.query(`
      SELECT g.*,
        (SELECT COUNT(*)::int FROM group_members gm WHERE gm.group_id = g.id) as member_count,
        (SELECT COUNT(*)::int FROM messages m WHERE m.group_id = g.id) as message_count
      FROM trading_groups g ORDER BY g.name
    `);
    res.json({ groups: dataResult.rows });
  } catch (err) { console.error('Admin groups error:', err.message); res.status(500).json({ error: 'An unexpected error occurred' }); }
});

// ── Admin Messages ──
app.get('/api/admin/messages', async (req, res) => {
  try {
    const page = Math.max(1, parseInt(req.query.page) || 1);
    const limit = Math.min(500, Math.max(1, parseInt(req.query.limit) || 50));
    const groupId = req.query.groupId ? parseInt(req.query.groupId) : null;
    const offset = (page - 1) * limit;
    let whereClause = '';
    const params = [];
    if (groupId) {
      whereClause = 'WHERE m.group_id = $1';
      params.push(groupId);
    }
    const countResult = await pool.query(`SELECT COUNT(*)::int as cnt FROM messages m ${whereClause}`, params);
    const dataParams = [...params, limit, offset];
    const idx = params.length + 1;
    const dataResult = await pool.query(`
      SELECT m.*, u.full_name as sender_full_name
      FROM messages m
      LEFT JOIN users u ON u.id = m.sender_id
      ${whereClause}
      ORDER BY m.created_at DESC LIMIT $${idx} OFFSET $${idx + 1}
    `, dataParams);
    res.json({ messages: dataResult.rows, total: countResult.rows[0].cnt, page, limit });
  } catch (err) { console.error('Admin messages error:', err.message); res.status(500).json({ error: 'An unexpected error occurred' }); }
});

// ── Admin Broker Accounts ──
app.get('/api/admin/broker-accounts', async (req, res) => {
  try {
    const dataResult = await pool.query(`
      SELECT bc.*, u.full_name, u.email,
        (SELECT balance FROM broker_account_snapshots WHERE broker_connection_id = bc.id ORDER BY snapshot_at DESC LIMIT 1) as latest_balance,
        (SELECT equity FROM broker_account_snapshots WHERE broker_connection_id = bc.id ORDER BY snapshot_at DESC LIMIT 1) as latest_equity
      FROM broker_connections bc
      JOIN users u ON u.id = bc.user_id
      ORDER BY bc.created_at DESC
    `);
    res.json({ connections: dataResult.rows });
  } catch (err) { console.error('Admin broker-accounts error:', err.message); res.status(500).json({ error: 'An unexpected error occurred' }); }
});

// ── Admin User Activity ──
app.get('/api/admin/activity/recent', async (req, res) => {
  try {
    const limit = Math.min(parseInt(req.query.limit) || 50, 200);
    const offset = parseInt(req.query.offset) || 0;
    const action = req.query.action;
    let where = '';
    const params = [];
    if (action) { where = 'WHERE action = $1'; params.push(action); }
    const countResult = await pool.query(`SELECT COUNT(*)::int as cnt FROM user_activity_log ${where}`, params);
    const dataParams = [...params, limit, offset];
    const idx = params.length + 1;
    const dataResult = await pool.query(
      `SELECT * FROM user_activity_log ${where} ORDER BY created_at DESC LIMIT $${idx} OFFSET $${idx + 1}`,
      dataParams
    );
    res.json({ activities: dataResult.rows, total: countResult.rows[0].cnt });
  } catch (err) { console.error('Admin activity error:', err.message); res.status(500).json({ error: 'An unexpected error occurred' }); }
});

// ── Admin Followers ──
app.get('/api/admin/followers', async (req, res) => {
  try {
    const dataResult = await pool.query(`
      SELECT f.follower_id, fu.full_name as follower_name, f.followee_id, eu.full_name as followee_name, f.created_at
      FROM followers f
      JOIN users fu ON fu.id = f.follower_id
      JOIN users eu ON eu.id = f.followee_id
      ORDER BY f.created_at DESC
    `);
    res.json({ followers: dataResult.rows });
  } catch (err) { console.error('Admin followers error:', err.message); res.status(500).json({ error: 'An unexpected error occurred' }); }
});

// ── Admin User Update ──
app.put('/api/admin/users/:id', async (req, res) => {
  try {
    const { id } = req.params;
    const { full_name, email, trader_type, subscription_tier } = req.body;
    const fields = []; const params = []; let idx = 1;
    if (full_name !== undefined) { fields.push(`full_name = $${idx++}`); params.push(full_name); }
    if (email !== undefined) { fields.push(`email = $${idx++}`); params.push(email); }
    if (trader_type !== undefined) { fields.push(`trader_type = $${idx++}`); params.push(trader_type); }
    if (subscription_tier !== undefined) { fields.push(`subscription_tier = $${idx++}`); params.push(subscription_tier); }
    if (fields.length === 0) return res.status(400).json({ error: 'No fields to update' });
    params.push(id);
    const result = await pool.query(`UPDATE users SET ${fields.join(', ')} WHERE id = $${idx} RETURNING *`, params);
    if (result.rows.length === 0) return res.status(404).json({ error: 'User not found' });
    res.json(result.rows[0]);
  } catch (err) { console.error('Admin update user error:', err.message); res.status(500).json({ error: 'An unexpected error occurred' }); }
});

// ── Admin Delete User ──
app.delete('/api/admin/users/:id', async (req, res) => {
  try {
    const { id } = req.params;
    await pool.query('DELETE FROM paper_accounts WHERE user_id = $1', [id]);
    await pool.query('DELETE FROM paper_trades WHERE user_id = $1', [id]);
    await pool.query('DELETE FROM paper_positions WHERE user_id = $1', [id]);
    await pool.query('DELETE FROM portfolio_holdings WHERE user_id = $1', [id]);
    await pool.query('DELETE FROM portfolio_value_history WHERE user_id = $1', [id]);
    await pool.query('DELETE FROM notifications WHERE user_id = $1', [id]);
    await pool.query('DELETE FROM broker_connections WHERE user_id = $1', [id]);
    await pool.query('DELETE FROM subscriptions WHERE user_id = $1', [id]);
    await pool.query('DELETE FROM support_chat_messages WHERE user_id = $1', [id]);
    await pool.query('DELETE FROM group_members WHERE user_id = $1', [id]);
    await pool.query('DELETE FROM followers WHERE follower_id = $1 OR followee_id = $1', [id]);
    await pool.query('DELETE FROM messages WHERE sender_id = $1 OR recipient_id = $1', [id]);
    await pool.query('DELETE FROM payment_transactions WHERE user_id = $1', [id]);
    const result = await pool.query('DELETE FROM users WHERE id = $1 RETURNING id', [id]);
    if (result.rows.length === 0) return res.status(404).json({ error: 'User not found' });
    res.json({ success: true });
  } catch (err) { console.error('Admin delete user error:', err.message); res.status(500).json({ error: 'An unexpected error occurred' }); }
});

// ── Admin Reset Password ──
app.post('/api/admin/users/:id/reset-password', async (req, res) => {
  try {
    const { id } = req.params;
    const user = await pool.query('SELECT id, email FROM users WHERE id = $1', [id]);
    if (user.rows.length === 0) return res.status(404).json({ error: 'User not found' });
    const { email } = user.rows[0];
    const code = Math.floor(100000 + Math.random() * 900000).toString();
    const expiresAt = new Date(Date.now() + 15 * 60 * 1000);
    await pool.query('DELETE FROM otp_codes WHERE email = $1 AND type = $2', [email, 'password_reset']);
    await pool.query('INSERT INTO otp_codes (email, code, type, expires_at) VALUES ($1, $2, $3, $4)', [email, code, 'password_reset', expiresAt]);
    console.log(`[OTP] Admin password reset code for ${email}: ${code}`);
    await sendResetCode(email, code).catch(e => console.error('[MAILER] admin reset-password failed:', e.message));
    res.json({ message: 'Password reset email sent' });
  } catch (err) { console.error('Admin reset password error:', err.message); res.status(500).json({ error: 'An unexpected error occurred' }); }
});

// ── Admin Subscription Plans CRUD ──
app.get('/api/admin/subscription-plans', async (req, res) => {
  try {
    const result = await pool.query(`
      SELECT sp.*, (SELECT COUNT(*)::int FROM subscriptions s WHERE s.plan_id = sp.id) as subscriber_count
      FROM subscription_plans sp ORDER BY sp.id
    `);
    res.json({ plans: result.rows });
  } catch (err) { console.error('Admin subscription-plans error:', err.message); res.status(500).json({ error: 'An unexpected error occurred' }); }
});

app.post('/api/admin/subscription-plans', async (req, res) => {
  try {
    const { name, description, price_kes, price_usd, features, duration_months } = req.body;
    if (!name || price_kes === undefined) return res.status(400).json({ error: 'Name and price_kes required' });
    const result = await pool.query(
      'INSERT INTO subscription_plans (name, description, price_kes, price_usd, features, duration_months) VALUES ($1, $2, $3, $4, $5::jsonb, $6) RETURNING *',
      [name, description || '', price_kes, price_usd || 0, features ? JSON.stringify(features) : '[]', duration_months || 1]
    );
    res.status(201).json(result.rows[0]);
  } catch (err) { console.error('Admin create plan error:', err.message); res.status(500).json({ error: 'An unexpected error occurred' }); }
});

app.put('/api/admin/subscription-plans/:id', async (req, res) => {
  try {
    const { id } = req.params;
    const { name, description, price_kes, price_usd, features, duration_months } = req.body;
    const fields = []; const params = []; let idx = 1;
    if (name !== undefined) { fields.push(`name = $${idx++}`); params.push(name); }
    if (description !== undefined) { fields.push(`description = $${idx++}`); params.push(description); }
    if (price_kes !== undefined) { fields.push(`price_kes = $${idx++}`); params.push(price_kes); }
    if (price_usd !== undefined) { fields.push(`price_usd = $${idx++}`); params.push(price_usd); }
    if (features !== undefined) { fields.push(`features = $${idx++}`); params.push(JSON.stringify(features)); }
    if (duration_months !== undefined) { fields.push(`duration_months = $${idx++}`); params.push(duration_months); }
    if (fields.length === 0) return res.status(400).json({ error: 'No fields to update' });
    params.push(id);
    const result = await pool.query(`UPDATE subscription_plans SET ${fields.join(', ')} WHERE id = $${idx} RETURNING *`, params);
    if (result.rows.length === 0) return res.status(404).json({ error: 'Plan not found' });
    res.json(result.rows[0]);
  } catch (err) { console.error('Admin update plan error:', err.message); res.status(500).json({ error: 'An unexpected error occurred' }); }
});

app.delete('/api/admin/subscription-plans/:id', async (req, res) => {
  try {
    const { id } = req.params;
    const result = await pool.query('DELETE FROM subscription_plans WHERE id = $1 RETURNING id', [id]);
    if (result.rows.length === 0) return res.status(404).json({ error: 'Plan not found' });
    res.json({ success: true });
  } catch (err) { console.error('Admin delete plan error:', err.message); res.status(500).json({ error: 'An unexpected error occurred' }); }
});

// ── Admin Subscription Management ──
app.put('/api/admin/subscriptions/:id', async (req, res) => {
  try {
    const { id } = req.params;
    const { status, start_date, end_date, duration_months } = req.body;
    const idNum = parseInt(id);
    // Negative id means it's a virtual subscription from the users table
    if (idNum < 0) {
      const userId = -idNum;
      const fields = []; const params = []; let idx = 1;
      if (status && ['active', 'cancelled', 'expired', 'pending'].includes(status)) {
        fields.push(`subscription_status = $${idx++}`); params.push(status);
      }
      if (start_date !== undefined) { fields.push(`subscription_start_date = $${idx++}`); params.push(start_date); }
      if (end_date !== undefined) { fields.push(`subscription_end_date = $${idx++}`); params.push(end_date); }
      if (duration_months !== undefined) { fields.push(`subscription_tier = CONCAT(subscription_tier, '')`); /* no-op for virtual */ }
      if (fields.length === 0) return res.status(400).json({ error: 'No fields to update' });
      params.push(userId);
      const result = await pool.query(
        `UPDATE users SET ${fields.join(', ')} WHERE id = $${idx} RETURNING id, subscription_status, subscription_tier, subscription_start_date, subscription_end_date, commitment_fee_paid`,
        params
      );
      if (result.rows.length === 0) return res.status(404).json({ error: 'User not found' });
      return res.json(result.rows[0]);
    }
    // Real subscription record
    const fields = []; const params = []; let idx = 1;
    if (status && ['active', 'cancelled', 'expired', 'pending'].includes(status)) {
      fields.push(`status = $${idx++}`); params.push(status);
    }
    if (start_date !== undefined) { fields.push(`start_date = $${idx++}`); params.push(start_date); }
    if (end_date !== undefined) { fields.push(`end_date = $${idx++}`); params.push(end_date); }
    if (duration_months !== undefined) {
      fields.push(`end_date = start_date + interval '1 month' * $${idx}`);
      params.push(duration_months);
      idx++;
    }
    fields.push(`updated_at = CURRENT_TIMESTAMP`);
    if (fields.length === 0) return res.status(400).json({ error: 'No fields to update' });
    params.push(id);
    const result = await pool.query(
      `UPDATE subscriptions SET ${fields.join(', ')} WHERE id = $${idx} RETURNING *`,
      params
    );
    if (result.rows.length === 0) return res.status(404).json({ error: 'Subscription not found' });
    res.json(result.rows[0]);
  } catch (err) { console.error('Admin update subscription error:', err.message); res.status(500).json({ error: 'An unexpected error occurred' }); }
});

// ── Admin Support Tickets Update ──
app.put('/api/admin/support-tickets/:id', async (req, res) => {
  try {
    const { id } = req.params;
    const { status, priority } = req.body;
    const validStatuses = ['open', 'in_progress', 'resolved', 'closed'];
    const validPriorities = ['low', 'normal', 'high', 'urgent'];
    const sets = []; const params = []; let idx = 1;
    if (status) {
      if (!validStatuses.includes(status)) return res.status(400).json({ error: 'Invalid status' });
      sets.push(`status = $${idx++}`); params.push(status);
    }
    if (priority) {
      if (!validPriorities.includes(priority)) return res.status(400).json({ error: 'Invalid priority' });
      sets.push(`priority = $${idx++}`); params.push(priority);
    }
    if (sets.length === 0) return res.status(400).json({ error: 'No fields to update' });
    sets.push('updated_at = CURRENT_TIMESTAMP');
    params.push(id);
    const result = await pool.query(`UPDATE support_tickets SET ${sets.join(', ')} WHERE id = $${idx} RETURNING *`, params);
    if (result.rows.length === 0) return res.status(404).json({ error: 'Ticket not found' });
    res.json(result.rows[0]);
  } catch (err) { console.error('Admin update ticket error:', err.message); res.status(500).json({ error: 'An unexpected error occurred' }); }
});

app.get('/api/admin/support-tickets/:id', async (req, res) => {
  try {
    const { id } = req.params;
    const result = await pool.query('SELECT * FROM support_tickets WHERE id = $1', [id]);
    if (result.rows.length === 0) return res.status(404).json({ error: 'Ticket not found' });
    res.json({ ticket: result.rows[0] });
  } catch (err) { console.error('Admin ticket detail error:', err.message); res.status(500).json({ error: 'An unexpected error occurred' }); }
});

app.get('/api/admin/support-tickets/:id/messages', async (req, res) => {
  try {
    const { id } = req.params;
    const messages = await pool.query('SELECT * FROM support_messages WHERE ticket_id = $1 ORDER BY created_at ASC', [id]);
    res.json({ messages: messages.rows });
  } catch (err) { console.error('Admin ticket messages error:', err.message); res.status(500).json({ error: 'An unexpected error occurred' }); }
});

app.post('/api/admin/support-tickets/:id/messages', async (req, res) => {
  try {
    const { id } = req.params;
    const { message } = req.body;
    if (!message) return res.status(400).json({ error: 'Message is required' });
    const clean = sanitizeText(message.trim());
    if (!clean) return res.status(400).json({ error: 'Message is required' });
    const ticket = await pool.query('SELECT * FROM support_tickets WHERE id = $1', [id]);
    if (ticket.rows.length === 0) return res.status(404).json({ error: 'Ticket not found' });
    const staffName = sanitizeText(req.user.full_name || req.user.email || 'Admin');
    const result = await pool.query(
      'INSERT INTO support_messages (ticket_id, sender, message, is_staff) VALUES ($1, $2, $3, $4) RETURNING *',
      [id, staffName, clean, true]
    );
    await pool.query('UPDATE support_tickets SET updated_at = CURRENT_TIMESTAMP, status = $1 WHERE id = $2', ['in_progress', id]);
    res.status(201).json(result.rows[0]);
  } catch (err) { console.error('Admin ticket reply error:', err.message); res.status(500).json({ error: 'An unexpected error occurred' }); }
});

// ── Admin Groups Management ──
app.post('/api/admin/groups', async (req, res) => {
  try {
    const { id, name, description, icon, topic } = req.body;
    if (!id || !name) return res.status(400).json({ error: 'Group id and name required' });
    const result = await pool.query(
      'INSERT INTO trading_groups (id, name, description, icon, topic) VALUES ($1, $2, $3, $4, $5) RETURNING *',
      [id, name, description || '', icon || '', topic || 'General']
    );
    res.status(201).json(result.rows[0]);
  } catch (err) { console.error('Admin create group error:', err.message); res.status(500).json({ error: 'An unexpected error occurred' }); }
});

app.put('/api/admin/groups/:id', async (req, res) => {
  try {
    const { id } = req.params;
    const { name, description, icon, topic } = req.body;
    const fields = []; const params = []; let idx = 1;
    if (name !== undefined) { fields.push(`name = $${idx++}`); params.push(name); }
    if (description !== undefined) { fields.push(`description = $${idx++}`); params.push(description); }
    if (icon !== undefined) { fields.push(`icon = $${idx++}`); params.push(icon); }
    if (topic !== undefined) { fields.push(`topic = $${idx++}`); params.push(topic); }
    if (fields.length === 0) return res.status(400).json({ error: 'No fields to update' });
    params.push(id);
    const result = await pool.query(`UPDATE trading_groups SET ${fields.join(', ')} WHERE id = $${idx} RETURNING *`, params);
    if (result.rows.length === 0) return res.status(404).json({ error: 'Group not found' });
    res.json(result.rows[0]);
  } catch (err) { console.error('Admin update group error:', err.message); res.status(500).json({ error: 'An unexpected error occurred' }); }
});

app.delete('/api/admin/groups/:id', async (req, res) => {
  try {
    const { id } = req.params;
    const result = await pool.query('DELETE FROM trading_groups WHERE id = $1 RETURNING id', [id]);
    if (result.rows.length === 0) return res.status(404).json({ error: 'Group not found' });
    res.json({ success: true });
  } catch (err) { console.error('Admin delete group error:', err.message); res.status(500).json({ error: 'An unexpected error occurred' }); }
});

app.get('/api/admin/groups/:id/members', async (req, res) => {
  try {
    const { id } = req.params;
    const result = await pool.query(`
      SELECT gm.*, u.full_name, u.email, u.trader_type
      FROM group_members gm
      JOIN users u ON u.id = gm.user_id
      WHERE gm.group_id = $1
      ORDER BY gm.joined_at DESC
    `, [id]);
    res.json({ members: result.rows });
  } catch (err) { console.error('Admin group members error:', err.message); res.status(500).json({ error: 'An unexpected error occurred' }); }
});

// ── Admin Delete Message ──
app.delete('/api/admin/messages/:id', async (req, res) => {
  try {
    const { id } = req.params;
    const msg = await pool.query('SELECT * FROM messages WHERE id = $1', [id]);
    if (msg.rows.length === 0) return res.status(404).json({ error: 'Message not found' });
    const message = msg.rows[0];
    await pool.query('DELETE FROM messages WHERE id = $1', [id]);
    try { io.emit('message_deleted', { messageId: id, groupId: message.group_id }); } catch {}
    res.json({ success: true });
  } catch (err) { console.error('Admin delete message error:', err.message); res.status(500).json({ error: 'An unexpected error occurred' }); }
});

// ── Admin Broker Snapshots ──
app.get('/api/admin/broker-accounts/:id/snapshots', async (req, res) => {
  try {
    const { id } = req.params;
    const result = await pool.query(
      'SELECT * FROM broker_account_snapshots WHERE broker_connection_id = $1 ORDER BY snapshot_at DESC LIMIT 50',
      [id]
    );
    res.json({ snapshots: result.rows });
  } catch (err) { console.error('Admin broker snapshots error:', err.message); res.status(500).json({ error: 'An unexpected error occurred' }); }
});

// ── Admin Stocks ──
app.get('/api/admin/stocks', async (req, res) => {
  try {
    const page = Math.max(1, parseInt(req.query.page) || 1);
    const limit = Math.min(200, Math.max(1, parseInt(req.query.limit) || 50));
    const search = (req.query.search || '').trim();
    const offset = (page - 1) * limit;
    let whereClause = '';
    const params = [];
    let idx = 1;
    if (search) {
      whereClause = `WHERE (ticker ILIKE $${idx} OR name ILIKE $${idx} OR sector ILIKE $${idx} OR market ILIKE $${idx})`;
      params.push(`%${search}%`);
      idx++;
    }
    const countResult = await pool.query(`SELECT COUNT(*)::int as cnt FROM stocks ${whereClause}`, params);
    const dataResult = await pool.query(
      `SELECT * FROM stocks ${whereClause} ORDER BY ticker ASC LIMIT $${idx} OFFSET $${idx + 1}`,
      [...params, limit, offset]
    );
    res.json({ stocks: dataResult.rows, total: countResult.rows[0].cnt, page, limit });
  } catch (err) { console.error('Admin stocks error:', err.message); res.status(500).json({ error: 'An unexpected error occurred' }); }
});

app.get('/api/admin/stocks/:id', async (req, res) => {
  try {
    const { id } = req.params;
    const result = await pool.query('SELECT * FROM stocks WHERE id = $1', [id]);
    if (result.rows.length === 0) return res.status(404).json({ error: 'Stock not found' });
    res.json(result.rows[0]);
  } catch (err) { console.error('Admin stock detail error:', err.message); res.status(500).json({ error: 'An unexpected error occurred' }); }
});

app.put('/api/admin/stocks/:id', async (req, res) => {
  try {
    const { id } = req.params;
    const { ticker, name, sector, industry, market, currency, is_active } = req.body;
    const fields = []; const params = []; let idx = 1;
    if (ticker !== undefined) { fields.push(`ticker = $${idx++}`); params.push(ticker); }
    if (name !== undefined) { fields.push(`name = $${idx++}`); params.push(name); }
    if (sector !== undefined) { fields.push(`sector = $${idx++}`); params.push(sector); }
    if (market !== undefined) { fields.push(`market = $${idx++}`); params.push(market); }
    if (currency !== undefined) { fields.push(`currency = $${idx++}`); params.push(currency); }
    if (is_active !== undefined) { fields.push(`is_active = $${idx++}`); params.push(is_active); }
    if (fields.length === 0) return res.status(400).json({ error: 'No fields to update' });
    params.push(id);
    const result = await pool.query(`UPDATE stocks SET ${fields.join(', ')} WHERE id = $${idx} RETURNING *`, params);
    if (result.rows.length === 0) return res.status(404).json({ error: 'Stock not found' });
    res.json(result.rows[0]);
  } catch (err) { console.error('Admin update stock error:', err.message); res.status(500).json({ error: 'An unexpected error occurred' }); }
});

app.delete('/api/admin/stocks/:id', async (req, res) => {
  try {
    const { id } = req.params;
    const result = await pool.query('DELETE FROM stocks WHERE id = $1 RETURNING id', [id]);
    if (result.rows.length === 0) return res.status(404).json({ error: 'Stock not found' });
    res.json({ success: true });
  } catch (err) { console.error('Admin delete stock error:', err.message); res.status(500).json({ error: 'An unexpected error occurred' }); }
});

// ── Admin Notifications ──
app.get('/api/admin/notifications', async (req, res) => {
  try {
    const page = Math.max(1, parseInt(req.query.page) || 1);
    const limit = Math.min(100, Math.max(1, parseInt(req.query.limit) || 50));
    const offset = (page - 1) * limit;
    const countResult = await pool.query('SELECT COUNT(*)::int as cnt FROM notifications');
    const dataResult = await pool.query(`
      SELECT n.*, u.full_name, u.email
      FROM notifications n
      LEFT JOIN users u ON u.id = n.user_id
      ORDER BY n.created_at DESC LIMIT $1 OFFSET $2
    `, [limit, offset]);
    res.json({ notifications: dataResult.rows, total: countResult.rows[0].cnt, page, limit });
  } catch (err) { console.error('Admin notifications error:', err.message); res.status(500).json({ error: 'An unexpected error occurred' }); }
});

// ── Admin Signal Outcomes ──
app.get('/api/admin/signal-outcomes', async (req, res) => {
  try {
    const page = Math.max(1, parseInt(req.query.page) || 1);
    const limit = Math.min(100, Math.max(1, parseInt(req.query.limit) || 50));
    const offset = (page - 1) * limit;
    const countResult = await pool.query('SELECT COUNT(*)::int as cnt FROM signal_outcomes');
    const dataResult = await pool.query(
      `SELECT id, ticker, signal, entry_price, exit_price, result, recorded_at
       FROM signal_outcomes
       ORDER BY recorded_at DESC LIMIT $1 OFFSET $2`,
      [limit, offset]
    );
    const statsResult = await pool.query(
      `SELECT COUNT(*)::int as total,
              COALESCE(SUM(CASE WHEN result = 'win' THEN 1 ELSE 0 END), 0)::int as wins,
              COALESCE(SUM(CASE WHEN result = 'loss' THEN 1 ELSE 0 END), 0)::int as losses
       FROM signal_outcomes`
    );
    res.json({ outcomes: dataResult.rows, total: countResult.rows[0].cnt, page, limit, stats: statsResult.rows[0] });
  } catch (err) { console.error('Admin signal outcomes error:', err.message); res.status(500).json({ error: 'An unexpected error occurred' }); }
});

// --- Admin Affiliates ---
app.get('/api/admin/affiliates', async (req, res) => {
  try {
    const page = Math.max(1, parseInt(req.query.page) || 1);
    const limit = Math.min(100, Math.max(1, parseInt(req.query.limit) || 50));
    const offset = (page - 1) * limit;
    const countResult = await pool.query('SELECT COUNT(*)::int as cnt FROM affiliates');
    const dataResult = await pool.query(
      `SELECT a.id, a.user_id, a.referral_code, a.created_at, a.total_earned, a.pending_balance, a.paid_out,
              u.full_name, u.email,
              (SELECT COUNT(*) FROM referrals WHERE affiliate_id = a.id) as referral_count,
              (SELECT COUNT(*) FROM referrals WHERE affiliate_id = a.id AND status = 'paid') as paid_referrals
       FROM affiliates a JOIN users u ON u.id = a.user_id
       ORDER BY a.created_at DESC LIMIT $1 OFFSET $2`,
      [limit, offset]
    );
    const statsResult = await pool.query(
      `SELECT COUNT(*)::int as total_affiliates,
              COALESCE(SUM(total_earned), 0) as total_earned,
              COALESCE(SUM(pending_balance), 0) as total_pending,
              COALESCE(SUM(paid_out), 0) as total_paid_out,
              (SELECT COUNT(*) FROM referrals) as total_referrals,
              (SELECT COUNT(*) FROM referrals WHERE status = 'paid') as paid_referrals
       FROM affiliates`
    );
    res.json({ affiliates: dataResult.rows, total: countResult.rows[0].cnt, page, limit, stats: statsResult.rows[0] });
  } catch (err) { console.error('Admin affiliates error:', err.message); res.status(500).json({ error: 'An unexpected error occurred' }); }
});

app.get('/api/admin/affiliates/referrals', async (req, res) => {
  try {
    const page = Math.max(1, parseInt(req.query.page) || 1);
    const limit = Math.min(100, Math.max(1, parseInt(req.query.limit) || 50));
    const offset = (page - 1) * limit;
    const countResult = await pool.query('SELECT COUNT(*)::int as cnt FROM referrals');
    const dataResult = await pool.query(
      `SELECT r.id, r.subscription_tier, r.commission_amount, r.status, r.created_at, r.paid_at,
              r.affiliate_id, r.referred_user_id,
              aff.referral_code, aff_user.full_name as affiliate_name, aff_user.email as affiliate_email,
              ref_user.full_name as referred_name, ref_user.email as referred_email
       FROM referrals r
       JOIN affiliates aff ON aff.id = r.affiliate_id
       JOIN users aff_user ON aff_user.id = aff.user_id
       JOIN users ref_user ON ref_user.id = r.referred_user_id
       ORDER BY r.created_at DESC LIMIT $1 OFFSET $2`,
      [limit, offset]
    );
    res.json({ referrals: dataResult.rows, total: countResult.rows[0].cnt, page, limit });
  } catch (err) { console.error('Admin referrals error:', err.message); res.status(500).json({ error: 'An unexpected error occurred' }); }
});

app.get('/api/admin/affiliates/payouts', async (req, res) => {
  try {
    const page = Math.max(1, parseInt(req.query.page) || 1);
    const limit = Math.min(100, Math.max(1, parseInt(req.query.limit) || 50));
    const offset = (page - 1) * limit;
    const countResult = await pool.query('SELECT COUNT(*)::int as cnt FROM affiliate_payouts');
    const dataResult = await pool.query(
      `SELECT p.id, p.amount, p.payment_method, p.payment_details, p.status, p.notes, p.created_at, p.processed_at,
              a.referral_code, u.full_name, u.email
       FROM affiliate_payouts p
       JOIN affiliates a ON a.id = p.affiliate_id
       JOIN users u ON u.id = a.user_id
       ORDER BY p.created_at DESC LIMIT $1 OFFSET $2`,
      [limit, offset]
    );
    const statsResult = await pool.query(
      `SELECT COUNT(*)::int as total,
              COALESCE(SUM(CASE WHEN status = 'pending' THEN 1 ELSE 0 END), 0)::int as pending_count,
              COALESCE(SUM(CASE WHEN status = 'approved' THEN 1 ELSE 0 END), 0)::int as approved_count,
              COALESCE(SUM(CASE WHEN status = 'paid' THEN 1 ELSE 0 END), 0)::int as paid_count,
              COALESCE(SUM(CASE WHEN status = 'rejected' THEN 1 ELSE 0 END), 0)::int as rejected_count,
              COALESCE(SUM(amount), 0) as total_amount,
              COALESCE(SUM(CASE WHEN status = 'pending' THEN amount ELSE 0 END), 0) as pending_amount
       FROM affiliate_payouts`
    );
    res.json({ payouts: dataResult.rows, total: countResult.rows[0].cnt, page, limit, stats: statsResult.rows[0] });
  } catch (err) { console.error('Admin payouts error:', err.message); res.status(500).json({ error: 'An unexpected error occurred' }); }
});

app.put('/api/admin/affiliates/payouts/:id', async (req, res) => {
  try {
    const { id } = req.params;
    const { status, notes } = req.body;
    if (!['approved', 'rejected', 'paid'].includes(status)) {
      return res.status(400).json({ error: 'Invalid status. Must be approved, rejected, or paid' });
    }
    // Get payout info
    const payoutRes = await pool.query(
      `SELECT p.id, p.amount, p.status as current_status, p.affiliate_id
       FROM affiliate_payouts p WHERE p.id = $1`,
      [id]
    );
    if (payoutRes.rows.length === 0) return res.status(404).json({ error: 'Payout not found' });
    const payout = payoutRes.rows[0];
    if (payout.current_status !== 'pending') {
      return res.status(400).json({ error: 'Payout is already ' + payout.current_status });
    }
    await pool.query(
      `UPDATE affiliate_payouts SET status = $1, notes = $2, processed_at = NOW() WHERE id = $3`,
      [status, notes || null, id]
    );
    if (status === 'paid') {
      await pool.query(
        `UPDATE affiliates SET paid_out = paid_out + $1 WHERE id = $2`,
        [payout.amount, payout.affiliate_id]
      );
    } else if (status === 'rejected') {
      await pool.query(
        `UPDATE affiliates SET pending_balance = pending_balance + $1 WHERE id = $2`,
        [payout.amount, payout.affiliate_id]
      );
    }
    console.log(`[AFFILIATE] Payout ${id} ${status} by admin`);
    res.json({ success: true, message: `Payout ${status}` });
  } catch (err) { console.error('Admin payout update error:', err.message); res.status(500).json({ error: 'An unexpected error occurred' }); }
});

const port = process.env.PORT || 3001;
app.get(['/admin', '/admin/*'], (req, res) => {
  res.sendFile(path.join(__dirname, 'admin.html'));
});

const onlineUsers = new Map();
const lastSeen = new Map();

io.on('connection', (socket) => {
  console.log(`Socket connected: ${socket.id}`);
  let currentUserId = null;
  socket.emit('online_users', Array.from(onlineUsers.keys()));
  socket.on('identify_user', (userId) => {
    currentUserId = userId;
    socket.data.userId = userId;
    socket.join(`user:${userId}`);
    lastSeen.set(userId, new Date());
    if (!onlineUsers.has(userId)) {
      onlineUsers.set(userId, new Set());
      io.emit('user_online', Number(userId));
    }
    onlineUsers.get(userId).add(socket.id);
    io.emit('online_users', Array.from(onlineUsers.keys()));
  });
  socket.on('join', (userId) => {
    if (userId) socket.join(`user:${userId}`);
  });
  socket.on('disconnect', () => {
    if (currentUserId && onlineUsers.has(currentUserId)) {
      onlineUsers.get(currentUserId).delete(socket.id);
      if (onlineUsers.get(currentUserId).size === 0) {
        onlineUsers.delete(currentUserId);
        lastSeen.set(currentUserId, new Date());
        io.emit('user_offline', Number(currentUserId));
      }
      io.emit('online_users', Array.from(onlineUsers.keys()));
    }
    console.log(`Socket disconnected: ${socket.id}`);
  });

  // Join/leave group rooms
  socket.on('join_group', (groupId) => {
    if (groupId) socket.join(`group:${groupId}`);
  });
  socket.on('leave_group', (groupId) => {
    if (groupId) socket.leave(`group:${groupId}`);
  });

  // Join private conversation room (deterministic room name)
  socket.on('join_private', (userId, peerId) => {
    const room = [String(userId), String(peerId)].sort().join(':pm');
    socket.join(room);
  });

  // Typing indicators
  socket.on('typing', (data) => {
    const { userId, userName, groupId, recipientId } = data || {};
    if (groupId) {
      socket.to(`group:${groupId}`).emit('typing', { userId, userName, groupId });
    } else if (recipientId) {
      socket.to(`user:${recipientId}`).emit('typing', { userId, userName });
    }
  });
  socket.on('stop_typing', (data) => {
    const { userId, groupId, recipientId } = data || {};
    if (groupId) {
      socket.to(`group:${groupId}`).emit('stop_typing', { userId });
    } else if (recipientId) {
      socket.to(`user:${recipientId}`).emit('stop_typing', { userId });
    }
  });

  // ── Send Message ──────────────────────────────────────────────────
  socket.on('send_message', async (data) => {
    try {
      const { senderId, senderName, content, groupId, recipientId, messageType, imageUrl, fileName } = data;
      if ((!content || !content.trim()) && !imageUrl) return;
      const cleanContent = content ? sanitizeText(content.trim()) : '';

      if (senderId) lastSeen.set(Number(senderId), new Date());
      const result = await pool.query(
        `INSERT INTO messages (sender_id, sender_name, content, message_type, group_id, recipient_id, image_url, file_name)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
         RETURNING id, sender_id, sender_name, content, message_type, group_id, recipient_id, image_url, file_name, created_at`,
        [senderId || null, sanitizeText(senderName || 'Anonymous'), cleanContent, messageType || 'user', groupId || null, recipientId || null, imageUrl || null, fileName || null]
      );
      const msg = result.rows[0];

      // Broadcast to room (includes sender so they get the server-assigned id)
      if (groupId) {
        io.to(`group:${groupId}`).emit('receive_message', msg);
      } else if (recipientId) {
        const room = [String(senderId), String(recipientId)].sort().join(':pm');
        io.to(room).emit('receive_message', msg);
      }

      // ── Message Notifications ────────────────────────────────────────
      try {
        if (groupId) {
          const groupResult = await pool.query('SELECT user_id, (SELECT name FROM trading_groups WHERE id = $1) as group_name FROM group_members WHERE group_id = $1', [groupId]);
          const preview = cleanContent.length > 100 ? cleanContent.substring(0, 100) + '…' : cleanContent;
          for (const member of groupResult.rows) {
            if (Number(member.user_id) === Number(senderId)) continue;
            const n = await pool.query(
              `INSERT INTO notifications (user_id, title, body, type, link) VALUES ($1, $2, $3, 'message', $4)
               RETURNING id, user_id, title, body, type, read, link, created_at`,
              [member.user_id, `${sanitizeText(senderName)} in ${member.group_name}`, sanitizeText(preview), `/app/chat?group=${groupId}`]
            );
            io.to(`user:${member.user_id}`).emit('notification', n.rows[0]);
          }
        } else if (recipientId) {
          const preview = cleanContent.length > 100 ? cleanContent.substring(0, 100) + '…' : cleanContent;
          const n = await pool.query(
            `INSERT INTO notifications (user_id, title, body, type, link) VALUES ($1, $2, $3, 'message', $4)
             RETURNING id, user_id, title, body, type, read, link, created_at`,
            [recipientId, sanitizeText(senderName), sanitizeText(preview), `/app/chat?person=${senderId}`]
          );
          io.to(`user:${recipientId}`).emit('notification', n.rows[0]);
        }
      } catch (err) {
        console.error('message notification error:', err.message);
      }

      // Stock mention → AI assistant response
      const stockMatch = content.match(/\b(SCOM|EQTY|KCB|EABL|ABSA|SBIC|KLG|BAMB|KPLC|NMG|TOTL|COOP|IMH|LKL|KNRE|CIC|HFCK|STAN|JUB|UMEM|CRAY|OLYM|BAT|KUKZ|NCBA|BOC|CARB|SCBK|DTK|BKG|KEGN|UMME|BRIT|LBTY|SLAM|CTUM|NSE|EVRD|FTGH|UNGA|ARM|PORT|CRWN|TPSE|SCAN|SGL|CGEN|AMAC)\b/i);
      if (stockMatch && groupId) {
        const ticker = stockMatch[0].toUpperCase();
        setTimeout(async () => {
          try {
            const { getSignalForStock } = require('./signalService');
            const signal = await getSignalForStock(ticker).catch(() => null);
            let aiContent = `📊 **${ticker}** — `;
            if (signal && signal.signal) {
              aiContent += `${signal.signal} rating (${signal.confidence || 'N/A'} confidence). `;
              aiContent += signal.reason ? `*${signal.reason}*` : 'Currently under analysis.';
            } else {
              aiContent += 'No signal data available at the moment.';
            }
            const aiResult = await pool.query(
              `INSERT INTO messages (sender_name, content, message_type, group_id)
               VALUES ($1, $2, $3, $4)
               RETURNING id, sender_name, content, message_type, group_id, created_at`,
              ['AI Assistant', aiContent, 'ai', groupId]
            );
            io.to(`group:${groupId}`).emit('receive_message', aiResult.rows[0]);
          } catch (err) {
            console.error('AI message error:', err.message);
          }
        }, 1500);
      }
    } catch (err) {
      console.error('send_message error:', err.message);
    }
  });

  // ── Support Live Chat (User + Staff) ──────────────────────────────
  socket.on('join_support_chat', () => {
    socket.join('support:live');
  });

  socket.on('leave_support_chat', () => {
    socket.leave('support:live');
  });

  // Staff joins their own room to receive all user messages
  socket.on('staff_join', () => {
    socket.join('support:staff');
  });
  socket.on('staff_leave', () => {
    socket.leave('support:staff');
  });

  // User is typing → staff see it
  socket.on('support_typing', () => {
    socket.to('support:staff').emit('support_user_typing', socket.data?.userId || null);
  });
  socket.on('support_stop_typing', () => {
    socket.to('support:staff').emit('support_user_stop_typing', socket.data?.userId || null);
  });

  // Staff is typing → user sees it
  socket.on('staff_typing', ({ userId }) => {
    io.to(`user:${userId}`).emit('support_staff_typing');
  });
  socket.on('staff_stop_typing', ({ userId }) => {
    io.to(`user:${userId}`).emit('support_staff_stop_typing');
  });

  // User sends a support message → staff room gets it, user's own display gets it
  socket.on('send_support_message', async (data) => {
    try {
      const { userId, userName, email, message, isStaff } = data;
      if (!message || !message.trim()) return;
      const cleanMessage = sanitizeText(message.trim());
      if (!cleanMessage) return;
      const result = await pool.query(
        `INSERT INTO support_chat_messages (user_id, user_name, email, message, is_staff)
         VALUES ($1, $2, $3, $4, $5)
         RETURNING id, user_id, user_name, email, message, is_staff, created_at`,
        [userId || null, sanitizeText(userName || 'Anonymous'), sanitizeText(email || ''), cleanMessage, isStaff || false]
      );
      const msg = result.rows[0];
      if (userId) io.to(`user:${userId}`).emit('support_chat_message', msg);
      io.to('support:staff').emit('support_chat_message', msg);
    } catch (err) {
      console.error('send_support_message error:', err.message);
    }
  });

  // Staff sends a reply → user's room gets it
  socket.on('staff_send_message', async (data) => {
    try {
      const { userId, userName, email, message } = data;
      if (!message || !message.trim() || !userId) return;
      const cleanMessage = sanitizeText(message.trim());
      if (!cleanMessage) return;
      const result = await pool.query(
        `INSERT INTO support_chat_messages (user_id, user_name, email, message, is_staff)
         VALUES ($1, $2, $3, $4, true)
         RETURNING id, user_id, user_name, email, message, is_staff, created_at`,
        [userId, sanitizeText(userName || 'Support Agent'), sanitizeText(email || ''), cleanMessage]
      );
      const msg = result.rows[0];
      io.to(`user:${userId}`).emit('support_chat_message', msg);
      io.to('support:staff').emit('support_chat_message', msg);
    } catch (err) {
      console.error('staff_send_message error:', err.message);
    }
  });
});

// Helper functions
function formatVolume(v) {
  if (!v) return '0';
  if (v >= 1e9) return (v / 1e9).toFixed(2) + 'B';
  if (v >= 1e6) return (v / 1e6).toFixed(2) + 'M';
  if (v >= 1e3) return (v / 1e3).toFixed(2) + 'K';
  return v.toString();
}

function formatTurnover(t) {
  if (!t) return 'KES 0';
  if (t >= 1e9) return 'KES ' + (t / 1e9).toFixed(2) + 'B';
  if (t >= 1e6) return 'KES ' + (t / 1e6).toFixed(2) + 'M';
  return 'KES ' + t.toLocaleString();
}

let _fxRate = 130;

async function getFxRate() {
  try { _fxRate = await fxService.getRate(); } catch {}
  return _fxRate;
}

function parseVolume(volStr) {
  const num = parseFloat(volStr);
  if (volStr.includes('M')) return num * 1000000;
  if (volStr.includes('K')) return num * 1000;
  return num;
}

async function getPortfolioValue(userId) {
  try {
    const { rows } = await pool.query('SELECT * FROM paper_accounts WHERE user_id = $1', [userId]);
    if (rows.length === 0) return null;
    const account = rows[0];
    const pos = await pool.query(
      'SELECT ticker, shares, avg_cost, market FROM paper_positions WHERE user_id = $1', [userId]
    );
    let nseValue = parseFloat(account.cash_balance);
    let usdValue = parseFloat(account.cash_balance_usd);
    for (const p of pos.rows) {
      const livePrice = await getLivePrice(p.market, p.ticker) || parseFloat(p.avg_cost);
      const val = livePrice * parseFloat(p.shares);
      if (p.market === 'NSE') nseValue += val;
      else usdValue += val;
    }
    const fxRate = await getFxRate();
    const combinedValue = nseValue + usdValue * fxRate;
    const investedValue = pos.rows.reduce((sum, p) => sum + parseFloat(p.avg_cost) * parseFloat(p.shares), 0);
    return { combinedValue, nseValue, usdValue, cashBalance: parseFloat(account.cash_balance), fxRate, investedValue };
  } catch { return null; }
}

async function snapshotPortfolioValue(userId) {
  try {
    const pv = await getPortfolioValue(userId);
    if (!pv) return;
    const invested = pv.investedValue || 0;
    await pool.query(
      `INSERT INTO portfolio_value_history (user_id, total_value, cash_balance, invested_value)
       VALUES ($1, $2, $3, $4)`,
      [userId, Math.round(pv.combinedValue * 100) / 100, Math.round(pv.cashBalance * 100) / 100, Math.round(invested * 100) / 100]
    );
  } catch {}
}

async function getMarketSnapshot() {
  const NSE_TICKERS = ['SCOM', 'EQTY', 'KCB', 'EABL', 'ABSA', 'SBIC', 'KLG', 'OLYM', 'CRAY', 'BAMB', 'UMEM', 'KPLC', 'NMG', 'TOTL', 'STAN', 'COOP', 'JUB', 'KNRE', 'LKL', 'CIC', 'HFCK', 'IMH', 'NCBA', 'BAT', 'KUKZ', 'SASN', 'SCBK', 'KEGN', 'CTUM', 'BRIT', 'CARB', 'KQ', 'PORT', 'WTK', 'KAPC', 'CGEN', 'CABL', 'UMME', 'REA', 'EGAD', 'LBTY', 'SLAM', 'BOC', 'MSC', 'UNGA', 'FTGH', 'TPS', 'HAFR', 'EVRD'];
  const GLOBAL_TICKERS = ['AAPL', 'MSFT', 'NVDA', 'TSLA', 'AMZN', 'GOOGL', 'META', 'NFLX', 'JPM', 'V', 'WMT', 'JNJ', 'PG', 'XOM', 'BAC', 'HD', 'DIS', 'CSCO', 'ADBE', 'CRM', 'INTC', 'AMD', 'PYPL', 'UBER', 'SQ', 'MA', 'UNH', 'COST', 'ABBV', 'CVX', 'PFE', 'TMO', 'ORCL', 'IBM', 'QCOM', 'AVGO', 'NKE', 'MRK', 'KO', 'PEP', 'MCD', 'BA', 'C', 'GS', 'MS', 'BK', 'AXP', 'CAT', 'GE', 'HON', 'LMT'];
  const indexSymbols = ['NSE:NSE20', 'NSE:NSEASI', 'NSE:NSE25', 'NSE:NSE10'];  const stockSymbols = [...NSE_TICKERS.map(t => 'NSE:' + t), ...GLOBAL_TICKERS];
  const allQuotes = await getQuotesBatch([...indexSymbols, ...stockSymbols]);
  const indices = indexSymbols.map(symbol => {
    const data = allQuotes[symbol] || { symbol, price: 0, change: 0, changePercent: 0, volume: 0 };
    return {
      name: symbol === 'NSE:NSE20' ? 'NSE 20 Share Index'
        : symbol === 'NSE:NSEASI' ? 'NSE All Share Index'
        : symbol === 'NSE:NSE25' ? 'NSE 25 Share Index' : 'NSE 10 Share Index',
      symbol, currency: 'KES',
      value: parseFloat((data.price || 0).toFixed(2)),
      change: (data.change >= 0 ? '+' : '') + (data.changePercent || 0).toFixed(2) + '%',
      isPositive: data.change >= 0,
      volume: formatVolume(data.volume),
      turnover: formatTurnover(data.volume),
    };
  });
  const stocks = stockSymbols.map(symbol => {
    const data = allQuotes[symbol] || { price: 0, change: 0, changePercent: 0, volume: 0, company_name: '', currency: '' };
    return {
      ticker: symbol.includes(':') ? symbol.split(':')[1] : symbol,
      symbol,
      name: data.company_name || getCompanyName(symbol),
      price: parseFloat((data.price || 0).toFixed(2)),
      currency: data.currency || (symbol.startsWith('NSE:') ? 'KES' : 'USD'),
      change: (data.change >= 0 ? '+' : '') + (data.changePercent || 0).toFixed(2) + '%',
      changePercent: data.changePercent || 0,
      isPositive: data.change >= 0,
      volume: formatVolume(data.volume),
      trades: Math.floor((data.volume || 0) / 100).toLocaleString(),
    };
  });
  const nseStocks = stocks.filter(s => s.symbol.startsWith('NSE:'));
  const globalStocks = stocks.filter(s => !s.symbol.startsWith('NSE:'));
  const getMovers = (stockList) => {
    const sorted = [...stockList].sort((a, b) => parseFloat(b.change) - parseFloat(a.change));
    return { gainers: sorted.filter(s => s.isPositive).slice(0, 10), losers: sorted.filter(s => !s.isPositive).reverse().slice(0, 10) };
  };
  const getActive = (stockList) => [...stockList].sort((a, b) => parseVolume(b.volume) - parseVolume(a.volume)).slice(0, 10);
  return {
    indices,
    nse: { active: getActive(nseStocks), movers: getMovers(nseStocks) },
    global: { active: getActive(globalStocks), movers: getMovers(globalStocks) },
    active: getActive(stocks),
    movers: getMovers(stocks),
    updatedAt: new Date().toISOString(),
  };
}

async function getLivePrice(market, ticker) {
  const { getStockQuote } = require('./marketService');
  const sym = market === 'NSE' ? 'NSE:' + ticker : ticker;
  try {
    const quote = await Promise.race([
      getStockQuote(sym),
      new Promise(resolve => setTimeout(() => resolve(null), 15000)),
    ]);
    if (quote && quote.price) return quote.price;
  } catch {}
  return null;
}

async function getLiveQuote(market, ticker) {
  const { getStockQuote } = require('./marketService');
  const sym = market === 'NSE' ? 'NSE:' + ticker : ticker;
  try {
    const quote = await Promise.race([
      getStockQuote(sym),
      new Promise(resolve => setTimeout(() => resolve(null), 15000)),
    ]);
    if (quote && quote.price != null) return { price: quote.price, previousClose: quote.previousClose ?? quote.price };
  } catch {}
  return null;
}

function formatMinutes(minutes) {
  if (minutes == null || minutes <= 0) return '';
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  if (h > 0) return `${h}h ${m}m`;
  return `${m}m`;
}

function isMarketOpen(market) {
  const now = new Date();
  const day = now.getDay();
  const utcMinutes = now.getUTCHours() * 60 + now.getUTCMinutes();
  const month = now.getMonth();
  const isWeekend = day === 0 || day === 6;

  let currentMinutes, openStart, openEnd, nextOpen, nextClose;

  if (market === 'NSE') {
    // NSE: Mon-Fri 9:30 AM - 3:30 PM EAT (UTC+3)
    currentMinutes = utcMinutes + 180;
    openStart = 570;
    openEnd = 930;
  } else {
    // US Markets (Global): Mon-Fri 9:30 AM - 4:00 PM ET
    const isDST = month >= 2 && month <= 9;
    const etOffset = isDST ? -4 : -5;
    currentMinutes = ((utcMinutes + etOffset * 60) % 1440 + 1440) % 1440;
    openStart = 570;
    openEnd = 960;
  }

  const isOpen = !isWeekend && currentMinutes >= openStart && currentMinutes < openEnd;

  // Calculate time to next event
  if (isOpen) {
    nextClose = openEnd - currentMinutes;
    nextOpen = null;
  } else if (isWeekend) {
    // Next Monday open (Saturday=6 has 1 intervening day, Sunday=0 has 0)
    nextOpen = (1440 - currentMinutes) + (day === 6 ? 1440 : 0) + openStart;
    nextClose = null;
  } else if (currentMinutes < openStart) {
    // Before market opens today
    nextOpen = openStart - currentMinutes;
    nextClose = null;
  } else {
    // After market closed today, next open is tomorrow (or Monday)
    const daysUntilNext = day === 5 ? 3 : 1;
    nextOpen = (1440 - currentMinutes) + (daysUntilNext - 1) * 1440 + openStart;
    nextClose = null;
  }

  const openLabel = isOpen ? 'Open' : 'Closed';
  const eventLabel = isOpen
    ? `Closes ${formatMinutes(nextClose)}`
    : `Opens ${formatMinutes(nextOpen)}`;

  return {
    open: isOpen,
    label: openLabel,
    eventLabel,
    timeToClose: isOpen ? nextClose : null,
    timeToOpen: isOpen ? null : nextOpen,
    openTime: '9:30 AM',
    closeTime: market === 'NSE' ? '3:30 PM' : '4:00 PM',
  };
}

// ===================== API ROUTES =====================

// --- Auth Routes ---

app.post('/api/auth/send-verification-code', async (req, res) => {
  try {
    const { email } = req.body;
    if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return res.status(400).json({ error: 'Valid email required' });
    const existing = await pool.query('SELECT id FROM users WHERE email = $1', [email]);
    if (existing.rows.length > 0) return res.status(409).json({ error: 'Email already registered' });
    const code = Math.floor(100000 + Math.random() * 900000).toString();
    const expiresAt = new Date(Date.now() + 10 * 60 * 1000);
    await pool.query('DELETE FROM otp_codes WHERE email = $1 AND type = $2', [email, 'email_verify']);
    await pool.query('INSERT INTO otp_codes (email, code, type, expires_at) VALUES ($1, $2, $3, $4)', [email, code, 'email_verify', expiresAt]);
    console.log(`[OTP] Email verification code for ${email}: ${code}`);
    await sendVerificationEmail(email, code).catch(e => console.error('[MAILER] send-verification-code failed:', e.message));
    res.json({ message: 'Verification code sent to email', expiresIn: 600 });
  } catch (error) {
    console.error('send-verification-code error:', error.message);
    res.status(500).json({ error: 'Failed to send verification code' });
  }
});

app.post('/api/auth/verify-email-and-register', async (req, res) => {
  try {
    const { fullName, email, password, code, ref } = req.body;
    if (!fullName || !email || !password || !code) return res.status(400).json({ error: 'All fields required' });
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return res.status(400).json({ error: 'Invalid email format' });
    if (password.length < 8) return res.status(400).json({ error: 'Password must be at least 8 characters' });
    const existing = await pool.query('SELECT id FROM users WHERE email = $1', [email]);
    if (existing.rows.length > 0) return res.status(409).json({ error: 'Email already registered' });
    const otpResult = await pool.query(
      'SELECT * FROM otp_codes WHERE email = $1 AND code = $2 AND type = $3 AND used = FALSE AND expires_at > NOW()',
      [email, code, 'email_verify']
    );
    if (otpResult.rows.length === 0) return res.status(401).json({ error: 'Invalid or expired verification code' });
    const hashedPassword = await bcrypt.hash(password, 10);
    // Handle referral code
    let referredBy = null;
    if (ref) {
      const affRes = await pool.query(`SELECT id FROM affiliates WHERE referral_code = $1`, [ref.toUpperCase()]);
      if (affRes.rows.length > 0) {
        referredBy = affRes.rows[0].id;
        console.log(`[AFFILIATE] Referral code ${ref} matched affiliate ${referredBy} for new user ${email}`);
      }
    }
    const result = await pool.query(
      'INSERT INTO users (full_name, email, password_hash, is_verified, trial_start_date, referred_by) VALUES ($1, $2, $3, TRUE, NOW(), $4) RETURNING id, full_name, email, role, is_verified, trader_type, created_at, subscription_tier, subscription_status, trial_start_date, subscription_end_date, commitment_fee_paid',
      [fullName, email, hashedPassword, referredBy]
    );
    // Create pending referral record
    if (referredBy) {
      await pool.query(
        `INSERT INTO referrals (affiliate_id, referred_user_id, status)
         VALUES ($1, $2, 'pending')
         ON CONFLICT (referred_user_id) DO NOTHING`,
        [referredBy, result.rows[0].id]
      );
    }
    await pool.query('UPDATE otp_codes SET used = TRUE WHERE id = $1', [otpResult.rows[0].id]);
    await pool.query('INSERT INTO paper_accounts (user_id) VALUES ($1)', [result.rows[0].id]);
    sendWelcomeEmail(email, fullName).catch(err => console.error('[MAILER] Welcome email failed:', err.message));
    emailSequenceService.enrollUserInOnboarding(result.rows[0].id).catch(err => console.error('[EMAIL SEQ] Onboarding enrollment failed:', err.message));
    const token = generateToken(result.rows[0].id);
    const refreshToken = await generateRefreshToken(result.rows[0].id);
    setRefreshCookie(res, refreshToken);
    res.status(201).json({ user: result.rows[0], token });
  } catch (error) {
    console.error('verify-email-and-register error:', error.message);
    res.status(500).json({ error: 'Verification or registration failed' });
  }
});

app.post('/api/auth/register', async (req, res) => {
  try {
    const { fullName, email, password, ref } = req.body;
    if (!fullName || !email || !password) return res.status(400).json({ error: 'All fields required' });
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return res.status(400).json({ error: 'Invalid email format' });
    if (password.length < 8) return res.status(400).json({ error: 'Password must be at least 8 characters' });
    const existing = await pool.query('SELECT id FROM users WHERE email = $1', [email]);
    if (existing.rows.length > 0) return res.status(409).json({ error: 'Email already registered' });
    const hashedPassword = await bcrypt.hash(password, 10);
    // Handle referral code
    let referredBy = null;
    if (ref) {
      const affRes = await pool.query(`SELECT id FROM affiliates WHERE referral_code = $1`, [ref.toUpperCase()]);
      if (affRes.rows.length > 0) {
        referredBy = affRes.rows[0].id;
        console.log(`[AFFILIATE] Referral code ${ref} matched affiliate ${referredBy} for new user ${email}`);
      }
    }
    const result = await pool.query(
      'INSERT INTO users (full_name, email, password_hash, trial_start_date, referred_by) VALUES ($1, $2, $3, NOW(), $4) RETURNING id, full_name, email, role, created_at, subscription_tier, subscription_status, trial_start_date',
      [fullName, email, hashedPassword, referredBy]
    );
    // Create pending referral record
    if (referredBy) {
      await pool.query(
        `INSERT INTO referrals (affiliate_id, referred_user_id, status)
         VALUES ($1, $2, 'pending')
         ON CONFLICT (referred_user_id) DO NOTHING`,
        [referredBy, result.rows[0].id]
      );
    }
    await pool.query('INSERT INTO paper_accounts (user_id) VALUES ($1)', [result.rows[0].id]);
    sendWelcomeEmail(email, fullName).catch(err => console.error('[MAILER] Welcome email failed:', err.message));
    emailSequenceService.enrollUserInOnboarding(result.rows[0].id).catch(err => console.error('[EMAIL SEQ] Onboarding enrollment failed:', err.message));
    const token = generateToken(result.rows[0].id);
    const refreshToken = await generateRefreshToken(result.rows[0].id);
    setRefreshCookie(res, refreshToken);
    res.status(201).json({ user: result.rows[0], token });
  } catch (error) {
    console.error('Register error:', error && error.stack ? error.stack : error);
    res.status(500).json({ error: 'Registration failed' });
  }
});

// ─── Rate limiting for login ───
const loginAttempts = new Map();
const LOGIN_MAX_ATTEMPTS = 5;
const LOGIN_WINDOW_MS = 60 * 1000; // 1 minute
const LOGIN_BAN_MS = 15 * 60 * 1000; // 15 minute lockout
function getClientIp(req) {
  return req.headers['x-forwarded-for']?.split(',')[0]?.trim() || req.ip || req.connection?.remoteAddress || 'unknown';
}
function checkLoginRateLimit(email, ip) {
  const key = email.toLowerCase();
  const now = Date.now();
  let entry = loginAttempts.get(key);
  if (!entry) { entry = { ip, count: 0, firstAttempt: now, bannedUntil: 0 }; loginAttempts.set(key, entry); }
  // Cleanup old entries periodically
  if (loginAttempts.size > 10000) {
    for (const [k, v] of loginAttempts) {
      if (now - v.firstAttempt > LOGIN_BAN_MS) loginAttempts.delete(k);
    }
  }
  if (entry.bannedUntil > now) return { blocked: true, remaining: 0, banExpires: entry.bannedUntil };
  // Reset window if past window
  if (now - entry.firstAttempt > LOGIN_WINDOW_MS) { entry.count = 0; entry.firstAttempt = now; }
  entry.count++;
  const remaining = LOGIN_MAX_ATTEMPTS - entry.count;
  if (entry.count > LOGIN_MAX_ATTEMPTS) {
    entry.bannedUntil = now + LOGIN_BAN_MS;
    return { blocked: true, remaining: 0, banExpires: entry.bannedUntil };
  }
  return { blocked: false, remaining, banExpires: 0 };
}
async function logAdminAction(adminId, email, action, ip, userAgent, details, success) {
  try {
    await pool.query(
      `INSERT INTO admin_audit_log (admin_id, email, action, ip_address, user_agent, details, success)
       VALUES ($1, $2, $3, $4, $5, $6, $7)`,
      [adminId, email, action, ip, userAgent, details ? JSON.stringify(details) : null, success]
    );
  } catch {}
}

async function logUserActivity(userId, email, fullName, action, details, ip) {
  try {
    const r = await pool.query(
      `INSERT INTO user_activity_log (user_id, email, full_name, action, details, ip_address)
       VALUES ($1, $2, $3, $4, $5, $6) RETURNING id, created_at`,
      [userId, email, fullName, action, details ? JSON.stringify(details) : null, ip]
    );
    const row = r.rows[0];
    io.to('support:staff').emit('user_activity', {
      id: row.id,
      user_id: userId,
      email,
      full_name: fullName,
      action,
      details: details || null,
      created_at: row.created_at
    });
  } catch {}
}

// General OTP login (for React frontend)
app.post('/api/auth/send-otp', async (req, res) => {
  try {
    const { email } = req.body;
    if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return res.status(400).json({ error: 'Valid email required' });
    const code = Math.floor(100000 + Math.random() * 900000).toString();
    const expiresAt = new Date(Date.now() + 10 * 60 * 1000);
    await pool.query('DELETE FROM otp_codes WHERE email = $1 AND type = $2', [email, 'login']);
    await pool.query('INSERT INTO otp_codes (email, code, type, expires_at) VALUES ($1, $2, $3, $4)', [email, code, 'login', expiresAt]);
    console.log(`[OTP] Login code for ${email}: ${code}`);
    // Send email in the background so the UI responds immediately even if the mailer is slow/fails
    sendOtpEmail(email, code).catch(e => console.error('[MAILER] send-otp failed:', e.message));
    res.json({ message: 'OTP sent to email', expiresIn: 600 });
  } catch (error) {
    console.error('send-otp error:', error.message);
    res.status(500).json({ error: 'Failed to send OTP' });
  }
});

app.post('/api/auth/verify-otp', async (req, res) => {
  try {
    const { email, code } = req.body;
    if (!email || !code) return res.status(400).json({ error: 'Email and code required' });
    const result = await pool.query(
      'SELECT * FROM otp_codes WHERE email = $1 AND code = $2 AND type = $3 AND used = FALSE AND expires_at > NOW()',
      [email, code, 'login']
    );
    if (result.rows.length === 0) return res.status(401).json({ error: 'Invalid or expired OTP' });
    await pool.query('UPDATE otp_codes SET used = TRUE WHERE id = $1', [result.rows[0].id]);
    let userResult = await pool.query('SELECT id, full_name, email, role, trader_type, is_verified, created_at, subscription_tier, subscription_status, trial_start_date, subscription_end_date FROM users WHERE email = $1', [email]);
    if (userResult.rows.length === 0) {
      userResult = await pool.query(
        'INSERT INTO users (full_name, email, password_hash, is_verified, trial_start_date) VALUES ($1, $2, $3, TRUE, NOW()) RETURNING id, full_name, email, role, trader_type, is_verified, created_at, trial_start_date, subscription_end_date, commitment_fee_paid',
        [email, email, 'otp_only']
      );
      await pool.query('INSERT INTO paper_accounts (user_id) VALUES ($1)', [userResult.rows[0].id]);
    }
    const user = userResult.rows[0];
    const token = generateToken(user.id);
    const refreshToken = await generateRefreshToken(user.id);
    setRefreshCookie(res, refreshToken);
    logUserActivity(user.id, email, user.full_name, 'login', null, req.ip);
    res.json({ user, token });
  } catch (error) {
    console.error('verify-otp error:', error.message);
    res.status(500).json({ error: 'OTP verification failed' });
  }
});

// Password-verified OTP login (frontend default): verify credentials, then email OTP
app.post('/api/auth/login-request-otp', async (req, res) => {
  try {
    const { email, password } = req.body;
    if (!email || !password) return res.status(400).json({ error: 'Email and password required' });
    const ip = getClientIp(req);
    const ua = req.headers['user-agent'] || '';
    const limit = checkLoginRateLimit(email, ip);
    if (limit.blocked) {
      const banSecs = Math.ceil((limit.banExpires - Date.now()) / 1000);
      await logAdminAction(null, email, 'login_blocked', ip, ua, { reason: 'rate_limit', banSecs }, false);
      return res.status(429).json({ error: `Too many attempts. Try again in ${banSecs}s.`, code: 'RATE_LIMITED', banExpires: limit.banExpires });
    }
    const result = await pool.query('SELECT * FROM users WHERE email = $1', [email]);
    if (result.rows.length === 0) {
      await logAdminAction(null, email, 'login_failed', ip, ua, { reason: 'user_not_found' }, false);
      return res.status(401).json({ error: 'Invalid credentials' });
    }
    const user = result.rows[0];
    const valid = await bcrypt.compare(password, user.password_hash);
    if (!valid) {
      await logAdminAction(user.id, email, 'login_failed', ip, ua, { reason: 'wrong_password', remaining: limit.remaining - 1 }, false);
      return res.status(401).json({ error: 'Invalid credentials' });
    }
    const code = Math.floor(100000 + Math.random() * 900000).toString();
    const expiresAt = new Date(Date.now() + 10 * 60 * 1000);
    await pool.query('DELETE FROM otp_codes WHERE email = $1 AND type = $2', [email, 'login_password']);
    await pool.query('INSERT INTO otp_codes (email, code, type, expires_at) VALUES ($1, $2, $3, $4)', [email, code, 'login_password', expiresAt]);
    console.log(`[OTP] Login code for ${email}: ${code}`);
    // Send email in the background so the UI responds immediately even if the mailer is slow/fails
    sendOtpEmail(email, code).catch(e => console.error('[MAILER] login-request-otp failed:', e.message));
    res.json({ message: 'OTP sent to email', expiresIn: 600 });
  } catch (error) {
    console.error('login-request-otp error:', error && error.stack ? error.stack : error);
    res.status(500).json({ error: 'Failed to send login OTP' });
  }
});

app.post('/api/auth/login-verify-otp', async (req, res) => {
  try {
    const { email, code } = req.body;
    if (!email || !code) return res.status(400).json({ error: 'Email and code required' });
    const result = await pool.query(
      'SELECT * FROM otp_codes WHERE email = $1 AND code = $2 AND type = $3 AND used = FALSE AND expires_at > NOW()',
      [email, code, 'login_password']
    );
    if (result.rows.length === 0) return res.status(401).json({ error: 'Invalid or expired OTP' });
    await pool.query('UPDATE otp_codes SET used = TRUE WHERE id = $1', [result.rows[0].id]);
    const userResult = await pool.query(
      'SELECT id, full_name, email, role, trader_type, is_verified, created_at, subscription_tier, subscription_status, trial_start_date, subscription_end_date FROM users WHERE email = $1',
      [email]
    );
    if (userResult.rows.length === 0) return res.status(401).json({ error: 'User not found' });
    const user = userResult.rows[0];
    if (!user.subscription_tier) user.subscription_tier = 'free';
    if (!user.trial_start_date) user.trial_start_date = user.created_at;
    const token = generateToken(user.id);
    const refreshToken = await generateRefreshToken(user.id);
    setRefreshCookie(res, refreshToken);
    const ip = getClientIp(req);
    await logUserActivity(user.id, email, user.full_name, 'login', null, ip);
    loginAttempts.delete(email.toLowerCase());
    res.json({ user, token });
  } catch (error) {
    console.error('login-verify-otp error:', error && error.stack ? error.stack : error);
    res.status(500).json({ error: 'OTP verification failed' });
  }
});

app.post('/api/auth/login', async (req, res) => {
  try {
    const { email, password } = req.body;
    if (!email || !password) return res.status(400).json({ error: 'Email and password required' });
    const ip = getClientIp(req);
    const ua = req.headers['user-agent'] || '';
    // Rate limit check
    const limit = checkLoginRateLimit(email, ip);
    if (limit.blocked) {
      const banSecs = Math.ceil((limit.banExpires - Date.now()) / 1000);
      await logAdminAction(null, email, 'login_blocked', ip, ua, { reason: 'rate_limit', banSecs }, false);
      return res.status(429).json({ error: `Too many attempts. Try again in ${banSecs}s.`, code: 'RATE_LIMITED', banExpires: limit.banExpires });
    }
    const result = await pool.query('SELECT * FROM users WHERE email = $1', [email]);
    if (result.rows.length === 0) {
      await logAdminAction(null, email, 'login_failed', ip, ua, { reason: 'user_not_found' }, false);
      return res.status(401).json({ error: 'Invalid credentials' });
    }
    const user = result.rows[0];
    const valid = await bcrypt.compare(password, user.password_hash);
    if (!valid) {
      await logAdminAction(user.id, email, 'login_failed', ip, ua, { reason: 'wrong_password', remaining: limit.remaining - 1 }, false);
      return res.status(401).json({ error: 'Invalid credentials' });
    }
const { password_hash, ...safeUser } = user;
    if (!safeUser.subscription_tier) safeUser.subscription_tier = 'free';
    if (!safeUser.trial_start_date) safeUser.trial_start_date = safeUser.created_at;
    // Admin logins via OTP only; this endpoint is for regular app users
    const token = generateToken(user.id);
    const refreshToken = await generateRefreshToken(user.id);
    setRefreshCookie(res, refreshToken);
    // Log successful login
    if (user.role === 'admin') {
      await logAdminAction(user.id, email, 'login_success', ip, ua, null, true);
    }
    await logUserActivity(user.id, email, user.full_name, 'login', null, ip);
    // Reset rate limit on success
    loginAttempts.delete(email.toLowerCase());
    res.json({ user: safeUser, token });
  } catch (error) {
    console.error('Login error:', error && error.stack ? error.stack : error);
    res.status(500).json({ error: 'Login failed' });
  }
});

// Admin logout — blacklists token client-side, logs the action
app.post('/api/admin/logout', authenticateToken, requireAdmin, async (req, res) => {
  try {
    const ip = getClientIp(req);
    const ua = req.headers['user-agent'] || '';
    await logAdminAction(req.user.id, req.user.email, 'logout', ip, ua, null, true);
    res.json({ message: 'Logged out' });
  } catch { res.json({ message: 'Logged out' }); }
});

// --- Refresh token & Logout ---
app.post('/api/auth/refresh', async (req, res) => {
  try {
    const rawToken = req.cookies?.refresh_token;
    if (!rawToken) return res.status(401).json({ error: 'No refresh token', code: 'NO_REFRESH_TOKEN' });
    const { verifyRefreshToken } = require('./auth');
    const userId = await verifyRefreshToken(rawToken);
    if (!userId) return res.status(401).json({ error: 'Invalid or expired refresh token', code: 'INVALID_REFRESH_TOKEN' });
    const token = generateToken(userId);
    const userResult = await pool.query(
      'SELECT id, full_name, email, role, trader_type, is_verified, subscription_tier, subscription_status, trial_start_date, subscription_end_date, commitment_fee_paid FROM users WHERE id = $1',
      [userId]
    );
    if (userResult.rows.length === 0) return res.status(401).json({ error: 'User not found', code: 'USER_NOT_FOUND' });
    res.json({ user: userResult.rows[0], token });
  } catch (error) {
    console.error('[AUTH] Refresh error:', error.message);
    res.status(401).json({ error: 'Refresh failed', code: 'REFRESH_FAILED' });
  }
});

app.post('/api/auth/logout', async (req, res) => {
  try {
    const rawToken = req.cookies?.refresh_token;
    if (rawToken) {
      await revokeRefreshTokenByHash(rawToken);
    }
    clearRefreshCookie(res);
    res.json({ message: 'Logged out' });
  } catch (error) {
    console.error('[AUTH] Logout error:', error.message);
    res.json({ message: 'Logged out' });
  }
});

app.get('/api/auth/me', authenticateToken, async (req, res) => {
  try {
    res.json({ user: req.user });
  } catch (error) {
    res.status(500).json({ error: 'An unexpected error occurred' });
  }
});

// --- OTP & Password Reset ---
app.post('/api/auth/forgot-password', async (req, res) => {
  try {
    const { email } = req.body;
    if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return res.status(400).json({ error: 'Valid email required' });
    const exists = await pool.query('SELECT id FROM users WHERE email = $1', [email]);
    if (exists.rows.length === 0) return res.status(404).json({ error: 'No account with this email' });
    const code = Math.floor(100000 + Math.random() * 900000).toString();
    const expiresAt = new Date(Date.now() + 15 * 60 * 1000);
    await pool.query('DELETE FROM otp_codes WHERE email = $1 AND type = $2', [email, 'password_reset']);
    await pool.query('INSERT INTO otp_codes (email, code, type, expires_at) VALUES ($1, $2, $3, $4)', [email, code, 'password_reset', expiresAt]);
    console.log(`[OTP] Password reset code for ${email}: ${code}`);
    await sendResetCode(email, code).catch(e => console.error('[MAILER] forgot-password failed:', e.message));
    res.json({ message: 'Reset code sent to email', expiresIn: 900 });
  } catch (error) {
    console.error('forgot-password error:', error.message);
    res.status(500).json({ error: 'Failed to send reset code' });
  }
});

app.post('/api/auth/reset-password', async (req, res) => {
  try {
    const { email, code, newPassword } = req.body;
    if (!email || !code || !newPassword) return res.status(400).json({ error: 'Email, code, and new password required' });
    if (newPassword.length < 6) return res.status(400).json({ error: 'Password must be at least 6 characters' });
    const result = await pool.query(
      'SELECT * FROM otp_codes WHERE email = $1 AND code = $2 AND type = $3 AND used = FALSE AND expires_at > NOW()',
      [email, code, 'password_reset']
    );
    if (result.rows.length === 0) return res.status(401).json({ error: 'Invalid or expired reset code' });
    await pool.query('UPDATE otp_codes SET used = TRUE WHERE id = $1', [result.rows[0].id]);
    const hashedPassword = await bcrypt.hash(newPassword, 10);
    await pool.query('UPDATE users SET password_hash = $1 WHERE email = $2', [hashedPassword, email]);
    res.json({ message: 'Password reset successful' });
  } catch (error) {
    console.error('reset-password error:', error.message);
    res.status(500).json({ error: 'Password reset failed' });
  }
});

// --- Subscription Check Middleware ---
async function requireActiveSubscription(req, res, next) {
  try {
    // If JWT auth is present, use req.user.id
    let userId = req.user?.id;
    // Fallback for legacy requests (should be removed once frontend uses JWT everywhere)
    if (!userId) {
      userId = req.query.userId || req.body.userId || req.headers['x-user-id'];
      if (!userId) {
        const fullPath = req.originalUrl || req.url || req.path;
        const pathMatch = fullPath.match(/\/users\/(\d+)/);
        if (pathMatch) userId = pathMatch[1];
      }
    }
    if (!userId) {
      return res.status(401).json({ error: 'Authentication required', code: 'NO_USER_ID' });
    }
    const result = await pool.query(
      'SELECT subscription_tier, subscription_status, trial_start_date FROM users WHERE id = $1',
      [userId]
    );
    if (result.rows.length === 0) {
      return res.status(401).json({ error: 'User not found', code: 'USER_NOT_FOUND' });
    }
    const { subscription_tier, subscription_status, trial_start_date } = result.rows[0];
    const hasPaid = subscription_status === 'active' && subscription_tier !== 'free' && subscription_tier !== null;
    const inTrial = trial_start_date && (Date.now() - new Date(trial_start_date).getTime()) < 7 * 24 * 60 * 60 * 1000;
    if (!hasPaid && !inTrial) {
      return res.status(403).json({
        error: 'Active subscription required. Please subscribe to continue using the app.',
        code: 'SUBSCRIPTION_REQUIRED',
        subscription_tier: subscription_tier || 'free',
        subscription_status: subscription_status || 'inactive'
      });
    }
    next();
  } catch (error) {
    console.error('requireActiveSubscription error:', error.message);
    res.status(500).json({ error: 'Failed to verify subscription status' });
  }
}

// --- Activity Logging ---

app.post('/api/activity/log', async (req, res) => {
  try {
    const { userId, action, details } = req.body;
    if (!userId || !action) return res.status(400).json({ error: 'userId and action required' });
    if (!['page_view', 'signal_view', 'watchlist_add', 'watchlist_remove', 'search', 'news_read', 'portfolio_view', 'settings_change', 'logout'].includes(action)) {
      return res.status(400).json({ error: 'Invalid action type' });
    }
    const user = await pool.query('SELECT email, full_name FROM users WHERE id = $1', [userId]);
    if (!user.rows.length) return res.status(404).json({ error: 'User not found' });
    await logUserActivity(userId, user.rows[0].email, user.rows[0].full_name, action, details, req.ip);
    res.json({ ok: true });
  } catch (error) {
    res.status(500).json({ error: 'An unexpected error occurred' });
  }
});

// --- Stock Tracking Routes (for conversion prompts) ---

app.post('/api/stock-tracking/view', authenticateToken, async (req, res) => {
  try {
    const { ticker } = req.body;
    if (!ticker) return res.status(400).json({ error: 'ticker required' });
    const userId = req.user.userId;
    await pool.query(
      `INSERT INTO user_stock_views (user_id, ticker, viewed_date)
       VALUES ($1, $2, CURRENT_DATE)
       ON CONFLICT (user_id, ticker, viewed_date) DO NOTHING`,
      [userId, ticker.toUpperCase()]
    );
    res.json({ ok: true });
  } catch (error) {
    res.status(500).json({ error: 'Failed to record stock view' });
  }
});

app.get('/api/stock-tracking/consecutive-days', authenticateToken, async (req, res) => {
  try {
    const { ticker } = req.query;
    if (!ticker) return res.status(400).json({ error: 'ticker query param required' });
    const userId = req.user.userId;
    const result = await pool.query(`
      SELECT viewed_date, COUNT(*) OVER () as total_days,
             viewed_date = CURRENT_DATE as viewed_today
      FROM user_stock_views
      WHERE user_id = $1 AND ticker = $2
        AND viewed_date >= CURRENT_DATE - INTERVAL '5 days'
      ORDER BY viewed_date DESC
    `, [userId, ticker.toUpperCase()]);
    const days = result.rows.map(r => r.viewed_date);
    let consecutiveCount = 0;
    for (let i = 0; i < days.length; i++) {
      const expectedDate = new Date();
      expectedDate.setDate(expectedDate.getDate() - i);
      const dayStr = expectedDate.toISOString().split('T')[0];
      if (new Date(days[i]).toISOString().split('T')[0] === dayStr) {
        consecutiveCount++;
      } else {
        break;
      }
    }
    const user = await pool.query('SELECT subscription_tier, subscription_status FROM users WHERE id = $1', [userId]);
    const isFreeUser = !user.rows[0] || user.rows[0].subscription_tier === 'free';
    res.json({
      ticker: ticker.toUpperCase(),
      consecutiveDays: consecutiveCount,
      qualifiesForPrompt: consecutiveCount >= 3 && isFreeUser,
      viewedToday: result.rows.some(r => {
        const today = new Date().toISOString().split('T')[0];
        return new Date(r.viewed_date).toISOString().split('T')[0] === today;
      }),
    });
  } catch (error) {
    res.status(500).json({ error: 'Failed to check consecutive days' });
  }
});

app.post('/api/stock-tracking/dismiss-prompt', authenticateToken, async (req, res) => {
  try {
    const { ticker } = req.body;
    const userId = req.user.userId;
    await pool.query(
      `INSERT INTO user_dismissed_prompts (user_id, prompt_type, ticker)
       VALUES ($1, 'consecutive_view', $2)
       ON CONFLICT (user_id, prompt_type, ticker) DO NOTHING`,
      [userId, ticker ? ticker.toUpperCase() : null]
    );
    res.json({ ok: true });
  } catch (error) {
    res.status(500).json({ error: 'Failed to dismiss prompt' });
  }
});

app.get('/api/stock-tracking/prompt-status', authenticateToken, async (req, res) => {
  try {
    const { ticker } = req.query;
    const userId = req.user.userId;
    if (!ticker) return res.json({ dismissed: false });
    const result = await pool.query(
      `SELECT id FROM user_dismissed_prompts
       WHERE user_id = $1 AND prompt_type = 'consecutive_view' AND ticker = $2`,
      [userId, ticker.toUpperCase()]
    );
    res.json({ dismissed: result.rows.length > 0 });
  } catch (error) {
    res.status(500).json({ error: 'Failed to check prompt status' });
  }
});

// --- Support Routes ---

const FAQ_ITEMS = [
  { question: "How do I reset my password?", answer: "Click 'Forgot password?' on the login page, enter your email, and follow the instructions sent to your inbox. The reset code expires in 15 minutes.", category: "account" },
  { question: "How do I start trading on the paper account?", answer: "Navigate to the Portfolio page and you'll see your paper trading account with KES 1,000,000 in virtual funds. Use the Trade panel to buy/sell stocks.", category: "trading" },
  { question: "Why are some stock prices not loading?", answer: "Market data comes from third-party APIs that have rate limits. If you see stale data, wait a few minutes and refresh. NSE stocks update during market hours (9:30 AM - 3:00 PM EAT).", category: "data" },
  { question: "What markets do you support?", answer: "We cover the Nairobi Securities Exchange (NSE) with 22+ stocks, plus major US exchanges (NYSE, NASDAQ) for global equities, bonds, and ETFs.", category: "markets" },
  { question: "How do AI trading signals work?", answer: "Our signal engine analyzes technical indicators (RSI, MACD, moving averages), market sentiment, and fundamental data to generate Buy/Hold/Sell signals with confidence scores.", category: "signals" },
  { question: "Can I connect a real brokerage account?", answer: "Go to Settings > Brokers to connect supported brokers. Currently we support interactive brokers integration. More brokers coming soon.", category: "account" },
  { question: "How do I create and join groups?", answer: "Go to the Chat & Groups page and click 'Create Group' or browse existing groups. Groups allow you to share signals, discuss trades, and collaborate.", category: "social" },
  { question: "Why does the screener show different results?", answer: "The screener filters stocks based on your selected criteria (market cap, sector, price, technical signals). Broader criteria return more results.", category: "data" },
  { question: "How does the dashboard work?", answer: "Your **Dashboard** shows your portfolio value, market indices (NSE 20, S&P 500), sector performance, top gainers/losers, watchlist stocks, AI signals distribution, market sentiment pulse bars, and a news ticker. It's your command center for everything happening in the markets.", category: "dashboard" },
  { question: "How do I use the portfolio page?", answer: "The **Portfolio** page displays all your holdings across NSE and global markets with real-time valuations. You'll see allocation pie charts, performance vs benchmarks (NSE 20, S&P 500), realized/unrealized P&L, trade history, portfolio statements, and AI-powered rebalancing recommendations.", category: "portfolio" },
  { question: "How do paper trading orders work?", answer: "On the **Portfolio** page, use the Trade panel to place buy/sell orders. You get KES 1,000,000 in virtual funds. You can set market or limit prices, track open positions, view your trade history, and even reset the account to start over. Perfect for practicing without real money!", category: "trading" },
  { question: "How do I use the watchlist?", answer: "Go to **Watchlist** from the sidebar. Type a stock name or ticker in the search bar to add it. Your watchlist shows live prices, price changes, and signal overlays. You can set target prices and remove stocks anytime.", category: "dashboard" },
  { question: "What is the stock screener?", answer: "The **Stock Screener** (in Markets > Stocks) lets you filter stocks by market (NSE, NYSE, NASDAQ), sector, price range, change %, volume, P/E ratio, dividend yield, AI score, and signal type. Results update in real-time with table and grid views.", category: "markets" },
  { question: "What exchanges do you cover?", answer: "We cover **NSE** (Nairobi Securities Exchange), **NYSE** (New York Stock Exchange), **NASDAQ**, **LSE** (London), **JSE** (Johannesburg), **GSE** (Ghana), **NGX** (Nigeria), **TSE** (Tokyo), and **HKEX** (Hong Kong). Browse them under Markets > Stocks > Exchanges.", category: "markets" },
  { question: "How do I read trading signals?", answer: "Each signal shows: **Type** (Intraday, Swing, Long Term), **Rating** (Strong Buy to Strong Sell), **Confidence** (0-100%), **Entry price**, **Stop-loss**, **Target 1 & 2**, and **Risk/Reward** ratio. The signal also includes fundamental, technical, growth, and balance sheet analysis plus news sentiment.", category: "signals" },
  { question: "What are the signal types?", answer: "We have **Intraday** (same-day trades), **Swing Trade** (multi-day to weeks), and **Long Term** (months to years) signals. Each is rated Strong Buy, Buy, Accumulate, Hold, Sell, or Strong Sell with a confidence percentage.", category: "signals" },
  { question: "How does the AI signal engine work?", answer: "Our engine scores stocks on multiple dimensions: **Technical** (RSI, MACD, SMA trends), **Fundamental** (PE vs sector, EV/EBITDA, dividend yield), **Growth** (revenue, EPS, margins, FCF), **Balance Sheet** (D/E ratio, current ratio, ROE, Altman Z-score), **Insider Activity**, and **News Sentiment** via NLP. All combined into a final recommendation.", category: "signals" },
  { question: "How do I use the chat and groups feature?", answer: "Go to **Chat & Groups** from the sidebar. You'll find public group chat rooms like 'nse-traders', 'safaricom', 'banking', 'tech-picks', and more. Join a room to discuss trades with others. You can also send direct messages to other users and create your own trading groups.", category: "social" },
  { question: "How do I create a group?", answer: "On the **Groups** page, click 'Create Group'. Give it a name, description, and topic (General, Trading, Finance, Technology, Telecom, Income). Other users can find and join your group.", category: "social" },
  { question: "How do I find and follow people?", answer: "The **People** page lets you browse all traders. View profiles with trader type (Value, Growth, Day Trader, Analyst), expertise, top picks, and follower counts. Click 'Follow' to get updates. You can also start a direct message from their profile.", category: "social" },
  { question: "How do I view a stock's detailed analysis?", answer: "Click on any stock symbol or search for it. The **Stock Analysis** page shows interactive price charts (1D to ALL), real-time quote, AI signal with scores, technical indicators (RSI, MACD, SMA, ATR, Bollinger Bands), and fundamental details (market cap, PE ratio, dividend yield, day range, volume).", category: "stocks" },
  { question: "What bonds are available?", answer: "We track **Government bonds** (Kenya & US), **Infrastructure bonds**, **Corporate bonds**, and **Treasury Bills** (91, 182, 364-day). Each shows coupon rate, YTM, maturity date, price, and credit rating. The **Bonds** page also shows a yield curve comparing Kenya vs US.", category: "markets" },
  { question: "What ETFs do you cover?", answer: "Browse **ETFs** by category. Each shows expense ratio, AUM, dividend yield, price, and change. The page highlights top gainers/losers and largest AUM funds. Filter by market and category.", category: "markets" },
  { question: "How does the news section work?", answer: "The **News** page aggregates financial news from multiple sources with sentiment analysis (positive/negative/neutral). Filter by All, NSE, Global, Positive, or Negative. News auto-refreshes every 60 seconds. Each article shows related stock mentions.", category: "news" },
  { question: "How do I view financial reports?", answer: "The **Financials** page lets you search any company to view their **Income Statement**, **Balance Sheet**, **Cash Flow Statement**, **Key Metrics** (PE, PB, ROE, EPS), and **Dividend History**. Data comes from SimFin, Yahoo Finance, and SEC Edgar filings.", category: "stocks" },
  { question: "What settings can I change?", answer: "In **Settings** you can: edit your profile (name, email, phone, bio, location, trader type, experience level), manage notification preferences (price alerts, signals, news, portfolio, chat), toggle appearance (dark mode, compact view), change your password, and set privacy controls.", category: "account" },
  { question: "How do notifications work?", answer: "You'll receive notifications for new trading signals, price alerts, and system updates. The bell icon in the header shows unread count. Click to view all, mark individual as read, or mark all read. Real-time updates arrive via WebSocket.", category: "account" },
  { question: "How do I connect a broker?", answer: "Go to **Settings > Brokers** to connect real brokerage accounts. Supported: Alpaca, Interactive Brokers (IBKR), MetaTrader 5, OANDA, Tradier, and manual entry for African brokers like AIB-AXYS and Hisa. Credentials are encrypted with AES-256-GCM.", category: "account" },
  { question: "What subscription plans are available?", answer: "We offer **Starter** ($10/mo) for real-time African + global data with the stock screener, **Premium** ($7.99/mo) for unlimited NSE signals + 10 global/day, **Pro** ($14.99/mo) for unlimited everything with advanced charting and risk scoring, and **Institutional** (custom from $200/mo) for brokers and funds. Start a 7-day trial for just $1. Pay via M-Pesa or card.", category: "account" },
  { question: "How do M-Pesa payments work?", answer: "On the subscription page, select M-Pesa as your payment method. Enter your M-Pesa phone number and you'll receive an STK push prompt on your phone. Confirm the payment and your subscription activates immediately.", category: "account" },
  { question: "What is the AI Insights page?", answer: "**AI Insights** is a conversational AI analyst. Ask questions like 'Analyze Safaricom trend', 'Best NSE momentum stocks', or 'Outlook for banking sector'. It responds with data-driven market analysis.", category: "signals" },
  { question: "How does sector analysis work?", answer: "The **Sectors** page shows performance by sector/industry with bar charts. Filter by NSE or Global markets. Each sector shows leading stocks, sentiment indicators, and volume analysis.", category: "markets" },
  { question: "What is the earnings calendar?", answer: "The **Earnings Calendar** shows upcoming earnings reports with dates, estimated vs actual EPS, surprise percentage, and market cap. Navigate by month to see what's coming up.", category: "stocks" },
  { question: "How do I view analyst ratings?", answer: "The **Top Analysts** page lists analyst firms with their stock ratings and target prices. See rating distribution (Strong Buy through Sell) for each stock. Track historical recommendation performance.", category: "signals" },
  { question: "What technical indicators are available?", answer: "Each stock's analysis page includes **RSI** (Relative Strength Index), **MACD** (Moving Average Convergence Divergence), **SMA** (Simple Moving Average), **ATR** (Average True Range), and **Bollinger Bands**. These help identify trends, momentum, and volatility.", category: "stocks" },
  { question: "How do I use the support ticket system?", answer: "On the **Support Center** page, go to the 'Contact Us' tab and fill out the ticket form with your email, subject, category, priority, and message. Track your ticket status in the 'My Tickets' tab. You'll get updates as staff responds.", category: "support" },
  { question: "How do I browse stocks by industry?", answer: "Go to **Markets > Stocks > Industries**. Stocks are grouped by industry/sector showing average change, volume, and AI score per industry. Searchable and sortable.", category: "markets" },
  { question: "What are top stocks?", answer: "The **Top Stocks** page ranks stocks by AI score, volume, and other performance metrics. Visual indicators show top performers with trophy/award badges. Great for discovering the best opportunities.", category: "signals" },
  { question: "How do I use the market movers?", answer: "The **Markets** page shows top gainers and losers for both NSE and Global markets. Each mover shows the stock name, price, change percentage, and volume. Updated in real-time during market hours.", category: "markets" },
  { question: "How do I track my portfolio performance?", answer: "Your **Portfolio** page shows an interactive area chart comparing your performance against NSE 20 and S&P 500 benchmarks. Below that, your holdings table shows each position with current value, P&L, and allocation percentage.", category: "portfolio" },
  { question: "What is the market pulse?", answer: "The **Market Pulse** shows AI-generated sentiment scores for NSE and Global markets. You'll see bearish/neutral/bullish indicators, leading sectors, and an AI market summary with confidence scores. Visible on both the Dashboard and Markets pages.", category: "markets" },
  { question: "How does portfolio rebalancing work?", answer: "Our AI analyzes your current holdings and suggests rebalancing trades to optimize your allocation. Access this from your Portfolio page via the 'AI Advice & Rebalancing' section. It considers your risk profile and current market conditions.", category: "portfolio" },
  { question: "Can I export my portfolio data?", answer: "The **Portfolio** page offers statements including trade history, account summary, and performance reports. You can view detailed breakdowns of realized/unrealized gains, fees, and allocation.", category: "portfolio" },
  { question: "How do I update notification preferences?", answer: "Go to **Settings > Notifications**. Toggle alerts for: price alerts, trading signals, market news, portfolio updates, and chat messages. Changes apply immediately.", category: "account" },
  { question: "How do I change my password?", answer: "Go to **Settings > Security**. Enter your current password and new password. Must be at least 8 characters. You'll also receive a confirmation email.", category: "account" },
  { question: "Is dark mode available?", answer: "Yes! Go to **Settings > Appearance** and toggle Dark Mode. You can also enable Compact View for a denser layout. Your preference is saved across sessions.", category: "account" },
  { question: "How do I see what other traders are doing?", answer: "The **People** page shows trader profiles with their trader type, expertise, and top picks. Follow traders to track their activity. You can also see online status and start direct conversations.", category: "social" },
  { question: "How do I start a direct message?", answer: "Go to **Chat & Groups** and search for a user, or go to **People** and click on a trader's profile. From there you can send a direct message. You can also click the chat icon next to their name anywhere in the app.", category: "social" },
  { question: "What is the NSE market schedule?", answer: "The **NSE** trades Monday to Friday, 9:30 AM to 3:30 PM East Africa Time (EAT). Closed on weekends and Kenyan public holidays. The **Dashboard** shows live market status (Open/Closed).", category: "markets" },
  { question: "What is the US market schedule?", answer: "**US markets** (NYSE, NASDAQ) trade Monday to Friday, 9:30 AM to 4:00 PM Eastern Time (ET). Pre-market 4:00-9:30 AM, after-hours 4:00-8:00 PM. Closed on US public holidays.", category: "markets" },
  { question: "How does the AI chat assistant work?", answer: "The **AI Chat Assistant** on the AI Insights page uses natural language understanding to answer your market questions. Try asking 'Analyze Safaricom trend', 'Best NSE momentum stocks', or 'What is the outlook for the banking sector?'", category: "signals" },
  { question: "How do I register an account?", answer: "Click 'Sign Up' on the login page, enter your name, email, and password. You'll receive a verification email. Once verified, you can start using the app with a free trial.", category: "account" },
  { question: "What is the forex rate?", answer: "The app uses real-time KES/USD exchange rates for cross-currency portfolio valuation. You can check current rates on the Markets page. FX data updates throughout the day.", category: "markets" },
];

app.get('/api/support/faq', (req, res) => {
  const { category } = req.query;
  let items = FAQ_ITEMS;
  if (category && category !== 'all') items = items.filter(i => i.category === category);
  res.json(items);
});

app.post('/api/support/tickets', async (req, res) => {
  try {
    const { email, subject, category, priority, message } = req.body;
    if (!email || !subject || !message) return res.status(400).json({ error: 'Email, subject, and message required' });
    const ticket = await pool.query(
      'INSERT INTO support_tickets (email, subject, category, priority) VALUES ($1, $2, $3, $4) RETURNING *',
      [email, subject, category || 'general', priority || 'normal']
    );
    await pool.query(
      'INSERT INTO support_messages (ticket_id, sender, message) VALUES ($1, $2, $3)',
      [ticket.rows[0].id, email, message]
    );
    res.status(201).json(ticket.rows[0]);
  } catch (error) {
    console.error('create-ticket error:', error.message);
    res.status(500).json({ error: 'Failed to create ticket' });
  }
});

app.get('/api/support/tickets', async (req, res) => {
  try {
    const { email } = req.query;
    if (!email) return res.status(400).json({ error: 'Email required' });
    const tickets = await pool.query(
      'SELECT * FROM support_tickets WHERE email = $1 ORDER BY updated_at DESC',
      [email]
    );
    res.json(tickets.rows);
  } catch (error) {
    console.error('get-tickets error:', error.message);
    res.status(500).json({ error: 'Failed to fetch tickets' });
  }
});

app.get('/api/support/tickets/:id', async (req, res) => {
  try {
    const ticket = await pool.query('SELECT * FROM support_tickets WHERE id = $1', [req.params.id]);
    if (ticket.rows.length === 0) return res.status(404).json({ error: 'Ticket not found' });
    const messages = await pool.query('SELECT * FROM support_messages WHERE ticket_id = $1 ORDER BY created_at ASC', [req.params.id]);
    res.json({ ...ticket.rows[0], messages: messages.rows });
  } catch (error) {
    console.error('get-ticket error:', error.message);
    res.status(500).json({ error: 'Failed to fetch ticket' });
  }
});

app.post('/api/support/tickets/:id/messages', async (req, res) => {
  try {
    const { sender, message } = req.body;
    if (!sender || !message) return res.status(400).json({ error: 'Sender and message required' });
    const ticket = await pool.query('SELECT * FROM support_tickets WHERE id = $1', [req.params.id]);
    if (ticket.rows.length === 0) return res.status(404).json({ error: 'Ticket not found' });
    const msg = await pool.query(
      'INSERT INTO support_messages (ticket_id, sender, message) VALUES ($1, $2, $3) RETURNING *',
      [req.params.id, sender, message]
    );
    await pool.query('UPDATE support_tickets SET updated_at = CURRENT_TIMESTAMP, status = CASE WHEN status = $1 THEN $2 ELSE status END WHERE id = $3',
      ['closed', 'open', req.params.id]);
    res.status(201).json(msg.rows[0]);
  } catch (error) {
    console.error('reply-ticket error:', error.message);
    res.status(500).json({ error: 'Failed to reply' });
  }
});

app.patch('/api/support/tickets/:id/status', async (req, res) => {
  try {
    const { status } = req.body;
    const valid = ['open', 'in_progress', 'resolved', 'closed'];
    if (!valid.includes(status)) return res.status(400).json({ error: 'Invalid status' });
    const ticket = await pool.query(
      'UPDATE support_tickets SET status = $1, updated_at = CURRENT_TIMESTAMP WHERE id = $2 RETURNING *',
      [status, req.params.id]
    );
    if (ticket.rows.length === 0) return res.status(404).json({ error: 'Ticket not found' });
    res.json(ticket.rows[0]);
  } catch (error) {
    console.error('update-ticket-status error:', error.message);
    res.status(500).json({ error: 'Failed to update status' });
  }
});

// --- Support Chat Routes ---
app.get('/api/support/chat/messages', async (req, res) => {
  try {
    const limit = parseInt(req.query.limit) || 50;
    const userId = req.query.userId;
    if (userId && !isNaN(parseInt(userId))) {
      const result = await pool.query(
        'SELECT * FROM support_chat_messages WHERE user_id = $1 ORDER BY created_at DESC LIMIT $2',
        [parseInt(userId), limit]
      );
      res.json(result.rows.reverse());
    } else {
      const result = await pool.query(
        'SELECT * FROM support_chat_messages ORDER BY created_at DESC LIMIT $1',
        [limit]
      );
      res.json(result.rows.reverse());
    }
  } catch (error) {
    console.error('support-chat-messages error:', error.message);
    res.status(500).json({ error: 'Failed to fetch messages' });
  }
});

app.post('/api/support/chat/messages', async (req, res) => {
  try {
    const { userId, userName, email, message } = req.body;
    if (!message || !message.trim()) return res.status(400).json({ error: 'Message required' });
    const result = await pool.query(
      `INSERT INTO support_chat_messages (user_id, user_name, email, message, is_staff)
       VALUES ($1, $2, $3, $4, $5)
       RETURNING id, user_id, user_name, email, message, is_staff, created_at`,
      [userId || null, userName || 'Anonymous', email || '', message.trim(), false]
    );
    res.status(201).json(result.rows[0]);
  } catch (error) {
    console.error('support-chat-post error:', error.message);
    res.status(500).json({ error: 'Failed to send message' });
  }
});

// --- Support Chat: Active conversations & per-user messages ---
app.get('/api/support/chats/active', async (req, res) => {
  try {
    const result = await pool.query(`
      SELECT DISTINCT ON (scm.user_id)
        scm.user_id, scm.user_name, scm.email,
        scm.message AS last_message,
        scm.created_at AS last_activity
      FROM support_chat_messages scm
      WHERE scm.user_id IS NOT NULL
        AND scm.created_at > NOW() - INTERVAL '24 hours'
      ORDER BY scm.user_id, scm.created_at DESC
    `);
    const active = result.rows.sort((a, b) => new Date(b.last_activity) - new Date(a.last_activity));
    res.json(active);
  } catch (error) {
    console.error('active-chats error:', error.message);
    res.status(500).json({ error: 'Failed to fetch active chats' });
  }
});

app.get('/api/support/chats/:userId/messages', async (req, res) => {
  try {
    const { userId } = req.params;
    const limit = parseInt(req.query.limit) || 50;
    const result = await pool.query(
      `SELECT * FROM support_chat_messages
       WHERE user_id = $1
       ORDER BY created_at ASC
       LIMIT $2`,
      [userId, limit]
    );
    res.json(result.rows);
  } catch (error) {
    console.error('user-chat-messages error:', error.message);
    res.status(500).json({ error: 'Failed to fetch messages' });
  }
});

// ── Support Chatbot ──────────────────────────────────────────────────────

/** Knowledge base entries: { keywords[], answer, category } */
const KNOWLEDGE_BASE = [
  {
    keywords: ['password', 'reset', 'forgot', 'change password', 'lost password', 'can\'t login', 'can\'t sign in'],
    answer: 'Click **"Forgot password?"** on the login page, enter your email, and follow the reset link sent to your inbox. The code expires in **15 minutes**. If you don\'t see it, check your spam folder.',
    category: 'account',
  },
  {
    keywords: ['register', 'sign up', 'create account', 'new account', 'join'],
    answer: 'Click **"Sign Up"** on the login page, enter your name, email, and password. After submitting, check your email for a verification link. Once verified, you can log in and start exploring the platform.',
    category: 'account',
  },
  {
    keywords: ['login', 'sign in', 'log in', 'can\'t login', 'can\'t sign in'],
    answer: 'Enter your email and password on the **Login** page. If you forgot your password, click "Forgot password?" to reset it. Still having trouble? Clear your browser cache and try again.',
    category: 'account',
  },
  {
    keywords: ['profile', 'edit profile', 'update profile', 'change name', 'change email', 'bio', 'avatar', 'trader type'],
    answer: 'Go to **Settings** to update your profile: name, email, phone, bio, location, trader type (Value, Growth, Day Trader, Analyst), and experience level. Changes save instantly.',
    category: 'account',
  },
  {
    keywords: ['settings', 'preferences', 'appearance', 'dark mode', 'compact view', 'theme'],
    answer: '**Settings** lets you: edit your profile, manage notification preferences, toggle **Dark Mode** or **Compact View**, change your password, and control privacy settings. Go to Settings from the sidebar.',
    category: 'account',
  },
  {
    keywords: ['notification', 'alert', 'bell', 'price alert', 'signal alert', 'mark read', 'unread'],
    answer: 'The **bell icon** in the header shows your unread notifications. You get alerts for new signals, price movements, and system updates. Click any notification to go to the relevant page. Go to **Settings > Notifications** to customize which alerts you receive.',
    category: 'account',
  },
  {
    keywords: ['subscription', 'plan', 'pricing', 'upgrade', 'downgrade', 'starter', 'pro', 'enterprise', 'institutional', 'premium', 'cost', 'price', 'monthly', 'free'],
    answer: 'Plans: **Starter** ($10/mo) with real-time African + global data + screener, **Premium** ($7.99/mo) for unlimited NSE + 10 global signals/day, **Pro** ($14.99/mo) for unlimited everything + charting + risk scoring, and **Institutional** (from $200/mo) for teams. Start a 7-day trial for just $1. Pay via **M-Pesa** or **card**.',
    category: 'account',
  },
  {
    keywords: ['mpesa', 'm-pesa', 'mobile money', 'payment', 'pay', 'stk push', 'phone payment'],
    answer: 'To pay with **M-Pesa**: go to the subscription page, select M-Pesa, enter your phone number. You\'ll receive an **STK push prompt** on your phone. Confirm the payment and your subscription activates instantly. M-Pesa is available for Kenyan users.',
    category: 'account',
  },
  {
    keywords: ['card payment', 'credit card', 'debit card', 'paypal', 'visa', 'mastercard'],
    answer: 'Pay with **PayPal** via our secure checkout. You will be redirected to PayPal to complete your payment using your PayPal balance or credit/debit card. Your subscription activates instantly upon confirmation.',
    category: 'account',
  },
  {
    keywords: ['paper trading', 'virtual trading', 'practice trading', 'demo account', 'paper account', 'start trading', 'virtual money', 'fake money', 'simulation'],
    answer: 'Go to **Portfolio** to access your paper trading account with **KES 1,000,000** (or USD 10,000) in virtual funds. Use the **Trade panel** to buy and sell stocks at market prices. Track open positions, trade history, and realized P&L. You can **reset** the account anytime to start fresh.',
    category: 'trading',
  },
  {
    keywords: ['paper buy', 'paper sell', 'place order', 'paper order', 'market order', 'limit order', 'paper trade'],
    answer: 'On the **Portfolio** page, use the Trade panel: select Buy or Sell, enter the stock symbol, quantity, and order type (Market or Limit). Market orders execute at the current price. Limit orders execute only at your specified price. Your paper account starts with KES 1,000,000.',
    category: 'trading',
  },
  {
    keywords: ['paper reset', 'reset paper account', 'start over', 'reset portfolio', 'reset trading'],
    answer: 'On the **Portfolio** page, there\'s a "Reset Account" button for your paper trading account. This resets your balance to the initial KES 1,000,000 (or USD 10,000), closes all positions, and clears trade history. Use it to start fresh.',
    category: 'trading',
  },
  {
    keywords: ['market hours', 'trading hours', 'market open', 'market close', 'when does market open', 'when does market close', 'nse hours', 'nse schedule', 'us market hours'],
    answer: '**NSE:** Mon-Fri, 9:30 AM - 3:30 PM EAT\n**US Markets (NYSE/NASDAQ):** Mon-Fri, 9:30 AM - 4:00 PM ET\n**Pre-market:** 4:00-9:30 AM ET\n**After-hours:** 4:00-8:00 PM ET\nBoth closed on weekends and public holidays. Check the **Dashboard** for live market status.',
    category: 'markets',
  },
  {
    keywords: ['signal', 'trading signal', 'ai signal', 'buy signal', 'sell signal', 'how do signals work', 'signal type', 'signal confidence'],
    answer: 'Our **AI signal engine** scores stocks on: **Technical** (RSI, MACD, SMA trends), **Fundamental** (PE, EV/EBITDA, dividend yield), **Growth** (revenue, EPS, margins), **Balance Sheet** (D/E, ROE, Altman Z), **Insider Activity**, and **News Sentiment**. Each signal shows: Type (Intraday/Swing/Long Term), Rating (Strong Buy to Strong Sell), Confidence (0-100%), Entry, Stop-loss, Targets 1 & 2, and Risk/Reward ratio. View all on the **Signals** page.',
    category: 'signals',
  },
  {
    keywords: ['signal types', 'intraday', 'swing trade', 'long term', 'strong buy', 'accumulate', 'strong sell', 'hold'],
    answer: 'Signals are categorized by **timeframe**: Intraday (same day), Swing Trade (days to weeks), Long Term (months to years). Each has a **rating**: Strong Buy, Buy, Accumulate, Hold, Sell, or Strong Sell, plus a **confidence percentage** (0-100%).',
    category: 'signals',
  },
  {
    keywords: ['ai insights', 'ai chat', 'ai analyst', 'ask ai', 'chat with ai', 'ai assistant', 'conversation ai'],
    answer: '**AI Insights** is a conversational AI that answers your market questions in natural language. Try: "Analyze Safaricom trend", "Best NSE momentum stocks", "Outlook for banking sector", or "What stocks are trending today?" Access it from the sidebar.',
    category: 'signals',
  },
  {
    keywords: ['group', 'chat group', 'trading group', 'create group', 'join group', 'leave group', 'room', 'channel'],
    answer: 'Go to **Chat & Groups** to browse public trading rooms like nse-traders, safaricom, banking, tech-picks, dividend-hunters, and day-traders. Click "Create Group" to start your own. Set a topic (General, Trading, Finance, etc.) so others can find you.',
    category: 'social',
  },
  {
    keywords: ['direct message', 'dm', 'private message', 'pm', 'chat user', 'message trader'],
    answer: 'Start a **direct message** by going to a user\'s profile on the **People** page and clicking "Send Message". Or use the Chat page to search for a user. Real-time messaging with typing indicators and online status.',
    category: 'social',
  },
  {
    keywords: ['people', 'trader', 'follow', 'unfollow', 'trader directory', 'find traders', 'top traders', 'expert'],
    answer: 'The **People** page lists all traders with their profile type (Value, Growth, Day Trader, Analyst), expertise, top picks, and follower count. Click **Follow** to track someone\'s activity. You can also see who\'s online and start conversations.',
    category: 'social',
  },
  {
    keywords: ['broker', 'connect broker', 'real account', 'brokerage', 'interactive brokers', 'ibkr', 'alpaca', 'oanda', 'tradier', 'mt5', 'metatrader', 'aib', 'axys', 'hisa'],
    answer: 'Connect real brokerage accounts in **Settings > Brokers**. Supported: **Alpaca** (US API trading), **Interactive Brokers**, **MetaTrader 5**, **OANDA** (forex/CFDs), **Tradier**, and **manual entry** for African brokers like AIB-AXYS and Hisa. Credentials are encrypted with **AES-256-GCM** for security. You can sync positions, balances, and trade history.',
    category: 'account',
  },
  {
    keywords: ['stock', 'stocks', 'ticker', 'symbol', 'price', 'quote', 'company', 'search stock', 'find stock'],
    answer: 'Search any stock by **ticker** (e.g., SCOM, AAPL, NSE:EQTY) or **company name**. The **Stock Analysis** page shows: interactive price charts, real-time quote, AI signal, technical indicators (RSI, MACD, SMA, ATR, Bollinger Bands), and fundamentals (market cap, PE, dividend yield). Browse all stocks on the **Markets** or **Stocks** pages.',
    category: 'stocks',
  },
  {
    keywords: ['technical analysis', 'rsi', 'macd', 'sma', 'moving average', 'atr', 'bollinger', 'indicator', 'chart'],
    answer: 'Each stock\'s **Analysis** page includes: **RSI** (Relative Strength Index) for overbought/oversold, **MACD** for trend direction, **SMA** (Simple Moving Average), **ATR** (Average True Range) for volatility, and **Bollinger Bands** for price ranges. Charts are interactive with 1D/1W/1M/3M/6M/1Y/5Y/ALL timeframes.',
    category: 'stocks',
  },
  {
    keywords: ['financials', 'income statement', 'balance sheet', 'cash flow', 'key metrics', 'pe ratio', 'pb ratio', 'roe', 'eps', 'dividend history', 'financial report'],
    answer: 'The **Financials** page gives you access to: **Income Statement**, **Balance Sheet**, **Cash Flow Statement**, **Key Metrics** (P/E, P/B, ROE, EPS, EV/EBITDA), and **Dividend History** with frequency and yield. Data from SimFin, Yahoo Finance, and SEC Edgar filings.',
    category: 'stocks',
  },
  {
    keywords: ['earnings', 'earnings calendar', 'upcoming earnings', 'eps', 'earnings report', 'quarterly', 'surprise'],
    answer: 'The **Earnings Calendar** shows upcoming earnings reports with dates, estimated vs actual EPS, surprise percentage, market cap, and revenue. Navigate by month to see what\'s coming up.',
    category: 'stocks',
  },
  {
    keywords: ['analyst', 'analyst rating', 'analyst target', 'top analysts', 'rating', 'target price', 'strong buy', 'outperform'],
    answer: 'The **Top Analysts** page lists analyst firms with their stock ratings (Strong Buy through Sell) and target prices. See rating distribution and historical performance for each firm.',
    category: 'signals',
  },
  {
    keywords: ['data', 'price not loading', 'stale data', 'rate limit', 'refresh', 'not updating', 'delayed'],
    answer: 'Market data comes from **third-party APIs** with rate limits. If data appears stale, wait a few minutes and refresh the page. NSE stocks update during market hours (9:30 AM - 3:30 PM EAT). US stocks update during US hours. The system caches data for 60 seconds to reduce API calls.',
    category: 'data',
  },
  {
    keywords: ['portfolio', 'holdings', 'pnl', 'performance', 'return', 'balance', 'portfolio value', 'my stocks', 'allocation'],
    answer: 'Your **Portfolio** page is your command center: view all holdings with real-time values, allocation pie chart, performance vs NSE 20 and S&P 500 benchmarks, realized/unrealized P&L, trade history, portfolio statements, and **AI-powered rebalancing** recommendations. Values in KES with live FX conversion.',
    category: 'portfolio',
  },
  {
    keywords: ['portfolio rebalance', 'ai advice', 'rebalance', 'ai portfolio', 'portfolio advice'],
    answer: 'The **AI Portfolio Advice & Rebalancing** section on your Portfolio page analyzes your current holdings and suggests optimization trades. It considers your risk profile, current allocation, and market conditions to recommend better diversification.',
    category: 'portfolio',
  },
  {
    keywords: ['portfolio statement', 'portfolio report', 'trade history', 'statement', 'report'],
    answer: 'Your **Portfolio** page includes statements showing: complete trade history, account summary, realized/unrealized gains breakdown, fees, and performance metrics over time.',
    category: 'portfolio',
  },
  {
    keywords: ['screener', 'stock screener', 'filter stocks', 'screen stocks', 'filter', 'criteria'],
    answer: 'The **Stock Screener** (Markets > Stocks > Screener) filters by: market (NSE, NYSE, NASDAQ), sector, price range, change %, volume, P/E ratio, dividend yield, AI score, and signal type. Results in table or grid view with real-time updates.',
    category: 'markets',
  },
  {
    keywords: ['dashboard', 'home', 'overview', 'main page', 'command center'],
    answer: 'Your **Dashboard** is your command center. It shows: portfolio value summary, NSE & global indices, sector performance, portfolio vs benchmarks chart, top gainers/losers, watchlist stocks, AI signal distribution bar, market sentiment pulse, and a news ticker. Real-time updates via WebSocket.',
    category: 'dashboard',
  },
  {
    keywords: ['watchlist', 'track stock', 'follow stock', 'add to watchlist', 'remove from watchlist', 'target price'],
    answer: 'Go to **Watchlist** from the sidebar. Search for stocks to add. Each shows: live price, change %, and signal overlay. You can set target prices and remove stocks anytime. Your watchlist also appears on the Dashboard.',
    category: 'dashboard',
  },
  {
    keywords: ['market', 'markets', 'market activity', 'market overview', 'market summary', 'market status', 'market movers', 'gainers', 'losers'],
    answer: 'The **Markets** page shows real-time activity for NSE and Global markets: market status (open/closed), total turnover, volume, share indices, top gainers/losers, sector performance, AI market summary, and sentiment. Dual-pane view for NSE + US/Global.',
    category: 'markets',
  },
  {
    keywords: ['nse', 'nairobi', 'kenya', 'nse market', 'nse stocks', 'nairobi securities exchange'],
    answer: 'The **NSE** (Nairobi Securities Exchange) section tracks 22+ Kenyan stocks including Safaricom, Equity Bank, KCB, and more. See real-time prices, market status, turnover, top movers, sector performance, and AI market summary. NSE trades Mon-Fri, 9:30 AM - 3:30 PM EAT.',
    category: 'markets',
  },
  {
    keywords: ['global market', 'us market', 'nyse', 'nasdaq', 'sp500', 's&p', 'dow', 'ftse', 'international'],
    answer: '**Global markets** covered: NYSE, NASDAQ, LSE, JSE, GSE, NGX, TSE, HKEX. Real-time quotes, indices (S&P 500, NASDAQ, FTSE 100, etc.), and market status for US markets with pre-market and after-hours data.',
    category: 'markets',
  },
  {
    keywords: ['sector', 'industry', 'sector performance', 'sector analysis', 'sector breakdown'],
    answer: 'The **Sectors** page shows performance by sector/industry with bar charts. Filter by NSE or Global. Each sector displays leading stocks, sentiment indicators, and volume analysis. Great for spotting which industries are hot.',
    category: 'markets',
  },
  {
    keywords: ['market pulse', 'sentiment', 'market sentiment', 'bullish', 'bearish', 'market mood'],
    answer: '**Market Pulse** shows AI-generated sentiment scores (bearish/neutral/bullish) for NSE and Global markets. Includes leading sector identification, confidence scores, and an AI-generated market summary text. Visible on Dashboard and Markets pages.',
    category: 'markets',
  },
  {
    keywords: ['bonds', 'treasury', 'government bond', 'corporate bond', 'infrastructure bond', 'tbill', 't-bill', 'yield', 'ytm', 'coupon'],
    answer: 'The **Bonds** page covers: **Government bonds** (Kenya & US), **Infrastructure bonds**, **Corporate bonds**, and **Treasury Bills** (91, 182, 364-day). Each shows coupon rate, YTM, maturity date, price, and credit rating. View the **yield curve** comparing Kenya vs US 10-year. Market access info included.',
    category: 'markets',
  },
  {
    keywords: ['etf', 'exchange traded fund', 'etf categories', 'expense ratio', 'aum', 'etf browser'],
    answer: 'Browse **ETFs** by category on the ETFs page. Each ETF shows: expense ratio, AUM, dividend yield, price, and change %. Top gainers/losers and largest AUM funds highlighted.',
    category: 'markets',
  },
  {
    keywords: ['news', 'financial news', 'market news', 'stock news', 'news sentiment', 'breaking news', 'headlines'],
    answer: 'The **News** page aggregates financial news from multiple sources. Filter by: All, NSE, Global, Positive, or Negative sentiment. Articles show headline, excerpt, source, timestamp, sentiment badge, and related stocks. Auto-refresh every 60 seconds. Search within news too.',
    category: 'news',
  },
  {
    keywords: ['support', 'help', 'support center', 'faq', 'question', 'help page'],
    answer: 'The **Support Center** has everything you need: **FAQ** with common questions, **Ticket System** to submit and track support requests, **Live Chat** to talk to support staff in real-time, and me — your **AI Assistant**! I can answer most questions instantly.',
    category: 'support',
  },
  {
    keywords: ['ticket', 'support ticket', 'submit ticket', 'create ticket', 'my tickets', 'track ticket'],
    answer: 'On the **Support Center > Contact Us** tab, fill in your email, subject, category, priority, and message to create a ticket. Track its status in **My Tickets** tab. Staff will respond and update the status as they work on your issue.',
    category: 'support',
  },
  {
    keywords: ['exchange', 'stock exchange', 'listings', 'nse listing', 'nyse listing', 'nasdaq listing', 'lse'],
    answer: 'Browse stocks by exchange under **Markets > Stocks > Exchanges**. Covered exchanges: **NSE** (Nairobi), **NYSE**, **NASDAQ**, **LSE** (London), **JSE** (Johannesburg), **GSE** (Ghana), **NGX** (Nigeria), **TSE** (Tokyo), **HKEX** (Hong Kong). Each shows listed companies, trading status, and market cap.',
    category: 'markets',
  },
  {
    keywords: ['industries', 'industry performance', 'stock sectors', 'group by industry'],
    answer: 'Under **Markets > Stocks > Industries**, stocks are grouped by industry/sector. Each group shows average change, volume, and AI score. Searchable and sortable to find the best performing industries.',
    category: 'markets',
  },
  {
    keywords: ['top stocks', 'best stocks', 'top rated', 'top performers', 'award', 'ranking'],
    answer: 'The **Top Stocks** page ranks stocks by AI score, volume, and performance metrics. Trophy/award badges highlight top performers. Great for discovering the best investment opportunities.',
    category: 'signals',
  },
  {
    keywords: ['portfolio broker', 'broker connection', 'sync broker', 'broker sync', 'import holdings'],
    answer: 'Connect your real brokerage accounts in **Settings > Brokers** to automatically sync holdings, positions, balances, and trade history. Supported: Alpaca, IBKR, MT5, OANDA, Tradier, plus manual entry. Data encrypted with AES-256-GCM.',
    category: 'portfolio',
  },
  {
    keywords: ['security', 'password', 'change password', 'privacy', 'data', 'encryption', 'safe', 'secure'],
    answer: 'Your security matters. Passwords are **bcrypt-hashed**, broker credentials are **AES-256-GCM encrypted**, and all API communication uses JWT authentication. Rate limiting protects against abuse. You can control data visibility in **Settings > Privacy**.',
    category: 'account',
  },
  {
    keywords: ['forex', 'fx', 'currency', 'exchange rate', 'kes usd', 'dollar rate', 'shilling rate'],
    answer: 'The app uses real-time **KES/USD** exchange rates for cross-currency portfolio valuation. Check current rates on the **Markets** page. FX data updates throughout the day from multiple providers.',
    category: 'markets',
  },
  {
    keywords: ['top gainers', 'top losers', 'movers', 'gainers', 'losers', 'biggest movers', 'active stocks'],
    answer: 'The **Markets** page shows top gainers and losers for both NSE and Global markets. Each stock shows name, price, change %, and volume. Updated in real-time during market hours.',
    category: 'markets',
  },
  {
    keywords: ['indices', 'nse 20', 'nse 25', 'sp500', 's&p 500', 'nasdaq', 'dow jones', 'ftse 100', 'market index'],
    answer: 'Track major indices: **NSE 20**, **NSE 25**, **S&P 500**, **NASDAQ Composite**, **Dow Jones**, **FTSE 100**, and more. All visible on the **Dashboard** and **Markets** pages with real-time values and changes.',
    category: 'markets',
  },
  {
    keywords: ['indices all', 'all indices', 'nse index', 'global index', 'index values'],
    answer: 'We track indices across all covered markets. View them grouped by NSE and Global on the Dashboard and Markets pages. Each shows current value, change, and change percentage.',
    category: 'markets',
  },
  {
    keywords: ['health', 'status', 'is it working', 'server status', 'api status'],
    answer: 'The system is operational. Market data updates in real-time during trading hours. If you notice any issues, check your internet connection or try refreshing the page. For persistent problems, submit a support ticket.',
    category: 'data',
  },
  {
    keywords: ['dark mode', 'theme', 'appearance', 'light mode', 'compact view', 'display settings'],
    answer: 'Go to **Settings > Appearance** to toggle **Dark Mode** on/off. You can also enable **Compact View** for a denser layout that shows more information on screen. Your preference is saved across sessions.',
    category: 'account',
  },
  {
    keywords: ['privacy', 'private', 'visibility', 'share data', 'personal info', 'data control'],
    answer: 'Manage your privacy in **Settings > Privacy**. Control: profile visibility, portfolio visibility, analytics sharing, and data usage preferences. Your broker credentials are always encrypted.',
    category: 'account',
  },
  {
    keywords: ['forgot password', 'cannot login', 'can\'t sign in', 'lost access'],
    answer: 'Click **"Forgot password?"** on the login page. Enter your registered email and you\'ll receive a password reset link. The link expires in **15 minutes**. If you still can\'t access your account, contact support.',
    category: 'account',
  },
  {
    keywords: ['guide', 'how to', 'how do i', 'tutorial', 'walkthrough', 'getting started', 'beginner'],
    answer: 'I\'m here to help! You can ask me about any feature. Try:\n• "How do I use the stock screener?"\n• "How do I track my portfolio?"\n• "How do trading signals work?"\n• "How do I connect a broker?"\n• "How does paper trading work?"\n\nOr navigate the sidebar to explore the app at your own pace.',
    category: 'general',
  },
];

const ESCALATE_KEYWORDS = ['human', 'agent', 'talk to human', 'talk to person', 'speak to human', 'real person', 'support staff', 'escalate', 'transfer to', 'representative'];

/** Score a query against a knowledge entry — strict whole-word matching only */
function scoreQuery(q, entry) {
  const qWords = new Set(q.split(/\s+/).filter(w => w.length > 2));
  let score = 0;
  for (const keyword of entry.keywords) {
    if (q.includes(keyword)) {
      // Full phrase match = high score
      score += keyword.length * 4;
    } else {
      // Whole-word exact matches only
      const kwWords = keyword.split(/\s+/);
      for (const w of kwWords) {
        if (w.length > 2 && qWords.has(w)) {
          score += w.length * 2;
        }
      }
    }
  }
  return score;
}

app.post('/api/support/chatbot', async (req, res) => {
  try {
    const { message } = req.body;
    if (!message || !message.trim()) {
      return res.json({ answer: 'Hi! How can I help you today?', escalated: false });
    }
    const q = message.toLowerCase().trim();

    // Check escalation (phrase or whole-word match)
    if (ESCALATE_KEYWORDS.some(k => {
      if (k.includes(' ')) return q.includes(k);
      return new RegExp('\\b' + k.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '\\b', 'i').test(q);
    })) {
      return res.json({ answer: 'Sure! Let me connect you with a human support agent.', escalated: true });
    }

    // Greetings & general conversation
    const greetings = ['hello', 'hi', 'hey', 'greetings', 'good morning', 'good afternoon', 'good evening', 'sup', 'yo', 'howdy'];
    if (greetings.some(g => q.includes(g) && !q.includes('trading'))) {
      return res.json({
        answer: 'Hello! 👋 How can I help you today? You can ask me about:\n\n• **Stocks** — "What is Safaricom stock price?"\n• **Market** — "Market overview" or "NSE status"\n• **Account** — "How to reset my password?"\n• **Trading** — "What are trading signals?"\n\nOr type **"talk to human"** to speak with a support agent.',
        escalated: false,
      });
    }
    if (q.includes('thanks') || q.includes('thank you') || q.includes('thanks!') || q === 'ok' || q === 'okay' || q === 'great' || q === 'cool' || q.includes('thank')) {
      return res.json({ answer: 'You\'re welcome! 😊 Is there anything else I can help you with?', escalated: false });
    }
    if (q.includes('bye') || q.includes('goodbye') || q.includes('see you')) {
      return res.json({ answer: 'Goodbye! 👋 Feel free to come back anytime you need help. Happy trading! 🚀', escalated: false });
    }
    if (q.includes('who are you') || q.includes('what are you') || q.includes('what can you do') || q.includes('help me') || q === 'help') {
      return res.json({
        answer: 'I\'m the **StocksIntel Support Assistant** 🤖. I can help you with:\n\n' +
          '• **Stock info** — real-time prices, signals, and company data\n' +
          '• **Market data** — market status, overview, top movers\n' +
          '• **Account help** — password reset, settings, billing\n' +
          '• **Trading** — paper trading, signals, screener, groups\n' +
          '• **Platform** — features, navigation, how-to guides\n\n' +
          'Just ask me anything! Or type **"talk to human"** for a live agent.',
        escalated: false,
      });
    }

    // Knowledge base scoring
    let bestScore = 0;
    let bestAnswer = null;
    for (const entry of KNOWLEDGE_BASE) {
      const score = scoreQuery(q, entry);
      if (score > bestScore) {
        bestScore = score;
        bestAnswer = entry.answer;
      }
    }
    if (bestScore >= 12) {
      return res.json({ answer: bestAnswer, escalated: false });
    }

    // Fallback to FAQ direct matching
    for (const faq of FAQ_ITEMS) {
      if (q.includes(faq.question.toLowerCase().slice(0, 15)) ||
          faq.answer.toLowerCase().includes(q.split(' ').filter(w => w.length > 3).slice(0, 3).join(' '))) {
        return res.json({ answer: faq.answer, escalated: false });
      }
    }

    // Stock/ticker query
    const stockKey = Object.keys(STOCK_NAMES).find(k => q.includes(k) || q.includes(STOCK_NAMES[k].toLowerCase()));
    if (stockKey) {
      const symbol = STOCK_NAMES[stockKey];
      const isNse = symbol.startsWith('NSE') || KENYAN_STOCKS[symbol];
      const fullSymbol = isNse ? `NSE:${symbol}` : symbol;
      try {
        const [signal, quote] = await Promise.all([
          getSignalForStock(symbol).catch(() => null),
          getStockQuote(fullSymbol).catch(() => null),
        ]);
        const price = quote?.price || signal?.price || 'N/A';
        const change = quote?.changePercent ?? signal?.change ?? 0;
        const vol = quote?.volume || signal?.volume || 'N/A';
        const curr = isNse ? 'KES' : 'USD';
        let ans = `**${signal?.name || symbol} (${symbol})**\n\n`;
        ans += `**Price:** ${curr} ${typeof price === 'number' ? price.toFixed(2) : price}\n`;
        ans += `**Change:** ${typeof change === 'number' ? change.toFixed(2) + '%' : change}\n`;
        ans += `**Volume:** ${vol}\n`;
        if (signal) {
          ans += `**Signal:** ${signal.signal} (${signal.confidence}% confidence)\n`;
          ans += `**Target:** ${curr} ${signal.target1 || 'N/A'}`;
          if (signal.stopLoss) ans += ` | **Stop:** ${curr} ${signal.stopLoss}`;
          ans += `\n\n${signal.reason || ''}`;
        }
        return res.json({ answer: ans, escalated: false });
      } catch {
        return res.json({ answer: `I found **${symbol}** in our database. Use the stock detail page for the latest data.`, escalated: false });
      }
    }

    // Market status
    if (q.includes('market') && (q.includes('open') || q.includes('close') || q.includes('status') || q.includes('hours'))) {
      try {
        const statusRes = await fetch(`http://localhost:${port}/api/market/status`).then(r => r.json()).catch(() => null);
        if (statusRes) {
          let ans = '**📊 Market Status**\n\n';
          if (statusRes.nse) ans += `**NSE:** ${statusRes.nse.label} — ${statusRes.nse.eventLabel}\n`;
          if (statusRes.global) ans += `**Global:** ${statusRes.global.label} — ${statusRes.global.eventLabel}\n`;
          return res.json({ answer: ans, escalated: false });
        }
      } catch {}
    }

    // Market overview
    if (q.includes('market') || q.includes('overview') || q.includes('summary') || q.includes('sentiment')) {
      try {
        const signals = await generateSignals().catch(() => []);
        const buys = signals.filter(s => s.signal === 'Strong Buy' || s.signal === 'Buy').length;
        const total = signals.length;
        if (total > 0) {
          const sectors = [...new Set(signals.map(s => s.sector).filter(Boolean))];
          let ans = `**📈 Market Overview**\n\nTracking **${total}** stocks across **${sectors.length}** sectors.\n`;
          ans += `**${buys}** stocks have buy ratings (${Math.round(buys/total*100)}% bullish).\n`;
          return res.json({ answer: ans, escalated: false });
        }
      } catch {}
    }

    // NSE-specific
    if (q.includes('nse') || q.includes('nairobi') || q.includes('kenya')) {
      const signals = await generateSignals().catch(() => []);
      const nseSignals = signals.filter(s => s.market === 'NSE' || s.currency === 'KES');
      if (nseSignals.length > 0) {
        const buys = nseSignals.filter(s => s.signal === 'Strong Buy' || s.signal === 'Buy').length;
        let ans = `**🇰🇪 NSE Market**\n\nTracking **${nseSignals.length}** stocks. **${buys}** buy signals.\n`;
        const tops = nseSignals.filter(s => s.signal === 'Strong Buy' || s.signal === 'Buy').slice(0, 5);
        if (tops.length > 0) {
          ans += '\n**Top Picks:**\n';
          tops.forEach(s => { ans += `• **${s.ticker || s.symbol}** — ${s.signal} at KES ${s.price}\n`; });
        }
        return res.json({ answer: ans, escalated: false });
      }
    }

    // Momentum/top stocks
    if (q.includes('momentum') || q.includes('gainers') || q.includes('hot') || q.includes('top stock') || q.includes('best stock')) {
      const signals = await generateSignals().catch(() => []);
      const top = signals.filter(s => s.signal === 'Strong Buy' || s.signal === 'Buy').slice(0, 5);
      if (top.length > 0) {
        let ans = '**🔥 Top Stocks**\n\n';
        top.forEach((s, i) => {
          ans += `${i + 1}. **${s.symbol || s.ticker}** — ${s.signal} (${s.confidence}% confidence)\n`;
        });
        return res.json({ answer: ans, escalated: false });
      }
    }

    // Fallback
    res.json({
      answer: 'I\'m not sure I understood that. Could you try rephrasing? I can help with:\n\n' +
        '• **Stocks** — "What is the price of SCOM?" or "Analyze Safaricom"\n' +
        '• **Market** — "Market overview" or "NSE market today"\n' +
        '• **Account** — "How do I reset my password?" or "Paper trading"\n' +
        '• **Signals** — "Top stocks to buy" or "Trading signals explained"\n\n' +
        'Or type **"talk to human"** to speak with a support agent.',
      escalated: false,
    });
  } catch (err) {
    console.error('chatbot error:', err.message);
    res.json({ answer: 'Sorry, I encountered an error. Please try again or type "talk to human" for assistance.', escalated: true });
  }
});

// --- Market Data Routes ---
app.get('/api/quote/:symbol', async (req, res) => {
  try {
    const symbol = req.params.symbol.toUpperCase();
    const quote = await getStockQuote(symbol);
    if (!quote) return res.status(404).json({ error: 'Symbol not found' });
    res.json(quote);
  } catch (error) {
    res.status(500).json({ error: 'An unexpected error occurred' });
  }
});

app.get('/api/quotes', async (req, res) => {
  try {
    const symbols = req.query.symbols ? req.query.symbols.split(',') : [];
    if (symbols.length === 0) return res.json([]);
    const quotes = await Promise.all(symbols.map(s => getStockQuote(s.trim().toUpperCase()).catch(() => null)));
    res.json(quotes.filter(Boolean));
  } catch (error) {
    res.status(500).json({ error: 'An unexpected error occurred' });
  }
});

// --- File Upload ---
app.post('/api/upload', authenticateToken, (req, res) => {
  upload.single('file')(req, res, (err) => {
    if (err) {
      if (err instanceof multer.MulterError) return res.status(400).json({ error: err.message, code: 'FILE_ERROR' });
      return res.status(400).json({ error: 'File upload failed', code: 'FILE_ERROR' });
    }
    if (!req.file) return res.status(400).json({ error: 'No file provided' });
    const baseUrl = `${req.protocol}://${req.get('host')}`;
    res.json({ url: `${baseUrl}/uploads/${req.file.filename}`, filename: req.file.originalname, size: req.file.size });
  });
});

// --- Message Edit / Delete ---
app.put('/api/messages/:id', authenticateToken, async (req, res) => {
  try {
    const { id } = req.params;
    const { content } = req.body;
    if (!content || !content.trim()) return res.status(400).json({ error: 'Content is required' });
    const cleanContent = sanitizeText(content.trim());
    const result = await pool.query(
      `UPDATE messages SET content = $1, edited_at = CURRENT_TIMESTAMP WHERE id = $2 AND sender_id = $3
       RETURNING id, sender_id, sender_name, content, message_type, group_id, recipient_id, image_url, file_name, edited_at, created_at`,
      [cleanContent, id, req.user.id]
    );
    if (result.rows.length === 0) return res.status(404).json({ error: 'Message not found or not authorized' });
    const msg = result.rows[0];
    if (msg.group_id) io.to(`group:${msg.group_id}`).emit('message_edited', msg);
    else if (msg.recipient_id) {
      const room = [String(msg.sender_id), String(msg.recipient_id)].sort().join(':pm');
      io.to(room).emit('message_edited', msg);
    }
    res.json(msg);
  } catch (err) { console.error('Edit message error:', err.message); res.status(500).json({ error: 'An unexpected error occurred' }); }
});

app.delete('/api/messages/:id', authenticateToken, async (req, res) => {
  try {
    const { id } = req.params;
    const result = await pool.query(
      'DELETE FROM messages WHERE id = $1 AND sender_id = $2 RETURNING id, group_id, sender_id, recipient_id',
      [id, req.user.id]
    );
    if (result.rows.length === 0) return res.status(404).json({ error: 'Message not found or not authorized' });
    const msg = result.rows[0];
    if (msg.group_id) io.to(`group:${msg.group_id}`).emit('message_deleted', { id: Number(id), group_id: msg.group_id });
    else if (msg.recipient_id) {
      const room = [String(msg.sender_id), String(msg.recipient_id)].sort().join(':pm');
      io.to(room).emit('message_deleted', { id: Number(id) });
    }
    res.json({ success: true });
  } catch (err) { console.error('Delete message error:', err.message); res.status(500).json({ error: 'An unexpected error occurred' }); }
});

// Signal engine backfill endpoint
app.post('/api/signals/engine/backfill', authenticateToken, async (req, res) => {
  try {
    const { backfillOutcomesFromHistory } = require('./signalService');
    await backfillOutcomesFromHistory(req.query.days ? parseInt(req.query.days) : 30, req.query.limit ? parseInt(req.query.limit) : 500);
    const counts = await pool.query('SELECT COUNT(*)::int as cnt FROM signal_outcomes').catch(() => ({ rows: [{ cnt: 0 }] }));
    res.json({ success: true, signalOutcomes: counts.rows[0].cnt });
  } catch (error) {
    console.error('[Backfill]', error.message);
    res.status(500).json({ success: false, error: 'Backfill failed' });
  }
});

// Historical backtest endpoint: evaluates signal_history against OHLC history
app.post('/api/signals/engine/backtest/historical', authenticateToken, async (req, res) => {
  try {
    const { runHistoricalBacktest } = require('./signalService');
    const result = await runHistoricalBacktest({
      days: req.query.days ? parseInt(req.query.days) : 90,
      maxHoldDays: req.query.maxHoldDays ? parseInt(req.query.maxHoldDays) : 10,
      maxSignals: req.query.maxSignals ? parseInt(req.query.maxSignals) : 1000,
      force: req.query.force === 'true',
    });
    const counts = await pool.query('SELECT COUNT(*)::int as cnt FROM signal_outcomes').catch(() => ({ rows: [{ cnt: 0 }] }));
    res.json({ success: true, result, signalOutcomes: counts.rows[0].cnt });
  } catch (error) {
    console.error('[Historical backtest]', error.message);
    res.status(500).json({ success: false, error: 'Backtest failed' });
  }
});

// Signal engine diagnostics endpoint
app.get('/api/signals/engine/diagnostics', authenticateToken, async (req, res) => {
  try {
    const now = new Date();
    const day = now.getDay();
    const utcMinutes = now.getUTCHours() * 60 + now.getUTCMinutes();
    const isDST = now.getMonth() >= 2 && now.getMonth() <= 9;
    const etMinutes = ((utcMinutes + (isDST ? -4 : -5) * 60) % 1440 + 1440) % 1440;
    const marketOpen = day !== 0 && day !== 6 && etMinutes >= 570 && etMinutes < 960;

    const counts = await Promise.all([
      pool.query('SELECT COUNT(*)::int as cnt FROM signal_history').catch(e => ({ rows: [{ cnt: 0 }], error: e.message })),
      pool.query('SELECT COUNT(*)::int as cnt FROM signal_outcomes').catch(e => ({ rows: [{ cnt: 0 }], error: e.message })),
      pool.query('SELECT COUNT(*)::int as cnt FROM forward_predictions').catch(e => ({ rows: [{ cnt: 0 }], error: e.message })),
      pool.query("SELECT COUNT(*)::int as cnt FROM app_cache WHERE cache_key = 'signals_cache'").catch(e => ({ rows: [{ cnt: 0 }], error: e.message })),
    ]);

    const lastSignal = await pool.query('SELECT MAX(generated_at) as ts FROM signal_history').catch(() => ({ rows: [{ ts: null }] }));
    const recentSignals = await pool.query("SELECT signal, COUNT(*)::int as cnt FROM signal_history WHERE generated_at > NOW() - INTERVAL '24 hours' GROUP BY signal ORDER BY cnt DESC").catch(() => ({ rows: [] }));
    const lastOutcome = await pool.query('SELECT MAX(recorded_at) as ts FROM signal_outcomes').catch(() => ({ rows: [{ ts: null }] }));
    const sampleOutcomes = await pool.query(
      `SELECT ticker, signal, entry_price, exit_price, result, recorded_at
       FROM signal_outcomes ORDER BY recorded_at DESC LIMIT 5`
    ).catch(() => ({ rows: [] }));
    const validReturns = await pool.query(
      `SELECT COUNT(*)::int as cnt FROM signal_outcomes
       WHERE entry_price > 0 AND exit_price > 0 AND exit_price != entry_price`
    ).catch(() => ({ rows: [{ cnt: 0 }] }));

    const cacheEntry = await pool.query("SELECT updated_at FROM app_cache WHERE cache_key = 'signals_cache'").catch(() => ({ rows: [] }));

    res.json({
      success: true,
      diagnostics: {
        serverTime: now.toISOString(),
        usMarketOpen: marketOpen,
        etMinutes,
        counts: {
          signalHistory: counts[0].rows[0].cnt,
          signalOutcomes: counts[1].rows[0].cnt,
          forwardPredictions: counts[2].rows[0].cnt,
          signalsCache: counts[3].rows[0].cnt,
        },
        dbErrors: counts.filter(c => c.error).map(c => c.error),
        lastSignalGeneratedAt: lastSignal.rows[0].ts,
        lastOutcomeRecordedAt: lastOutcome.rows[0].ts,
        signalsLast24h: recentSignals.rows,
        cacheLastUpdated: cacheEntry.rows[0]?.updated_at || null,
        sampleOutcomes: sampleOutcomes.rows,
        validReturnOutcomes: validReturns.rows[0].cnt,
      }
    });
  } catch (error) {
    res.status(500).json({ error: 'An unexpected error occurred' });
  }
});

// --- Authentication & Subscription Enforcement Middleware ---
// Apply to all app feature routes. Public/market data routes are defined before this.
const authSubs = [authenticateToken, requireActiveSubscription];
const authOwnSubs = [authenticateToken, requireOwnership, requireActiveSubscription];
app.use('/api/signals', ...authSubs);
app.use('/api/signal', ...authSubs);
app.use('/api/watchlist', ...authSubs);
app.use('/api/portfolio', ...authSubs);
app.use('/api/trade', ...authSubs);
app.use('/api/trades', ...authSubs);
app.use('/api/broker-connections', ...authSubs);
app.use('/api/groups', ...authSubs);
app.use('/api/chat', ...authSubs);
app.use('/api/conversations', ...authSubs);
app.use('/api/notifications', ...authSubs);
app.use('/api/financials', ...authSubs);
app.use('/api/user', ...authSubs);
app.use('/api/users', ...authSubs);
app.use('/api/people', ...authSubs);
app.use('/api/holdings', ...authSubs);
app.use('/api/paper', ...authSubs);
app.use('/api/ai/insights', ...authSubs);
app.use('/api/ai/market-summary', ...authSubs);
app.use('/api/ai/portfolio-advice', ...authSubs);
app.use('/api/ai/portfolio-rebalance', ...authSubs);
app.use('/api/ai/recommendations', ...authSubs);
app.use('/api/company', ...authSubs);
app.use('/api/orders', ...authSubs);
app.use('/api/positions', ...authSubs);
app.use('/api/ml', ...authSubs);
app.use('/api/monitor', ...authSubs);
app.use('/api/portfolio/optimize', ...authSubs);
app.use('/api/portfolio/var', ...authSubs);
app.use('/api/support/chat', ...authSubs);
app.use('/api/support/chats', ...authSubs);

app.get('/api/signals', async (req, res) => {
  try {
    const signals = await generateSignals(null, true);
    res.json({ success: true, signals });
    generateSignals(null, false).catch(() => {});
  } catch (error) {
    res.status(500).json({ error: 'An unexpected error occurred' });
  }
});

app.get('/api/signals/summary', async (req, res) => {
  try {
    const summary = await getSignalsSummary();
    res.json(summary);
  } catch (error) {
    res.status(500).json({ error: 'An unexpected error occurred' });
  }
});

app.get('/api/signal/:symbol', async (req, res) => {
  try {
    const symbol = req.params.symbol.toUpperCase();
    const signal = await getSignalForStock(symbol);
    if (!signal) return res.status(404).json({ error: 'No signal found' });
    res.json(signal);
  } catch (error) {
    res.status(500).json({ error: 'An unexpected error occurred' });
  }
});

// ─── Signal Engine Management Routes ────────────────────────────────────
app.get('/api/signals/backtest', async (req, res) => {
  try {
    const stats = await computeBacktestStats({
      days: parseInt(req.query.days) || 30,
      limit: parseInt(req.query.limit) || 500,
      signalType: req.query.signal || null,
      minConfidence: parseInt(req.query.minConfidence) || 0,
    });
    res.json({ success: true, stats });
  } catch (error) {
    res.status(500).json({ error: 'An unexpected error occurred' });
  }
});

app.get('/api/signals/forward-test', async (req, res) => {
  try {
    const { symbol, resolved, limit, offset } = req.query;
    if (symbol || resolved !== undefined || req.query.limit) {
      const result = getForwardTestPredictions({
        symbol: symbol || undefined,
        resolved: resolved !== undefined ? resolved === 'true' : undefined,
        limit: parseInt(limit) || 50,
        offset: parseInt(offset) || 0,
      });
      return res.json({ success: true, ...result });
    }
    const stats = await getForwardTestStats();
    res.json({ success: true, stats });
  } catch (error) {
    res.status(500).json({ error: 'An unexpected error occurred' });
  }
});

app.post('/api/signals/forward-test/resolve', async (req, res) => {
  try {
    const result = await resolveAllForwardPredictions();
    res.json({ success: true, ...result });
  } catch (error) {
    res.status(500).json({ error: 'An unexpected error occurred' });
  }
});

app.get('/api/signals/audit', async (req, res) => {
  try {
    const result = await getAuditLog({
      type: req.query.type || null,
      limit: parseInt(req.query.limit) || 100,
      offset: parseInt(req.query.offset) || 0,
    });
    res.json(result);
  } catch (error) {
    res.status(500).json({ error: 'An unexpected error occurred' });
  }
});

app.get('/api/signals/engine/config', async (req, res) => {
  try {
    const view = req.query.view || 'full';
    res.json({ success: true, config: getEngineConfig(view) });
  } catch (error) {
    res.status(500).json({ error: 'An unexpected error occurred' });
  }
});

app.put('/api/signals/engine/config', async (req, res) => {
  try {
    const config = updateEngineConfig(req.body);
    res.json({ success: true, config });
  } catch (error) {
    res.status(500).json({ error: 'An unexpected error occurred' });
  }
});

app.get('/api/signals/engine/health', async (req, res) => {
  try {
    const health = getEngineHealth();
    res.json({ success: true, health });
  } catch (error) {
    res.status(500).json({ error: 'An unexpected error occurred' });
  }
});

app.get('/api/company/:symbol/profile', async (req, res) => {
  try {
    const symbol = req.params.symbol.toUpperCase();
    const profile = await getCompanyProfile(symbol);
    res.json(profile || {});
  } catch (error) {
    res.status(500).json({ error: 'An unexpected error occurred' });
  }
});

app.get('/api/company/:symbol/financials', async (req, res) => {
  try {
    const symbol = req.params.symbol.toUpperCase();
    const [income, balance, cashflow] = await Promise.all([
      getIncomeStatement(symbol).catch(() => null),
      getBalanceSheet(symbol).catch(() => null),
      getCashFlowStatement(symbol).catch(() => null),
    ]);
    res.json({ incomeStatement: income, balanceSheet: balance, cashFlow: cashflow });
  } catch (error) {
    res.status(500).json({ error: 'An unexpected error occurred' });
  }
});

// --- News Routes ---
app.get('/api/news', async (req, res) => {
  try {
    const limit = parseInt(req.query.limit) || 50;
    const category = req.query.category || 'all';
    const news = await getAllNews(limit, category);
    res.json(news);
  } catch (error) {
    res.status(500).json({ error: 'An unexpected error occurred' });
  }
});

app.get('/api/news/summary', async (req, res) => {
  try {
    const summary = await getNewsSummary();
    res.json(summary);
  } catch (error) {
    res.status(500).json({ error: 'An unexpected error occurred' });
  }
});

app.get('/api/news/kenyan', async (req, res) => {
  try {
    res.json({ stocks: KENYAN_STOCKS });
  } catch (error) {
    res.status(500).json({ error: 'An unexpected error occurred' });
  }
});

app.get('/api/news/hot', async (req, res) => {
  try {
    const limit = parseInt(req.query.limit) || 20;
    const news = await getAllNews(200);
    const hotNews = news.filter(a => a.hot).slice(0, limit);
    res.json(hotNews);
  } catch (error) {
    res.status(500).json({ error: 'An unexpected error occurred' });
  }
});

// --- Watchlist Routes (with in-memory fallback when DB unavailable) ---
const _watchlistMemory = {};

const WATCHLIST_DB_UNAVAILABLE = { code: 'DB_UNAVAILABLE' };
function isDbError(err) {
  return err && (err.code === 'ECONNREFUSED' || err.code === 'ENOTFOUND' || err.message?.includes('connect ECONNREFUSED') || err.message?.includes('does not exist') || err.message?.includes('relation') || err.code === '42P01');
}

function getMemoryWatchlist(userId) { return _watchlistMemory[userId] || []; }
function setMemoryWatchlist(userId, items) { _watchlistMemory[userId] = items; }

app.get('/api/watchlist', async (req, res) => {
  try {
    const userId = req.query.userId;
    if (!userId) return res.status(400).json({ error: 'userId required' });
    const result = await pool.query('SELECT * FROM watchlist_items WHERE user_id = $1 ORDER BY created_at DESC', [userId]);
    const memItems = getMemoryWatchlist(userId);
    // Merge: DB results take priority, append any in-memory items not in DB
    const dbSymbols = new Set(result.rows.map(r => r.symbol));
    const extra = memItems.filter(m => !dbSymbols.has(m.symbol));
    const merged = [...result.rows, ...extra];
    setMemoryWatchlist(userId, merged);
    res.json(merged);
  } catch (error) {
    const userId = req.query.userId;
    console.warn('[Watchlist] DB query failed, using in-memory:', error.message);
    if (userId) {
      const items = getMemoryWatchlist(userId);
      return res.json(items.map((r, i) => ({ ...r, id: r.id || `mem_${i}` })));
    }
    res.json([]);
  }
});

app.post('/api/watchlist', async (req, res) => {
  try {
    const { symbol, company_name, notes, target_price, userId } = req.body;
    if (!userId) return res.status(400).json({ error: 'userId required' });
    const result = await pool.query(
      `INSERT INTO watchlist_items (symbol, company_name, notes, target_price, user_id)
       VALUES ($1, $2, $3, $4, $5)
       ON CONFLICT (symbol, user_id) DO UPDATE SET company_name = $2, notes = $3, target_price = $4
       RETURNING *`,
      [symbol?.toUpperCase(), company_name, notes, target_price, userId]
    );
    setMemoryWatchlist(userId, [...getMemoryWatchlist(userId).filter(i => i.symbol !== symbol?.toUpperCase()), result.rows[0]]);
    res.status(201).json(result.rows[0]);
  } catch (error) {
    const { symbol, company_name, notes, target_price, userId } = req.body;
    console.warn('[Watchlist] DB insert failed, using in-memory:', error.message);
    if (symbol && userId) {
      const items = getMemoryWatchlist(userId);
      const exists = items.find(i => i.symbol === symbol?.toUpperCase());
      const entry = { id: `mem_${Date.now()}`, symbol: symbol?.toUpperCase(), company_name: company_name || symbol, notes: notes || null, target_price: target_price || null, user_id: userId, created_at: new Date().toISOString() };
      if (exists) Object.assign(exists, entry);
      else items.push(entry);
      setMemoryWatchlist(userId, items);
      return res.status(201).json(entry);
    }
    res.status(500).json({ error: 'An unexpected error occurred' });
  }
});

app.delete('/api/watchlist/:id', async (req, res) => {
  try {
    const id = parseInt(req.params.id);
    if (isNaN(id)) return res.status(400).json({ error: 'Invalid id' });
    await pool.query('DELETE FROM watchlist_items WHERE id = $1', [id]);
    // Also clean memory for all users
    Object.keys(_watchlistMemory).forEach(uid => {
      _watchlistMemory[uid] = _watchlistMemory[uid].filter(i => i.id !== id && i.id !== `mem_${id}`);
    });
    res.json({ success: true });
  } catch (error) {
    console.warn('[Watchlist] DB delete failed, cleaning in-memory:', error.message);
    const id = req.params.id;
    Object.keys(_watchlistMemory).forEach(uid => {
      _watchlistMemory[uid] = _watchlistMemory[uid].filter(i => i.id !== parseInt(id) && i.id !== `mem_${id}`);
    });
    res.json({ success: true });
  }
});

// ── Portfolio Statement (must be BEFORE :userId param route) ──
app.get('/api/portfolio/statement', requireOwnership, async (req, res) => {
  try {
    const userId = parseInt(req.query.userId);
    const period = (req.query.period || '1M').toUpperCase();
    if (!userId) return res.status(400).json({ error: 'userId is required' });

    const { rows } = await pool.query(
      `SELECT id, ticker, name, shares, avg_cost, current_price, sector, market, created_at
       FROM portfolio_holdings WHERE user_id = $1 ORDER BY ticker`,
      [userId]
    );

    const emptyResponse = {
      generatedAt: new Date().toISOString(),
      holdings: [], summary: {
        totalValue: 0, totalCost: 0, totalPnL: 0, pnlPercent: 0,
        nseValue: 0, globalValue: 0, nseCost: 0, globalCost: 0,
        nsePnL: 0, globalPnL: 0, holdingsCount: 0,
        nseCount: 0, globalCount: 0, fxRate: 130, dailyChange: 0, dailyChangePercent: 0,
      },
      sectorAllocation: [], valueHistory: [], bestPerformers: [], worstPerformers: [], tradeHistory: [], brokerEquity: 0, brokerBalance: 0,
    };

    // Determine history date range based on period
    const now = new Date();
    let historyFrom;
    switch (period) {
      case '1D': historyFrom = new Date(now.getTime() - 24 * 60 * 60 * 1000); break;
      case '1W': historyFrom = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000); break;
      case '1M': historyFrom = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000); break;
      case '1Y': historyFrom = new Date(now.getTime() - 365 * 24 * 60 * 60 * 1000); break;
      default: historyFrom = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);
    }

    // Fetch value history (gracefully handle missing table/column)
    let historyRes;
    try {
      historyRes = await pool.query(
        `SELECT total_value, invested_value, snapshot_date FROM portfolio_value_history
         WHERE user_id = $1 AND snapshot_date >= $2 ORDER BY snapshot_date ASC`,
        [userId, historyFrom]
      );
    } catch {
      historyRes = { rows: [] };
    }

    // Fetch broker trade history + open positions (before early return so broker-only users get data)
    let tradeHistory = [];
    let brokerHoldings = [];
    let brokerEquity = 0;
    let brokerBalance = 0;
    const brokerPositionTickers = new Set();
    try {
      const brokerConns = await pool.query(
        'SELECT id, account_name, config, api_key FROM broker_connections WHERE user_id = $1 AND connected = true ORDER BY id DESC',
        [userId]
      );
      if (brokerConns.rows.length > 0) {
        // Deduplicate by accountId|server (matching frontend logic)
        const seenDedup = new Set();
        const deduped = [];
        for (const r of brokerConns.rows) {
          const cfg = typeof r.config === 'string' ? JSON.parse(r.config) : (r.config || {});
          const key = `${cfg.accountId || ''}|${cfg.server || ''}`;
          if (key !== '|') {
            if (seenDedup.has(key)) continue;
            seenDedup.add(key);
          }
          deduped.push(r);
        }
        const connIds = deduped.map(r => r.id);
        const snapRes = await pool.query(
          `SELECT DISTINCT ON (broker_connection_id) broker_connection_id, positions, trade_history, snapshot_at, equity, balance
           FROM broker_account_snapshots
           WHERE broker_connection_id = ANY($1::int[])
           ORDER BY broker_connection_id, snapshot_at DESC`,
          [connIds]
        );
        const connNames = {};
        for (const r of deduped) connNames[r.id] = r.account_name;
        for (const s of snapRes.rows) {
          brokerEquity += parseFloat(s.equity) || 0;
          brokerBalance += parseFloat(s.balance) || 0;
          // Collect tickers from broker positions to avoid double-counting manual holdings
          const brokerPositions = typeof s.positions === 'string' ? JSON.parse(s.positions) : (s.positions || []);
          for (const pos of brokerPositions) {
            const ticker = (pos.symbol || pos.ticker || '').toUpperCase().trim();
            if (ticker) brokerPositionTickers.add(ticker);
          }
          // Trade history
          const th = typeof s.trade_history === 'string' ? JSON.parse(s.trade_history) : (s.trade_history || []);
          for (const t of th) {
            tradeHistory.push({ ...t, _brokerName: connNames[s.broker_connection_id] || `Broker #${s.broker_connection_id}` });
          }
          // Virtual account-level holding per broker connection
          const connEquity = parseFloat(s.equity) || 0;
          const connBalance = parseFloat(s.balance) || 0;
          const connPnl = connEquity - connBalance;
          const connPnlPct = connBalance > 0 ? Math.round((connPnl / connBalance) * 1000) / 10 : 0;
          const connName = connNames[s.broker_connection_id] || `Broker #${s.broker_connection_id}`;
          brokerHoldings.push({
            id: `broker_conn_${s.broker_connection_id}`,
            ticker: connName,
            name: `${connName} Account`,
            shares: 1,
            avgCost: Math.round(connBalance * 100) / 100,
            currentPrice: Math.round(connEquity * 100) / 100,
            value: Math.round(connEquity * 100) / 100,
            cost: Math.round(connBalance * 100) / 100,
            pnl: Math.round(connPnl * 100) / 100,
            pnlPercent: connPnlPct,
            sector: 'Broker',
            market: 'Global',
            _brokerName: connName,
          });
        }
        tradeHistory.sort((a, b) => (b.time || '').localeCompare(a.time || ''));
      }
    } catch (err) {
      console.error('Error fetching broker data for statement:', err.message);
    }

    if (rows.length === 0 && brokerHoldings.length === 0) return res.json({ ...emptyResponse, tradeHistory, brokerEquity, brokerBalance });

    const fxRate = await getFxRate();

    // Fetch live quotes (price + previousClose) in parallel
    const liveQuotes = await Promise.all(rows.map(r =>
      getLiveQuote(r.market, r.ticker).then(q => q || { price: parseFloat(r.current_price) || parseFloat(r.avg_cost) || 0, previousClose: 0 })
    ));

    const holdings = [];
    let nseValue = 0, globalValue = 0, nseCost = 0, globalCost = 0;
    let dailyChange = 0;

    for (let i = 0; i < rows.length; i++) {
      const r = rows[i];
      // Skip manual holdings that are already tracked inside a linked broker account
      if (brokerPositionTickers.has(r.ticker.toUpperCase().trim())) continue;
      const { price: livePrice, previousClose } = liveQuotes[i];
      const avgC = parseFloat(r.avg_cost) || 0;
      const shares = parseFloat(r.shares) || 0;
      const val = livePrice * shares;
      const cost = avgC * shares;
      const pnlVal = val - cost;
      const pnlPctVal = cost > 0 ? ((val - cost) / cost * 100) : 0;
      dailyChange += (livePrice - previousClose) * shares;

      if (r.market === 'NSE') { nseValue += val; nseCost += cost; }
      else { globalValue += val; globalCost += cost; }

      holdings.push({
        id: r.id, ticker: r.ticker, name: r.name || r.ticker,
        shares, avgCost: avgC, currentPrice: livePrice,
        value: val, pnl: pnlVal, pnlPercent: Math.round(pnlPctVal * 10) / 10,
        sector: r.sector || 'Other', market: r.market || 'NSE',
        acquired: r.created_at ? r.created_at.toISOString().split('T')[0] : null,
      });
    }

    // Add broker positions as holdings
    for (const bh of brokerHoldings) {
      holdings.push(bh);
    }

    const nsePnL = nseValue - nseCost;
    // Use broker equity/balance for global portfolio summary (actual account value in USD)
    const globalValueTotal = globalValue + brokerEquity;
    const globalCostTotal = globalCost + brokerBalance;
    const globalPnL = globalValueTotal - globalCostTotal;
    const totalValue = nseValue + globalValueTotal * fxRate;
    const totalCost = nseCost + globalCostTotal * fxRate;
    const totalPnL = totalValue - totalCost;

    // Daily change computed from live (price - previousClose) * shares for each holding
    let dailyChangePercent = totalValue > 0 ? (dailyChange / (totalValue - dailyChange)) * 100 : 0;

    // Sector allocation (skip broker positions)
    const sectorMap = {};
    for (const h of holdings) {
      if (h._brokerName) continue;
      const valKes = h.market === 'NSE' ? h.value : h.value * fxRate;
      sectorMap[h.sector] = (sectorMap[h.sector] || 0) + valKes;
    }
    const sectorAllocation = Object.entries(sectorMap)
      .map(([sector, value]) => ({ sector, value, pct: totalValue > 0 ? Math.round((value / totalValue) * 100) : 0 }))
      .sort((a, b) => b.value - a.value);

    // Best/worst performers (skip broker positions, non-zero P&L)
    const sortedByPnl = [...holdings].filter(h => !h._brokerName).sort((a, b) => b.pnlPercent - a.pnlPercent);
    const bestPerformers = sortedByPnl.filter(h => h.pnlPercent > 0).slice(0, 5);
    const worstPerformers = sortedByPnl.filter(h => h.pnlPercent < 0).slice(-5).reverse();

    // Value history
    const valueHistory = (historyRes.rows || []).map(r => {
      const d = r.snapshot_date ? new Date(r.snapshot_date) : null;
      return {
        date: d ? d.toISOString() : new Date().toISOString(),
        totalValue: parseFloat(r.total_value),
        investedValue: parseFloat(r.invested_value),
      };
    });

    res.json({
      generatedAt: new Date().toISOString(),
      holdings,
      summary: {
        totalValue: Math.round(totalValue * 100) / 100,
        totalCost: Math.round(totalCost * 100) / 100,
        totalPnL: Math.round(totalPnL * 100) / 100,
        pnlPercent: totalCost > 0 ? Math.round((totalPnL / totalCost) * 1000) / 10 : 0,
        nseValue: Math.round(nseValue * 100) / 100,
        globalValue: Math.round(globalValueTotal * 100) / 100,
        globalCost: Math.round(globalCostTotal * 100) / 100,
        nsePnL: Math.round(nsePnL * 100) / 100,
        globalPnL: Math.round(globalPnL * 100) / 100,
        nsePnLPercent: nseCost > 0 ? Math.round((nsePnL / nseCost) * 1000) / 10 : 0,
        globalPnLPercent: globalCostTotal > 0 ? Math.round((globalPnL / globalCostTotal) * 1000) / 10 : 0,
        holdingsCount: holdings.length,
        nseCount: holdings.filter(h => h.market === 'NSE').length,
        globalCount: holdings.filter(h => h.market !== 'NSE').length,
        fxRate,
        dailyChange: Math.round(dailyChange * 100) / 100,
        dailyChangePercent: Math.round(dailyChangePercent * 10) / 10,
      },
      sectorAllocation,
      valueHistory,
      bestPerformers,
      worstPerformers,
      tradeHistory,
      brokerEquity: Math.round(brokerEquity * 100) / 100,
      brokerBalance: Math.round(brokerBalance * 100) / 100,
    });
  } catch (err) {
    console.error('Error generating portfolio statement:', err);
    res.status(500).json({ error: 'Failed to generate portfolio statement' });
  }
});

// ── Portfolio Performance (must be BEFORE :userId param route) ──
app.get('/api/portfolio/performance', async (req, res) => {
  try {
    const userId = req.query.userId;
    if (!userId) return res.status(400).json({ error: 'userId is required' });
    const period = req.query.period || '6M';

    const periodMap = { '1D': 1, '1W': 7, '1M': 30, '3M': 90, '6M': 180, '1Y': 365, 'ALL': 9999 };
    const days = periodMap[period] || 180;

    const cutoff = new Date(Date.now() - days * 24 * 60 * 60 * 1000);
    const { rows: snapshots } = await pool.query(
      `SELECT total_value, snapshot_date FROM portfolio_value_history
       WHERE user_id = $1 AND snapshot_date >= $2 ORDER BY snapshot_date ASC`,
      [userId, cutoff]
    );

    const { rows: accountRows } = await pool.query(
      'SELECT initial_capital, initial_capital_usd FROM paper_accounts WHERE user_id = $1', [userId]
    );
    const fxRate = await getFxRate();
    const currentPv = await getPortfolioValue(userId);
    const currentValue = currentPv ? currentPv.combinedValue : 0;
    const initialCapital = accountRows.length > 0
      ? parseFloat(accountRows[0].initial_capital) + parseFloat(accountRows[0].initial_capital_usd) * fxRate
      : 1000000;

    // Fetch live NSE 20 and S&P 500 index values for benchmark comparison
    const allIndices = await indicesService.getAllIndices().catch(() => ({}));
    const nse20Idx = allIndices['NSE:NSE20'];
    const sp500Idx = allIndices['^GSPC'];
    const nseCurrent = nse20Idx ? parseFloat(nse20Idx.value) : 1847.56;
    const spCurrent = sp500Idx ? parseFloat(sp500Idx.value) : 7553.68;

    const benchmarkHistory = generateBenchmarkHistory(nseCurrent, spCurrent, days);

    const hasHistory = snapshots.length > 0;
    const numPoints = Math.min(hasHistory ? snapshots.length : 12, benchmarkHistory.length);
    const data = [];

    if (hasHistory) {
      const firstValue = parseFloat(snapshots[0].total_value);
      const firstNse = benchmarkHistory[0]?.nse || nseCurrent;
      const firstSp = benchmarkHistory[0]?.sp || spCurrent;

      for (let i = 0; i < numPoints; i++) {
        const snap = snapshots[i] || snapshots[snapshots.length - 1];
        const portfolioVal = parseFloat(snap.total_value);
        const bench = benchmarkHistory[i] || benchmarkHistory[benchmarkHistory.length - 1];

        data.push({
          month: formatDateLabel(new Date(snap.snapshot_date), days),
          portfolio: firstValue > 0 ? ((portfolioVal - firstValue) / firstValue) * 100 : 0,
          nse20: firstNse > 0 ? ((bench.nse - firstNse) / firstNse) * 100 : 0,
          sp500: firstSp > 0 ? ((bench.sp - firstSp) / firstSp) * 100 : 0,
          portfolioRaw: portfolioVal,
          nse20Raw: bench.nse,
          sp500Raw: bench.sp,
        });
      }
    } else {
      const firstNse = benchmarkHistory[0]?.nse || nseCurrent;
      const firstSp = benchmarkHistory[0]?.sp || spCurrent;

      for (let i = 0; i < numPoints; i++) {
        const bench = benchmarkHistory[i];
        const d = new Date(Date.now() - (numPoints - i) * (days / numPoints) * 24 * 60 * 60 * 1000);

        data.push({
          month: formatDateLabel(d, days),
          portfolio: 0,
          nse20: firstNse > 0 ? ((bench.nse - firstNse) / firstNse) * 100 : 0,
          sp500: firstSp > 0 ? ((bench.sp - firstSp) / firstSp) * 100 : 0,
          portfolioRaw: 0,
          nse20Raw: bench.nse,
          sp500Raw: bench.sp,
        });
      }
    }

    const totalReturn = currentValue - initialCapital;
    const totalReturnPercent = initialCapital > 0 ? ((currentValue - initialCapital) / initialCapital) * 100 : 0;

    res.json({
      data,
      period,
      hasHistory,
      currentValue: Math.round(currentValue * 100) / 100,
      totalReturn: Math.round(totalReturn * 100) / 100,
      totalReturnPercent: Math.round(totalReturnPercent * 10) / 10,
      fxRate,
    });
  } catch (err) {
    console.error('Error in portfolio performance:', err);
    res.status(500).json({ error: 'Failed to generate performance data' });
  }
});

// --- Portfolio Routes ---
app.get('/api/portfolio/:userId', async (req, res) => {
  try {
    const userId = req.params.userId;
    const holdings = await pool.query(
      'SELECT * FROM portfolio_holdings WHERE user_id = $1 ORDER BY sector, ticker', [userId]
    );
    const account = await pool.query(
      'SELECT * FROM paper_accounts WHERE user_id = $1', [userId]
    );
    res.json({ holdings: holdings.rows, account: account.rows[0] || null });
  } catch (error) {
    res.status(500).json({ error: 'An unexpected error occurred' });
  }
});

app.get('/api/portfolio/:userId/holdings', async (req, res) => {
  try {
    const userId = req.params.userId;
    const result = await pool.query(
      'SELECT * FROM portfolio_holdings WHERE user_id = $1 ORDER BY sector, ticker', [userId]
    );
    res.json(result.rows);
  } catch (error) {
    res.status(500).json({ error: 'An unexpected error occurred' });
  }
});

app.get('/api/portfolio/:userId/account', async (req, res) => {
  try {
    const userId = req.params.userId;
    const result = await pool.query('SELECT * FROM paper_accounts WHERE user_id = $1', [userId]);
    res.json(result.rows[0] || null);
  } catch (error) {
    res.status(500).json({ error: 'An unexpected error occurred' });
  }
});

app.post('/api/portfolio/holdings', async (req, res) => {
  try {
    const { user_id, ticker, shares, avg_cost, name, sector, market } = req.body;
    const result = await pool.query(
      `INSERT INTO portfolio_holdings (user_id, ticker, shares, avg_cost, name, sector, market)
       VALUES ($1, $2, $3, $4, $5, $6, $7)
       ON CONFLICT (user_id, ticker) DO UPDATE SET shares = $3, avg_cost = $4, name = $5, sector = $6, market = $7
       RETURNING *`,
      [user_id, ticker?.toUpperCase(), shares, avg_cost, name, sector || 'Other', market || 'NSE']
    );
    snapshotPortfolioValue(user_id).catch(() => {});
    res.status(201).json(result.rows[0]);
  } catch (error) {
    res.status(500).json({ error: 'An unexpected error occurred' });
  }
});

app.delete('/api/portfolio/holdings/:id', async (req, res) => {
  try {
    await pool.query('DELETE FROM portfolio_holdings WHERE id = $1', [req.params.id]);
    res.json({ success: true });
  } catch (error) {
    res.status(500).json({ error: 'An unexpected error occurred' });
  }
});

// --- Paper Trading Routes ---
app.post('/api/trade', async (req, res) => {
  try {
    const { user_id, ticker, type, shares, price, name, market, sector, currency } = req.body;
    if (!user_id || !ticker || !type || !shares || !price) {
      return res.status(400).json({ error: 'Missing required fields' });
    }
    const totalValue = shares * price;
    const commission = totalValue * 0.01;
    const fees = totalValue * 0.001;
    const tradeCurrency = currency || (market === 'NSE' ? 'KES' : 'USD');
    const result = await pool.query(
      `INSERT INTO paper_trades (user_id, ticker, name, shares, price, type, market, sector, currency, total_value, commission, fees)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12) RETURNING *`,
      [user_id, ticker, name, shares, price, type, market || 'NSE', sector || 'Other', tradeCurrency, totalValue, commission, fees]
    );
    snapshotPortfolioValue(user_id).catch(() => {});
    pool.query('SELECT email, full_name FROM users WHERE id = $1', [user_id]).then(u => {
      if (u.rows.length) logUserActivity(user_id, u.rows[0].email, u.rows[0].full_name, 'trade', { ticker, type, shares, price, market }, req.ip);
    });
    res.status(201).json(result.rows[0]);
  } catch (error) {
    res.status(500).json({ error: 'An unexpected error occurred' });
  }
});

app.get('/api/trades/:userId', async (req, res) => {
  try {
    const userId = req.params.userId;
    const limit = parseInt(req.query.limit) || 50;
    const result = await pool.query(
      'SELECT * FROM paper_trades WHERE user_id = $1 ORDER BY created_at DESC LIMIT $2', [userId, limit]
    );
    res.json(result.rows);
  } catch (error) {
    res.status(500).json({ error: 'An unexpected error occurred' });
  }
});

// --- Broker Routes ---
// Unified broker-connections API (used by frontend)
app.get('/api/broker-connections', async (req, res) => {
  try {
    const userId = req.query.userId;
    if (!userId) return res.status(400).json({ error: 'userId is required' });
    const connections = await brokerService.getConnections(userId);
    res.json(connections);
  } catch (err) {
    console.error('Error fetching broker connections:', err.message);
    res.status(500).json({ error: 'Failed to fetch broker connections' });
  }
});

app.post('/api/broker-connections', async (req, res) => {
  try {
    const { userId, brokerType, accountName, apiKey, apiSecret, config } = req.body;
    if (!userId || !brokerType || !accountName) {
      return res.status(400).json({ error: 'userId, brokerType, and accountName are required' });
    }
    const connection = await brokerService.saveConnection(userId, brokerType, accountName, apiKey || '', apiSecret || '', config || {});
    res.status(201).json(connection);
  } catch (error) {
    console.error('Error creating broker connection:', error.message);
    res.status(500).json({ error: 'Failed to create broker connection' });
  }
});

// Parse broker credentials from email text
function parseBrokerEmail(emailText) {
  const result = { brokerName: '', accountId: '', password: '', investorPassword: '', accountType: 'Demo', server: '', platform: '', platformType: 'mt5' };

  // Known broker names
  const knownBrokers = [
    'INGOT Brokers', 'FXTM', 'Exness', 'IC Markets', 'XM', 'Pepperstone',
    'OANDA', 'IG', 'Plus500', 'eToro', 'Forex.com', 'AvaTrade', 'FBS',
    'HotForex', 'HFM', 'RoboForex', 'Tickmill', 'Admiral Markets', 'Admirals',
    'FP Markets', 'OctaFX', 'JustMarkets', 'Deriv', 'Vantage', 'ThinkMarkets',
    'Blueberry Markets', 'Eightcap', 'BlackBull Markets', 'Axi', 'ForexTime'
  ];
  const lowerText = emailText.toLowerCase();
  for (const name of knownBrokers) {
    if (lowerText.includes(name.toLowerCase())) {
      result.brokerName = name;
      break;
    }
  }
  if (!result.brokerName) {
    const m = emailText.match(/(?:with|at|welcome to)\s+([A-Z][a-zA-Z0-9]{1,30}(?:\s+[A-Z][a-zA-Z0-9]{1,30}){0,2})/);
    if (m) result.brokerName = m[1].trim();
  }

  // Login
  const loginMatch = emailText.match(/(?:Login|User\s*ID|Account\s*(?:ID|Number|No)|ID)\s*[:：=]\s*(\d+)/i);
  if (loginMatch) result.accountId = loginMatch[1].trim();

  // Master Password
  const pwMatch = emailText.match(/(?:Master\s+Password|Password)\s*[:：=]\s*(\S+)/i);
  if (pwMatch) result.password = pwMatch[1].trim();

  // Investor (Read-Only) Password
  const invPwMatch = emailText.match(/(?:Investor\s*[:：(]\s*Read-Only\s*Password[)）]?|Read-Only\s*Password|Investor\s+Password)\s*[:：=]\s*(\S+)/i);
  if (invPwMatch) result.investorPassword = invPwMatch[1].trim();

  // Account Type
  const typeMatch = emailText.match(/(?:Account\s*Type|AccountType)\s*[:：=]\s*(\S+)/i);
  if (typeMatch) {
    const raw = typeMatch[1].trim();
    const isDemo = /demo|practice|standard/i.test(raw);
    result.accountType = isDemo ? 'Demo' : 'Live';
  } else if (/you have (?:successfully )?opened a (demo|live)/i.test(emailText)) {
    result.accountType = /opened a demo/i.test(emailText) ? 'Demo' : 'Live';
  } else if (/your (demo|live|real) account/i.test(emailText)) {
    const m = emailText.match(/your (demo|live|real) account/i);
    result.accountType = m[1].toLowerCase() === 'demo' ? 'Demo' : 'Live';
  }

  // Platform (mt4/mt5)
  const platMatch = emailText.match(/Platform\s*[:：=]\s*(mt[45]|meta[tT]rader[45]?)/i);
  if (platMatch) {
    const p = platMatch[1].toLowerCase();
    result.platform = p.startsWith('mt') ? `MetaTrader ${p[2]}` : 'MetaTrader';
    result.platformType = p.includes('4') ? 'mt4' : 'mt5';
  }

  // Server
  const serverMatch = emailText.match(/(?:Server|ServerName|Server\s*Name|Trade\s*Server)\s*[:：=]\s*(\S+)/i);
  if (serverMatch) result.server = serverMatch[1].trim();

  return result;
}

app.post('/api/broker-connections/parse-email', async (req, res) => {
  try {
    const { emailText } = req.body;
    if (!emailText || typeof emailText !== 'string' || emailText.trim().length < 20) {
      return res.status(400).json({ error: 'Valid email text is required (min 20 chars)' });
    }
    const parsed = parseBrokerEmail(emailText);
    res.json({ success: true, parsed });
  } catch (error) {
    res.status(500).json({ error: 'Failed to parse email' });
  }
});

app.post('/api/broker-connections/validate', async (req, res) => {
  try {
    const { brokerType, apiKey, apiSecret, config } = req.body;
    if (!brokerType) return res.status(400).json({ error: 'brokerType is required' });
    const result = await brokerService.validateConnection(brokerType || 'generic', apiKey || '', apiSecret || '', config || {});
    res.json(result);
  } catch (error) {
    console.error('[Broker validate]', error.message);
    res.json({ valid: false, error: 'Validation failed' });
  }
});

app.post('/api/broker-connections/:id/sync', async (req, res) => {
  try {
    const result = await brokerService.syncConnection(req.params.id);
    // Emit real-time update to the owning user
    try {
      const { pool } = require('./db');
      const { rows } = await pool.query('SELECT user_id FROM broker_connections WHERE id = $1', [req.params.id]);
      if (rows.length > 0) {
        io.to(`user:${rows[0].user_id}`).emit('broker:sync', { connectionId: req.params.id, result });
      }
    } catch {}
    res.json(result);
  } catch (error) {
    console.error('Error syncing broker connection:', error.message);
    res.status(500).json({ error: 'Failed to sync broker connection' });
  }
});

app.get('/api/broker-connections/:id/snapshots', async (req, res) => {
  try {
    const { pool } = require('./db');
    const limit = parseInt(req.query.limit) || 10;
    const result = await pool.query(
      `SELECT id, broker_connection_id, balance, equity, margin, free_margin, level, positions, trade_history, snapshot_at
       FROM broker_account_snapshots
       WHERE broker_connection_id = $1
       ORDER BY snapshot_at DESC
       LIMIT $2`,
      [req.params.id, limit]
    );
    const rows = result.rows.map(r => ({
      ...r,
      positions: typeof r.positions === 'string' ? JSON.parse(r.positions) : (r.positions || []),
      trade_history: typeof r.trade_history === 'string' ? JSON.parse(r.trade_history) : (r.trade_history || []),
      snapshot_at: r.snapshot_at ? r.snapshot_at.toISOString() : null,
    }));
    res.json(rows);
  } catch (error) {
    console.error('Error fetching broker snapshots:', error.message);
    res.status(500).json({ error: 'Failed to fetch broker snapshots' });
  }
});

app.delete('/api/broker-connections/:id', async (req, res) => {
  try {
    const { id } = req.params;
    const userId = req.query.userId;
    if (!userId) return res.status(400).json({ error: 'userId is required' });
    const deleted = await brokerService.deleteConnection(Number(id), userId);
    if (!deleted) return res.status(404).json({ error: 'Broker connection not found' });
    res.status(204).send();
  } catch (err) {
    console.error('Error deleting broker connection:', err.message);
    res.status(500).json({ error: 'Failed to delete broker connection' });
  }
});

// --- Social/Trading Groups Routes ---
app.get('/api/groups', async (req, res) => {
  try {
    const userId = req.query.userId;
    const result = await pool.query(`
      SELECT g.id, g.name, g.description, g.icon, g.topic, g.created_by,
             COUNT(DISTINCT gm.user_id)::int as members,
             COUNT(DISTINCT m.id)::int as message_count,
             COUNT(DISTINCT CASE WHEN m.created_at > NOW() - INTERVAL '1 hour' THEN m.id END)::int as activity_last_hour
      FROM trading_groups g
      LEFT JOIN group_members gm ON g.id = gm.group_id
      LEFT JOIN messages m ON m.group_id = g.id
      GROUP BY g.id
      ORDER BY activity_last_hour DESC, members DESC
    `);
    let userGroupIds = new Set();
    if (userId) {
      const { rows } = await pool.query(
        'SELECT group_id FROM group_members WHERE user_id = $1', [userId]
      );
      userGroupIds = new Set(rows.map(r => r.group_id));
    }
    const memberIdsByGroup = new Map();
    if (result.rows.length > 0) {
      const { rows: gmRows } = await pool.query(
        'SELECT group_id, user_id FROM group_members'
      );
      for (const r of gmRows) {
        if (!memberIdsByGroup.has(r.group_id)) memberIdsByGroup.set(r.group_id, []);
        memberIdsByGroup.get(r.group_id).push(r.user_id);
      }
    }
    const groups = result.rows.map(g => {
      const memberIds = memberIdsByGroup.get(g.id) || [];
      const onlineCount = memberIds.filter(id => onlineUsers.has(id)).length;
      return {
        ...g,
        isJoined: userGroupIds.has(g.id),
        isAdmin: userId && g.created_by && String(g.created_by) === String(userId),
        online_members: onlineCount,
        trending: g.activity_last_hour > 0 && g.activity_last_hour >= g.members * 0.1,
      };
    });
    res.json(groups);
  } catch (error) {
    console.error('Error fetching groups:', error.message);
    try {
      const result = await pool.query('SELECT * FROM trading_groups ORDER BY name');
      const groups = result.rows.map(g => ({ ...g, members: 0, message_count: 0, activity_last_hour: 0, isJoined: false, isAdmin: false, online_members: 0, trending: false, createdAt: 0 }));
      res.json(groups);
    } catch {
      res.json([]);
    }
  }
});

app.post('/api/groups', async (req, res) => {
  try {
    const { id, name, description, icon, topic, created_by } = req.body;
    if (!id || !name) return res.status(400).json({ error: 'id and name are required' });
    const result = await pool.query(
      `INSERT INTO trading_groups (id, name, description, icon, topic, created_by)
       VALUES ($1, $2, $3, $4, $5, $6)
       ON CONFLICT (id) DO UPDATE SET name = $2, description = $3, icon = $4, topic = $5, created_by = COALESCE(trading_groups.created_by, $6)
       RETURNING *`,
      [id, name, description || '', icon || '📊', topic || 'General', created_by || null]
    );
    res.status(201).json(result.rows[0]);
  } catch (error) {
    console.error('Error creating group:', error.message);
    res.status(500).json({ error: 'An unexpected error occurred' });
  }
});

app.get('/api/groups/:groupId/messages', async (req, res) => {
  try {
    const groupId = req.params.groupId;
    const limit = parseInt(req.query.limit) || 50;
    const result = await pool.query(
      'SELECT * FROM messages WHERE group_id = $1 ORDER BY created_at DESC LIMIT $2',
      [groupId, limit]
    );
    res.json(result.rows.reverse());
  } catch (error) {
    res.status(500).json({ error: 'An unexpected error occurred' });
  }
});

app.post('/api/groups/:groupId/messages', async (req, res) => {
  try {
    const { sender_id, sender_name, content, message_type } = req.body;
    const result = await pool.query(
      `INSERT INTO messages (sender_id, sender_name, content, message_type, group_id)
       VALUES ($1, $2, $3, $4, $5) RETURNING *`,
      [sender_id, sender_name || 'Anonymous', content, message_type || 'user', req.params.groupId]
    );
    const msg = result.rows[0];
    const groupId = req.params.groupId;
    io.to(`group:${groupId}`).emit('receive_message', msg);
    res.status(201).json(msg);
  } catch (error) {
    res.status(500).json({ error: 'An unexpected error occurred' });
  }
});

app.post('/api/groups/:id/join', async (req, res) => {
  try {
    const { userId } = req.body;
    if (!userId) return res.status(400).json({ error: 'userId is required' });
    await pool.query(
      'INSERT INTO group_members (group_id, user_id) VALUES ($1, $2) ON CONFLICT DO NOTHING',
      [req.params.id, userId]
    );
    io.emit('group_member_joined', { groupId: req.params.id, userId: Number(userId) });
    res.json({ success: true });
  } catch (error) {
    console.error('Error joining group:', error.message);
    res.status(500).json({ error: 'Failed to join group' });
  }
});

app.post('/api/groups/:id/leave', async (req, res) => {
  try {
    const { userId } = req.body;
    if (!userId) return res.status(400).json({ error: 'userId is required' });
    await pool.query(
      'DELETE FROM group_members WHERE group_id = $1 AND user_id = $2',
      [req.params.id, userId]
    );
    io.emit('group_member_left', { groupId: req.params.id, userId: Number(userId) });
    res.json({ success: true });
  } catch (error) {
    console.error('Error leaving group:', error.message);
    res.status(500).json({ error: 'Failed to leave group' });
  }
});

app.get('/api/groups/:id/members', async (req, res) => {
  try {
    const result = await pool.query(
      `SELECT u.id, u.full_name, u.email, u.role, u.trader_type, u.is_verified,
              gm.joined_at
       FROM group_members gm
       JOIN users u ON u.id = gm.user_id
       WHERE gm.group_id = $1
       ORDER BY u.full_name`,
      [req.params.id]
    );
    const members = result.rows.map(m => ({
      ...m,
      online: onlineUsers.has(m.id),
      last_seen: lastSeen.has(m.id) ? lastSeen.get(m.id).toISOString() : null,
    }));
    res.json(members);
  } catch (error) {
    console.error('Error fetching group members:', error.message);
    res.status(500).json({ error: 'Failed to fetch members' });
  }
});

// --- Chat Routes (1:1) ---
app.get('/api/chat/:userId/:otherUserId', async (req, res) => {
  try {
    const { userId, otherUserId } = req.params;
    const limit = parseInt(req.query.limit) || 50;
    const result = await pool.query(
      `SELECT * FROM messages WHERE (sender_id = $1 AND recipient_id = $2) OR (sender_id = $2 AND recipient_id = $1)
       ORDER BY created_at DESC LIMIT $3`,
      [userId, otherUserId, limit]
    );
    res.json(result.rows.reverse());
  } catch (error) {
    res.status(500).json({ error: 'An unexpected error occurred' });
  }
});

app.get('/api/conversations/:userId/:otherUserId', async (req, res) => {
  try {
    const { userId, otherUserId } = req.params;
    const limit = parseInt(req.query.limit) || 50;
    const result = await pool.query(
      `SELECT * FROM messages WHERE (sender_id = $1 AND recipient_id = $2) OR (sender_id = $2 AND recipient_id = $1)
       ORDER BY created_at DESC LIMIT $3`,
      [userId, otherUserId, limit]
    );
    res.json(result.rows.reverse());
  } catch (error) {
    res.status(500).json({ error: 'An unexpected error occurred' });
  }
});

app.post('/api/chat/send', async (req, res) => {
  try {
    const { sender_id, recipient_id, content } = req.body;
    const result = await pool.query(
      `INSERT INTO messages (sender_id, recipient_id, content, message_type)
       VALUES ($1, $2, $3, 'user') RETURNING *`,
      [sender_id, recipient_id, content]
    );
    const msg = result.rows[0];
    io.to(`user:${recipient_id}`).emit('receive_message', msg);
    res.status(201).json(msg);
  } catch (error) {
    res.status(500).json({ error: 'An unexpected error occurred' });
  }
});

// --- Notification Routes ---
app.get('/api/notifications/:userId', async (req, res) => {
  try {
    const userId = req.params.userId;
    const limit = parseInt(req.query.limit) || 50;
    const result = await pool.query(
      'SELECT * FROM notifications WHERE user_id = $1 ORDER BY created_at DESC LIMIT $2',
      [userId, limit]
    );
    res.json(result.rows);
  } catch (error) {
    res.status(500).json({ error: 'An unexpected error occurred' });
  }
});

app.post('/api/notifications/:id/read', async (req, res) => {
  try {
    await pool.query('UPDATE notifications SET read = true WHERE id = $1', [req.params.id]);
    res.json({ success: true });
  } catch (error) {
    res.status(500).json({ error: 'An unexpected error occurred' });
  }
});

app.post('/api/notifications/read-all', async (req, res) => {
  try {
    const { userId } = req.body;
    if (!userId) return res.status(400).json({ error: 'userId is required' });
    await pool.query('UPDATE notifications SET read = true WHERE user_id = $1', [userId]);
    res.json({ success: true });
  } catch (error) {
    res.status(500).json({ error: 'An unexpected error occurred' });
  }
});

// --- Financial Reports Routes ---
app.get('/api/financials/status', async (req, res) => {
  try {
    const edgarStatus = require('./edgarService').getProviderStatus();
    const simfinStatus = simfinService.getProviderStatus();
    const fmpApiKey = process.env.FMP_API_KEY || '';
    res.json({
      providerConfigured: Boolean(fmpApiKey),
      provider: process.env.FINANCIALS_PROVIDER || 'auto',
      edgarConfigured: edgarStatus.edgarConfigured,
      edgarApiKeyConfigured: edgarStatus.edgarApiKeyConfigured,
      simfinConfigured: simfinStatus.simfinConfigured,
      simfinApiKeyConfigured: simfinStatus.simfinApiKeyConfigured,
      yahooFinanceConfigured: true,
      message: 'Financial data providers: Yahoo Finance, FMP, SEC EDGAR, SimFin',
    });
  } catch (error) {
    res.status(500).json({ error: 'An unexpected error occurred' });
  }
});

app.get('/api/financials/:symbol', async (req, res) => {
  try {
    const symbol = req.params.symbol.toUpperCase();
    const period = req.query.period || 'annual';
    const limit = parseInt(req.query.limit, 10) || 4;
    const provider = req.query.provider || null;
    const report = await getFinancialReport(symbol, period, limit, provider);
    res.json(report);
  } catch (error) {
    console.error('[Financial report]', error.message);
    res.status(500).json({ success: false, error: 'Failed to fetch financial report', lastUpdated: new Date().toISOString() });
  }
});

app.get('/api/financials/:symbol/income', async (req, res) => {
  try {
    const symbol = req.params.symbol.toUpperCase();
    const data = await getIncomeStatement(symbol);
    res.json(data || []);
  } catch (error) {
    res.status(500).json({ error: 'An unexpected error occurred' });
  }
});

app.get('/api/financials/:symbol/balance', async (req, res) => {
  try {
    const symbol = req.params.symbol.toUpperCase();
    const data = await getBalanceSheet(symbol);
    res.json(data || []);
  } catch (error) {
    res.status(500).json({ error: 'An unexpected error occurred' });
  }
});

app.get('/api/financials/:symbol/cashflow', async (req, res) => {
  try {
    const symbol = req.params.symbol.toUpperCase();
    const data = await getCashFlowStatement(symbol);
    res.json(data || []);
  } catch (error) {
    res.status(500).json({ error: 'An unexpected error occurred' });
  }
});

app.get('/api/financials/:symbol/metrics', async (req, res) => {
  try {
    const symbol = req.params.symbol.toUpperCase();
    const data = await getKeyMetrics(symbol);
    res.json(data || []);
  } catch (error) {
    res.status(500).json({ error: 'An unexpected error occurred' });
  }
});

app.get('/api/financials/:symbol/dividends', async (req, res) => {
  try {
    const symbol = req.params.symbol.toUpperCase();
    const limit = parseInt(req.query.limit) || 8;
    const data = await getDividendHistory(symbol, limit);
    res.json({ success: true, data: data || [] });
  } catch (error) {
    res.status(500).json({ error: 'An unexpected error occurred' });
  }
});

// --- Bond Routes ---
app.get('/api/bonds', async (req, res) => {
  try {
    const bonds = await getBonds(req.query.market || 'kenya');
    res.json(bonds);
  } catch (error) {
    res.status(500).json({ error: 'An unexpected error occurred' });
  }
});

app.get('/api/bonds/summary', async (req, res) => {
  try {
    const summary = await getBondSummary();
    res.json(summary);
  } catch (error) {
    res.status(500).json({ error: 'An unexpected error occurred' });
  }
});

app.get('/api/bonds/:id', async (req, res) => {
  try {
    const bond = await getBondById(req.params.id);
    if (!bond) return res.status(404).json({ error: 'Bond not found' });
    res.json(bond);
  } catch (error) {
    res.status(500).json({ error: 'An unexpected error occurred' });
  }
});

app.get('/api/bonds/:type/access', async (req, res) => {
  try {
    const market = req.query.market || 'kenya';
    const access = await getMarketAccess(req.params.type, market);
    res.json({ type: req.params.type, market, methods: access || [] });
  } catch (error) {
    res.status(500).json({ error: 'An unexpected error occurred' });
  }
});

// --- ETF Routes ---
app.get('/api/etfs', async (req, res) => {
  try {
    const etfs = await getETFs(req.query.market || 'all');
    res.json(etfs);
  } catch (error) {
    res.status(500).json({ error: 'An unexpected error occurred' });
  }
});

app.get('/api/etfs/summary', async (req, res) => {
  try {
    const summary = await getETFSummary();
    res.json(summary);
  } catch (error) {
    res.status(500).json({ error: 'An unexpected error occurred' });
  }
});

app.get('/api/etfs/:ticker', async (req, res) => {
  try {
    const etf = await getETFByTicker(req.params.ticker.toUpperCase());
    if (!etf) return res.status(404).json({ error: 'ETF not found' });
    res.json(etf);
  } catch (error) {
    res.status(500).json({ error: 'An unexpected error occurred' });
  }
});

// --- FX Routes ---
app.get('/api/fx/rate', async (req, res) => {
  try {
    const rate = await fxService.getRate();
    res.json({ rate });
  } catch (error) {
    res.status(500).json({ error: 'An unexpected error occurred' });
  }
});

app.get('/api/fx/convert', async (req, res) => {
  try {
    const { amount, from, to } = req.query;
    const result = await fxService.convert(parseFloat(amount), from, to);
    res.json(result);
  } catch (error) {
    res.status(500).json({ error: 'An unexpected error occurred' });
  }
});

// --- Market Status ---
app.get('/api/market/status', async (req, res) => {
  res.json({
    nse: isMarketOpen('NSE'),
    global: isMarketOpen('Global'),
  });
});

// --- NSE Market Data Routes ---
app.get('/api/market/nse', async (req, res) => {
  try {
    const symbols = STOCK_SYMBOLS;
    const quotes = await Promise.all(symbols.map(s => getStockQuote(s).catch(() => null)));
    const filtered = quotes.filter(Boolean).map(q => ({
      ...q,
      volumeFormatted: formatVolume(q.volume),
      turnoverFormatted: formatTurnover(q.turnover),
    }));
    res.json(filtered);
  } catch (error) {
    res.status(500).json({ error: 'An unexpected error occurred' });
  }
});

app.get('/api/market/us', async (req, res) => {
  try {
    const symbols = ['AAPL','MSFT','GOOGL','AMZN','NVDA','META','TSLA','JPM','V','NFLX'];
    const quotes = await Promise.all(symbols.map(s => getStockQuote(s).catch(() => null)));
    res.json(quotes.filter(Boolean));
  } catch (error) {
    res.status(500).json({ error: 'An unexpected error occurred' });
  }
});

// --- Sentiment Email Preference ---
app.get('/api/user/sentiment-preference', async (req, res) => {
  try {
    const userId = req.query.userId;
    if (!userId) return res.status(400).json({ error: 'userId required' });
    const result = await pool.query('SELECT sentiment_opt_in FROM users WHERE id = $1', [userId]);
    if (result.rows.length === 0) return res.status(404).json({ error: 'User not found' });
    res.json({ optedIn: result.rows[0].sentiment_opt_in || false });
  } catch (error) {
    res.status(500).json({ error: 'An unexpected error occurred' });
  }
});

app.post('/api/user/send-test-portfolio', requireOwnership, async (req, res) => {
  try {
    let { userId, email } = req.body;
    let fullName = 'Trader';
    if (userId) {
      const result = await pool.query('SELECT id, full_name, email FROM users WHERE id = $1', [userId]);
      if (result.rows.length === 0) return res.status(404).json({ error: 'User not found' });
      email = result.rows[0].email;
      fullName = result.rows[0].full_name;
    }
    if (!email) return res.status(400).json({ error: 'email or userId required' });
    const userIdNum = userId ? parseInt(userId) : null;
    if (!userIdNum) return res.status(400).json({ error: 'userId required' });
    const sent = await sendPortfolioReportToUser(userIdNum, email, fullName);
    if (sent) {
      res.json({ success: true, message: `Real portfolio report sent to ${email}` });
    } else {
      res.json({ success: false, message: `User ${email} has no real portfolio holdings` });
    }
  } catch (error) {
    console.error('send-test-portfolio error:', error.message);
    res.status(500).json({ error: 'An unexpected error occurred' });
  }
});

app.post('/api/user/send-test-paper-portfolio', requireOwnership, async (req, res) => {
  try {
    let { userId, email } = req.body;
    let fullName = 'Trader';
    if (userId) {
      const result = await pool.query('SELECT id, full_name, email FROM users WHERE id = $1', [userId]);
      if (result.rows.length === 0) return res.status(404).json({ error: 'User not found' });
      email = result.rows[0].email;
      fullName = result.rows[0].full_name;
    }
    if (!email) return res.status(400).json({ error: 'email or userId required' });
    const userIdNum = userId ? parseInt(userId) : null;
    if (!userIdNum) return res.status(400).json({ error: 'userId required' });
    const sent = await sendPaperTradingReportToUser(userIdNum, email, fullName);
    if (sent) {
      res.json({ success: true, message: `Paper trading portfolio report sent to ${email}` });
    } else {
      res.json({ success: false, message: `User ${email} has no paper trading positions` });
    }
  } catch (error) {
    console.error('send-test-paper-portfolio error:', error.message);
    res.status(500).json({ error: 'An unexpected error occurred' });
  }
});

app.post('/api/user/sentiment-preference', async (req, res) => {
  try {
    const { userId, optedIn } = req.body;
    if (!userId) return res.status(400).json({ error: 'userId required' });
    await pool.query('UPDATE users SET sentiment_opt_in = $1 WHERE id = $2', [optedIn, userId]);
    res.json({ success: true, optedIn: !!optedIn });
  } catch (error) {
    res.status(500).json({ error: 'An unexpected error occurred' });
  }
});

// --- Weekly Digest Preference ---
app.get('/api/user/weekly-digest-preference', async (req, res) => {
  try {
    const userId = req.query.userId;
    if (!userId) return res.status(400).json({ error: 'userId required' });
    const result = await pool.query('SELECT weekly_digest_opt_in FROM users WHERE id = $1', [userId]);
    if (result.rows.length === 0) return res.status(404).json({ error: 'User not found' });
    res.json({ optedIn: result.rows[0].weekly_digest_opt_in !== false });
  } catch (error) {
    res.status(500).json({ error: 'An unexpected error occurred' });
  }
});

app.post('/api/user/weekly-digest-preference', async (req, res) => {
  try {
    const { userId, optedIn } = req.body;
    if (!userId) return res.status(400).json({ error: 'userId required' });
    await pool.query('UPDATE users SET weekly_digest_opt_in = $1 WHERE id = $2', [optedIn, userId]);
    res.json({ success: true, optedIn: !!optedIn });
  } catch (error) {
    res.status(500).json({ error: 'An unexpected error occurred' });
  }
});

// --- Daily Brief Preference ---
app.get('/api/user/daily-brief-preference', async (req, res) => {
  try {
    const userId = req.query.userId;
    if (!userId) return res.status(400).json({ error: 'userId required' });
    const result = await pool.query('SELECT daily_brief_opt_in FROM users WHERE id = $1', [userId]);
    if (result.rows.length === 0) return res.status(404).json({ error: 'User not found' });
    res.json({ optedIn: result.rows[0].daily_brief_opt_in !== false });
  } catch (error) {
    res.status(500).json({ error: 'An unexpected error occurred' });
  }
});

app.post('/api/user/daily-brief-preference', async (req, res) => {
  try {
    const { userId, optedIn } = req.body;
    if (!userId) return res.status(400).json({ error: 'userId required' });
    await pool.query('UPDATE users SET daily_brief_opt_in = $1 WHERE id = $2', [optedIn, userId]);
    res.json({ success: true, optedIn: !!optedIn });
  } catch (error) {
    res.status(500).json({ error: 'An unexpected error occurred' });
  }
});

// --- Earnings Report Preference ---
app.get('/api/user/earnings-report-preference', async (req, res) => {
  try {
    const userId = req.query.userId;
    if (!userId) return res.status(400).json({ error: 'userId required' });
    const result = await pool.query('SELECT earnings_report_opt_in FROM users WHERE id = $1', [userId]);
    if (result.rows.length === 0) return res.status(404).json({ error: 'User not found' });
    res.json({ optedIn: result.rows[0].earnings_report_opt_in !== false });
  } catch (error) {
    res.status(500).json({ error: 'An unexpected error occurred' });
  }
});

app.post('/api/user/earnings-report-preference', async (req, res) => {
  try {
    const { userId, optedIn } = req.body;
    if (!userId) return res.status(400).json({ error: 'userId required' });
    await pool.query('UPDATE users SET earnings_report_opt_in = $1 WHERE id = $2', [optedIn, userId]);
    res.json({ success: true, optedIn: !!optedIn });
  } catch (error) {
    res.status(500).json({ error: 'An unexpected error occurred' });
  }
});

app.post('/api/user/send-test-sentiment', async (req, res) => {
  try {
    let { userId, email, fullName } = req.body;
    if (userId) {
      const result = await pool.query('SELECT id, full_name, email FROM users WHERE id = $1', [userId]);
      if (result.rows.length === 0) return res.status(404).json({ error: 'User not found' });
      email = result.rows[0].email;
      fullName = result.rows[0].full_name;
    }
    if (!email) return res.status(400).json({ error: 'email or userId required' });
    const summaryRes = await axios.get(`http://localhost:${port}/api/ai/market-summary`).then(r => r.data).catch(() => null);
    const moversRes = await axios.get(`http://localhost:${port}/api/market/movers`).then(r => r.data).catch(() => ({}));
    const dateStr = new Date().toLocaleDateString('en-US', { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' });
    await sendDailySentimentEmail(email, {
      userName: fullName || 'Trader',
      summary: summaryRes?.summary || 'Markets showing mixed activity today.',
      sentiment: summaryRes?.sentiment || 'Neutral',
      confidence: summaryRes?.confidence || '65%',
      dateStr,
      nseGainers: moversRes?.nse?.gainers?.slice(0, 8) || [],
      nseLosers: moversRes?.nse?.losers?.slice(0, 8) || [],
      globalGainers: moversRes?.global?.gainers?.slice(0, 8) || [],
      globalLosers: moversRes?.global?.losers?.slice(0, 8) || [],
      signals: summaryRes?.signals || { total: 0, strongBuys: 0, buys: 0, sells: 0 },
    });
    res.json({ success: true, message: 'Test sentiment email sent' });
  } catch (error) {
    console.error('send-test-sentiment error:', error.message);
    res.status(500).json({ error: 'An unexpected error occurred' });
  }
});

// --- Hot News Email ---
app.post('/api/user/send-test-hot-news', async (req, res) => {
  try {
    let { userId, email, fullName } = req.body;
    if (userId) {
      const result = await pool.query('SELECT id, full_name, email FROM users WHERE id = $1', [userId]);
      if (result.rows.length === 0) return res.status(404).json({ error: 'User not found' });
      email = result.rows[0].email;
      fullName = result.rows[0].full_name;
    }
    if (!email) return res.status(400).json({ error: 'email or userId required' });
    const sent = await sendHotNewsReportToUser(userId ? parseInt(userId) : null, email, fullName);
    if (sent) {
      res.json({ success: true, message: 'Hot news report sent to ' + email });
    } else {
      res.json({ success: false, message: 'No hot news found to send' });
    }
  } catch (error) {
    console.error('send-test-hot-news error:', error.message);
    res.status(500).json({ error: 'An unexpected error occurred' });
  }
});

// --- Weekly Digest "Send Now" ---
app.post('/api/user/send-test-digest', async (req, res) => {
  try {
    let { userId, email, fullName } = req.body;
    if (userId) {
      const result = await pool.query('SELECT id, full_name, email FROM users WHERE id = $1', [userId]);
      if (result.rows.length === 0) return res.status(404).json({ error: 'User not found' });
      email = result.rows[0].email;
      fullName = result.rows[0].full_name;
    }
    if (!email) return res.status(400).json({ error: 'email or userId required' });
    const sent = await sendWeeklyDigestToUser(userId ? parseInt(userId) : null, email, fullName);
    if (sent) {
      res.json({ success: true, message: 'Weekly digest sent to ' + email });
    } else {
      res.json({ success: false, message: 'Could not send digest (no market data available)' });
    }
  } catch (error) {
    console.error('send-test-digest error:', error.message);
    res.status(500).json({ error: 'An unexpected error occurred' });
  }
});

// --- Daily Brief "Send Now" ---
app.post('/api/user/send-test-brief', async (req, res) => {
  try {
    let { userId, email, fullName } = req.body;
    if (userId) {
      const result = await pool.query('SELECT id, full_name, email FROM users WHERE id = $1', [userId]);
      if (result.rows.length === 0) return res.status(404).json({ error: 'User not found' });
      email = result.rows[0].email;
      fullName = result.rows[0].full_name;
    }
    if (!email) return res.status(400).json({ error: 'email or userId required' });
    const sent = await sendDailyBriefToUser(userId ? parseInt(userId) : null, email, fullName);
    if (sent) {
      res.json({ success: true, message: 'Daily brief sent to ' + email });
    } else {
      res.json({ success: false, message: 'Could not send daily brief' });
    }
  } catch (error) {
    console.error('send-test-brief error:', error.message);
    res.status(500).json({ error: 'An unexpected error occurred' });
  }
});

// --- Earnings Report "Send Now" ---
app.post('/api/user/send-test-earnings', async (req, res) => {
  try {
    let { userId, email, fullName } = req.body;
    if (userId) {
      const result = await pool.query('SELECT id, full_name, email FROM users WHERE id = $1', [userId]);
      if (result.rows.length === 0) return res.status(404).json({ error: 'User not found' });
      email = result.rows[0].email;
      fullName = result.rows[0].full_name;
    }
    if (!email) return res.status(400).json({ error: 'email or userId required' });
    const sent = await sendEarningsReportToUser(userId ? parseInt(userId) : null, email, fullName);
    if (sent) {
      res.json({ success: true, message: 'Earnings report sent to ' + email });
    } else {
      res.json({ success: false, message: 'Could not send earnings report' });
    }
  } catch (error) {
    console.error('send-test-earnings error:', error.message);
    res.status(500).json({ error: 'An unexpected error occurred' });
  }
});

// --- Test Receipt Email ---
app.post('/api/test/send-receipt', async (req, res) => {
  try {
    const { email, userName, paymentMethod = 'M-Pesa' } = req.body;
    if (!email) return res.status(400).json({ error: 'email required' });
    const method = paymentMethod === 'PayPal' ? 'PayPal' : 'M-Pesa';
    const amount = method === 'PayPal' ? 29.00 : parseFloat((3770 / USD_TO_KES_RATE).toFixed(2));
    await sendPaymentReceiptEmail(email, {
      userName: userName || 'Test User',
      planName: 'Pro',
      amount,
      currency: 'USD',
      period: 'yearly',
      durationMonths: 12,
      paymentMethod: method,
      transactionRef: 'TEST-REF-' + Date.now(),
      paidAt: new Date(),
      startDate: new Date(),
      endDate: new Date(Date.now() + 365 * 24 * 60 * 60 * 1000),
    });
    res.json({ success: true, message: `Test receipt sent to ${email} (${method})` });
  } catch (error) {
    console.error('send-test-receipt error:', error.message);
    res.status(500).json({ error: 'An unexpected error occurred' });
  }
});

// --- Test Expiry Reminder Email ---
app.post('/api/test/send-expiry-reminder', async (req, res) => {
  try {
    const { email, userName, daysLeft, planName } = req.body;
    if (!email) return res.status(400).json({ error: 'email required' });
    await sendSubscriptionExpiryReminder(email, {
      userName: userName || 'Test User',
      planName: planName || 'Pro',
      daysLeft: daysLeft || 3,
      expiryDate: new Date(Date.now() + (daysLeft || 3) * 24 * 60 * 60 * 1000),
    });
    res.json({ success: true, message: `Test expiry reminder sent to ${email}` });
  } catch (error) {
    console.error('send-test-expiry-reminder error:', error.message);
    res.status(500).json({ error: 'An unexpected error occurred' });
  }
});

// --- Test Expired Email ---
app.post('/api/test/send-expired', async (req, res) => {
  try {
    const { email, userName, planName } = req.body;
    if (!email) return res.status(400).json({ error: 'email required' });
    await sendSubscriptionExpiredEmail(email, {
      userName: userName || 'Test User',
      planName: planName || 'Pro',
    });
    res.json({ success: true, message: `Test expired notice sent to ${email}` });
  } catch (error) {
    console.error('send-test-expired error:', error.message);
    res.status(500).json({ error: 'An unexpected error occurred' });
  }
});

// --- Test Expiry Email 1 (Soft Reminder) ---
app.post('/api/test/send-expiry-email1', async (req, res) => {
  try {
    const { email, userName } = req.body;
    if (!email) return res.status(400).json({ error: 'email required' });
    await sendSubscriptionExpiryEmail1(email, { userName: userName || 'Test User' });
    res.json({ success: true, message: `Test Expiry Email 1 (Soft Reminder) sent to ${email}` });
  } catch (error) {
    console.error('send-test-expiry-email1 error:', error.message);
    res.status(500).json({ error: 'An unexpected error occurred' });
  }
});

// --- Test Expiry Email 2 (Win-Back 40% Off) ---
app.post('/api/test/send-expiry-email2', async (req, res) => {
  try {
    const { email, userName } = req.body;
    if (!email) return res.status(400).json({ error: 'email required' });
    await sendSubscriptionExpiryEmail2(email, { userName: userName || 'Test User' });
    res.json({ success: true, message: `Test Expiry Email 2 (Win-Back 40% Off) sent to ${email}` });
  } catch (error) {
    console.error('send-test-expiry-email2 error:', error.message);
    res.status(500).json({ error: 'An unexpected error occurred' });
  }
});

// --- User Routes ---
app.get('/api/users/search', async (req, res) => {
  try {
    const query = req.query.q;
    const userId = req.query.userId;
    if (!query) return res.json([]);
    const result = await pool.query(
      `SELECT id, full_name, email, role FROM users
       WHERE (full_name ILIKE $1 OR email ILIKE $1) AND id != $2
       LIMIT 20`,
      [`%${query}%`, userId]
    );
    res.json(result.rows);
  } catch (error) {
    res.status(500).json({ error: 'An unexpected error occurred' });
  }
});

app.get('/api/users/:userId/followers', async (req, res) => {
  try {
    const userId = req.params.userId;
    const result = await pool.query(
      `SELECT u.id, u.full_name, u.email FROM followers f JOIN users u ON u.id = f.follower_id
       WHERE f.followee_id = $1`, [userId]
    );
    res.json(result.rows);
  } catch (error) {
    res.status(500).json({ error: 'An unexpected error occurred' });
  }
});

app.get('/api/users/:userId/following', async (req, res) => {
  try {
    const userId = req.params.userId;
    const result = await pool.query(
      `SELECT u.id, u.full_name, u.email FROM followers f JOIN users u ON u.id = f.followee_id
       WHERE f.follower_id = $1`, [userId]
    );
    res.json(result.rows);
  } catch (error) {
    res.status(500).json({ error: 'An unexpected error occurred' });
  }
});

app.post('/api/users/follow', async (req, res) => {
  try {
    const { follower_id, followee_id } = req.body;
    await pool.query(
      'INSERT INTO followers (follower_id, followee_id) VALUES ($1, $2) ON CONFLICT DO NOTHING',
      [follower_id, followee_id]
    );
    res.status(201).json({ success: true });
  } catch (error) {
    res.status(500).json({ error: 'An unexpected error occurred' });
  }
});

app.delete('/api/users/unfollow', async (req, res) => {
  try {
    const { follower_id, followee_id } = req.body;
    await pool.query(
      'DELETE FROM followers WHERE follower_id = $1 AND followee_id = $2',
      [follower_id, followee_id]
    );
    res.json({ success: true });
  } catch (error) {
    res.status(500).json({ error: 'An unexpected error occurred' });
  }
});

app.get('/api/users/:id', async (req, res) => {
  try {
    const { id } = req.params;
    const { rows } = await pool.query(
      'SELECT id, full_name, email, created_at, updated_at, visible_in_directory FROM users WHERE id = $1',
      [id]
    );
    if (rows.length === 0) return res.status(404).json({ error: 'User not found' });
    res.json(rows[0]);
  } catch (error) {
    console.error('Error fetching user:', error.message);
    res.status(500).json({ error: 'Failed to fetch user' });
  }
});

app.put('/api/users/:id', async (req, res) => {
  try {
    const { id } = req.params;
    const { full_name, email, trader_type, visible_in_directory } = req.body;
    const fields = []; const params = []; let idx = 1;
    if (full_name !== undefined) { fields.push(`full_name = $${idx++}`); params.push(full_name); }
    if (email !== undefined) { fields.push(`email = $${idx++}`); params.push(email); }
    if (trader_type !== undefined) { fields.push(`trader_type = $${idx++}`); params.push(trader_type); }
    if (visible_in_directory !== undefined) { fields.push(`visible_in_directory = $${idx++}`); params.push(visible_in_directory); }
    if (fields.length === 0) return res.status(400).json({ error: 'No fields to update' });
    params.push(id);
    const result = await pool.query(
      `UPDATE users SET ${fields.join(', ')}, updated_at = NOW() WHERE id = $${idx} RETURNING id, full_name, email, trader_type, visible_in_directory, created_at, updated_at`,
      params
    );
    if (result.rows.length === 0) return res.status(404).json({ error: 'User not found' });
    res.json(result.rows[0]);
  } catch (error) {
    console.error('Error updating user:', error.message);
    res.status(500).json({ error: 'Failed to update user' });
  }
});

// --- People / Community Directory ---
app.post('/api/people/:id/follow', async (req, res) => {
  try {
    const followerId = req.body.userId;
    const followeeId = req.params.id;
    if (!followerId) return res.status(400).json({ error: 'userId is required' });
    await pool.query(
      'INSERT INTO followers (follower_id, followee_id) VALUES ($1, $2) ON CONFLICT DO NOTHING',
      [followerId, followeeId]
    );
    res.json({ success: true });
  } catch (err) {
    console.error('Error following user:', err.message);
    res.status(500).json({ error: 'Failed to follow user' });
  }
});

app.post('/api/people/:id/unfollow', async (req, res) => {
  try {
    const followerId = req.body.userId;
    const followeeId = req.params.id;
    if (!followerId) return res.status(400).json({ error: 'userId is required' });
    await pool.query('DELETE FROM followers WHERE follower_id = $1 AND followee_id = $2', [followerId, followeeId]);
    res.json({ success: true });
  } catch (err) {
    console.error('Error unfollowing user:', err.message);
    res.status(500).json({ error: 'Failed to unfollow user' });
  }
});

app.get('/api/people', async (req, res) => {
  try {
    const result = await pool.query(
      `SELECT u.id, u.full_name, u.email, u.role, u.trader_type, u.is_verified,
              COALESCE(f.follower_count, 0) as followers
       FROM users u
       LEFT JOIN (SELECT followee_id, COUNT(*)::int as follower_count FROM followers GROUP BY followee_id) f ON f.followee_id = u.id
       WHERE u.visible_in_directory = true
       ORDER BY u.full_name`
    );
    const people = result.rows.map(u => ({
      ...u,
      online: onlineUsers.has(u.id),
      last_seen: lastSeen.has(u.id) ? lastSeen.get(u.id).toISOString() : null,
    }));
    res.json(people);
  } catch (err) {
    console.error('Error fetching people:', err.message);
    try {
      const result = await pool.query(
        'SELECT id, full_name, email, role, trader_type, is_verified FROM users WHERE visible_in_directory = true ORDER BY full_name'
      );
      const people = result.rows.map(u => ({
        ...u,
        online: onlineUsers.has(u.id),
        last_seen: lastSeen.has(u.id) ? lastSeen.get(u.id).toISOString() : null,
      }));
      res.json(people);
    } catch {
      res.json([]);
    }
  }
});

// --- All stocks list & search ---
// Returns quote for a single stock (used by StockAnalysisPage)
app.get('/api/stock/:symbol', async (req, res) => {
  try {
    const { symbol } = req.params;
    const { market } = req.query;
    const upper = symbol.toUpperCase();
    const lookup = market === 'nse' ? `NSE:${upper}` : upper;
    const quote = await getStockQuote(lookup);
    if (!quote) return res.status(404).json({ error: 'Stock not found' });
    res.json({
      symbol: quote.symbol || upper,
      company_name: quote.company_name || upper,
      price: quote.price || quote.close || 0,
      change: quote.change || 0,
      changePercent: quote.changePercent || quote.change_pct || 0,
      changesPercentage: quote.changesPercentage || quote.changePercent || 0,
      volume: quote.volume || 0,
      dayHigh: quote.dayHigh || quote.high || 0,
      dayLow: quote.dayLow || quote.low || 0,
      previousClose: quote.previousClose || quote.previous_close || 0,
      currency: quote.currency || (lookup.startsWith('NSE:') ? 'KES' : 'USD'),
      provider: quote.provider || 'synthetic',
      exchange: quote.exchange || (lookup.startsWith('NSE:') ? 'NSE' : 'Global'),
      timestamp: quote.timestamp ? (typeof quote.timestamp === 'number' ? quote.timestamp : Math.floor(new Date(quote.timestamp).getTime() / 1000)) : Math.floor(Date.now() / 1000),
      lastUpdated: quote.lastUpdated || new Date().toISOString(),
    });
  } catch (error) {
    console.error(`Error fetching stock ${req.params.symbol}:`, error.message);
    res.status(500).json({ error: 'Failed to fetch stock quote' });
  }
});

app.get('/api/stock/:symbol/history', async (req, res) => {
  try {
    const { symbol } = req.params;
    const { range, interval } = req.query;
    const upperSymbol = symbol.toUpperCase();

    // NSE historical OHLCV is not available from Yahoo/RapidAPI. Avoid showing wrong-ticker data.
    if (upperSymbol.startsWith('NSE:') || upperSymbol.endsWith('.NSE')) {
      return res.status(404).json({ error: 'NSE historical chart data is not available' });
    }

    const { fetchHistoricalQuotes } = require('./globalScraper');
    const bars = await Promise.race([
      fetchHistoricalQuotes(upperSymbol, range || '6mo', interval || '1d'),
      new Promise(resolve => setTimeout(() => resolve(null), 15000)),
    ]);
    if (!bars || bars.length === 0) {
      return res.status(404).json({ error: 'No historical data found' });
    }
    res.json({ symbol: upperSymbol, bars, count: bars.length });
  } catch (error) {
    console.error(`Error fetching history for ${req.params.symbol}:`, error.message);
    res.status(500).json({ error: 'Failed to fetch price history' });
  }
});

app.get('/api/stock/:symbol/holders', async (req, res) => {
  try {
    const symbol = req.params.symbol.toUpperCase().replace('NSE:', '');
    if (symbol.endsWith('.NR')) {
      return res.json({ holders: [], topHolders: [], source: 'unsupported' });
    }

    // Try FMP first (if API key is configured)
    const FMP_API_KEY = process.env.FMP_API_KEY || process.env.FINANCIALS_PROVIDER || '';
    if (FMP_API_KEY && FMP_API_KEY.length > 10) {
      try {
        const { fmp } = require('./apiClient');
        const [institutionalRes, etfRes] = await Promise.allSettled([
          fmp.get(`https://financialmodelingprep.com/stable/institutional-holders`, {
            params: { symbol, apikey: FMP_API_KEY },
          }),
          fmp.get(`https://financialmodelingprep.com/stable/etf-holders`, {
            params: { symbol, apikey: FMP_API_KEY },
          }),
        ]);
        const institutional = institutionalRes.status === 'fulfilled' && Array.isArray(institutionalRes.value.data)
          ? institutionalRes.value.data.slice(0, 15)
          : [];
        if (institutional.length > 0) {
          const topHolders = [...institutional]
            .sort((a, b) => (parseFloat(b.shares) || 0) - (parseFloat(a.shares) || 0))
            .slice(0, 10)
            .map(h => ({ holder: h.holder || '', shares: parseFloat(h.shares) || 0, pctHeld: h.pctHeld, dateOfReport: h.dateOfReport || h.reportDate, value: h.value }));
          return res.json({ holders: topHolders, topHolders, source: 'fmp' });
        }
      } catch (fmpErr) {
        console.error(`FMP holders error for ${symbol}: ${fmpErr.message}`);
      }
    }

    // Fallback: try finnhub ownership API
    try {
      const finnhubKey = process.env.FINNHUB_API_KEY || process.env.VITE_FINNHUB_KEY || '';
      if (finnhubKey) {
        const { finnhub } = require('./apiClient');
        const resp = await finnhub.get('https://finnhub.io/api/v1/stock/ownership', { params: { symbol, token: finnhubKey } });
        const data = resp.data;
        if (data && Array.isArray(data.ownership)) {
          const holders = data.ownership.slice(0, 10).map(h => ({
            holder: h.investor?.name || h.holder || h.name || '',
            shares: h.position || h.shares || 0,
            pctHeld: h.percentHolding != null ? parseFloat((h.percentHolding * 100).toFixed(1)) : null,
            dateOfReport: h.reportDate || null,
            value: h.marketValue || h.value || 0,
          })).filter(h => h.holder);
          if (holders.length > 0) return res.json({ holders, topHolders: holders, source: 'finnhub' });
        }
      }
    } catch (fhErr) {
      console.error(`Finnhub holders error for ${symbol}: ${fhErr.message}`);
    }

    // Fallback: yahoo-finance2 quoteSummary
    try {
      const { default: YahooFinance } = await import('yahoo-finance2');
      // Try alternate query host (query1 might work where query2 doesn't on Railway)
      const yf2 = new YahooFinance({ suppressNotices: ['yahooSurvey'], YF_QUERY_HOST: 'query1.finance.yahoo.com' });
      const summary = await yf2.quoteSummary(symbol, { modules: ['institutionOwnership', 'fundOwnership'] }, { validateResult: false });
      if (summary) {
        const rawNum = (v, def = 0) => { if (v == null) return def; if (typeof v === 'object') return v.raw != null ? v.raw : def; return v || def; };
        const fmtDate = (v) => { if (!v) return null; if (typeof v === 'object') return v.fmt || null; if (typeof v === 'number') return new Date(v * 1000).toISOString().slice(0, 10); return String(v).slice(0, 10); };
        const pct = (v) => { if (v == null) return null; const r = rawNum(v); return r != null ? parseFloat((r * 100).toFixed(1)) : null; };
        const holders = [];
        for (const item of (summary?.institutionOwnership?.ownershipList || [])) {
          const name = item.organization || '';
          if (!name) continue;
          holders.push({ holder: name, shares: rawNum(item.position), pctHeld: pct(item.pctHeld), dateOfReport: fmtDate(item.reportDate), value: rawNum(item.value) });
        }
        for (const item of (summary?.fundOwnership?.ownershipList || [])) {
          const name = item.organization || '';
          if (!name || holders.some(h => h.holder === name)) continue;
          holders.push({ holder: name, shares: rawNum(item.position), pctHeld: pct(item.pctHeld), dateOfReport: fmtDate(item.reportDate), value: rawNum(item.value) });
        }
        const topHolders = holders.sort((a, b) => (b.shares || 0) - (a.shares || 0)).slice(0, 10);
        if (topHolders.length > 0) return res.json({ holders: topHolders, topHolders, source: 'yahoo' });
      }
    } catch (yhErr) {
      console.error(`Yahoo holders error for ${symbol}: ${yhErr.message}`);
    }

    res.json({ holders: [], topHolders: [], source: 'unavailable' });
  } catch (error) {
    console.error(`Error fetching holders for ${req.params.symbol}: ${error.message}`);
    res.json({ holders: [], topHolders: [], source: 'error' });
  }
});

// Require auth for full stock signals, allow brief=true for public landing page
function requireAuthForFullStocks(req, res, next) {
  if (req.query.brief === 'true') return next();
  authenticateToken(req, res, next);
}

app.get('/api/stocks', requireAuthForFullStocks, async (req, res) => {
  try {
    const brief = req.query.brief === 'true';
    const now = Date.now();
    // For full response, use serialized string cache to avoid JSON.stringify overhead
    if (!brief && _stocksSerializedCache && (now - _stocksSerializedTime) < STOCKS_SERIALIZED_TTL) {
      return res.type('json').send(_stocksSerializedCache);
    }
    const allSignals = await generateSignals();
    if (brief) {
      // Trimmed response: only essential fields
      const trimmed = allSignals.map(s => ({
        ticker: s.ticker, name: s.name, price: s.price, change: s.change,
        signal: s.signal, confidence: s.confidence, market: s.market,
        sector: s.sector, currency: s.currency, volume: s.volume,
      }));
      return res.json(trimmed);
    }
    const serialized = JSON.stringify(allSignals);
    _stocksSerializedCache = serialized;
    _stocksSerializedTime = now;
    res.type('json').send(serialized);
  } catch (error) {
    console.error('Error fetching all stocks:', error);
    res.status(500).json({ error: 'Failed to fetch stocks list' });
  }
});

// Returns all stocks from the database (comprehensive list of NSE + Global)
app.get('/api/stocks/list', authenticateToken, async (req, res) => {
  try {
    const { market } = req.query;
    let query = 'SELECT ticker, name, sector, market, currency FROM stocks WHERE is_active = true';
    const params = [];
    if (market) {
      query += ' AND LOWER(market) = LOWER($1)';
      params.push(market);
    }
    query += ' ORDER BY ticker ASC';
    const result = await pool.query(query, params);
    res.json(result.rows);
  } catch (error) {
    // Log full error stack to aid debugging
    console.error('Error fetching stocks list:', error && error.stack ? error.stack : error);
    res.status(500).json({ error: 'Failed to fetch stocks list' });
  }
});

app.get('/api/stocks/search', async (req, res) => {
  try {
    const q = (req.query.q || '').trim();
    if (q.length < 1) return res.json([]);
    const pattern = `%${q}%`;
    const result = await pool.query(
      `SELECT ticker, name, sector, market FROM stocks
       WHERE is_active = true AND (ticker ILIKE $1 OR name ILIKE $2)
       ORDER BY
         CASE WHEN ticker ILIKE $3 THEN 0 ELSE 1 END,
         ticker ASC
       LIMIT 20`,
      [`${q}%`, pattern, `${q}%`]
    );
    res.json(result.rows);
  } catch (error) {
    console.error('Error searching stocks:', error.message);
    // Fallback to in-memory search
    try { res.json(searchStocks(q)); } catch { res.json([]); }
  }
});

app.get('/api/stocks/search/yahoo', async (req, res) => {
  try {
    const q = (req.query.q || '').trim();
    if (q.length < 1) return res.json([]);
    const https = require('https');
    const url = `https://query1.finance.yahoo.com/v1/finance/search?q=${encodeURIComponent(q)}&quotesCount=8&newsCount=0`;
    const data = await new Promise((resolve, reject) => {
      https.get(url, { headers: { 'User-Agent': 'Mozilla/5.0' } }, (resp) => {
        let body = '';
        resp.on('data', chunk => body += chunk);
        resp.on('end', () => resolve(body));
      }).on('error', reject);
    });
    const parsed = JSON.parse(data);
    const quotes = (parsed.quotes || [])
      .filter(r => r.quoteType === 'EQUITY' || r.quoteType === 'ETF')
      .map(r => ({
        symbol: r.symbol,
        name: r.shortname || r.longname || r.symbol,
        exchange: r.exchange,
        quoteType: r.quoteType,
      }));
    res.json(quotes);
  } catch (error) {
    console.error('Error searching Yahoo stocks:', error.message);
    res.json([]);
  }
});

// --- Stock Screener Routes ---
app.get('/api/screener/criteria', async (req, res) => {
  try {
    const signals = await generateSignals(null, true);
    const sectors = [...new Set(signals.map(s => s.sector).filter(Boolean))].sort();
    const markets = [...new Set(signals.map(s => s.market).filter(Boolean))].sort();
    const signalTypes = [...new Set(signals.map(s => s.signal).filter(Boolean))].sort();
    const tradeTypes = [...new Set(signals.map(s => s.type).filter(Boolean))].sort();
    const prices = signals.map(s => s.price).filter(p => typeof p === 'number');
    const scores = signals.map(s => s.analysis?.overall?.score).filter(s => typeof s === 'number');
    res.json({
      sectors, markets, signalTypes, tradeTypes,
      priceRange: { min: Math.min(...prices), max: Math.max(...prices) },
      scoreRange: { min: Math.min(...scores), max: Math.max(...scores) },
      totalStocks: signals.length,
    });
  } catch (error) {
    res.status(500).json({ error: 'An unexpected error occurred' });
  }
});

app.get('/api/screener', async (req, res) => {
  try {
    const signals = await generateSignals(null, true);
    let filtered = [...signals];

    // Filters
    const {
      search, market, sector, signal: signalFilter, type: tradeType,
      minPrice, maxPrice, minChange, maxChange, minVolume, minPE, maxPE,
      minDividend, maxDividend, minScore, maxScore,
      sortBy, sortDir, page, limit,
    } = req.query;

    if (search) {
      const q = search.toLowerCase();
      filtered = filtered.filter(s =>
        (s.ticker || '').toLowerCase().includes(q) ||
        (s.name || '').toLowerCase().includes(q) ||
        (s.sector || '').toLowerCase().includes(q)
      );
    }
    if (market) filtered = filtered.filter(s => s.market?.toLowerCase() === market.toLowerCase());
    if (sector) filtered = filtered.filter(s => s.sector === sector);
    if (signalFilter) filtered = filtered.filter(s => s.signal === signalFilter);
    if (tradeType) filtered = filtered.filter(s => s.type === tradeType);
    if (minPrice) filtered = filtered.filter(s => s.price >= parseFloat(minPrice));
    if (maxPrice) filtered = filtered.filter(s => s.price <= parseFloat(maxPrice));
    if (minChange) filtered = filtered.filter(s => s.change >= parseFloat(minChange));
    if (maxChange) filtered = filtered.filter(s => s.change <= parseFloat(maxChange));
    if (minVolume) filtered = filtered.filter(s => parseFloat(s.volume) >= parseFloat(minVolume));
    if (minPE) filtered = filtered.filter(s => {
      const metrics = s.analysis?.fundamental?.metrics;
      const pe = metrics ? parseFloat(metrics['P/E'] || metrics['PE']) : NaN;
      return !isNaN(pe) && pe >= parseFloat(minPE);
    });
    if (maxPE) filtered = filtered.filter(s => {
      const metrics = s.analysis?.fundamental?.metrics;
      const pe = metrics ? parseFloat(metrics['P/E'] || metrics['PE']) : NaN;
      return !isNaN(pe) && pe <= parseFloat(maxPE);
    });
    if (minDividend) filtered = filtered.filter(s => {
      const metrics = s.analysis?.fundamental?.metrics;
      const div = metrics ? parseFloat(metrics['Div Yield']) : NaN;
      return !isNaN(div) && div >= parseFloat(minDividend);
    });
    if (maxDividend) filtered = filtered.filter(s => {
      const metrics = s.analysis?.fundamental?.metrics;
      const div = metrics ? parseFloat(metrics['Div Yield']) : NaN;
      return !isNaN(div) && div <= parseFloat(maxDividend);
    });
    if (minScore) filtered = filtered.filter(s =>
      (s.analysis?.overall?.score || 0) >= parseFloat(minScore)
    );
    if (maxScore) filtered = filtered.filter(s =>
      (s.analysis?.overall?.score || 0) <= parseFloat(maxScore)
    );

    // Sort
    const validSorts = ['ticker', 'price', 'change', 'confidence', 'volume', 'score', 'sector'];
    const sb = validSorts.includes(sortBy) ? sortBy : 'confidence';
    const sd = sortDir === 'asc' ? 1 : -1;
    filtered.sort((a, b) => {
      let cmp = 0;
      if (sb === 'ticker') cmp = (a.ticker || '').localeCompare(b.ticker || '');
      else if (sb === 'price') cmp = (a.price || 0) - (b.price || 0);
      else if (sb === 'change') cmp = (a.change || 0) - (b.change || 0);
      else if (sb === 'confidence') cmp = (a.confidence || 0) - (b.confidence || 0);
      else if (sb === 'volume') cmp = parseFloat(a.volume || '0') - parseFloat(b.volume || '0');
      else if (sb === 'score') cmp = (a.analysis?.overall?.score || 0) - (b.analysis?.overall?.score || 0);
      else if (sb === 'sector') cmp = (a.sector || '').localeCompare(b.sector || '');
      return cmp * sd;
    });

    // Paginate
    const pg = parseInt(page) || 1;
    const lim = Math.min(parseInt(limit) || 50, 200);
    const total = filtered.length;
    const totalPages = Math.ceil(total / lim);
    const start = (pg - 1) * lim;
    const stocks = filtered.slice(start, start + lim).map(s => ({
      ticker: s.ticker,
      name: s.name,
      price: s.price,
      change: s.change,
      market: s.market,
      currency: s.currency,
      signal: s.signal,
      type: s.type,
      confidence: s.confidence,
      sector: s.sector,
      volume: s.volume,
      score: s.analysis?.overall?.score || 0,
      grade: s.analysis?.overall?.grade || 'N/A',
      fundamentalScore: s.analysis?.fundamental?.score || 0,
      technicalScore: s.analysis?.technical?.score || 0,
      financialScore: s.analysis?.financial?.score || 0,
      macroScore: s.analysis?.macro?.score || 0,
    }));

    res.json({ total, page: pg, limit: lim, totalPages, stocks });
  } catch (error) {
    console.error('Error in screener:', error.message);
    res.status(500).json({ error: 'Failed to screen stocks' });
  }
});

app.get('/api/analysts', async (req, res) => {
  try {
    const { fetchAnalystData } = require('./analystService');
    const data = await fetchAnalystData();
    res.json(data);
  } catch (error) {
    console.error('Error in analysts:', error.message);
    res.status(500).json({ error: 'Failed to fetch analyst data' });
  }
});

app.get('/api/top-stocks', async (req, res) => {
  try {
    const signals = await generateSignals();
    const { getFundamentals } = require('./signalService');
    let category = req.query.category || 'gainers';
    let market = req.query.market || 'all';
    let search = (req.query.search || '').toLowerCase();
    let limit = parseInt(req.query.limit, 10) || 50;
    let filtered = [...signals];
    if (market === 'nse') filtered = filtered.filter(s => s.market === 'NSE');
    else if (market === 'global') filtered = filtered.filter(s => s.market === 'Global');
    if (search) filtered = filtered.filter(s => s.ticker.toLowerCase().includes(search) || s.name.toLowerCase().includes(search));
    filtered = filtered.map(s => {
      const fund = getFundamentals(s.ticker);
      return { ...s, marketCap: fund?.marketCap || 0, overallScore: s.analysis?.overall?.score || 0, fundamentalScore: s.analysis?.fundamental?.score || 0, technicalScore: s.analysis?.technical?.score || 0, financialScore: s.analysis?.financial?.score || 0 };
    });
    if (category === 'gainers') filtered.sort((a, b) => (b.change || 0) - (a.change || 0));
    else if (category === 'losers') filtered.sort((a, b) => (a.change || 0) - (b.change || 0));
    else if (category === 'volume' || category === 'active') { const pv = v => { if (!v) return 0; const n = parseFloat(v); if (typeof v === 'string') { if (v.includes('B')) return n * 1e9; if (v.includes('M')) return n * 1e6; if (v.includes('K')) return n * 1e3; } return n || 0; }; filtered.sort((a, b) => pv(b.volume) - pv(a.volume)); }
    else if (category === 'rated') filtered.sort((a, b) => (b.overallScore || 0) - (a.overallScore || 0));
    else if (category === 'confident') filtered.sort((a, b) => (b.confidence || 0) - (a.confidence || 0));
    else if (category === 'mcap') filtered.sort((a, b) => (b.marketCap || 0) - (a.marketCap || 0));
    else if (category === 'value') filtered.sort((a, b) => (b.fundamentalScore || 0) - (a.fundamentalScore || 0));
    else if (category === 'growth') filtered.sort((a, b) => (b.financialScore || 0) - (a.financialScore || 0));
    res.json({ success: true, category, market, total: filtered.length, stocks: filtered.slice(0, limit) });
  } catch (error) {
    console.error('Error fetching top stocks:', error);
    res.status(500).json({ error: 'Failed to fetch top stocks' });
  }
});

app.get('/api/market/movers', async (req, res) => {
  try {
    const snapshot = await getMarketSnapshot();
    res.json({ nse: snapshot.nse.movers, global: snapshot.global.movers, combined: snapshot.movers, active: snapshot.active });
  } catch (error) {
    console.error('Error fetching movers:', error);
    res.status(500).json({ error: 'Failed to fetch top movers' });
  }
});

// Pre-market / after-hours data for global stocks via Yahoo chart API with includePreMarket=true
app.get('/api/market/premarket', async (req, res) => {
  try {
    const { symbols } = req.query;
    if (!symbols) return res.status(400).json({ error: 'symbols query param required (comma-separated)' });
    const list = symbols.split(',').map(s => s.trim()).filter(Boolean);
    const { fetchPreMarketBatch } = require('./yahooFinanceFinancialsScraper');
    const data = await fetchPreMarketBatch(list);
    res.json({ quotes: data });
  } catch (error) {
    console.error('Error fetching pre-market data:', error);
    res.status(500).json({ error: 'Failed to fetch pre-market data' });
  }
});

// Real-time total turnover by market (price * volume) — uses direct Yahoo chart API for global, BASE_QUOTES for NSE
let turnoverCache = { nse: 0, global: 0, nseVolume: 0, globalVolume: 0, nse: { turnover: 0, volume: 0, count: 0 }, global: { turnover: 0, volume: 0, count: 0 } };
let turnoverCacheTime = 0;
const TURNOVER_CACHE_TTL = 30000; // 30s

const NSE_TURNOVER_TICKERS = ['SCOM', 'EQTY', 'KCB', 'EABL', 'ABSA', 'SBIC', 'KLG', 'BAMB', 'UMEM', 'KPLC', 'NMG', 'TOTL', 'STAN', 'COOP', 'JUB', 'KNRE', 'LKL', 'CIC', 'HFCK', 'IMH', 'NCBA', 'BAT', 'BOC', 'CARB', 'SCBK', 'DTK', 'BKG', 'KUKZ', 'KAPC', 'WTK', 'SASN', 'KEGN', 'UMME', 'BRIT', 'LBTY', 'SLAM', 'CTUM', 'NSE', 'EVRD', 'FTGH', 'UNGA', 'ARM', 'PORT', 'CRWN', 'TPSE', 'SCAN', 'SGL', 'CGEN', 'AMAC', 'ALP', 'CABL', 'DCON', 'GLD', 'HBE', 'KPC', 'KURV', 'LAPR', 'SKL', 'SMWF', 'TCL'];
const GLOBAL_TURNOVER_TICKERS = ['AAPL', 'MSFT', 'NVDA', 'TSLA', 'AMZN', 'GOOGL', 'META', 'JPM', 'V', 'LLY', 'AVGO', 'WMT', 'XOM', 'UNH', 'PG', 'COST', 'KO', 'PEP', 'AMD', 'CRM', 'ADBE', 'PLTR', 'SNOW', 'UBER', 'ORCL', 'NFLX', 'DIS', 'BAC', 'INTC', 'CSCO', 'QCOM', 'TXN', 'IBM', 'GS', 'MS', 'GE', 'BA', 'CAT', 'MCD', 'NKE', 'SBUX', 'PYPL', 'GME', 'AMC'];

async function fetchYahooStockQuote(symbol) {
  try {
    const { data } = await axios.get(
      `https://query1.finance.yahoo.com/v8/finance/chart/${symbol}?range=1d&interval=1m`,
      { timeout: 5000, headers: { 'User-Agent': 'Mozilla/5.0' } }
    );
    const meta = data?.chart?.result?.[0]?.meta;
    const quotes = data?.chart?.result?.[0]?.indicators?.quote?.[0];
    if (!meta) return null;
    const closes = quotes?.close?.filter(c => c != null);
    const volumes = quotes?.volume?.filter(v => v != null);
    return {
      price: meta.regularMarketPrice || closes?.[closes.length - 1] || 0,
      volume: meta.regularMarketVolume || (volumes ? volumes.reduce((a, b) => a + b, 0) : 0),
    };
  } catch {
    return null;
  }
}

app.get('/api/market/turnover', async (req, res) => {
  const now = Date.now();
  if (turnoverCacheTime && now - turnoverCacheTime < TURNOVER_CACHE_TTL) {
    return res.json(turnoverCache);
  }
  try {
    // NSE: from AFX scraper (free, real-time, 60s cache)
    let nseTurnover = 0, nseVolume = 0;
    const { fetchNseQuotes, getQuoteForSymbol } = require('./nseAfxScraper');
    await fetchNseQuotes();
    for (const t of NSE_TURNOVER_TICKERS) {
      const q = getQuoteForSymbol('NSE:' + t);
      if (q) { nseTurnover += (q.price || 0) * (q.volume || 0); nseVolume += q.volume || 0; }
    }

    // Global: parallel Yahoo chart API calls
    const globalResults = await Promise.allSettled(
      GLOBAL_TURNOVER_TICKERS.map(s =>
        Promise.race([
          fetchYahooStockQuote(s),
          new Promise(resolve => setTimeout(() => resolve(null), 4000)),
        ])
      )
    );
    let globalTurnover = 0, globalVolume = 0;
    for (let i = 0; i < GLOBAL_TURNOVER_TICKERS.length; i++) {
      const r = globalResults[i];
      if (r.status === 'fulfilled' && r.value) {
        globalTurnover += (r.value.price || 0) * (r.value.volume || 0);
        globalVolume += r.value.volume || 0;
      }
    }

    turnoverCache = {
      nse: { turnover: nseTurnover, volume: nseVolume, count: NSE_TURNOVER_TICKERS.length },
      global: { turnover: globalTurnover, volume: globalVolume, count: GLOBAL_TURNOVER_TICKERS.length },
    };
    turnoverCacheTime = now;
    res.json(turnoverCache);
  } catch (error) {
    console.error('Error computing turnover:', error.message);
    if (turnoverCacheTime) return res.json(turnoverCache);
    res.json({ nse: { turnover: 0, volume: 0, count: 0 }, global: { turnover: 0, volume: 0, count: 0 } });
  }
});


app.get('/api/earnings/criteria', async (req, res) => {
  try {
    const { getEarningsCriteria } = require('./earningsService');
    const criteria = await getEarningsCriteria();
    res.json(criteria);
  } catch (error) {
    res.status(500).json({ error: 'An unexpected error occurred' });
  }
});

app.get('/api/earnings/upcoming', async (req, res) => {
  try {
    const { getUpcomingEarnings } = require('./earningsService');
    const result = await getUpcomingEarnings({
      market: req.query.market,
      sector: req.query.sector,
      search: req.query.search,
      fromDate: req.query.from,
      toDate: req.query.to,
      limit: parseInt(req.query.limit, 10) || 100,
      offset: parseInt(req.query.offset, 10) || 0,
    });
    res.json(result);
  } catch (error) {
    console.error('Error fetching earnings:', error.message);
    res.status(500).json({ error: 'Failed to fetch earnings data' });
  }
});

app.get('/api/market/indices', async (req, res) => {
  try {
    const [nse, global] = await Promise.all([
      indicesService.getNseIndices(),
      indicesService.getGlobalIndices(),
    ]);
    res.json([...nse, ...global]);
  } catch (error) {
    console.error('Error fetching indices:', error);
    res.status(500).json({ error: 'Failed to fetch market indices' });
  }
});

app.get('/api/market/premarket', async (req, res) => {
  try {
    const symbols = req.query.symbols ? req.query.symbols.split(',').map(s => s.trim()).filter(Boolean) : [];
    if (symbols.length === 0) return res.json({});
    const axios = require('axios');
    const results = {};
    await Promise.allSettled(symbols.map(async (sym) => {
      try {
        const cleanSym = sym.includes('.') ? sym : sym.replace('^', '%5E');
        const { data } = await axios.get(
          `https://query1.finance.yahoo.com/v8/finance/chart/${cleanSym}?interval=1d&range=1d&includePreMarket=true`,
          { timeout: 8000, headers: { 'User-Agent': 'Mozilla/5.0' } }
        );
        const meta = data?.chart?.result?.[0]?.meta;
        if (meta) {
          results[sym] = {
            preMarketPrice: meta.preMarketPrice ?? null,
            preMarketChange: meta.preMarketChange ?? null,
            preMarketChangePercent: meta.preMarketChangePercent ?? null,
            preMarketTime: meta.preMarketTime ?? null,
            postMarketPrice: meta.postMarketPrice ?? null,
            postMarketChange: meta.postMarketChange ?? null,
            postMarketChangePercent: meta.postMarketChangePercent ?? null,
            postMarketTime: meta.postMarketTime ?? null,
            regularMarketPrice: meta.regularMarketPrice ?? null,
            regularMarketPreviousClose: meta.chartPreviousClose ?? meta.previousClose ?? null,
            marketState: meta.marketState || 'CLOSED',
            currentTradingPeriod: data?.chart?.result?.[0]?.meta?.currentTradingPeriod || null,
            exchange: meta.exchangeName || '',
            currency: meta.currency || 'USD',
          };
        }
      } catch {}
    }));
    res.json(results);
  } catch (error) {
    console.error('Error fetching premarket:', error.message);
    res.status(500).json({ error: 'Failed to fetch premarket data' });
  }
});

app.get('/api/indices/nse', async (req, res) => {
  try {
    const indices = await indicesService.getNseIndices();
    res.json(indices);
  } catch (error) {
    console.error('Error fetching NSE indices:', error);
    res.status(500).json({ error: 'Failed to fetch NSE indices' });
  }
});

app.get('/api/indices/global', async (req, res) => {
  try {
    const indices = await indicesService.getGlobalIndices();
    res.json(indices);
  } catch (error) {
    console.error('Error fetching global indices:', error);
    res.status(500).json({ error: 'Failed to fetch global indices' });
  }
});

app.get('/api/indices/all', async (req, res) => {
  try {
    const indices = await indicesService.getAllIndices();
    res.json(indices);
  } catch (error) {
    console.error('Error fetching all indices:', error);
    res.status(500).json({ error: 'Failed to fetch all indices' });
  }
});

app.get('/api/market/sectors', async (req, res) => {
  try {
    const sectors = await indicesService.getSectorPerformance();
    res.json(sectors);
  } catch (error) {
    console.error('Error fetching sector performance:', error);
    const synthetic = indicesService.getSyntheticSectors();
    res.json(synthetic);
  }
});

// ── AI Real-Time Recommendations (behavior & performance based) ──
app.get('/api/ai/recommendations', async (req, res) => {
  try {
    const userId = parseInt(req.query.userId) || null;
    let userTickers = [];
    if (userId) {
      try { const { rows } = await pool.query('SELECT ticker FROM portfolio_holdings WHERE user_id = $1', [userId]); userTickers = rows.map(r => r.ticker); } catch {}
    }

    // Fetch live quotes for all tracked stocks
    let stocks = [];
    try { const { rows } = await pool.query('SELECT ticker, name, sector, market, currency FROM stocks WHERE is_active = true ORDER BY ticker'); stocks = rows; } catch {}
    if (stocks.length === 0) {
      // Fallback universe
      const fallback = [
        { ticker: 'SCOM', name: 'Safaricom PLC', sector: 'Telecommunications', market: 'NSE', currency: 'KES' },
        { ticker: 'EQTY', name: 'Equity Group Holdings PLC', sector: 'Banking', market: 'NSE', currency: 'KES' },
        { ticker: 'KCB', name: 'KCB Group PLC', sector: 'Banking', market: 'NSE', currency: 'KES' },
        { ticker: 'EABL', name: 'East African Breweries PLC', sector: 'Manufacturing', market: 'NSE', currency: 'KES' },
        { ticker: 'AAPL', name: 'Apple Inc.', sector: 'Technology', market: 'Global', currency: 'USD' },
        { ticker: 'MSFT', name: 'Microsoft Corporation', sector: 'Technology', market: 'Global', currency: 'USD' },
        { ticker: 'NVDA', name: 'NVIDIA Corporation', sector: 'Technology', market: 'Global', currency: 'USD' },
        { ticker: 'AMZN', name: 'Amazon.com Inc.', sector: 'Consumer Cyclical', market: 'Global', currency: 'USD' },
        { ticker: 'GOOGL', name: 'Alphabet Inc.', sector: 'Technology', market: 'Global', currency: 'USD' },
        { ticker: 'TSLA', name: 'Tesla Inc.', sector: 'Automobiles', market: 'Global', currency: 'USD' },
        { ticker: 'META', name: 'Meta Platforms Inc.', sector: 'Technology', market: 'Global', currency: 'USD' },
        { ticker: 'JPM', name: 'JPMorgan Chase & Co.', sector: 'Financial', market: 'Global', currency: 'USD' },
        { ticker: 'V', name: 'Visa Inc.', sector: 'Financial', market: 'Global', currency: 'USD' },
        { ticker: 'NFLX', name: 'Netflix Inc.', sector: 'Technology', market: 'Global', currency: 'USD' },
        { ticker: 'COOP', name: 'Co-operative Bank of Kenya Ltd', sector: 'Banking', market: 'NSE', currency: 'KES' },
        { ticker: 'ABSA', name: 'Absa Bank Kenya PLC', sector: 'Banking', market: 'NSE', currency: 'KES' },
      ];
      stocks = fallback;
    }

    // Constrain to a performance-responsive subset for speed (top ~120 stocks)
    const targetStocks = stocks.length > 120 ? stocks.sort(() => Math.random() - 0.5).slice(0, 120) : stocks;

    // Build symbol list for batch quotes
    const symbols = targetStocks.map(s => s.market === 'NSE' ? 'NSE:' + s.ticker : s.ticker);

    // Fetch batch quotes
    let quotesMap = {};
    try { quotesMap = await getQuotesBatch(symbols); } catch {}
    if (Object.keys(quotesMap).length === 0) {
      // Try individual fallback for each symbol
      for (const sym of symbols) {
        try { const q = await getLivePrice(sym.includes(':') ? 'NSE' : 'Global', sym.replace('NSE:', '')); if (q) quotesMap[sym] = { price: q, change: 0, changePercent: 0, volume: 0, dayHigh: q, dayLow: q }; } catch {}
      }
    }

    // Score each stock based on real-time behavior
    const recommendations = targetStocks.map(stock => {
      const sym = stock.market === 'NSE' ? 'NSE:' + stock.ticker : stock.ticker;
      const quote = quotesMap[sym];
      const price = quote?.price || 0;
      const change = quote?.change || 0;
      const changePct = quote?.changePercent || 0;
      const volume = quote?.volume || 0;
      const dayHigh = quote?.dayHigh || price;
      const dayLow = quote?.dayLow || price;
      const prevClose = quote?.previousClose || price;

      // --- Momentum Score (0-40) ---
      // Price change percentage drives momentum
      let momentumScore = 20; // neutral
      if (changePct > 0) momentumScore = Math.min(40, 20 + changePct * 4);
      else if (changePct < 0) momentumScore = Math.max(0, 20 + changePct * 4);

      // --- Volatility Score (0-20) ---
      // High day range = high volatility, can be opportunity or risk
      const dayRange = price > 0 ? ((dayHigh - dayLow) / price) : 0;
      let volScore = 10;
      if (dayRange > 0.03) volScore = Math.min(20, 10 + dayRange * 100);
      else if (dayRange < 0.01) volScore = 5;

      // --- Volume Score (0-20) ---
      // Higher volume = more liquidity, more investor interest
      const avgVol = 1000000; // rough average
      let volScore2 = 10;
      if (volume > avgVol * 2) volScore2 = Math.min(20, 10 + (volume / avgVol) * 2);
      else if (volume > avgVol) volScore2 = 15;
      else if (volume < avgVol * 0.1) volScore2 = 5;

      // --- Trend Score (0-20) ---
      // Price position within day range indicates trend direction
      let trendScore = 10;
      if (price > dayLow && dayHigh > dayLow) {
        const rangePos = (price - dayLow) / (dayHigh - dayLow);
        if (rangePos > 0.7) trendScore = 18; // near high = bullish
        else if (rangePos > 0.5) trendScore = 14;
        else if (rangePos < 0.3) trendScore = 6; // near low = bearish
        else if (rangePos < 0.15) trendScore = 3;
      }

      // --- Momentum persistence (extra bonus) ---
      // Consecutive positive days = stronger signal
      let persistenceBonus = 0;
      if (changePct > 1.5) persistenceBonus = 5;
      else if (changePct > 0.5) persistenceBonus = 3;
      else if (changePct < -1.5) persistenceBonus = -5;
      else if (changePct < -0.5) persistenceBonus = -3;

      const totalScore = Math.round(Math.max(0, Math.min(100, momentumScore + volScore + volScore2 + trendScore + persistenceBonus)));

      // Map score to signal
      let signal, confidence;
      if (totalScore >= 75) { signal = 'Strong Buy'; confidence = `${70 + Math.floor(Math.random() * 20)}%`; }
      else if (totalScore >= 60) { signal = 'Buy'; confidence = `${60 + Math.floor(Math.random() * 15)}%`; }
      else if (totalScore >= 40) { signal = 'Hold'; confidence = `${50 + Math.floor(Math.random() * 10)}%`; }
      else if (totalScore >= 25) { signal = 'Sell'; confidence = `${55 + Math.floor(Math.random() * 10)}%`; }
      else { signal = 'Strong Sell'; confidence = `${60 + Math.floor(Math.random() * 15)}%`; }

      // Build behavior-driven reason
      const reasons = [];
      if (changePct > 2) reasons.push(`Strong upward momentum (+${changePct.toFixed(1)}%)`);
      else if (changePct > 0.5) reasons.push(`Positive price action (+${changePct.toFixed(1)}%)`);
      else if (changePct < -2) reasons.push(`Significant decline (${changePct.toFixed(1)}%)`);
      else if (changePct < -0.5) reasons.push(`Downward pressure (${changePct.toFixed(1)}%)`);
      if (dayRange > 0.04) reasons.push('High intraday volatility creating trading opportunities');
      if (volume > avgVol * 3) reasons.push('Unusually high volume indicating strong investor interest');
      if (volume > avgVol * 1.5) reasons.push('Above-average volume supporting price action');
      if (price >= dayHigh * 0.95) reasons.push('Trading near day high — bullish sentiment');
      if (price <= dayLow * 1.05) reasons.push('Trading near day low — bearish pressure');
      if (changePct > 0 && volume > avgVol) reasons.push('Rising on volume — strong accumulation');
      if (changePct < 0 && volume > avgVol) reasons.push('Declining on volume — distribution likely');
      if (reasons.length === 0) reasons.push('Stable price action with neutral momentum');

      const target1 = price > 0 ? (price * (1 + (totalScore >= 60 ? 0.12 : totalScore >= 40 ? 0.07 : -0.05))).toFixed(2) : '0.00';
      const target2 = price > 0 ? (price * (1 + (totalScore >= 60 ? 0.22 : totalScore >= 40 ? 0.14 : -0.10))).toFixed(2) : '0.00';
      const stopLoss = price > 0 ? (price * (1 - (totalScore >= 60 ? 0.06 : 0.08))).toFixed(2) : '0.00';

      return {
        id: `rec-${stock.ticker}-${Date.now()}`,
        symbol: stock.ticker,
        ticker: stock.ticker,
        name: stock.name || stock.ticker,
        price: price.toFixed(2),
        change: change.toFixed(2),
        changePercent: changePct.toFixed(1),
        market: stock.market || 'Global',
        currency: stock.currency || 'USD',
        signal,
        confidence,
        target1,
        target2,
        stopLoss,
        reason: reasons.join('. '),
        sector: stock.sector || 'Other',
        volume: volume >= 1000000 ? (volume / 1000000).toFixed(1) + 'M' : volume >= 1000 ? (volume / 1000).toFixed(1) + 'K' : String(volume),
        riskReward: price > 0 && parseFloat(stopLoss) > 0 ? ((price - parseFloat(stopLoss)) > 0 ? '2.5:1' : '1:1') : '1:1',
        timeframe: totalScore >= 60 ? 'Swing Trade' : 'Long Term',
        inPortfolio: userTickers.includes(stock.ticker),
        score: totalScore,
        scores: { momentum: momentumScore, volatility: volScore, volume: volScore2, trend: trendScore, persistence: persistenceBonus },
      };
    });

    // Sort by score descending
    recommendations.sort((a, b) => b.score - a.score);

    res.json({
      success: true,
      recommendations,
      total: recommendations.length,
      portfolioTickers: userTickers,
      timestamp: new Date().toISOString(),
      mode: Object.keys(quotesMap).length > 0 ? 'live' : 'fallback',
    });
  } catch (err) {
    console.error('Error generating recommendations:', err);
    res.status(500).json({ error: 'Failed to generate recommendations' });
  }
});

app.get('/api/ai/market-summary', async (req, res) => {
  try {
    const [signalsRes, moversRes] = await Promise.all([
      generateSignals().catch(() => []),
      axios.get('http://localhost:' + port + '/api/market/movers').then(r => r.data).catch(() => ({})),
    ]);
    const signals = Array.isArray(signalsRes) ? signalsRes : [];
    const strongBuys = signals.filter(s => s.signal === 'Strong Buy').length;
    const buys = signals.filter(s => s.signal === 'Strong Buy' || s.signal === 'Buy').length;
    const sells = signals.filter(s => s.signal === 'Sell' || s.signal === 'Strong Sell').length;
    const total = signals.length;
    const bullishPct = total > 0 ? Math.round((buys / total) * 100) : 50;
    let sentiment = 'Neutral';
    let confidence = '50';
    if (bullishPct >= 65) { sentiment = 'Bullish'; confidence = String(70 + Math.floor(Math.random() * 15)); }
    else if (bullishPct >= 50) { sentiment = 'Slightly Bullish'; confidence = String(55 + Math.floor(Math.random() * 10)); }
    else if (bullishPct <= 35) { sentiment = 'Bearish'; confidence = String(60 + Math.floor(Math.random() * 15)); }
    else { sentiment = 'Slightly Bearish'; confidence = String(50 + Math.floor(Math.random() * 10)); }
    const sectors = [...new Set(signals.map(s => s.sector).filter(Boolean))];
    const topSectors = sectors.slice(0, 3);
    const sectorSummary = topSectors.length > 0
      ? 'Leading sectors include ' + topSectors.join(', ') + '.'
      : 'Mixed activity across sectors.';
    const summary = 'Market analysis shows ' + bullishPct + '% buy-rated signals across ' + total + ' tracked stocks. ' +
      strongBuys + ' strong buy signals detected. ' + sectorSummary + ' ' +
      'Trading volume suggests ' + (bullishPct >= 60 ? 'increased institutional participation' : 'cautious positioning') + ' ' +
      'ahead of the close.' + (sells > 0 ? ' ' + sells + ' sell signals warrant attention on overextended positions.' : '');
    res.json({ summary, sentiment, confidence: confidence + '%', timestamp: new Date().toISOString(), signals: { total, strongBuys, buys, sells } });
  } catch (err) {
    console.error('Error generating AI market summary:', err.message);
    res.json({ summary: 'Markets are showing mixed signals with selective opportunities in blue-chip stocks. Monitor key resistance levels for breakout confirmation.', sentiment: 'Neutral', confidence: '65%', timestamp: new Date().toISOString() });
  }
});

// Pre-serialized JSON cache for the heavy /api/stocks endpoint
let _stocksSerializedCache = null;
let _stocksSerializedTime = 0;
const STOCKS_SERIALIZED_TTL = 30000; // 30 seconds

// ── AI Insights Chat ──
const STOCK_NAMES = {
  scom: 'SCOM', safaricom: 'SCOM', equity: 'EQTY', eqty: 'EQTY', kcb: 'KCB',
  'kenya commercial': 'KCB', 'co-op': 'COOP', coop: 'COOP', absa: 'ABSA',
  eabl: 'EABL', bat: 'BAT', bamburi: 'BAMB', bamb: 'BAMB', kplc: 'KPLC',
  nmg: 'NMG', totl: 'TOTL', jubilee: 'JUB', jub: 'JUB', 'kenya airways': 'KQ',
  saf: 'SCOM',
  apple: 'AAPL', microsoft: 'MSFT', nvidia: 'NVDA', tesla: 'TSLA',
  amazon: 'AMZN', amzn: 'AMZN', google: 'GOOGL', meta: 'META', netflix: 'NFLX',
  jpm: 'JPM', 'jp morgan': 'JPM', 'jpmorgan': 'JPM',
  visa: 'V', mastercard: 'MA', 'berkshire': 'BRK.B', 'brk.b': 'BRK.B',
  'johnson & johnson': 'JNJ', 'johnson and johnson': 'JNJ', jnj: 'JNJ',
  walmart: 'WMT', wmt: 'WMT', costco: 'COST', cost: 'COST',
  oracle: 'ORCL', orcl: 'ORCL', cisco: 'CSCO', csco: 'CSCO',
  sap: 'SAP', ibm: 'IBM', adobe: 'ADBE', adbe: 'ADBE', salesforce: 'CRM', crm: 'CRM',
  intel: 'INTC', intc: 'INTC', amd: 'AMD', qualcomm: 'QCOM', qcom: 'QCOM',
  broadcom: 'AVGO', avgo: 'AVGO', texas: 'TXN', txn: 'TXN',
  palantir: 'PLTR', pltr: 'PLTR', crowdstrike: 'CRWD', crwd: 'CRWD',
  'advanced micro': 'AMD',
  'united health': 'UNH', unh: 'UNH', eli: 'LLY', lly: 'LLY', pfizer: 'PFE', pfe: 'PFE',
  merck: 'MRK', mrk: 'MRK', moderna: 'MRNA', mrna: 'MRNA',
  boeing: 'BA', ba: 'BA', caterpillar: 'CAT', cat: 'CAT', honeywell: 'HON', hon: 'HON',
  disney: 'DIS', dis: 'DIS', 'walt disney': 'DIS',
  mcdonalds: 'MCD', mcd: 'MCD', 'starbucks': 'SBUX', sbux: 'SBUX',
  nike: 'NKE', nke: 'NKE', 'exxon': 'XOM', 'exxon mobil': 'XOM', xom: 'XOM',
  chevron: 'CVX', cvx: 'CVX', shell: 'SHEL', shel: 'SHEL',
  'bank of america': 'BAC', bac: 'BAC', 'goldman': 'GS', 'goldman sachs': 'GS',
  morgan: 'MS', 'morgan stanley': 'MS', wells: 'WFC', wfc: 'WFC',
  citigroup: 'C', citi: 'C', 'american express': 'AXP', axp: 'AXP',
  paypal: 'PYPL', pypl: 'PYPL', square: 'SQ', block: 'SQ',
  uber: 'UBER', coinbase: 'COIN', coin: 'COIN',
  nio: 'NIO', rivian: 'RIVN', rivn: 'RIVN', lucid: 'LCID', lcid: 'LCID',
  kukz: 'KUKZ', kakuzi: 'KUKZ', kapc: 'KAPC', kapchorua: 'KAPC',
  limt: 'LIMT', 'limuru tea': 'LIMT', wtk: 'WTK', 'williamson tea': 'WTK',
  sasn: 'SASN', sasini: 'SASN', rea: 'REA', 'rea vipingo': 'REA',
  egad: 'EGAD', eaagads: 'EGAD', cgen: 'CGEN', 'car & general': 'CGEN',
  ncba: 'NCBA', imh: 'IMH', 'i&m': 'IMH', dtk: 'DTK', 'diamond trust': 'DTK',
  scbk: 'SCBK', 'standard chartered': 'SCBK', bkg: 'BKG', 'bk group': 'BKG',
  hfck: 'HFCK', 'hf group': 'HFCK', sgl: 'SGL', 'standard group': 'SGL',
  tpse: 'TPSE', 'tps eastern africa': 'TPSE', scan: 'SCAN', scangroup: 'SCAN',
  kq: 'KQ', xprs: 'XPRS', 'express kenya': 'XPRS', smer: 'SMER', 'sameer africa': 'SMER',
  port: 'PORT', 'portland cement': 'PORT', crwn: 'CRWN', 'crown paints': 'CRWN',
  arm: 'ARM', 'arm cement': 'ARM', kegn: 'KEGN', kengen: 'KEGN',
  umme: 'UMME', umeme: 'UMME', knre: 'KNRE', 'kenya re': 'KNRE', cic: 'CIC',
  brit: 'BRIT', britam: 'BRIT', lbty: 'LBTY', 'liberty kenya': 'LBTY',
  slam: 'SLAM', sanlam: 'SLAM', ctum: 'CTUM', centum: 'CTUM',
  och: 'OCH', 'olympia capital': 'OCH', hafr: 'HAFR', 'home afrika': 'HAFR',
  nse: 'NSE', 'nairobi securities exchange': 'NSE', amac: 'AMAC', 'africa mega agricorp': 'AMAC',
  boc: 'BOC', 'b.o.c kenya': 'BOC', carb: 'CARB', carbacid: 'CARB',
  unga: 'UNGA', msc: 'MSC', 'mumias sugar': 'MSC', ftgh: 'FTGH', 'flame tree': 'FTGH',
  evrd: 'EVRD', eveready: 'EVRD', lkl: 'LKL', longhorn: 'LKL',
  nbv: 'NBV', 'nairobi business ventures': 'NBV', uchim: 'UCHM', uchumi: 'UCHM',
  alp: 'ALP', 'alp real estate': 'ALP', cabl: 'CABL', 'east african cables': 'CABL',
  dcon: 'DCON', 'deacons east africa': 'DCON', gld: 'GLD', 'newgold etf': 'GLD',
  hbe: 'HBE', homeboyz: 'HBE', kpc: 'KPC', 'kenya pipeline': 'KPC',
  kurv: 'KURV', kurwitu: 'KURV', lapr: 'LAPR', 'laptrust imara': 'LAPR',
  skl: 'SKL', 'shri krishana': 'SKL', smwf: 'SMWF', 'satrix msci world': 'SMWF',
  tcl: 'TCL', transcentury: 'TCL',
};
// Auto-map all known tickers so any symbol in the universe works directly
ALL_SYMBOLS.forEach(t => { const l = t.toLowerCase().replace('.', ''); if (!STOCK_NAMES[l]) STOCK_NAMES[l] = t; });

app.post('/api/ai/insights', async (req, res) => {
  try {
    const { question } = req.body;
    if (!question || !question.trim()) {
      return res.status(400).json({ error: 'Question is required' });
    }
    const q = question.toLowerCase().trim();
    let answer = '';

    // ── Helpers ──
    const esc = s => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const word = w => new RegExp('\\b' + esc(w.toLowerCase()) + '\\b');
    const anyWord = (...words) => words.some(w => word(w).test(q));

    // ── Comprehensive stock detection ──
    const foundSymbols = [];
    const seen = new Set();
    for (const [key, sym] of Object.entries(STOCK_NAMES)) {
      if ((word(key).test(q) || word(sym.toLowerCase()).test(q)) && !seen.has(sym)) {
        seen.add(sym);
        foundSymbols.push(sym);
      }
    }
    foundSymbols.sort((a, b) => {
      const ka = Object.keys(STOCK_NAMES).find(k => STOCK_NAMES[k] === a) || '';
      const kb = Object.keys(STOCK_NAMES).find(k => STOCK_NAMES[k] === b) || '';
      return kb.length - ka.length;
    });

    // ── Intent detection ──
    const isMomentum  = anyWord('momentum', 'hot', 'top', 'gainers', 'best', 'trending', 'rising', 'breakout', 'surge', 'movers');
    const isSector    = anyWord('sector', 'banking', 'telecom', 'technology', 'energy', 'insurance', 'industrial', 'healthcare', 'transportation', 'agricultural', 'construction', 'manufacturing');
    const isMarket    = anyWord('market', 'overview', 'summary', 'general', 'sentiment', 'outlook', 'broad');
    const isNse       = anyWord('nse', 'kenya', 'nairobi');
    const isCompare   = anyWord('compare', 'versus', 'vs', 'difference', 'better', 'which');
    const isNews      = anyWord('news', 'headlines', 'latest', 'happening', 'trending');
    const isBonds     = anyWord('bond', 'treasury', 'yield', 'fixed income');
    const isETFs      = anyWord('etf', 'exchange traded fund');
    const isFinancials = anyWord('fundamental', 'financial', 'earnings', 'revenue', 'profit', 'pe', 'ratio', 'balance sheet', 'cash flow', 'income');

    // ── Format helpers ──
    const fmt = (v, d = 'N/A') => (v !== null && v !== undefined && v !== 'N/A') ? v : d;
    const fmtPrice = (v, c) => typeof v === 'number' ? v.toFixed(2) : fmt(v);
    const fmtChange = (v) => {
      if (typeof v !== 'number') return fmt(v);
      return (v >= 0 ? '+' : '') + v.toFixed(2) + '%';
    };
    const fmtCurrency = (nse) => nse ? 'KES' : 'USD';

    // ── Handler: stock analysis (1-3 stocks) ──
    if (foundSymbols.length > 0 && foundSymbols.length <= 3) {
      const [allSignals, newsSummary, analystData, allIndices, sectorPerf] = await Promise.all([
        generateSignals().catch(() => null),
        getNewsSummary().catch(() => null),
        fetchAnalystData().catch(() => null),
        indicesService.getAllIndices().catch(() => null),
        indicesService.getSectorPerformance().catch(() => null),
      ]);
      const newsItems = newsSummary?.trending || [];
      const analystFirms = analystData?.firms || [];

      const results = await Promise.all(foundSymbols.map(async (symbol) => {
        const nse = !!KENYAN_STOCKS[symbol];
        const [signal, liveQuote, financialReport] = await Promise.all([
          getSignalForStock(symbol).catch(() => null),
          getStockQuote(nse ? `NSE:${symbol}` : symbol).catch(() => null),
          getFinancialReport(symbol).catch(() => null),
        ]);
        const fr = financialReport?.data;
        const stockNews = newsItems.filter(n => n.relatedStocks?.includes(symbol)).slice(0, 3);
        const firmPicks = analystFirms.filter(f => f.picks?.some(p => p.symbol === symbol)).slice(0, 3);
        return { symbol, nse, signal, liveQuote, fr, stockNews, firmPicks };
      }));

      if (results.length === 1) {
        const { symbol, nse, signal, liveQuote, fr, stockNews, firmPicks } = results[0];
        const profile = fr?.profile;
        const quote = fr?.quote;
        const price = liveQuote?.price || signal?.price || quote?.price || 'N/A';
        const change = liveQuote?.changePercent ?? signal?.change ?? quote?.changesPercentage ?? 0;
        const vol = liveQuote?.volume || signal?.volume || 'N/A';
        const curr = fmtCurrency(nse);
        const income = fr?.incomeStatement;
        const balance = fr?.balanceSheet;
        const cashflow = fr?.cashFlowStatement;
        const metrics = fr?.keyMetrics;
        const dividends = fr?.dividendHistory;

        answer = `**${signal?.name || profile?.companyName || symbol} (${symbol})**`;
        if (profile?.sector) answer += ` — ${profile.sector}`;
        if (profile?.industry) answer += ` | ${profile.industry}`;
        answer += '\n\n';

        answer += `**Current Price:** ${curr} ${fmtPrice(price)} (${fmtChange(change)})\n`;
        answer += `**Volume:** ${vol}\n`;

        if (profile) {
          answer += `**Market Cap:** ${profile.marketCap ? (curr === 'KES' ? 'KES ' : '$') + (profile.marketCap / 1e9).toFixed(1) + 'B' : 'N/A'}`;
          if (profile.ceo) answer += ` | **CEO:** ${profile.ceo}`;
          if (profile.employees) answer += ` | **Employees:** ${(profile.employees / 1000).toFixed(0)}K`;
          if (profile.website) answer += ` | [${profile.website}]`;
          answer += '\n';
        }

        if (signal) {
          answer += `\n**Signal:** ${signal.signal} (${signal.confidence}% confidence)\n`;
          answer += `**Entry Zone:** ${curr} ${fmtPrice(signal.entry)} | **Targets:** ${curr} ${fmtPrice(signal.target1)} / ${curr} ${fmtPrice(signal.target2)}\n`;
          answer += `**Stop Loss:** ${curr} ${fmtPrice(signal.stopLoss)}\n`;
          answer += `**Trade Type:** ${signal.type} | **Risk/Reward:** ${fmt(signal.riskReward)}\n`;
          if (signal.weeklyTrend) answer += `**Weekly Trend:** ${signal.weeklyTrend}`;
          if (signal.mlWinProb) answer += ` | **ML Win Prob:** ${signal.mlWinProb}`;
          answer += '\n';
        }

        // Key Financials from financial report (income statement + metrics)
        if (income || metrics || balance) {
          answer += `\n**📊 Financial Statements**\n`;

          // Income statement highlights
          if (income) {
            answer += `\n**Income Statement (${income.date || 'Latest'})**\n`;
            if (income.revenue != null) answer += `Revenue: $${(income.revenue / 1e9).toFixed(2)}B`;
            if (income.grossProfit != null) answer += ` | Gross Profit: $${(income.grossProfit / 1e9).toFixed(2)}B`;
            if (income.operatingIncome != null) answer += ` | Op Income: $${(income.operatingIncome / 1e9).toFixed(2)}B`;
            if (income.netIncome != null) answer += `\nNet Income: $${(income.netIncome / 1e9).toFixed(2)}B`;
            if (income.ebitda != null) answer += ` | EBITDA: $${(income.ebitda / 1e9).toFixed(2)}B`;
            if (income.eps != null) answer += ` | EPS: $${income.eps.toFixed(2)}`;
            if (income.revenue != null && income.netIncome != null) {
              answer += `\nMargin: ${(income.netIncome / income.revenue * 100).toFixed(1)}% net`;
            }
            answer += '\n';
          }

          // Balance sheet highlights
          if (balance) {
            answer += `\n**Balance Sheet (${balance.date || 'Latest'})**\n`;
            if (balance.cashAndCashEquivalents != null) answer += `Cash: $${(balance.cashAndCashEquivalents / 1e9).toFixed(2)}B`;
            if (balance.totalCurrentAssets != null) answer += ` | Current Assets: $${(balance.totalCurrentAssets / 1e9).toFixed(2)}B`;
            if (balance.totalAssets != null) answer += `\nTotal Assets: $${(balance.totalAssets / 1e9).toFixed(2)}B`;
            if (balance.totalLiabilities != null) answer += ` | Liabilities: $${(balance.totalLiabilities / 1e9).toFixed(2)}B`;
            if (balance.totalStockholdersEquity != null) answer += ` | Equity: $${(balance.totalStockholdersEquity / 1e9).toFixed(2)}B`;
            if (balance.totalDebt != null && balance.totalStockholdersEquity != null) {
              answer += `\nD/E: ${(balance.totalDebt / balance.totalStockholdersEquity).toFixed(2)}`;
            }
            answer += '\n';
          }

          // Cash flow highlights
          if (cashflow) {
            answer += `\n**Cash Flow (${cashflow.date || 'Latest'})**\n`;
            if (cashflow.operatingCashFlow != null) answer += `Op Cash Flow: $${(cashflow.operatingCashFlow / 1e9).toFixed(2)}B`;
            if (cashflow.freeCashFlow != null) answer += ` | Free Cash Flow: $${(cashflow.freeCashFlow / 1e9).toFixed(2)}B`;
            if (cashflow.capitalExpenditure != null) answer += `\nCapEx: $${(Math.abs(cashflow.capitalExpenditure) / 1e9).toFixed(2)}B`;
            if (cashflow.dividendsPaid != null) answer += ` | Dividends Paid: $${(Math.abs(cashflow.dividendsPaid) / 1e9).toFixed(2)}B`;
            answer += '\n';
          }

          // Key metrics
          if (metrics) {
            answer += `\n**Key Ratios**\n`;
            const parts = [];
            if (metrics.peRatio != null) parts.push(`P/E: ${metrics.peRatio.toFixed(1)}`);
            if (metrics.pbRatio != null) parts.push(`P/B: ${metrics.pbRatio.toFixed(1)}`);
            if (metrics.debtToEquity != null) parts.push(`D/E: ${metrics.debtToEquity.toFixed(1)}`);
            if (metrics.currentRatio != null) parts.push(`Current: ${metrics.currentRatio.toFixed(1)}`);
            if (metrics.dividendYieldPercentage != null) parts.push(`Div Yield: ${metrics.dividendYieldPercentage.toFixed(1)}%`);
            if (metrics.payoutRatio != null) parts.push(`Payout: ${(metrics.payoutRatio * 100).toFixed(0)}%`);
            if (metrics.freeCashFlowYield != null) parts.push(`FCF Yield: ${(metrics.freeCashFlowYield * 100).toFixed(1)}%`);
            if (metrics.revenuePerShare != null) parts.push(`Rev/Sh: $${metrics.revenuePerShare.toFixed(2)}`);
            if (metrics.netIncomePerShare != null) parts.push(`EPS: $${metrics.netIncomePerShare.toFixed(2)}`);
            answer += parts.join(' | ') + '\n';
          }

          // Dividend history
          if (dividends && dividends.length > 0) {
            const lastDiv = dividends[0];
            answer += `\n**Dividends** — Latest: $${lastDiv.dividend?.toFixed(2) || 'N/A'} per share`;
            if (lastDiv.paymentDate) answer += ` | Pay Date: ${lastDiv.paymentDate}`;
            if (dividends.length > 1) {
              const trailing = dividends.slice(0, 4);
              answer += `\nTrailing: ${trailing.map(d => '$' + (d.dividend?.toFixed(2) || '?')).join(' → ')}`;
            }
            answer += '\n';
          }

          if (!income && !balance && !cashflow) {
            answer += `\n_Detailed financial statements not available for this symbol._\n`;
          }
        }

        if (signal?.reason) {
          answer += `\n**Analysis:** ${signal.reason}\n`;
        }

        if (stockNews.length > 0) {
          answer += `\n**📰 Recent News**\n`;
          stockNews.forEach(n => {
            answer += `• ${n.headline} (_${n.source}_, ${n.timestamp})\n`;
          });
        }

        if (firmPicks.length > 0) {
          answer += `\n**🏦 Analyst Ratings**\n`;
          firmPicks.forEach(f => {
            const pick = f.picks.find(p => p.symbol === symbol);
            if (pick) answer += `• **${f.name}**: ${pick.rating}${pick.targetPrice ? `, PT $${pick.targetPrice}` : ''}\n`;
          });
        }

        if (!signal && !profile && !fr) {
          answer += `\nReal-time market data is available. Use the stock detail page for in-depth analysis.`;
        }

      } else {
        // Multi-stock comparison
        answer += `**📊 Multi-Stock Comparison**\n\n`;
        results.forEach(({ symbol, nse, signal, liveQuote, fr, stockNews, firmPicks }) => {
          const price = liveQuote?.price || signal?.price || fr?.quote?.price || 'N/A';
          const change = liveQuote?.changePercent ?? signal?.change ?? fr?.quote?.changesPercentage ?? 0;
          const curr = fmtCurrency(nse);
          const profile = fr?.profile;
          const metrics = fr?.keyMetrics;
          answer += `**${profile?.companyName || signal?.name || symbol} (${symbol})** — `;
          answer += `${curr} ${fmtPrice(price)} (${fmtChange(change)})`;
          if (signal) answer += ` → **${signal.signal}** (${signal.confidence}%)`;
          answer += '\n';
          if (profile?.sector) answer += `   Sector: ${profile.sector}`;
          if (signal?.type) answer += ` | Type: ${signal.type}`;
          if (liveQuote?.volume) answer += ` | Vol: ${(liveQuote.volume / 1e6).toFixed(1)}M`;
          if (metrics?.peRatio != null) answer += ` | P/E: ${metrics.peRatio.toFixed(1)}`;
          if (metrics?.dividendYieldPercentage != null) answer += ` | Div Yield: ${metrics.dividendYieldPercentage.toFixed(1)}%`;
          answer += '\n';
          if (stockNews.length > 0) {
            answer += `   📰 ${stockNews[0].headline}\n`;
          }
        });
        if (isCompare) {
          const best = results.reduce((a, b) =>
            ((a.signal?.confidence || 0) >= (b.signal?.confidence || 0)) ? a : b
          );
          answer += `\n_Recommendation: **${best.symbol}** has the strongest signal._`;
        }
      }

    // ── Handler: too many stocks matched ──
    } else if (foundSymbols.length > 3) {
      answer = `I found **${foundSymbols.length}** stocks: ${foundSymbols.join(', ')}.\nPlease ask about one or two at a time for detailed analysis.`;

    // ── Handler: market overview ──
    } else if (isMarket || (foundSymbols.length === 0 && !isMomentum && !isSector && !isNse && !isNews && !isBonds && !isETFs && !isFinancials)) {
      const [signals, indices, sectorPerf, turnoverRes, newsSum, analystData, bondSum, etfSum] = await Promise.all([
        generateSignals().catch(() => null),
        indicesService.getAllIndices().catch(() => null),
        indicesService.getSectorPerformance().catch(() => null),
        axios.get('http://localhost:' + port + '/api/market/turnover').then(r => r.data).catch(() => null),
        getNewsSummary().catch(() => null),
        fetchAnalystData().catch(() => null),
        getBondSummary().catch(() => null),
        getETFSummary().catch(() => null),
      ]);
      const total = signals?.length || 0;
      const buys = signals ? signals.filter(s => s.signal === 'Strong Buy' || s.signal === 'Buy').length : 0;
      const sectors = signals ? [...new Set(signals.map(s => s.sector).filter(Boolean))] : [];

      answer = `**📈 Market Overview**\n\n`;

      // Indices
      if (indices) {
        const nseIdx = Object.values(indices).filter(i => i.market === 'NSE').slice(0, 3);
        const globalIdx = Object.values(indices).filter(i => i.market === 'Global').slice(0, 4);
        answer += `**Global Indices**\n`;
        globalIdx.forEach(i => answer += `• ${i.name}: ${i.value} (${i.change})\n`);
        if (nseIdx.length > 0) {
          answer += `\n**NSE Indices**\n`;
          nseIdx.forEach(i => answer += `• ${i.name}: ${i.value} (${i.change})\n`);
        }
        answer += '\n';
      }

      // Signal overview
      if (signals) {
        answer += `**Signal Overview** — Tracking **${total}** stocks across **${sectors.length}** sectors\n`;
        answer += `**${buys}** (${Math.round(buys/total*100)}%) have buy ratings`;
        if (signals.filter(s => s.signal === 'Strong Sell' || s.signal === 'Sell').length > 0) {
          answer += ` | **${signals.filter(s => s.signal === 'Strong Sell' || s.signal === 'Sell').length}** sell ratings`;
        }
        answer += '\n\n';
      }

      // Turnover
      if (turnoverRes?.nse) {
        answer += `**NSE Turnover:** KES ${(turnoverRes.nse.turnover / 1e9).toFixed(1)}B | Volume: ${(turnoverRes.nse.volume / 1e6).toFixed(1)}M\n`;
      }
      if (turnoverRes?.global) {
        answer += `**Global Turnover:** $${(turnoverRes.global.turnover / 1e9).toFixed(1)}B | Volume: ${(turnoverRes.global.volume / 1e6).toFixed(1)}M\n`;
      }
      if (turnoverRes?.nse || turnoverRes?.global) answer += '\n';

      // Sector performance
      if (sectorPerf && sectorPerf.length > 0) {
        answer += `**🏭 Sector Performance**\n`;
        sectorPerf.slice(0, 6).forEach(s => {
          answer += `• ${s.sector}: ${s.change >= 0 ? '+' : ''}${typeof s.change === 'number' ? s.change.toFixed(1) : '0'}% (${s.upCount || 0}/${s.count || 0} up)\n`;
        });
        answer += '\n';
      }

      // Top momentum
      if (signals) {
        const top = signals.filter(s => s.signal === 'Strong Buy' || s.signal === 'Buy').sort((a, b) => b.confidence - a.confidence).slice(0, 3);
        if (top.length > 0) {
          answer += `**🔥 Top Picks**\n`;
          top.forEach((s, i) => {
            answer += `${i + 1}. **${s.ticker}** (${s.name}) — ${s.signal}, ${s.confidence}% confidence`;
            if (s.price) answer += ` at ${s.currency || 'USD'} ${s.price}`;
            answer += '\n';
          });
          answer += '\n';
        }
      }

      // Analyst consensus
      if (analystData?.firms) {
        const buyFirms = analystData.firms.filter(f => f.rating === 'Strong Buy' || f.rating === 'Buy');
        const totalFirms = analystData.firms.length;
        if (buyFirms.length > 0) {
          answer += `**🏦 Analyst Consensus:** ${buyFirms.length}/${totalFirms} firms bullish\n`;
        }
      }

      // Top news
      if (newsSum?.trending && newsSum.trending.length > 0) {
        answer += `\n**📰 Top Headlines**\n`;
        newsSum.trending.slice(0, 4).forEach(n => {
          answer += `• ${n.headline} (_${n.source}_, ${n.timestamp})\n`;
        });
      }

      if (bondSum) {
        answer += `\n**Bond Yields:** Kenya 10Y: ${bondSum.kenya10Y || 'N/A'}% | US 10Y: ${bondSum.us10Y || 'N/A'}%\n`;
      }

      answer += `\nOverall sentiment is **${buys/total > 0.5 ? 'Bullish 📈' : 'Cautious ⚖️'}** with ${buys/total > 0.5 ? 'broad-based buying interest' : 'selective opportunities in fundamentally strong stocks'}.`;

    // ── Handler: momentum stocks ──
    } else if (isMomentum) {
      const [signals, sectorPerf] = await Promise.all([
        generateSignals().catch(() => null),
        indicesService.getSectorPerformance().catch(() => null),
      ]);
      if (signals) {
        const top = signals.filter(s => s.signal === 'Strong Buy' || s.signal === 'Buy').sort((a, b) => b.confidence - a.confidence).slice(0, 5);
        if (top.length > 0) {
          answer = '**🔥 Top Momentum Stocks**\n\n';
          top.forEach((s, i) => {
            answer += `${i + 1}. **${s.ticker}** (${s.name})\n`;
            answer += `   ${s.signal} — ${s.confidence}% confidence`;
            if (s.price) answer += ` | Price: ${s.currency || 'KES'} ${typeof s.price === 'number' ? s.price.toFixed(2) : s.price}`;
            if (s.target1) answer += ` | Target: ${s.currency || 'KES'} ${typeof s.target1 === 'number' ? s.target1.toFixed(2) : s.target1}`;
            if (s.sector) answer += ` | Sector: ${s.sector}`;
            answer += '\n';
          });
          if (sectorPerf && sectorPerf.length > 0) {
            const topSector = sectorPerf.sort((a, b) => b.avgChange - a.avgChange)[0];
            answer += `\n_Leading sector: **${topSector.sector}** (${topSector.avgChange >= 0 ? '+' : ''}${topSector.avgChange.toFixed(1)}%)_`;
          }
        } else {
          answer = 'No strong momentum stocks detected. The market is showing cautious movement.';
        }
      } else {
        answer = 'Market data is being refreshed. Please try again shortly.';
      }

    // ── Handler: sector analysis ──
    } else if (isSector) {
      const [signals, sectorPerf] = await Promise.all([
        generateSignals().catch(() => null),
        indicesService.getSectorPerformance().catch(() => null),
      ]);
      if (signals) {
        const sectors = [...new Set(signals.map(s => s.sector).filter(Boolean))];
        answer = '**📊 Sector Analysis**\n\n';

        if (sectorPerf && sectorPerf.length > 0) {
          answer += `**Performance**\n`;
          sectorPerf.slice(0, 8).forEach(s => {
            answer += `• **${s.sector}:** ${s.avgChange >= 0 ? '+' : ''}${typeof s.avgChange === 'number' ? s.avgChange.toFixed(1) : '0'}%`;
            if (s.upCount != null) answer += ` (${s.upCount}/${s.count} up)`;
            answer += '\n';
          });
          answer += '\n';
        }

        answer += `**Signal Breakdown**\n`;
        sectors.forEach(sec => {
          const secSignals = signals.filter(s => s.sector === sec);
          const avgConf = Math.round(secSignals.reduce((a, s) => a + (parseInt(s.confidence) || 0), 0) / secSignals.length);
          const buys = secSignals.filter(s => s.signal === 'Strong Buy' || s.signal === 'Buy').length;
          const sells = secSignals.filter(s => s.signal === 'Strong Sell' || s.signal === 'Sell').length;
          answer += `• **${sec}:** ${buys}/${secSignals.length} buy, ${sells} sell — avg ${avgConf}% confidence\n`;
        });
      } else {
        answer = 'Sector data is being refreshed. Please try again shortly.';
      }

    // ── Handler: NSE focus ──
    } else if (isNse) {
      const [signals, indices, bondSum] = await Promise.all([
        generateSignals().catch(() => null),
        indicesService.getAllIndices().catch(() => null),
        getBondSummary().catch(() => null),
      ]);
      if (signals) {
        const nseSignals = signals.filter(s => s.market === 'NSE' || s.currency === 'KES');
        if (nseSignals.length > 0) {
          const buys = nseSignals.filter(s => s.signal === 'Strong Buy' || s.signal === 'Buy').length;
          const sectors = [...new Set(nseSignals.map(s => s.sector).filter(Boolean))];
          answer = `**🇰🇪 NSE Market Analysis**\n\n`;

          if (indices) {
            const nseIdx = Object.values(indices).filter(i => i.market === 'NSE');
            nseIdx.forEach(i => answer += `• **${i.name}:** ${i.value} (${i.change})\n`);
            answer += '\n';
          }

          answer += `Tracking **${nseSignals.length}** NSE stocks across **${sectors.length}** sectors.\n`;
          answer += `**${buys}** buy signals (${Math.round(buys/nseSignals.length*100)}% bullish).\n\n`;

          if (bondSum?.kenya10Y) {
            answer += `**Kenya 10Y Bond Yield:** ${bondSum.kenya10Y}%\n\n`;
          }

          answer += `**Sectors:** ${sectors.join(', ')}\n\n`;

          const topNse = nseSignals.filter(s => s.signal === 'Strong Buy' || s.signal === 'Buy').slice(0, 4);
          if (topNse.length > 0) {
            answer += '**Top Picks:**\n';
            topNse.forEach(s => {
              answer += `• **${s.ticker}** (${s.name}) — ${s.signal} at KES ${typeof s.price === 'number' ? s.price.toFixed(2) : s.price}`;
              if (s.target1) answer += ` → target KES ${typeof s.target1 === 'number' ? s.target1.toFixed(2) : s.target1}`;
              answer += '\n';
            });
          }
        } else {
          answer = 'NSE data is being refreshed. Please try again shortly.';
        }
      } else {
        answer = 'NSE data is being refreshed. Please try again shortly.';
      }

    // ── Handler: news / headlines ──
    } else if (isNews) {
      const newsSum = await getNewsSummary().catch(() => null);
      if (newsSum && newsSum.trending && newsSum.trending.length > 0) {
        answer = `**📰 Latest Market News**\n\n`;
        answer += `Found **${newsSum.total}** articles (${newsSum.nseCount} NSE, ${newsSum.globalCount} global)\n`;
        if (newsSum.hotCount > 0) answer += `**${newsSum.hotCount}** hot stories\n`;
        answer += '\n';
        newsSum.trending.slice(0, 8).forEach(n => {
          answer += `• **${n.headline}**\n`;
          answer += `  ${n.source} — ${n.timestamp}`;
          if (n.relatedStocks?.length > 0) answer += ` | Stocks: ${n.relatedStocks.join(', ')}`;
          if (n.sentiment) answer += ` | Sentiment: ${n.sentiment}`;
          answer += '\n';
        });
      } else {
        answer = 'News data is being refreshed. Please try again shortly.';
      }

    // ── Handler: bonds ──
    } else if (isBonds) {
      const [bondSum, bonds] = await Promise.all([
        getBondSummary().catch(() => null),
        getBonds('kenya').catch(() => null),
      ]);
      if (bondSum) {
        answer = `**📊 Bond Market**\n\n`;
        answer += `**Kenya 10-Year:** ${bondSum.kenya10Y || 'N/A'}% (${bondSum.kenya10YChange >= 0 ? '+' : ''}${bondSum.kenya10YChange?.toFixed(2) || '0'}%)\n`;
        answer += `**US 10-Year:** ${bondSum.us10Y || 'N/A'}% (${bondSum.us10YChange >= 0 ? '+' : ''}${bondSum.us10YChange?.toFixed(2) || '0'}%)\n`;
        answer += `**Kenya 91-Day T-Bill:** ${bondSum.kenyaTbill91D || 'N/A'}%\n\n`;
        if (bondSum.yieldCurve?.length > 0) {
          answer += `**Yield Curve**\n`;
          bondSum.yieldCurve.forEach(y => {
            answer += `• ${y.term}: Kenya ${y.kenya}% | US ${y.us}%\n`;
          });
        }
        if (bonds && bonds.length > 0) {
          answer += `\n**Available Bonds**\n`;
          bonds.slice(0, 6).forEach(b => {
            answer += `• **${b.name}** — Yield: ${b.ytm || b.coupon}% | Maturity: ${b.maturity || 'N/A'}\n`;
          });
        }
      } else {
        answer = 'Bond data is being refreshed. Please try again shortly.';
      }

    // ── Handler: ETFs (only if explicitly asked) ──
    } else if (isETFs) {
      const etfSum = await getETFSummary().catch(() => null);
      if (etfSum) {
        answer = `**📊 ETF Market**\n\n`;
        answer += `Tracking **${etfSum.totalETFs}** ETFs\n`;
        answer += `**${etfSum.advancing}** advancing, **${etfSum.declining}** declining\n`;
        if (etfSum.totalVolume) answer += `**Total Volume:** ${(etfSum.totalVolume / 1e6).toFixed(0)}M\n`;
        answer += '\n';
        if (etfSum.topGainers?.length > 0) {
          answer += `**Top Gainers**\n`;
          etfSum.topGainers.forEach(e => {
            answer += `• **${e.ticker}** — ${e.changePercent >= 0 ? '+' : ''}${e.changePercent?.toFixed(2)}% at $${e.price?.toFixed(2)}\n`;
          });
          answer += '\n';
        }
        if (etfSum.categories?.length > 0) {
          answer += `**Categories**\n`;
          etfSum.categories.forEach(c => answer += `• ${c.name}: ${c.count} ETFs\n`);
        }
      } else {
        answer = 'ETF data is being refreshed. Please try again shortly.';
      }

    // ── Fallback: help message ──
    } else {
      answer = '**🤖 AI Analyst**\n\nI can help you with:\n\n' +
        '• **Stock analysis** — "Analyze Safaricom" or "What about AAPL?"\n' +
        '• **Momentum stocks** — "Top momentum stocks right now"\n' +
        '• **Sector outlook** — "Banking sector performance"\n' +
        '• **Market overview** — "Give me a market summary"\n' +
        '• **NSE focus** — "NSE market analysis"\n' +
        '• **News** — "Latest market news"\n' +
        '• **Bonds** — "Bond market yields"\n' +
        '• **ETFs** — "ETF market overview"\n\n' +
        'What would you like to explore?';
    }
    res.json({ answer, timestamp: new Date().toISOString() });
  } catch (err) {
    console.error('Error generating AI insight:', err.message);
    res.json({ answer: 'I encountered an error processing your request. Please try again.', timestamp: new Date().toISOString() });
  }
});

// ── AI Portfolio Advice ──
app.post('/api/ai/portfolio-advice', async (req, res) => {
  try {
    const { holdings } = req.body;
    if (!holdings || !Array.isArray(holdings) || holdings.length === 0) {
      return res.status(400).json({ error: 'holdings array is required' });
    }

    // ── Fetch real-time market context ──
    const [indices, sectorPerf, news, fxRate] = await Promise.all([
      indicesService.getAllIndices().catch(() => ({})),
      indicesService.getSectorPerformance().catch(() => []),
      getAllNews().catch(() => []),
      fxService.getRate().catch(() => 130),
    ]);

    const indicesArr = Object.values(indices).filter(Boolean);
    const nseIndices = indicesArr.filter((i) => i.market === 'NSE');
    const globalIndices = indicesArr.filter((i) => i.market === 'Global');

    // Market direction: count advancing vs declining indices
    const nseAdvancers = nseIndices.filter((i) => i.isPositive).length;
    const globalAdvancers = globalIndices.filter((i) => i.isPositive).length;
    const nseDirection = nseIndices.length > 0 ? (nseAdvancers / nseIndices.length >= 0.5 ? 'bullish' : 'bearish') : 'neutral';
    const globalDirection = globalIndices.length > 0 ? (globalAdvancers / globalIndices.length >= 0.5 ? 'bullish' : 'bearish') : 'neutral';

    // Top/bottom sectors
    const topSectors = [...sectorPerf].sort((a, b) => b.avgChange - a.avgChange).slice(0, 3);
    const bottomSectors = [...sectorPerf].sort((a, b) => a.avgChange - b.avgChange).slice(0, 3);

    // News relevant to user's holdings
    const holdingTickers = new Set(holdings.map((h) => h.ticker.toUpperCase()));
    const relevantNews = news
      .filter((a) => holdingTickers.has((a.ticker || a.symbol || '').toUpperCase()))
      .slice(0, 5);

    // ── Compute portfolio metrics ──
    const signals = await generateSignals().catch(() => []);
    const signalMap = {};
    signals.forEach((s) => { signalMap[s.ticker] = s; });
    const sectors = {};
    let totalValue = 0;
    holdings.forEach((h) => {
      const val = (parseFloat(h.shares) || 0) * (parseFloat(h.currentPrice) || parseFloat(h.avgCost) || 0);
      totalValue += val;
      const sec = h.sector || 'Other';
      sectors[sec] = (sectors[sec] || 0) + val;
    });
    const sectorCount = Object.keys(sectors).length;
    let maxSectorPct = 0, maxSectorName = '';
    Object.entries(sectors).forEach(([name, v]) => {
      const pct = (v / totalValue) * 100;
      if (pct > maxSectorPct) { maxSectorPct = pct; maxSectorName = name; }
    });

    // ── Diversification score (market-aware) ──
    let divScore = 100, divMessage = 'Well diversified across sectors';
    if (sectorCount < 2) { divScore = 30; divMessage = 'Heavily concentrated — consider adding positions in other sectors to reduce risk'; }
    else if (maxSectorPct > 60) { divScore = 45; divMessage = `Overconcentrated in ${maxSectorName} (${Math.round(maxSectorPct)}%) — consider rebalancing`; }
    else if (sectorCount < 3) { divScore = 60; divMessage = 'Moderate diversification — adding 1-2 more sectors would reduce risk'; }

    // Market volatility adjustment to diversification
    const nseVolatility = nseIndices.reduce((max, i) => Math.max(max, Math.abs(parseFloat(i.changeRaw) || 0)), 0);
    if (nseVolatility > 2 && divScore > 50) {
      divScore -= 10;
      divMessage += '. High market volatility increases concentration risk.';
    }

    // ── Per-holding recommendations (market-aware) ──
    const recommendations = holdings.map((h) => {
      const isBroker = h.sector === 'Broker';
      const sig = isBroker ? null : signalMap[h.ticker];
      const currentPrice = parseFloat(h.currentPrice) || parseFloat(h.avgCost) || 0;
      const cost = parseFloat(h.avgCost) || 0;
      const shares = parseFloat(h.shares) || 0;
      const value = currentPrice * shares;
      const pnlPct = cost > 0 ? ((currentPrice - cost) / cost * 100) : 0;
      const valuePct = totalValue > 0 ? (value / totalValue * 100) : 0;
      let action = 'Hold', reason = 'In-line with portfolio targets';
      const sectorInfo = topSectors.find((s) => s.sector === h.sector) || bottomSectors.find((s) => s.sector === h.sector);

      if (isBroker) {
        reason = `Broker account — overall ${pnlPct >= 0 ? 'profit' : 'loss'} of ${Math.abs(pnlPct).toFixed(1)}%. ${nseDirection === 'bearish' ? 'Elevated market volatility may affect forex/CFD positions.' : 'Manage positions within the broker platform.'}`;
      } else {
        // Market-aware signals
        if (sig && (sig.signal === 'Strong Buy' || sig.signal === 'Buy')) {
          if (nseDirection === 'bearish' && h.market === 'NSE') {
            action = 'Hold';
            reason = `Despite ${sig.signal} rating (${sig.confidence}% confidence), NSE is in a bearish trend. Wait for market stabilization before accumulating.`;
          } else {
            action = 'Accumulate';
            reason = `${sig.signal} rating with ${sig.confidence}% confidence. ${sig.reason || 'Consider adding to position'}`;
          }
        } else if (sig && (sig.signal === 'Sell' || sig.signal === 'Strong Sell')) {
          if (nseDirection === 'bullish' && h.market === 'NSE') {
            action = 'Monitor';
            reason = `${sig.signal} rating, but NSE is trending up. Monitor closely and consider reducing only if the stock underperforms the market.`;
          } else {
            action = 'Reduce';
            reason = `${sig.signal} rating. ${sig.reason || 'Consider taking profits or cutting losses'}`;
          }
        }

        // Sector momentum override
        if (action === 'Hold' && sectorInfo) {
          const isTop = topSectors.includes(sectorInfo);
          if (isTop && parseFloat(pnlPct) < 0) {
            action = 'Accumulate';
            reason = `${sectorInfo.sector} sector is up ${sectorInfo.avgChange}% today. Your position is underwater — consider averaging down with sector momentum.`;
          } else if (!isTop && bottomSectors.includes(sectorInfo) && parseFloat(pnlPct) > 15) {
            action = 'Take Partial Profits';
            reason = `${sectorInfo.sector} sector is down ${Math.abs(sectorInfo.avgChange)}% today. Lock in gains before sector weakness spreads.`;
          }
        }

        // Position sizing
        if (action === 'Hold' && valuePct > 25) {
          action = 'Trim';
          reason = `Position is ${Math.round(valuePct)}% of portfolio — high concentration risk. Consider trimming to 15-20% target allocation.`;
        } else if (action === 'Hold' && valuePct < 3 && pnlPct >= 0 && nseDirection === 'bullish') {
          action = 'Accumulate';
          reason = `Small position (${Math.round(valuePct)}% of portfolio) with positive returns in a bullish market. Consider increasing allocation.`;
        }

        // Profit taking
        if (action === 'Hold' && pnlPct > 30) {
          action = 'Take Partial Profits';
          reason = `Position is up ${pnlPct.toFixed(1)}% — strong gains. Lock in some profits while letting the rest ride.`;
        }

        // Relevant news impact
        const tickerNews = relevantNews.filter((a) => (a.ticker || a.symbol || '').toUpperCase() === h.ticker.toUpperCase());
        if (tickerNews.length > 0 && action === 'Hold') {
          action = 'Monitor';
          reason = `${tickerNews[0].headline || tickerNews[0].title || ''} — keep an eye on this position.`;
        }

        // Bear market defense
        if (nseDirection === 'bearish' && h.market === 'NSE' && action === 'Hold' && parseFloat(pnlPct) < -15) {
          action = 'Reduce';
          reason = `NSE is bearish and this position is down ${pnlPct.toFixed(1)}%. Consider reducing exposure to preserve capital until market recovers.`;
        }
      }
      return { ticker: h.ticker, name: h.name || h.ticker, action, reason, pnlPct: `${pnlPct.toFixed(1)}%`, allocation: `${Math.round(valuePct)}%`, targetAllocation: valuePct > 25 ? '15-20%' : valuePct < 5 ? '5-15%' : 'Adequate' };
    });

    // ── Risk assessment (market-aware) ──
    const sellRecs = recommendations.filter((r) => r.action === 'Reduce' || r.action === 'Trim' || r.action === 'Take Partial Profits').length;
    const buyRecs = recommendations.filter((r) => r.action === 'Accumulate').length;
    let riskAssessment = 'Low — portfolio is well-positioned for current market conditions';
    if (nseDirection === 'bearish' || globalDirection === 'bearish') {
      riskAssessment = `Moderate-High — bearish market conditions. ${sellRecs} positions flagged for review. Consider defensive positioning.`;
    }
    if (sellRecs > holdings.length / 2) {
      riskAssessment = `High — ${sellRecs} of ${holdings.length} positions need action. Combine with ${nseDirection === 'bearish' ? 'broad market weakness' : 'mixed market signals'}.`;
    } else if (sellRecs > 0 && nseDirection === 'bullish') {
      riskAssessment = `Moderate — ${sellRecs} positions flagged, but overall market trend is positive. Focus on selective rebalancing.`;
    }

    // ── Build market context summary ──
    const marketContext = {
      indices: { nse: nseIndices.slice(0, 4), global: globalIndices.slice(0, 4) },
      direction: { nse: nseDirection, global: globalDirection },
      nseVolatility: nseVolatility > 1.5 ? 'High' : nseVolatility > 0.5 ? 'Moderate' : 'Low',
      topSectors: topSectors.map((s) => ({ name: s.sector, change: s.change, avgChange: s.avgChange })),
      bottomSectors: bottomSectors.map((s) => ({ name: s.sector, change: s.change, avgChange: s.avgChange })),
      relevantNews: relevantNews.map((a) => ({ headline: a.headline || a.title || '', source: a.source || '', date: a.date || a.publishedAt || '' })),
      fxRate,
    };

    res.json({
      success: true,
      advice: {
        summary: `Analyzed ${holdings.length} holdings across ${sectorCount} sectors. NSE: ${nseDirection.toUpperCase()} (${nseAdvancers}/${nseIndices.length} indices up). Global: ${globalDirection.toUpperCase()}. ${divMessage}. ${buyRecs} buy opportunities, ${sellRecs} positions needing review.`,
        recommendations,
        diversification: { score: divScore, message: divMessage },
        riskAssessment,
        marketContext,
      },
      timestamp: new Date().toISOString(),
    });
  } catch (err) {
    console.error('Error generating portfolio advice:', err.message);
    res.status(500).json({ error: 'Failed to generate portfolio advice' });
  }
});

// ── AI Portfolio Rebalance (by userId) ──
app.post('/api/ai/portfolio-rebalance', async (req, res) => {
  try {
    const { userId } = req.body;
    if (!userId) return res.status(400).json({ error: 'userId is required' });
    const [holdingsRes, connections] = await Promise.all([
      pool.query(`SELECT ticker, name, shares, avg_cost, current_price, sector, market FROM portfolio_holdings WHERE user_id = $1`, [userId]),
      brokerService.getConnections(userId).catch(() => []),
    ]);
    const stockHoldings = holdingsRes.rows.map(r => ({ ticker: r.ticker, name: r.name, shares: r.shares, avgCost: r.avg_cost, currentPrice: r.current_price, sector: r.sector, market: r.market }));
    const brokerVirtualHoldings = [];
    const seen = new Set();
    for (const c of connections) {
      const cfg = c.config || {};
      const seenKey = `${cfg.accountId || ''}|${cfg.server || ''}`;
      if (seenKey !== '|') {
        if (seen.has(seenKey)) continue;
        seen.add(seenKey);
      }
      const snap = c.latest_snapshot;
      const equity = parseFloat(snap?.equity ?? c.account_info?.equity);
      const balance = parseFloat(snap?.balance ?? c.account_info?.balance);
      if (!isNaN(equity) && equity > 0) {
        brokerVirtualHoldings.push({
          ticker: c.account_name || 'Broker Account',
          name: c.account_name || 'Broker Account',
          shares: 1,
          avgCost: balance || equity,
          currentPrice: equity,
          sector: 'Broker',
          market: 'Global',
        });
      }
    }
    const holdings = [...stockHoldings, ...brokerVirtualHoldings];
    if (holdings.length === 0) {
      return res.json({ success: true, advice: { summary: 'No holdings found. Start building your portfolio by adding positions.', recommendations: [], diversification: { score: 0, message: 'No positions yet' }, riskAssessment: 'None' }, timestamp: new Date().toISOString() });
    }
    const signals = await generateSignals().catch(() => []);
    const signalMap = {};
    signals.forEach(s => { signalMap[s.ticker] = s; });
    const sectors = {};
    let totalValue = 0;
    holdings.forEach(h => {
      const val = (parseFloat(h.shares) || 0) * (parseFloat(h.currentPrice) || parseFloat(h.avgCost) || 0);
      totalValue += val;
      sectors[h.sector || 'Other'] = (sectors[h.sector || 'Other'] || 0) + val;
    });
    const sectorCount = Object.keys(sectors).length;
    let maxSectorPct = 0;
    Object.values(sectors).forEach(v => { const pct = (v / totalValue) * 100; if (pct > maxSectorPct) maxSectorPct = pct; });
    let divScore = 100, divMessage = 'Well diversified';
    if (sectorCount < 2) { divScore = 30; divMessage = 'Heavily concentrated — consider adding positions in other sectors'; }
    else if (maxSectorPct > 60) { divScore = 50; divMessage = `Overconcentrated in one sector (${Math.round(maxSectorPct)}%) — consider rebalancing`; }
    else if (sectorCount < 3) { divScore = 65; divMessage = 'Moderate diversification — adding 1-2 more sectors would reduce risk'; }
    const recommendations = holdings.map(h => {
      const isBroker = h.sector === 'Broker';
      const sig = isBroker ? null : signalMap[h.ticker];
      const currentPrice = parseFloat(h.currentPrice) || parseFloat(h.avgCost) || 0;
      const cost = parseFloat(h.avgCost) || 0;
      const shares = parseFloat(h.shares) || 0;
      const value = currentPrice * shares;
      const pnlPct = cost > 0 ? ((currentPrice - cost) / cost * 100).toFixed(1) : '0.0';
      let action = 'Hold', reason = 'In-line with portfolio targets';
      if (isBroker) {
        reason = `Broker account — overall ${parseFloat(pnlPct) >= 0 ? 'profit' : 'loss'} of ${Math.abs(parseFloat(pnlPct)).toFixed(1)}%. Manage positions within the broker platform.`;
      } else if (sig) {
        if (sig.signal === 'Strong Buy' || sig.signal === 'Buy') { action = 'Accumulate'; reason = `${sig.signal} rating. ${sig.reason || ''}`; }
        else if (sig.signal === 'Sell' || sig.signal === 'Strong Sell') { action = 'Reduce'; reason = `${sig.signal} rating. ${sig.reason || 'Consider cutting losses'}`; }
      }
      const valuePct = totalValue > 0 ? (value / totalValue * 100) : 0;
      if (!isBroker && valuePct > 30) { action = 'Trim'; reason = `Position is ${Math.round(valuePct)}% of portfolio — consider trimming`; }
      if (!isBroker && parseFloat(pnlPct) > 25 && action === 'Hold') { action = 'Take Partial Profits'; reason = `Position is up ${pnlPct}% — consider taking some profits`; }
      return { ticker: h.ticker, name: h.name || h.ticker, action, reason, pnlPct: `${pnlPct}%`, allocation: `${Math.round(valuePct)}%`, targetAllocation: valuePct > 25 ? '15-25%' : valuePct < 5 ? '5-15%' : 'Adequate' };
    });
    const sellRecs = recommendations.filter(r => r.action === 'Reduce' || r.action === 'Trim' || r.action === 'Take Partial Profits').length;
    res.json({
      success: true,
      advice: {
        summary: `Analyzed ${holdings.length} holdings across ${sectorCount} sectors. ${divMessage}. ${sellRecs > 0 ? `${sellRecs} positions may need attention.` : 'Portfolio is well-positioned.'}`,
        recommendations,
        diversification: { score: divScore, message: divMessage },
        riskAssessment: sellRecs > holdings.length / 2 ? 'High' : sellRecs > 0 ? 'Moderate' : 'Low',
      },
      timestamp: new Date().toISOString(),
    });
  } catch (err) {
    console.error('Error generating portfolio rebalance:', err.message);
    res.status(500).json({ error: 'Failed to generate rebalancing advice' });
  }
});

app.get('/api/market/pulse', async (req, res) => {
  try {
    const [nseIndices, globalIndices, sectors] = await Promise.all([
      indicesService.getNseIndices().catch(() => []),
      indicesService.getGlobalIndices().catch(() => []),
      indicesService.getSectorPerformance().catch(() => indicesService.getSyntheticSectors()),
    ]);

    // Derive sentiment from index and sector movements (fast, no signal generation)
    function calcSentimentFromIndices(idxList, sectorList) {
      const idxPositive = idxList.filter(i => i.isPositive).length;
      const idxTotal = idxList.length || 1;
      const idxRatio = idxTotal > 0 ? (idxPositive / idxTotal) : 0.5;
      const secPositive = sectorList.filter(s => s.avgChange >= 0).length;
      const secTotal = sectorList.length || 1;
      const secRatio = secTotal > 0 ? (secPositive / secTotal) : 0.5;
      const combined = (idxRatio * 0.4 + secRatio * 0.6);
      const score = Math.round(combined * 100);
      let label = 'Neutral';
      if (score >= 65) label = 'Bullish';
      else if (score <= 40) label = 'Bearish';
      else if (score >= 55) label = 'Slightly Bullish';
      else label = 'Slightly Bearish';
      return { label, score, idxPositive, idxTotal };
    }

    const nseSentiment = calcSentimentFromIndices(nseIndices, sectors);
    const globalSentiment = calcSentimentFromIndices(globalIndices, sectors);

    const topSector = sectors.length > 0 ? sectors[0] : null;
    const nseIdx = nseIndices.find(i => i.name?.includes('20')) || nseIndices[0];
    const spIdx = globalIndices.find(i => i.name?.includes('S&P')) || globalIndices[0];

    const parts = [];
    if (nseIdx) parts.push(`NSE 20 at ${nseIdx.value} (${nseIdx.change})`);
    if (spIdx) parts.push(`S&P 500 at ${spIdx.value} (${spIdx.change})`);
    if (topSector) parts.push(`${topSector.sector} leading with ${topSector.change}%`);
    parts.push('Total tracked across NSE & Global markets');
    const summary = parts.join('. ') + '.';

    res.json({
      nse: nseSentiment,
      global: globalSentiment,
      summary,
      indices: { nse: nseIdx, sp500: spIdx },
      topSector: topSector ? { name: topSector.sector, change: topSector.change } : null,
      timestamp: new Date().toISOString(),
    });
  } catch (err) {
    console.error('Error fetching market pulse:', err.message);
    res.json({
      nse: { label: 'Neutral', score: 50, buys: 0, sells: 0, total: 0 },
      global: { label: 'Neutral', score: 50, buys: 0, sells: 0, total: 0 },
      summary: 'Mixed activity across markets.',
      timestamp: new Date().toISOString(),
    });
  }
});



app.get('/api/holdings', async (req, res) => {
  try {
    const userId = req.query.userId;
    if (!userId) return res.status(400).json({ error: 'userId is required' });
    const { rows } = await pool.query(
      `SELECT id, user_id, ticker, name, shares, avg_cost, current_price, sector, market, broker_connection_id, broker_profit, created_at, updated_at
       FROM portfolio_holdings WHERE user_id = $1 ORDER BY ticker`,
      [userId]
    );
    const fxRate = await getFxRate();
    let nseValue = 0, globalValue = 0;
    const enrichedRows = [];
    // Deduplicate: if broker-synced holding exists for a ticker, exclude manual one
    const brokerTickers = new Set(rows.filter(r => r.broker_connection_id > 0).map(r => r.ticker));
    const deduplicatedRows = rows.filter(r => r.broker_connection_id > 0 || !brokerTickers.has(r.ticker));

    // Fetch live prices in parallel for non-broker holdings
    const livePrices = await Promise.allSettled(deduplicatedRows.map(r =>
      r.broker_connection_id > 0
        ? Promise.resolve(parseFloat(r.current_price) || parseFloat(r.avg_cost) || 0)
        : getLivePrice(r.market, r.ticker)
    ));

    deduplicatedRows.forEach((r, i) => {
      const isBroker = r.broker_connection_id > 0;
      const lp = livePrices[i].status === 'fulfilled' ? livePrices[i].value : null;
      const livePrice = lp || parseFloat(r.current_price) || parseFloat(r.avg_cost) || 0;
      const avgC = parseFloat(r.avg_cost) || 0;
      const shares = parseFloat(r.shares) || 0;
      const val = livePrice * shares;
      const brokerPnl = parseFloat(r.broker_profit);
      const pnl = isBroker && !isNaN(brokerPnl) ? brokerPnl : (val - (avgC * shares));
      const pnlCost = isBroker && !isNaN(brokerPnl) && avgC > 0 && shares > 0
        ? (avgC * shares)
        : (avgC * shares);
      const pnlPct = (isBroker && !isNaN(brokerPnl) && pnlCost > 0)
        ? (brokerPnl / pnlCost * 100)
        : (avgC > 0 ? ((livePrice - avgC) / avgC * 100) : 0);
      if (r.market === 'NSE') nseValue += val;
      else globalValue += val;
      enrichedRows.push({
        ...r,
        current_price: String(livePrice.toFixed(2)),
        live_price: String(livePrice.toFixed(2)),
        value: String(val.toFixed(2)),
        pnl: String(pnl.toFixed(2)),
        pnl_percent: String(pnlPct.toFixed(1)),
        is_positive: pnl >= 0,
      });
    });
    const combinedValueKes = nseValue + globalValue * fxRate;
    res.json({ holdings: enrichedRows, fxRate, combinedValueKes: Math.round(combinedValueKes * 100) / 100 });
  } catch (err) {
    console.error('Error fetching holdings:', err.message);
    res.status(500).json({ error: 'Failed to fetch holdings' });
  }
});

app.post('/api/holdings', async (req, res) => {
  try {
    const { userId, ticker, name, shares, avgCost, sector, market } = req.body;
    if (!userId || !ticker || !shares || !avgCost) {
      return res.status(400).json({ error: 'userId, ticker, shares, and avgCost are required' });
    }
    const result = await pool.query(
      `INSERT INTO portfolio_holdings (user_id, ticker, name, shares, avg_cost, sector, market, broker_connection_id)
       VALUES ($1, $2, $3, $4, $5, $6, $7, 0)
       ON CONFLICT (user_id, ticker, broker_connection_id) DO UPDATE SET shares = $4, avg_cost = $5, name = $3, sector = $6, market = $7
       RETURNING *`,
      [userId, ticker.toUpperCase(), name || ticker.toUpperCase(), parseFloat(shares), parseFloat(avgCost), sector || 'Other', market || 'NSE']
    );
    snapshotPortfolioValue(userId).catch(() => {});
    res.status(201).json(result.rows[0]);
  } catch (error) {
    console.error('Error adding holding:', error.message);
    res.status(500).json({ error: 'An unexpected error occurred' });
  }
});

app.put('/api/holdings/:id', async (req, res) => {
  try {
    const { ticker, name, shares, avgCost, sector, market } = req.body;
    const result = await pool.query(
      `UPDATE portfolio_holdings SET ticker = $1, name = $2, shares = $3, avg_cost = $4, sector = $5, market = $6, updated_at = NOW()
       WHERE id = $7 AND broker_connection_id = 0 RETURNING *`,
      [ticker.toUpperCase(), name || ticker.toUpperCase(), parseFloat(shares), parseFloat(avgCost), sector || 'Other', market || 'NSE', req.params.id]
    );
    if (result.rows.length === 0) return res.status(404).json({ error: 'Holding not found or is broker-synced' });
    res.json(result.rows[0]);
  } catch (error) {
    console.error('Error updating holding:', error.message);
    res.status(500).json({ error: 'An unexpected error occurred' });
  }
});

app.delete('/api/holdings/:id', async (req, res) => {
  try {
    const result = await pool.query('DELETE FROM portfolio_holdings WHERE id = $1 RETURNING id', [req.params.id]);
    if (result.rows.length === 0) return res.status(404).json({ error: 'Holding not found' });
    res.json({ success: true });
  } catch (error) {
    console.error('Error deleting holding:', error.message);
    res.status(500).json({ error: 'An unexpected error occurred' });
  }
});

app.post('/api/holdings/bulk', async (req, res) => {
  try {
    const { userId, holdings } = req.body;
    if (!userId || !holdings || !Array.isArray(holdings) || holdings.length === 0) {
      return res.status(400).json({ error: 'userId and holdings array are required' });
    }
    const results = [];
    for (const h of holdings) {
      if (!h.ticker || !h.shares || !h.avgCost) continue;
      const result = await pool.query(
        `INSERT INTO portfolio_holdings (user_id, ticker, name, shares, avg_cost, sector, market, broker_connection_id)
         VALUES ($1, $2, $3, $4, $5, $6, $7, 0)
         ON CONFLICT (user_id, ticker, broker_connection_id) DO UPDATE SET shares = $4, avg_cost = $5, name = $3, sector = $6, market = $7
         RETURNING *`,
        [userId, h.ticker.toUpperCase(), h.name || h.ticker.toUpperCase(), parseFloat(h.shares), parseFloat(h.avgCost), h.sector || 'Other', h.market || 'NSE']
      );
      results.push(result.rows[0]);
    }
    snapshotPortfolioValue(userId).catch(() => {});
    res.status(201).json({ imported: results.length });
  } catch (error) {
    console.error('Error bulk importing holdings:', error.message);
    res.status(500).json({ error: 'An unexpected error occurred' });
  }
});

app.get('/api/notifications', async (req, res) => {
  try {
    const userId = req.query.userId;
    if (!userId) return res.status(400).json({ error: 'userId is required' });
    const result = await pool.query(
      `SELECT id, title, body, type, read, link, created_at
       FROM notifications WHERE user_id = $1
       ORDER BY created_at DESC LIMIT 50`,
      [userId]
    );
    const unread = result.rows.filter(n => !n.read).length;
    res.json({ notifications: result.rows, unread });
  } catch (err) {
    console.error('Error fetching notifications:', err.message);
    res.status(500).json({ error: 'Failed to fetch notifications' });
  }
});

app.post('/api/market/quotes', marketDataLimiter, async (req, res) => {
  try {
    const { symbols } = req.body;
    if (!symbols || !Array.isArray(symbols) || symbols.length === 0) {
      return res.status(400).json({ error: 'symbols array is required' });
    }
    const quotes = await getQuotesBatch(symbols);
    res.json({ quotes });
  } catch (error) {
    console.error('Error fetching batch quotes:', error);
    res.status(500).json({ error: 'Failed to fetch quotes' });
  }
});



app.get('/api/paper/account', async (req, res) => {
  try {
    const userId = req.query.userId;
    if (!userId) return res.status(400).json({ error: 'userId is required' });
    let { rows } = await pool.query('SELECT * FROM paper_accounts WHERE user_id = $1', [userId]);
    let account;
    if (rows.length === 0) {
      const init = await pool.query(
        `INSERT INTO paper_accounts (user_id, cash_balance, initial_capital, cash_balance_usd, initial_capital_usd)
         VALUES ($1, 1000000.00, 1000000.00, 10000.00, 10000.00) RETURNING *`,
        [userId]
      );
      account = init.rows[0];
    } else {
      account = rows[0];
    }
    const pos = await pool.query(
      'SELECT id, ticker, name, shares, avg_cost, market, sector FROM paper_positions WHERE user_id = $1 ORDER BY ticker',
      [userId]
    );
    const positions = pos.rows;
    const fxRate = await getFxRate();

    // Fetch live prices in parallel
    const livePrices = await Promise.all(positions.map(p =>
      getLivePrice(p.market, p.ticker).then(price => price || parseFloat(p.avg_cost))
    ));

    let nsePortfolioValue = parseFloat(account.cash_balance);
    let usdPortfolioValue = parseFloat(account.cash_balance_usd);
    const enrichedPositions = [];
    for (let i = 0; i < positions.length; i++) {
      const p = positions[i];
      const livePrice = livePrices[i];
      const val = livePrice * parseFloat(p.shares);
      const cost = parseFloat(p.avg_cost) * parseFloat(p.shares);
      const pnl = val - cost;
      const pnlPct = cost > 0 ? ((val - cost) / cost * 100) : 0;
      if (p.market === 'NSE') nsePortfolioValue += val;
      else usdPortfolioValue += val;
      enrichedPositions.push({
        id: p.id, ticker: p.ticker, name: p.name,
        shares: parseFloat(p.shares),
        avgCost: String(parseFloat(p.avg_cost).toFixed(4)),
        currentPrice: String(livePrice.toFixed(2)),
        value: String(val.toFixed(2)),
        pnl: String(pnl.toFixed(2)),
        pnlPercent: String(pnlPct.toFixed(1)),
        market: p.market, sector: p.sector,
      });
    }
    const combinedValue = nsePortfolioValue + usdPortfolioValue * fxRate;
    const initialCombined = parseFloat(account.initial_capital) + parseFloat(account.initial_capital_usd) * fxRate;
    const totalReturn = combinedValue - initialCombined;
    const totalReturnPct = initialCombined > 0 ? (totalReturn / initialCombined * 100) : 0;
    res.json({
      account: {
        cashBalance: parseFloat(account.cash_balance),
        cashBalanceUsd: parseFloat(account.cash_balance_usd),
        initialCapital: parseFloat(account.initial_capital),
        initialCapitalUsd: parseFloat(account.initial_capital_usd),
        totalFeesPaid: parseFloat(account.total_fees_paid || 0),
        totalFeesPaidUsd: parseFloat(account.total_fees_paid_usd || 0),
        cashBalanceKes: parseFloat(account.cash_balance),
        initialCapitalKes: parseFloat(account.initial_capital),
        totalFeesPaidKes: parseFloat(account.total_fees_paid || 0),
        nsePortfolioValue: Math.round(nsePortfolioValue * 100) / 100,
        usdPortfolioValue: Math.round(usdPortfolioValue * 100) / 100,
        combinedValue: Math.round(combinedValue * 100) / 100,
        portfolioValue: Math.round(combinedValue * 100) / 100,
        totalReturn: Math.round(totalReturn * 100) / 100,
        totalReturnPercent: Math.round(totalReturnPct * 100) / 100,
        fxRate,
      },
      positions: enrichedPositions,
      marketStatus: {
        nse: isMarketOpen('NSE'),
        global: isMarketOpen('Global'),
      },
    });
  } catch (err) {
    console.error('Error fetching paper account:', err.message);
    res.status(500).json({ error: 'Failed to fetch paper account' });
  }
});

function generateBenchmarkHistory(nseCurrent, spCurrent, days) {
  const points = Math.min(60, Math.max(10, Math.ceil(days / (days <= 30 ? 1 : days <= 90 ? 7 : 30))));
  const result = [];
  const nseDailyVol = 0.008;
  const spDailyVol = 0.01;
  const nseDrift = 0.0003;
  const spDrift = 0.0004;

  let nseVal = nseCurrent;
  let spVal = spCurrent;

  // Walk backwards from current to generate history, then reverse
  const backwards = [];
  for (let i = points - 1; i >= 0; i--) {
    backwards.push({ nse: nseVal, sp: spVal });
    const nseRet = -nseDrift + (Math.random() - 0.5) * nseDailyVol * 2;
    const spRet = -spDrift + (Math.random() - 0.5) * spDailyVol * 2;
    nseVal = nseVal / (1 + nseRet);
    spVal = spVal / (1 + spRet);
  }
  backwards.reverse();
  backwards.forEach(b => { result.push(b.nse); result.push(b.sp); });
  // Actually just return proper paired values
  const finalResult = [];
  for (const b of backwards) {
    finalResult.push({ nse: b.nse, sp: b.sp });
  }
  return finalResult;
}

function interpolateValue(snapshots, targetDate) {
  if (snapshots.length === 0) return null;
  const target = targetDate.getTime();
  let before = null, after = null;
  for (const s of snapshots) {
    const t = new Date(s.snapshot_date).getTime();
    if (t <= target) before = { val: parseFloat(s.total_value), time: t };
    if (t >= target && !after) after = { val: parseFloat(s.total_value), time: t };
  }
  if (!before && !after) return null;
  if (!before) return after.val;
  if (!after) return before.val;
  if (before.time === after.time) return before.val;
  const ratio = (target - before.time) / (after.time - before.time);
  return before.val + (after.val - before.val) * ratio;
}

function formatDateLabel(date, days) {
  const months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  if (days <= 30) return months[date.getMonth()] + ' ' + date.getDate();
  return months[date.getMonth()];
}

function normalizeTrade(t) {
  const price = parseFloat(t.price) || 0;
  const shares = parseFloat(t.shares) || 0;
  const commission = parseFloat(t.commission) || 0;
  const fees = parseFloat(t.fees) || 0;
  const totalValue = parseFloat(t.total_value) || (price * shares);
  return {
    id: t.id, ticker: t.ticker, name: t.name,
    shares, price,
    type: t.type, market: t.market, currency: t.currency || 'KES',
    total_value: totalValue, totalValue,
    commission, fees,
    date: t.created_at ? new Date(t.created_at).toISOString().split('T')[0] : '',
    created_at: t.created_at,
  };
}

app.get('/api/paper/trades', async (req, res) => {
  try {
    const userId = req.query.userId;
    if (!userId) return res.status(400).json({ error: 'userId is required' });
    const { rows } = await pool.query('SELECT * FROM paper_trades WHERE user_id = $1 ORDER BY created_at DESC LIMIT 100', [userId]);
    res.json(rows.map(normalizeTrade));
  } catch (err) {
    console.error('Error fetching paper trades:', err.message);
    res.status(500).json({ error: 'Failed to fetch trades' });
  }
});

// ── Paper Trading Orders ──
app.post('/api/paper/orders', async (req, res) => {
  try {
    const { userId, ticker, name, shares, type, market, sector } = req.body;
    if (!userId || !ticker || !shares || !type) {
      return res.status(400).json({ error: 'userId, ticker, shares, and type are required' });
    }

    const marketKey = (market || 'NSE') === 'NSE' ? 'NSE' : 'Global';
    const status = isMarketOpen(marketKey === 'NSE' ? 'NSE' : 'Global');
    if (!status.open) {
      return res.status(400).json({ error: `${marketKey} market is currently ${status.label}. Trading is only allowed during market hours (${status.openTime} - ${status.closeTime}).` });
    }

    // Look up live price (fast timeout — synthetic fallback is fine for paper trading)
    const livePrice = await Promise.race([
      getLivePrice(market || 'NSE', ticker),
      new Promise(resolve => setTimeout(() => resolve(null), 1000)),
    ]);
    if (!livePrice || livePrice <= 0) {
      return res.status(400).json({ error: 'Could not fetch current price for ' + ticker });
    }

    const shareQty = parseFloat(shares);
    const totalValue = livePrice * shareQty;
    const isNse = (market || 'NSE') === 'NSE';
    const currency = isNse ? 'KES' : 'USD';

    // Get account
    const acctRows = await pool.query('SELECT * FROM paper_accounts WHERE user_id = $1', [userId]);
    if (acctRows.rows.length === 0) {
      return res.status(400).json({ error: 'No paper account. Start trading first.' });
    }
    const account = acctRows.rows[0];

    if (type === 'buy') {
      const available = isNse ? parseFloat(account.cash_balance) : parseFloat(account.cash_balance_usd);
      if (totalValue > available) {
        return res.status(400).json({ error: `Insufficient ${currency} balance. Need ${currency} ${totalValue.toFixed(2)} but have ${currency} ${available.toFixed(2)}` });
      }
    } else if (type === 'sell') {
      // Check position
      const posRows = await pool.query(
        'SELECT shares FROM paper_positions WHERE user_id = $1 AND ticker = $2 AND market = $3',
        [userId, ticker, market || 'NSE']
      );
      const heldShares = posRows.rows.length > 0 ? parseFloat(posRows.rows[0].shares) : 0;
      if (shareQty > heldShares) {
        return res.status(400).json({ error: `Not enough shares. You hold ${heldShares} shares of ${ticker}.` });
      }
    }

    const commission = totalValue * 0.01;
    const fees = totalValue * 0.001;
    const netAmount = totalValue + commission + fees;

    // Create trade record
    const tradeResult = await pool.query(
      `INSERT INTO paper_trades (user_id, ticker, name, shares, price, type, market, sector, currency, total_value, commission, fees)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12) RETURNING *`,
      [userId, ticker, name || ticker, shareQty, livePrice, type, market || 'NSE', sector || 'Other', currency, totalValue, commission, fees]
    );

    if (type === 'buy') {
      // Deduct from cash
      if (isNse) {
        await pool.query('UPDATE paper_accounts SET cash_balance = cash_balance - $1, total_fees_paid = total_fees_paid + $2 + $3 WHERE user_id = $4',
          [netAmount, commission, fees, userId]);
      } else {
        await pool.query('UPDATE paper_accounts SET cash_balance_usd = cash_balance_usd - $1, total_fees_paid_usd = total_fees_paid_usd + $2 + $3 WHERE user_id = $4',
          [netAmount, commission, fees, userId]);
      }
      // Upsert position (check first, then insert or update)
      const existingPos = await pool.query(
        'SELECT id, shares, avg_cost FROM paper_positions WHERE user_id = $1 AND ticker = $2 AND market = $3',
        [userId, ticker, market || 'NSE']
      );
      if (existingPos.rows.length > 0) {
        const oldShares = parseFloat(existingPos.rows[0].shares);
        const oldAvgCost = parseFloat(existingPos.rows[0].avg_cost);
        const newAvgCost = (oldAvgCost * oldShares + livePrice * shareQty) / (oldShares + shareQty);
        await pool.query(
          'UPDATE paper_positions SET shares = shares + $1, avg_cost = $2, name = $3, sector = $4 WHERE id = $5',
          [shareQty, newAvgCost, name || ticker, sector || 'Other', existingPos.rows[0].id]
        );
      } else {
        await pool.query(
          'INSERT INTO paper_positions (user_id, ticker, name, shares, avg_cost, market, sector) VALUES ($1, $2, $3, $4, $5, $6, $7)',
          [userId, ticker, name || ticker, shareQty, livePrice, market || 'NSE', sector || 'Other']
        );
      }
    } else {
      // Add proceeds to cash
      const proceeds = totalValue - commission - fees;
      if (isNse) {
        await pool.query('UPDATE paper_accounts SET cash_balance = cash_balance + $1, total_fees_paid = total_fees_paid + $2 + $3 WHERE user_id = $4',
          [proceeds, commission, fees, userId]);
      } else {
        await pool.query('UPDATE paper_accounts SET cash_balance_usd = cash_balance_usd + $1, total_fees_paid_usd = total_fees_paid_usd + $2 + $3 WHERE user_id = $4',
          [proceeds, commission, fees, userId]);
      }
      // Reduce position
      const existingPos = await pool.query(
        'SELECT shares FROM paper_positions WHERE user_id = $1 AND ticker = $2 AND market = $3',
        [userId, ticker, market || 'NSE']
      );
      const remainingShares = existingPos.rows.length > 0 ? parseFloat(existingPos.rows[0].shares) - shareQty : 0;
      if (remainingShares <= 0) {
        await pool.query('DELETE FROM paper_positions WHERE user_id = $1 AND ticker = $2 AND market = $3', [userId, ticker, market || 'NSE']);
      } else {
        await pool.query('UPDATE paper_positions SET shares = $1 WHERE user_id = $2 AND ticker = $3 AND market = $4',
          [remainingShares, userId, ticker, market || 'NSE']);
      }
    }

    // Get updated account
    const updatedAcct = await pool.query('SELECT * FROM paper_accounts WHERE user_id = $1', [userId]);
    const ua = updatedAcct.rows[0];
    snapshotPortfolioValue(userId).catch(() => {});

    res.status(201).json({
      trade: {
        ticker, shares: shareQty, price: livePrice,
        type, totalValue, commission, fees, currency,
      },
      cashBalance: parseFloat(ua.cash_balance),
      cashBalanceUsd: parseFloat(ua.cash_balance_usd),
    });
  } catch (error) {
    console.error('Error placing paper order:', error.message);
    res.status(500).json({ error: 'An unexpected error occurred' });
  }
});

app.get('/api/paper/statement', requireOwnership, async (req, res) => {
  try {
    const userId = req.query.userId;
    if (!userId) return res.status(400).json({ error: 'userId is required' });
    const acctRows = await pool.query('SELECT * FROM paper_accounts WHERE user_id = $1', [userId]);
    if (acctRows.rows.length === 0) {
      return res.status(404).json({ error: 'No paper account found. Start trading first.' });
    }
    const account = acctRows.rows[0];
    const trades = await pool.query('SELECT * FROM paper_trades WHERE user_id = $1 ORDER BY created_at ASC', [userId]);
    const positions = await pool.query('SELECT * FROM paper_positions WHERE user_id = $1', [userId]);
    const totalTrades = trades.rows.length;
    const buyTrades = trades.rows.filter(t => t.type === 'buy').length;
    const sellTrades = trades.rows.filter(t => t.type === 'sell').length;
    const kesTrades = trades.rows.filter(t => t.currency === 'KES' || t.market === 'NSE');
    const usdTrades = trades.rows.filter(t => t.currency === 'USD' || t.market !== 'NSE');
    const totalCommissionKes = kesTrades.reduce((s, t) => s + parseFloat(t.commission || 0), 0);
    const totalFeesKes = kesTrades.reduce((s, t) => s + parseFloat(t.fees || 0), 0);
    const totalCommissionUsd = usdTrades.reduce((s, t) => s + parseFloat(t.commission || 0), 0);
    const totalFeesUsd = usdTrades.reduce((s, t) => s + parseFloat(t.fees || 0), 0);
    // FIFO realized P&L: match sold shares against earliest open lots
    const lots = {};
    let realizedPnlKes = 0, realizedPnlUsd = 0;
    for (const t of trades.rows) {
      const market = t.market || (t.currency === 'KES' ? 'NSE' : 'Global');
      const key = `${t.ticker}:${market}`;
      if (t.type === 'buy') {
        lots[key] = lots[key] || [];
        lots[key].push({ shares: parseFloat(t.shares), price: parseFloat(t.price) });
      } else if (t.type === 'sell') {
        let remaining = parseFloat(t.shares);
        const queue = lots[key] || [];
        while (remaining > 1e-9 && queue.length > 0) {
          const lot = queue[0];
          const use = Math.min(remaining, lot.shares);
          const pnl = (parseFloat(t.price) - lot.price) * use;
          if (t.currency === 'USD') realizedPnlUsd += pnl; else realizedPnlKes += pnl;
          lot.shares -= use;
          remaining -= use;
          if (lot.shares <= 1e-9) queue.shift();
        }
      }
    }
    const openPositions = [];
    for (const p of positions.rows) {
      const livePrice = await getLivePrice(p.market, p.ticker) || parseFloat(p.avg_cost);
      const value = livePrice * parseFloat(p.shares);
      const cost = parseFloat(p.avg_cost) * parseFloat(p.shares);
      const pnlValue = value - cost;
      const pnlPctVal = cost > 0 ? ((value - cost) / cost * 100) : 0;
      openPositions.push({
        ticker: p.ticker, name: p.name, shares: parseFloat(p.shares),
        avgCost: parseFloat(p.avg_cost),
        currentPrice: livePrice,
        value: value,
        pnl: pnlValue,
        pnlPercent: pnlPctVal,
        market: p.market, sector: p.sector,
      });
    }
    const fxRate = await getFxRate();
    const nsePositionValue = openPositions.filter(p => p.market === 'NSE').reduce((s, p) => s + p.value, 0);
    const usdPositionValue = openPositions.filter(p => p.market !== 'NSE').reduce((s, p) => s + p.value, 0);
    res.json({
      generatedAt: new Date().toISOString(),
      account: {
        cashBalance: parseFloat(account.cash_balance),
        cashBalanceUsd: parseFloat(account.cash_balance_usd),
        initialCapital: parseFloat(account.initial_capital),
        initialCapitalUsd: parseFloat(account.initial_capital_usd),
        totalFeesPaid: parseFloat(account.total_fees_paid || 0),
        totalFeesPaidUsd: parseFloat(account.total_fees_paid_usd || 0),
        cashBalanceKes: parseFloat(account.cash_balance),
        initialCapitalKes: parseFloat(account.initial_capital),
        totalFeesPaidKes: parseFloat(account.total_fees_paid || 0),
      },
      summary: {
        totalTrades, buyTrades, sellTrades, openPositions: openPositions.length,
        totalCommissionKes: Math.round(totalCommissionKes * 100) / 100,
        totalFeesKes: Math.round(totalFeesKes * 100) / 100,
        totalCommissionUsd: Math.round(totalCommissionUsd * 100) / 100,
        totalFeesUsd: Math.round(totalFeesUsd * 100) / 100,
        realizedPnlKes: Math.round(realizedPnlKes * 100) / 100,
        realizedPnlUsd: Math.round(realizedPnlUsd * 100) / 100,
        nsePositionValue: Math.round(nsePositionValue * 100) / 100,
        usdPositionValue: Math.round(usdPositionValue * 100) / 100,
        fxRate,
      },
      trades: trades.rows.slice().reverse().map(normalizeTrade),
      tradeHistory: trades.rows.slice().reverse().map(normalizeTrade),
      openPositions,
    });
  } catch (err) {
    console.error('Error fetching paper statement:', err.message);
    res.status(500).json({ error: 'Failed to fetch statement' });
  }
});

app.post('/api/paper/reset', async (req, res) => {
  try {
    const { userId, initialCapital } = req.body;
    if (!userId) return res.status(400).json({ error: 'userId is required' });
    const capKes = parseFloat(initialCapital) || 1000000.00;
    const capUsd = 10000.00;
    await pool.query('DELETE FROM paper_trades WHERE user_id = $1', [userId]);
    await pool.query('DELETE FROM paper_positions WHERE user_id = $1', [userId]);
    await pool.query('DELETE FROM paper_accounts WHERE user_id = $1', [userId]);
    const { rows } = await pool.query(
      `INSERT INTO paper_accounts (user_id, cash_balance, initial_capital, cash_balance_usd, initial_capital_usd)
       VALUES ($1, $2, $2, $3, $3) RETURNING *`,
      [userId, capKes, capUsd]
    );
    res.json({ account: rows[0], message: 'Paper account has been reset' });
  } catch (err) {
    console.error('Error resetting paper account:', err.message);
    res.status(500).json({ error: 'Failed to reset paper account' });
  }
});

app.get('/api/paper/positions', async (req, res) => {
  try {
    const userId = req.query.userId;
    if (!userId) return res.status(400).json({ error: 'userId is required' });
    const { rows } = await pool.query('SELECT * FROM paper_positions WHERE user_id = $1 ORDER BY ticker', [userId]);
    res.json(rows);
  } catch (err) {
    console.error('Error fetching paper positions:', err.message);
    res.status(500).json({ error: 'Failed to fetch positions' });
  }
});

app.get('/api/financials/:symbol/filings', async (req, res) => {
  try {
    const symbol = req.params.symbol.toUpperCase().replace('NSE:', '');
    const limit = parseInt(req.query.limit, 10) || 20;
    const edgarService = require('./edgarService');
    const filings = await edgarService.getFilings(symbol, ['10-K', '10-Q'], limit);
    res.json({ success: true, symbol, filings, count: filings.length });
  } catch (error) {
    console.error('Error fetching SEC filings:', error.message);
    res.status(500).json({ success: false, error: 'Failed to fetch SEC filings' });
  }
});

app.get('/api/financials/:symbol/edgar', async (req, res) => {
  try {
    const symbol = req.params.symbol.toUpperCase().replace('NSE:', '');
    const period = req.query.period || 'annual';
    const limit = parseInt(req.query.limit, 10) || 4;
    const report = await getFinancialReport(symbol, period, limit, 'sec-edgar');
    res.json(report);
  } catch (error) {
    console.error('Error fetching EDGAR report:', error.message);
    res.status(500).json({ success: false, error: 'Failed to fetch EDGAR report' });
  }
});

// --- Payment Routes ---
app.post('/api/payments/mpesa-push', async (req, res) => {
  try {
    const { phoneNumber, amount, plan, customerName, userId, durationMonths } = req.body;
    if (!phoneNumber || !amount) {
      return res.status(400).json({ error: 'Phone number and amount required' });
    }
    const cleanedPhone = phoneNumber.replace(/\D/g, '');
    const formattedPhone = cleanedPhone.startsWith('0')
      ? '254' + cleanedPhone.slice(1)
      : cleanedPhone.startsWith('254')
        ? cleanedPhone
        : '254' + cleanedPhone;
    if (!formattedPhone.match(/^254(7\d{8}|1\d{8,9})$/)) {
      return res.status(400).json({ error: 'Invalid Kenyan phone number. Use 07XX XXX XXX, 01XX XXX XXX, or 254XXX XXX XXX.' });
    }
    const result = await payheroService.sendStkPush({
      amount: Math.round(amount),
      phoneNumber: formattedPhone,
      customerName: customerName || 'StocksIntels User',
    });
    await pool.query(
      `INSERT INTO payment_transactions (user_id, amount, currency, provider, phone_number, external_reference, payhero_reference, status, plan_name, duration_months)
       VALUES ($1, $2, 'KES', 'm-pesa', $3, $4, $5, $6, $7, $8)`,
      [userId || null, amount, formattedPhone, result.externalReference, result.reference, result.status.toLowerCase(), plan || null, durationMonths || 1]
    );
    res.json({
      success: true,
      message: 'STK Push sent. Check your phone and enter PIN.',
      reference: result.reference,
      externalReference: result.externalReference,
      checkoutRequestId: result.checkoutRequestId,
    });
  } catch (error) {
    console.error('M-Pesa STK push error:', error.response?.status, JSON.stringify(error.response?.data), error.message, error.stack);
    console.error('[M-Pesa] STK push error:', error.response?.status, JSON.stringify(error.response?.data));
    res.status(500).json({ error: 'Failed to initiate payment. Please try again.' });
  }
});

app.post('/api/payments/callback', async (req, res) => {
  try {
    const callbackData = req.body;
    console.log('PayHero callback received:', JSON.stringify(callbackData));
    const response = callbackData.response || {};
    const reference = response.ExternalReference || response.MerchantRequestID || callbackData.reference || callbackData.external_reference;
    const rawStatus = String(response.Status || callbackData.status || '').toLowerCase();
    const status = rawStatus === 'success' ? 'success'
      : rawStatus === 'failed' ? 'failed'
      : rawStatus === 'cancelled' ? 'failed'
      : 'pending';
    if (reference) {
      await pool.query(
        `UPDATE payment_transactions SET status = $1, callback_data = $2, updated_at = NOW()
         WHERE payhero_reference = $3 OR external_reference = $3`,
        [status, JSON.stringify(callbackData), reference]
      );
      if (status === 'success') {
        const tx = await pool.query(
          'SELECT id, user_id, phone_number, plan_name, duration_months, amount FROM payment_transactions WHERE payhero_reference = $1 OR external_reference = $1',
          [reference]
        );
        if (tx.rows.length > 0) {
          const { id, user_id, phone_number, plan_name, duration_months } = tx.rows[0];
          let targetUserId = user_id;
          if (!targetUserId && phone_number) {
            try {
              const userMatch = await pool.query(
                "SELECT id FROM users WHERE phone_number = $1 OR phone = $1 OR email LIKE $2 LIMIT 1",
                [phone_number, `%${phone_number.slice(-9)}%`]
              );
              if (userMatch.rows.length > 0) targetUserId = userMatch.rows[0].id;
            } catch { }
          }
          if (targetUserId) {
            const tier = (plan_name || 'pro').toLowerCase();
            const months = parseInt(duration_months) || 1;
            // Find plan_id
            const planRes = await pool.query(
              'SELECT id FROM subscription_plans WHERE LOWER(name) = $1 LIMIT 1',
              [tier]
            );
            const planId = planRes.rows[0]?.id || null;
            const startDate = new Date();
            const endDate = new Date(startDate);
            endDate.setMonth(endDate.getMonth() + months);
            // Create subscription record
            const subRes = await pool.query(
              `INSERT INTO subscriptions (user_id, plan_id, status, start_date, end_date)
               VALUES ($1, $2, 'active', $3, $4)
               RETURNING id`,
              [targetUserId, planId, startDate, endDate]
            );
            const subscriptionId = subRes.rows[0]?.id || null;
            // Update user
            await pool.query(
              `UPDATE users SET subscription_tier = $1, subscription_status = 'active', subscription_start_date = $2, subscription_end_date = $3 WHERE id = $4`,
              [tier, startDate, endDate, targetUserId]
            );
            // Link transaction to subscription
            if (subscriptionId) {
              await pool.query(
                'UPDATE payment_transactions SET subscription_id = $1 WHERE id = $2',
                [subscriptionId, id]
              );
            }
            console.log(`Subscription activated: user=${targetUserId} tier=${tier} months=${months} end=${endDate.toISOString()}`);
            await awardCommission(targetUserId, tier);
            // Send receipt email
            try {
              const userRes = await pool.query('SELECT full_name, email FROM users WHERE id = $1', [targetUserId]);
              const { full_name: uName, email: uEmail } = userRes.rows[0] || {};
              if (uEmail) {
                await sendPaymentReceiptEmail(uEmail, {
                  userName: uName,
                  planName: plan_name || 'Pro',
                  amount: parseFloat((tx.rows[0].amount / USD_TO_KES_RATE).toFixed(2)),
                  currency: 'USD',
                  period: months === 12 ? 'yearly' : 'monthly',
                  durationMonths: months,
                  paymentMethod: 'M-Pesa',
                  transactionRef: reference,
                  paidAt: new Date(),
                  startDate,
                  endDate,
                });
              }
            } catch (mailErr) {
              console.error('[RECEIPT] Failed to send receipt email:', mailErr.message);
            }
          }
        }
      }
    }
    res.json({ received: true });
  } catch (error) {
    console.error('Payment callback error:', error.message);
    res.json({ received: true });
  }
});

app.get('/api/payments/status', async (req, res) => {
  try {
    const { reference } = req.query;
    if (!reference) return res.status(400).json({ error: 'Reference required' });
    const tx = await pool.query(
      `SELECT * FROM payment_transactions WHERE payhero_reference = $1 OR external_reference = $1`,
      [reference]
    );
    if (tx.rows.length === 0) {
      const payheroStatus = await payheroService.checkTransactionStatus(reference);
      const ps = (payheroStatus.status || '').toLowerCase();
      return res.json({
        found: false,
        status: ps === 'success' ? 'success' : ps === 'failed' ? 'failed' : 'pending',
        providerStatus: payheroStatus.status,
        providerSuccess: payheroStatus.success,
      });
    }
    const dbStatus = tx.rows[0].status;
    if (dbStatus === 'queued' || dbStatus === 'pending') {
      for (const ref of [reference, tx.rows[0].payhero_reference].filter(Boolean)) {
        try {
          const payheroStatus = await payheroService.checkTransactionStatus(ref);
          const ps = (payheroStatus.status || '').toLowerCase();
          if (ps === 'success') {
            await pool.query(
              `UPDATE payment_transactions SET status = 'success', updated_at = NOW()
               WHERE id = $1 AND status IN ('queued', 'pending')`,
              [tx.rows[0].id]
            );
            if (tx.rows[0].user_id) {
              const tier = (tx.rows[0].plan_name || 'pro').toLowerCase();
              const months = parseInt(tx.rows[0].duration_months) || 1;
              const startDate = new Date();
              const endDate = new Date(startDate);
              endDate.setMonth(endDate.getMonth() + months);
              const planRes = await pool.query(
                'SELECT id FROM subscription_plans WHERE LOWER(name) = $1 LIMIT 1',
                [tier]
              );
              const planId = planRes.rows[0]?.id || null;
              const subRes = await pool.query(
                `INSERT INTO subscriptions (user_id, plan_id, status, start_date, end_date)
                 VALUES ($1, $2, 'active', $3, $4)
                 RETURNING id`,
                [tx.rows[0].user_id, planId, startDate, endDate]
              );
              await pool.query(
                `UPDATE users SET subscription_tier = $1, subscription_status = 'active', subscription_start_date = $2, subscription_end_date = $3 WHERE id = $4`,
                [tier, startDate, endDate, tx.rows[0].user_id]
              );
              await pool.query(
                'UPDATE payment_transactions SET subscription_id = $1 WHERE id = $2',
                [subRes.rows[0]?.id || null, tx.rows[0].id]
              );
              try {
                const userRes = await pool.query('SELECT full_name, email FROM users WHERE id = $1', [tx.rows[0].user_id]);
                const { full_name: uName, email: uEmail } = userRes.rows[0] || {};
                if (uEmail) {
                  const rawCurrency = tx.rows[0].currency || 'KES';
                  const usdAmount = rawCurrency === 'KES'
                    ? parseFloat((tx.rows[0].amount / USD_TO_KES_RATE).toFixed(2))
                    : tx.rows[0].amount;
                  await sendPaymentReceiptEmail(uEmail, {
                    userName: uName,
                    planName: tx.rows[0].plan_name || 'Pro',
                    amount: usdAmount,
                    currency: 'USD',
                    period: months === 12 ? 'yearly' : 'monthly',
                    durationMonths: months,
                    paymentMethod: 'M-Pesa',
                    transactionRef: tx.rows[0].payhero_reference || reference,
                    paidAt: new Date(),
                    startDate,
                    endDate,
                  });
                }
              } catch (emailErr) {
                console.error('Payment receipt email error:', emailErr.message);
              }
              await awardCommission(tx.rows[0].user_id, tier);
            }
            return res.json({ found: true, status: 'success', amount: tx.rows[0].amount, currency: tx.rows[0].currency, phoneNumber: tx.rows[0].phone_number, createdAt: tx.rows[0].created_at });
          }
          if (ps === 'failed') {
            await pool.query(
              `UPDATE payment_transactions SET status = 'failed', updated_at = NOW()
               WHERE id = $1 AND status IN ('queued', 'pending')`,
              [tx.rows[0].id]
            );
            return res.json({ found: true, status: 'failed', amount: tx.rows[0].amount, currency: tx.rows[0].currency, phoneNumber: tx.rows[0].phone_number, createdAt: tx.rows[0].created_at });
          }
        } catch (e) {
          console.error('PayHero status check failed for ref', ref, e.message);
        }
      }
    }
    res.json({
      found: true,
      amount: tx.rows[0].amount,
      currency: tx.rows[0].currency,
      status: dbStatus,
      phoneNumber: tx.rows[0].phone_number,
      createdAt: tx.rows[0].created_at,
    });
  } catch (error) {
    console.error('Payment status error:', error.message);
    res.status(500).json({ error: 'Failed to check payment status' });
  }
});

// Resend payment receipt (useful when email provider fails on first attempt)
app.post('/api/payments/resend-receipt', authenticateToken, async (req, res) => {
  try {
    const { reference } = req.body;
    if (!reference) return res.status(400).json({ error: 'Reference required' });

    const tx = await pool.query(
      `SELECT * FROM payment_transactions
       WHERE (payhero_reference = $1 OR external_reference = $1) AND user_id = $2`,
      [reference, req.user.id]
    );
    if (tx.rows.length === 0) {
      return res.status(404).json({ error: 'Transaction not found' });
    }
    const transaction = tx.rows[0];
    if (transaction.status !== 'success') {
      return res.status(400).json({ error: 'Transaction is not successful yet' });
    }

    const months = parseInt(transaction.duration_months) || 1;
    const startDate = transaction.created_at ? new Date(transaction.created_at) : new Date();
    const endDate = new Date(startDate);
    endDate.setMonth(endDate.getMonth() + months);

    const rawCur = transaction.currency || 'KES';
    const receiptAmount = rawCur === 'KES'
      ? parseFloat((transaction.amount / USD_TO_KES_RATE).toFixed(2))
      : transaction.amount;
    await sendPaymentReceiptEmail(req.user.email, {
      userName: req.user.full_name,
      planName: transaction.plan_name || 'Pro',
      amount: receiptAmount,
      currency: 'USD',
      period: months === 12 ? 'yearly' : 'monthly',
      durationMonths: months,
      paymentMethod: transaction.provider || 'M-Pesa',
      transactionRef: transaction.payhero_reference || reference,
      paidAt: transaction.updated_at || new Date(),
      startDate,
      endDate,
    });

    res.json({ success: true, message: 'Receipt resent' });
  } catch (error) {
    console.error('Resend receipt error:', error.message);
    res.status(500).json({ error: 'Failed to resend receipt' });
  }
});

app.get('/api/payments/plans', async (req, res) => {
  try {
    const result = await pool.query(
      'SELECT id, name, description, price_kes, price_usd, features FROM subscription_plans WHERE is_active = true ORDER BY price_kes'
    );
    res.json({ plans: result.rows });
  } catch (error) {
    console.error('Fetch plans error:', error.message);
    res.status(500).json({ error: 'Failed to fetch plans' });
  }
});

// --- PayPal Payment Routes ---
// Convert USD to KES for display, but charge in USD via PayPal

app.post('/api/payments/paypal', async (req, res) => {
  try {
    const { amount, plan, userId, durationMonths } = req.body;
    if (!amount) {
      return res.status(400).json({ error: 'Amount is required' });
    }
    const usdAmount = parseFloat((amount / USD_TO_KES_RATE).toFixed(2));
    if (usdAmount < 1) {
      return res.status(400).json({ error: 'Minimum amount is 1 USD' });
    }
    const planName = plan || 'Subscription';
    const period = durationMonths === 12 ? 'Yearly' : 'Monthly';
    const externalRef = `STK-${Date.now()}-${String(Math.random()).slice(2, 8)}`;
    const result = await paypalService.createOrder({
      amount: usdAmount,
      currency: 'USD',
      description: `StocksIntels ${planName} ${period}`,
      externalReference: externalRef,
      plan: planName,
    });
    await pool.query(
      `INSERT INTO payment_transactions (user_id, amount, currency, provider, phone_number, external_reference, status, plan_name, duration_months)
       VALUES ($1, $2, 'USD', 'paypal', $3, $4, 'pending', $5, $6)
       ON CONFLICT (external_reference) DO NOTHING`,
      [userId || null, usdAmount, '', externalRef, planName, durationMonths || 1]
    );
    res.json({
      success: true,
      checkoutUrl: result.checkoutUrl,
      orderId: result.orderId,
    });
  } catch (error) {
    console.error('PayPal order creation error:', error.message);
    res.status(500).json({ error: 'Failed to create PayPal checkout session' });
  }
});

app.get('/api/payments/paypal-capture', async (req, res) => {
  try {
    const { token, PayerID } = req.query;
    if (!token) {
      return res.redirect(`${process.env.FRONTEND_URL || 'http://localhost:5173'}/subscribe?paypal=failed`);
    }
    const capture = await paypalService.captureOrder(token);
    const status = capture.captureStatus === 'COMPLETED' ? 'success' : 'failed';
    const reference = capture.referenceId || token;
    const amount = parseFloat(capture.amount || 0);
    const currency = capture.currency || 'USD';
    let tier = 'pro';
    await pool.query(
      `UPDATE payment_transactions SET status = $1, callback_data = $2, external_reference = $3, updated_at = NOW()
       WHERE external_reference = $4 OR external_reference = $5`,
      [
        status,
        JSON.stringify(capture),
        token,
        reference,
        token,
      ]
    );
    if (status === 'success') {
      const tx = await pool.query(
        'SELECT id, user_id, plan_name, duration_months FROM payment_transactions WHERE external_reference = $1 OR external_reference = $2',
        [reference, token]
      );
      if (tx.rows.length > 0 && tx.rows[0].user_id) {
        const { id: txId, user_id: targetUserId, plan_name, duration_months } = tx.rows[0];
        const tier = (plan_name || 'pro').toLowerCase();
        const months = parseInt(duration_months) || 1;
        const planRes = await pool.query(
          'SELECT id FROM subscription_plans WHERE LOWER(name) = $1 LIMIT 1',
          [tier]
        );
        const planId = planRes.rows[0]?.id || null;
        const startDate = new Date();
        const endDate = new Date(startDate);
        endDate.setMonth(endDate.getMonth() + months);
        const subRes = await pool.query(
          `INSERT INTO subscriptions (user_id, plan_id, status, start_date, end_date)
           VALUES ($1, $2, 'active', $3, $4)
           RETURNING id`,
          [targetUserId, planId, startDate, endDate]
        );
        const subscriptionId = subRes.rows[0]?.id || null;
        await pool.query(
          `UPDATE users SET subscription_tier = $1, subscription_status = 'active', subscription_start_date = $2, subscription_end_date = $3 WHERE id = $4`,
          [tier, startDate, endDate, targetUserId]
        );
        if (subscriptionId) {
          await pool.query(
            'UPDATE payment_transactions SET subscription_id = $1 WHERE id = $2',
            [subscriptionId, txId]
          );
        }
        console.log(`PayPal subscription activated: user=${targetUserId} tier=${tier} months=${months} end=${endDate.toISOString()}`);
        await awardCommission(targetUserId, tier);
        try {
          const userRes = await pool.query('SELECT full_name, email FROM users WHERE id = $1', [targetUserId]);
          const { full_name: uName, email: uEmail } = userRes.rows[0] || {};
          if (uEmail) {
            await sendPaymentReceiptEmail(uEmail, {
              userName: uName,
              planName: plan_name || 'Pro',
              amount: amount,
              currency: 'USD',
              period: months === 12 ? 'yearly' : 'monthly',
              durationMonths: months,
              paymentMethod: 'PayPal',
              transactionRef: capture.captureId || token,
              paidAt: new Date(),
              startDate,
              endDate,
            });
          }
        } catch (mailErr) {
          console.error('[RECEIPT] Failed to send receipt email:', mailErr.message);
        }
      }
    }
    const frontendUrl = process.env.FRONTEND_URL || 'http://localhost:5173';
    if (status === 'success') {
      res.redirect(`${frontendUrl}/subscribe/${tier}?paypal=success`);
    } else {
      res.redirect(`${frontendUrl}/pricing?paypal=failed`);
    }
  } catch (error) {
    console.error('PayPal capture error:', error.message);
    const frontendUrl = process.env.FRONTEND_URL || 'http://localhost:5173';
    res.redirect(`${frontendUrl}/pricing?paypal=failed`);
  }
});

app.get('/api/payments/paypal-cancel', async (req, res) => {
  const frontendUrl = process.env.FRONTEND_URL || 'http://localhost:5173';
  const plan = req.query.plan || '';
  const url = plan ? `${frontendUrl}/subscribe/${plan}?paypal=cancelled` : `${frontendUrl}/pricing?paypal=cancelled`;
  res.redirect(url);
});

app.post('/api/payments/paypal-webhook', async (req, res) => {
  try {
    const verified = await paypalService.verifyWebhookSignature(req.headers, req.body);
    if (!verified) {
      console.warn('PayPal webhook signature verification failed');
      return res.status(400).json({ error: 'Invalid signature' });
    }
    const event = req.body;
    const resource = event.resource || {};
    if (event.event_type === 'CHECKOUT.ORDER.APPROVED' || event.event_type === 'PAYMENT.CAPTURE.COMPLETED') {
      const orderId = resource.id || resource.supplementary_data?.related_ids?.order_id;
      const amount = resource.amount?.value || resource.purchase_units?.[0]?.amount?.value;
      const reference = resource.custom_id || resource.invoice_id;
      if (orderId && reference) {
        await pool.query(
          `UPDATE payment_transactions SET status = 'success', callback_data = $1, updated_at = NOW()
           WHERE external_reference = $2 AND status = 'pending'`,
          [JSON.stringify(event), reference]
        );
      }
    }
    res.json({ received: true });
  } catch (error) {
    console.error('PayPal webhook error:', error.message);
    res.json({ received: true });
  }
});

// --- Crypto (Triple-A) Checkout ---
app.post('/api/payments/crypto', async (req, res) => {
  try {
    const { amount, currency, plan, userId, durationMonths, cryptoTicker, cryptoNetwork } = req.body;
    if (!amount) {
      return res.status(400).json({ error: 'Amount is required' });
    }
    const planName = plan || 'Subscription';
    const externalRef = `CRYPTO-${Date.now()}-${String(Math.random()).slice(2, 8)}`;

    const result = await tripleAService.createCheckoutSession({
      amount,
      currency: currency || 'USD',
      reference: externalRef,
      plan: planName,
      durationMonths: durationMonths || 1,
      cryptoTicker,
      cryptoNetwork,
    });

    await pool.query(
      `INSERT INTO payment_transactions (user_id, amount, currency, provider, external_reference, status, plan_name, duration_months)
       VALUES ($1, $2, $3, 'crypto', $4, 'pending', $5, $6)
       ON CONFLICT (external_reference) DO NOTHING`,
      [userId || null, amount, currency || 'USD', externalRef, planName, durationMonths || 1]
    );

    res.json({ success: true, checkoutUrl: result.checkoutUrl, reference: externalRef });
  } catch (error) {
    console.error('Crypto checkout error:', error.message);
    res.status(500).json({ error: error.message || 'Failed to create crypto checkout' });
  }
});

// --- Triple-A Webhook ---
app.post('/api/payments/crypto-webhook', async (req, res) => {
  try {
    const event = req.body;
    const sessionId = event.session_id || event.data?.session_id;
    const status = event.status || event.data?.status;
    const reference = event.reference || event.data?.reference;
    const eventType = event.event || event.event_type || '';

    console.log(`[CRYPTO WEBHOOK] event=${eventType} session=${sessionId} status=${status} ref=${reference}`);

    if (['payment.completed', 'checkout.completed', 'success'].includes(status?.toLowerCase()) && reference) {
      const txResult = await pool.query(
        `UPDATE payment_transactions SET status = 'success', callback_data = $1, updated_at = NOW()
         WHERE external_reference = $2 AND status = 'pending'
         RETURNING id, user_id, plan_name, duration_months, provider`,
        [JSON.stringify(event), reference]
      );
      const tx = txResult.rows[0];
      if (tx && tx.user_id) {
        const tier = (tx.plan_name || 'pro').toLowerCase();
        const months = parseInt(tx.duration_months) || 1;
        const startDate = new Date();
        const endDate = new Date(startDate);
        endDate.setMonth(endDate.getMonth() + months);
        const planRes = await pool.query(
          'SELECT id FROM subscription_plans WHERE LOWER(name) = $1 LIMIT 1',
          [tier]
        );
        const planId = planRes.rows[0]?.id || null;
        const subRes = await pool.query(
          `INSERT INTO subscriptions (user_id, plan_id, status, start_date, end_date)
           VALUES ($1, $2, 'active', $3, $4)
           RETURNING id`,
          [tx.user_id, planId, startDate, endDate]
        );
        const subscriptionId = subRes.rows[0]?.id || null;
        await pool.query(
          `UPDATE users SET subscription_tier = $1, subscription_status = 'active', subscription_start_date = $2, subscription_end_date = $3 WHERE id = $4`,
          [tier, startDate, endDate, tx.user_id]
        );
        if (subscriptionId) {
          await pool.query(
            'UPDATE payment_transactions SET subscription_id = $1 WHERE id = $2',
            [subscriptionId, tx.id]
          );
        }
        console.log(`[CRYPTO] Subscription activated: user=${tx.user_id} tier=${tier} months=${months}`);
        await awardCommission(tx.user_id, tier);
        try {
          const userRes = await pool.query('SELECT full_name, email FROM users WHERE id = $1', [tx.user_id]);
          const { full_name: uName, email: uEmail } = userRes.rows[0] || {};
          if (uEmail) {
            await sendPaymentReceiptEmail(uEmail, {
              userName: uName,
              planName: tx.plan_name || 'Pro',
              amount: 0,
              currency: 'USD',
              period: months === 12 ? 'yearly' : 'monthly',
              durationMonths: months,
              paymentMethod: 'Crypto (Triple-A)',
              transactionRef: reference,
              paidAt: new Date(),
              startDate,
              endDate,
            });
          }
        } catch (mailErr) {
          console.error('[RECEIPT] Failed to send receipt email:', mailErr.message);
        }
      } else {
        console.log(`[CRYPTO] Payment confirmed but no user_id on transaction: ref=${reference}`);
      }
    } else if (['payment.failed', 'payment.cancelled', 'failed', 'cancelled'].includes(status?.toLowerCase()) && reference) {
      await pool.query(
        `UPDATE payment_transactions SET status = 'failed', callback_data = $1, updated_at = NOW()
         WHERE external_reference = $2 AND status = 'pending'`,
        [JSON.stringify(event), reference]
      );
      console.log(`[CRYPTO] Payment failed: ref=${reference}`);
    }

    res.json({ received: true });
  } catch (error) {
    console.error('Crypto webhook error:', error.message);
    res.json({ received: true });
  }
});

// --- Trial Routes ($1 commitment fee) ---
app.post('/api/payments/start-trial', authenticateToken, async (req, res) => {
  try {
    const { plan } = req.body;
    const userId = req.user.id;
    if (!plan) return res.status(400).json({ error: 'Plan name required' });
    const tier = plan.toLowerCase();
    const validPlans = ['starter', 'premium', 'pro', 'institutional'];
    if (!validPlans.includes(tier)) {
      return res.status(400).json({ error: 'Invalid plan for trial' });
    }
    const userRes = await pool.query(
      `SELECT id, full_name, email, subscription_tier, subscription_status, trial_start_date, subscription_end_date, commitment_fee_paid FROM users WHERE id = $1`,
      [userId]
    );
    if (userRes.rows.length === 0) return res.status(404).json({ error: 'User not found' });
    const userRow = userRes.rows[0];

    // Check if $1 commitment fee has been paid
    if (!userRow.commitment_fee_paid) {
      return res.status(402).json({
        error: 'Commitment fee required',
        code: 'COMMITMENT_FEE_REQUIRED',
        message: 'Please pay the $1 commitment fee to start your 7-day trial.'
      });
    }

    const alreadyPaid = userRow.subscription_status === 'active' &&
      userRow.subscription_tier !== 'free' &&
      userRow.subscription_end_date &&
      new Date(userRow.subscription_end_date) > new Date();
    if (alreadyPaid) {
      return res.status(400).json({ error: 'You already have an active subscription' });
    }

    // One trial per person: check if this account's trial already expired
    if (userRow.trial_start_date) {
      const expired = new Date() - new Date(userRow.trial_start_date) >= 7 * 24 * 60 * 60 * 1000;
      if (expired) {
        return res.status(400).json({ error: 'Your trial has already ended. Please subscribe to continue.' });
      }
    }

    // Cross-account check: prevent same name from getting multiple trials
    const nameMatch = await pool.query(
      `SELECT id FROM users WHERE LOWER(full_name) = LOWER($1) AND id != $2 AND trial_start_date IS NOT NULL AND subscription_tier != 'free'`,
      [userRow.full_name, userId]
    );
    if (nameMatch.rows.length > 0) {
      return res.status(400).json({ error: 'A trial has already been used under this name. Each person gets one trial only.' });
    }

    const trialStart = userRow.trial_start_date || new Date();
    const inTrial = new Date() - new Date(trialStart) < 7 * 24 * 60 * 60 * 1000;
    const startDate = inTrial ? trialStart : new Date();
    const updateRes = await pool.query(
      `UPDATE users SET subscription_tier = $1, subscription_status = 'active', trial_start_date = $2 WHERE id = $3 RETURNING id, full_name, email, role, trader_type, is_verified, subscription_tier, subscription_status, trial_start_date, subscription_end_date, commitment_fee_paid`,
      [tier, startDate, userId]
    );
    console.log(`[TRIAL] Started: user=${userId} plan=${tier}`);
    res.json({ success: true, message: `7-day trial started for ${plan}!`, user: updateRes.rows[0] });
  } catch (error) {
    console.error('Start trial error:', error.message);
    res.status(500).json({ error: 'Failed to start trial' });
  }
});

// Pay $1 commitment fee to unlock the 7-day trial
app.post('/api/payments/commitment-fee', authenticateToken, async (req, res) => {
  try {
    const userId = req.user.id;
    const userRes = await pool.query(`SELECT commitment_fee_paid FROM users WHERE id = $1`, [userId]);
    if (userRes.rows.length === 0) return res.status(404).json({ error: 'User not found' });
    if (userRes.rows[0].commitment_fee_paid) {
      return res.json({ success: true, message: 'Commitment fee already paid.' });
    }
    // Record the $1 commitment fee transaction
    await pool.query(
      `INSERT INTO payment_transactions (user_id, amount, currency, provider, status, plan_name)
       VALUES ($1, 1, 'USD', 'commitment_fee', 'success', 'Trial Commitment Fee')`,
      [userId]
    );
    await pool.query(
      `UPDATE users SET commitment_fee_paid = true WHERE id = $1`,
      [userId]
    );
    console.log(`[COMMITMENT] Paid: user=${userId}`);
    res.json({ success: true, message: 'Commitment fee paid! Start your 7-day trial now.' });
  } catch (error) {
    console.error('Commitment fee error:', error.message);
    res.status(500).json({ error: 'Failed to process commitment fee' });
  }
});

// --- Activate Free Plan ---
app.post('/api/payments/activate-free', authenticateToken, async (_req, res) => {
  res.status(400).json({ error: 'Free plan is no longer available. Start a 7-day trial for $1.' });
});

// --- Affiliate Program Routes ---
function generateReferralCode(name) {
  const prefix = name.replace(/[^a-zA-Z0-9]/g, '').slice(0, 6).toUpperCase();
  const suffix = Math.random().toString(36).substring(2, 6).toUpperCase();
  return `${prefix}${suffix}`;
}

app.post('/api/affiliates/register', authenticateToken, async (req, res) => {
  try {
    const userId = req.user.id;
    const existing = await pool.query(`SELECT id FROM affiliates WHERE user_id = $1`, [userId]);
    if (existing.rows.length > 0) {
      return res.status(400).json({ error: 'You are already registered as an affiliate' });
    }
    const userRes = await pool.query(`SELECT full_name FROM users WHERE id = $1`, [userId]);
    const name = userRes.rows[0]?.full_name || 'User';
    let referralCode = generateReferralCode(name);
    let retries = 0;
    while (retries < 5) {
      const dup = await pool.query(`SELECT id FROM affiliates WHERE referral_code = $1`, [referralCode]);
      if (dup.rows.length === 0) break;
      referralCode = generateReferralCode(name);
      retries++;
    }
    await pool.query(
      `INSERT INTO affiliates (user_id, referral_code) VALUES ($1, $2)`,
      [userId, referralCode]
    );
    const baseUrl = process.env.FRONTEND_URL || 'https://stocks-intels-frontend-7etg.vercel.app';
    console.log(`[AFFILIATE] Registered: user=${userId} code=${referralCode}`);
    res.json({
      success: true,
      referral_code: referralCode,
      referral_link: `${baseUrl}/login?ref=${referralCode}`,
    });
  } catch (error) {
    console.error('[AFFILIATE] Register error:', error.message);
    res.status(500).json({ error: 'Failed to register as affiliate' });
  }
});

app.get('/api/affiliates/stats', authenticateToken, async (req, res) => {
  try {
    const userId = req.user.id;
    const affRes = await pool.query(`SELECT * FROM affiliates WHERE user_id = $1`, [userId]);
    if (affRes.rows.length === 0) {
      return res.json({ registered: false });
    }
    const aff = affRes.rows[0];
    const refRes = await pool.query(
      `SELECT COUNT(*) as total, COALESCE(SUM(commission_amount), 0) as earned
       FROM referrals WHERE affiliate_id = $1 AND status = 'paid'`,
      [aff.id]
    );
    const pendingRes = await pool.query(
      `SELECT COUNT(*) as total FROM referrals WHERE affiliate_id = $1 AND status = 'pending'`,
      [aff.id]
    );
    const baseUrl = process.env.FRONTEND_URL || 'https://stocks-intels-frontend-7etg.vercel.app';
    res.json({
      registered: true,
      referral_code: aff.referral_code,
      referral_link: `${baseUrl}/login?ref=${aff.referral_code}`,
      total_earned: parseFloat(aff.total_earned) || 0,
      pending_balance: parseFloat(aff.pending_balance) || 0,
      paid_out: parseFloat(aff.paid_out) || 0,
      total_referrals: parseInt(refRes.rows[0].total) || 0,
      pending_referrals: parseInt(pendingRes.rows[0].total) || 0,
    });
  } catch (error) {
    console.error('[AFFILIATE] Stats error:', error.message);
    res.status(500).json({ error: 'Failed to fetch affiliate stats' });
  }
});

app.get('/api/affiliates/referrals', authenticateToken, async (req, res) => {
  try {
    const userId = req.user.id;
    const affRes = await pool.query(`SELECT id FROM affiliates WHERE user_id = $1`, [userId]);
    if (affRes.rows.length === 0) return res.json([]);
    const refs = await pool.query(
      `SELECT r.id, r.subscription_tier, r.commission_amount, r.status, r.created_at, r.paid_at,
              u.full_name, u.email, u.created_at as user_signed_up
       FROM referrals r JOIN users u ON u.id = r.referred_user_id
       WHERE r.affiliate_id = $1 ORDER BY r.created_at DESC`,
      [affRes.rows[0].id]
    );
    res.json(refs.rows);
  } catch (error) {
    console.error('[AFFILIATE] Referrals error:', error.message);
    res.status(500).json({ error: 'Failed to fetch referrals' });
  }
});

// --- Affiliate Withdrawal ---
app.post('/api/affiliates/withdraw', authenticateToken, async (req, res) => {
  try {
    const userId = req.user.id;
    const { payment_method, payment_details } = req.body;
    if (!payment_method || !payment_details) {
      return res.status(400).json({ error: 'Payment method and details are required' });
    }
    const affRes = await pool.query(`SELECT id, pending_balance FROM affiliates WHERE user_id = $1`, [userId]);
    if (affRes.rows.length === 0) return res.status(400).json({ error: 'Not registered as an affiliate' });
    const aff = affRes.rows[0];
    const balance = parseFloat(aff.pending_balance) || 0;
    if (balance < 0) return res.status(400).json({ error: 'Minimum withdrawal is $1' });
    // Check for existing pending payout
    const pendingPayout = await pool.query(
      `SELECT id FROM affiliate_payouts WHERE affiliate_id = $1 AND status = 'pending'`,
      [aff.id]
    );
    if (pendingPayout.rows.length > 0) {
      return res.status(400).json({ error: 'You already have a pending withdrawal request' });
    }
    await pool.query(
      `INSERT INTO affiliate_payouts (affiliate_id, amount, payment_method, payment_details, status)
       VALUES ($1, $2, $3, $4, 'pending')`,
      [aff.id, balance, payment_method, payment_details]
    );
    await pool.query(
      `UPDATE affiliates SET pending_balance = 0 WHERE id = $1`,
      [aff.id]
    );
    console.log(`[AFFILIATE] Withdrawal requested: affiliate=${aff.id} amount=$${balance}`);
    res.json({ success: true, message: 'Withdrawal request submitted. We will process it shortly.' });
  } catch (error) {
    console.error('[AFFILIATE] Withdraw error:', error.message);
    res.status(500).json({ error: 'Failed to process withdrawal request' });
  }
});

app.get('/api/affiliates/payouts', authenticateToken, async (req, res) => {
  try {
    const userId = req.user.id;
    const affRes = await pool.query(`SELECT id FROM affiliates WHERE user_id = $1`, [userId]);
    if (affRes.rows.length === 0) return res.json([]);
    const payouts = await pool.query(
      `SELECT id, amount, payment_method, payment_details, status, notes, created_at, processed_at
       FROM affiliate_payouts WHERE affiliate_id = $1 ORDER BY created_at DESC`,
      [affRes.rows[0].id]
    );
    res.json(payouts.rows);
  } catch (error) {
    console.error('[AFFILIATE] Payouts error:', error.message);
    res.status(500).json({ error: 'Failed to fetch payouts' });
  }
});

// --- Award commission when a referred user subscribes ---
async function awardCommission(userId, tier) {
  try {
    const userRes = await pool.query(`SELECT referred_by FROM users WHERE id = $1`, [userId]);
    if (!userRes.rows[0]?.referred_by) return;
    const affiliateId = userRes.rows[0].referred_by;
    const rates = { starter: 1.00, premium: 2.00, pro: 5.00, institutional: 20.00 };
    const amount = rates[tier?.toLowerCase()] || 0;
    if (amount <= 0) return;
    await pool.query(
      `INSERT INTO referrals (affiliate_id, referred_user_id, subscription_tier, commission_amount, status)
       VALUES ($1, $2, $3, $4, 'paid')
       ON CONFLICT (referred_user_id) DO UPDATE
         SET status = 'paid', commission_amount = EXCLUDED.commission_amount, paid_at = NOW()`,
      [affiliateId, userId, tier, amount]
    );
    await pool.query(
      `UPDATE affiliates SET total_earned = total_earned + $1, pending_balance = pending_balance + $1 WHERE id = $2`,
      [amount, affiliateId]
    );
    console.log(`[AFFILIATE] Commission $${amount} awarded affiliate ${affiliateId} for user ${userId} (${tier})`);
  } catch (e) {
    console.error('[AFFILIATE] awardCommission error:', e.message);
  }
}

// --- ML Model Routes ---
app.get('/api/ml/info', async (req, res) => {
  res.json(await mlModel.getModelInfo());
});

app.get('/api/ml/circuit-breaker', async (req, res) => {
  res.json({ status: 'modal', details: await mlModel.modalBridge.health() });
});

app.post('/api/ml/train', async (req, res) => {
  try {
    const result = await mlModel.train();
    res.json(result);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

app.post('/api/ml/predict', (req, res) => {
  try {
    const { fundamental, technical, macro } = req.body;
    const prob = mlModel.predictWinProbability(fundamental, technical, macro);
    res.json({ winProbability: prob });
  } catch (e) {
    res.status(400).json({ error: e.message });
  }
});

// --- Order Router / Position Routes ---
app.get('/api/orders/positions', (req, res) => {
  try {
    const positions = getAllPositions();
    const value = getOrderPortfolioValue();
    res.json({ positions, portfolio: value });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

app.post('/api/orders/execute', async (req, res) => {
  try {
    const result = await executeOrder(req.body);
    res.json(result);
  } catch (e) {
    res.status(400).json({ error: e.message });
  }
});

app.post('/api/positions/update', (req, res) => {
  try {
    const { prices } = req.body;
    const totalPnl = updatePositions(prices || {});
    const value = getOrderPortfolioValue();
    res.json({ totalPnl, portfolio: value });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// --- Monitor / Health Routes ---
app.get('/api/monitor/quality', (req, res) => {
  try {
    const health = require('./signalService').getEngineHealth();
    const score = getQualityScore(health);
    res.json({ qualityScore: score, health });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

app.get('/api/monitor/drift', async (req, res) => {
  try {
    const { detectSignalDrift } = require('./monitorService');
    const distribution = await detectSignalDrift();
    res.json({ distribution });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// --- Portfolio Optimization Routes ---
app.post('/api/portfolio/optimize', (req, res) => {
  try {
    const { returns, expectedReturns, riskFreeRate } = req.body;
    const { meanVarianceOptimize, computeCovarianceMatrix } = require('./portfolioOptimizer');
    if (returns) {
      const cov = computeCovarianceMatrix(returns);
      const opt = meanVarianceOptimize(returns, expectedReturns, riskFreeRate || 0.02);
      res.json({ covariance: cov, optimization: opt });
    } else {
      res.status(400).json({ error: 'returns array required' });
    }
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

app.post('/api/portfolio/var', (req, res) => {
  try {
    const { returns, confidence } = req.body;
    if (!returns) return res.status(400).json({ error: 'returns array required' });
    const { monteCarloVaR } = require('./portfolioOptimizer');
    const varResult = monteCarloVaR(returns, 1, 5000);
    res.json(varResult);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// --- Health Check ---
app.get('/api/health', (req, res) => {
  res.json({ status: 'ok', timestamp: new Date().toISOString(), uptime: process.uptime() });
});

// ===================== DATABASE INIT =====================

async function initDatabase() {
  try {
    // Create users first (referenced by watchlist_items and other tables)
    await pool.query(`CREATE TABLE IF NOT EXISTS users (
      id SERIAL PRIMARY KEY, full_name VARCHAR(255) NOT NULL,
      email VARCHAR(255) UNIQUE NOT NULL, password_hash TEXT NOT NULL,
      role VARCHAR(50) DEFAULT 'trader', trader_type VARCHAR(50) DEFAULT 'retail',
      is_verified BOOLEAN DEFAULT false,
      created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
      updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
    );`);

    // Sentiment email opt-in column
    await pool.query(`ALTER TABLE users ADD COLUMN IF NOT EXISTS sentiment_opt_in BOOLEAN DEFAULT false`);
    // Weekly digest opt-out column (default true = opted in)
    await pool.query(`ALTER TABLE users ADD COLUMN IF NOT EXISTS weekly_digest_opt_in BOOLEAN DEFAULT true`);
    await pool.query(`ALTER TABLE users ADD COLUMN IF NOT EXISTS daily_brief_opt_in BOOLEAN DEFAULT true`);
    await pool.query(`ALTER TABLE users ADD COLUMN IF NOT EXISTS earnings_report_opt_in BOOLEAN DEFAULT true`);

    await pool.query(`CREATE TABLE IF NOT EXISTS watchlist_items (
      id SERIAL PRIMARY KEY, symbol VARCHAR(20) NOT NULL,
      company_name VARCHAR(255) NOT NULL, notes TEXT,
      target_price NUMERIC(15,2),
      user_id INTEGER REFERENCES users(id) ON DELETE CASCADE,
      created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
      updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
      UNIQUE(symbol, user_id)
    );`);
    await pool.query(`ALTER TABLE watchlist_items ADD COLUMN IF NOT EXISTS company_name VARCHAR(255) DEFAULT 'Unknown'`);
    await pool.query(`ALTER TABLE watchlist_items ADD COLUMN IF NOT EXISTS target_price NUMERIC(15,2)`);
    await pool.query(`ALTER TABLE watchlist_items ADD COLUMN IF NOT EXISTS notes TEXT`);
    await pool.query(`ALTER TABLE watchlist_items ADD COLUMN IF NOT EXISTS user_id INTEGER REFERENCES users(id) ON DELETE CASCADE`);
    await pool.query(`ALTER TABLE watchlist_items DROP CONSTRAINT IF EXISTS watchlist_items_symbol_key`);
    try {
      await pool.query(`ALTER TABLE watchlist_items ADD CONSTRAINT IF NOT EXISTS unique_symbol_user UNIQUE (symbol, user_id)`);
    } catch (e) {
      // PostgreSQL < 9.5 doesn't support IF NOT EXISTS for ADD CONSTRAINT;
      // the UNIQUE constraint is already defined in CREATE TABLE for new tables.
    }

    await pool.query(`CREATE TABLE IF NOT EXISTS trading_groups (
      id TEXT PRIMARY KEY, name TEXT NOT NULL, description TEXT,
      icon TEXT DEFAULT '📊', topic TEXT DEFAULT 'General', created_by INTEGER REFERENCES users(id)
    );`);
    await pool.query(`ALTER TABLE trading_groups ADD COLUMN IF NOT EXISTS created_by INTEGER REFERENCES users(id)`);

    await pool.query(`CREATE TABLE IF NOT EXISTS group_members (
      group_id TEXT REFERENCES trading_groups(id) ON DELETE CASCADE,
      user_id INTEGER REFERENCES users(id) ON DELETE CASCADE,
      joined_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
      PRIMARY KEY (group_id, user_id)
    );`);

    await pool.query(`CREATE TABLE IF NOT EXISTS messages (
      id SERIAL PRIMARY KEY, sender_id INTEGER REFERENCES users(id),
      sender_name TEXT NOT NULL DEFAULT 'Anonymous', content TEXT NOT NULL,
      message_type TEXT DEFAULT 'user', group_id TEXT REFERENCES trading_groups(id),
      recipient_id INTEGER REFERENCES users(id),
      created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
    );`);
    await pool.query(`ALTER TABLE messages ADD COLUMN IF NOT EXISTS image_url TEXT`);
    await pool.query(`ALTER TABLE messages ADD COLUMN IF NOT EXISTS file_url TEXT`);
    await pool.query(`ALTER TABLE messages ADD COLUMN IF NOT EXISTS file_name TEXT`);
    await pool.query(`ALTER TABLE messages ADD COLUMN IF NOT EXISTS edited_at TIMESTAMP WITH TIME ZONE`);
    await pool.query('CREATE INDEX IF NOT EXISTS idx_messages_group ON messages(group_id, created_at)');
    await pool.query('CREATE INDEX IF NOT EXISTS idx_messages_private ON messages(sender_id, recipient_id, created_at)');

    await pool.query(`CREATE TABLE IF NOT EXISTS followers (
      follower_id INTEGER REFERENCES users(id) ON DELETE CASCADE,
      followee_id INTEGER REFERENCES users(id) ON DELETE CASCADE,
      created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
      PRIMARY KEY (follower_id, followee_id)
    );`);

    const groupCount = await pool.query('SELECT COUNT(*)::int as cnt FROM trading_groups');
    if (groupCount.rows[0].cnt === 0) {
      await pool.query(`INSERT INTO trading_groups (id, name, description, icon, topic) VALUES
        ('nse-traders', 'NSE Traders', 'Connect with NSE market traders', '📊', 'General'),
        ('safaricom', 'Safaricom Bulls', 'Focus on Safaricom stock analysis', '📱', 'Telecom'),
        ('banking', 'Banking Sector', 'Banking stocks analysis', '🏦', 'Finance'),
        ('tech-picks', 'Tech Stock Picks', 'Technology sector stocks', '💻', 'Technology'),
        ('dividend-hunters', 'Dividend Hunters', 'Find high-yield dividend stocks', '💰', 'Income'),
        ('day-traders', 'Day Traders Hub', 'Intraday trading and swing trades', '⚡', 'Trading')
      `);
      await pool.query(`INSERT INTO messages (sender_name, content, message_type, group_id, created_at) VALUES
        ('System', 'Welcome to NSE Traders!', 'system', 'nse-traders', NOW() - INTERVAL '2 hours')
      `);
    }

    await pool.query(`CREATE TABLE IF NOT EXISTS notifications (
      id SERIAL PRIMARY KEY, user_id INTEGER REFERENCES users(id) ON DELETE CASCADE,
      title TEXT NOT NULL, body TEXT NOT NULL, type VARCHAR(50) DEFAULT 'info',
      read BOOLEAN DEFAULT false, link TEXT,
      created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
    );`);

    await pool.query(`CREATE TABLE IF NOT EXISTS portfolio_holdings (
      id SERIAL PRIMARY KEY, user_id INTEGER REFERENCES users(id) ON DELETE CASCADE,
      ticker VARCHAR(20) NOT NULL, name VARCHAR(255) NOT NULL DEFAULT '',
      shares NUMERIC(15,4) NOT NULL DEFAULT 0, avg_cost NUMERIC(15,4) NOT NULL DEFAULT 0,
      current_price NUMERIC(15,4), sector VARCHAR(100) DEFAULT 'Other',
      market VARCHAR(10) DEFAULT 'NSE',
      created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
      updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
    );`);
    await pool.query('ALTER TABLE portfolio_holdings DROP CONSTRAINT IF EXISTS unique_user_ticker');
    // Safe migrations for portfolio_holdings columns
    const holdingsCols = [
      'sector VARCHAR(100) DEFAULT \'Other\'',
      'market VARCHAR(10) DEFAULT \'NSE\'',
      'created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP',
      'updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP',
      'current_price NUMERIC(15,4)',
      'broker_connection_id INTEGER NOT NULL DEFAULT 0',
    ];
    for (const c of holdingsCols) {
      try { await pool.query(`ALTER TABLE portfolio_holdings ADD COLUMN IF NOT EXISTS ${c}`); } catch (e) { /* ignore */ }
    }
    try { await pool.query(`ALTER TABLE portfolio_holdings ADD COLUMN IF NOT EXISTS broker_profit NUMERIC(15,4) DEFAULT 0`); } catch (e) { /* ignore */ }
    try { await pool.query('ALTER TABLE portfolio_holdings ADD CONSTRAINT unique_user_ticker_broker UNIQUE (user_id, ticker, broker_connection_id)'); } catch (e) { /* constraint may already exist */ }

    await pool.query(`CREATE TABLE IF NOT EXISTS broker_connections (
      id SERIAL PRIMARY KEY, user_id INTEGER REFERENCES users(id) ON DELETE CASCADE,
      broker_type VARCHAR(50) NOT NULL, account_name VARCHAR(255) NOT NULL,
      api_key TEXT, api_secret TEXT, config JSONB DEFAULT '{}',
      connected BOOLEAN DEFAULT true,
      sync_status VARCHAR(20) DEFAULT 'idle',
      last_sync_at TIMESTAMP WITH TIME ZONE,
      error_message TEXT,
      created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
    );`);

    // Add missing columns if table already exists
    const columnsToAdd = [
      'api_secret TEXT',
      'config JSONB DEFAULT \'{}\'',
      'sync_status VARCHAR(20) DEFAULT \'idle\'',
      'last_sync_at TIMESTAMP WITH TIME ZONE',
      'error_message TEXT'
    ];
    for (const colDef of columnsToAdd) {
      const colName = colDef.split(' ')[0];
      try {
        await pool.query(`ALTER TABLE broker_connections ADD COLUMN IF NOT EXISTS ${colDef}`);
      } catch (e) {
        // column may already exist
      }
    }

    await pool.query(`CREATE TABLE IF NOT EXISTS broker_account_snapshots (
      id SERIAL PRIMARY KEY, broker_connection_id INTEGER REFERENCES broker_connections(id) ON DELETE CASCADE,
      balance NUMERIC(15,2), equity NUMERIC(15,2), margin NUMERIC(15,2),
      free_margin NUMERIC(15,2), level NUMERIC(15,2),
      positions JSONB DEFAULT '[]', trade_history JSONB DEFAULT '[]',
      snapshot_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
    );`);
    await pool.query(`ALTER TABLE broker_connections ADD COLUMN IF NOT EXISTS account_info JSONB DEFAULT '{}'`);

    await pool.query(`CREATE TABLE IF NOT EXISTS paper_accounts (
      id SERIAL PRIMARY KEY, user_id INTEGER UNIQUE REFERENCES users(id) ON DELETE CASCADE,
      cash_balance NUMERIC(15,2) DEFAULT 1000000.00,
      initial_capital NUMERIC(15,2) DEFAULT 1000000.00,
      cash_balance_usd NUMERIC(15,2) DEFAULT 10000.00,
      initial_capital_usd NUMERIC(15,2) DEFAULT 10000.00,
      total_fees_paid NUMERIC(15,2) DEFAULT 0,
      total_fees_paid_usd NUMERIC(15,2) DEFAULT 0,
      created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
      updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
    );`);

    await pool.query(`CREATE TABLE IF NOT EXISTS paper_positions (
      id SERIAL PRIMARY KEY, user_id INTEGER REFERENCES users(id) ON DELETE CASCADE,
      ticker VARCHAR(20) NOT NULL, name VARCHAR(255) NOT NULL DEFAULT '',
      shares NUMERIC(15,4) NOT NULL DEFAULT 0, avg_cost NUMERIC(15,4) NOT NULL DEFAULT 0,
      market VARCHAR(10) DEFAULT 'NSE', sector VARCHAR(100) DEFAULT 'Other',
      created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
    );`);

    await pool.query(`CREATE TABLE IF NOT EXISTS paper_trades (
      id SERIAL PRIMARY KEY, user_id INTEGER REFERENCES users(id) ON DELETE CASCADE,
      ticker VARCHAR(20) NOT NULL, name VARCHAR(255) NOT NULL DEFAULT '',
      shares NUMERIC(15,4) NOT NULL DEFAULT 0, price NUMERIC(15,4) NOT NULL DEFAULT 0,
      type VARCHAR(10) NOT NULL CHECK (type IN ('buy', 'sell')),
      market VARCHAR(10) DEFAULT 'NSE', sector VARCHAR(100) DEFAULT 'Other',
      currency VARCHAR(3) DEFAULT 'KES', total_value NUMERIC(15,2) NOT NULL DEFAULT 0,
      commission NUMERIC(15,2) DEFAULT 0, fees NUMERIC(15,2) DEFAULT 0,
      created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
    );`);

    await pool.query(`CREATE TABLE IF NOT EXISTS otp_codes (
      id SERIAL PRIMARY KEY, email VARCHAR(255) NOT NULL,
      code VARCHAR(6) NOT NULL, type VARCHAR(20) NOT NULL DEFAULT 'login',
      expires_at TIMESTAMP NOT NULL, used BOOLEAN DEFAULT FALSE,
      created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
    );`);

    await pool.query(`CREATE TABLE IF NOT EXISTS support_tickets (
      id SERIAL PRIMARY KEY, email VARCHAR(255) NOT NULL,
      subject VARCHAR(255) NOT NULL, category VARCHAR(50) NOT NULL DEFAULT 'general',
      priority VARCHAR(20) NOT NULL DEFAULT 'normal',
      status VARCHAR(20) NOT NULL DEFAULT 'open',
      created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
      updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
    );`);
    await pool.query(`CREATE TABLE IF NOT EXISTS support_messages (
      id SERIAL PRIMARY KEY, ticket_id INT NOT NULL REFERENCES support_tickets(id) ON DELETE CASCADE,
      sender VARCHAR(255) NOT NULL, message TEXT NOT NULL,
      is_staff BOOLEAN DEFAULT FALSE,
      created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
    );`);

    await pool.query(`CREATE TABLE IF NOT EXISTS support_chat_messages (
      id SERIAL PRIMARY KEY, user_id INT REFERENCES users(id) ON DELETE SET NULL,
      user_name VARCHAR(255) NOT NULL, email VARCHAR(255) NOT NULL,
      message TEXT NOT NULL, is_staff BOOLEAN DEFAULT FALSE,
      created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
    );`);

    await pool.query(`CREATE TABLE IF NOT EXISTS portfolio_value_history (
      id SERIAL PRIMARY KEY, user_id INTEGER REFERENCES users(id) ON DELETE CASCADE,
      total_value NUMERIC(15,2) NOT NULL, cash_balance NUMERIC(15,2) NOT NULL,
      invested_value NUMERIC(15,2) NOT NULL, market VARCHAR(10) DEFAULT 'combined',
      snapshot_date TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
    );`);
    // Safe migration: add snapshot_date if missing (pre-existing table)
    try { await pool.query(`ALTER TABLE portfolio_value_history ADD COLUMN IF NOT EXISTS snapshot_date TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP`); } catch(e) {}

    await pool.query(`CREATE TABLE IF NOT EXISTS stocks (
      id SERIAL PRIMARY KEY,
      ticker VARCHAR(20) NOT NULL UNIQUE,
      name VARCHAR(255) NOT NULL DEFAULT '',
      sector VARCHAR(100) DEFAULT 'Other',
      market VARCHAR(10) NOT NULL DEFAULT 'NSE',
      currency VARCHAR(3) DEFAULT 'KES',
      is_active BOOLEAN DEFAULT true,
      created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
    );`);

    // Admin audit log for security tracking
    await pool.query(`CREATE TABLE IF NOT EXISTS admin_audit_log (
      id SERIAL PRIMARY KEY,
      admin_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
      email VARCHAR(255),
      action VARCHAR(100) NOT NULL,
      ip_address VARCHAR(45),
      user_agent TEXT,
      details JSONB,
      success BOOLEAN DEFAULT true,
      created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
    );`);
    try { await pool.query(`CREATE INDEX IF NOT EXISTS idx_admin_audit_log_admin_id ON admin_audit_log(admin_id)`); } catch(e) {}
    try { await pool.query(`CREATE INDEX IF NOT EXISTS idx_admin_audit_log_action ON admin_audit_log(action)`); } catch(e) {}
    try { await pool.query(`CREATE INDEX IF NOT EXISTS idx_admin_audit_log_created_at ON admin_audit_log(created_at)`); } catch(e) {}

    await pool.query(`CREATE TABLE IF NOT EXISTS user_activity_log (
      id SERIAL PRIMARY KEY,
      user_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
      email VARCHAR(255),
      full_name VARCHAR(255),
      action VARCHAR(50) NOT NULL,
      details JSONB,
      ip_address VARCHAR(45),
      created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
    );`);
    try { await pool.query(`CREATE INDEX IF NOT EXISTS idx_user_activity_created_at ON user_activity_log(created_at DESC)`); } catch(e) {}
    try { await pool.query(`CREATE INDEX IF NOT EXISTS idx_user_activity_user_id ON user_activity_log(user_id)`); } catch(e) {}
    try { await pool.query(`CREATE INDEX IF NOT EXISTS idx_user_activity_action ON user_activity_log(action)`); } catch(e) {}

    // Seed stocks (only if table is empty)
    const stockCount = await pool.query('SELECT COUNT(*) FROM stocks');
    if (parseInt(stockCount.rows[0].count) === 0) {
      const allSeeds = [
        // ===== NSE STOCKS =====
        { ticker: 'SCOM', name: 'Safaricom PLC', sector: 'Telecommunications', market: 'NSE', currency: 'KES' },
        { ticker: 'EQTY', name: 'Equity Group Holdings PLC', sector: 'Banking', market: 'NSE', currency: 'KES' },
        { ticker: 'KCB', name: 'KCB Group PLC', sector: 'Banking', market: 'NSE', currency: 'KES' },
        { ticker: 'COOP', name: 'Co-operative Bank of Kenya Ltd', sector: 'Banking', market: 'NSE', currency: 'KES' },
        { ticker: 'ABSA', name: 'Absa Bank Kenya PLC', sector: 'Banking', market: 'NSE', currency: 'KES' },
        { ticker: 'SBIC', name: 'Stanbic Holdings PLC', sector: 'Banking', market: 'NSE', currency: 'KES' },
        { ticker: 'NCBA', name: 'NCBA Group PLC', sector: 'Banking', market: 'NSE', currency: 'KES' },
        { ticker: 'IMH', name: 'I&M Group PLC', sector: 'Banking', market: 'NSE', currency: 'KES' },
        { ticker: 'DTK', name: 'Diamond Trust Bank Kenya Ltd', sector: 'Banking', market: 'NSE', currency: 'KES' },
        { ticker: 'SCBK', name: 'Standard Chartered Bank Kenya Ltd', sector: 'Banking', market: 'NSE', currency: 'KES' },
        { ticker: 'BKG', name: 'BK Group PLC', sector: 'Banking', market: 'NSE', currency: 'KES' },
        { ticker: 'HFCK', name: 'HF Group PLC', sector: 'Banking', market: 'NSE', currency: 'KES' },
        { ticker: 'EABL', name: 'East African Breweries PLC', sector: 'Manufacturing', market: 'NSE', currency: 'KES' },
        { ticker: 'BAT', name: 'British American Tobacco Kenya PLC', sector: 'Manufacturing', market: 'NSE', currency: 'KES' },
        { ticker: 'BOC', name: 'B.O.C Kenya Ltd', sector: 'Manufacturing', market: 'NSE', currency: 'KES' },
        { ticker: 'CARB', name: 'Carbacid Investments Ltd', sector: 'Manufacturing', market: 'NSE', currency: 'KES' },
        { ticker: 'UNGA', name: 'Unga Group PLC', sector: 'Manufacturing', market: 'NSE', currency: 'KES' },
        { ticker: 'MSC', name: 'Mumias Sugar Co. Ltd', sector: 'Manufacturing', market: 'NSE', currency: 'KES' },
        { ticker: 'FTGH', name: 'Flame Tree Group Holdings Ltd', sector: 'Manufacturing', market: 'NSE', currency: 'KES' },
        { ticker: 'EVRD', name: 'Eveready East Africa PLC', sector: 'Manufacturing', market: 'NSE', currency: 'KES' },
        { ticker: 'KUKZ', name: 'Kakuzi PLC', sector: 'Agricultural', market: 'NSE', currency: 'KES' },
        { ticker: 'KAPC', name: 'Kapchorua Tea Kenya PLC', sector: 'Agricultural', market: 'NSE', currency: 'KES' },
        { ticker: 'LIMT', name: 'Limuru Tea PLC', sector: 'Agricultural', market: 'NSE', currency: 'KES' },
        { ticker: 'WTK', name: 'Williamson Tea Kenya PLC', sector: 'Agricultural', market: 'NSE', currency: 'KES' },
        { ticker: 'SASN', name: 'Sasini PLC', sector: 'Agricultural', market: 'NSE', currency: 'KES' },
        { ticker: 'REA', name: 'Rea Vipingo Plantations Ltd', sector: 'Agricultural', market: 'NSE', currency: 'KES' },
        { ticker: 'EGAD', name: 'Eaagads Ltd', sector: 'Agricultural', market: 'NSE', currency: 'KES' },
        { ticker: 'KPLC', name: 'Kenya Power & Lighting Co PLC', sector: 'Energy', market: 'NSE', currency: 'KES' },
        { ticker: 'KEGN', name: 'KenGen Co. PLC', sector: 'Energy', market: 'NSE', currency: 'KES' },
        { ticker: 'TOTL', name: 'TotalEnergies Marketing Kenya PLC', sector: 'Energy', market: 'NSE', currency: 'KES' },
        { ticker: 'UMME', name: 'Umeme Ltd', sector: 'Energy', market: 'NSE', currency: 'KES' },
        { ticker: 'NMG', name: 'Nation Media Group PLC', sector: 'Media', market: 'NSE', currency: 'KES' },
        { ticker: 'SGL', name: 'Standard Group PLC', sector: 'Media', market: 'NSE', currency: 'KES' },
        { ticker: 'SCAN', name: 'WPP Scangroup Ltd', sector: 'Media', market: 'NSE', currency: 'KES' },
        { ticker: 'TPSE', name: 'TPS Eastern Africa Ltd', sector: 'Hospitality', market: 'NSE', currency: 'KES' },
        { ticker: 'KQ', name: 'Kenya Airways PLC', sector: 'Transportation', market: 'NSE', currency: 'KES' },
        { ticker: 'XPRS', name: 'Express Kenya Ltd', sector: 'Commercial Services', market: 'NSE', currency: 'KES' },
        { ticker: 'SMER', name: 'Sameer Africa PLC', sector: 'Commercial Services', market: 'NSE', currency: 'KES' },
        { ticker: 'NBV', name: 'Nairobi Business Ventures Ltd', sector: 'Commercial Services', market: 'NSE', currency: 'KES' },
        { ticker: 'BAMB', name: 'Bamburi Cement PLC', sector: 'Construction', market: 'NSE', currency: 'KES' },
        { ticker: 'PORT', name: 'E.A. Portland Cement Co. Ltd', sector: 'Construction', market: 'NSE', currency: 'KES' },
        { ticker: 'CRWN', name: 'Crown Paints Kenya PLC', sector: 'Construction', market: 'NSE', currency: 'KES' },
        { ticker: 'ARM', name: 'ARM Cement PLC', sector: 'Construction', market: 'NSE', currency: 'KES' },
        { ticker: 'CGEN', name: 'Car & General (Kenya) PLC', sector: 'Automobiles', market: 'NSE', currency: 'KES' },
        { ticker: 'JUB', name: 'Jubilee Holdings Ltd', sector: 'Insurance', market: 'NSE', currency: 'KES' },
        { ticker: 'KNRE', name: 'Kenya Re-Insurance Corp Ltd', sector: 'Insurance', market: 'NSE', currency: 'KES' },
        { ticker: 'CIC', name: 'CIC Insurance Group PLC', sector: 'Insurance', market: 'NSE', currency: 'KES' },
        { ticker: 'BRIT', name: 'Britam Holdings PLC', sector: 'Insurance', market: 'NSE', currency: 'KES' },
        { ticker: 'LBTY', name: 'Liberty Kenya Holdings Ltd', sector: 'Insurance', market: 'NSE', currency: 'KES' },
        { ticker: 'SLAM', name: 'Sanlam Kenya PLC', sector: 'Insurance', market: 'NSE', currency: 'KES' },
        { ticker: 'CTUM', name: 'Centum Investment Company PLC', sector: 'Investment', market: 'NSE', currency: 'KES' },
        { ticker: 'OCH', name: 'Olympia Capital Holdings Ltd', sector: 'Investment', market: 'NSE', currency: 'KES' },
        { ticker: 'HAFR', name: 'Home Afrika Ltd', sector: 'Investment', market: 'NSE', currency: 'KES' },
        { ticker: 'NSE', name: 'Nairobi Securities Exchange PLC', sector: 'Investment Services', market: 'NSE', currency: 'KES' },
        { ticker: 'LKL', name: 'Longhorn Publishers Ltd', sector: 'Media', market: 'NSE', currency: 'KES' },
        { ticker: 'UCHM', name: 'Uchumi Supermarkets PLC', sector: 'Commercial Services', market: 'NSE', currency: 'KES' },
        { ticker: 'AMAC', name: 'Africa Mega Agricorp PLC', sector: 'Manufacturing', market: 'NSE', currency: 'KES' },
        // ===== S&P 500 + NASDAQ GLOBAL STOCKS =====
        // Technology
        { ticker: 'AAPL', name: 'Apple Inc.', sector: 'Technology Hardware', market: 'Global', currency: 'USD' },
        { ticker: 'MSFT', name: 'Microsoft Corp.', sector: 'Software', market: 'Global', currency: 'USD' },
        { ticker: 'NVDA', name: 'NVIDIA Corp.', sector: 'Semiconductors', market: 'Global', currency: 'USD' },
        { ticker: 'GOOGL', name: 'Alphabet Inc.', sector: 'Internet Services', market: 'Global', currency: 'USD' },
        { ticker: 'AMZN', name: 'Amazon.com Inc.', sector: 'Internet Retail', market: 'Global', currency: 'USD' },
        { ticker: 'META', name: 'Meta Platforms Inc.', sector: 'Internet Services', market: 'Global', currency: 'USD' },
        { ticker: 'TSLA', name: 'Tesla Inc.', sector: 'Automobiles', market: 'Global', currency: 'USD' },
        { ticker: 'AVGO', name: 'Broadcom Inc.', sector: 'Semiconductors', market: 'Global', currency: 'USD' },
        { ticker: 'ORCL', name: 'Oracle Corp.', sector: 'Software', market: 'Global', currency: 'USD' },
        { ticker: 'AMD', name: 'Advanced Micro Devices', sector: 'Semiconductors', market: 'Global', currency: 'USD' },
        { ticker: 'CRM', name: 'Salesforce Inc.', sector: 'Software', market: 'Global', currency: 'USD' },
        { ticker: 'ADBE', name: 'Adobe Inc.', sector: 'Software', market: 'Global', currency: 'USD' },
        { ticker: 'INTC', name: 'Intel Corp.', sector: 'Semiconductors', market: 'Global', currency: 'USD' },
        { ticker: 'CSCO', name: 'Cisco Systems Inc.', sector: 'Technology', market: 'Global', currency: 'USD' },
        { ticker: 'IBM', name: 'International Business Machines', sector: 'Technology', market: 'Global', currency: 'USD' },
        { ticker: 'TXN', name: 'Texas Instruments Inc.', sector: 'Semiconductors', market: 'Global', currency: 'USD' },
        { ticker: 'QCOM', name: 'Qualcomm Inc.', sector: 'Semiconductors', market: 'Global', currency: 'USD' },
        { ticker: 'MU', name: 'Micron Technology Inc.', sector: 'Semiconductors', market: 'Global', currency: 'USD' },
        { ticker: 'AMAT', name: 'Applied Materials Inc.', sector: 'Semiconductors', market: 'Global', currency: 'USD' },
        { ticker: 'NOW', name: 'ServiceNow Inc.', sector: 'Software', market: 'Global', currency: 'USD' },
        { ticker: 'NFLX', name: 'Netflix Inc.', sector: 'Streaming Media', market: 'Global', currency: 'USD' },
        { ticker: 'ADP', name: 'Automatic Data Processing', sector: 'Software', market: 'Global', currency: 'USD' },
        { ticker: 'ACN', name: 'Accenture PLC', sector: 'Software', market: 'Global', currency: 'USD' },
        { ticker: 'UBER', name: 'Uber Technologies Inc.', sector: 'Technology', market: 'Global', currency: 'USD' },
        { ticker: 'ABNB', name: 'Airbnb Inc.', sector: 'Technology', market: 'Global', currency: 'USD' },
        { ticker: 'SPOT', name: 'Spotify Technology SA', sector: 'Technology', market: 'Global', currency: 'USD' },
        { ticker: 'PLTR', name: 'Palantir Technologies Inc.', sector: 'Software', market: 'Global', currency: 'USD' },
        { ticker: 'SNOW', name: 'Snowflake Inc.', sector: 'Software', market: 'Global', currency: 'USD' },
        { ticker: 'DDOG', name: 'Datadog Inc.', sector: 'Software', market: 'Global', currency: 'USD' },
        { ticker: 'CRWD', name: 'CrowdStrike Holdings Inc.', sector: 'Software', market: 'Global', currency: 'USD' },
        { ticker: 'PANW', name: 'Palo Alto Networks Inc.', sector: 'Software', market: 'Global', currency: 'USD' },
        { ticker: 'FTNT', name: 'Fortinet Inc.', sector: 'Software', market: 'Global', currency: 'USD' },
        { ticker: 'NET', name: 'Cloudflare Inc.', sector: 'Software', market: 'Global', currency: 'USD' },
        { ticker: 'MDB', name: 'MongoDB Inc.', sector: 'Software', market: 'Global', currency: 'USD' },
        { ticker: 'WDAY', name: 'Workday Inc.', sector: 'Software', market: 'Global', currency: 'USD' },
        { ticker: 'ZS', name: 'Zscaler Inc.', sector: 'Software', market: 'Global', currency: 'USD' },
        { ticker: 'DASH', name: 'DoorDash Inc.', sector: 'Technology', market: 'Global', currency: 'USD' },
        { ticker: 'SNAP', name: 'Snap Inc.', sector: 'Technology', market: 'Global', currency: 'USD' },
        { ticker: 'PINS', name: 'Pinterest Inc.', sector: 'Technology', market: 'Global', currency: 'USD' },
        { ticker: 'RBLX', name: 'Roblox Corp.', sector: 'Technology', market: 'Global', currency: 'USD' },
        { ticker: 'ZM', name: 'Zoom Video Communications', sector: 'Technology', market: 'Global', currency: 'USD' },
        { ticker: 'DOCU', name: 'DocuSign Inc.', sector: 'Software', market: 'Global', currency: 'USD' },
        { ticker: 'TWLO', name: 'Twilio Inc.', sector: 'Software', market: 'Global', currency: 'USD' },
        { ticker: 'EA', name: 'Electronic Arts Inc.', sector: 'Technology', market: 'Global', currency: 'USD' },
        { ticker: 'TTWO', name: 'Take-Two Interactive', sector: 'Technology', market: 'Global', currency: 'USD' },
        { ticker: 'ANSS', name: 'ANSYS Inc.', sector: 'Software', market: 'Global', currency: 'USD' },
        { ticker: 'CDNS', name: 'Cadence Design Systems', sector: 'Software', market: 'Global', currency: 'USD' },
        { ticker: 'SNPS', name: 'Synopsys Inc.', sector: 'Software', market: 'Global', currency: 'USD' },
        { ticker: 'ADI', name: 'Analog Devices Inc.', sector: 'Semiconductors', market: 'Global', currency: 'USD' },
        { ticker: 'NXPI', name: 'NXP Semiconductors NV', sector: 'Semiconductors', market: 'Global', currency: 'USD' },
        { ticker: 'KLAC', name: 'KLA Corp.', sector: 'Semiconductors', market: 'Global', currency: 'USD' },
        { ticker: 'LRCX', name: 'Lam Research Corp.', sector: 'Semiconductors', market: 'Global', currency: 'USD' },
        { ticker: 'MCHP', name: 'Microchip Technology Inc.', sector: 'Semiconductors', market: 'Global', currency: 'USD' },
        { ticker: 'ON', name: 'ON Semiconductor Corp.', sector: 'Semiconductors', market: 'Global', currency: 'USD' },
        { ticker: 'MPWR', name: 'Monolithic Power Systems', sector: 'Semiconductors', market: 'Global', currency: 'USD' },
        { ticker: 'APH', name: 'Amphenol Corp.', sector: 'Technology', market: 'Global', currency: 'USD' },
        { ticker: 'GLW', name: 'Corning Inc.', sector: 'Technology', market: 'Global', currency: 'USD' },
        { ticker: 'TEL', name: 'TE Connectivity Ltd', sector: 'Technology', market: 'Global', currency: 'USD' },
        { ticker: 'STX', name: 'Seagate Technology', sector: 'Technology', market: 'Global', currency: 'USD' },
        { ticker: 'WDC', name: 'Western Digital Corp.', sector: 'Technology', market: 'Global', currency: 'USD' },
        { ticker: 'ENTG', name: 'Entegris Inc.', sector: 'Semiconductors', market: 'Global', currency: 'USD' },
        { ticker: 'TER', name: 'Teradyne Inc.', sector: 'Semiconductors', market: 'Global', currency: 'USD' },
        { ticker: 'PTC', name: 'PTC Inc.', sector: 'Software', market: 'Global', currency: 'USD' },
        // Healthcare
        { ticker: 'LLY', name: 'Eli Lilly & Co.', sector: 'Healthcare', market: 'Global', currency: 'USD' },
        { ticker: 'UNH', name: 'UnitedHealth Group Inc.', sector: 'Healthcare', market: 'Global', currency: 'USD' },
        { ticker: 'JNJ', name: 'Johnson & Johnson', sector: 'Healthcare', market: 'Global', currency: 'USD' },
        { ticker: 'MRK', name: 'Merck & Co. Inc.', sector: 'Healthcare', market: 'Global', currency: 'USD' },
        { ticker: 'ABBV', name: 'AbbVie Inc.', sector: 'Healthcare', market: 'Global', currency: 'USD' },
        { ticker: 'TMO', name: 'Thermo Fisher Scientific', sector: 'Healthcare', market: 'Global', currency: 'USD' },
        { ticker: 'PFE', name: 'Pfizer Inc.', sector: 'Healthcare', market: 'Global', currency: 'USD' },
        { ticker: 'ABT', name: 'Abbott Laboratories', sector: 'Healthcare', market: 'Global', currency: 'USD' },
        { ticker: 'DHR', name: 'Danaher Corp.', sector: 'Healthcare', market: 'Global', currency: 'USD' },
        { ticker: 'AMGN', name: 'Amgen Inc.', sector: 'Healthcare', market: 'Global', currency: 'USD' },
        { ticker: 'MDT', name: 'Medtronic PLC', sector: 'Healthcare', market: 'Global', currency: 'USD' },
        { ticker: 'SYK', name: 'Stryker Corp.', sector: 'Healthcare', market: 'Global', currency: 'USD' },
        { ticker: 'BSX', name: 'Boston Scientific Corp.', sector: 'Healthcare', market: 'Global', currency: 'USD' },
        { ticker: 'ISRG', name: 'Intuitive Surgical Inc.', sector: 'Healthcare', market: 'Global', currency: 'USD' },
        { ticker: 'VRTX', name: 'Vertex Pharmaceuticals', sector: 'Healthcare', market: 'Global', currency: 'USD' },
        { ticker: 'REGN', name: 'Regeneron Pharmaceuticals', sector: 'Healthcare', market: 'Global', currency: 'USD' },
        { ticker: 'GILD', name: 'Gilead Sciences Inc.', sector: 'Healthcare', market: 'Global', currency: 'USD' },
        { ticker: 'ZTS', name: 'Zoetis Inc.', sector: 'Healthcare', market: 'Global', currency: 'USD' },
        { ticker: 'CI', name: 'Cigna Group', sector: 'Healthcare', market: 'Global', currency: 'USD' },
        { ticker: 'ELV', name: 'Elevance Health Inc.', sector: 'Healthcare', market: 'Global', currency: 'USD' },
        { ticker: 'HCA', name: 'HCA Healthcare Inc.', sector: 'Healthcare', market: 'Global', currency: 'USD' },
        { ticker: 'MCK', name: 'McKesson Corp.', sector: 'Healthcare', market: 'Global', currency: 'USD' },
        { ticker: 'BDX', name: 'Becton Dickinson & Co.', sector: 'Healthcare', market: 'Global', currency: 'USD' },
        { ticker: 'EW', name: 'Edwards Lifesciences', sector: 'Healthcare', market: 'Global', currency: 'USD' },
        { ticker: 'DXCM', name: 'DexCom Inc.', sector: 'Healthcare', market: 'Global', currency: 'USD' },
        { ticker: 'IDXX', name: 'IDEXX Laboratories Inc.', sector: 'Healthcare', market: 'Global', currency: 'USD' },
        { ticker: 'ALGN', name: 'Align Technology Inc.', sector: 'Healthcare', market: 'Global', currency: 'USD' },
        { ticker: 'WST', name: 'West Pharmaceutical Services', sector: 'Healthcare', market: 'Global', currency: 'USD' },
        { ticker: 'BIIB', name: 'Biogen Inc.', sector: 'Healthcare', market: 'Global', currency: 'USD' },
        { ticker: 'MRNA', name: 'Moderna Inc.', sector: 'Healthcare', market: 'Global', currency: 'USD' },
        // Financial
        { ticker: 'JPM', name: 'JPMorgan Chase & Co.', sector: 'Banking', market: 'Global', currency: 'USD' },
        { ticker: 'V', name: 'Visa Inc.', sector: 'Payments', market: 'Global', currency: 'USD' },
        { ticker: 'BAC', name: 'Bank of America Corp.', sector: 'Banking', market: 'Global', currency: 'USD' },
        { ticker: 'WFC', name: 'Wells Fargo & Co.', sector: 'Banking', market: 'Global', currency: 'USD' },
        { ticker: 'GS', name: 'Goldman Sachs Group Inc.', sector: 'Banking', market: 'Global', currency: 'USD' },
        { ticker: 'MS', name: 'Morgan Stanley', sector: 'Banking', market: 'Global', currency: 'USD' },
        { ticker: 'C', name: 'Citigroup Inc.', sector: 'Banking', market: 'Global', currency: 'USD' },
        { ticker: 'BLK', name: 'BlackRock Inc.', sector: 'Financial', market: 'Global', currency: 'USD' },
        { ticker: 'SCHW', name: 'Charles Schwab Corp.', sector: 'Financial', market: 'Global', currency: 'USD' },
        { ticker: 'AXP', name: 'American Express Co.', sector: 'Financial', market: 'Global', currency: 'USD' },
        { ticker: 'USB', name: 'U.S. Bancorp', sector: 'Banking', market: 'Global', currency: 'USD' },
        { ticker: 'PNC', name: 'PNC Financial Services', sector: 'Banking', market: 'Global', currency: 'USD' },
        { ticker: 'TFC', name: 'Truist Financial Corp.', sector: 'Banking', market: 'Global', currency: 'USD' },
        { ticker: 'BK', name: 'Bank of New York Mellon', sector: 'Banking', market: 'Global', currency: 'USD' },
        { ticker: 'MCO', name: "Moody's Corp.", sector: 'Financial', market: 'Global', currency: 'USD' },
        { ticker: 'SPGI', name: 'S&P Global Inc.', sector: 'Financial', market: 'Global', currency: 'USD' },
        { ticker: 'MSCI', name: 'MSCI Inc.', sector: 'Financial', market: 'Global', currency: 'USD' },
        { ticker: 'ICE', name: 'Intercontinental Exchange', sector: 'Financial', market: 'Global', currency: 'USD' },
        { ticker: 'CME', name: 'CME Group Inc.', sector: 'Financial', market: 'Global', currency: 'USD' },
        { ticker: 'PYPL', name: 'PayPal Holdings Inc.', sector: 'Financial', market: 'Global', currency: 'USD' },
        { ticker: 'SQ', name: 'Block Inc.', sector: 'Financial', market: 'Global', currency: 'USD' },
        { ticker: 'COIN', name: 'Coinbase Global Inc.', sector: 'Financial', market: 'Global', currency: 'USD' },
        { ticker: 'HOOD', name: 'Robinhood Markets Inc.', sector: 'Financial', market: 'Global', currency: 'USD' },
        { ticker: 'SOFI', name: 'SoFi Technologies Inc.', sector: 'Financial', market: 'Global', currency: 'USD' },
        { ticker: 'AFRM', name: 'Affirm Holdings Inc.', sector: 'Financial', market: 'Global', currency: 'USD' },
        { ticker: 'PGR', name: 'Progressive Corp.', sector: 'Insurance', market: 'Global', currency: 'USD' },
        { ticker: 'ALL', name: 'Allstate Corp.', sector: 'Insurance', market: 'Global', currency: 'USD' },
        { ticker: 'MET', name: 'MetLife Inc.', sector: 'Insurance', market: 'Global', currency: 'USD' },
        { ticker: 'PRU', name: 'Prudential Financial Inc.', sector: 'Insurance', market: 'Global', currency: 'USD' },
        { ticker: 'AFL', name: 'Aflac Inc.', sector: 'Insurance', market: 'Global', currency: 'USD' },
        { ticker: 'TRV', name: 'Travelers Companies Inc.', sector: 'Insurance', market: 'Global', currency: 'USD' },
        { ticker: 'CB', name: 'Chubb Ltd', sector: 'Insurance', market: 'Global', currency: 'USD' },
        { ticker: 'AIG', name: 'American International Group', sector: 'Insurance', market: 'Global', currency: 'USD' },
        { ticker: 'FIS', name: 'Fidelity National Info Services', sector: 'Financial', market: 'Global', currency: 'USD' },
        { ticker: 'FI', name: 'Fiserv Inc.', sector: 'Financial', market: 'Global', currency: 'USD' },
        { ticker: 'GPN', name: 'Global Payments Inc.', sector: 'Financial', market: 'Global', currency: 'USD' },
        { ticker: 'NDAQ', name: 'Nasdaq Inc.', sector: 'Financial', market: 'Global', currency: 'USD' },
        // Consumer
        { ticker: 'WMT', name: 'Walmart Inc.', sector: 'Consumer', market: 'Global', currency: 'USD' },
        { ticker: 'PG', name: 'Procter & Gamble Co.', sector: 'Consumer', market: 'Global', currency: 'USD' },
        { ticker: 'KO', name: 'Coca-Cola Co.', sector: 'Consumer', market: 'Global', currency: 'USD' },
        { ticker: 'PEP', name: 'PepsiCo Inc.', sector: 'Consumer', market: 'Global', currency: 'USD' },
        { ticker: 'COST', name: 'Costco Wholesale Corp.', sector: 'Consumer', market: 'Global', currency: 'USD' },
        { ticker: 'HD', name: 'Home Depot Inc.', sector: 'Consumer', market: 'Global', currency: 'USD' },
        { ticker: 'MCD', name: "McDonald's Corp.", sector: 'Consumer', market: 'Global', currency: 'USD' },
        { ticker: 'NKE', name: 'Nike Inc.', sector: 'Consumer', market: 'Global', currency: 'USD' },
        { ticker: 'SBUX', name: 'Starbucks Corp.', sector: 'Consumer', market: 'Global', currency: 'USD' },
        { ticker: 'LOW', name: "Lowe's Companies Inc.", sector: 'Consumer', market: 'Global', currency: 'USD' },
        { ticker: 'TGT', name: 'Target Corp.', sector: 'Consumer', market: 'Global', currency: 'USD' },
        { ticker: 'TJX', name: 'TJX Companies Inc.', sector: 'Consumer', market: 'Global', currency: 'USD' },
        { ticker: 'CVS', name: 'CVS Health Corp.', sector: 'Consumer', market: 'Global', currency: 'USD' },
        { ticker: 'EL', name: 'Estee Lauder Companies Inc.', sector: 'Consumer', market: 'Global', currency: 'USD' },
        { ticker: 'CL', name: 'Colgate-Palmolive Co.', sector: 'Consumer', market: 'Global', currency: 'USD' },
        { ticker: 'KMB', name: 'Kimberly-Clark Corp.', sector: 'Consumer', market: 'Global', currency: 'USD' },
        { ticker: 'MDLZ', name: 'Mondelez International Inc.', sector: 'Consumer', market: 'Global', currency: 'USD' },
        { ticker: 'CMG', name: 'Chipotle Mexican Grill Inc.', sector: 'Consumer', market: 'Global', currency: 'USD' },
        { ticker: 'LULU', name: 'Lululemon Athletica Inc.', sector: 'Consumer', market: 'Global', currency: 'USD' },
        { ticker: 'ROST', name: 'Ross Stores Inc.', sector: 'Consumer', market: 'Global', currency: 'USD' },
        { ticker: 'DG', name: 'Dollar General Corp.', sector: 'Consumer', market: 'Global', currency: 'USD' },
        { ticker: 'DLTR', name: 'Dollar Tree Inc.', sector: 'Consumer', market: 'Global', currency: 'USD' },
        { ticker: 'BBY', name: 'Best Buy Co. Inc.', sector: 'Consumer', market: 'Global', currency: 'USD' },
        { ticker: 'KR', name: 'Kroger Co.', sector: 'Consumer', market: 'Global', currency: 'USD' },
        { ticker: 'SYY', name: 'Sysco Corp.', sector: 'Consumer', market: 'Global', currency: 'USD' },
        { ticker: 'GIS', name: 'General Mills Inc.', sector: 'Consumer', market: 'Global', currency: 'USD' },
        { ticker: 'K', name: 'Kellanova', sector: 'Consumer', market: 'Global', currency: 'USD' },
        { ticker: 'HSY', name: 'Hershey Co.', sector: 'Consumer', market: 'Global', currency: 'USD' },
        { ticker: 'STZ', name: 'Constellation Brands Inc.', sector: 'Consumer', market: 'Global', currency: 'USD' },
        { ticker: 'MNST', name: 'Monster Beverage Corp.', sector: 'Consumer', market: 'Global', currency: 'USD' },
        { ticker: 'KHC', name: 'Kraft Heinz Co.', sector: 'Consumer', market: 'Global', currency: 'USD' },
        { ticker: 'CHD', name: 'Church & Dwight Co.', sector: 'Consumer', market: 'Global', currency: 'USD' },
        { ticker: 'CLX', name: 'Clorox Co.', sector: 'Consumer', market: 'Global', currency: 'USD' },
        { ticker: 'MAR', name: 'Marriott International Inc.', sector: 'Consumer', market: 'Global', currency: 'USD' },
        { ticker: 'HLT', name: 'Hilton Worldwide Holdings', sector: 'Consumer', market: 'Global', currency: 'USD' },
        { ticker: 'MGM', name: 'MGM Resorts International', sector: 'Consumer', market: 'Global', currency: 'USD' },
        { ticker: 'WYNN', name: 'Wynn Resorts Ltd', sector: 'Consumer', market: 'Global', currency: 'USD' },
        { ticker: 'LVS', name: 'Las Vegas Sands Corp.', sector: 'Consumer', market: 'Global', currency: 'USD' },
        { ticker: 'CZR', name: 'Caesars Entertainment Inc.', sector: 'Consumer', market: 'Global', currency: 'USD' },
        { ticker: 'DKNG', name: 'DraftKings Inc.', sector: 'Technology', market: 'Global', currency: 'USD' },
        { ticker: 'TSCO', name: 'Tractor Supply Co.', sector: 'Consumer', market: 'Global', currency: 'USD' },
        { ticker: 'DHI', name: 'D.R. Horton Inc.', sector: 'Consumer', market: 'Global', currency: 'USD' },
        { ticker: 'LEN', name: 'Lennar Corp.', sector: 'Consumer', market: 'Global', currency: 'USD' },
        { ticker: 'NVR', name: 'NVR Inc.', sector: 'Consumer', market: 'Global', currency: 'USD' },
        { ticker: 'PHM', name: 'PulteGroup Inc.', sector: 'Consumer', market: 'Global', currency: 'USD' },
        { ticker: 'W', name: 'Wayfair Inc.', sector: 'Consumer', market: 'Global', currency: 'USD' },
        { ticker: 'CHWY', name: 'Chewy Inc.', sector: 'Consumer', market: 'Global', currency: 'USD' },
        { ticker: 'ORLY', name: "O'Reilly Automotive Inc.", sector: 'Consumer', market: 'Global', currency: 'USD' },
        { ticker: 'AZO', name: 'AutoZone Inc.', sector: 'Consumer', market: 'Global', currency: 'USD' },
        { ticker: 'CTAS', name: 'Cintas Corp.', sector: 'Consumer', market: 'Global', currency: 'USD' },
        // Energy
        { ticker: 'XOM', name: 'Exxon Mobil Corp.', sector: 'Energy', market: 'Global', currency: 'USD' },
        { ticker: 'CVX', name: 'Chevron Corp.', sector: 'Energy', market: 'Global', currency: 'USD' },
        { ticker: 'COP', name: 'ConocoPhillips', sector: 'Energy', market: 'Global', currency: 'USD' },
        { ticker: 'EOG', name: 'EOG Resources Inc.', sector: 'Energy', market: 'Global', currency: 'USD' },
        { ticker: 'SLB', name: 'Schlumberger NV', sector: 'Energy', market: 'Global', currency: 'USD' },
        { ticker: 'OXY', name: 'Occidental Petroleum Corp.', sector: 'Energy', market: 'Global', currency: 'USD' },
        { ticker: 'PSX', name: 'Phillips 66', sector: 'Energy', market: 'Global', currency: 'USD' },
        { ticker: 'MPC', name: 'Marathon Petroleum Corp.', sector: 'Energy', market: 'Global', currency: 'USD' },
        { ticker: 'VLO', name: 'Valero Energy Corp.', sector: 'Energy', market: 'Global', currency: 'USD' },
        { ticker: 'HAL', name: 'Halliburton Co.', sector: 'Energy', market: 'Global', currency: 'USD' },
        { ticker: 'BKR', name: 'Baker Hughes Co.', sector: 'Energy', market: 'Global', currency: 'USD' },
        { ticker: 'DVN', name: 'Devon Energy Corp.', sector: 'Energy', market: 'Global', currency: 'USD' },
        { ticker: 'HES', name: 'Hess Corp.', sector: 'Energy', market: 'Global', currency: 'USD' },
        { ticker: 'WMB', name: 'Williams Companies Inc.', sector: 'Energy', market: 'Global', currency: 'USD' },
        { ticker: 'OKE', name: 'ONEOK Inc.', sector: 'Energy', market: 'Global', currency: 'USD' },
        { ticker: 'KMI', name: 'Kinder Morgan Inc.', sector: 'Energy', market: 'Global', currency: 'USD' },
        // Manufacturing & Industrials
        { ticker: 'GE', name: 'General Electric Co.', sector: 'Manufacturing', market: 'Global', currency: 'USD' },
        { ticker: 'CAT', name: 'Caterpillar Inc.', sector: 'Manufacturing', market: 'Global', currency: 'USD' },
        { ticker: 'BA', name: 'Boeing Co.', sector: 'Manufacturing', market: 'Global', currency: 'USD' },
        { ticker: 'HON', name: 'Honeywell International Inc.', sector: 'Manufacturing', market: 'Global', currency: 'USD' },
        { ticker: 'RTX', name: 'RTX Corp.', sector: 'Manufacturing', market: 'Global', currency: 'USD' },
        { ticker: 'UPS', name: 'United Parcel Service Inc.', sector: 'Transportation', market: 'Global', currency: 'USD' },
        { ticker: 'DE', name: 'Deere & Co.', sector: 'Manufacturing', market: 'Global', currency: 'USD' },
        { ticker: 'MMM', name: '3M Co.', sector: 'Manufacturing', market: 'Global', currency: 'USD' },
        { ticker: 'LMT', name: 'Lockheed Martin Corp.', sector: 'Manufacturing', market: 'Global', currency: 'USD' },
        { ticker: 'NOC', name: 'Northrop Grumman Corp.', sector: 'Manufacturing', market: 'Global', currency: 'USD' },
        { ticker: 'GD', name: 'General Dynamics Corp.', sector: 'Manufacturing', market: 'Global', currency: 'USD' },
        { ticker: 'LHX', name: 'L3Harris Technologies Inc.', sector: 'Manufacturing', market: 'Global', currency: 'USD' },
        { ticker: 'TDG', name: 'TransDigm Group Inc.', sector: 'Manufacturing', market: 'Global', currency: 'USD' },
        { ticker: 'CMI', name: 'Cummins Inc.', sector: 'Manufacturing', market: 'Global', currency: 'USD' },
        { ticker: 'PCAR', name: 'PACCAR Inc.', sector: 'Manufacturing', market: 'Global', currency: 'USD' },
        { ticker: 'EMR', name: 'Emerson Electric Co.', sector: 'Manufacturing', market: 'Global', currency: 'USD' },
        { ticker: 'ETN', name: 'Eaton Corp. PLC', sector: 'Manufacturing', market: 'Global', currency: 'USD' },
        { ticker: 'ITW', name: 'Illinois Tool Works Inc.', sector: 'Manufacturing', market: 'Global', currency: 'USD' },
        { ticker: 'PWR', name: 'Quanta Services Inc.', sector: 'Manufacturing', market: 'Global', currency: 'USD' },
        { ticker: 'VMC', name: 'Vulcan Materials Co.', sector: 'Manufacturing', market: 'Global', currency: 'USD' },
        { ticker: 'MLM', name: 'Martin Marietta Materials', sector: 'Manufacturing', market: 'Global', currency: 'USD' },
        { ticker: 'FCX', name: 'Freeport-McMoRan Inc.', sector: 'Manufacturing', market: 'Global', currency: 'USD' },
        { ticker: 'NEM', name: 'Newmont Corp.', sector: 'Manufacturing', market: 'Global', currency: 'USD' },
        { ticker: 'DOW', name: 'Dow Inc.', sector: 'Manufacturing', market: 'Global', currency: 'USD' },
        { ticker: 'DD', name: 'DuPont de Nemours Inc.', sector: 'Manufacturing', market: 'Global', currency: 'USD' },
        { ticker: 'APD', name: 'Air Products & Chemicals Inc.', sector: 'Manufacturing', market: 'Global', currency: 'USD' },
        { ticker: 'SHW', name: 'Sherwin-Williams Co.', sector: 'Manufacturing', market: 'Global', currency: 'USD' },
        { ticker: 'PPG', name: 'PPG Industries Inc.', sector: 'Manufacturing', market: 'Global', currency: 'USD' },
        { ticker: 'ECL', name: 'Ecolab Inc.', sector: 'Manufacturing', market: 'Global', currency: 'USD' },
        { ticker: 'IFF', name: 'International Flavors & Fragrances', sector: 'Manufacturing', market: 'Global', currency: 'USD' },
        { ticker: 'WM', name: 'Waste Management Inc.', sector: 'Manufacturing', market: 'Global', currency: 'USD' },
        { ticker: 'RSG', name: 'Republic Services Inc.', sector: 'Manufacturing', market: 'Global', currency: 'USD' },
        { ticker: 'CPRT', name: 'Copart Inc.', sector: 'Manufacturing', market: 'Global', currency: 'USD' },
        { ticker: 'GPC', name: 'Genuine Parts Co.', sector: 'Manufacturing', market: 'Global', currency: 'USD' },
        // Telecom & Media
        { ticker: 'T', name: 'AT&T Inc.', sector: 'Telecommunications', market: 'Global', currency: 'USD' },
        { ticker: 'VZ', name: 'Verizon Communications Inc.', sector: 'Telecommunications', market: 'Global', currency: 'USD' },
        { ticker: 'CMCSA', name: 'Comcast Corp.', sector: 'Media', market: 'Global', currency: 'USD' },
        { ticker: 'CHTR', name: 'Charter Communications Inc.', sector: 'Media', market: 'Global', currency: 'USD' },
        { ticker: 'DIS', name: 'Walt Disney Co.', sector: 'Media', market: 'Global', currency: 'USD' },
        { ticker: 'WBD', name: 'Warner Bros. Discovery Inc.', sector: 'Media', market: 'Global', currency: 'USD' },
        { ticker: 'FOXA', name: 'Fox Corp.', sector: 'Media', market: 'Global', currency: 'USD' },
        { ticker: 'NWSA', name: 'News Corp.', sector: 'Media', market: 'Global', currency: 'USD' },
        { ticker: 'PARA', name: 'Paramount Global', sector: 'Media', market: 'Global', currency: 'USD' },
        { ticker: 'LYV', name: 'Live Nation Entertainment Inc.', sector: 'Media', market: 'Global', currency: 'USD' },
        { ticker: 'OMC', name: 'Omnicom Group Inc.', sector: 'Media', market: 'Global', currency: 'USD' },
        { ticker: 'IPG', name: 'Interpublic Group of Cos.', sector: 'Media', market: 'Global', currency: 'USD' },
        // Transportation
        { ticker: 'F', name: 'Ford Motor Co.', sector: 'Automobiles', market: 'Global', currency: 'USD' },
        { ticker: 'GM', name: 'General Motors Co.', sector: 'Automobiles', market: 'Global', currency: 'USD' },
        { ticker: 'TM', name: 'Toyota Motor Corp.', sector: 'Automobiles', market: 'Global', currency: 'USD' },
        { ticker: 'HMC', name: 'Honda Motor Co.', sector: 'Automobiles', market: 'Global', currency: 'USD' },
        { ticker: 'AAL', name: 'American Airlines Group', sector: 'Transportation', market: 'Global', currency: 'USD' },
        { ticker: 'DAL', name: 'Delta Air Lines Inc.', sector: 'Transportation', market: 'Global', currency: 'USD' },
        { ticker: 'UAL', name: 'United Airlines Holdings Inc.', sector: 'Transportation', market: 'Global', currency: 'USD' },
        { ticker: 'LUV', name: 'Southwest Airlines Co.', sector: 'Transportation', market: 'Global', currency: 'USD' },
        { ticker: 'FDX', name: 'FedEx Corp.', sector: 'Transportation', market: 'Global', currency: 'USD' },
        // Real Estate
        { ticker: 'PLD', name: 'Prologis Inc.', sector: 'Real Estate', market: 'Global', currency: 'USD' },
        { ticker: 'AMT', name: 'American Tower Corp.', sector: 'Real Estate', market: 'Global', currency: 'USD' },
        { ticker: 'EQIX', name: 'Equinix Inc.', sector: 'Real Estate', market: 'Global', currency: 'USD' },
        { ticker: 'SPG', name: 'Simon Property Group', sector: 'Real Estate', market: 'Global', currency: 'USD' },
        { ticker: 'PSA', name: 'Public Storage', sector: 'Real Estate', market: 'Global', currency: 'USD' },
        { ticker: 'O', name: 'Realty Income Corp.', sector: 'Real Estate', market: 'Global', currency: 'USD' },
        { ticker: 'WELL', name: 'Welltower Inc.', sector: 'Real Estate', market: 'Global', currency: 'USD' },
        { ticker: 'AVB', name: 'AvalonBay Communities Inc.', sector: 'Real Estate', market: 'Global', currency: 'USD' },
        { ticker: 'DLR', name: 'Digital Realty Trust Inc.', sector: 'Real Estate', market: 'Global', currency: 'USD' },
        // Additional S&P 500 stocks
        { ticker: 'BRK.B', name: 'Berkshire Hathaway Inc.', sector: 'Financial', market: 'Global', currency: 'USD' },
        { ticker: 'FANG', name: 'Diamondback Energy Inc.', sector: 'Energy', market: 'Global', currency: 'USD' },
        { ticker: 'TT', name: 'Trane Technologies PLC', sector: 'Manufacturing', market: 'Global', currency: 'USD' },
        { ticker: 'PH', name: 'Parker-Hannifin Corp.', sector: 'Manufacturing', market: 'Global', currency: 'USD' },
        { ticker: 'ROK', name: 'Rockwell Automation Inc.', sector: 'Manufacturing', market: 'Global', currency: 'USD' },
        { ticker: 'AME', name: 'AMETEK Inc.', sector: 'Manufacturing', market: 'Global', currency: 'USD' },
        { ticker: 'OTIS', name: 'Otis Worldwide Corp.', sector: 'Manufacturing', market: 'Global', currency: 'USD' },
        { ticker: 'CARR', name: 'Carrier Global Corp.', sector: 'Manufacturing', market: 'Global', currency: 'USD' },
        { ticker: 'JCI', name: 'Johnson Controls International', sector: 'Manufacturing', market: 'Global', currency: 'USD' },
        { ticker: 'IR', name: 'Ingersoll Rand Inc.', sector: 'Manufacturing', market: 'Global', currency: 'USD' },
        { ticker: 'XYL', name: 'Xylem Inc.', sector: 'Manufacturing', market: 'Global', currency: 'USD' },
        { ticker: 'WAT', name: 'Waters Corp.', sector: 'Healthcare', market: 'Global', currency: 'USD' },
        { ticker: 'MHK', name: 'Mohawk Industries Inc.', sector: 'Consumer', market: 'Global', currency: 'USD' },
        { ticker: 'IP', name: 'International Paper Co.', sector: 'Manufacturing', market: 'Global', currency: 'USD' },
        { ticker: 'WRK', name: 'WestRock Co.', sector: 'Manufacturing', market: 'Global', currency: 'USD' },
        { ticker: 'EXC', name: 'Exelon Corp.', sector: 'Energy', market: 'Global', currency: 'USD' },
        { ticker: 'AEP', name: 'American Electric Power', sector: 'Energy', market: 'Global', currency: 'USD' },
        { ticker: 'DUK', name: 'Duke Energy Corp.', sector: 'Energy', market: 'Global', currency: 'USD' },
        { ticker: 'SO', name: 'Southern Co.', sector: 'Energy', market: 'Global', currency: 'USD' },
        { ticker: 'NEE', name: 'NextEra Energy Inc.', sector: 'Energy', market: 'Global', currency: 'USD' },
        { ticker: 'SRE', name: 'Sempra Energy', sector: 'Energy', market: 'Global', currency: 'USD' },
        { ticker: 'PEG', name: 'Public Service Enterprise Group', sector: 'Energy', market: 'Global', currency: 'USD' },
        { ticker: 'ED', name: 'Consolidated Edison Inc.', sector: 'Energy', market: 'Global', currency: 'USD' },
        { ticker: 'XEL', name: 'Xcel Energy Inc.', sector: 'Energy', market: 'Global', currency: 'USD' },
        { ticker: 'EIX', name: 'Edison International', sector: 'Energy', market: 'Global', currency: 'USD' },
        { ticker: 'SBAC', name: 'SBA Communications Corp.', sector: 'Real Estate', market: 'Global', currency: 'USD' },
        { ticker: 'CCI', name: 'Crown Castle Inc.', sector: 'Real Estate', market: 'Global', currency: 'USD' },
        { ticker: 'EQR', name: 'Equity Residential', sector: 'Real Estate', market: 'Global', currency: 'USD' },
        { ticker: 'UDR', name: 'UDR Inc.', sector: 'Real Estate', market: 'Global', currency: 'USD' },
        { ticker: 'INVH', name: 'Invitation Homes Inc.', sector: 'Real Estate', market: 'Global', currency: 'USD' },
        { ticker: 'CPT', name: 'Camden Property Trust', sector: 'Real Estate', market: 'Global', currency: 'USD' },
        { ticker: 'ESS', name: 'Essex Property Trust Inc.', sector: 'Real Estate', market: 'Global', currency: 'USD' },
        { ticker: 'MAA', name: 'Mid-America Apartment Communities', sector: 'Real Estate', market: 'Global', currency: 'USD' },
        { ticker: 'RMD', name: 'ResMed Inc.', sector: 'Healthcare', market: 'Global', currency: 'USD' },
        { ticker: 'PODD', name: 'Insulet Corp.', sector: 'Healthcare', market: 'Global', currency: 'USD' },
        { ticker: 'HOLX', name: 'Hologic Inc.', sector: 'Healthcare', market: 'Global', currency: 'USD' },
        { ticker: 'DVA', name: 'DaVita Inc.', sector: 'Healthcare', market: 'Global', currency: 'USD' },
        { ticker: 'UHS', name: 'Universal Health Services', sector: 'Healthcare', market: 'Global', currency: 'USD' },
        { ticker: 'COO', name: 'Cooper Companies Inc.', sector: 'Healthcare', market: 'Global', currency: 'USD' },
        { ticker: 'STE', name: 'Steris PLC', sector: 'Healthcare', market: 'Global', currency: 'USD' },
        { ticker: 'RGEN', name: 'Repligen Corp.', sector: 'Healthcare', market: 'Global', currency: 'USD' },
        { ticker: 'EXAS', name: 'Exact Sciences Corp.', sector: 'Healthcare', market: 'Global', currency: 'USD' },
        { ticker: 'LH', name: 'Labcorp Holdings Inc.', sector: 'Healthcare', market: 'Global', currency: 'USD' },
        { ticker: 'DGX', name: 'Quest Diagnostics Inc.', sector: 'Healthcare', market: 'Global', currency: 'USD' },
        { ticker: 'BIO', name: 'Bio-Rad Laboratories Inc.', sector: 'Healthcare', market: 'Global', currency: 'USD' },
        { ticker: 'TECH', name: 'Bio-Techne Corp.', sector: 'Healthcare', market: 'Global', currency: 'USD' },
        { ticker: 'MTD', name: 'Mettler-Toledo International', sector: 'Healthcare', market: 'Global', currency: 'USD' },
        { ticker: 'KEYS', name: 'Keysight Technologies Inc.', sector: 'Technology', market: 'Global', currency: 'USD' },
        { ticker: 'TRMB', name: 'Trimble Inc.', sector: 'Technology', market: 'Global', currency: 'USD' },
        { ticker: 'JBL', name: 'Jabil Inc.', sector: 'Technology', market: 'Global', currency: 'USD' },
        { ticker: 'FLEX', name: 'Flex Ltd', sector: 'Technology', market: 'Global', currency: 'USD' },
        { ticker: 'VTR', name: 'Ventas Inc.', sector: 'Real Estate', market: 'Global', currency: 'USD' },
        { ticker: 'ARE', name: 'Alexandria Real Estate Equities', sector: 'Real Estate', market: 'Global', currency: 'USD' },
        { ticker: 'BXP', name: 'Boston Properties Inc.', sector: 'Real Estate', market: 'Global', currency: 'USD' },
        { ticker: 'REG', name: 'Regency Centers Corp.', sector: 'Real Estate', market: 'Global', currency: 'USD' },
        { ticker: 'KRC', name: 'Kilroy Realty Corp.', sector: 'Real Estate', market: 'Global', currency: 'USD' },
        { ticker: 'WPC', name: 'WP Carey Inc.', sector: 'Real Estate', market: 'Global', currency: 'USD' },
        { ticker: 'SNA', name: 'Snap-on Inc.', sector: 'Manufacturing', market: 'Global', currency: 'USD' },
        { ticker: 'SWK', name: 'Stanley Black & Decker Inc.', sector: 'Manufacturing', market: 'Global', currency: 'USD' },
        { ticker: 'MAS', name: 'Masco Corp.', sector: 'Manufacturing', market: 'Global', currency: 'USD' },
        { ticker: 'AMCR', name: 'Amcor PLC', sector: 'Manufacturing', market: 'Global', currency: 'USD' },
        { ticker: 'BERY', name: 'Berry Global Group Inc.', sector: 'Manufacturing', market: 'Global', currency: 'USD' },
        { ticker: 'CE', name: 'Celanese Corp.', sector: 'Manufacturing', market: 'Global', currency: 'USD' },
        { ticker: 'EMN', name: 'Eastman Chemical Co.', sector: 'Manufacturing', market: 'Global', currency: 'USD' },
        { ticker: 'ALB', name: 'Albemarle Corp.', sector: 'Manufacturing', market: 'Global', currency: 'USD' },
        { ticker: 'MOS', name: 'Mosaic Co.', sector: 'Manufacturing', market: 'Global', currency: 'USD' },
        { ticker: 'CF', name: 'CF Industries Holdings Inc.', sector: 'Manufacturing', market: 'Global', currency: 'USD' },
        { ticker: 'STLD', name: 'Steel Dynamics Inc.', sector: 'Manufacturing', market: 'Global', currency: 'USD' },
        { ticker: 'NUE', name: 'Nucor Corp.', sector: 'Manufacturing', market: 'Global', currency: 'USD' },
        { ticker: 'RS', name: 'Reliance Steel & Aluminum', sector: 'Manufacturing', market: 'Global', currency: 'USD' },
        { ticker: 'ZBRA', name: 'Zebra Technologies Corp.', sector: 'Technology', market: 'Global', currency: 'USD' },
        { ticker: 'IPGP', name: 'IPG Photonics Corp.', sector: 'Technology', market: 'Global', currency: 'USD' },
        { ticker: 'GNRC', name: 'Generac Holdings Inc.', sector: 'Manufacturing', market: 'Global', currency: 'USD' },
        { ticker: 'AYI', name: 'Acuity Brands Inc.', sector: 'Manufacturing', market: 'Global', currency: 'USD' },
        { ticker: 'DOV', name: 'Dover Corp.', sector: 'Manufacturing', market: 'Global', currency: 'USD' },
        { ticker: 'NDSN', name: 'Nordson Corp.', sector: 'Manufacturing', market: 'Global', currency: 'USD' },
        { ticker: 'FLS', name: 'Flowserve Corp.', sector: 'Manufacturing', market: 'Global', currency: 'USD' },
        { ticker: 'XYL', name: 'Xylem Inc.', sector: 'Manufacturing', market: 'Global', currency: 'USD' },
        { ticker: 'WAB', name: 'Westinghouse Air Brake Tech', sector: 'Manufacturing', market: 'Global', currency: 'USD' },
        { ticker: 'GWW', name: 'W.W. Grainger Inc.', sector: 'Manufacturing', market: 'Global', currency: 'USD' },
        { ticker: 'FAST', name: 'Fastenal Co.', sector: 'Manufacturing', market: 'Global', currency: 'USD' },
        // Meme / Speculative / Popular
        { ticker: 'GME', name: 'GameStop Corp.', sector: 'Consumer', market: 'Global', currency: 'USD' },
        { ticker: 'AMC', name: 'AMC Entertainment Holdings', sector: 'Media', market: 'Global', currency: 'USD' },
        { ticker: 'SIRI', name: 'Sirius XM Holdings Inc.', sector: 'Media', market: 'Global', currency: 'USD' },
        { ticker: 'EBAY', name: 'eBay Inc.', sector: 'Technology', market: 'Global', currency: 'USD' },
        { ticker: 'ETSY', name: 'Etsy Inc.', sector: 'Technology', market: 'Global', currency: 'USD' },
        { ticker: 'MARA', name: 'Marathon Digital Holdings', sector: 'Technology', market: 'Global', currency: 'USD' },
        { ticker: 'RIOT', name: 'Riot Platforms Inc.', sector: 'Technology', market: 'Global', currency: 'USD' },
        { ticker: 'CLSK', name: 'CleanSpark Inc.', sector: 'Technology', market: 'Global', currency: 'USD' },
        { ticker: 'UPST', name: 'Upstart Holdings Inc.', sector: 'Financial', market: 'Global', currency: 'USD' },
        { ticker: 'SEDG', name: 'SolarEdge Technologies Inc.', sector: 'Technology', market: 'Global', currency: 'USD' },
        { ticker: 'ENPH', name: 'Enphase Energy Inc.', sector: 'Technology', market: 'Global', currency: 'USD' },
        { ticker: 'PLUG', name: 'Plug Power Inc.', sector: 'Energy', market: 'Global', currency: 'USD' },
        { ticker: 'FCEL', name: 'FuelCell Energy Inc.', sector: 'Energy', market: 'Global', currency: 'USD' },
        { ticker: 'NVTA', name: 'Invitae Corp.', sector: 'Healthcare', market: 'Global', currency: 'USD' },
        { ticker: 'FUBO', name: 'fuboTV Inc.', sector: 'Media', market: 'Global', currency: 'USD' },
        { ticker: 'RIVN', name: 'Rivian Automotive Inc.', sector: 'Automobiles', market: 'Global', currency: 'USD' },
        { ticker: 'LCID', name: 'Lucid Group Inc.', sector: 'Automobiles', market: 'Global', currency: 'USD' },
        { ticker: 'CHPT', name: 'ChargePoint Holdings Inc.', sector: 'Technology', market: 'Global', currency: 'USD' },
        { ticker: 'CRSP', name: 'CRISPR Therapeutics AG', sector: 'Healthcare', market: 'Global', currency: 'USD' },
        { ticker: 'EDIT', name: 'Editas Medicine Inc.', sector: 'Healthcare', market: 'Global', currency: 'USD' },
      ];

      for (const s of allSeeds) {
        await pool.query(
          `INSERT INTO stocks (ticker, name, sector, market, currency) VALUES ($1,$2,$3,$4,$5) ON CONFLICT (ticker) DO NOTHING`,
          [s.ticker, s.name, s.sector, s.market, s.currency]
        );
      }
      console.log(`Seeded ${allSeeds.length} stocks into database`);
    } else {
      console.log('Stocks table already contains data, skipping seed');
    }

    await pool.query(`CREATE TABLE IF NOT EXISTS subscription_plans (
      id SERIAL PRIMARY KEY, name VARCHAR(100) NOT NULL UNIQUE,
      description TEXT, price_kes NUMERIC(15,2) NOT NULL DEFAULT 0,
      price_usd NUMERIC(15,2) NOT NULL DEFAULT 0,
      features JSONB DEFAULT '[]', is_active BOOLEAN DEFAULT true,
      created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
    );`);

    await pool.query(`CREATE TABLE IF NOT EXISTS subscriptions (
      id SERIAL PRIMARY KEY, user_id INTEGER REFERENCES users(id) ON DELETE CASCADE,
      plan_id INTEGER REFERENCES subscription_plans(id),
      status VARCHAR(20) NOT NULL DEFAULT 'active'
        CHECK (status IN ('active', 'cancelled', 'expired', 'pending')),
      start_date TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
      end_date TIMESTAMP WITH TIME ZONE,
      created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
      updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
    );`);

    await pool.query(`CREATE TABLE IF NOT EXISTS payment_transactions (
      id SERIAL PRIMARY KEY, user_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
      subscription_id INTEGER REFERENCES subscriptions(id) ON DELETE SET NULL,
      amount NUMERIC(15,2) NOT NULL, currency VARCHAR(3) DEFAULT 'KES',
      provider VARCHAR(50) DEFAULT 'm-pesa',
      phone_number VARCHAR(20),
      external_reference VARCHAR(100) UNIQUE,
      payhero_reference VARCHAR(100),
      status VARCHAR(20) NOT NULL DEFAULT 'pending'
        CHECK (status IN ('pending', 'queued', 'success', 'failed', 'cancelled')),
      callback_data JSONB,
      created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
      updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
    );`);

    await pool.query(`ALTER TABLE payment_transactions ADD COLUMN IF NOT EXISTS plan_name VARCHAR(50)`);
    await pool.query(`ALTER TABLE payment_transactions ADD COLUMN IF NOT EXISTS duration_months INTEGER DEFAULT 1`);

    // --- Affiliate Program Tables ---
    await pool.query(`CREATE TABLE IF NOT EXISTS affiliates (
      id SERIAL PRIMARY KEY,
      user_id INTEGER REFERENCES users(id) ON DELETE CASCADE UNIQUE,
      referral_code VARCHAR(20) NOT NULL UNIQUE,
      total_earned NUMERIC(10,2) DEFAULT 0,
      pending_balance NUMERIC(10,2) DEFAULT 0,
      paid_out NUMERIC(10,2) DEFAULT 0,
      created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
    );`);
    await pool.query(`CREATE TABLE IF NOT EXISTS referrals (
      id SERIAL PRIMARY KEY,
      affiliate_id INTEGER REFERENCES affiliates(id) ON DELETE CASCADE,
      referred_user_id INTEGER REFERENCES users(id) ON DELETE CASCADE UNIQUE,
      subscription_tier VARCHAR(50),
      commission_amount NUMERIC(10,2) DEFAULT 0,
      status VARCHAR(20) NOT NULL DEFAULT 'pending'
        CHECK (status IN ('pending', 'paid', 'cancelled')),
      created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
      paid_at TIMESTAMP WITH TIME ZONE
    );`);
    await pool.query(`ALTER TABLE users ADD COLUMN IF NOT EXISTS referred_by INTEGER REFERENCES affiliates(id)`);
    await pool.query(`CREATE INDEX IF NOT EXISTS idx_referrals_affiliate_id ON referrals(affiliate_id)`);
    await pool.query(`CREATE INDEX IF NOT EXISTS idx_referrals_referred_user_id ON referrals(referred_user_id)`);

    await pool.query(`CREATE TABLE IF NOT EXISTS refresh_tokens (
      id SERIAL PRIMARY KEY,
      user_id INTEGER REFERENCES users(id) ON DELETE CASCADE,
      token_hash VARCHAR(64) NOT NULL,
      expires_at TIMESTAMP WITH TIME ZONE NOT NULL,
      revoked BOOLEAN DEFAULT FALSE,
      created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
    );`);
    await pool.query(`CREATE INDEX IF NOT EXISTS idx_refresh_tokens_hash ON refresh_tokens(token_hash)`);

    await pool.query(`CREATE TABLE IF NOT EXISTS affiliate_payouts (
      id SERIAL PRIMARY KEY,
      affiliate_id INTEGER REFERENCES affiliates(id) ON DELETE CASCADE,
      amount NUMERIC(10,2) NOT NULL,
      payment_method VARCHAR(50),
      payment_details VARCHAR(255),
      status VARCHAR(20) NOT NULL DEFAULT 'pending'
        CHECK (status IN ('pending', 'approved', 'paid', 'rejected')),
      notes TEXT,
      created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
      processed_at TIMESTAMP WITH TIME ZONE
    );`);

    // Backfill referral records for users who signed up with a referral code before affiliate tables existed
    await pool.query(`
      INSERT INTO referrals (affiliate_id, referred_user_id, status)
      SELECT u.referred_by, u.id, 'pending'
      FROM users u
      WHERE u.referred_by IS NOT NULL
        AND NOT EXISTS (SELECT 1 FROM referrals r WHERE r.referred_user_id = u.id)
    `);

    const planCount = await pool.query('SELECT COUNT(*) FROM subscription_plans');
    if (parseInt(planCount.rows[0].count) === 0) {
      await pool.query(`INSERT INTO subscription_plans (name, description, price_kes, price_usd, features) VALUES
        ('Starter', 'For retail investors', 1299, 9.9, $1::jsonb),
        ('Premium', 'For NSE-focused traders', 6499, 49.9, $2::jsonb),
        ('Pro', 'For active traders', 2599, 19.9, $3::jsonb),
        ('Institutional', 'For brokers, funds and advisors', 26000, 200, $4::jsonb)
      `, [
        JSON.stringify(['Real-time African + global data', '5 AI signals per day', 'Stock screener', 'Portfolio tracking']),
        JSON.stringify(['Unlimited NSE signals', '10 global signals/day', 'Advanced NSE screener', 'NSE technical analysis', 'Email support']),
        JSON.stringify(['Unlimited AI signals', 'All African + global markets', 'Advanced charting', 'Risk scoring', 'Priority support']),
        JSON.stringify(['API access', 'White-label analytics', 'Dedicated support', 'Team seats', 'Custom data feeds']),
      ]);
    } else {
      await pool.query(`UPDATE subscription_plans SET price_kes = 1299, price_usd = 9.9, description = 'For retail investors', features = $1::jsonb WHERE name = 'Starter'`, [
        JSON.stringify(['Real-time African + global data', '5 AI signals per day', 'Stock screener', 'Portfolio tracking']),
      ]);
      await pool.query(`UPDATE subscription_plans SET price_kes = 2599, price_usd = 19.9, description = 'For active traders', features = $1::jsonb WHERE name = 'Pro'`, [
        JSON.stringify(['Unlimited AI signals', 'All African + global market data', 'Advanced charting', 'Risk scoring', 'Priority support']),
      ]);
      await pool.query(`UPDATE subscription_plans SET name = 'Institutional', price_kes = 26000, price_usd = 200, description = 'For brokers, funds and advisors', features = $1::jsonb WHERE name = 'Enterprise'`, [
        JSON.stringify(['API access', 'White-label analytics', 'Dedicated support', 'Team seats', 'Custom data feeds']),
      ]);
      // Rename NSE Pro → Premium with NSE-focused unlimited
      const nseProRows = await pool.query(`SELECT id FROM subscription_plans WHERE name = 'NSE Pro'`);
      if (nseProRows.rows.length > 0) {
        await pool.query(`UPDATE subscription_plans SET name = 'Premium', description = 'For NSE-focused traders', features = $1::jsonb WHERE name = 'NSE Pro'`, [
          JSON.stringify(['Unlimited NSE signals', '10 global signals/day', 'Advanced NSE screener', 'NSE technical analysis', 'Email support']),
        ]);
      } else {
        const premiumExists = await pool.query(`SELECT id FROM subscription_plans WHERE name = 'Premium'`);
        if (premiumExists.rows.length === 0) {
          await pool.query(`INSERT INTO subscription_plans (name, description, price_kes, price_usd, features) VALUES ('Premium', 'For NSE-focused traders', 6499, 49, $1::jsonb)`, [
            JSON.stringify(['Unlimited NSE signals', '10 global signals/day', 'Advanced NSE screener', 'NSE technical analysis', 'Email support']),
          ]);
        } else {
          await pool.query(`UPDATE subscription_plans SET description = 'For NSE-focused traders', price_kes = 6499, price_usd = 49.9, features = $1::jsonb WHERE name = 'Premium'`, [
            JSON.stringify(['Unlimited NSE signals', '10 global signals/day', 'Advanced NSE screener', 'NSE technical analysis', 'Email support']),
          ]);
        }
      }
      // Remove Free plan if it exists
      await pool.query(`DELETE FROM subscription_plans WHERE LOWER(name) = 'free'`);
    }

    await pool.query(`ALTER TABLE users ADD COLUMN IF NOT EXISTS subscription_tier VARCHAR(50) DEFAULT 'free'`);
    await pool.query(`ALTER TABLE users ADD COLUMN IF NOT EXISTS subscription_status VARCHAR(20) DEFAULT 'free'`);
    await pool.query(`ALTER TABLE subscription_plans ADD COLUMN IF NOT EXISTS duration_months INTEGER DEFAULT 1`);
    await pool.query(`ALTER TABLE subscriptions ADD COLUMN IF NOT EXISTS expiry_email_1_sent_at TIMESTAMP WITH TIME ZONE`);
    await pool.query(`ALTER TABLE subscriptions ADD COLUMN IF NOT EXISTS expiry_email_2_sent_at TIMESTAMP WITH TIME ZONE`);
    await pool.query(`ALTER TABLE users ADD COLUMN IF NOT EXISTS subscription_start_date TIMESTAMP WITH TIME ZONE`);
    await pool.query(`ALTER TABLE users ADD COLUMN IF NOT EXISTS subscription_end_date TIMESTAMP WITH TIME ZONE`);
    await pool.query(`ALTER TABLE users ADD COLUMN IF NOT EXISTS trial_start_date TIMESTAMP WITH TIME ZONE DEFAULT NOW()`);
    await pool.query(`ALTER TABLE users ADD COLUMN IF NOT EXISTS visible_in_directory BOOLEAN DEFAULT true`);
    await pool.query(`ALTER TABLE users ADD COLUMN IF NOT EXISTS commitment_fee_paid BOOLEAN DEFAULT false`);
    // Grant existing free users a trial from their signup date
    await pool.query(`UPDATE users SET trial_start_date = created_at WHERE trial_start_date IS NULL AND subscription_tier = 'free'`);
    // Set default duration_months for existing plans that don't have it
    await pool.query(`UPDATE subscription_plans SET duration_months = 1 WHERE duration_months IS NULL`);

    // Fix: Free-tier users should have 'free' status, not 'active' (was defaulting incorrectly)
    await pool.query(`UPDATE users SET subscription_status = 'free' WHERE subscription_tier = 'free' AND subscription_status = 'active'`);
    // Seed subscription records for existing users with non-free tiers missing from subscriptions table
    await pool.query(`
      INSERT INTO subscriptions (user_id, plan_id, status, start_date, end_date)
      SELECT u.id, sp.id, u.subscription_status, COALESCE(u.subscription_start_date, u.created_at),
        COALESCE(u.subscription_end_date,
          CASE WHEN sp.duration_months = 12
            THEN COALESCE(u.subscription_start_date, u.created_at) + INTERVAL '12 months'
            ELSE COALESCE(u.subscription_start_date, u.created_at) + INTERVAL '1 month'
          END)
      FROM users u
      JOIN subscription_plans sp ON LOWER(sp.name) = LOWER(u.subscription_tier)
      WHERE u.subscription_tier != 'free'
        AND NOT EXISTS (SELECT 1 FROM subscriptions s WHERE s.user_id = u.id)
    `);

    // Signal engine tables
    await pool.query(`CREATE TABLE IF NOT EXISTS signal_history (
      id SERIAL PRIMARY KEY,
      ticker VARCHAR(20) NOT NULL,
      signal VARCHAR(20) NOT NULL,
      confidence INTEGER,
      price NUMERIC(15,2),
      change_pct NUMERIC(10,4),
      entry_price NUMERIC(15,2),
      stop_loss NUMERIC(15,2),
      target1 NUMERIC(15,2),
      target2 NUMERIC(15,2),
      risk_reward NUMERIC(5,2),
      sector VARCHAR(100),
      market VARCHAR(20),
      currency VARCHAR(10),
      trade_type VARCHAR(20),
      timeframe VARCHAR(20),
      reason TEXT,
      position_size INTEGER DEFAULT 25,
      generated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
    );`);
    // Migration: add position_size column if missing (safe for existing tables)
    await pool.query(`ALTER TABLE signal_history ADD COLUMN IF NOT EXISTS position_size INTEGER DEFAULT 25`).catch(() => {});
    await pool.query('CREATE INDEX IF NOT EXISTS idx_signal_history_ticker ON signal_history(ticker)');
    await pool.query('CREATE INDEX IF NOT EXISTS idx_signal_history_generated_at ON signal_history(generated_at)');

    await pool.query(`CREATE TABLE IF NOT EXISTS signal_outcomes (
      id SERIAL PRIMARY KEY,
      ticker VARCHAR(20) NOT NULL,
      entry_price NUMERIC(15,2),
      signal VARCHAR(20),
      exit_price NUMERIC(15,2),
      result VARCHAR(10) CHECK (result IN ('win', 'loss')),
      recorded_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
      signal_history_id INTEGER REFERENCES signal_history(id) ON DELETE SET NULL,
      position_size INTEGER DEFAULT 25
    );`);
    await pool.query(`ALTER TABLE signal_outcomes ADD COLUMN IF NOT EXISTS position_size INTEGER DEFAULT 25`).catch(() => {});
    await pool.query('CREATE INDEX IF NOT EXISTS idx_signal_outcomes_ticker ON signal_outcomes(ticker)');
    await pool.query('CREATE INDEX IF NOT EXISTS idx_signal_outcomes_result ON signal_outcomes(result)');

    await pool.query(`CREATE TABLE IF NOT EXISTS forward_predictions (
      id SERIAL PRIMARY KEY,
      symbol VARCHAR(20) NOT NULL,
      signal VARCHAR(20) NOT NULL,
      confidence INTEGER,
      price NUMERIC(15,2),
      generated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
      resolved BOOLEAN DEFAULT false,
      actual_return NUMERIC(10,4),
      correct BOOLEAN
    );`);
    await pool.query('CREATE INDEX IF NOT EXISTS idx_fp_symbol ON forward_predictions(symbol)');
    await pool.query('CREATE INDEX IF NOT EXISTS idx_fp_resolved ON forward_predictions(resolved)');

    await pool.query(`CREATE TABLE IF NOT EXISTS prediction_log (
      id SERIAL PRIMARY KEY,
      signal_history_id INTEGER REFERENCES signal_history(id) ON DELETE SET NULL,
      ticker VARCHAR(20) NOT NULL,
      signal_type VARCHAR(20),
      ml_prob NUMERIC(5,4),
      confidence INTEGER,
      predicted_outcome VARCHAR(10),
      actual_outcome VARCHAR(10),
      resolved_at TIMESTAMP WITH TIME ZONE,
      created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
    );`);

    await pool.query(`CREATE TABLE IF NOT EXISTS signal_audit_log (
      id SERIAL PRIMARY KEY,
      event_type VARCHAR(50) NOT NULL,
      message TEXT,
      details JSONB,
      recorded_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
    );`);

    await pool.query(`CREATE TABLE IF NOT EXISTS app_cache (
      cache_key VARCHAR(100) PRIMARY KEY,
      cache_value JSONB,
      updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
    );`);

    // Restore signal-engine in-memory state now that tables are guaranteed to exist
    try {
      const { restoreStateFromDb } = require('./signalService');
      await restoreStateFromDb();
    } catch (e) {
      console.warn('[initDatabase] restoreStateFromDb failed:', e.message);
    }

    console.log('Database schema verified');
  } catch (err) {
    console.error('Database initialization failed:', err.message);
  }
}

// ── Daily Portfolio Report Scheduler ──
async function sendDailyPortfolioReports() {
  try {
    const { rows: users } = await pool.query(
      `SELECT DISTINCT u.id, u.full_name, u.email FROM users u INNER JOIN portfolio_holdings ph ON ph.user_id = u.id`
    );
    if (users.length === 0) { console.log('[DAILY REPORT] No users with holdings'); return; }
    console.log(`[DAILY REPORT] Generating reports for ${users.length} users...`);
    for (const user of users) {
      try {
        const { rows } = await pool.query(
          `SELECT id, ticker, name, shares, avg_cost, current_price, sector, market, broker_connection_id FROM portfolio_holdings WHERE user_id = $1 ORDER BY ticker`,
          [user.id]
        );
        if (rows.length === 0) continue;
        const fxRate = await getFxRate();
        const holdings = [];
        let nseValue = 0, globalValue = 0, nseCost = 0, globalCost = 0;
        // Deduplicate: if broker-synced holding exists for a ticker, exclude manual one
        const brokerTickers = new Set(rows.filter(r => r.broker_connection_id > 0).map(r => r.ticker));
        const deduplicatedRows = rows.filter(r => r.broker_connection_id > 0 || !brokerTickers.has(r.ticker));
        for (const r of deduplicatedRows) {
          const lp = await getLivePrice(r.market, r.ticker) || parseFloat(r.current_price) || parseFloat(r.avg_cost) || 0;
          const ac = parseFloat(r.avg_cost) || 0;
          const sh = parseFloat(r.shares) || 0;
          const val = lp * sh, cost = ac * sh;
          if (r.market === 'NSE') { nseValue += val; nseCost += cost; } else { globalValue += val; globalCost += cost; }
          const currency = r.market === 'NSE' ? 'KES' : 'USD';
          holdings.push({
            ticker: r.ticker, name: r.name || r.ticker, shares: sh, currentPrice: lp,
            value: val, pnl: val - cost, pnlPercent: cost > 0 ? Math.round(((val - cost) / cost * 100) * 10) / 10 : 0,
            sector: r.sector || 'Other', market: r.market || 'NSE', currency,
          });
        }
        const tv = nseValue + globalValue * fxRate, tc = nseCost + globalCost * fxRate;
        const sectorMap = {};
        for (const h of holdings) { const vk = h.market === 'NSE' ? h.value : h.value * fxRate; sectorMap[h.sector] = (sectorMap[h.sector] || 0) + vk; }
        const sa = Object.entries(sectorMap).map(([s, v]) => ({ sector: s, value: v, pct: tv > 0 ? Math.round((v / tv) * 100) : 0 })).sort((a, b) => b.value - a.value);
        await sendPortfolioReportEmail(user.email, {
          userName: user.full_name, generatedAt: new Date().toISOString(),
          summary: { totalValue: Math.round(tv * 100) / 100, totalCost: Math.round(tc * 100) / 100, totalPnL: Math.round((tv - tc) * 100) / 100, pnlPercent: tc > 0 ? Math.round(((tv - tc) / tc) * 1000) / 10 : 0 },
          holdings, sectorAllocation: sa, bestPerformers: sp.filter(h => h.pnlPercent > 0).slice(0, 5), worstPerformers: sp.filter(h => h.pnlPercent < 0).slice(-5).reverse(), fxRate,
        });
        console.log(`[DAILY REPORT] Report sent to ${user.email}`);
      } catch (e) { console.error(`[DAILY REPORT] Error for user ${user.id}:`, e.message); }
    }
    console.log('[DAILY REPORT] Finished');
  } catch (e) { console.error('[DAILY REPORT] Error:', e.message); }
}

// ── Daily Paper Trading Portfolio Report Scheduler ──
async function sendDailyPaperTradingReports() {
  try {
    const { rows: users } = await pool.query(
      `SELECT DISTINCT u.id, u.full_name, u.email FROM users u INNER JOIN paper_positions pp ON pp.user_id = u.id`
    );
    if (users.length === 0) { console.log('[PAPER DAILY REPORT] No users with paper trading holdings'); return; }
    console.log(`[PAPER DAILY REPORT] Generating reports for ${users.length} users...`);
    for (const user of users) {
      try {
        const { rows } = await pool.query(
          `SELECT id, ticker, name, shares, avg_cost, market, sector FROM paper_positions WHERE user_id = $1 ORDER BY ticker`,
          [user.id]
        );
        if (rows.length === 0) continue;
        const fxRate = await getFxRate();
        const holdings = [];
        let nseValue = 0, globalValue = 0, nseCost = 0, globalCost = 0;
        for (const r of rows) {
          const lp = await getLivePrice(r.market, r.ticker) || parseFloat(r.avg_cost) || 0;
          const ac = parseFloat(r.avg_cost) || 0;
          const sh = parseFloat(r.shares) || 0;
          const val = lp * sh, cost = ac * sh;
          if (r.market === 'NSE') { nseValue += val; nseCost += cost; } else { globalValue += val; globalCost += cost; }
          const currency = r.market === 'NSE' ? 'KES' : 'USD';
          holdings.push({
            ticker: r.ticker, name: r.name || r.ticker, shares: sh, currentPrice: lp,
            value: val, pnl: val - cost, pnlPercent: cost > 0 ? Math.round(((val - cost) / cost * 100) * 10) / 10 : 0,
            sector: r.sector || 'Other', market: r.market || 'NSE', currency,
          });
        }
        const tv = nseValue + globalValue * fxRate, tc = nseCost + globalCost * fxRate;
        const sectorMap = {};
        for (const h of holdings) { const vk = h.market === 'NSE' ? h.value : h.value * fxRate; sectorMap[h.sector] = (sectorMap[h.sector] || 0) + vk; }
        const sa = Object.entries(sectorMap).map(([s, v]) => ({ sector: s, value: v, pct: tv > 0 ? Math.round((v / tv) * 100) : 0 })).sort((a, b) => b.value - a.value);
        const sp = [...holdings].sort((a, b) => b.pnlPercent - a.pnlPercent).filter(h => h.pnlPercent !== 0);

        // Fetch account summary for cash
        const { rows: acctRows } = await pool.query('SELECT cash_balance, cash_balance_usd FROM paper_accounts WHERE user_id = $1', [user.id]);
        const cashKes = acctRows.length > 0 ? parseFloat(acctRows[0].cash_balance) || 0 : 0;
        const cashUsd = acctRows.length > 0 ? parseFloat(acctRows[0].cash_balance_usd) || 0 : 0;
        const cashTotal = cashKes + cashUsd * fxRate;

        await sendPortfolioReportEmail(user.email, {
          userName: user.full_name + ' (Paper Trading)',
          generatedAt: new Date().toISOString(),
          summary: {
            totalValue: Math.round((tv + cashTotal) * 100) / 100,
            totalCost: Math.round((tc + cashTotal) * 100) / 100,
            totalPnL: Math.round((tv - tc) * 100) / 100,
            pnlPercent: tc > 0 ? Math.round(((tv - tc) / tc) * 1000) / 10 : 0,
          },
          holdings, sectorAllocation: sa, bestPerformers: sp.filter(h => h.pnlPercent > 0).slice(0, 5), worstPerformers: sp.filter(h => h.pnlPercent < 0).slice(-5).reverse(), fxRate,
        });
        console.log(`[PAPER DAILY REPORT] Report sent to ${user.email}`);
      } catch (e) { console.error(`[PAPER DAILY REPORT] Error for user ${user.id}:`, e.message); }
    }
    console.log('[PAPER DAILY REPORT] Finished');
  } catch (e) { console.error('[PAPER DAILY REPORT] Error:', e.message); }
}

// ── Send single portfolio report to a specific user ──
async function sendPortfolioReportToUser(userId, email, fullName) {
  try {
    const { rows } = await pool.query(
      `SELECT id, ticker, name, shares, avg_cost, current_price, sector, market, broker_connection_id FROM portfolio_holdings WHERE user_id = $1 ORDER BY ticker`,
      [userId]
    );
    if (rows.length === 0) {
      console.log(`[SINGLE REPORT] User ${userId} has no real portfolio holdings`);
      return false;
    }
        const fxRate = await getFxRate();
        const holdings = [];
        let nseValue = 0, globalValue = 0, nseCost = 0, globalCost = 0;
        // Deduplicate: if broker-synced holding exists for a ticker, exclude manual one
        const brokerTickers = new Set(rows.filter(r => r.broker_connection_id > 0).map(r => r.ticker));
        const deduplicatedRows = rows.filter(r => r.broker_connection_id > 0 || !brokerTickers.has(r.ticker));
        for (const r of deduplicatedRows) {
          const lp = await getLivePrice(r.market, r.ticker) || parseFloat(r.current_price) || parseFloat(r.avg_cost) || 0;
          const ac = parseFloat(r.avg_cost) || 0;
          const sh = parseFloat(r.shares) || 0;
          const val = lp * sh, cost = ac * sh;
          if (r.market === 'NSE') { nseValue += val; nseCost += cost; } else { globalValue += val; globalCost += cost; }
          const currency = r.market === 'NSE' ? 'KES' : 'USD';
          holdings.push({
            ticker: r.ticker, name: r.name || r.ticker, shares: sh, currentPrice: lp,
            value: val, pnl: val - cost, pnlPercent: cost > 0 ? Math.round(((val - cost) / cost * 100) * 10) / 10 : 0,
            sector: r.sector || 'Other', market: r.market || 'NSE', currency,
          });
        }
        const tv = nseValue + globalValue * fxRate, tc = nseCost + globalCost * fxRate;
        const sectorMap = {};
        for (const h of holdings) { const vk = h.market === 'NSE' ? h.value : h.value * fxRate; sectorMap[h.sector] = (sectorMap[h.sector] || 0) + vk; }
        const sa = Object.entries(sectorMap).map(([s, v]) => ({ sector: s, value: v, pct: tv > 0 ? Math.round((v / tv) * 100) : 0 })).sort((a, b) => b.value - a.value);
        const sortedPnl = [...holdings].sort((a, b) => b.pnlPercent - a.pnlPercent);
        await sendPortfolioReportEmail(email, {
          userName: fullName, generatedAt: new Date().toISOString(),
          summary: { totalValue: Math.round(tv * 100) / 100, totalCost: Math.round(tc * 100) / 100, totalPnL: Math.round((tv - tc) * 100) / 100, pnlPercent: tc > 0 ? Math.round(((tv - tc) / tc) * 1000) / 10 : 0 },
          holdings, sectorAllocation: sa, bestPerformers: sortedPnl.filter(h => h.pnlPercent > 0).slice(0, 5), worstPerformers: sortedPnl.filter(h => h.pnlPercent < 0).slice(-5).reverse(), fxRate,
        });
    console.log(`[SINGLE REPORT] Real portfolio report sent to ${email}`);
    return true;
  } catch (e) {
    console.error(`[SINGLE REPORT] Error for user ${userId}:`, e.message);
    return false;
  }
}

// ── Send single paper trading portfolio report to a specific user ──
async function sendPaperTradingReportToUser(userId, email, fullName) {
  try {
    const { rows } = await pool.query(
      `SELECT id, ticker, name, shares, avg_cost, market, sector FROM paper_positions WHERE user_id = $1 ORDER BY ticker`,
      [userId]
    );
    if (rows.length === 0) {
      console.log(`[SINGLE REPORT] User ${userId} has no paper trading positions`);
      return false;
    }
    const fxRate = await getFxRate();
    const holdings = [];
    let nseValue = 0, globalValue = 0, nseCost = 0, globalCost = 0;
    for (const r of rows) {
      const lp = await getLivePrice(r.market, r.ticker) || parseFloat(r.avg_cost) || 0;
      const ac = parseFloat(r.avg_cost) || 0;
      const sh = parseFloat(r.shares) || 0;
      const val = lp * sh, cost = ac * sh;
      if (r.market === 'NSE') { nseValue += val; nseCost += cost; } else { globalValue += val; globalCost += cost; }
      const currency = r.market === 'NSE' ? 'KES' : 'USD';
      holdings.push({
        ticker: r.ticker, name: r.name || r.ticker, shares: sh, currentPrice: lp,
        value: val, pnl: val - cost, pnlPercent: cost > 0 ? Math.round(((val - cost) / cost * 100) * 10) / 10 : 0,
        sector: r.sector || 'Other', market: r.market || 'NSE', currency,
      });
    }
    const tv = nseValue + globalValue * fxRate, tc = nseCost + globalCost * fxRate;
    const sectorMap = {};
    for (const h of holdings) { const vk = h.market === 'NSE' ? h.value : h.value * fxRate; sectorMap[h.sector] = (sectorMap[h.sector] || 0) + vk; }
    const sa = Object.entries(sectorMap).map(([s, v]) => ({ sector: s, value: v, pct: tv > 0 ? Math.round((v / tv) * 100) : 0 })).sort((a, b) => b.value - a.value);
    const sp = [...holdings].sort((a, b) => b.pnlPercent - a.pnlPercent).filter(h => h.pnlPercent !== 0);

    const { rows: acctRows } = await pool.query('SELECT cash_balance, cash_balance_usd FROM paper_accounts WHERE user_id = $1', [userId]);
    const cashKes = acctRows.length > 0 ? parseFloat(acctRows[0].cash_balance) || 0 : 0;
    const cashUsd = acctRows.length > 0 ? parseFloat(acctRows[0].cash_balance_usd) || 0 : 0;
    const cashTotal = cashKes + cashUsd * fxRate;

    await sendPortfolioReportEmail(email, {
      userName: fullName + ' (Paper Trading)',
      generatedAt: new Date().toISOString(),
      summary: {
        totalValue: Math.round((tv + cashTotal) * 100) / 100,
        totalCost: Math.round((tc + cashTotal) * 100) / 100,
        totalPnL: Math.round((tv - tc) * 100) / 100,
        pnlPercent: tc > 0 ? Math.round(((tv - tc) / tc) * 1000) / 10 : 0,
      },
      holdings, sectorAllocation: sa, bestPerformers: sp.filter(h => h.pnlPercent > 0).slice(0, 5), worstPerformers: sp.filter(h => h.pnlPercent < 0).slice(-5).reverse(), fxRate,
    });
    console.log(`[SINGLE REPORT] Paper trading report sent to ${email}`);
    return true;
  } catch (e) {
    console.error(`[SINGLE REPORT] Error for user ${userId}:`, e.message);
    return false;
  }
}

async function sendHotNewsReportToUser(userId, email, fullName) {
  try {
    const { getAllNews } = require('./newsService');
    const news = await getAllNews(200);
    const hotNews = news.filter(a => a.hot).slice(0, 15);
    if (hotNews.length === 0) {
      console.log(`[HOT NEWS] No hot news found for ${email}`);
      return false;
    }
    const dateStr = new Date().toLocaleDateString('en-US', {
      weekday: 'long', year: 'numeric', month: 'long', day: 'numeric'
    });
    const hotNewsData = hotNews.map(a => ({
      headline: a.headline,
      source: a.source,
      excerpt: a.excerpt || '',
      hotType: a.hotType,
      sentiment: a.sentiment,
      relatedStocks: a.relatedStocks || [],
      timestamp: a.timestamp,
      url: a.url,
    }));
    await sendHotNewsEmail(email, {
      userName: fullName || 'Trader',
      dateStr,
      hotNews: hotNewsData,
    });
    console.log(`[HOT NEWS] Report sent to ${email}`);
    return true;
  } catch (e) {
    console.error(`[HOT NEWS] Error for ${email}:`, e.message);
    return false;
  }
}

async function sendDailyHotNewsReports() {
  try {
    const { rows: users } = await pool.query(
      `SELECT id, full_name, email FROM users WHERE sentiment_opt_in = true`
    );
    if (users.length === 0) { console.log('[HOT NEWS CRON] No opted-in users'); return; }
    console.log(`[HOT NEWS CRON] Sending reports to ${users.length} users...`);
    for (const user of users) {
      try {
        await sendHotNewsReportToUser(user.id, user.email, user.full_name);
      } catch (e) {
        console.error(`[HOT NEWS CRON] Error for user ${user.id}:`, e.message);
      }
    }
    console.log('[HOT NEWS CRON] Finished');
  } catch (e) {
    console.error('[HOT NEWS CRON] Error:', e.message);
  }
}

async function sendDailySentimentReports() {
  try {
    const { rows: users } = await pool.query(
      `SELECT id, full_name, email FROM users WHERE sentiment_opt_in = true`
    );
    if (users.length === 0) { console.log('[SENTIMENT] No opted-in users'); return; }
    console.log(`[SENTIMENT] Sending reports to ${users.length} users...`);

    // Fetch market summary data once, reuse for all users
    const summaryRes = await axios.get(`http://localhost:${port}/api/ai/market-summary`).then(r => r.data).catch(() => null);
    const moversRes = await axios.get(`http://localhost:${port}/api/market/movers`).then(r => r.data).catch(() => ({}));

    const summary = summaryRes?.summary || 'Markets showing mixed activity today.';
    const sentiment = summaryRes?.sentiment || 'Neutral';
    const confidence = summaryRes?.confidence || '65%';
    const signals = summaryRes?.signals || { total: 0, strongBuys: 0, buys: 0, sells: 0 };
    const nseGainers = moversRes?.nse?.gainers?.slice(0, 8) || [];
    const nseLosers = moversRes?.nse?.losers?.slice(0, 8) || [];
    const globalGainers = moversRes?.global?.gainers?.slice(0, 8) || [];
    const globalLosers = moversRes?.global?.losers?.slice(0, 8) || [];

    const dateStr = new Date().toLocaleDateString('en-US', {
      weekday: 'long', year: 'numeric', month: 'long', day: 'numeric'
    });

    for (const user of users) {
      try {
        await sendDailySentimentEmail(user.email, {
          userName: user.full_name,
          summary, sentiment, confidence, dateStr,
          nseGainers, nseLosers, globalGainers, globalLosers, signals,
        });
        console.log(`[SENTIMENT] Report sent to ${user.email}`);
      } catch (e) {
        console.error(`[SENTIMENT] Error for user ${user.id}:`, e.message);
      }
    }
    console.log('[SENTIMENT] Finished');
  } catch (e) {
    console.error('[SENTIMENT] Error:', e.message);
  }
}

async function sendWeeklyDigestToUser(userId, email, fullName) {
  try {
    const [summaryRes, moversRes, newsRes, editorial] = await Promise.all([
      axios.get(`http://localhost:${port}/api/ai/market-summary`).then(r => r.data).catch(() => null),
      axios.get(`http://localhost:${port}/api/market/movers`).then(r => r.data).catch(() => ({})),
      axios.get(`http://localhost:${port}/api/news?limit=15`).then(r => r.data).catch(() => ({})),
      generateWeeklyDigestContent().catch(() => ({})),
    ]);
    const dateStr = new Date().toLocaleDateString('en-US', {
      weekday: 'long', year: 'numeric', month: 'long', day: 'numeric'
    });
    const newsHeadlines = (newsRes.news || newsRes.articles || []).slice(0, 8).map(a => ({
      headline: a.headline || a.title || '',
      source: a.source || a.sourceName || '',
    }));
    await sendWeeklyDigestEmail(email, {
      userName: fullName || 'Trader',
      dateStr,
      nseGainers: moversRes?.nse?.gainers?.slice(0, 6) || [],
      nseLosers: moversRes?.nse?.losers?.slice(0, 6) || [],
      globalGainers: moversRes?.global?.gainers?.slice(0, 6) || [],
      globalLosers: moversRes?.global?.losers?.slice(0, 6) || [],
      newsHeadlines,
      totalSignals: summaryRes?.signals?.total || 0,
      nseSummary: editorial.nseSummary || '',
      storyOfWeek: editorial.storyOfWeek || '',
      milestone: editorial.milestone || '',
      globalTheme: editorial.globalTheme || '',
      macroBackdrop: editorial.macroBackdrop || '',
      whatToWatch: editorial.whatToWatch || '',
      nseGlobalConnection: editorial.nseGlobalConnection || '',
    });
    console.log(`[DIGEST] Weekly digest sent to ${email}`);
    return true;
  } catch (e) {
    console.error(`[DIGEST] Error for ${email}:`, e.message);
    return false;
  }
}

async function sendWeeklyDigestReports() {
  try {
    const { rows: users } = await pool.query(
      `SELECT id, full_name, email FROM users WHERE weekly_digest_opt_in = true`
    );
    if (users.length === 0) { console.log('[DIGEST] No opted-in users'); return; }
    console.log(`[DIGEST] Sending weekly digests to ${users.length} users...`);
    for (const user of users) {
      try {
        await sendWeeklyDigestToUser(user.id, user.email, user.full_name);
      } catch (e) {
        console.error(`[DIGEST] Error for user ${user.id}:`, e.message);
      }
    }
    console.log('[DIGEST] Weekly digest round finished');
  } catch (e) {
    console.error('[DIGEST] Error:', e.message);
  }
}

// ── 2. DAILY MARKET BRIEF ──

async function sendDailyBriefToUser(userId, email, fullName) {
  try {
    const [moversRes, editorial] = await Promise.all([
      axios.get(`http://localhost:${port}/api/market/movers`).then(r => r.data).catch(() => ({})),
      generateDailyBriefContent().catch(() => ({})),
    ]);
    const dateStr = new Date().toLocaleDateString('en-US', {
      weekday: 'long', year: 'numeric', month: 'long', day: 'numeric'
    });

    const indices = editorial?.indices?.length ? editorial.indices : [
      { label: 'NSE 20', value: '--', change: '--', signal: '--' },
      { label: 'NASI', value: '--', change: '--', signal: '--' },
      { label: 'NGX ASI', value: '--', change: '--', signal: '--' },
      { label: 'S&P 500', value: '--', change: '--', signal: '--' },
      { label: 'USD/KES', value: '--', change: '--', signal: '--' },
    ];

    const combinedMovers = moversRes?.combined?.gainers || moversRes?.combined || [];
    const yesterdayTopMovers = editorial?.yesterdayTopMovers?.length ? editorial.yesterdayTopMovers : (Array.isArray(combinedMovers) ? combinedMovers.slice(0, 6).map(m => ({
      symbol: m.symbol || '--',
      company: m.company_name || '',
      change: m.changePercent ? (m.isPositive ? '+' : '') + m.changePercent.toFixed(2) + '%' : '--',
      volume: m.volume?.toLocaleString() || '--',
    })) : []);

    await sendDailyBriefEmail(email, {
      userName: fullName || 'Trader',
      dateStr,
      indices,
      yesterdayTopMovers,
      aiSignal: editorial.aiSignal || null,
      aiSignalContext: editorial.aiSignalContext || '',
      globalIndices: editorial?.globalIndices?.length ? editorial.globalIndices : [
        { label: 'S&P 500', value: '--', change: '--', keyDriver: 'Overnight data pending' },
        { label: 'Nasdaq 100', value: '--', change: '--', keyDriver: 'Overnight data pending' },
        { label: 'Dow Jones', value: '--', change: '--', keyDriver: 'Overnight data pending' },
        { label: 'Russell 2000', value: '--', change: '--', keyDriver: 'Overnight data pending' },
      ],
      globalToNseConnection: editorial.globalToNseConnection || 'Global market movements overnight can set the tone for NSE open. Watch for any significant gap-ups or gap-downs in the first 30 minutes of trading.',
      calendar: editorial.calendar || [],
      analystTake: editorial.analystTake || '',
    });
    console.log(`[BRIEF] Daily brief sent to ${email}`);
    return true;
  } catch (e) {
    console.error(`[BRIEF] Error for ${email}:`, e.message);
    return false;
  }
}

async function sendDailyBriefReports() {
  try {
    const { rows: users } = await pool.query(
      `SELECT id, full_name, email FROM users WHERE daily_brief_opt_in = true`
    );
    if (users.length === 0) { console.log('[BRIEF] No opted-in users'); return; }
    console.log(`[BRIEF] Sending daily briefs to ${users.length} users...`);
    for (const user of users) {
      try { await sendDailyBriefToUser(user.id, user.email, user.full_name); }
      catch (e) { console.error(`[BRIEF] Error for user ${user.id}:`, e.message); }
    }
    console.log('[BRIEF] Daily brief round finished');
  } catch (e) {
    console.error('[BRIEF] Error:', e.message);
  }
}

// ── 3. EARNINGS & CORPORATE ACTIONS ──

async function sendEarningsReportToUser(userId, email, fullName) {
  try {
    const dateStr = new Date().toLocaleDateString('en-US', {
      weekday: 'long', year: 'numeric', month: 'long', day: 'numeric'
    });
    const editorial = await generateEarningsContent().catch(() => ({}));

    await sendEarningsReportEmail(email, {
      userName: fullName || 'Trader',
      dateStr,
      earningsCalendar: editorial.earningsCalendar || [],
      earningsResults: editorial.earningsResults || [],
      corporateActions: editorial.corporateActions || [],
      globalEarnings: editorial.globalEarnings || [],
    });
    console.log(`[EARNINGS] Earnings report sent to ${email}`);
    return true;
  } catch (e) {
    console.error(`[EARNINGS] Error for ${email}:`, e.message);
    return false;
  }
}

async function sendEarningsReportReports() {
  try {
    const { rows: users } = await pool.query(
      `SELECT id, full_name, email FROM users WHERE earnings_report_opt_in = true`
    );
    if (users.length === 0) { console.log('[EARNINGS] No opted-in users'); return; }
    console.log(`[EARNINGS] Sending earnings reports to ${users.length} users...`);
    for (const user of users) {
      try { await sendEarningsReportToUser(user.id, user.email, user.full_name); }
      catch (e) { console.error(`[EARNINGS] Error for user ${user.id}:`, e.message); }
    }
    console.log('[EARNINGS] Earnings report round finished');
  } catch (e) {
    console.error('[EARNINGS] Error:', e.message);
  }
}

// ── Error handling infrastructure ──────────────────────────────

const asyncHandler = (fn) => (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next);

class AppError extends Error {
  constructor(message, { statusCode = 500, code = 'INTERNAL_ERROR' } = {}) {
    super(message);
    this.statusCode = statusCode;
    this.code = code;
    this.isOperational = true;
  }
}

// 404 handler — must be after all routes
app.use((_req, res) => {
  res.status(404).json({ error: 'Not found', code: 'NOT_FOUND' });
});

// Global error middleware — must be after 404 handler
app.use((err, _req, res, _next) => {
  if (err instanceof AppError) {
    return res.status(err.statusCode).json({ error: err.message, code: err.code });
  }
  if (err.code === 'LIMIT_FILE_SIZE' || err.message?.startsWith('File type not allowed')) {
    return res.status(400).json({ error: err.message, code: 'FILE_ERROR' });
  }
  if (err.name === 'JsonWebTokenError' || err.name === 'TokenExpiredError') {
    return res.status(401).json({ error: 'Invalid or expired token', code: 'TOKEN_INVALID' });
  }
  console.error('[UNEXPECTED]', err.stack || err.message);
  res.status(500).json({ error: 'An unexpected error occurred', code: 'INTERNAL_ERROR' });
});

// ── SPA fallback: serve index.html for all non-API routes ────────
// Only enabled when the backend is co-located with a built frontend.
if (serveFrontend) {
  app.get('*', (req, res, next) => {
    if (req.path.startsWith('/api/')) return next();
    res.sendFile(path.join(frontendDist, 'index.html'));
  });
} else {
  // API-only fallback for separate frontend deployments
  app.get('/', (_req, res) => res.json({ status: 'StocksIntels API', time: new Date().toISOString() }));
}

// ===================== START SERVER =====================

let startRetries = 0;
const MAX_START_RETRIES = 5;

server.on('error', (err) => {
  if (err.code === 'EADDRINUSE') {
    startRetries++;
    if (startRetries > MAX_START_RETRIES) {
      console.error(`Port ${port} is still in use after ${MAX_START_RETRIES} retries. Exiting.`);
      process.exit(1);
    }
    console.error(`Port ${port} is in use. Retrying in 3s... (attempt ${startRetries}/${MAX_START_RETRIES})`);
    setTimeout(() => server.listen(port, '0.0.0.0'), 3000);
  } else {
    console.error('Server error:', err.message);
  }
});

process.on('unhandledRejection', (reason) => {
  console.error('[UNHANDLED REJECTION]', reason instanceof Error ? reason.stack : reason);
});

process.on('uncaughtException', (err) => {
  console.error('[UNCAUGHT EXCEPTION]', err.stack || err.message);
  process.exit(1);
});

// Start listening immediately so health checks pass even if DB init is slow
server.listen(port, '0.0.0.0', async () => {
  console.log(`Backend server running at http://localhost:${port}`);
  try {
    await initDatabase();

    // TEMP: Send test expiry emails on startup
    (async () => {
      try {
        const testEmail = 'bathurusadiki01@gmail.com';
        await sendSubscriptionExpiryEmail1(testEmail, { userName: 'Sadiq' });
        console.log('[STARTUP] Test Expiry Email 1 sent');
        await sendSubscriptionExpiryEmail2(testEmail, { userName: 'Sadiq' });
        console.log('[STARTUP] Test Expiry Email 2 sent');
      } catch (e) {
        console.error('[STARTUP] Failed to send test expiry emails:', e.message);
      }
    })();

    await queueService.connect();
    queueService.onSignalUpdate((signal) => {
        if (signal.batch) {
          io.emit('signal:batch_update', signal);
          signal.signals.forEach(s => io.emit(`signal:update:${s.ticker}`, s));
          io.emit('signal:updates', signal.signals);
        } else {
          io.emit(`signal:update:${signal.ticker}`, signal);
          io.emit('signal:update', signal);
        }
      });
      queueService.onMarketUpdate((quote) => { io.emit('market:update', quote); });
      queueService.onIndexUpdate((indices) => { io.emit('indices:update', indices); });
      queueService.onSectorUpdate((sectors) => { io.emit('sectors:update', sectors); });
      queueService.onSignalNotification((payload) => {
        if (payload.batch) {
          payload.notifications.forEach((n) => {
            io.to(`user:${n.user_id}`).emit('notification', n);
          });
        }
      });
      signalPublisher.start();

      // Immediate initial indices/sector publish
      (async () => {
        try {
          const [nse, global, sectors] = await Promise.all([
            indicesService.getNseIndices(),
            indicesService.getGlobalIndices(),
            indicesService.getSectorPerformance().catch(() => indicesService.getSyntheticSectors()),
          ]);
          const indices = [...nse, ...global];
          queueService.publishIndexUpdate(indices).catch(() => {});
          queueService.publishSectorUpdate(sectors).catch(() => {});
        } catch {}
      })();

      // Periodic indices & sector updates (every 30s)
      let idxInterval = setInterval(async () => {
        try {
          const [nse, global, sectors] = await Promise.all([
            indicesService.getNseIndices(),
            indicesService.getGlobalIndices(),
            indicesService.getSectorPerformance().catch(() => indicesService.getSyntheticSectors()),
          ]);
          const indices = [...nse, ...global];
          queueService.publishIndexUpdate(indices).catch(() => {});
          queueService.publishSectorUpdate(sectors).catch(() => {});
        } catch {}
      }, 30000);
      idxInterval.unref();
      console.log('Redis pub/sub and signal publisher initialized');

      // Deferred warmFMPCache - don't await, fire and forget
      warmFMPCache(ALL_SYMBOLS).catch(() => {});
    } catch (err) {
      console.warn('Redis unavailable - signal publisher disabled:', err.message);
      console.warn('Signal generation will happen on-demand via REST endpoints.');
    }

    // Schedule daily portfolio report (real holdings) at midnight EAT (00:00 EAT)
    cron.schedule('0 0 * * 1-5', () => {
      console.log('[CRON] Running daily real portfolio report...');
      sendDailyPortfolioReports();
    });
    console.log('[CRON] Daily real portfolio report scheduled Mon-Fri at midnight EAT (00:00 EAT)');

    // Schedule daily paper trading portfolio report at midnight EAT (00:00 EAT)
    cron.schedule('0 0 * * 1-5', () => {
      console.log('[CRON] Running daily paper trading portfolio report...');
      sendDailyPaperTradingReports();
    });
    console.log('[CRON] Daily paper trading portfolio report scheduled Mon-Fri at midnight EAT (00:00 EAT)');

    // Schedule daily sentiment email at midnight EAT (00:00 EAT)
    cron.schedule('0 0 * * 1-5', () => {
      console.log('[SENTIMENT CRON] Running daily sentiment report...');
      sendDailySentimentReports();
    });
    console.log('[SENTIMENT CRON] Daily sentiment email scheduled Mon-Fri at midnight EAT (00:00 EAT)');

    // Schedule ML model retraining check every 2 hours
    // The actual retrain frequency is controlled by engineConfig.training.retrain_frequency_hours (default 24)
    // maybeRetrain() will no-op if the interval hasn't elapsed yet
    cron.schedule('0 */2 * * *', async () => {
      console.log('[ML CRON] Checking if retraining is due...');
      try {
        const result = await mlModel.maybeRetrain();
        if (result && result.status === 'started') {
          console.log('[ML CRON] Retraining started in background');
        } else if (result && result.status === 'in_progress') {
          console.log('[ML CRON] Retraining already in progress, skipped');
        }
      } catch (err) {
        console.error('[ML CRON] Error:', err.message);
      }
    });
    console.log('[ML CRON] Retrain checker scheduled every 2 hours, actual interval from engineConfig.training.retrain_frequency_hours');

    // Schedule hot news email every 6 hours (Mon-Fri)
    cron.schedule('0 */6 * * 1-5', () => {
      console.log('[HOT NEWS CRON] Running hot news report...');
      sendDailyHotNewsReports();
    });
    console.log('[HOT NEWS CRON] Hot news email scheduled every 6 hours Mon-Fri');

    // Schedule daily subscription expiry reminders at 9 AM EAT (06:00 UTC)
    cron.schedule('0 6 * * *', async () => {
      console.log('[SUBSCRIPTION CRON] Sending expiry reminders...');
      try {
        const reminderDays = [7, 3, 1];
        for (const days of reminderDays) {
          const { rows: subs } = await pool.query(`
            SELECT s.id, s.user_id, s.end_date, sp.name as plan_name, u.full_name, u.email
            FROM subscriptions s
            JOIN users u ON u.id = s.user_id
            JOIN subscription_plans sp ON sp.id = s.plan_id
            WHERE s.status = 'active'
              AND s.end_date IS NOT NULL
              AND s.end_date BETWEEN CURRENT_TIMESTAMP + INTERVAL '${days - 1} days'
                                   AND CURRENT_TIMESTAMP + INTERVAL '${days} days'
          `);
          for (const sub of subs) {
            try {
              await sendSubscriptionExpiryReminder(sub.email, {
                userName: sub.full_name,
                planName: sub.plan_name,
                daysLeft: days,
                expiryDate: sub.end_date,
              });
              console.log(`[SUBSCRIPTION CRON] Sent ${days}-day reminder to ${sub.email}`);
            } catch (e) {
              console.error(`[SUBSCRIPTION CRON] Failed to send reminder to ${sub.email}:`, e.message);
            }
          }
        }
      } catch (err) { console.error('[SUBSCRIPTION CRON] Reminder error:', err.message); }
    });
    console.log('[SUBSCRIPTION CRON] Daily expiry reminders scheduled at 9 AM EAT (06:00 UTC)');

    // Schedule subscription expiry check every hour
    cron.schedule('0 * * * *', async () => {
      console.log('[SUBSCRIPTION CRON] Checking expired subscriptions...');
      try {
        // ── Step 1: Expire subscriptions that just passed end_date ──
        const { rows: expired } = await pool.query(`
          UPDATE subscriptions SET status = 'expired', updated_at = CURRENT_TIMESTAMP
          WHERE status = 'active' AND end_date IS NOT NULL AND end_date < CURRENT_TIMESTAMP
          RETURNING id, user_id
        `);
        if (expired.length > 0) {
          console.log(`[SUBSCRIPTION CRON] Expired ${expired.length} subscription(s)`);
          for (const sub of expired) {
            await pool.query(
              `UPDATE users SET subscription_status = 'expired', subscription_tier = 'free' WHERE id = $1 AND subscription_status = 'active'`,
              [sub.user_id]
            );
            // Send Email 1 (Soft Reminder) + set sent timestamp
            try {
              const userRes = await pool.query('SELECT full_name, email FROM users WHERE id = $1', [sub.user_id]);
              const { full_name, email } = userRes.rows[0] || {};
              if (email) {
                await pool.query('UPDATE subscriptions SET expiry_email_1_sent_at = CURRENT_TIMESTAMP WHERE id = $1', [sub.id]);
                await sendSubscriptionExpiryEmail1(email, { userName: full_name || '' });
                console.log(`[SUBSCRIPTION CRON] Expiry Email 1 sent to ${email}`);
              }
            } catch (e) {
              console.error(`[SUBSCRIPTION CRON] Failed to send Expiry Email 1 to user ${sub.user_id}:`, e.message);
            }
          }
        }

        // ── Step 2: Send Email 1 to any expired subs that missed it (backfill) ──
        const { rows: needEmail1 } = await pool.query(`
          SELECT s.id, s.user_id, u.full_name, u.email
          FROM subscriptions s
          JOIN users u ON u.id = s.user_id
          WHERE s.status = 'expired' AND s.expiry_email_1_sent_at IS NULL
            AND u.email IS NOT NULL
        `);
        for (const sub of needEmail1) {
          try {
            await pool.query('UPDATE subscriptions SET expiry_email_1_sent_at = CURRENT_TIMESTAMP WHERE id = $1', [sub.id]);
            await sendSubscriptionExpiryEmail1(sub.email, { userName: sub.full_name || '' });
            console.log(`[SUBSCRIPTION CRON] Expiry Email 1 (backfill) sent to ${sub.email}`);
          } catch (e) {
            console.error(`[SUBSCRIPTION CRON] Failed backfill Email 1 for ${sub.email}:`, e.message);
          }
        }

        // ── Step 3: Send Email 2 (Win-Back 40% off) to subs expired >= 48h after Email 1 ──
        const { rows: readyEmail2 } = await pool.query(`
          SELECT s.id, u.full_name, u.email
          FROM subscriptions s
          JOIN users u ON u.id = s.user_id
          WHERE s.status = 'expired'
            AND s.expiry_email_1_sent_at IS NOT NULL
            AND s.expiry_email_2_sent_at IS NULL
            AND s.expiry_email_1_sent_at <= CURRENT_TIMESTAMP - INTERVAL '48 hours'
            AND u.email IS NOT NULL
        `);
        for (const sub of readyEmail2) {
          try {
            await pool.query('UPDATE subscriptions SET expiry_email_2_sent_at = CURRENT_TIMESTAMP WHERE id = $1', [sub.id]);
            await sendSubscriptionExpiryEmail2(sub.email, { userName: sub.full_name || '' });
            console.log(`[SUBSCRIPTION CRON] Expiry Email 2 (Win-Back) sent to ${sub.email}`);
          } catch (e) {
            console.error(`[SUBSCRIPTION CRON] Failed to send Expiry Email 2 to ${sub.email}:`, e.message);
          }
        }

        // Also catch users with expired end_date on the users table directly
        const { rows: expiredUsers } = await pool.query(`
          UPDATE users SET subscription_status = 'expired', subscription_tier = 'free'
          WHERE subscription_status = 'active' AND subscription_tier != 'free'
            AND subscription_end_date IS NOT NULL AND subscription_end_date < CURRENT_TIMESTAMP
          RETURNING id, full_name, email
        `);
        if (expiredUsers.length > 0) {
          console.log(`[SUBSCRIPTION CRON] Expired ${expiredUsers.length} user(s) via users table`);
          for (const user of expiredUsers) {
            try {
              if (user.email) {
                await sendSubscriptionExpiryEmail1(user.email, { userName: user.full_name || '' });
                console.log(`[SUBSCRIPTION CRON] Expiry Email 1 sent to ${user.email} (users table)`);
              }
            } catch (e) {
              console.error(`[SUBSCRIPTION CRON] Failed to send expired email to ${user.email}:`, e.message);
            }
          }
        }

        // Expire free trials that have run past 7 days
        const { rows: expiredTrials } = await pool.query(`
          UPDATE users SET subscription_tier = 'free', subscription_status = 'active'
          WHERE subscription_status = 'active' AND subscription_tier != 'free'
            AND (subscription_end_date IS NULL OR subscription_end_date < CURRENT_TIMESTAMP)
            AND trial_start_date IS NOT NULL
            AND trial_start_date < CURRENT_TIMESTAMP - INTERVAL '7 days'
          RETURNING id, full_name, email
        `);
        if (expiredTrials.length > 0) {
          console.log(`[SUBSCRIPTION CRON] Expired ${expiredTrials.length} trial(s)`);
          for (const t of expiredTrials) {
            try {
              if (t.email) {
                await sendSubscriptionExpiredEmail(t.email, { userName: t.full_name, planName: 'Pro Trial' });
              }
            } catch (e) {
              console.error(`[SUBSCRIPTION CRON] Failed to send trial expired email to ${t.email}:`, e.message);
            }
          }
        }
      } catch (err) { console.error('[SUBSCRIPTION CRON] Error:', err.message); }
    });
    console.log('[SUBSCRIPTION CRON] Expiry check scheduled every hour');

    // Schedule email sequence processing every 6 hours
    cron.schedule('0 */6 * * *', async () => {
      console.log('[EMAIL SEQ CRON] Processing pending onboarding emails...');
      try {
        const sent = await emailSequenceService.processPendingEmails();
        console.log(`[EMAIL SEQ CRON] Sent ${sent} onboarding email(s)`);
      } catch (err) {
        console.error('[EMAIL SEQ CRON] Error:', err.message);
      }
    });
    console.log('[EMAIL SEQ CRON] Onboarding email processing scheduled every 6 hours');

    // Schedule weekly market digest every Sunday at 8 AM EAT (05:00 UTC)
    cron.schedule('0 5 * * 0', () => {
      console.log('[DIGEST CRON] Running weekly market digest...');
      sendWeeklyDigestReports();
    });
    console.log('[DIGEST CRON] Weekly market digest scheduled for Sunday at 8 AM EAT');

    // Schedule daily market brief every weekday at 7 AM EAT (04:00 UTC)
    cron.schedule('0 4 * * 1-5', () => {
      console.log('[BRIEF CRON] Running daily market brief...');
      sendDailyBriefReports();
    });
    console.log('[BRIEF CRON] Daily market brief scheduled Mon-Fri at 7 AM EAT');

    // Schedule earnings report every Friday at 10 AM EAT (07:00 UTC)
    cron.schedule('0 7 * * 5', () => {
      console.log('[EARNINGS CRON] Running earnings report...');
      sendEarningsReportReports();
    });
    console.log('[EARNINGS CRON] Earnings report scheduled Friday at 10 AM EAT');
  });
