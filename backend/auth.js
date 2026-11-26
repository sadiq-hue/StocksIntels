const jwt = require('jsonwebtoken');
const crypto = require('crypto');
const { pool } = require('./db');

const JWT_SECRET = process.env.JWT_SECRET;
if (!JWT_SECRET) {
  console.warn('[AUTH] WARNING: JWT_SECRET is not set. Authentication will fail. Set a strong JWT_SECRET in your .env file.');
}

const ACCESS_TOKEN_EXPIRY = '15m';
const REFRESH_TOKEN_EXPIRY_DAYS = 30;
const isProduction = process.env.NODE_ENV === 'production';

function hashToken(token) {
  return crypto.createHash('sha256').update(token).digest('hex');
}

function generateToken(userId) {
  if (!JWT_SECRET) throw new Error('JWT_SECRET is not configured');
  return jwt.sign({ userId }, JWT_SECRET, { expiresIn: ACCESS_TOKEN_EXPIRY, algorithm: 'HS256' });
}

async function generateRefreshToken(userId) {
  const raw = crypto.randomBytes(40).toString('hex');
  const hashed = hashToken(raw);
  const expiresAt = new Date(Date.now() + REFRESH_TOKEN_EXPIRY_DAYS * 24 * 60 * 60 * 1000);
  await pool.query(
    `INSERT INTO refresh_tokens (user_id, token_hash, expires_at) VALUES ($1, $2, $3)`,
    [userId, hashed, expiresAt]
  );
  return raw;
}

async function verifyRefreshToken(rawToken) {
  const hashed = hashToken(rawToken);
  const res = await pool.query(
    `SELECT user_id FROM refresh_tokens WHERE token_hash = $1 AND expires_at > NOW() AND revoked = FALSE`,
    [hashed]
  );
  return res.rows[0]?.user_id || null;
}

async function revokeRefreshTokens(userId) {
  await pool.query(`UPDATE refresh_tokens SET revoked = TRUE WHERE user_id = $1`, [userId]);
}

async function revokeRefreshTokenByHash(rawToken) {
  const hashed = hashToken(rawToken);
  await pool.query(`UPDATE refresh_tokens SET revoked = TRUE WHERE token_hash = $1`, [hashed]);
}

function setRefreshCookie(res, token) {
  res.cookie('refresh_token', token, {
    httpOnly: true,
    secure: isProduction,
    sameSite: isProduction ? 'none' : 'lax',
    path: '/api/auth',
    maxAge: REFRESH_TOKEN_EXPIRY_DAYS * 24 * 60 * 60 * 1000,
  });
}

function clearRefreshCookie(res) {
  res.clearCookie('refresh_token', {
    httpOnly: true,
    secure: isProduction,
    sameSite: isProduction ? 'none' : 'lax',
    path: '/api/auth',
  });
}

async function authenticateToken(req, res, next) {
  const token = req.headers.authorization?.split(' ')[1] || req.headers['x-auth-token'] || req.cookies?.access_token;
  if (!token) {
    return res.status(401).json({ error: 'Access denied. No token provided.', code: 'NO_TOKEN' });
  }
  if (!JWT_SECRET) {
    return res.status(500).json({ error: 'Server authentication misconfigured.', code: 'NO_JWT_SECRET' });
  }
  let decoded;
  try {
    decoded = jwt.verify(token, JWT_SECRET, { algorithms: ['HS256'] });
  } catch (err) {
    if (err.name === 'TokenExpiredError') {
      return res.status(401).json({ error: 'Token expired.', code: 'TOKEN_EXPIRED' });
    }
    return res.status(401).json({ error: 'Invalid token.', code: 'INVALID_TOKEN' });
  }
  try {
    const userResult = await pool.query(
      'SELECT id, full_name, email, role, trader_type, is_verified, subscription_tier, subscription_status, trial_start_date, subscription_end_date FROM users WHERE id = $1',
      [decoded.userId]
    );
    if (userResult.rows.length === 0) {
      return res.status(401).json({ error: 'User not found. Token invalid.', code: 'USER_NOT_FOUND' });
    }
    req.user = userResult.rows[0];
    next();
  } catch (err) {
    console.error('[AUTH] DB error during user lookup:', err.message);
    return res.status(503).json({ error: 'Database temporarily unavailable. Please retry.', code: 'AUTH_DB_UNAVAILABLE' });
  }
}

