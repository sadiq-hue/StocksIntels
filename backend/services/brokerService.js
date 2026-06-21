const crypto = require('crypto');
const { pool } = require('../db');

const ALGORITHM = 'aes-256-gcm';
const ENCRYPTION_KEY = process.env.BROKER_ENCRYPTION_KEY;

if (!ENCRYPTION_KEY) {
  console.error('[BROKER] FATAL: BROKER_ENCRYPTION_KEY is not set. Broker credential encryption will fail.');
  console.error('[BROKER] Generate a key with: node -e "console.log(require(\'crypto\').randomBytes(32).toString(\'hex\'))"');
}

function encrypt(text) {
  if (!text) return null;
  if (!ENCRYPTION_KEY) throw new Error('BROKER_ENCRYPTION_KEY is not set');
  const iv = crypto.randomBytes(16);
  const key = Buffer.from(ENCRYPTION_KEY, 'hex');
  if (key.length !== 32) throw new Error(`BROKER_ENCRYPTION_KEY must be a 64-char hex string (32 bytes), got ${ENCRYPTION_KEY.length} chars`);
  const cipher = crypto.createCipheriv(ALGORITHM, key, iv);
  let encrypted = cipher.update(text, 'utf8', 'hex');
  encrypted += cipher.final('hex');
  const authTag = cipher.getAuthTag().toString('hex');
  return JSON.stringify({ iv: iv.toString('hex'), encrypted, authTag });
}

function decrypt(encryptedPayload) {
  if (!encryptedPayload) return null;
  try {
    const { iv, encrypted, authTag } = JSON.parse(encryptedPayload);
    const key = Buffer.from(ENCRYPTION_KEY, 'hex');
    if (key.length !== 32) return null;
    const decipher = crypto.createDecipheriv(ALGORITHM, key, Buffer.from(iv, 'hex'));
    decipher.setAuthTag(Buffer.from(authTag, 'hex'));
    let decrypted = decipher.update(encrypted, 'hex', 'utf8');
    decrypted += decipher.final('utf8');
    return decrypted;
  } catch {
    return null;
  }
}

const PROVIDERS = {};

function registerProvider(name, service) {
  PROVIDERS[name] = service;
}

registerProvider('alpaca', require('./alpacaService'));
registerProvider('ibkr', require('./ibkrService'));
registerProvider('eodhd', require('./eodhdService'));
registerProvider('polygon', require('../polygonService'));
registerProvider('manual', require('./manualService'));
registerProvider('mt5', require('./mt5Service'));
// AIB-AXYS Africa provider: Kenyan NSE stockbroker, no live sync API
registerProvider('aibaxys', {
  async validateCredentials(apiKey, apiSecret, config = {}) {
    const { accountId, cdsc } = config;
    if (!apiKey && !accountId) return { valid: false, error: 'Account ID or CDSC number is required' };
    return { valid: true };
  },
  async sync(apiKey, apiSecret, userId, pool, config) {
    return { holdings: [], message: 'AIB-AXYS Africa account configured. Manual sync required for holdings.' };
  },
});

// Hisa provider: mobile investment platform, no live sync API
registerProvider('hisa', {
  async validateCredentials(apiKey, apiSecret, config = {}) {
    const { username, cdsc } = config;
    if (!apiKey && !username) return { valid: false, error: 'Account ID or username is required' };
    return { valid: true };
  },
  async sync(apiKey, apiSecret, userId, pool, config) {
    return { holdings: [], message: 'Hisa account configured. Manual sync required for holdings.' };
  },
});

// Tradier: US stock/options broker with REST API (sandbox + live)
registerProvider('tradier', require('./tradierService'));

// OANDA: forex/CFD broker with v20 REST API (practice + live)
registerProvider('oanda', require('./oandaService'));

