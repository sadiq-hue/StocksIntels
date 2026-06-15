const jwt = require('jsonwebtoken');
const { pool } = require('./db');

const JWT_SECRET = process.env.JWT_SECRET;
if (!JWT_SECRET) {
  console.warn('[AUTH] WARNING: JWT_SECRET is not set. Authentication will fail. Set a strong JWT_SECRET in your .env file.');
}

/**
 * Verify JWT token and attach user to request.
 */
async function authenticateToken(req, res, next) {
  try {
    const token = req.headers.authorization?.split(' ')[1] || req.headers['x-auth-token'];
    if (!token) {
      return res.status(401).json({ error: 'Access denied. No token provided.', code: 'NO_TOKEN' });
    }
    if (!JWT_SECRET) {
      return res.status(500).json({ error: 'Server authentication misconfigured.', code: 'NO_JWT_SECRET' });
    }
    const decoded = jwt.verify(token, JWT_SECRET, { algorithms: ['HS256'] });
    // Verify user still exists in DB
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
      return res.status(401).json({ error: 'Token expired. Please log in again.', code: 'TOKEN_EXPIRED' });
    }
    if (err.name === 'JsonWebTokenError') {
      return res.status(401).json({ error: 'Invalid token.', code: 'INVALID_TOKEN' });
    }
    console.error('[AUTH] Token verification error:', err.message);
    return res.status(401).json({ error: 'Authentication failed.', code: 'AUTH_FAILED' });
  }
}

/**
 * Require admin role.
 */
function requireAdmin(req, res, next) {
  if (!req.user || req.user.role !== 'admin') {
    return res.status(403).json({ error: 'Admin access required.', code: 'ADMIN_REQUIRED' });
  }
  next();
}

/**
 * Ensure the requested userId matches the authenticated user (IDOR fix).
 * Supports req.params.userId, req.query.userId, req.body.userId
 */
function requireOwnership(req, res, next) {
  const requestedUserId = req.params.userId || req.query.userId || req.body.userId || req.body.user_id;
  if (!req.user) {
    return res.status(401).json({ error: 'Authentication required.', code: 'NO_USER' });
  }
  if (req.user.role === 'admin') {
    return next(); // Admin can access any user's data
  }
  if (!requestedUserId || String(req.user.id) !== String(requestedUserId)) {
    return res.status(403).json({ error: 'Access denied. You can only access your own data.', code: 'FORBIDDEN' });
  }
  next();
}

/**
 * Generate a JWT token for a user.
 */
function generateToken(userId) {
  if (!JWT_SECRET) throw new Error('JWT_SECRET is not configured');
  return jwt.sign({ userId }, JWT_SECRET, { expiresIn: '7d', algorithm: 'HS256' });
}

module.exports = {
  authenticateToken,
  requireAdmin,
  requireOwnership,
  generateToken,
};
