// StockIntel Backend Server
// Rewritten clean version with all routes from original
require('dotenv').config();
const express = require('express');
const http = require('http');
const cors = require('cors');
const axios = require('axios');
const bcrypt = require('bcryptjs');
const { Server } = require('socket.io');
const { getAllNews, KENYAN_STOCKS } = require('./newsService');
const { getBonds, getBondById, getBondSummary } = require('./bondsService');
const { getETFs, getETFByTicker, getETFSummary } = require('./etfsService');
const { generateSignals, getSignalForStock, getSignalsSummary, warmFMPCache, ALL_SYMBOLS } = require('./signalService');
const { getStockQuote, getQuotesBatch, getCompanyName, getSyntheticQuote } = require('./marketService');
const { pool, testConnection } = require('./db');
const queueService = require('./queueService');
const signalPublisher = require('./signalPublisher');
const {
  getCompanyProfile, getQuote, getIncomeStatement, getBalanceSheet,
  getCashFlowStatement, getKeyMetrics, getDividendHistory, getFinancialReport,
  simfinService, clearCache: clearFinancialCache
} = require('./financialReportsService');
const brokerService = require('./services/brokerService');
const fxService = require('./fxService');

const app = express();
const server = http.createServer(app);
const io = new Server(server, {
  cors: { origin: process.env.CORS_ORIGIN || "http://localhost:5173", methods: ["GET", "POST"] }
});

app.use(cors({
  origin: process.env.CORS_ORIGIN || "http://localhost:5173",
  methods: ["GET", "POST", "PUT", "DELETE", "OPTIONS"],
  allowedHeaders: ["Content-Type", "Authorization", "X-Requested-With"]
}));
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

const port = process.env.PORT || 3001;
const onlineUsers = new Map();

