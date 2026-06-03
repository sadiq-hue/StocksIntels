const { eodhd } = require('../apiClient');

const EODHD_BASE = 'https://eodhd.com/api';

async function validateCredentials(apiKey) {
  try {
    const { data } = await eodhd.get(`${EODHD_BASE}/api-info`, {
      params: { api_token: apiKey, fmt: 'json' },
      timeout: 10000,
    });
    return { valid: true, data };
  } catch (err) {
    return { valid: false, error: err.response?.data?.message || err.message };
  }
}

async function getPortfolio(symbols, apiKey) {
  if (!symbols || symbols.length === 0) return [];
  const results = [];
  const batchSize = 10;
  for (let i = 0; i < symbols.length; i += batchSize) {
    const batch = symbols.slice(i, i + batchSize);
    const promises = batch.map(async (sym) => {
      try {
        const exchange = sym.exchange || 'US';
        const { data } = await eodhd.get(`${EODHD_BASE}/real-time/${sym.ticker}.${exchange}`, {
          params: { api_token: apiKey, fmt: 'json' },
          timeout: 10000,
        });
        if (data && data.close !== undefined) {
          return {
            symbol: sym.ticker,
            name: sym.name || sym.ticker,
            shares: parseFloat(sym.shares) || 0,
            avg_entry_price: parseFloat(sym.avgCost) || 0,
            current_price: parseFloat(data.close),
            market_value: parseFloat(data.close) * (parseFloat(sym.shares) || 0),
            cost_basis: (parseFloat(sym.avgCost) || 0) * (parseFloat(sym.shares) || 0),
            change_today: parseFloat(data.change) || 0,
            market: sym.market || 'Global',
            provider: 'eodhd',
          };
        }
      } catch { }
      return null;
    });
    const resolved = await Promise.all(promises);
    results.push(...resolved.filter(Boolean));
  }
  return results;
}

async function sync(apiKey, userId, pool) {
  const { rows } = await pool.query(
    'SELECT ticker, name, shares, avg_cost, market FROM portfolio_holdings WHERE user_id = $1',
    [userId]
  );
  const symbols = rows.map(r => ({
    ticker: r.ticker,
    name: r.name,
    shares: r.shares,
    avgCost: r.avg_cost,
    market: r.market,
    exchange: r.market === 'NSE' ? 'XNSE' : 'US',
  }));
  const positions = await getPortfolio(symbols, apiKey);
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    for (const pos of positions) {
      await client.query(
        `UPDATE portfolio_holdings SET current_price = $1, updated_at = NOW()
         WHERE user_id = $2 AND ticker = $3`,
        [pos.current_price, userId, pos.symbol]
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

module.exports = { validateCredentials, getPortfolio, sync };
