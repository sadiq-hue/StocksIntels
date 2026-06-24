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
  try {
    const token = req.headers.authorization?.split(' ')[1] || req.headers['x-auth-token'] || req.cookies?.access_token;
    if (!token) {
      return res.status(401).json({ error: 'Access denied. No token provided.', code: 'NO_TOKEN' });
    }
    if (!JWT_SECRET) {
      return res.status(500).json({ error: 'Server authentication misconfigured.', code: 'NO_JWT_SECRET' });
    }
    const decoded = jwt.verify(token, JWT_SECRET, { algorithms: ['HS256'] });
    const userResult = await pool.query(
      'SELECT id, full_name, email, role, trader_type, is_verified, subscription_tier, subscription_status, trial_start_date FROM users WHERE id = $1',
      [decoded.userId]
    );
    if (userResult.rows.length === 0) {
      return res.status(401).json({ error: 'User not found. Token invalid.', code: 'USER_NOT_FOUND' });
    }
    req.user = userResult.rows[0];
    next();
  } catch (err) {
    if (err.name === 'TokenExpiredError') {
      return res.status(401).json({ error: 'Token expired.', code: 'TOKEN_EXPIRED' });
    }
    if (err.name === 'JsonWebTokenError') {
      return res.status(401).json({ error: 'Invalid token.', code: 'INVALID_TOKEN' });
    }
    console.error('[AUTH] Token verification error:', err.message);
    return res.status(401).json({ error: 'Authentication failed.', code: 'AUTH_FAILED' });
  }
}

function requireAdmin(req, res, next) {
  if (!req.user || req.user.role !== 'admin') {
    return res.status(403).json({ error: 'Admin access required.', code: 'ADMIN_REQUIRED' });
  }
  next();
}

function requireOwnership(req, res, next) {
  const requestedUserId = req.params.userId || req.query.userId || req.body.userId || req.body.user_id;
  if (!req.user) {
    return res.status(401).json({ error: 'Authentication required.', code: 'NO_USER' });
  }
  if (req.user.role === 'admin') {
    return next();
  }
  if (!requestedUserId || String(req.user.id) !== String(requestedUserId)) {
    return res.status(403).json({ error: 'Access denied. You can only access your own data.', code: 'FORBIDDEN' });
  }
  next();
}

module.exports = {
  authenticateToken,
  requireAdmin,
  requireOwnership,
  generateToken,
  generateRefreshToken,
  verifyRefreshToken,
  revokeRefreshTokens,
  revokeRefreshTokenByHash,
  setRefreshCookie,
  clearRefreshCookie,
};
