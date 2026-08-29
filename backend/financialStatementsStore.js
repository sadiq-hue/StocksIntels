// Shared financial-statements storage used by both the manual upload route
// and the automated NSE report detector. Normalizes parsed data, inserts a
// financial_statements row, parses an attached PDF (if any) and upserts the
// derived stock_fundamentals row.

const { pool } = require('./db');
const jsParser = require('./jsParser');

const KNOWN_FUNDAMENTAL_KEYS = ['revenue', 'net_profit', 'eps', 'dps', 'total_assets', 'total_liabilities', 'book_value', 'pe_ratio'];

function normalizeFinancialData(raw) {
  const out = {};
  const sections = ['balance_sheet', 'income_statement', 'cash_flow', 'per_share', 'ratios', 'metrics'];
  for (const [key, value] of Object.entries(raw || {})) {
    if (sections.includes(key) && value && typeof value === 'object' && !Array.isArray(value)) {
      for (const [sk, sv] of Object.entries(value)) {
        out[sk] = sv;
      }
    } else {
      out[key] = value;
    }
  }
  for (const k of Object.keys(out)) {
    const noYear = k.replace(/_\d{4}$/, '');
    if (noYear !== k) {
      if (out[noYear] === undefined) out[noYear] = out[k];
      delete out[k];
    }
  }
  const keyMap = {
    net_income_pat: 'net_income', earnings_per_share: 'eps', profit_after_tax: 'net_income',
    pat: 'net_income', dividend_per_share: 'dps', earnings_per_share_eps: 'eps',
    dividend_per_share_dps: 'dps', shares_outstanding_millions: 'shares_outstanding',
  };
  for (const [src, dest] of Object.entries(keyMap)) {
    if (out[src] !== undefined && out[dest] === undefined) {
      out[dest] = src === 'shares_outstanding_millions' ? out[src] * 1000000 : out[src];
    }
  }
  return out;
}

// Secondary cache: stock_fundamentals is a symbol-keyed RATIOS table
// (pe_ratio, pb_ratio, roe, dividend_yield, market_cap, ...). It does NOT store
// raw statement figures — those live in financial_statements.parsed_data (the
// canonical source financialReportsService reads). So we only copy across the
// ratio columns that happen to be present, and never let a schema mismatch
// break statement storage (this call is wrapped in try/catch by callers).
async function upsertFundamentals(tickerVal, docId, data, period_type, period_end_date) {
  if (!data) return;
  const ratioCols = {
    pe_ratio: 'pe_ratio', pb_ratio: 'pb_ratio', roe: 'roe',
    dividend_yield: 'dividend_yield', market_cap: 'market_cap',
    debt_to_equity: 'debt_to_equity', current_ratio: 'current_ratio',
    revenue_growth: 'revenue_growth', eps_growth: 'eps_growth', fcf_yield: 'fcf_yield',
  };
  const vals = { symbol: tickerVal };
  for (const [src, col] of Object.entries(ratioCols)) {
    if (data[src] !== undefined && data[src] !== null && !isNaN(Number(data[src]))) vals[col] = Number(data[src]);
  }
  if (Object.keys(vals).length <= 1) return; // only symbol present -> nothing to do
  vals.updated_at = new Date();
  const cols = Object.keys(vals);
  const ph = cols.map((_, i) => '$' + (i + 1)).join(', ');
  const updates = cols.filter(c => c !== 'symbol').map(c => c + ' = EXCLUDED.' + c).join(', ');
  try {
    await pool.query(
      `INSERT INTO stock_fundamentals (${cols.join(', ')}) VALUES (${ph}) ON CONFLICT (symbol) DO UPDATE SET ${updates}`,
      cols.map(c => vals[c])
    );
  } catch (e) {
    console.warn('[store] stock_fundamentals upsert skipped for', tickerVal, ':', e.message);
  }
}

// Store already-structured JSON (manual upload path).
async function storeParsedFinancials({ ticker, stock_id, period_type, period_end_date, file_name, data, processed_by }) {
  if (!data || typeof data !== 'object') throw new Error('data object is required');
  if (!ticker && !stock_id) throw new Error('ticker or stock_id is required');

  let sid;
  let tickerVal;
  if (stock_id) {
    const s = await pool.query('SELECT id, ticker FROM stocks WHERE id = $1', [stock_id]);
    if (s.rows.length === 0) throw new Error('Stock not found');
    sid = s.rows[0].id;
    tickerVal = s.rows[0].ticker;
  } else {
    const s = await pool.query('SELECT id FROM stocks WHERE ticker = $1 AND market = $2', [ticker.toUpperCase(), 'NSE']);
    if (s.rows.length === 0) throw new Error('Stock not found for ticker ' + ticker);
    sid = s.rows[0].id;
    tickerVal = ticker.toUpperCase();
  }

  const norm = normalizeFinancialData(data);
  const ins = await pool.query(
    `INSERT INTO financial_statements (stock_id, period_type, period_end_date, file_name, status, json_data, parsed_data, parsed_at, processed_by)
     VALUES ($1, $2, $3, $4, 'completed', $5, $6, CURRENT_TIMESTAMP, $7)
     RETURNING id`,
    [sid, period_type || 'annual', period_end_date || null, file_name || (tickerVal + '_' + (period_end_date || 'manual') + '.json'), norm, norm, processed_by || 'json:manual']
  );
  const docId = ins.rows[0].id;
  await upsertFundamentals(tickerVal, docId, norm, period_type, period_end_date);
  return { docId, parsed: norm };
}

