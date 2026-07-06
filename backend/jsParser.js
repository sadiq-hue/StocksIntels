const { pool } = require('./db');
const zlib = require('zlib');
const https = require('https');

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
    const url = new URL(process.env.OPENAI_BASE_URL || 'https://api.openai.com/v1/chat/completions');
    const opts = {
      hostname: url.hostname,
      path: url.pathname,
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
          const parsed = JSON.parse(data);
          const content = parsed.choices?.[0]?.message?.content;
          if (content) resolve(JSON.parse(content));
          else resolve(null);
        } catch { resolve(null); }
      });
    });
    req.on('error', () => resolve(null));
    req.on('timeout', () => { req.destroy(); resolve(null); });
    req.write(body);
    req.end();
  });
}

async function parsePdfBuffer(buffer, docId) {
  try {
    const text = extractPdfText(buffer);
    if (!text.trim()) {
      await pool.query(
        `UPDATE financial_statements SET status = 'failed', error_message = 'No text could be extracted from PDF (raw extraction returned empty)' WHERE id = $1`,
        [docId]
      );
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
    const keyCount = countKeyMetrics(metrics);
    let processedBy = 'js:regex';
    // If regex found few key metrics and OpenAI key is available, try LLM fallback
    if (keyCount < 2 && process.env.OPENAI_API_KEY) {
      console.log('[JSParser] Only ' + keyCount + ' key metrics via regex, trying LLM for doc ' + docId);
      const llmResult = await callLlm(text, process.env.OPENAI_API_KEY, process.env.OPENAI_MODEL || 'gpt-4o-mini');
      if (llmResult && Object.values(llmResult).some(v => v !== null)) {
        for (const [k, v] of Object.entries(llmResult)) {
          if (v !== null && v !== undefined) parsedData[k] = Math.round(v * 100) / 100;
        }
        processedBy = 'js:llm';
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
        ['No metrics matched. Extracted text preview: ' + preview, processedBy, docId]
      );
    }
    if (parsedData.dividend_per_share || parsedData.eps) {
      const r = await pool.query(
        'SELECT s.ticker FROM financial_statements fs JOIN stocks s ON s.id = fs.stock_id WHERE fs.id = $1',
        [docId]
      );
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
    await pool.query(
      `UPDATE financial_statements SET status = 'failed', error_message = $1 WHERE id = $2`,
      [e.message, docId]
    );
  }
}

module.exports = { parsePdfBuffer };