// Generic provider: basic credential validation via server reachability
registerProvider('generic', {
  async validateCredentials(apiKey, apiSecret, config = {}) {
    const { server, accountId } = config;
    if (!server || !accountId) return { valid: false, error: 'Server and Account ID are required' };
    // Validate server: hostname, IP, or broker server name (e.g. "ICMarkets-Demo")
    if (server.length < 2 || server.length > 100) return { valid: false, error: 'Server name must be 2-100 characters' };
    if (/[<>"'\\;]/.test(server)) return { valid: false, error: 'Server name contains invalid characters' };
    // Validate account ID format (alphanumeric, hyphens, underscores, 3-50 chars)
    if (!/^[a-zA-Z0-9][a-zA-Z0-9_-]{2,49}$/.test(accountId)) return { valid: false, error: 'Account ID must be 3-50 alphanumeric characters' };
    return { valid: true };
  },
  async sync(apiKey, apiSecret, userId, pool, config) {
    // Generic sync: record the configuration, mark as connected
    return { holdings: [], message: 'Generic broker configured. Manual sync required for holdings.' };
  },
});

function getProvider(brokerType) {
  const provider = PROVIDERS[brokerType];
  if (!provider) throw new Error(`Unsupported broker type: ${brokerType}`);
  return provider;
}

async function validateConnection(brokerType, apiKey, apiSecret, config = {}) {
  const provider = getProvider(brokerType);
  if (provider.validateCredentials) {
    return await provider.validateCredentials(apiKey, apiSecret, config);
  }
  return { valid: true };
}

async function getConnectionCredentials(connectionId) {
  const { rows } = await pool.query(
    'SELECT id, user_id, broker_type, api_key, api_secret, config FROM broker_connections WHERE id = $1',
    [connectionId]
  );
  if (rows.length === 0) throw new Error('Broker connection not found');
  const conn = rows[0];
  return {
    ...conn,
    api_key: decrypt(conn.api_key) || conn.api_key,
    api_secret: decrypt(conn.api_secret) || conn.api_secret,
    config: typeof conn.config === 'string' ? JSON.parse(conn.config) : (conn.config || {}),
  };
}

async function syncConnection(connectionId) {
  const conn = await getConnectionCredentials(connectionId);
  const provider = getProvider(conn.broker_type);

  await pool.query(
    'UPDATE broker_connections SET sync_status = $1 WHERE id = $2',
    ['syncing', connectionId]
  );

  try {
    let result;
    const syncConfig = { ...conn.config, connection_id: conn.id };
    if (conn.broker_type === 'eodhd') {
      result = await provider.sync(conn.api_key, conn.user_id, pool, syncConfig);
    } else {
      result = await provider.sync(conn.api_key, conn.api_secret, conn.user_id, pool, syncConfig);
    }

    // Store latest account info on broker_connections (quick cache)
    const accountInfo = result.account ? {
      ...result.account,
      positionsCount: (result.positions || []).length,
    } : null;

    await pool.query(
      'UPDATE broker_connections SET sync_status = $1, last_sync_at = NOW(), error_message = NULL, account_info = COALESCE($2::jsonb, account_info) WHERE id = $3',
      ['idle', accountInfo ? JSON.stringify(accountInfo) : null, connectionId]
    );

    // Insert snapshot row for history (balance, equity, positions, trade history)
    let snapshotId = null;
    if (result.account) {
      const snap = await pool.query(
        `INSERT INTO broker_account_snapshots (broker_connection_id, balance, equity, margin, free_margin, level, positions, trade_history)
         VALUES ($1, $2, $3, $4, $5, $6, $7::jsonb, $8::jsonb) RETURNING id`,
        [
          connectionId,
          result.account.balance,
          result.account.equity,
          result.account.margin,
          result.account.freeMargin,
          result.account.level,
          JSON.stringify(result.positions || []),
          JSON.stringify(result.tradeHistory || []),
        ]
      );
      snapshotId = snap.rows[0].id;
    }

    // Sync positions to portfolio_holdings so MT5 positions appear in stock portfolio
    try {
      await syncPositionsToHoldings(pool, conn.user_id, connectionId, result.positions);
    } catch (posErr) {
      console.error(`Error syncing positions to holdings for connection ${connectionId}:`, posErr.message);
    }

    return { success: true, snapshotId, ...result };
  } catch (err) {
    await pool.query(
      'UPDATE broker_connections SET sync_status = $1, error_message = $2 WHERE id = $3',
      ['error', err.message, connectionId]
    );
    return { success: false, error: err.message };
  }
}

async function syncAllForUser(userId) {
  const { rows } = await pool.query(
    'SELECT id FROM broker_connections WHERE user_id = $1 AND connected = true',
    [userId]
  );
  const results = [];
  for (const row of rows) {
    const result = await syncConnection(row.id);
    results.push({ connectionId: row.id, ...result });
  }
  return results;
}

async function saveConnection(userId, brokerType, accountName, apiKey, apiSecret, config = {}) {
  const { rows } = await pool.query(
    `INSERT INTO broker_connections (user_id, broker_type, account_name, api_key, api_secret, config, connected)
     VALUES ($1, $2, $3, $4, $5, $6, true)
     RETURNING id, user_id, broker_type, account_name, connected, sync_status, created_at`,
    [userId, brokerType, accountName, encrypt(apiKey), encrypt(apiSecret), JSON.stringify(config)]
  );
  return rows[0];
}

async function getConnections(userId) {
  const { rows } = await pool.query(
    `SELECT id, user_id, broker_type, account_name, connected, sync_status, last_sync_at, error_message, created_at, account_info, config
     FROM broker_connections WHERE user_id = $1 ORDER BY created_at DESC`,
    [userId]
  );

  // Fetch latest snapshot per connection
  const ids = rows.map(r => r.id);
  let snapshots = [];
  if (ids.length > 0) {
    const snapRes = await pool.query(
      `SELECT DISTINCT ON (broker_connection_id) broker_connection_id, id, balance, equity, margin, free_margin, level, positions, trade_history, snapshot_at
       FROM broker_account_snapshots
       WHERE broker_connection_id = ANY($1::int[])
       ORDER BY broker_connection_id, snapshot_at DESC`,
      [ids]
    );
    snapshots = snapRes.rows;
  }
  const snapMap = {};
  for (const s of snapshots) {
    snapMap[s.broker_connection_id] = s;
  }

  return rows.map(r => ({
    ...r,
    account_info: typeof r.account_info === 'string' ? JSON.parse(r.account_info) : (r.account_info || {}),
    config: typeof r.config === 'string' ? JSON.parse(r.config) : (r.config || {}),
    latest_snapshot: snapMap[r.id] ? {
      ...snapMap[r.id],
      positions: typeof snapMap[r.id].positions === 'string'
        ? JSON.parse(snapMap[r.id].positions)
        : (snapMap[r.id].positions || []),
      trade_history: typeof snapMap[r.id].trade_history === 'string'
        ? JSON.parse(snapMap[r.id].trade_history)
        : (snapMap[r.id].trade_history || []),
      snapshot_at: snapMap[r.id].snapshot_at ? snapMap[r.id].snapshot_at.toISOString() : null,
    } : null,
    last_sync_at: r.last_sync_at ? r.last_sync_at.toISOString() : null,
    created_at: r.created_at ? r.created_at.toISOString() : null,
  }));
}

async function deleteConnection(id, userId) {
  const { rowCount } = await pool.query(
    'DELETE FROM broker_connections WHERE id = $1 AND user_id = $2',
    [id, userId]
  );
  return rowCount > 0;
}

function detectSector(symbol) {
  if (!symbol) return 'Other';
  const s = symbol.toUpperCase();
  if (/^[A-Z]{6}$/.test(s)) return 'Forex';
  if (/^X(AU|AG|PD|PT|CU)/.test(s)) return 'Commodities';
  if (/^(US30|US100|SPX500|NAS100|JP225|UK100|GER40|FRA40|AUS200|EU50|HK50|CN50)/.test(s)) return 'Indices';
  if (/^(BTC|ETH|XRP|LTC|BCH|ADA|DOT|LINK|SOL|DOGE)/.test(s)) return 'Crypto';
  if (/^#/.test(s)) return 'Stock';
  return 'CFD';
}

async function syncPositionsToHoldings(pool, userId, connectionId, positions) {
  // Delete all existing broker-synced holdings for this connection
  await pool.query(
    'DELETE FROM portfolio_holdings WHERE user_id = $1 AND broker_connection_id = $2',
    [userId, connectionId]
  );

  if (!positions || positions.length === 0) return;

  // Insert each position as a holding
  for (const pos of positions) {
    const ticker = (pos.symbol || '').toUpperCase();
    if (!ticker) continue;

    const volume = parseFloat(String(pos.volume || '0').replace(/[,\s]/g, ''));
    const avgCost = parseFloat(String(pos.price || '0').replace(/[,\s]/g, ''));
    // Try to find current market price from broker data (Price 2, Current Price, etc.)
    const currentPriceRaw = pos.price_2 || pos.current_price || pos.current || pos.market_price || pos.last_price || null;
    const currentPrice = currentPriceRaw ? parseFloat(String(currentPriceRaw).replace(/[,\s]/g, '')) : null;
    const type = (pos.type || '').toLowerCase();

    if (!volume || volume <= 0) continue;

    const sector = detectSector(ticker);

    await pool.query(
      `INSERT INTO portfolio_holdings (user_id, ticker, name, shares, avg_cost, current_price, sector, market, broker_connection_id)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
       ON CONFLICT (user_id, ticker, broker_connection_id) DO UPDATE
         SET shares = $4, avg_cost = $5, current_price = $6, name = $3, sector = $7, market = $8, updated_at = NOW()`,
      [
        userId,
        ticker,
        type ? `${type.toUpperCase()} ${ticker}` : ticker,
        volume,
        avgCost || 0,
        currentPrice && currentPrice > 0 ? currentPrice : null,
        sector,
        'Global',
        connectionId,
      ]
    );
  }
}

module.exports = {
  encrypt,
  decrypt,
  registerProvider,
  validateConnection,
  getConnectionCredentials,
  syncConnection,
  syncAllForUser,
  saveConnection,
  getConnections,
  deleteConnection,
  syncPositionsToHoldings,
  PROVIDERS,
};