// Download + parse a PDF and store the result (automated detector path).
// `publishStatus` is the status assigned to a successfully parsed row. Auto-detected
// NSE reports pass 'pending_review' so they are held for admin approval before going
// live; manual uploads default to 'completed'.
async function storePdfReport({ ticker, period_type, period_end_date, file_name, pdfBuffer, processed_by, publishStatus = 'completed' }) {
  if (!ticker) throw new Error('ticker is required');
  const s = await pool.query('SELECT id FROM stocks WHERE ticker = $1 AND market = $2', [ticker.toUpperCase(), 'NSE']);
  if (s.rows.length === 0) throw new Error('Stock not found for ticker ' + ticker);
  const sid = s.rows[0].id;
  const tickerVal = ticker.toUpperCase();

  // If the same period already has a live row (completed, or pending_review with data),
  // do not re-open it. Concurrent detection runs (e.g. during a rolling redeploy) can
  // otherwise flip an approved statement back to 'processing'/'pending_review'.
  const done = await pool.query(
    `SELECT id, status, parsed_data FROM financial_statements
     WHERE stock_id = $1 AND period_end_date IS NOT DISTINCT FROM $2 AND period_type IS NOT DISTINCT FROM $3
       AND status IN ('completed','pending_review') AND parsed_data IS NOT NULL
     ORDER BY id LIMIT 1`,
    [sid, period_end_date || null, period_type || 'annual']
  );
  if (done.rows.length > 0) {
    return { docId: done.rows[0].id, parsed: done.rows[0].parsed_data, status: done.rows[0].status };
  }

  // A company files ONE statement per reporting period. If a live row already
  // exists for the same (stock_id, period_end_date) — even under a different
  // period_type label (e.g. after a relabel migration) — skip instead of
  // inserting, which would otherwise spawn a duplicate on the next detection.
  const samePeriod = await pool.query(
    `SELECT id, status, parsed_data FROM financial_statements
     WHERE stock_id = $1 AND period_end_date IS NOT DISTINCT FROM $2
       AND status IN ('completed','pending_review') AND parsed_data IS NOT NULL
     ORDER BY id LIMIT 1`,
    [sid, period_end_date || null]
  );
  if (samePeriod.rows.length > 0) {
    return { docId: samePeriod.rows[0].id, parsed: samePeriod.rows[0].parsed_data, status: samePeriod.rows[0].status };
  }

  // Reuse only rows that are NOT live: previously-failed/processing rows AND broken
  // 'completed' rows (error_message set / no parsed_data), so a failed parse is
  // re-attempted without ever overwriting a live statement.
  const existing = await pool.query(
    `SELECT id FROM financial_statements WHERE stock_id = $1 AND period_end_date IS NOT DISTINCT FROM $2 AND period_type IS NOT DISTINCT FROM $3
       AND NOT (status IN ('completed','pending_review') AND parsed_data IS NOT NULL)
     LIMIT 1`,
    [sid, period_end_date || null, period_type || 'annual']
  );
  let docId;
  if (existing.rows.length > 0) {
    docId = existing.rows[0].id;
    await pool.query(
      `UPDATE financial_statements SET file_name = $1, status = 'processing', processed_by = $2, error_message = NULL, parsed_data = NULL, parsed_at = NULL WHERE id = $3`,
      [file_name || (tickerVal + '_auto.pdf'), processed_by || 'auto-nse', docId]
    );
  } else {
    const ins = await pool.query(
      `INSERT INTO financial_statements (stock_id, period_type, period_end_date, file_name, status, processed_by)
        VALUES ($1, $2, $3, $4, 'processing', $5)
       RETURNING id`,
      [sid, period_type || 'annual', period_end_date || null, file_name || (tickerVal + '_auto.pdf'), processed_by || 'auto-nse']
    );
    docId = ins.rows[0].id;
  }

  let parsed = null;
  let status = 'failed';
  try {
    await jsParser.parsePdfBuffer(pdfBuffer, docId, { ticker: tickerVal, period_end_date: period_end_date || null, period_type: period_type || 'annual' });
    const r = await pool.query('SELECT parsed_data, status FROM financial_statements WHERE id = $1', [docId]);
    parsed = r.rows[0]?.parsed_data || null;
    status = r.rows[0]?.status || 'failed';
  } catch (e) {
    await pool.query('UPDATE financial_statements SET status = $1, error_message = $2 WHERE id = $3', ['failed', e.message, docId]).catch(() => {});
  }

  // jsParser marks the row 'completed' even when no metrics were extracted
  // (e.g. scanned/image PDFs). Demote those to 'failed' so they don't shadow
  // real data in reports that filter on status = 'completed'.
  const hasData = parsed && typeof parsed === 'object' && Object.keys(parsed).length > 0;
  if (!hasData) {
    status = 'failed';
    await pool.query(
      `UPDATE financial_statements SET status = 'failed', error_message = COALESCE(error_message, 'No metrics extracted (scanned/image PDF or unrecognized format)') WHERE id = $1`,
      [docId]
    ).catch(() => {});
  } else {
    await upsertFundamentals(tickerVal, docId, parsed, period_type, period_end_date);
  }
  // A successfully parsed row is published as `publishStatus` (completed for manual
  // uploads, pending_review for auto-detected NSE reports awaiting admin approval).
  if (hasData && status === 'completed') {
    await pool.query('UPDATE financial_statements SET status = $1 WHERE id = $2', [publishStatus, docId]).catch(() => {});
    status = publishStatus;
  }
  return { docId, parsed: hasData ? parsed : null, status };
}

module.exports = { normalizeFinancialData, storeParsedFinancials, storePdfReport, upsertFundamentals };
