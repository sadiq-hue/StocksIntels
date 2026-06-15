// Insert current signals into signal_history as backtest baseline
const { pool } = require('./db');

async function seedBacktestData() {
  try {
    // Get current signals from cache
    const { generateSignals } = require('./signalService');
    const signals = await generateSignals(null, true);
    
    if (!signals || signals.length === 0) {
      console.log('No signals to seed');
      return;
    }

    console.log(`Seeding ${signals.length} signals into signal_history...`);

    // Market hours: 9:30 AM - 4:00 PM ET today
    const now = new Date();
    const marketOpen = new Date(now);
    marketOpen.setHours(9, 30, 0, 0);
    const marketClose = new Date(now);
    marketClose.setHours(16, 0, 0, 0);
    
    // Spread signals evenly across market hours
    const totalMs = marketClose - marketOpen;
    const stepMs = totalMs / signals.length;

    let inserted = 0;
    for (let i = 0; i < signals.length; i++) {
      const s = signals[i];
      const generatedAt = new Date(marketOpen.getTime() + (i * stepMs));
      
      await pool.query(
        `INSERT INTO signal_history 
         (ticker, signal, confidence, price, change_pct, entry_price, stop_loss, target1, target2, 
          risk_reward, sector, market, currency, trade_type, timeframe, reason, generated_at)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17)
         ON CONFLICT DO NOTHING`,
        [
          s.ticker, s.signal, s.confidence || 0, s.price || 0, s.change || 0,
          s.entry || s.price || 0, s.stopLoss || 0, s.target1 || 0, s.target2 || 0,
          s.riskReward || 0, s.sector || '', s.market || 'Global', s.currency || 'USD',
          s.type || 'Swing Trade', s.timeframe || '1-4 weeks', s.reason || '', generatedAt
        ]
      );
      inserted++;
    }

    console.log(`✅ Inserted ${inserted} signals into signal_history for backtest`);
    
    // Verify
    const count = await pool.query('SELECT COUNT(*) as cnt FROM signal_history');
    console.log(`Total rows in signal_history: ${count.rows[0].cnt}`);
    
    process.exit(0);
  } catch (err) {
    console.error('Error seeding backtest data:', err);
    process.exit(1);
  }
}

seedBacktestData();
