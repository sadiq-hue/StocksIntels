const { pool } = require('./db');
const zlib = require('zlib');
const https = require('https');

const METRIC_PATTERNS = {
  total_revenue: [
    /\btotal\s+revenue(?:\s*\([^)]*\))?[:\s]*\(?([\d,.]+)\)?/gi,
    /\btotal\s+operating\s+income(?:\s*\([^)]*\))?[:\s]*\(?([\d,.]+)\)?/gi,
    /\btotal\s+income(?:\s*\([^)]*\))?[:\s]*\(?([\d,.]+)\)?/gi,
  ],
  net_income: [
    /(?<!Equity\s+attributable\s+to\s+)\bequity\s+holders\s+of\s+the\s+parent[:\s]*\(?([\d,.]+)\)?/gi,
    /\bprofit\s+for\s+the\s+(?:period|year)[:\s]*\(?([\d,.]+)\)?/gi,
    /\bprofit\b[^a]*?after\s+tax[:\s]*\(?([\d,.]+)\)?/gi,
    /\bprofit\b[^a]*?after\s+exceptional\s+items[:\s]*\(?([\d,.]+)\)?/gi,
    /(?<!Other\s+comprehensive\s+)loss\s+for\s+the\s+(?:period|year)[:\s]*\(?([\d,.]+)\)?/gi,
    /\bnet\s+(?:profit|income|earnings)(?:\s+for\s+the\s+(?:period|year))?[:\s]*\(?([\d,.]+)\)?/gi,
    /\btotal\s+comprehensive\s+income[:\s]*\(?([\d,.]+)\)?/gi,
    /\(?(?:[Ll]oss|[Pp]rofit)\)?\/\(?(?:[Ll]oss|[Pp]rofit)\)?\s+f(?:or)?the\s+(?:period|year)[:\s]*\(?([\d,.]+)\)?/gi,
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
    /\btotal\s+debt[:\s]*\(?([\d,.]+)\)?/gi,
    /\b(?:total\s+)?borrowings?\s+and\s+lease\s+liabilities[:\s]*\(?([\d,.]+)\)?/gi,
    /(?<!paid\s+on\s+)\bborrowings[:\s]*\(?([\d,.]+)\)?/gi,
    /\blease\s+liabilities[:\s]*\(?([\d,.]+)\)?/gi,
  ],
  current_assets: [
    /(?<!\btotal\s+)(?<!\b[Nn]on[\s-]+)current\s+assets[:\s]*\(?([\d,.]+)\)?/gi,
  ],
  current_liabilities: [
    /(?<!\btotal\s+)(?<!\b[Nn]on[\s-]+)current\s+liabilities[:\s]*\(?([\d,.]+)\)?/gi,
  ],
  shareholders_equity: [
    /(?<!LIABILITIES\s+(?:AND|&)\s+)shareholders?[''´`]?s?\s+equity[:\s]*\(?([\d,.]+)\)?/gi,
    /\btotal\s+equity[:\s]*\(?([\d,.]+)\)?/gi,
  ],
  retained_earnings: [
    /\bretained\s+earnings[:\s]*\(?([\d,.]+)\)?/gi,
  ],
  eps: [
    /\b(?:earnings\s+per\s+share|eps)(?:\s*\([^)]*\))?[:\s]*\(?([\d,.]+)\)?/gi,
    /\bearnings\s+per\s+share[\s-]+[A-Za-z\s&]+[\s-]*\(?([\d,.]+)\)?/gi,
  ],
  dividend_per_share: [
    /\bdividend\s+per\s+share(?:\s*\([^)]*\))?[:\s]*\(?([\d,.]+)\)?/gi,
    /\bdividend\s+per\s+share[\s-]+[A-Za-z\s&]+[\s-]*\(?([\d,.]+)\)?/gi,
    /\bdps\b[:\s]*\(?([\d,.]+)\)?/gi,
  ],
};

function parseNumber(s) {
  s = s.trim().replace(/,/g, '');
  if (s.endsWith('%')) return null;
  const n = parseFloat(s);
  return isNaN(n) ? null : n;
}

// ── Column detection for pdftotext -layout multi-column tables ──
// In layout output, numbers in the same column appear at consistent char positions.
// Strategy:
//   1. Cluster number positions across all lines to find column boundaries
//   2. Scan header lines for "Group"/"Consolidated" vs "Company"/"Bank" labels
//   3. Match header word positions to nearest column boundary
//   4. If headers found, use them to identify Group column
//   5. If no headers, use max-value voting across lines

const NUM_RE = /(?<![a-zA-Z])(\d[\d,]*\.?\d*)(?![a-zA-Z.%])/g;

function detectColumns(lines) {
  const positions = [];
  for (const line of lines) {
    NUM_RE.lastIndex = 0;
    let m;
    while ((m = NUM_RE.exec(line)) !== null) {
      const val = parseNumber(m[1]);
      if (val !== null) {
        if (Number.isInteger(val) && (val >= 1 && val <= 999 || val >= 1900 && val <= 2099)) continue;
        positions.push({ index: m.index, value: val });
      }
    }
  }
  if (positions.length < 6) return null;

  // Cluster positions by proximity (gap > 4 chars = new column)
  positions.sort((a, b) => a.index - b.index);
  const clusters = [];
  for (const p of positions) {
    const last = clusters[clusters.length - 1];
    if (last && p.index - last.x <= 4) {
      last.items.push(p);
      last.x = (last.x * (last.items.length - 1) + p.index) / last.items.length;
    } else {
      clusters.push({ items: [p], x: p.index });
    }
  }
  if (clusters.length < 2) return null;

  // Keep clusters with enough values
  const valid = clusters.filter(c => c.items.length >= 2);
  if (valid.length < 2) return null;

  const colPositions = valid.map(c => Math.round(c.x));

  // Method 1: Identify Group column from header labels
  const headerLines = lines.slice(0, Math.min(20, lines.length));
  let groupCol = -1;
  let method = 'none';

  for (const line of headerLines) {
    const groupIdx = line.search(/\b(?:Group|Consolidated)\b/i);
    const companyIdx = line.search(/\b(?:Company|Standalone|Bank|Separate|Unconsolidated)\b/i);
    if (groupIdx >= 0 && companyIdx >= 0) {
      // Both labels found: Group is left if its character position is smaller
      groupCol = groupIdx < companyIdx ? 0 : colPositions.length - 1;
      method = 'header';
      break;
    }
    if (groupIdx >= 0) {
      // Only Group label: match to nearest column boundary
      let bestDist = Infinity;
      for (let i = 0; i < colPositions.length; i++) {
        const dist = Math.abs(groupIdx - colPositions[i]);
        if (dist <= bestDist) { bestDist = dist; groupCol = i; }
      }
      method = 'header';
    }
  }

  // Method 2: If no header labels found, use max-value voting
  if (groupCol < 0) {
    const votes = new Array(colPositions.length).fill(0);
    for (const line of lines) {
      NUM_RE.lastIndex = 0;
      const nums = [];
      while ((m = NUM_RE.exec(line)) !== null) {
        const val = parseNumber(m[1]);
        if (val !== null && !(Number.isInteger(val) && (val >= 1 && val <= 999 || val >= 1900 && val <= 2099))) {
          nums.push({ index: m.index, value: val });
        }
      }
      if (nums.length >= 2) {
        // Vote: which column (by order: first num = col0, second = col1) has larger value?
        const colVals = nums.map(n => n.value);
        let maxVal = -Infinity, maxCol = -1;
        for (let i = 0; i < colVals.length; i++) {
          if (colVals[i] > maxVal) { maxVal = colVals[i]; maxCol = i; }
        }
        if (maxCol >= 0) votes[maxCol]++;
      }
    }
    groupCol = votes.indexOf(Math.max(...votes));
    method = 'vote';
  }

  console.log('[detectColumns] ' + colPositions.length + ' cols at [' + colPositions + '], Group=col' + groupCol + ' (method=' + method + ')');
  return { columns: colPositions, groupCol };
}

function extractNumberFromLine(line, columns) {
  NUM_RE.lastIndex = 0;
  const nums = [];
  let m;
  while ((m = NUM_RE.exec(line)) !== null) {
    const val = parseNumber(m[1]);
    if (val !== null && !(Number.isInteger(val) && (val >= 1 && val <= 999 || val >= 1900 && val <= 2099))) {
      nums.push({ index: m.index, value: val });
    }
  }
  if (nums.length === 0) return null;
  if (nums.length === 1 || !columns) return nums[0].value;

  // Assign by order (nums are left-to-right; first num = col0, second = col1)
  if (columns.groupCol < nums.length) return nums[columns.groupCol].value;
  // Fallback: return the rightmost (last) number
  return nums[nums.length - 1].value;
}

// ── Accounting validation ──

function validateMetrics(data) {
  const issues = [];
  if (data.total_assets && data.total_liabilities && data.shareholders_equity) {
    const expectedEquity = data.total_assets - data.total_liabilities;
    const diff = Math.abs(data.shareholders_equity - expectedEquity);
    const ratio = diff / Math.max(data.shareholders_equity, 1);
    if (ratio > 0.3) {
      issues.push(`Equity ${data.shareholders_equity} != Assets ${data.total_assets} - Liabilities ${data.total_liabilities} = ${expectedEquity} (gap ${(ratio*100).toFixed(0)}%)`);
    }
  }
  if (data.eps && data.dividend_per_share && data.eps < data.dividend_per_share) {
    issues.push(`EPS ${data.eps} < DPS ${data.dividend_per_share}`);
  }
  if (data.total_revenue && data.net_income && data.total_revenue < data.net_income) {
    issues.push(`Revenue ${data.total_revenue} < Net Income ${data.net_income}`);
  }
  if (data.total_assets && data.total_revenue && data.total_assets < data.total_revenue) {
    issues.push(`Assets ${data.total_assets} < Revenue ${data.total_revenue}`);
  }
  return issues;
}

// ── Scale detection ──
// Detect whether values are in actual KES, thousands, or millions
// by looking for scale keywords in the text.

function detectScale(text) {
  if (/\bKShs\s*(?:[M]illions?|[M]\.?|M\b|000'?000|'000'000)\b/i.test(text) ||
      /\b(?:amounts?\s+)?in\s+millions\b/i.test(text) ||
      /\b(?:Mn|Million)\s*KShs?\b/i.test(text)) {
    return 1e6;
  }
  if (/\bKShs\s*(?:[T]housands?|000)\b/i.test(text) ||
      /\b(?:figures?\s+)?in\s+thousands\b/i.test(text) ||
      /\b'000\b/.test(text)) {
    return 1e3;
  }
  return 1;
}

function extractMetrics(text) {
  const results = {};
  text = text.replace(/\ufb01/g, 'fi').replace(/\ufb02/g, 'fl');
  const lines = text.split('\n');

  // Detect columns for position-aware extraction
  const columns = detectColumns(lines);
  if (columns) {
    console.log('[extractMetrics] Detected ' + columns.columns.length + ' columns, Group=col' + columns.groupCol + ' (rightmost)');
  }

  const scale = detectScale(text);
  if (scale > 1) {
    console.log('[extractMetrics] Scale detected: ' + scale + 'x');
  }

  for (const [metric, patterns] of Object.entries(METRIC_PATTERNS)) {
    const values = [];
    const perPatternMax = [];
    for (const p of patterns) {
      const re = new RegExp(p.source, 'i');
      let rowMax = 0;
      for (const line of lines) {
        const m = line.match(re);
        if (!m) continue;

        let val = null;
        function negateIfParens(raw, numStr) {
          const n = parseNumber(numStr);
          if (n === null) return null;
          const pos = raw.indexOf(numStr);
          if (pos > 0 && raw[pos - 1] === '(') return -Math.abs(n);
          return n;
        }

        // Strategy 1: column-aware extraction (only for well-aligned text, 2-3 cols)
        if (columns && columns.columns.length <= 3) {
          val = extractNumberFromLine(line, columns);
          if (val === null) {
            // Fallback within column-aware: try captured group
            if (m[1]) val = negateIfParens(m[0], m[1]);
          }
        }
        // Strategy 2: use captured group from pattern tail (number after label)
        if (val === null && m[1]) {
          val = negateIfParens(m[0], m[1]);
        }
        // Strategy 3: fall back to extracting all numbers
        if (val === null) {
          const nums = [];
          NUM_RE.lastIndex = 0;
          let nm;
          while ((nm = NUM_RE.exec(line)) !== null) {
            const v = negateIfParens(line, nm[1]);
            if (v !== null && !(Number.isInteger(v) && (v >= 1 && v <= 999 || v >= 1900 && v <= 2099))) {
              nums.push(v);
            }
          }
          if (nums.length > 0) val = Math.max(...nums);
        }

        if (val !== null) {
          if (Number.isInteger(val) && (val >= 1 && val <= 999 || val >= 1900 && val <= 2099)) continue;
          values.push(val);
          if (Math.abs(val) > Math.abs(rowMax)) rowMax = val;
        }
      }
      if (rowMax !== 0) perPatternMax.push(rowMax);
    }
    if (values.length > 0) {
      if (metric === 'total_debt' && perPatternMax.length > 1) {
        results[metric] = [Math.abs(perPatternMax.reduce((a, b) => a + b, 0))];
      } else {
        const unique = [...new Set(values.map(v => Math.round(v * 100)))].map(v => v / 100);
        results[metric] = unique;
      }
    }
  }
  return results;
}

function extractPdfText(buffer) {
  const latin1 = buffer.toString('latin1');
  const texts = [];

  function decodePdfString(s) {
    return s.replace(/\\(.)/g, (m, c) => c === 'n' ? '\n' : c === 'r' ? '\r' : c === 't' ? '\t' : c);
  }

  function extractFromString(str) {
    let re = /\(([^)]*)\)/g;
    let m;
    while ((m = re.exec(str)) !== null) {
      const t = decodePdfString(m[1]);
      if (t.length > 1 && /[a-zA-Z0-9]{2,}/.test(t)) {
        texts.push(t);
      }
    }
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

function buildPrompt(text) {
  const sector =
    text.match(/\b(bank|banking|financial\s+services?|fintech|insurance|sacco|microfinance)\b/i)
    ? 'banking/financial' : 'general corporate';
  const incomeNote = sector === 'banking/financial'
    ? `- total_revenue: This is "Total operating income" (net interest income + non-interest income) for banks
- cost_of_revenue: This is "Total interest expenses" or "Interest expense" for banks`
    : `- total_revenue: Total revenue or sales
- cost_of_revenue: Cost of revenue, cost of sales, or direct costs`;
  return `Extract ALL 13 financial metrics from this NSE (Nairobi Stock Exchange) financial statement. Sector: ${sector}.
Return ONLY a JSON object with these exact keys (use null ONLY if the value truly cannot be found anywhere in the text):
${incomeNote}
- net_income (number, in KES — Profit after tax / Profit for the year / Net profit attributable to parent)
- operating_income (number, in KES — EBIT / Operating profit / Profit from operations)
- cash_from_operations (number, in KES — Net cash from operating activities / Cash generated from operations)
- total_assets (number, in KES)
- total_liabilities (number, in KES)
- total_debt (number, in KES — Borrowings + lease liabilities, interest-bearing debt)
- current_assets (number, in KES)
- current_liabilities (number, in KES)
- shareholders_equity (number, in KES — Total equity / Shareholders funds)
- retained_earnings (number, in KES)
- eps (number, in KES — Earnings per share. For banks this is typically 10-50 KES)
- dividend_per_share (number, in KES — Dividends per share)

CRITICAL INSTRUCTIONS FOR COLUMN SELECTION:
- The text may have multiple columns: Group (Consolidated) AND Company (Standalone/Bank).
- ALWAYS pick the GROUP / CONSOLIDATED column values, NOT the standalone Company column.
- Group values are always LARGER than Company values (they include subsidiaries).
- Also, pick the LATEST/MOST RECENT year (the first data column after each label).
- If a statement says "Group (KShs Mn)" and "Company (KShs Mn)", use the Group numbers.
- Check: EPS must be logically consistent. If DPS is 7.00, EPS cannot be 0.90 — EPS must be larger than DPS.

Report text:
${text.slice(0, 12000)}`;
}

async function callLlm(text, apiKey, model) {
  const prompt = buildPrompt(text);
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

async function callGemini(text, apiKey, model) {
  const prompt = buildPrompt(text);
  return new Promise((resolve) => {
    const m = model || 'gemini-2.5-flash';
    const body = JSON.stringify({
      contents: [{ parts: [{ text: prompt }] }],
      generationConfig: { temperature: 0.1, responseMimeType: 'application/json' },
    });
    const opts = {
      hostname: 'generativelanguage.googleapis.com',
      path: '/v1beta/models/' + m + ':generateContent?key=' + apiKey,
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
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
            console.error('[Gemini] HTTP ' + res.statusCode + ':' + data.slice(0, 200));
            resolve(null); return;
          }
          const parsed = JSON.parse(data);
          const text = parsed.candidates?.[0]?.content?.parts?.[0]?.text;
          if (text) resolve(JSON.parse(text));
          else resolve(null);
        } catch (e) { console.error('[Gemini] parse error:', e.message); resolve(null); }
      });
    });
    req.on('error', (e) => { console.error('[Gemini] request error:', e.message); resolve(null); });
    req.on('timeout', () => { console.error('[Gemini] timeout'); req.destroy(); resolve(null); });
    req.write(body);
    req.end();
  });
}

async function processText(text, docId, source) {
  let parsedData = {};
  let processedBy = source || 'js';

  const scale = detectScale(text);

  // Step 1: Regex extraction (reliable, no API dependency)
  const metrics = extractMetrics(text);
  for (const [metric, values] of Object.entries(metrics)) {
    if (values.length > 0) {
      const largeMetrics = ['total_revenue','net_income','cost_of_revenue','operating_income','cash_from_operations','total_assets','total_liabilities','total_debt','current_assets','current_liabilities','shareholders_equity','retained_earnings'];
      let filtered = largeMetrics.includes(metric) ? values.filter(v => v > 100) : values;
      if (filtered.length === 0) filtered = values;
      parsedData[metric] = Math.round(Math.max(...filtered) * 100) / 100;
    }
  }
  if (Object.keys(parsedData).length > 0) {
    processedBy = source ? source + ':regex' : 'js:regex';
  }

  // Step 2: LLM fills in gaps (only for metrics regex couldn't extract)
  if (process.env.GEMINI_API_KEY) {
    console.log('[JSParser] Calling Gemini for doc ' + docId + ', text length=' + text.length);
    const llmResult = await callGemini(text, process.env.GEMINI_API_KEY, process.env.GEMINI_MODEL || 'gemini-2.5-flash');
    if (llmResult && Object.values(llmResult).some(v => v !== null)) {
      for (const [k, v] of Object.entries(llmResult)) {
        if (v !== null && v !== undefined && parsedData[k] === undefined) {
          parsedData[k] = Math.round(v * 100) / 100;
        }
      }
      processedBy = 'js:gemini';
      console.log('[JSParser] Gemini filled in ' + Object.keys(parsedData).length + ' metrics for doc ' + docId);
    } else {
      console.log('[JSParser] Gemini returned null for doc ' + docId);
    }
  }
  if (process.env.OPENAI_API_KEY) {
    console.log('[JSParser] Calling OpenAI for doc ' + docId + ', text length=' + text.length);
    const llmResult = await callLlm(text, process.env.OPENAI_API_KEY, process.env.OPENAI_MODEL || 'gpt-4o-mini');
    if (llmResult && Object.values(llmResult).some(v => v !== null)) {
      for (const [k, v] of Object.entries(llmResult)) {
        if (v !== null && v !== undefined && parsedData[k] === undefined) {
          parsedData[k] = Math.round(v * 100) / 100;
        }
      }
      processedBy = 'js:llm';
      console.log('[JSParser] OpenAI filled in gaps for doc ' + docId);
    } else {
      console.log('[JSParser] OpenAI returned null for doc ' + docId);
    }
  }

  // Apply scale normalization
  if (scale > 1 && Object.keys(parsedData).length > 0) {
    const scaledMetrics = ['total_revenue','net_income','cost_of_revenue','operating_income','cash_from_operations','total_assets','total_liabilities','total_debt','current_assets','current_liabilities','shareholders_equity','retained_earnings'];
    for (const k of scaledMetrics) {
      if (parsedData[k] !== undefined && parsedData[k] !== null && parsedData[k] !== 0 && Math.abs(parsedData[k]) < 1e10) {
        parsedData[k] = Math.round(parsedData[k] * scale * 100) / 100;
        console.log('[JSParser] Scaled ' + k + ' by ' + scale + 'x to ' + parsedData[k]);
      }
    }
  }

  // Run validation
  const issues = validateMetrics(parsedData);
  if (issues.length > 0) {
    console.log('[JSParser] Validation issues for doc ' + docId + ': ' + issues.join('; '));
    // Try re-extraction with alternative strategies for failing metrics
    if (issues.some(i => i.includes('Equity') || i.includes('EPS') || i.includes('Revenue'))) {
      const metrics = extractMetrics(text);
      for (const [metric, values] of Object.entries(metrics)) {
        if (values.length > 0 && parsedData[metric] !== undefined) {
          const filtered = values.filter(v => v > 100);
          const candidates = filtered.length > 0 ? filtered : values;
          // If current value fails validation, try the first quartile value instead of max
          candidates.sort((a, b) => a - b);
          const midIdx = Math.floor(candidates.length / 2);
          if (candidates.length >= 2 && candidates[candidates.length - 1] !== candidates[midIdx]) {
            const oldVal = parsedData[metric];
            parsedData[metric] = Math.round(candidates[midIdx] * 100) / 100;
            console.log('[JSParser] Validation retry for ' + metric + ': ' + oldVal + ' -> ' + parsedData[metric]);
          }
        }
      }
      // Re-validate
      const retryIssues = validateMetrics(parsedData);
      if (retryIssues.length < issues.length) {
        console.log('[JSParser] Retry improved validation: ' + retryIssues.length + ' issues remain');
      }
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