function requireAdmin(req, res, next) {
  if (!req.user || (req.user.role !== 'admin' && req.user.role !== 'super_admin')) {
    return res.status(403).json({ error: 'Admin access required.', code: 'ADMIN_REQUIRED' });
  }
  next();
}

function requireSuperAdmin(req, res, next) {
  if (!req.user || req.user.role !== 'super_admin') {
    return res.status(403).json({ error: 'Super admin access required.', code: 'SUPER_ADMIN_REQUIRED' });
  }
  next();
}

function requireOwnership(req, res, next) {
  const requestedUserId = req.params.userId || req.query.userId || req.body.userId || req.body.user_id;
  if (!req.user) {
    return res.status(401).json({ error: 'Authentication required.', code: 'NO_USER' });
  }
  if (req.user.role === 'admin' || req.user.role === 'super_admin') {
    return next();
  }
  if (!requestedUserId || String(req.user.id) !== String(requestedUserId)) {
    return res.status(403).json({ error: 'Access denied. You can only access your own data.', code: 'FORBIDDEN' });
  }
  next();
}

// Sandbox key rate limiter: 1,000 requests/day per user (free tier limit)
const sandboxRateLimitMap = new Map(); // key: userId, value: { count, resetDate }

function getSandboxRateLimit(userId) {
  const now = new Date();
  const today = now.toDateString();
  const entry = sandboxRateLimitMap.get(userId);
  if (!entry || entry.resetDate !== today) {
    sandboxRateLimitMap.set(userId, { count: 0, resetDate: today });
    return { count: 0, allowed: true };
  }
  return entry;
}

async function authenticateApiKey(req, res, next) {
  const authHeader = req.headers.authorization || '';
  const parts = authHeader.split(' ');
  if (parts.length !== 2 || parts[0] !== 'Bearer') {
    return res.status(401).json({ error: 'Access denied. No API key provided.', code: 'NO_API_KEY' });
  }
  const apiKey = parts[1];
  if (!apiKey || !apiKey.startsWith('sk_')) {
    return res.status(401).json({ error: 'Invalid API key format. Expected sk_live_... or sk_sandbox_...', code: 'INVALID_API_KEY_FORMAT' });
  }
  try {
    const keyHash = crypto.createHash('sha256').update(apiKey).digest('hex');
    const result = await pool.query(
      `SELECT ak.id, ak.user_id, ak.key_type, ak.key_prefix, ak.key_suffix, u.id as owner_id, u.full_name, u.email
       FROM api_keys ak
       JOIN users u ON u.id = ak.user_id
       WHERE ak.key_hash = $1`,
      [keyHash]
    );
    if (result.rows.length === 0) {
      return res.status(401).json({ error: 'Invalid API key.', code: 'INVALID_API_KEY' });
    }
    const key = result.rows[0];
    req.apiKey = apiKey;
    req.apiKeyUser = { id: key.owner_id, full_name: key.full_name, email: key.email };
    req.apiKeyType = key.key_type;

    // Enforce free tier rate limit: 1,000 requests/day for sandbox keys
    if (key.key_type === 'sandbox') {
      const limit = getSandboxRateLimit(key.owner_id);
      if (limit.count >= 1000) {
        return res.status(429).json({
          error: 'Free tier rate limit exceeded (1,000 requests/day). Upgrade to Starter or Pro.',
          code: 'FREE_TIER_RATE_LIMIT',
        });
      }
      limit.count++;
    }

    next();
  } catch (err) {
    console.error('[AUTH] DB error during API key validation:', err.message);
    return res.status(503).json({ error: 'Database temporarily unavailable. Please retry.', code: 'AUTH_DB_UNAVAILABLE' });
  }
}

module.exports = {
  authenticateToken,
  requireAdmin,
  requireSuperAdmin,
  requireOwnership,
  authenticateApiKey,
  generateToken,
  generateRefreshToken,
  verifyRefreshToken,
  revokeRefreshTokens,
  revokeRefreshTokenByHash,
  setRefreshCookie,
  clearRefreshCookie,
};
