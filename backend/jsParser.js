const { pool } = require('./db');

const METRIC_PATTERNS = {
  total_revenue: [/(?:total\s+)?revenue[:\s]*([\d,.]+)/i, /(?:total\s+)?(?:operating\s+)?income[:\s]*([\d,.]+)/i, /gross\s+revenue[:\s]*([\d,.]+)/i],
  net_income: [/(?:net\s+)?(?:profit|income|earnings)(?:\s+for\s+the\s+(?:period|year))?[:\s]*([\d,.]+)/i, /(?:profit|loss)\s+for\s+the\s+(?:period|year)[:\s]*([\d,.]+)/i, /total\s+comprehensive\s+income[:\s]*([\d,.]+)/i],
  cost_of_revenue: [/(?:cost\s+of\s+)?(?:revenue|sales|goods\s+sold)[:\s]*([\d,.]+)/i, /cost\s+of\s+sales[:\s]*([\d,.]+)/i],
  operating_income: [/operating\s+(?:income|profit)[:\s]*([\d,.]+)/i, /(?:income|profit)\s+from\s+operations[:\s]*([\d,.]+)/i],
  cash_from_operations: [/(?:net\s+)?cash\s+(?:from|generated\s+by|provided\s+by)\s+operating\s+activities[:\s]*([\d,.]+)/i, /(?:net\s+)?cash\s+(?:from|from\s+)?operations[:\s]*([\d,.]+)/i, /operating\s+cash\s+flow[:\s]*([\d,.]+)/i],
  total_assets: [/(?:total\s+)?assets[:\s]*([\d,.]+)/i],
  total_liabilities: [/(?:total\s+)?liabilities[:\s]*([\d,.]+)/i, /total\s+(?:equity\s+and\s+)?liabilities[:\s]*([\d,.]+)/i],
  total_debt: [/(?:total\s+)?(?:debt|borrowings|loans\s+(?:and|&)\s+borrowings)[:\s]*([\d,.]+)/i],
  current_assets: [/(?:total\s+)?current\s+assets[:\s]*([\d,.]+)/i],
  current_liabilities: [/(?:total\s+)?current\s+liabilities[:\s]*([\d,.]+)/i],
  shareholders_equity: [/(?:shareholders[''´`]?\s*)?equity[:\s]*([\d,.]+)/i, /(?:total\s+)?equity[:\s]*([\d,.]+)/i],
  retained_earnings: [/(?:retained\s+)?earnings[:\s]*([\d,.]+)/i, /retained\s+(?:profit|earnings)[:\s]*([\d,.]+)/i],
  eps: [/(?:earnings\s+per\s+share|eps)[:\s]*([\d,.]+)/i],
  dividend_per_share: [/(?:dividend\s+per\s+share|dps)[:\s]*([\d,.]+)/i],
};

function parseNumber(s) {
  s = s.trim().replace(/,/g, '');
  if (s.endsWith('%')) return null;
  const n = parseFloat(s);
  return isNaN(n) ? null : n;
}

function extractMetrics(text) {
  const results = {};
  for (const [metric, patterns] of Object.entries(METRIC_PATTERNS)) {
    const values = [];
    for (const p of patterns) {
      let m;
      while ((m = p.exec(text)) !== null) {
        const val = parseNumber(m[1]);
        if (val !== null) values.push(val);
      }
    }
    if (values.length > 0) {
      const unique = [...new Set(values.map(v => Math.round(v * 100)))].map(v => v / 100);
      results[metric] = unique.slice(0, 3);
    }
  }
  return results;
}

async function parsePdfBuffer(buffer, docId) {
  try {
    const pdfParse = require('pdf-parse');
    const data = await pdfParse(buffer);
    const text = data.text || '';
    if (!text.trim()) {
      await pool.query(`UPDATE financial_statements SET status = 'failed', error_message = 'No text could be extracted from PDF' WHERE id = $1`, [docId]);
      return;
    }
    const metrics = extractMetrics(text);
    const parsedData = {};
    for (const [metric, values] of Object.entries(metrics)) {
      if (values.length > 0) {
        const best = values.reduce((a, b) => Math.abs(a) < Math.abs(b) ? a : b);
        parsedData[metric] = Math.round(best * 100) / 100;
      }
    }
    await pool.query(
      `UPDATE financial_statements SET status = 'completed', parsed_data = $1, parsed_at = CURRENT_TIMESTAMP, processed_by = 'js' WHERE id = $2`,
      [JSON.stringify(parsedData), docId]
    );
    if (parsedData.dividend_per_share || parsedData.eps) {
      const r = await pool.query('SELECT s.ticker FROM financial_statements fs JOIN stocks s ON s.id = fs.stock_id WHERE fs.id = $1', [docId]);
      if (r.rows.length > 0) {
        const ticker = r.rows[0].ticker;
        const fundRow = {};
        if (parsedData.dividend_per_share) fundRow.dividend_yield = parsedData.dividend_per_share;
        if (parsedData.eps) fundRow.eps_growth = parsedData.eps;
        const fk = Object.keys(fundRow);
        if (fk.length > 0) {
          const vals = fk.map((_, i) => '$' + (i + 2)).join(', ');
          await pool.query(
            `INSERT INTO stock_fundamentals (symbol, ${fk.join(', ')}) VALUES ($1, ${vals}) ON CONFLICT (symbol) DO UPDATE SET ${fk.map(k => k + ' = EXCLUDED.' + k).join(', ')}`,
            [ticker, ...fk.map(k => fundRow[k])]
          );
        }
      }
    }
  } catch (e) {
    await pool.query(`UPDATE financial_statements SET status = 'failed', error_message = $1 WHERE id = $2`, [e.message, docId]);
  }
}

module.exports = { parsePdfBuffer };
