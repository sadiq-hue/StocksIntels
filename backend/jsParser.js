const { pool } = require('./db');
const zlib = require('zlib');
const https = require('https');

const METRIC_PATTERNS = {
  total_revenue: [
    /\btotal\s+revenue(?:\s*\([^)]*\))?[:\s]*\(?([\d,.]+)\)?/gi,
    /\btotal\s+operating\s+income(?:\s*\([^)]*\))?[:\s]*\(?([\d,.]+)\)?/gi,
    /\btotal\s+income(?:\s*\([^)]*\))?[:\s]*\(?([\d,.]+)\)?/gi,
    /\brevenue\s+from\s+contracts\b[^]*?(?:with\s+customers)?[:\s]*\(?([\d,.]+)\)?/gi,
    /\belectricity\s+revenue[:\s]*\(?([\d,.]+)\)?/gi,
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
    /\bshareholders?['\u2019\u2018\u00B4\u0060]s?\s+equity[:\s]*\(?([\d,.]+)\)?/gi,
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

// ── Hard rejection: quarantine clearly impossible parses ──
function implausibleReasons(data) {
  const reasons = [];
  if (data.total_revenue != null && data.total_revenue < 0) reasons.push('negative revenue');
  if (data.total_assets != null && data.total_assets < 0) reasons.push('negative total_assets');
  if (data.total_liabilities != null && data.total_liabilities < 0) reasons.push('negative total_liabilities');
  if (data.shareholders_equity != null && data.shareholders_equity < 0) reasons.push('negative equity');
  if (data.total_revenue != null && data.net_income != null && data.net_income > 0 && data.total_revenue < data.net_income) reasons.push('revenue < net income');
  if (data.eps != null && Math.abs(data.eps) > 1e8) reasons.push('EPS implausibly large (' + data.eps + ')');
  if (data.total_assets != null && data.total_liabilities != null && data.shareholders_equity != null) {
    const expected = data.total_assets - data.total_liabilities;
    if (Math.abs(data.shareholders_equity - expected) > 0.5 * Math.max(Math.abs(data.shareholders_equity), 1)) {
      reasons.push('equity ' + data.shareholders_equity + ' != assets ' + data.total_assets + ' - liab ' + data.total_liabilities + ' = ' + expected);
    }
  }
  if (data.eps != null && data.dividend_per_share != null && Math.abs(data.eps) < Math.abs(data.dividend_per_share)) reasons.push('EPS < DPS');
  return reasons;
}

function isImplausible(data) { return implausibleReasons(data).length > 0; }

// ── Scale detection ──
// Detect whether values are in actual KES, thousands, or millions
// by looking for scale keywords in the text.

function detectScale(text) {
  const norm = text.replace(/[\u2018\u2019\u201C\u201D\u00B4\u2032\u2033]/g, "'").replace(/\ufb01/g, 'fi').replace(/\ufb02/g, 'fl');
  if (/\b(?:K)?Shs?\s*(?:[M]illions?|[M]\.?|M\b|000'?000|'000'000)\b/i.test(norm) ||
      /\b(?:amounts?\s+)?in\s+millions\b/i.test(norm) ||
      /\b(?:Mn|Million)\s*(?:K)?Shs?\b/i.test(norm)) {
    return 1e6;
  }
  if (/\b(?:K)?Shs?\s*(?:[T]housands?|000)\b/i.test(norm) ||
      /\b(?:figures?\s+)?in\s+thousands\b/i.test(norm) ||
      /\b['\u2018\u2019]\s*000\b/.test(norm) ||
      /\bthousands\s+of\s+(?:Kenya\s+)?[Kk]?[Ss]hillings?\b/i.test(norm) ||
      /\b000['\u2018\u2019]\s*$|^(?:in\s+)?thousands\b/im.test(norm)) {
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

function buildPrompt(text, meta) {
  const isInsurance = /\binsurance\b/i.test(text);
  meta = meta || {};
  const periodType = meta.period_type || '';
  const ped = meta.period_end_date || '';
  const ticker = meta.ticker || '';
  const interimNote = periodType === 'half_year'
    ? `\n\nPERIOD TYPE: half-year (6-month INTERIM report). Use the column for the SIX months ended ${ped} ONLY — NEVER the prior-year comparison column. Report every metric for the 6-month cumulative period.`
    : periodType === 'quarterly'
    ? `\n\nPERIOD TYPE: quarterly (INTERIM report). The statement contains BOTH a single-period column (e.g. "3 months ended ${ped}" / "${ped} quarter") AND a cumulative year-to-date column (e.g. "9 months ended" / "6 months ended" / "year to date"). You MUST report figures for the SINGLE reporting quarter ONLY — the column whose header matches the period ${ped} — NEVER the cumulative/year-to-date column.`
    : periodType === 'annual'
    ? `\n\nPERIOD TYPE: annual (12-month / full-year report). Report the FULL-YEAR figure only.`
    : '';
  const sector =
    text.match(/\b(bank|banking|financial\s+services?|fintech|insurance|sacco|microfinance)\b/i)
    ? (isInsurance ? 'insurance' : 'banking/financial') : 'general corporate';
  const incomeNote = sector === 'insurance'
    ? `- total_revenue: "Gross written premium" or "Gross earned premium" or "Net earned premium" or "Insurance revenue" or "Total premium income" or "Premium income" for insurers (NOT claims)
- cost_of_revenue: "Net claims incurred" or "Claims incurred" or "Net claims" for insurers`
    : sector === 'banking/financial'
    ? `- total_revenue: "Total Income" or "Total Operating Income" (Net Interest Income + Non-funded income such as fees, commissions, foreign exchange income) for banks — NOT just "Total interest income"
- cost_of_revenue: "Total interest expense" or "Interest expense" for banks (gross_profit = total_revenue - cost_of_revenue)
- operating_income: "Profit before tax" for banks`
    : `- total_revenue: Total revenue or sales
- cost_of_revenue: Cost of revenue, cost of sales, or direct costs`;
  return `Extract ALL 14 financial metrics from this Nairobi Stock Exchange financial statement. Sector: ${sector}.${interimNote}
The text may be reported in thousands (KShs'000) or millions (KShs M) — you MUST convert every value to ABSOLUTE KENYA SHILLINGS (multiply by the reported scale factor).
For banks, total_revenue MUST be "Total Income" (Net Interest Income + Non-funded income including fees, commissions, FX income). Do NOT use "Total interest income" alone — that is only NII and understates the true revenue.

Return ONLY a JSON object with these exact keys. Use null ONLY if the value truly cannot be found:
${incomeNote}
- net_income (number, in absolute KES — Profit after tax / Profit for the year)
- operating_income (number, in absolute KES — EBIT / Operating profit / Profit from operations)
- cash_from_operations (number, in absolute KES — Net cash from operating activities)
- total_assets (number, in absolute KES)
- total_liabilities (number, in absolute KES)
- total_debt (number, in absolute KES — Total borrowings + lease liabilities)
- current_assets (number, in absolute KES)
- current_liabilities (number, in absolute KES)
- shareholders_equity (number, in absolute KES — Total equity attributable to owners of parent plus non-controlling interests)
- retained_earnings (number, in absolute KES)
- eps (number, in base KES per share — do NOT scale this)
- dividend_per_share (number, in base KES per share — do NOT scale this)

CRITICAL RULES:
- The text has multiple columns: Group (Consolidated) AND Company. ALWAYS pick GROUP/CONSOLIDATED values.
- Group column is the one with LARGER values (includes subsidiaries).
- Pick the LATEST/MOST RECENT year column.
- EPS must be larger than DPS.
- Convert reported values to absolute KES: if text says "KShs'000" multiply by 1,000; if "KShs M" multiply by 1,000,000; if "KShs B" multiply by 1,000,000,000.

Report text:
${text}`;
}

async function callLlm(text, apiKey, model, meta) {
  const prompt = buildPrompt(text, meta);
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

const GEMINI_MODELS = ['gemini-2.0-flash', 'gemini-1.5-flash', 'gemini-2.5-flash'];

async function callGemini(text, apiKey, model, meta) {
  const prompt = buildPrompt(text, meta);
  const modelsToTry = model ? [model] : GEMINI_MODELS;
  for (const m of modelsToTry) {
    const result = await tryGeminiModel(prompt, apiKey, m);
    if (result !== null) return result;
    console.warn('[Gemini] Model ' + m + ' failed, trying next');
  }
  return null;
}

function tryGeminiModel(prompt, apiKey, model) {
  return new Promise((resolve) => {
    const body = JSON.stringify({
      contents: [{ parts: [{ text: prompt }] }],
      generationConfig: { temperature: 0.1 },
    });
    const opts = {
      hostname: 'generativelanguage.googleapis.com',
      path: '/v1beta/models/' + model + ':generateContent?key=' + apiKey,
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Content-Length': Buffer.byteLength(body),
      },
      timeout: 90000,
    };
    const req = https.request(opts, (res) => {
      let data = '';
      res.on('data', (chunk) => data += chunk);
      res.on('end', () => {
        try {
          if (res.statusCode !== 200) {
            console.error('[Gemini] HTTP ' + res.statusCode + ' for ' + model + ':' + data.slice(0, 200));
            resolve(null); return;
          }
          const parsed = JSON.parse(data);
          const rawText = parsed.candidates?.[0]?.content?.parts?.[0]?.text;
          if (!rawText) { console.error('[Gemini] empty response for ' + model); resolve(null); return; }
          console.log('[Gemini] raw response (' + rawText.length + ' chars): ' + rawText.slice(0, 400));
          const cleaned = rawText.replace(/```(?:json)?\n?/gi, '').trim();
          resolve(JSON.parse(cleaned));
        } catch (e) { console.error('[Gemini] parse error:', e.message); resolve(null); }
      });
    });
    req.on('error', (e) => { console.error('[Gemini] request error:', e.message); resolve(null); });
    req.on('timeout', () => { console.error('[Gemini] timeout'); req.destroy(); resolve(null); });
    req.write(body);
    req.end();
  });
}

// ── Mistral (OCR + extraction) ──
const MISTRAL_API_KEY = process.env.MISTRAL_API_KEY;
const MISTRAL_OCR_MODEL = process.env.MISTRAL_OCR_MODEL || 'mistral-ocr-latest';
const MISTRAL_EXTRACT_MODEL = process.env.MISTRAL_EXTRACT_MODEL || 'mistral-small-latest';

function mistralPost(path, body, apiKey) {
  return new Promise((resolve) => {
    const data = JSON.stringify(body);
    const url = new URL('https://api.mistral.ai' + path);
    const opts = {
      hostname: url.hostname,
      path: url.pathname + url.search,
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': 'Bearer ' + apiKey,
        'Content-Length': Buffer.byteLength(data),
      },
      timeout: 120000,
    };
    const req = https.request(opts, (res) => {
      let chunks = '';
      res.on('data', (c) => chunks += c);
      res.on('end', () => {
        try {
          if (res.statusCode !== 200) {
            console.error('[Mistral] HTTP ' + res.statusCode + ' on ' + path + ': ' + chunks.slice(0, 300));
            resolve(null); return;
          }
          resolve(JSON.parse(chunks));
        } catch (e) { console.error('[Mistral] parse error:', e.message); resolve(null); }
      });
    });
    req.on('error', (e) => { console.error('[Mistral] request error:', e.message); resolve(null); });
    req.on('timeout', () => { console.error('[Mistral] timeout on ' + path); req.destroy(); resolve(null); });
    req.write(data);
    req.end();
  });
}

async function callMistralOcr(buffer) {
  if (!MISTRAL_API_KEY) return null;
  const b64 = buffer.toString('base64');
  console.log('[Mistral] OCR request (' + (buffer.length / 1024).toFixed(0) + ' KB)');
  const resp = await mistralPost('/v1/ocr', {
    model: MISTRAL_OCR_MODEL,
    document: { type: 'document_url', document_url: 'data:application/pdf;base64,' + b64 },
    include_image_base64: false,
  }, MISTRAL_API_KEY);
  if (!resp || !Array.isArray(resp.pages)) return null;
  return resp.pages.map(p => p.markdown || '').join('\n\n');
}

async function callMistralExtract(text, apiKey, model, meta) {
  const prompt = buildPrompt(text, meta);
  console.log('[Mistral] extraction request (text ' + text.length + ' chars, model ' + model + ')');
  const resp = await mistralPost('/v1/chat/completions', {
    model: model || MISTRAL_EXTRACT_MODEL,
    messages: [{ role: 'user', content: prompt }],
    temperature: 0,
    response_format: { type: 'json_object' },
  }, apiKey);
  if (!resp || !resp.choices || !resp.choices[0]) { console.error('[Mistral] empty completion'); return null; }
  const content = resp.choices[0].message.content;
  try {
    console.log('[Mistral] raw response: ' + content.slice(0, 400));
    return JSON.parse(content.replace(/```(?:json)?\n?/gi, '').trim());
  } catch (e) { console.error('[Mistral] JSON parse error:', e.message); return null; }
}

const EXPECTED_METRICS = ['total_revenue','net_income','cost_of_revenue','operating_income','cash_from_operations','total_assets','total_liabilities','total_debt','current_assets','current_liabilities','shareholders_equity','retained_earnings','eps','dividend_per_share'];

// Monetary statement figures that are subject to KShs '000 / millions scaling.
// Small per-share figures (eps, dividend_per_share) must NEVER be scaled.
const SCALE_METRICS = ['total_revenue','net_income','cost_of_revenue','operating_income','cash_from_operations','total_assets','total_liabilities','total_debt','current_assets','current_liabilities','shareholders_equity','retained_earnings'];

// No legitimate NSE company has > KShs 4 trillion in assets/revenue (largest
// local banks ~KShs 2 trillion). A uniform 1,000x scaling error pushes NSE
// statements into the trillions range, so clamp those back down.
const SCALE_CAP = 4e12;
function maxLargeMetric(o) {
  return Math.max(o.total_assets || 0, o.total_revenue || 0, o.total_liabilities || 0, o.shareholders_equity || 0, o.net_income || 0);
}
function applyOverScaleCorrection(cand, docId) {
  let guard = 0;
  while (maxLargeMetric(cand) > SCALE_CAP && guard < 4) {
    for (const k of SCALE_METRICS) {
      if (cand[k] !== undefined && cand[k] !== null && cand[k] !== 0) {
        cand[k] = Math.round((cand[k] / 1000) * 100) / 100;
      }
    }
    guard++;
  }
  if (guard > 0) console.log('[JSParser] Applied over-scale correction (/1000 x' + guard + ') for doc ' + docId);
}

// Map the many labels LLMs use onto the canonical keys the frontend reads.
const ALIAS_MAP = {
  total_revenue: ['total_revenue','revenue','turnover','sales','total_sales','gross_revenue','net_revenue','total_turnover','total_income'],
  cost_of_revenue: ['cost_of_revenue','cost_of_sales','cogs','cost_of_goods_sold'],
  net_income: ['net_income','profit_after_tax','pat','net_profit','profit_for_year','profit_for_the_year','net_income_after_tax','profit_after_taxation'],
  operating_income: ['operating_income','operating_profit','ebit','profit_from_operations','profit_before_interest_and_tax'],
  eps: ['eps','earnings_per_share'],
  dividend_per_share: ['dividend_per_share','dps','dividend','dividends_per_share'],
  shareholders_equity: ['shareholders_equity','total_equity','equity','total_shareholders_equity','shareholders_funds','equity_attributable_to_owners','total_equity_attributable'],
  total_assets: ['total_assets','assets'],
  total_liabilities: ['total_liabilities','liabilities'],
  total_debt: ['total_debt','total_borrowings','borrowings','debt'],
  current_assets: ['current_assets'],
  current_liabilities: ['current_liabilities'],
  retained_earnings: ['retained_earnings','retained_earnings_reserve'],
  cash_from_operations: ['cash_from_operations','operating_cash_flow','cash_from_operating_activities','net_cash_from_operations','cash_from_ops'],
  cash_and_equivalents: ['cash_and_equivalents','cash_and_bank','cash_and_cash_equivalents','cash'],
  free_cash_flow: ['free_cash_flow','fcf'],
  shares_outstanding: ['shares_outstanding','num_shares','number_of_shares','shares','total_shares'],
  book_value_per_share: ['book_value_per_share','bvps'],
};

function normalizeAliases(raw) {
  if (!raw || typeof raw !== 'object') return raw;
  const out = {};
  for (const [canonical, aliases] of Object.entries(ALIAS_MAP)) {
    for (const a of aliases) {
      if (raw[a] !== undefined && raw[a] !== null && raw[a] !== '') {
        const v = Number(raw[a]);
        if (!isNaN(v)) { out[canonical] = Math.round(v * 100) / 100; break; }
      }
    }
  }
  // Preserve any other numeric keys we didn't explicitly map
  for (const [k, v] of Object.entries(raw)) {
    if (out[k] === undefined && typeof v === 'number' && !isNaN(v)) out[k] = Math.round(v * 100) / 100;
  }
  // Derive equity when missing but balance sheet is present
  if (out.shareholders_equity == null && out.total_assets != null && out.total_liabilities != null) {
    out.shareholders_equity = Math.round((out.total_assets - out.total_liabilities) * 100) / 100;
  }
  return out;
}

function tryLlm(text, apiKey, provider, meta) {
  if (provider === 'gemini') return callGemini(text, apiKey, process.env.GEMINI_MODEL || 'gemini-2.5-flash', meta);
  if (provider === 'mistral') return callMistralExtract(text, apiKey, MISTRAL_EXTRACT_MODEL, meta);
  return callLlm(text, apiKey, process.env.OPENAI_MODEL || 'gpt-4o-mini', meta);
}

async function processText(text, docId, source, meta) {
  let parsedData = {};
  let processedBy = source || 'js';

  // LLM-only extraction (no regex fallback)
  const llmProviders = [];
  if (process.env.MISTRAL_API_KEY) llmProviders.push({ key: process.env.MISTRAL_API_KEY, name: 'mistral' });
  if (process.env.GEMINI_API_KEY) llmProviders.push({ key: process.env.GEMINI_API_KEY, name: 'gemini' });
  if (process.env.OPENAI_API_KEY) llmProviders.push({ key: process.env.OPENAI_API_KEY, name: 'openai' });

  for (const { key, name } of llmProviders) {
    console.log('[JSParser] Calling ' + name + ' for doc ' + docId + ', text length=' + text.length);
    const llmResult = normalizeAliases(await tryLlm(text, key, name, meta));
    if (llmResult) {
      let validCount = 0;
      const cand = {};
      for (const k of EXPECTED_METRICS) {
        if (llmResult[k] !== null && llmResult[k] !== undefined && !isNaN(llmResult[k])) {
          cand[k] = Math.round(llmResult[k] * 100) / 100;
          validCount++;
        }
      }
        if (validCount >= 8) {
          applyOverScaleCorrection(cand, docId);
          if (!isImplausible(cand)) {
            parsedData = cand;
            processedBy = 'js:' + name;
          console.log('[JSParser] ' + name + ' extracted ' + validCount + ' metrics for doc ' + docId);
          break;
        }
        const why = implausibleReasons(cand).join('; ');
        console.log('[JSParser] ' + name + ' result implausible (' + why + '), trying next provider');
        parsedData = {};
      } else {
        parsedData = {};
        console.log('[JSParser] ' + name + ' only returned ' + validCount + ' metrics (<8), trying next LLM');
      }
    } else {
      console.log('[JSParser] ' + name + ' returned null for doc ' + docId);
    }
  }

  // Fallback: regex extraction when LLM unavailable (e.g., API quota exceeded)
  const regexFallbackTried = Object.keys(parsedData).length === 0;
  if (regexFallbackTried) {
    console.log('[JSParser] LLM failed, trying regex fallback for doc ' + docId);
    const scale = detectScale(text);
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
      processedBy = 'js:regex';
      if (scale > 1) {
        for (const k of ['total_revenue','net_income','cost_of_revenue','operating_income','cash_from_operations','total_assets','total_liabilities','total_debt','current_assets','current_liabilities','shareholders_equity','retained_earnings']) {
          if (parsedData[k] !== undefined && parsedData[k] !== null && parsedData[k] !== 0 && Math.abs(parsedData[k]) < 1e10) {
            parsedData[k] = Math.round(parsedData[k] * scale * 100) / 100;
          }
        }
      }
      console.log('[JSParser] Regex fallback extracted ' + Object.keys(parsedData).length + ' metrics for doc ' + docId);
    }
  }

  // Validation
  const issues = validateMetrics(parsedData);
  if (issues.length > 0) {
    console.log('[JSParser] Validation issues for doc ' + docId + ': ' + issues.join('; '));
  }

  const hasAnyData = Object.keys(parsedData).length > 0;
  if (hasAnyData && !isImplausible(parsedData) && !regexFallbackTried) {
    await pool.query(
      `UPDATE financial_statements SET status = 'completed', parsed_data = $1, parsed_at = CURRENT_TIMESTAMP, processed_by = $2 WHERE id = $3`,
      [JSON.stringify(parsedData), processedBy, docId]
    );
  } else if (hasAnyData) {
    // Either implausible, or came from the (unreliable) regex fallback — do NOT publish as authoritative.
    const why = isImplausible(parsedData)
      ? implausibleReasons(parsedData).join('; ')
      : 'regex fallback extraction (unreliable) — not stored as authoritative';
    console.log('[JSParser] Not storing as completed for doc ' + docId + ': ' + why);
    await pool.query(
      `UPDATE financial_statements SET status = 'failed', parsed_data = $1, error_message = $2, parsed_at = CURRENT_TIMESTAMP, processed_by = $3 WHERE id = $4`,
      [JSON.stringify(parsedData), 'Rejected: ' + why, processedBy, docId]
    );
  } else {
    const preview = text.slice(0, 300).replace(/\0/g, '');
    let errorDetail;
    if (llmProviders.length === 0) {
      errorDetail = 'No API keys configured (set MISTRAL_API_KEY, GEMINI_API_KEY or OPENAI_API_KEY)';
    } else if (regexFallbackTried) {
      errorDetail = 'LLM quota exceeded / returned no data, regex fallback also returned no data';
    } else {
      errorDetail = 'LLM returned <8 valid metrics (check logs for [Mistral]/[Gemini]/[LLM] messages)';
    }
    await pool.query(
      `UPDATE financial_statements SET status = 'completed', parsed_data = '{}'::jsonb, error_message = $1, parsed_at = CURRENT_TIMESTAMP, processed_by = $2 WHERE id = $3`,
      [errorDetail + '. Text preview: ' + preview, processedBy, docId]
    );
  }

  if (parsedData.dividend_per_share || parsedData.eps) {
    // NOTE: per-share metrics are persisted by financialStatementsStore.upsertFundamentals
    // (symbol-keyed) after storage. The legacy block below wrote to a uuid-keyed
    // statement_id column with an int docId and has been silently failing via the
    // try/catch — removed in favor of the canonical path.
  }
}

async function parsePdfBuffer(buffer, docId, meta) {
  try {
    let text = null;
    if (MISTRAL_API_KEY) {
      text = await callMistralOcr(buffer);
      if (text && text.trim()) console.log('[JSParser] Mistral OCR produced ' + text.length + ' chars for doc ' + docId);
    }
    if (!text || !text.trim()) text = extractPdfText(buffer);
    if (!text.trim()) {
      await pool.query(`UPDATE financial_statements SET status = 'failed', error_message = 'No text could be extracted from PDF' WHERE id = $1`, [docId]);
      return;
    }
    await processText(text, docId, 'js', meta);
  } catch (e) {
    await pool.query(`UPDATE financial_statements SET status = 'failed', error_message = $1 WHERE id = $2`, [e.message, docId]);
  }
}

async function parseExtractedText(text, docId, fileName, meta) {
  try {
    if (!text.trim()) {
      await pool.query(`UPDATE financial_statements SET status = 'failed', error_message = 'Empty text' WHERE id = $1`, [docId]);
      return;
    }
    await processText(text, docId, 'js', meta);
  } catch (e) {
    await pool.query(`UPDATE financial_statements SET status = 'failed', error_message = $1 WHERE id = $2`, [e.message, docId]);
  }
}

module.exports = { parsePdfBuffer, parseExtractedText, extractMetrics, detectScale, callMistralOcr, normalizeAliases, applyOverScaleCorrection, isImplausible, implausibleReasons };
