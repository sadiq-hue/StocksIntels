// Read-only content brief for marketing/editorial assistants.
//
// This deliberately exposes market-level intelligence only: no user records,
// emails, tokens, portfolio data or private operational logs. The route is
// disabled unless CONTENT_API_KEY is configured on the server.

const { pool } = require('./db');
const marketConditionService = require('./marketConditionService');
const signalSnapshotsService = require('./signalSnapshotsService');

function sanitizeConditions(c = {}) {
  return {
    asOf: c.asOf || null,
    riskTone: c.riskTone || 'unknown',
    vix: c.vix ?? null,
    vixChangePct: c.vixChangePct ?? null,
    breadth: c.breadth ? {
      score: c.breadth.score ?? null,
      pctAbove200: c.breadth.pctAbove200 ?? null,
      pctAbove50: c.breadth.pctAbove50 ?? null,
      advancers: c.breadth.advancers ?? null,
      decliners: c.breadth.decliners ?? null,
      newHighs: c.breadth.newHighs ?? null,
      newLows: c.breadth.newLows ?? null,
    } : null,
    sectors: c.sectors ? {
      leader: c.sectors.leader || null,
      laggard: c.sectors.laggard || null,
      riskOn: c.sectors.riskOn ?? null,
    } : null,
    creditSpread: c.creditSpread ?? null,
  };
}

async function getDailyBrief({ limit = 12 } = {}) {
  const [setups, outcomes, coverage] = await Promise.all([
    pool.query(`
      WITH latest AS (
        SELECT DISTINCT ON (ticker) ticker, name, market, sector, signal, action,
               confidence, score, price, entry, stop_loss, target1, target2, target3,
               horizon, timeframe, catalyst, analyzed_at, payload
        FROM signal_snapshots
        ORDER BY ticker, analyzed_at DESC
      )
      SELECT ticker, name, market, sector, signal, action, confidence, score,
             price, entry, stop_loss, target1, target2, target3, horizon, timeframe,
             catalyst, analyzed_at,
             payload->'companyProfile'->>'description' AS company_description,
             payload->'thesis'->>'review' AS thesis_review
      FROM latest
      WHERE action IN ('buy', 'sell')
      ORDER BY confidence DESC, score DESC
      LIMIT $1
    `, [Math.max(1, Math.min(50, Number(limit) || 12))]),
    pool.query(`
      SELECT COALESCE(horizon, 'legacy') AS horizon,
             COUNT(*)::int AS samples,
             COUNT(*) FILTER (WHERE result = 'win')::int AS wins,
             COUNT(*) FILTER (WHERE result = 'loss')::int AS losses
      FROM signal_outcomes
      WHERE source = 'live'
        AND result IS NOT NULL
        AND COALESCE(signal_generated_at, recorded_at) > NOW() - INTERVAL '90 days'
      GROUP BY COALESCE(horizon, 'legacy')
    `),
    signalSnapshotsService.getCoverage().catch(() => null),
  ]);

  return {
    generatedAt: new Date().toISOString(),
    audience: 'public-market-commentary',
    market: sanitizeConditions(marketConditionService.getConditions()),
    coverage: coverage ? {
      total: coverage.total,
      freshLastHour: coverage.freshLastHour,
      dueNow: coverage.dueNow,
      byTier: coverage.byTier,
      byMarket: coverage.byMarket,
      byAction: coverage.byAction,
    } : null,
    topIdeas: setups.rows.map(r => ({
      ticker: r.ticker,
      name: r.name,
      market: r.market,
      sector: r.sector,
      rating: r.signal,
      action: r.action,
      conviction: r.confidence,
      score: r.score,
      price: r.price,
      entry: r.entry,
      stop: r.stop_loss,
      targets: [r.target1, r.target2, r.target3].filter(v => v != null),
      horizon: r.horizon,
      timeframe: r.timeframe,
      catalyst: r.catalyst || null,
      companyDescription: r.company_description || null,
      thesisReview: r.thesis_review || null,
      analyzedAt: r.analyzed_at,
    })),
    outcomes90d: outcomes.rows.map(r => ({
      horizon: r.horizon,
      samples: r.samples,
      wins: r.wins,
      losses: r.losses,
      winRate: r.samples ? Math.round((r.wins / r.samples) * 1000) / 10 : null,
    })),
    provenance: {
      source: 'StocksIntels signal engine',
      note: 'Market-level data only; no user, account, portfolio or credential data.',
    },
  };
}

module.exports = { getDailyBrief };
