// StocksIntels Backend Server
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
const { generateSignals, getSignalForStock, getSignalsSummary, warmFMPCache, ALL_SYMBOLS, searchStocks } = require('./signalService');
const { getStockQuote, getQuotesBatch, getCompanyName, getSyntheticQuote } = require('./marketService');
const { pool, testConnection } = require('./db');
const queueService = require('./queueService');
const signalPublisher = require('./signalPublisher');
const { sendResetCode, sendOtpEmail, sendPortfolioReportEmail } = require('./mailer');
const cron = require('node-cron');
const {
  getCompanyProfile, getQuote, getIncomeStatement, getBalanceSheet,
  getCashFlowStatement, getKeyMetrics, getDividendHistory, getFinancialReport,
  simfinService, clearCache: clearFinancialCache
} = require('./financialReportsService');
const brokerService = require('./services/brokerService');
const fxService = require('./fxService');
const payheroService = require('./payheroService');
const paydService = require('./paydService');
const indicesService = require('./indicesService');
const { generalLimiter, authLimiter, marketDataLimiter, aiLimiter } = require('./rateLimiter');

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
app.use(generalLimiter);
app.use('/api/auth', authLimiter);
app.use('/api/ai', aiLimiter);

const port = process.env.PORT || 3001;
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
      const { senderId, senderName, content, groupId, recipientId, messageType } = data;
      if (!content || !content.trim()) return;

      if (senderId) lastSeen.set(Number(senderId), new Date());
      const result = await pool.query(
        `INSERT INTO messages (sender_id, sender_name, content, message_type, group_id, recipient_id)
         VALUES ($1, $2, $3, $4, $5, $6)
         RETURNING id, sender_id, sender_name, content, message_type, group_id, recipient_id, created_at`,
        [senderId || null, senderName || 'Anonymous', content.trim(), messageType || 'user', groupId || null, recipientId || null]
      );
      const msg = result.rows[0];

      // Broadcast to room (includes sender so they get the server-assigned id)
      if (groupId) {
        io.to(`group:${groupId}`).emit('receive_message', msg);
      } else if (recipientId) {
        const room = [String(senderId), String(recipientId)].sort().join(':pm');
        io.to(room).emit('receive_message', msg);
      }

      // Stock mention → AI assistant response
      const stockMatch = content.match(/\b(SCOM|EQTY|KCB|EABL|ABSA|SBIC|KLG|BAMB|KPLC|NMG|TOTL|COOP|IMH|LKL|KNRE|CIC|HFCK|STAN|JUB|UMEM|CRAY|OLYM)\b/i);
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
  const NSE_TICKERS = ['SCOM', 'EQTY', 'KCB', 'EABL', 'ABSA', 'SBIC', 'KLG', 'OLYM', 'CRAY', 'BAMB', 'UMEM', 'KPLC', 'NMG', 'TOTL', 'STAN', 'COOP', 'JUB', 'KNRE', 'LKL', 'CIC', 'HFCK', 'IMH'];
  const GLOBAL_TICKERS = ['AAPL', 'MSFT', 'NVDA', 'TSLA', 'AMZN', 'GOOGL', 'META'];
  const indexSymbols = ['NSE:NSE20', 'NSE:NSEASI', 'NSE:NSE25', 'NSE:NSE15'];
  const stockSymbols = [...NSE_TICKERS.map(t => 'NSE:' + t), ...GLOBAL_TICKERS];
  const allQuotes = await getQuotesBatch([...indexSymbols, ...stockSymbols]);
  const indices = indexSymbols.map(symbol => {
    const data = allQuotes[symbol] || { symbol, price: 0, change: 0, changePercent: 0, volume: 0 };
    return {
      name: symbol === 'NSE:NSE20' ? 'NSE 20 Share Index'
        : symbol === 'NSE:NSEASI' ? 'NSE All Share Index'
        : symbol === 'NSE:NSE25' ? 'NSE 25 Share Index' : 'NSE 15 Index',
      symbol, currency: 'KES',
      value: (data.price || 0).toFixed(2),
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
      price: (data.price || 0).toFixed(2),
      currency: data.currency || (symbol.startsWith('NSE:') ? 'KES' : 'USD'),
      change: (data.change >= 0 ? '+' : '') + (data.changePercent || 0).toFixed(2) + '%',
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
  try {
    const sym = market === 'NSE' ? 'NSE:' + ticker : ticker;
    const quote = await getStockQuote(sym).catch(() => null);
    if (quote && quote.price) return quote.price;
  } catch {}
  return null;
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

// --- OTP & Password Reset ---
app.post('/api/auth/send-otp', async (req, res) => {
  try {
    const { email } = req.body;
    if (!email) return res.status(400).json({ error: 'Email required' });
    const code = Math.floor(100000 + Math.random() * 900000).toString();
    const expiresAt = new Date(Date.now() + 10 * 60 * 1000);
    await pool.query('DELETE FROM otp_codes WHERE email = $1 AND type = $2', [email, 'login']);
    await pool.query('INSERT INTO otp_codes (email, code, type, expires_at) VALUES ($1, $2, $3, $4)', [email, code, 'login', expiresAt]);
    await sendOtpEmail(email, code).catch(e => console.error('[MAILER] send-otp failed:', e.message));
    console.log(`[OTP] Login code for ${email}: ${code}`);
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
    let userResult = await pool.query('SELECT id, full_name, email, role, trader_type, is_verified, created_at FROM users WHERE email = $1', [email]);
    if (userResult.rows.length === 0) {
      userResult = await pool.query(
        'INSERT INTO users (full_name, email, password_hash, is_verified) VALUES ($1, $2, $3, TRUE) RETURNING id, full_name, email, role, trader_type, is_verified, created_at',
        [email, email, 'otp_only', email]
      );
      await pool.query('INSERT INTO paper_accounts (user_id) VALUES ($1)', [userResult.rows[0].id]);
    }
    res.json({ user: userResult.rows[0] });
  } catch (error) {
    console.error('verify-otp error:', error.message);
    res.status(500).json({ error: 'OTP verification failed' });
  }
});

app.post('/api/auth/forgot-password', async (req, res) => {
  try {
    const { email } = req.body;
    if (!email) return res.status(400).json({ error: 'Email required' });
    const exists = await pool.query('SELECT id FROM users WHERE email = $1', [email]);
    if (exists.rows.length === 0) return res.status(404).json({ error: 'No account with this email' });
    const code = Math.floor(100000 + Math.random() * 900000).toString();
    const expiresAt = new Date(Date.now() + 15 * 60 * 1000);
    await pool.query('DELETE FROM otp_codes WHERE email = $1 AND type = $2', [email, 'password_reset']);
    await pool.query('INSERT INTO otp_codes (email, code, type, expires_at) VALUES ($1, $2, $3, $4)', [email, code, 'password_reset', expiresAt]);
    await sendResetCode(email, code).catch(e => console.error('[MAILER] forgot-password failed:', e.message));
    console.log(`[RESET] Password reset code for ${email}: ${code}`);
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
    const signals = await generateSignals();
    res.json({ success: true, signals });
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

// ── Portfolio Statement (must be BEFORE :userId param route) ──
app.get('/api/portfolio/statement', async (req, res) => {
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
    let historyRes, prevDay;
    try {
      historyRes = await pool.query(
        `SELECT total_value, invested_value, snapshot_date FROM portfolio_value_history
         WHERE user_id = $1 AND snapshot_date >= $2 ORDER BY snapshot_date ASC`,
        [userId, historyFrom]
      );
    } catch {
      historyRes = { rows: [] };
    }

    try {
      const yesterday = new Date(now.getTime() - 24 * 60 * 60 * 1000);
      prevDay = await pool.query(
        `SELECT total_value, snapshot_date FROM portfolio_value_history WHERE user_id = $1 AND snapshot_date <= $2 ORDER BY snapshot_date DESC LIMIT 1`,
        [userId, yesterday]
      );
    } catch {
      prevDay = { rows: [] };
    }

    // Fetch broker trade history + open positions (before early return so broker-only users get data)
    let tradeHistory = [];
    let brokerHoldings = [];
    let brokerEquity = 0;
    let brokerBalance = 0;
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
    const holdings = [];
    let nseValue = 0, globalValue = 0, nseCost = 0, globalCost = 0;

    for (const r of rows) {
      const livePrice = await getLivePrice(r.market, r.ticker) || parseFloat(r.current_price) || parseFloat(r.avg_cost) || 0;
      const avgC = parseFloat(r.avg_cost) || 0;
      const shares = parseFloat(r.shares) || 0;
      const val = livePrice * shares;
      const cost = avgC * shares;
      const pnlVal = val - cost;
      const pnlPctVal = cost > 0 ? ((val - cost) / cost * 100) : 0;

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

    // Daily change — only compute from a snapshot within the last 2 days
    let dailyChange = 0;
    let dailyChangePercent = 0;
    if (prevDay.rows.length > 0) {
      const prevTotal = parseFloat(prevDay.rows[0].total_value);
      const prevDate = prevDay.rows[0].snapshot_date ? new Date(prevDay.rows[0].snapshot_date) : null;
      const daysDiff = prevDate ? (now - prevDate) / (24 * 60 * 60 * 1000) : Infinity;
      if (daysDiff <= 2) {
        dailyChange = totalValue - prevTotal;
        dailyChangePercent = prevTotal > 0 ? (dailyChange / prevTotal) * 100 : 0;
      }
    }

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

    // Best/worst performers (skip broker positions)
    const sortedByPnl = [...holdings].filter(h => !h._brokerName).sort((a, b) => b.pnlPercent - a.pnlPercent);
    const performers = sortedByPnl.filter(h => h.pnlPercent !== 0);
    const bestPerformers = performers.slice(0, 5);
    const worstPerformers = performers.slice(-5).reverse();

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
    res.status(500).json({ error: 'Failed to generate portfolio statement', detail: err.message, stack: err.stack?.split('\n').slice(0, 5).join('; ') });
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

    // Fetch portfolio value history
    const cutoff = new Date(Date.now() - days * 24 * 60 * 60 * 1000);
    const { rows: snapshots } = await pool.query(
      `SELECT total_value, snapshot_date FROM portfolio_value_history
       WHERE user_id = $1 AND snapshot_date >= $2 ORDER BY snapshot_date ASC`,
      [userId, cutoff]
    );

    // Get current portfolio value and account info
    const { rows: accountRows } = await pool.query(
      'SELECT initial_capital, initial_capital_usd FROM paper_accounts WHERE user_id = $1', [userId]
    );
    const fxRate = await getFxRate();
    const currentPv = await getPortfolioValue(userId);
    const currentValue = currentPv ? currentPv.combinedValue : 0;
    const initialCapital = accountRows.length > 0
      ? parseFloat(accountRows[0].initial_capital) + parseFloat(accountRows[0].initial_capital_usd) * fxRate
      : 1000000;

    const numPeriods = snapshots.length;
    const allPeriods = ['1D', '1W', '1M', '3M', '6M', '1Y', 'ALL'];
    const performance = {};
    for (const p of allPeriods) {
      const pd = periodMap[p];
      const cutoffP = new Date(Date.now() - pd * 24 * 60 * 60 * 1000);
      const filtered = snapshots.filter(s => new Date(s.snapshot_date) >= cutoffP);
      const startVal = filtered.length > 0 ? parseFloat(filtered[0].total_value) : initialCapital;
      const endVal = filtered.length > 0 ? parseFloat(filtered[filtered.length - 1].total_value) : currentValue;
      performance[p] = {
        startValue: startVal,
        endValue: endVal,
        return: endVal - startVal,
        returnPercent: startVal > 0 ? ((endVal - startVal) / startVal) * 100 : 0,
      };
    }

    res.json({
      generatedAt: new Date().toISOString(),
      summary: {
        currentValue: Math.round(currentValue * 100) / 100,
        initialCapital: Math.round(initialCapital * 100) / 100,
        totalReturn: Math.round((currentValue - initialCapital) * 100) / 100,
        totalReturnPercent: initialCapital > 0 ? Math.round(((currentValue - initialCapital) / initialCapital) * 1000) / 10 : 0,
        numPeriods,
      },
      performance,
      history: snapshots.map(s => ({
        date: s.snapshot_date.toISOString(),
        value: parseFloat(s.total_value),
      })),
    });
  } catch (err) {
    console.error('Error generating portfolio performance:', err);
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
    snapshotPortfolioValue(user_id).catch(() => {});
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
    snapshotPortfolioValue(user_id).catch(() => {});
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
    res.status(500).json({ error: error.message || 'Failed to create broker connection' });
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
    res.status(500).json({ error: error.message || 'Failed to parse email' });
  }
});

app.post('/api/broker-connections/validate', async (req, res) => {
  try {
    const { brokerType, apiKey, apiSecret, config } = req.body;
    if (!brokerType) return res.status(400).json({ error: 'brokerType is required' });
    const result = await brokerService.validateConnection(brokerType || 'generic', apiKey || '', apiSecret || '', config || {});
    res.json(result);
  } catch (error) {
    res.json({ valid: false, error: error.message });
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
    res.status(500).json({ error: error.message || 'Failed to sync broker connection' });
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
      SELECT g.id, g.name, g.description, g.icon, g.topic,
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
        online_members: onlineCount,
        trending: g.activity_last_hour > 0 && g.activity_last_hour >= g.members * 0.1,
      };
    });
    res.json(groups);
  } catch (error) {
    console.error('Error fetching groups:', error.message);
    try {
      const result = await pool.query('SELECT * FROM trading_groups ORDER BY name');
      const groups = result.rows.map(g => ({ ...g, members: 0, message_count: 0, activity_last_hour: 0, isJoined: false, online_members: 0, trending: false, createdAt: 0 }));
      res.json(groups);
    } catch {
      res.json([]);
    }
  }
});

app.post('/api/groups', async (req, res) => {
  try {
    const { id, name, description, icon, topic } = req.body;
    if (!id || !name) return res.status(400).json({ error: 'id and name are required' });
    const result = await pool.query(
      `INSERT INTO trading_groups (id, name, description, icon, topic)
       VALUES ($1, $2, $3, $4, $5)
       ON CONFLICT (id) DO UPDATE SET name = $2, description = $3, icon = $4, topic = $5
       RETURNING *`,
      [id, name, description || '', icon || '📊', topic || 'General']
    );
    res.status(201).json(result.rows[0]);
  } catch (error) {
    console.error('Error creating group:', error.message);
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
    io.to(`group:${groupId}`).emit('receive_message', msg);
    res.status(201).json(msg);
  } catch (error) {
    res.status(500).json({ error: error.message });
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
    res.status(500).json({ error: error.message });
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
    io.to(`user:${recipient_id}`).emit('receive_message', msg);
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

app.post('/api/notifications/read-all', async (req, res) => {
  try {
    const { userId } = req.body;
    if (!userId) return res.status(400).json({ error: 'userId is required' });
    await pool.query('UPDATE notifications SET read = true WHERE user_id = $1', [userId]);
    res.json({ success: true });
  } catch (error) {
    res.status(500).json({ error: error.message });
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
      message: 'Financial data providers: FMP, SEC EDGAR, SimFin',
    });
  } catch (error) {
    res.status(500).json({ error: error.message });
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
    res.status(500).json({ success: false, error: error.message, lastUpdated: new Date().toISOString() });
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

app.get('/api/users/:id', async (req, res) => {
  try {
    const { id } = req.params;
    const { rows } = await pool.query(
      'SELECT id, full_name, email, created_at, updated_at FROM users WHERE id = $1',
      [id]
    );
    if (rows.length === 0) return res.status(404).json({ error: 'User not found' });
    res.json(rows[0]);
  } catch (error) {
    console.error('Error fetching user:', error.message);
    res.status(500).json({ error: 'Failed to fetch user' });
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
        'SELECT id, full_name, email, role, trader_type, is_verified FROM users ORDER BY full_name'
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
app.get('/api/stocks', async (req, res) => {
  try {
    const allSignals = await generateSignals();
    res.json(allSignals);
  } catch (error) {
    console.error('Error fetching all stocks:', error);
    res.status(500).json({ error: 'Failed to fetch stocks list' });
  }
});

// Returns all stocks from the database (comprehensive list of NSE + Global)
app.get('/api/stocks/list', async (req, res) => {
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
    console.error('Error fetching stocks list:', error.message);
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

// --- Stock Screener Routes ---
app.get('/api/screener/criteria', async (req, res) => {
  try {
    const signals = await generateSignals();
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
    res.status(500).json({ error: error.message });
  }
});

app.get('/api/screener', async (req, res) => {
  try {
    const signals = await generateSignals();
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
    res.json({ nse: snapshot.nse.movers, global: snapshot.global.movers, combined: snapshot.movers });
  } catch (error) {
    console.error('Error fetching movers:', error);
    res.status(500).json({ error: 'Failed to fetch top movers' });
  }
});

app.get('/api/earnings/criteria', async (req, res) => {
  try {
    const { getEarningsCriteria } = require('./earningsService');
    const criteria = await getEarningsCriteria();
    res.json(criteria);
  } catch (error) {
    res.status(500).json({ error: error.message });
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
      `SELECT id, user_id, ticker, name, shares, avg_cost, current_price, sector, market, broker_connection_id, created_at, updated_at
       FROM portfolio_holdings WHERE user_id = $1 ORDER BY ticker`,
      [userId]
    );
    const fxRate = await getFxRate();
    let nseValue = 0, globalValue = 0;
    for (const r of rows) {
      const price = parseFloat(r.current_price) || parseFloat(r.avg_cost) || 0;
      const shares = parseFloat(r.shares) || 0;
      const val = price * shares;
      if (r.market === 'NSE') nseValue += val;
      else globalValue += val;
    }
    const combinedValueKes = nseValue + globalValue * fxRate;
    res.json({ holdings: rows, fxRate, combinedValueKes: Math.round(combinedValueKes * 100) / 100 });
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
    res.status(500).json({ error: error.message });
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
    res.status(500).json({ error: error.message });
  }
});

app.delete('/api/holdings/:id', async (req, res) => {
  try {
    const result = await pool.query('DELETE FROM portfolio_holdings WHERE id = $1 RETURNING id', [req.params.id]);
    if (result.rows.length === 0) return res.status(404).json({ error: 'Holding not found' });
    res.json({ success: true });
  } catch (error) {
    console.error('Error deleting holding:', error.message);
    res.status(500).json({ error: error.message });
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
    res.status(500).json({ error: error.message });
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

app.post('/api/market/quotes', async (req, res) => {
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
    let nsePortfolioValue = parseFloat(account.cash_balance);
    let usdPortfolioValue = parseFloat(account.cash_balance_usd);
    const enrichedPositions = [];
    for (const p of positions) {
      const livePrice = await getLivePrice(p.market, p.ticker) || parseFloat(p.avg_cost);
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
    const fxRate = await getFxRate();
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
  return {
    id: t.id, ticker: t.ticker, name: t.name,
    shares: parseFloat(t.shares) || 0, price: parseFloat(t.price) || 0,
    type: t.type, market: t.market, currency: t.currency,
    totalValue: parseFloat(t.total_value) || 0,
    commission: parseFloat(t.commission) || 0, fees: parseFloat(t.fees) || 0,
    date: t.created_at,
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

    // Look up live price
    const livePrice = await getLivePrice(market || 'NSE', ticker);
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
    res.status(500).json({ error: error.message });
  }
});

app.get('/api/paper/statement', async (req, res) => {
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
    const totalCommission = trades.rows.reduce((s, t) => s + parseFloat(t.commission || 0), 0);
    const totalFees = trades.rows.reduce((s, t) => s + parseFloat(t.fees || 0), 0);
    const totalCommissionUsd = trades.rows.filter(t => t.currency === 'USD').reduce((s, t) => s + parseFloat(t.commission || 0), 0);
    const totalFeesUsd = trades.rows.filter(t => t.currency === 'USD').reduce((s, t) => s + parseFloat(t.fees || 0), 0);
    let realizedPnl = 0, realizedPnlUsd = 0;
    for (const t of trades.rows) {
      if (t.type === 'sell') {
        const purchase = trades.rows.find(t2 => t2.ticker === t.ticker && t2.type === 'buy' && t2.created_at < t.created_at);
        if (purchase) {
          const pnl = (parseFloat(t.price) - parseFloat(purchase.price)) * parseFloat(t.shares);
          if (t.currency === 'USD') realizedPnlUsd += pnl; else realizedPnl += pnl;
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
        totalCommission, totalFees, totalCommissionUsd, totalFeesUsd,
        realizedPnl, realizedPnlUsd,
        totalCommissionKes: totalCommission,
        totalFeesKes: totalFees,
        realizedPnlKes: realizedPnl,
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
    const { phoneNumber, amount, plan, customerName, userId } = req.body;
    if (!phoneNumber || !amount) {
      return res.status(400).json({ error: 'Phone number and amount required' });
    }
    const cleanedPhone = phoneNumber.replace(/\D/g, '');
    const formattedPhone = cleanedPhone.startsWith('0')
      ? '254' + cleanedPhone.slice(1)
      : cleanedPhone.startsWith('254')
        ? cleanedPhone
        : '254' + cleanedPhone;
    if (!formattedPhone.match(/^254[17]\d{8}$/)) {
      return res.status(400).json({ error: 'Invalid Kenyan phone number' });
    }
    const result = await payheroService.sendStkPush({
      amount: Math.round(amount),
      phoneNumber: formattedPhone,
      customerName: customerName || 'StocksIntels User',
    });
    await pool.query(
      `INSERT INTO payment_transactions (user_id, amount, currency, provider, phone_number, external_reference, payhero_reference, status, plan_name)
       VALUES ($1, $2, 'KES', 'm-pesa', $3, $4, $5, $6, $7)`,
      [userId || null, amount, formattedPhone, result.externalReference, result.reference, result.status.toLowerCase(), plan || null]
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
    res.status(500).json({ error: 'Failed to initiate payment. Please try again.', detail: error.response?.data || error.message });
  }
});

app.post('/api/payments/callback', async (req, res) => {
  try {
    const callbackData = req.body;
    console.log('PayHero callback received:', JSON.stringify(callbackData));
    const reference = callbackData.reference || callbackData.external_reference;
    const rawStatus = (callbackData.status || '').toLowerCase();
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
          'SELECT id, user_id, phone_number, plan_name FROM payment_transactions WHERE payhero_reference = $1 OR external_reference = $1',
          [reference]
        );
        if (tx.rows.length > 0) {
          const { id, user_id, phone_number, plan_name } = tx.rows[0];
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
            await pool.query(
              `UPDATE users SET subscription_tier = $1, subscription_status = 'active' WHERE id = $2`,
              [tier, targetUserId]
            );
            console.log(`Subscription activated: user=${targetUserId} tier=${tier}`);
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
              await pool.query(
                `UPDATE users SET subscription_tier = $1, subscription_status = 'active' WHERE id = $2`,
                [tier, tx.rows[0].user_id]
              );
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

// --- Payd Card Payment Routes ---
app.post('/api/payments/payd-card', async (req, res) => {
  try {
    const { phoneNumber, amount, narration } = req.body;
    if (!phoneNumber || !amount) {
      return res.status(400).json({ error: 'Phone number and amount required' });
    }
    if (amount < 100) {
      return res.status(400).json({ error: 'Minimum amount is 100 KES' });
    }
    const result = await paydService.createCardCheckout({
      amount,
      phoneNumber,
      narration: narration || 'StocksIntels Subscription',
    });
    res.json({
      success: true,
      checkoutUrl: result.checkoutUrl,
    });
  } catch (error) {
    console.error('Payd card checkout error:', error.message);
    res.status(500).json({ error: 'Failed to create checkout session' });
  }
});

app.post('/api/payments/payd-callback', async (req, res) => {
  try {
    const payload = req.body;
    const signature = req.headers['x-payd-signature'];
    if (signature) {
      try {
        paydService.verifyWebhookSignature(payload, signature);
      } catch {
        console.warn('Payd webhook signature verification failed');
      }
    }
    const reference = payload.reference || payload.external_reference;
    const status = payload.status === 'SUCCESS' || payload.status === 'success' ? 'success'
      : payload.status === 'FAILED' || payload.status === 'failed' ? 'failed'
      : 'pending';
    if (reference) {
      await pool.query(
        `UPDATE payment_transactions SET status = $1, callback_data = $2, updated_at = NOW()
         WHERE external_reference = $3`,
        [status, JSON.stringify(payload), reference]
      );
      if (status === 'success') {
        const tx = await pool.query(
          'SELECT user_id FROM payment_transactions WHERE external_reference = $1',
          [reference]
        );
        if (tx.rows.length > 0 && tx.rows[0].user_id) {
          await pool.query(
            `UPDATE users SET subscription_tier = 'pro', subscription_status = 'active' WHERE id = $1`,
            [tx.rows[0].user_id]
          );
        }
      }
    }
    res.json({ received: true });
  } catch (error) {
    console.error('Payd callback error:', error.message);
    res.json({ received: true });
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
    if (parseInt(planCount.rows[0].count) === 0) {
      await pool.query(`INSERT INTO subscription_plans (name, description, price_kes, price_usd, features) VALUES
        ('Starter', 'Perfect for beginners exploring the markets', 130, 1.00, '["Real-time NSE data", "3 AI signals per day", "Basic portfolio tracking", "Email support"]'),
        ('Pro', 'For active traders who need an edge', 3500, 29, '["Everything in Starter", "Unlimited AI signals", "Global market data", "Advanced analytics", "Risk analysis tools", "Priority support"]'),
        ('Enterprise', 'For institutions and professional teams', 12000, 99, '["Everything in Pro", "Custom data feeds", "White-label analytics", "Full API access", "24/7 dedicated support", "Unlimited team members"]')
      `);
    } else {
      await pool.query(`UPDATE subscription_plans SET price_kes = 130, price_usd = 1.00 WHERE name = 'Starter'`);
    }

    await pool.query(`ALTER TABLE users ADD COLUMN IF NOT EXISTS subscription_tier VARCHAR(50) DEFAULT 'free'`);
    await pool.query(`ALTER TABLE users ADD COLUMN IF NOT EXISTS subscription_status VARCHAR(20) DEFAULT 'active'`);

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
          `SELECT id, ticker, name, shares, avg_cost, current_price, sector, market FROM portfolio_holdings WHERE user_id = $1 ORDER BY ticker`,
          [user.id]
        );
        if (rows.length === 0) continue;
        const fxRate = await getFxRate();
        const holdings = [];
        let nseValue = 0, globalValue = 0, nseCost = 0, globalCost = 0;
        for (const r of rows) {
          const lp = await getLivePrice(r.market, r.ticker) || parseFloat(r.current_price) || parseFloat(r.avg_cost) || 0;
          const ac = parseFloat(r.avg_cost) || 0;
          const sh = parseFloat(r.shares) || 0;
          const val = lp * sh, cost = ac * sh;
          if (r.market === 'NSE') { nseValue += val; nseCost += cost; } else { globalValue += val; globalCost += cost; }
          holdings.push({
            ticker: r.ticker, name: r.name || r.ticker, shares: sh, currentPrice: lp,
            value: val, pnl: val - cost, pnlPercent: cost > 0 ? Math.round(((val - cost) / cost * 100) * 10) / 10 : 0,
            sector: r.sector || 'Other', market: r.market || 'NSE',
          });
        }
        const tv = nseValue + globalValue * fxRate, tc = nseCost + globalCost * fxRate;
        const sectorMap = {};
        for (const h of holdings) { const vk = h.market === 'NSE' ? h.value : h.value * fxRate; sectorMap[h.sector] = (sectorMap[h.sector] || 0) + vk; }
        const sa = Object.entries(sectorMap).map(([s, v]) => ({ sector: s, value: v, pct: tv > 0 ? Math.round((v / tv) * 100) : 0 })).sort((a, b) => b.value - a.value);
        const sp = [...holdings].sort((a, b) => b.pnlPercent - a.pnlPercent).filter(h => h.pnlPercent !== 0);
        await sendPortfolioReportEmail(user.email, {
          userName: user.full_name, generatedAt: new Date().toISOString(),
          summary: { totalValue: Math.round(tv * 100) / 100, totalCost: Math.round(tc * 100) / 100, totalPnL: Math.round((tv - tc) * 100) / 100, pnlPercent: tc > 0 ? Math.round(((tv - tc) / tc) * 1000) / 10 : 0 },
          holdings, sectorAllocation: sa, bestPerformers: sp.slice(0, 5), worstPerformers: sp.slice(-5).reverse(),
        });
        console.log(`[DAILY REPORT] Report sent to ${user.email}`);
      } catch (e) { console.error(`[DAILY REPORT] Error for user ${user.id}:`, e.message); }
    }
    console.log('[DAILY REPORT] Finished');
  } catch (e) { console.error('[DAILY REPORT] Error:', e.message); }
}

// ===================== START SERVER =====================

server.on('error', (err) => {
  if (err.code === 'EADDRINUSE') {
    console.error(`Port ${port} is in use. Retrying in 3s...`);
    setTimeout(() => server.close(() => server.listen(port, '0.0.0.0')), 3000);
  } else {
    console.error('Server error:', err.message);
  }
});

process.on('uncaughtException', (err) => {
  if (err.code === 'EADDRINUSE') {
    console.error(`Port ${port} is in use. Retrying in 3s...`);
    setTimeout(() => server.close(() => server.listen(port, '0.0.0.0')), 3000);
  } else {
    console.error('Uncaught exception:', err.message);
  }
});

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

    // Schedule daily portfolio report (outside Redis try-catch so it always runs)
    cron.schedule('0 0 * * 1-5', () => {
      console.log('[CRON] Running daily portfolio report...');
      sendDailyPortfolioReports();
    });
    console.log('[CRON] Daily portfolio report scheduled Mon-Fri every 5 min');
  });
});
