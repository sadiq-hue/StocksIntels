const { broker } = require('../apiClient');

function getBaseUrl(config = {}) {
  return config.gatewayUrl || process.env.IBKR_GATEWAY_URL || 'https://localhost:5000';
}

async function validateCredentials(apiKey, apiSecret, config = {}) {
  try {
    const baseUrl = getBaseUrl(config);
    const { data } = await broker.post(`${baseUrl}/v1/api/iserver/auth/ssodh/init`, {}, {
      headers: { 'Content-Type': 'application/json' },
      timeout: 15000,
      httpsAgent: new (require('https').Agent)({ rejectUnauthorized: false }),
    });
    return { valid: true, data };
  } catch (err) {
    return { valid: false, error: err.response?.data?.message || err.message };
  }
}

async function getAccount(apiKey, apiSecret, config = {}) {
  const baseUrl = getBaseUrl(config);
  const { data } = await broker.get(`${baseUrl}/v1/api/portfolio/accounts`, {
    httpsAgent: new (require('https').Agent)({ rejectUnauthorized: false }),
    timeout: 15000,
  });
  return data;
}

async function getPositions(apiKey, apiSecret, config = {}) {
  const baseUrl = getBaseUrl(config);
  const { data: accounts } = await broker.get(`${baseUrl}/v1/api/portfolio/accounts`, {
    httpsAgent: new (require('https').Agent)({ rejectUnauthorized: false }),
    timeout: 15000,
  });

  const allPositions = [];
  for (const acc of accounts) {
    try {
      const { data: positions } = await broker.get(
        `${baseUrl}/v1/api/portfolio/${acc.accId}/positions/0`,
        { httpsAgent: new (require('https').Agent)({ rejectUnauthorized: false }), timeout: 15000 }
      );
      for (const p of positions) {
        allPositions.push({
          symbol: p.contractDesc,
          name: p.contractDesc,
          shares: Math.abs(parseFloat(p.position)),
          avg_entry_price: parseFloat(p.avgCost),
          current_price: parseFloat(p.mktPrice),
          market_value: parseFloat(p.mktValue),
          cost_basis: Math.abs(parseFloat(p.avgCost) * parseFloat(p.position)),
          unrealized_pl: parseFloat(p.unrealizedPnl),
          side: parseFloat(p.position) >= 0 ? 'long' : 'short',
          market: 'Global',
          provider: 'ibkr',
          account_id: acc.accId,
        });
      }
    } catch { }
  }
  return allPositions;
}

async function sync(apiKey, apiSecret, userId, pool, config = {}) {
  const positions = await getPositions(apiKey, apiSecret, config);
  const connId = config.connection_id || userId;
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    for (const pos of positions) {
      await client.query(
        `INSERT INTO portfolio_holdings (user_id, ticker, name, shares, avg_cost, current_price, market, sector, broker_connection_id, updated_at)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, NOW())
         ON CONFLICT ON CONSTRAINT unique_user_ticker DO UPDATE SET
           shares = EXCLUDED.shares,
           avg_cost = EXCLUDED.avg_cost,
           current_price = EXCLUDED.current_price,
           updated_at = NOW()`,
        [userId, pos.symbol, pos.name, pos.shares, pos.avg_entry_price, pos.current_price, pos.market, 'Other', connId]
      );
    }
    await client.query('COMMIT');
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
  return { positions };
}

module.exports = { validateCredentials, getAccount, getPositions, sync };
