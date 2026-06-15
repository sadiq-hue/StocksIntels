// Order Router — fill simulation, position manager, P&L tracking.
// Simulates order execution with configurable slippage and partial fills.

const { pool } = require('./db');

// ─── Position Manager ──────────────────────────────────────────────────────
const _positions = new Map(); // symbol → { shares, entryPrice, currentPrice, pnl, openedAt }

function getPosition(symbol) {
  return _positions.get(symbol) || null;
}

function getAllPositions() {
  const result = [];
  for (const [symbol, pos] of _positions) {
    result.push({ symbol, ...pos });
  }
  return result;
}

// ─── Fill Simulation ───────────────────────────────────────────────────────
// Simulates order execution with slippage based on market cap / liquidity tier.
// liquidityTier: 'large' (S&P500), 'mid', 'small' (NSE), 'micro'
function simulateFill(symbol, side, shares, currentPrice, liquidityTier = 'mid') {
  const slippageMap = { large: 0.001, mid: 0.003, small: 0.008, micro: 0.015 };
  const slippage = slippageMap[liquidityTier] || 0.005;

  // Simulate partial fill probability (worse for large orders relative to liquidity)
  const fillProb = liquidityTier === 'large' ? 0.98 : liquidityTier === 'mid' ? 0.95 : 0.85;
  const filled = Math.random() < fillProb ? shares : Math.floor(shares * (0.5 + Math.random() * 0.4));

  // Slippage-adjusted fill price
  const direction = side === 'buy' ? 1 : -1;
  const fillPrice = currentPrice * (1 + direction * slippage);

  return {
    filled,
    fillPrice: Math.round(fillPrice * 100) / 100,
    slippage: Math.round(slippage * 10000) / 100 + '%',
    timestamp: new Date().toISOString(),
  };
}

// ─── Execute Order ─────────────────────────────────────────────────────────
// Creates a simulated order, updates position, and records in trade_log.
async function executeOrder({ symbol, side, type, shares, price, liquidityTier, signalId, reason }) {
  const fill = simulateFill(symbol, side, shares, price, liquidityTier);
  if (fill.filled <= 0) return { status: 'rejected', reason: 'No fill' };

  const existing = _positions.get(symbol);
  if (side === 'buy') {
    const avgPrice = existing
      ? (existing.shares * existing.entryPrice + fill.filled * fill.fillPrice) / (existing.shares + fill.filled)
      : fill.fillPrice;
    _positions.set(symbol, {
      shares: (existing ? existing.shares : 0) + fill.filled,
      entryPrice: Math.round(avgPrice * 100) / 100,
      currentPrice: price,
      pnl: 0,
      openedAt: existing ? existing.openedAt : new Date().toISOString(),
    });
  } else if (side === 'sell') {
    if (!existing || existing.shares < fill.filled) {
      return { status: 'rejected', reason: 'Insufficient shares' };
    }
    const pnl = fill.filled * (fill.fillPrice - existing.entryPrice);
    existing.shares -= fill.filled;
    if (existing.shares <= 0) {
      _positions.delete(symbol);
    } else {
      _positions.set(symbol, existing);
    }
    // Record trade
    try {
      await pool.query(
        `INSERT INTO trade_log (ticker, side, shares, fill_price, slippage, pnl, signal_id, reason, executed_at)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, NOW())`,
        [symbol, side, fill.filled, fill.fillPrice, fill.slippage, Math.round(pnl * 100) / 100, signalId, reason || '']
      );
    } catch { /* table may not exist */ }
    return { status: 'filled', ...fill, pnl: Math.round(pnl * 100) / 100 };
  }

  return { status: 'filled', ...fill };
}

// ─── Update Positions P&L ─────────────────────────────────────────────────
// Called each cycle to mark positions to market.
function updatePositions(marketPrices) {
  let totalPnl = 0;
  for (const [symbol, pos] of _positions) {
    const mp = marketPrices[symbol];
    if (mp) {
      pos.currentPrice = mp;
      pos.pnl = Math.round((mp - pos.entryPrice) * pos.shares * 100) / 100;
      pos.pnlPercent = Math.round(((mp - pos.entryPrice) / pos.entryPrice) * 1000) / 10;
    }
    totalPnl += pos.pnl || 0;
  }
  return totalPnl;
}

// ─── Portfolio Value ───────────────────────────────────────────────────────
function getPortfolioValue(cash = 100000) {
  let positionValue = 0;
  for (const [, pos] of _positions) {
    positionValue += pos.shares * pos.currentPrice;
  }
  return { cash, positionValue, total: cash + positionValue, positions: _positions.size };
}

module.exports = { executeOrder, getPosition, getAllPositions, updatePositions, getPortfolioValue };
