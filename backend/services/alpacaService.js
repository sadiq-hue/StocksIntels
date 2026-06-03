const { broker } = require('../apiClient');

const ALPACA_BASE = process.env.ALPACA_API_BASE || 'https://paper-api.alpaca.markets';
const ALPACA_DATA_BASE = 'https://data.alpaca.markets';

function getHeaders(apiKey, apiSecret) {
  return {
    'APCA-API-KEY-ID': apiKey,
    'APCA-API-SECRET-KEY': apiSecret,
    'Content-Type': 'application/json',
  };
}

async function validateCredentials(apiKey, apiSecret) {
  try {
    const { data } = await broker.get(`${ALPACA_BASE}/v2/account`, {
      headers: getHeaders(apiKey, apiSecret),
      timeout: 10000,
    });
    return { valid: true, account: data };
  } catch (err) {
    return { valid: false, error: err.response?.data?.message || err.message };
  }
}

async function getAccount(apiKey, apiSecret) {
  const { data } = await broker.get(`${ALPACA_BASE}/v2/account`, {
    headers: getHeaders(apiKey, apiSecret),
    timeout: 10000,
  });
  return {
    id: data.id,
    account_number: data.account_number,
    status: data.status,
    currency: 'USD',
    cash: parseFloat(data.cash),
    portfolio_value: parseFloat(data.portfolio_value),
    pattern_day_trader: data.pattern_day_trader,
    trade_suspended: data.trading_checked,
    buying_power: parseFloat(data.buying_power),
    created_at: data.created_at,
  };
}

async function getPositions(apiKey, apiSecret) {
  const { data } = await broker.get(`${ALPACA_BASE}/v2/positions`, {
    headers: getHeaders(apiKey, apiSecret),
    timeout: 10000,
  });
  return data.map(p => ({
    symbol: p.symbol,
    name: p.symbol,
    shares: parseFloat(p.qty),
    avg_entry_price: parseFloat(p.avg_entry_price),
    current_price: parseFloat(p.current_price),
    market_value: parseFloat(p.market_value),
    cost_basis: parseFloat(p.cost_basis),
    unrealized_pl: parseFloat(p.unrealized_pl),
    unrealized_plpc: parseFloat(p.unrealized_plpc),
    change_today: parseFloat(p.change_today),
    side: p.side,
    market: 'Global',
    provider: 'alpaca',
  }));
}

async function getOrders(apiKey, apiSecret) {
  try {
    const { data } = await broker.get(`${ALPACA_BASE}/v2/orders?status=all&limit=50&direction=desc`, {
      headers: getHeaders(apiKey, apiSecret),
      timeout: 10000,
    });
    return (data || []).map(o => ({
      time: o.created_at,
      type: o.side,
      price: o.filled_avg_price || o.limit_price,
      profit: o.filled_qty ? null : null,
      symbol: o.symbol,
      ticket: o.id,
      volume: o.filled_qty || o.qty,
      status: o.status,
    }));
  } catch {
    return [];
  }
}

async function sync(apiKey, apiSecret, userId, pool, config = {}) {
  const positions = await getPositions(apiKey, apiSecret);
  const account = await getAccount(apiKey, apiSecret);
  const tradeHistory = await getOrders(apiKey, apiSecret);
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
  return { positions, account, tradeHistory };
}

module.exports = { validateCredentials, getAccount, getPositions, sync };
