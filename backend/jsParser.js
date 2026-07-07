const { pool } = require('./db');
const zlib = require('zlib');
const https = require('https');

const METRIC_PATTERNS = {
  total_revenue: [
    /\btotal\s+revenue[:\s]*\(?([\d,.]+)\)?/gi,
  ],
  net_income: [
    /(?<!Equity\s+attributable\s+to\s+)\bequity\s+holders\s+of\s+the\s+parent[:\s]*\(?([\d,.]+)\)?/gi,
    /\bprofit\s+for\s+the\s+(?:period|year)[:\s]*\(?([\d,.]+)\)?/gi,
    /(?<!Other\s+comprehensive\s+)loss\s+for\s+the\s+(?:period|year)[:\s]*\(?([\d,.]+)\)?/gi,
    /\bnet\s+(?:profit|income|earnings)(?:\s+for\s+the\s+(?:period|year))?[:\s]*\(?([\d,.]+)\)?/gi,
    /\btotal\s+comprehensive\s+income[:\s]*\(?([\d,.]+)\)?/gi,
  ],
  cost_of_revenue: [
    /\bdirect\s+costs?[:\s]*\(?([\d,.]+)\)?/gi,
    /\bcost\s+of\s+(?:revenue|sales|goods\s+sold)[:\s]*\(?([\d,.]+)\)?/gi,
  ],
  operating_income: [
    /\boperating\s+(?:income|profit)(?:\s*\([^)]*\))?[:\s]*\(?([\d,.]+)\)?/gi,
    /\b(?:income|profit)\s+from\s+operations[:\s]*\(?([\d,.]+)\)?/gi,
  ],
  cash_from_operations: [
    /(?:net\s+)?cash\s+(?:from|generated\s+(?:from|by)|provided\s+by)\s+operating\s+activities[:\s]*\(?([\d,.]+)\)?/gi,
    /(?:net\s+)?cash\s+(?:from|from\s+)?operations[:\s]*\(?([\d,.]+)\)?/gi,
    /\boperating\s+cash\s+flow[:\s]*\(?([\d,.]+)\)?/gi,
  ],
  total_assets: [
    /\btotal\s+assets[:\s]*\(?([\d,.]+)\)?/gi,
  ],
  total_liabilities: [
    /\btotal\s+liabilities[:\s]*\(?([\d,.]+)\)?/gi,
  ],
  total_debt: [
    /(?<!paid\s+on\s+)\bborrowings[:\s]*\(?([\d,.]+)\)?/gi,
    /\blease\s+liabilities[:\s]*\(?([\d,.]+)\)?/gi,
  ],
  current_assets: [
    /(?<!\btotal\s+)current\s+assets[:\s]*\(?([\d,.]+)\)?/gi,
  ],
  current_liabilities: [
    /(?<!\btotal\s+)current\s+liabilities[:\s]*\(?([\d,.]+)\)?/gi,
  ],
  shareholders_equity: [
    /\bshareholders?[''´`]?s?\s+equity[:\s]*\(?([\d,.]+)\)?/gi,
    /\btotal\s+equity[:\s]*\(?([\d,.]+)\)?/gi,
  ],
  retained_earnings: [
    /\bretained\s+earnings[:\s]*\(?([\d,.]+)\)?/gi,
  ],
  eps: [
    /\b(?:earnings\s+per\s+share|eps)(?:\s*\([^)]*\))?[:\s]*\(?([\d,.]+)\)?/gi,
  ],
  dividend_per_share: [
    /\bdividend\s+per\s+share[:\s]*\(?([\d,.]+)\)?/gi,
  ],
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

function extractPdfText(buffer) {
  const latin1 = buffer.toString('latin1');
  const texts = [];

  function decodePdfString(s) {
    // Handle escaped chars
    return s.replace(/\\(.)/g, (m, c) => c === 'n' ? '\n' : c === 'r' ? '\r' : c === 't' ? '\t' : c);
  }

  function extractFromString(str) {
    // Extract parenthesized strings: (text)
    let re = /\(([^)]*)\)/g;
    let m;
    while ((m = re.exec(str)) !== null) {
      const t = decodePdfString(m[1]);
      if (t.length > 1 && /[a-zA-Z0-9]{2,}/.test(t)) {
        texts.push(t);
      }
    }
    // Extract hex strings: <hex>  (min 8 hex chars to avoid PDF artifact IDs)
    re = /<([0-9a-fA-F]{8,})>/g;
    while ((m = re.exec(str)) !== null) {
      try {
        const hex = m[1];
        const t = Buffer.from(hex, 'hex').toString('latin1');
        if (t.length > 3 && /[a-zA-Z0-9]{2,}/.test(t)) {
          texts.push(t);
        }
      } catch (_) {}
    }
    // Extract text from TJ arrays: [(text) num (text)] TJ
    re = /\[([^\]]*)\]\s*TJ/g;
    while ((m = re.exec(str)) !== null) {
      const inner = m[1];
      const parts = [];
      let pm;
      let pr = /\(([^)]*)\)/g;
      while ((pm = pr.exec(inner)) !== null) {
        parts.push(decodePdfString(pm[1]));
      }
      if (parts.length > 0) {
        texts.push(parts.join(''));
      }
    }
  }

  extractFromString(latin1);

  // Find and decompress FlateDecode streams
  const streamRe = /stream\r?\n(.+?)\r?\n?endstream/gs;
  let sm;
  while ((sm = streamRe.exec(latin1)) !== null) {
    try {
      const raw = Buffer.from(sm[1], 'binary');
      const dec = zlib.inflateSync(raw).toString('latin1');
      extractFromString(dec);
    } catch (_) {}
  }

  return texts.join(' ');
}

function countKeyMetrics(data) {
  const keys = ['eps', 'dividend_per_share', 'total_revenue', 'net_income'];
  return keys.filter(k => data[k] && data[k].length > 0).length;
}

async function callLlm(text, apiKey, model) {
  const prompt = `Extract financial metrics from the following NSE (Nairobi Stock Exchange) financial statement text.
Return ONLY a JSON object with these exact keys (use null if not found):
- total_revenue (number, in KES)
- net_income (number, in KES)
- cost_of_revenue (number, in KES)
- operating_income (number, in KES)
- cash_from_operations (number, in KES)
- total_assets (number, in KES)
- total_liabilities (number, in KES)
- total_debt (number, in KES)
- current_assets (number, in KES)
- current_liabilities (number, in KES)
- shareholders_equity (number, in KES)
- retained_earnings (number, in KES)
- eps (number, in KES)
- dividend_per_share (number, in KES)

Report text:
${text.slice(0, 8000)}`;

  return new Promise((resolve) => {
    const body = JSON.stringify({
      model: model || 'gpt-4o-mini',
      messages: [{ role: 'user', content: prompt }],
      temperature: 0,
      response_format: { type: 'json_object' },
    });
    const baseUrl = process.env.OPENAI_BASE_URL || 'https://api.openai.com/v1';
    const url = new URL(baseUrl.replace(/\/+$/, '') + '/chat/completions');
    const opts = {
      hostname: url.hostname,
      path: url.pathname + url.search,
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': 'Bearer ' + apiKey,
        'Content-Length': Buffer.byteLength(body),
      },
      timeout: 60000,
    };
    const req = https.request(opts, (res) => {
      let data = '';
      res.on('data', (chunk) => data += chunk);
      res.on('end', () => {
        try {
          if (res.statusCode !== 200) {
            console.error('[LLM] HTTP ' + res.statusCode + ':' + data.slice(0, 200));
            resolve(null); return;
          }
          const parsed = JSON.parse(data);
          const content = parsed.choices?.[0]?.message?.content;
          if (content) resolve(JSON.parse(content));
          else resolve(null);
        } catch (e) { console.error('[LLM] parse error:', e.message); resolve(null); }
      });
    });
    req.on('error', (e) => { console.error('[LLM] request error:', e.message); resolve(null); });
    req.on('timeout', () => { console.error('[LLM] timeout'); req.destroy(); resolve(null); });
    req.write(body);
    req.end();
  });
}

async function processText(text, docId, source) {
  let parsedData = {};
  let processedBy = source || 'js';

  // Primary: try AI if key is set
  if (process.env.OPENAI_API_KEY) {
    console.log('[JSParser] Calling LLM for doc ' + docId + ', text length=' + text.length);
    const llmResult = await callLlm(text, process.env.OPENAI_API_KEY, process.env.OPENAI_MODEL || 'gpt-4o-mini');
    if (llmResult && Object.values(llmResult).some(v => v !== null)) {
      for (const [k, v] of Object.entries(llmResult)) {
        if (v !== null && v !== undefined) parsedData[k] = Math.round(v * 100) / 100;
      }
      processedBy = 'js:llm';
      console.log('[JSParser] LLM OK for doc ' + docId + ': ' + Object.keys(parsedData).length + ' metrics');
    } else {
      console.log('[JSParser] LLM returned null for doc ' + docId);
    }
  }

  // Fallback: regex if AI returned nothing
  if (Object.keys(parsedData).length === 0) {
    const metrics = extractMetrics(text);
    for (const [metric, values] of Object.entries(metrics)) {
      if (values.length > 0) {
        // Filter out section numbers (small values) for large-value metrics
        const largeMetrics = ['total_revenue','net_income','cost_of_revenue','operating_income','cash_from_operations','total_assets','total_liabilities','total_debt','current_assets','current_liabilities','shareholders_equity','retained_earnings'];
        let filtered = largeMetrics.includes(metric) ? values.filter(v => v > 100) : values;
        if (filtered.length === 0) filtered = values;
        let best;
        if (metric === 'total_debt') {
          best = filtered.reduce((a, b) => a + b, 0);
        } else if (metric === 'net_income') {
          best = Math.max(...filtered);
        } else {
          best = filtered.reduce((a, b) => Math.abs(a) < Math.abs(b) ? a : b);
        }
        parsedData[metric] = Math.round(best * 100) / 100;
      }
    }
    if (Object.keys(parsedData).length > 0) {
      processedBy = source ? source + ':regex' : 'js:regex';
    }
  }

  const hasAnyData = Object.keys(parsedData).length > 0;
  if (hasAnyData) {
    await pool.query(
      `UPDATE financial_statements SET status = 'completed', parsed_data = $1, parsed_at = CURRENT_TIMESTAMP, processed_by = $2 WHERE id = $3`,
      [JSON.stringify(parsedData), processedBy, docId]
    );
  } else {
    const preview = text.slice(0, 300).replace(/\0/g, '');
    await pool.query(
      `UPDATE financial_statements SET status = 'completed', parsed_data = '{}'::jsonb, error_message = $1, parsed_at = CURRENT_TIMESTAMP, processed_by = $2 WHERE id = $3`,
      ['No metrics matched. Text preview: ' + preview, processedBy, docId]
    );
  }

  if (parsedData.dividend_per_share || parsedData.eps) {
    try {
      const r = await pool.query(
        'SELECT ns.id AS nse_stock_id FROM financial_statements fs JOIN stocks s ON s.id = fs.stock_id JOIN nse_stocks ns ON ns.ticker = s.ticker WHERE fs.id = $1',
        [docId]
      );
      if (r.rows.length > 0) {
        const { nse_stock_id } = r.rows[0];
        const fundRow = {};
        if (parsedData.dividend_per_share) fundRow.dps = parsedData.dividend_per_share;
        if (parsedData.eps) fundRow.eps = parsedData.eps;
        const fk = Object.keys(fundRow);
        if (fk.length > 0) {
          const vals = fk.map((_, i) => '$' + (i + 2)).join(', ');
          await pool.query(
            `INSERT INTO stock_fundamentals (stock_id, statement_id, ${fk.join(', ')}, extracted_at) VALUES ($1, $2, ${vals}, CURRENT_TIMESTAMP) ON CONFLICT (stock_id, statement_id) DO UPDATE SET ${fk.map(k => k + ' = EXCLUDED.' + k).join(', ')}`,
            [nse_stock_id, docId, ...fk.map(k => fundRow[k])]
          );
        }
      }
    } catch (e) {
      console.warn('[JSParser] Failed to update stock_fundamentals for doc ' + docId + ': ' + e.message);
    }
  }
}

async function parsePdfBuffer(buffer, docId) {
  try {
    const text = extractPdfText(buffer);
    if (!text.trim()) {
      await pool.query(`UPDATE financial_statements SET status = 'failed', error_message = 'No text could be extracted from PDF' WHERE id = $1`, [docId]);
      return;
    }
    await processText(text, docId, 'js');
  } catch (e) {
    await pool.query(`UPDATE financial_statements SET status = 'failed', error_message = $1 WHERE id = $2`, [e.message, docId]);
  }
}

async function parseExtractedText(text, docId, fileName) {
  try {
    if (!text.trim()) {
      await pool.query(`UPDATE financial_statements SET status = 'failed', error_message = 'Empty text' WHERE id = $1`, [docId]);
      return;
    }
    await processText(text, docId, 'js');
  } catch (e) {
    await pool.query(`UPDATE financial_statements SET status = 'failed', error_message = $1 WHERE id = $2`, [e.message, docId]);
  }
}

module.exports = { parsePdfBuffer, parseExtractedText };