io.on('connection', (socket) => {
  console.log(`Socket connected: ${socket.id}`);
  let currentUserId = null;
  socket.emit('online_users', Array.from(onlineUsers.keys()));
  socket.on('identify_user', (userId) => {
    currentUserId = userId;
    socket.data.userId = userId;
    socket.join(`user:${userId}`);
    if (!onlineUsers.has(userId)) {
      onlineUsers.set(userId, new Set());
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
      }
      io.emit('online_users', Array.from(onlineUsers.keys()));
    }
    console.log(`Socket disconnected: ${socket.id}`);
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

// ===================== API ROUTES =====================

// --- Auth Routes ---
app.post('/api/auth/register', async (req, res) => {
  try {
    const { fullName, email, password } = req.body;
    if (!fullName || !email || !password) return res.status(400).json({ error: 'All fields required' });
    const existing = await pool.query('SELECT id FROM users WHERE email = $1', [email]);
    if (existing.rows.length > 0) return res.status(409).json({ error: 'Email already registered' });
    const hashedPassword = await bcrypt.hash(password, 10);
    const result = await pool.query(
      'INSERT INTO users (full_name, email, password_hash) VALUES ($1, $2, $3) RETURNING id, full_name, email, role, created_at',
      [fullName, email, hashedPassword]
    );
    await pool.query('INSERT INTO paper_accounts (user_id) VALUES ($1)', [result.rows[0].id]);
    res.status(201).json({ user: result.rows[0] });
  } catch (error) {
    console.error('Register error:', error.message);
    res.status(500).json({ error: 'Registration failed' });
  }
});

app.post('/api/auth/login', async (req, res) => {
  try {
    const { email, password } = req.body;
    if (!email || !password) return res.status(400).json({ error: 'Email and password required' });
    const result = await pool.query('SELECT * FROM users WHERE email = $1', [email]);
    if (result.rows.length === 0) return res.status(401).json({ error: 'Invalid credentials' });
    const user = result.rows[0];
    const valid = await bcrypt.compare(password, user.password_hash);
    if (!valid) return res.status(401).json({ error: 'Invalid credentials' });
    const { password_hash, ...safeUser } = user;
    res.json({ user: safeUser });
  } catch (error) {
    console.error('Login error:', error.message);
    res.status(500).json({ error: 'Login failed' });
  }
});

app.get('/api/auth/me', async (req, res) => {
  try {
    const userId = req.query.userId;
    if (!userId) return res.status(401).json({ error: 'Not authenticated' });
    const result = await pool.query('SELECT id, full_name, email, role, trader_type, is_verified, created_at FROM users WHERE id = $1', [userId]);
    if (result.rows.length === 0) return res.status(404).json({ error: 'User not found' });
    res.json({ user: result.rows[0] });
  } catch (error) {
    res.status(500).json({ error: error.message });
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
    res.status(500).json({ error: error.message });
  }
});

app.get('/api/quotes', async (req, res) => {
  try {
    const symbols = req.query.symbols ? req.query.symbols.split(',') : [];
    if (symbols.length === 0) return res.json([]);
    const quotes = await Promise.all(symbols.map(s => getStockQuote(s.trim().toUpperCase()).catch(() => null)));
    res.json(quotes.filter(Boolean));
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

app.get('/api/signals', async (req, res) => {
  try {
    const signals = await getSignalsSummary();
    res.json(signals);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

app.get('/api/signals/summary', async (req, res) => {
  try {
    const summary = await getSignalsSummary();
    res.json(summary);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

app.get('/api/signal/:symbol', async (req, res) => {
  try {
    const symbol = req.params.symbol.toUpperCase();
    const signal = await getSignalForStock(symbol);
    if (!signal) return res.status(404).json({ error: 'No signal found' });
    res.json(signal);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

app.get('/api/company/:symbol/profile', async (req, res) => {
  try {
    const symbol = req.params.symbol.toUpperCase();
    const profile = await getCompanyProfile(symbol);
    res.json(profile || {});
  } catch (error) {
    res.status(500).json({ error: error.message });
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
    res.status(500).json({ error: error.message });
  }
});

// --- News Routes ---
app.get('/api/news', async (req, res) => {
  try {
    const limit = parseInt(req.query.limit) || 20;
    const news = await getAllNews(limit);
    res.json(news);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

app.get('/api/news/kenyan', async (req, res) => {
  try {
    res.json({ stocks: KENYAN_STOCKS });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// --- Watchlist Routes ---
app.get('/api/watchlist', async (req, res) => {
  try {
    const userId = req.query.userId;
    if (!userId) return res.status(400).json({ error: 'userId required' });
    const result = await pool.query('SELECT * FROM watchlist_items ORDER BY created_at DESC');
    res.json(result.rows);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

app.post('/api/watchlist', async (req, res) => {
  try {
    const { symbol, company_name, notes, target_price } = req.body;
    const result = await pool.query(
      `INSERT INTO watchlist_items (symbol, company_name, notes, target_price)
       VALUES ($1, $2, $3, $4)
       ON CONFLICT (symbol) DO UPDATE SET company_name = $2, notes = $3, target_price = $4
       RETURNING *`,
      [symbol?.toUpperCase(), company_name, notes, target_price]
    );
    res.status(201).json(result.rows[0]);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

app.delete('/api/watchlist/:symbol', async (req, res) => {
  try {
    const symbol = req.params.symbol.toUpperCase();
    await pool.query('DELETE FROM watchlist_items WHERE symbol = $1', [symbol]);
    res.json({ success: true });
  } catch (error) {
    res.status(500).json({ error: error.message });
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
    res.status(500).json({ error: error.message });
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
    res.status(500).json({ error: error.message });
  }
});

app.get('/api/portfolio/:userId/account', async (req, res) => {
  try {
    const userId = req.params.userId;
    const result = await pool.query('SELECT * FROM paper_accounts WHERE user_id = $1', [userId]);
    res.json(result.rows[0] || null);
  } catch (error) {
    res.status(500).json({ error: error.message });
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
    res.status(201).json(result.rows[0]);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

app.delete('/api/portfolio/holdings/:id', async (req, res) => {
  try {
    await pool.query('DELETE FROM portfolio_holdings WHERE id = $1', [req.params.id]);
    res.json({ success: true });
  } catch (error) {
    res.status(500).json({ error: error.message });
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
    res.status(201).json(result.rows[0]);
  } catch (error) {
    res.status(500).json({ error: error.message });
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
    res.status(500).json({ error: error.message });
  }
});

// --- Broker Routes ---
app.get('/api/brokers/:userId', async (req, res) => {
  try {
    const userId = req.params.userId;
    const connections = await brokerService.getConnections(userId);
    const syncableBrokers = brokerService.getSyncableBrokers();
    res.json({ connections, syncableBrokers });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

app.post('/api/brokers/connect', async (req, res) => {
  try {
    const connection = await brokerService.connectBroker(req.body);
    res.status(201).json(connection);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

app.post('/api/brokers/sync/:connectionId', async (req, res) => {
  try {
    const result = await brokerService.syncBroker(req.params.connectionId);
    res.json(result);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

app.delete('/api/brokers/:connectionId', async (req, res) => {
  try {
    await brokerService.removeConnection(req.params.connectionId);
    res.json({ success: true });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// --- Social/Trading Groups Routes ---
app.get('/api/groups', async (req, res) => {
  try {
    const result = await pool.query('SELECT * FROM trading_groups ORDER BY name');
    res.json(result.rows);
  } catch (error) {
    res.status(500).json({ error: error.message });
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
    res.status(500).json({ error: error.message });
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
    io.to(`group:${groupId}`).emit('new_message', msg);
    res.status(201).json(msg);
  } catch (error) {
    res.status(500).json({ error: error.message });
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
    res.status(500).json({ error: error.message });
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
    io.to(`user:${recipient_id}`).emit('new_message', msg);
    res.status(201).json(msg);
  } catch (error) {
    res.status(500).json({ error: error.message });
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
    res.status(500).json({ error: error.message });
  }
});

app.post('/api/notifications/:id/read', async (req, res) => {
  try {
    await pool.query('UPDATE notifications SET read = true WHERE id = $1', [req.params.id]);
    res.json({ success: true });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// --- Financial Reports Routes ---
app.get('/api/financials/:symbol', async (req, res) => {
  try {
    const symbol = req.params.symbol.toUpperCase();
    const [income, balance, cashflow, profile] = await Promise.all([
      getIncomeStatement(symbol).catch(() => null),
      getBalanceSheet(symbol).catch(() => null),
      getCashFlowStatement(symbol).catch(() => null),
      getCompanyProfile(symbol).catch(() => null),
    ]);
    res.json({ incomeStatement: income, balanceSheet: balance, cashFlow: cashflow, profile });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

app.get('/api/financials/:symbol/income', async (req, res) => {
  try {
    const symbol = req.params.symbol.toUpperCase();
    const data = await getIncomeStatement(symbol);
    res.json(data || []);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

app.get('/api/financials/:symbol/balance', async (req, res) => {
  try {
    const symbol = req.params.symbol.toUpperCase();
    const data = await getBalanceSheet(symbol);
    res.json(data || []);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

app.get('/api/financials/:symbol/cashflow', async (req, res) => {
  try {
    const symbol = req.params.symbol.toUpperCase();
    const data = await getCashFlowStatement(symbol);
    res.json(data || []);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

app.get('/api/financials/:symbol/metrics', async (req, res) => {
  try {
    const symbol = req.params.symbol.toUpperCase();
    const data = await getKeyMetrics(symbol);
    res.json(data || []);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

app.get('/api/financials/:symbol/dividends', async (req, res) => {
  try {
    const symbol = req.params.symbol.toUpperCase();
    const limit = parseInt(req.query.limit) || 8;
    const data = await getDividendHistory(symbol, limit);
    res.json({ success: true, data: data || [] });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// --- Bond Routes ---
app.get('/api/bonds', async (req, res) => {
  try {
    const bonds = await getBonds();
    res.json(bonds);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

app.get('/api/bonds/summary', async (req, res) => {
  try {
    const summary = await getBondSummary();
    res.json(summary);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

app.get('/api/bonds/:id', async (req, res) => {
  try {
    const bond = await getBondById(req.params.id);
    if (!bond) return res.status(404).json({ error: 'Bond not found' });
    res.json(bond);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// --- ETF Routes ---
app.get('/api/etfs', async (req, res) => {
  try {
    const etfs = await getETFs();
    res.json(etfs);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

app.get('/api/etfs/summary', async (req, res) => {
  try {
    const summary = await getETFSummary();
    res.json(summary);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

app.get('/api/etfs/:ticker', async (req, res) => {
  try {
    const etf = await getETFByTicker(req.params.ticker.toUpperCase());
    if (!etf) return res.status(404).json({ error: 'ETF not found' });
    res.json(etf);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// --- FX Routes ---
app.get('/api/fx/rate', async (req, res) => {
  try {
    const rate = await fxService.getRate();
    res.json({ rate });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

app.get('/api/fx/convert', async (req, res) => {
  try {
    const { amount, from, to } = req.query;
    const result = await fxService.convert(parseFloat(amount), from, to);
    res.json(result);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// --- NSE Market Data Routes ---
app.get('/api/market/nse', async (req, res) => {
  try {
    const symbols = KENYAN_STOCKS.map(s => s.symbol);
    const quotes = await Promise.all(symbols.map(s => getStockQuote(s).catch(() => null)));
    const filtered = quotes.filter(Boolean).map(q => ({
      ...q,
      volumeFormatted: formatVolume(q.volume),
      turnoverFormatted: formatTurnover(q.turnover),
    }));
    res.json(filtered);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

app.get('/api/market/us', async (req, res) => {
  try {
    const symbols = ['AAPL','MSFT','GOOGL','AMZN','NVDA','META','TSLA','JPM','V','NFLX'];
    const quotes = await Promise.all(symbols.map(s => getStockQuote(s).catch(() => null)));
    res.json(quotes.filter(Boolean));
  } catch (error) {
    res.status(500).json({ error: error.message });
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
    res.status(500).json({ error: error.message });
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
    res.status(500).json({ error: error.message });
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
    res.status(500).json({ error: error.message });
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
    res.status(500).json({ error: error.message });
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
    res.status(500).json({ error: error.message });
  }
});

// --- Health Check ---
app.get('/api/health', (req, res) => {
  res.json({ status: 'ok', timestamp: new Date().toISOString(), uptime: process.uptime() });
});

// ===================== DATABASE INIT =====================

async function initDatabase() {
  try {
    await pool.query('DROP TABLE IF EXISTS watchlist_items CASCADE;');
    await pool.query(`CREATE TABLE IF NOT EXISTS watchlist_items (
      id SERIAL PRIMARY KEY, symbol VARCHAR(20) UNIQUE NOT NULL,
      company_name VARCHAR(255) NOT NULL, notes TEXT,
      target_price NUMERIC(15,2),
      created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
      updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
    );`);
    await pool.query(`ALTER TABLE watchlist_items ADD COLUMN IF NOT EXISTS company_name VARCHAR(255) DEFAULT 'Unknown'`);
    await pool.query(`ALTER TABLE watchlist_items ADD COLUMN IF NOT EXISTS target_price NUMERIC(15,2)`);
    await pool.query(`ALTER TABLE watchlist_items ADD COLUMN IF NOT EXISTS notes TEXT`);

    await pool.query(`CREATE TABLE IF NOT EXISTS users (
      id SERIAL PRIMARY KEY, full_name VARCHAR(255) NOT NULL,
      email VARCHAR(255) UNIQUE NOT NULL, password_hash TEXT NOT NULL,
      role VARCHAR(50) DEFAULT 'trader', trader_type VARCHAR(50) DEFAULT 'retail',
      is_verified BOOLEAN DEFAULT false,
      created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
      updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
    );`);

    await pool.query(`CREATE TABLE IF NOT EXISTS trading_groups (
      id TEXT PRIMARY KEY, name TEXT NOT NULL, description TEXT,
      icon TEXT DEFAULT '📊', topic TEXT DEFAULT 'General'
    );`);

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
    await pool.query('ALTER TABLE portfolio_holdings ADD CONSTRAINT unique_user_ticker UNIQUE (user_id, ticker)');

    await pool.query(`CREATE TABLE IF NOT EXISTS broker_connections (
      id SERIAL PRIMARY KEY, user_id INTEGER REFERENCES users(id) ON DELETE CASCADE,
      broker_type VARCHAR(50) NOT NULL, account_name VARCHAR(255) NOT NULL,
      api_key TEXT, connected BOOLEAN DEFAULT true,
      created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
    );`);

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

    console.log('Database schema verified');
  } catch (err) {
    console.error('Database initialization failed:', err.message);
  }
}

// ===================== START SERVER =====================

initDatabase().then(() => {
  server.listen(port, '0.0.0.0', async () => {
    console.log(`Backend server running at http://localhost:${port}`);
    try {
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
      queueService.onSignalNotification((payload) => {
        if (payload.batch) {
          payload.notifications.forEach((n) => {
            io.to(`user:${n.user_id}`).emit('notification', n);
          });
        }
      });
      signalPublisher.start();
      console.log('Redis pub/sub and signal publisher initialized');
      // Deferred warmFMPCache - don't await, fire and forget
      warmFMPCache(ALL_SYMBOLS).catch(() => {});
    } catch (err) {
      console.warn('Redis unavailable - signal publisher disabled:', err.message);
      console.warn('Signal generation will happen on-demand via REST endpoints.');
    }
  });
});
