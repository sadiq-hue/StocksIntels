const { broker } = require('../apiClient');

function getBaseUrl(config = {}) {
  const isDemo = (config.accountType || '').toLowerCase() === 'demo' || (config.accountType || '').toLowerCase() === 'practice';
  return isDemo ? 'https://api-fxpractice.oanda.com/v3' : 'https://api-fxtrade.oanda.com/v3';
}

function getHeaders(apiKey) {
  return {
    Authorization: `Bearer ${apiKey}`,
    'Content-Type': 'application/json',
  };
}

async function validateCredentials(apiKey, apiSecret, config = {}) {
  const token = apiSecret || apiKey;
  try {
    const baseUrl = getBaseUrl(config);
    const { data } = await broker.get(`${baseUrl}/accounts`, {
      headers: getHeaders(token),
      timeout: 15000,
    });
    return { valid: true, accounts: data.accounts };
  } catch (err) {
    return { valid: false, error: err.response?.data?.errorMessage || err.message };
  }
}

function getToken(apiKey, apiSecret) {
  return apiSecret || apiKey;
}

async function getAccountSummary(token, accountId, config = {}) {
  const baseUrl = getBaseUrl(config);
  const { data } = await broker.get(`${baseUrl}/accounts/${accountId}/summary`, {
    headers: getHeaders(token),
    timeout: 15000,
  });
  return data.account;
}

async function getPositions(token, accountId, config = {}) {
  const baseUrl = getBaseUrl(config);
  try {
    const { data } = await broker.get(`${baseUrl}/accounts/${accountId}/openPositions`, {
      headers: getHeaders(token),
      timeout: 15000,
    });
    return (data.positions || []).map(p => ({
      symbol: p.instrument,
      name: p.instrument,
      volume: Math.abs(parseFloat(p.long?.units || 0) + parseFloat(p.short?.units || 0)),
      price: parseFloat(p.long?.averagePrice || p.short?.averagePrice || 0),
      price_2: parseFloat(p.long?.price || p.short?.price || 0) || parseFloat(p.long?.averagePrice || p.short?.averagePrice || 0),
      profit: (parseFloat(p.long?.unrealizedPL || 0) + parseFloat(p.short?.unrealizedPL || 0)),
      side: parseFloat(p.long?.units || 0) > 0 ? 'long' : 'short',
      market: 'Global',
      provider: 'oanda',
    }));
  } catch {
    return [];
  }
}

async function getTradeHistory(token, accountId, config = {}) {
  const baseUrl = getBaseUrl(config);
  try {
    const now = new Date();
    const from = new Date(now.getTime() - 90 * 24 * 60 * 60 * 1000).toISOString();
    const { data } = await broker.get(
      `${baseUrl}/accounts/${accountId}/transactions?type=ORDER_FILL&from=${from}`,
      { headers: getHeaders(token), timeout: 15000 }
    );
    return (data.transactions || []).filter(t => t.type === 'ORDER_FILL').map(t => ({
      time: t.time,
      type: t.units && parseFloat(t.units) > 0 ? 'buy' : 'sell',
      price: t.price,
      profit: t.pl,
      symbol: t.instrument,
      ticket: t.tradeOpenTradeID || t.id,
      volume: Math.abs(parseFloat(t.units || 0)),
      commission: t.commission,
      financing: t.financing,
    }));
  } catch {
    return [];
  }
}

async function sync(apiKey, apiSecret, userId, pool, config = {}) {
  const token = getToken(apiKey, apiSecret);
  const accountId = config.accountId || apiKey;
  const accounts = await getAccountSummary(token, accountId, config);
  if (!accounts) throw new Error('OANDA account not found');

  const positions = await getPositions(token, accountId, config);
  const tradeHistory = await getTradeHistory(token, accountId, config);

  const balance = parseFloat(accounts.balance) || 0;
  const equity = parseFloat(accounts.NAV || accounts.balance) || balance;
  const margin = parseFloat(accounts.marginUsed || 0) || 0;
  const freeMargin = equity - margin;
  const level = margin > 0 ? Math.round((equity / margin) * 100) : 0;

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
    account: { balance, equity, margin, freeMargin, level },
    positions,
    tradeHistory,
  };
}

module.exports = { validateCredentials, getAccountSummary, getPositions, getTradeHistory, sync };
