const { broker } = require('../apiClient');

function getBaseUrl(config = {}) {
  const isDemo = (config.accountType || '').toLowerCase() === 'demo' || (config.accountType || '').toLowerCase() === 'paper';
  return isDemo ? 'https://sandbox.tradier.com/v1' : 'https://api.tradier.com/v1';
}

function getToken(apiKey, apiSecret) {
  return apiSecret || apiKey;
}

function getHeaders(token) {
  return {
    Authorization: `Bearer ${token}`,
    Accept: 'application/json',
  };
}

async function validateCredentials(apiKey, apiSecret, config = {}) {
  const token = getToken(apiKey, apiSecret);
  try {
    const baseUrl = getBaseUrl(config);
    const { data } = await broker.get(`${baseUrl}/user/profile`, {
      headers: getHeaders(token),
      timeout: 15000,
    });
    return { valid: true, account: data.profile };
  } catch (err) {
    return { valid: false, error: err.response?.data?.errors?.error || err.message };
  }
}

async function getAccounts(token, config = {}) {
  const baseUrl = getBaseUrl(config);
  const { data } = await broker.get(`${baseUrl}/user/balances`, {
    headers: getHeaders(token),
    timeout: 15000,
  });
  return data.accounts || [];
}

async function getPositions(token, accountId, config = {}) {
  const baseUrl = getBaseUrl(config);
  try {
    const { data } = await broker.get(`${baseUrl}/accounts/${accountId}/positions`, {
      headers: getHeaders(token),
      timeout: 15000,
    });
    const positions = data.positions?.position || [];
    const arr = Array.isArray(positions) ? positions : [positions];
    return arr.filter(p => p && p.symbol).map(p => ({
      symbol: p.symbol,
      name: p.description || p.symbol,
      volume: parseFloat(p.quantity) || 0,
      price: parseFloat(p.cost_basis) || 0,
      price_2: parseFloat(p.market_value) && parseFloat(p.quantity) ? parseFloat(p.market_value) / parseFloat(p.quantity) : 0,
      profit: parseFloat(p.unrealized_pl) || 0,
      market_value: parseFloat(p.market_value) || 0,
      cost_basis: parseFloat(p.cost_basis) || 0,
      side: parseFloat(p.quantity) >= 0 ? 'long' : 'short',
      market: 'Global',
      provider: 'tradier',
    }));
  } catch {
    return [];
  }
}

async function getOrders(token, accountId, config = {}) {
  const baseUrl = getBaseUrl(config);
  try {
    const { data } = await broker.get(`${baseUrl}/accounts/${accountId}/orders?includeTags=true`, {
      headers: getHeaders(token),
      timeout: 15000,
    });
    const orders = data.orders?.order || [];
    const arr = Array.isArray(orders) ? orders : [orders];
    return arr.filter(o => o && o.id).map(o => ({
      time: o.transaction_date || o.create_date || o.last_fill_date,
      type: o.side,
      price: o.price || o.avg_fill_price,
      profit: o.net_amount ? -parseFloat(o.net_amount) : null,
      symbol: o.symbol,
      ticket: String(o.id),
      volume: o.quantity,
      status: o.status,
      commission: o.commission,
    }));
  } catch {
    return [];
  }
}

async function sync(apiKey, apiSecret, userId, pool, config = {}) {
  const token = getToken(apiKey, apiSecret);
  const accounts = await getAccounts(token, config);
  if (!accounts || accounts.length === 0) throw new Error('No Tradier accounts found');

  const acc = Array.isArray(accounts) ? accounts[0] : accounts;
  const accountInfo = acc.account || acc;
  const accountId = String(accountInfo.account_number || config.accountId);

  const positions = await getPositions(apiKey, accountId, config);
  const orders = await getOrders(apiKey, accountId, config);

  const balance = parseFloat(accountInfo.total_cash) || 0;
  const equity = parseFloat(accountInfo.net_liquidation) || balance;
  const buyingPower = parseFloat(accountInfo.buying_power) || 0;

  const connId = config.connection_id || userId;
  if (positions.length > 0) {
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
          [userId, pos.symbol, pos.name, pos.volume, pos.price, pos.price_2, 'Global', 'Other', connId]
        );
      }
      await client.query('COMMIT');
    } catch (err) {
      await client.query('ROLLBACK');
      throw err;
    } finally {
      client.release();
    }
  }

  return {
    account: {
      balance,
      equity,
      margin: 0,
      freeMargin: buyingPower,
      level: 100,
    },
    positions,
    tradeHistory: orders,
  };
}

module.exports = { validateCredentials, getAccounts, getPositions, getOrders, sync };
