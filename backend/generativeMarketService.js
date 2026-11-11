// Bounded generative overlay for the adaptive signal gates.
//
// The LLM never sees individual stock data and never emits a trade. It receives
// only the market-condition snapshot (VIX, breadth, credit, sector rotation,
// regime) and returns a small, clamped gate bias plus a short narrative. The
// deterministic market gates remain the source of truth; this overlay can only
// move the score/confidence bars by at most +/-2 points.
//
// If no key is configured, or the provider fails, a deterministic summary is
// used with bias 0 so signal generation is never dependent on the LLM.

const axios = require('axios');

const CACHE_MS = Number(process.env.GENERATIVE_MARKET_CACHE_MS) || 15 * 60 * 1000;
const MAX_BIAS = Number(process.env.GENERATIVE_MARKET_MAX_BIAS) || 2;
const MODEL = process.env.OPENAI_MODEL || 'gpt-4o-mini';
const GEMINI_MODEL = process.env.GEMINI_MODEL || 'gemini-3.8-flash';
const MISTRAL_MODEL = process.env.MISTRAL_MODEL || 'mistral-small-latest';
const SYSTEM_PROMPT = [
  'You are a risk-overlay analyst for an equity signal engine.',
  'Return only valid JSON with these keys: riskPosture (risk-on|mixed|risk-off),',
  'gateBias (integer -2..2), confidence (0..1), narrative (<=2 sentences),',
  'keySupports (array of <=3 strings), keyRisks (array of <=3 strings).',
  'gateBias must be small: positive raises the bar when conditions deteriorate,',
  'negative lowers it when conditions improve. Use only the supplied data.',
  'Do not give stock recommendations or invent facts.',
].join(' ');

let cached = { at: 0, overlay: null };
let inflight = null;

function clampBias(value) {
  const n = Number(value);
  if (!Number.isFinite(n)) return 0;
  return Math.max(-MAX_BIAS, Math.min(MAX_BIAS, Math.round(n)));
}

function deterministicOverlay(conditions = {}) {
  const vix = Number(conditions.vix) > 0 ? Number(conditions.vix) : null;
  const breadth = Number(conditions.breadth?.score);
  const trend = Number(conditions.breadth?.pctAbove200);
  const credit = Number(conditions.creditSpread) > 0 ? Number(conditions.creditSpread) : null;
  const riskOn = conditions.sectors?.riskOn === true;
  const riskTone = conditions.riskTone || 'unknown';

  const supports = [];
  const risks = [];
  if (Number.isFinite(vix)) {
    if (vix >= 30) risks.push(`VIX ${vix.toFixed(1)} is in stress territory`);
    else if (vix <= 17) supports.push(`VIX ${vix.toFixed(1)} is calm`);
  }
  if (Number.isFinite(breadth)) {
    if (breadth >= 70) supports.push(`breadth is broad (${breadth})`);
    else if (breadth <= 30) risks.push(`breadth is weak (${breadth})`);
  }
  if (Number.isFinite(trend)) {
    if (trend >= 65) supports.push(`${trend}% of tracked names are above the 200DMA`);
    else if (trend <= 35) risks.push(`only ${trend}% of tracked names are above the 200DMA`);
  }
  if (Number.isFinite(credit) && credit >= 5) risks.push(`high-yield spread is elevated at ${credit.toFixed(2)}%`);
  if (riskOn) supports.push('sector rotation is risk-on');
  else if (conditions.sectors?.rows) risks.push('sector rotation is defensive');

  const narrative = [
    `Market tone is ${riskTone}`,
    Number.isFinite(vix) ? `VIX ${vix.toFixed(1)}` : null,
    Number.isFinite(breadth) ? `breadth ${breadth}` : null,
    Number.isFinite(trend) ? `${trend}% above 200DMA` : null,
    Number.isFinite(credit) ? `HY spread ${credit.toFixed(2)}%` : null,
  ].filter(Boolean).join(' · ') + '.';

  return {
    source: 'deterministic',
    asOf: new Date().toISOString(),
    riskPosture: riskTone === 'risk-on' || riskTone === 'risk-off' ? riskTone : 'mixed',
    gateBias: 0,
    confidence: null,
    narrative,
    keyRisks: risks.slice(0, 3),
    keySupports: supports.slice(0, 3),
  };
}

function snapshotForModel(conditions = {}) {
  return {
    asOf: conditions.asOf || null,
    riskTone: conditions.riskTone || 'unknown',
    vix: conditions.vix ?? null,
    vixChangePct: conditions.vixChangePct ?? null,
    breadthScore: conditions.breadth?.score ?? null,
    pctAbove200: conditions.breadth?.pctAbove200 ?? null,
    pctAbove50: conditions.breadth?.pctAbove50 ?? null,
    advancers: conditions.breadth?.advancers ?? null,
    decliners: conditions.breadth?.decliners ?? null,
    newHighs: conditions.breadth?.newHighs ?? null,
    newLows: conditions.breadth?.newLows ?? null,
    sectorLeader: conditions.sectors?.leader ?? null,
    sectorLaggard: conditions.sectors?.laggard ?? null,
    sectorRiskOn: conditions.sectors?.riskOn ?? null,
    creditSpread: conditions.creditSpread ?? null,
  };
}

function normalizeOverlay(parsed, conditions, source = 'openai') {
  const posture = ['risk-on', 'mixed', 'risk-off'].includes(parsed?.riskPosture)
    ? parsed.riskPosture
    : (conditions.riskTone === 'risk-on' || conditions.riskTone === 'risk-off' ? conditions.riskTone : 'mixed');
  const narrative = typeof parsed?.narrative === 'string' ? parsed.narrative.slice(0, 700) : '';
  const array = (v) => (Array.isArray(v) ? v.filter(x => typeof x === 'string').slice(0, 5) : []);
  return {
    source,
    asOf: new Date().toISOString(),
    riskPosture: posture,
    gateBias: clampBias(parsed?.gateBias),
    confidence: Number.isFinite(Number(parsed?.confidence)) ? Math.max(0, Math.min(1, Number(parsed.confidence))) : null,
    narrative: narrative || deterministicOverlay(conditions).narrative,
    keyRisks: array(parsed?.keyRisks),
    keySupports: array(parsed?.keySupports),
  };
}

function parseJson(text) {
  const raw = String(text || '').trim();
  const start = raw.indexOf('{');
  const end = raw.lastIndexOf('}');
  if (start < 0 || end <= start) throw new Error('no JSON object');
  return JSON.parse(raw.slice(start, end + 1));
}

async function callOpenAi(payload) {
  const key = process.env.OPENAI_API_KEY;
  if (!key) throw new Error('openai key missing');
  const res = await axios.post(
    'https://api.openai.com/v1/chat/completions',
    {
      model: MODEL,
      temperature: 0.2,
      max_tokens: 300,
      response_format: { type: 'json_object' },
      messages: [
        { role: 'system', content: SYSTEM_PROMPT },
        { role: 'user', content: JSON.stringify(payload) },
      ],
    },
    { timeout: 20000, headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' } }
  );
  return res?.data?.choices?.[0]?.message?.content || '{}';
}

async function callMistral(payload) {
  const key = process.env.MISTRAL_API_KEY;
  if (!key) throw new Error('mistral key missing');
  const res = await axios.post(
    'https://api.mistral.ai/v1/chat/completions',
    {
      model: MISTRAL_MODEL,
      temperature: 0.2,
      max_tokens: 300,
      response_format: { type: 'json_object' },
      messages: [
        { role: 'system', content: SYSTEM_PROMPT },
        { role: 'user', content: JSON.stringify(payload) },
      ],
    },
    { timeout: 20000, headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' } }
  );
  return res?.data?.choices?.[0]?.message?.content || '{}';
}

async function callGemini(payload) {
  const key = process.env.GEMINI_API_KEY;
  if (!key) throw new Error('gemini key missing');
  const res = await axios.post(
    `https://generativelanguage.googleapis.com/v1beta/models/${GEMINI_MODEL}:generateContent?key=${key}`,
    {
      contents: [{
        role: 'user',
        parts: [{ text: `${SYSTEM_PROMPT}\n\nMARKET DATA:\n${JSON.stringify(payload)}` }],
      }],
      generationConfig: {
        temperature: 0.2,
        maxOutputTokens: 700,
        responseMimeType: 'application/json',
        thinkingConfig: { thinkingBudget: 0 },
      },
    },
    { timeout: 30000, headers: { 'Content-Type': 'application/json' } }
  );
  const parts = res?.data?.candidates?.[0]?.content?.parts || [];
  return parts.map(p => p?.text || '').join('') || '{}';
}

async function callProvider(payload) {
  const explicit = String(process.env.GENERATIVE_MARKET_PROVIDER || '').toLowerCase();
  const providers = ['gemini', 'mistral', 'openai'];
  if (explicit === 'gemini' || explicit === 'mistral' || explicit === 'openai') {
    providers.splice(providers.indexOf(explicit), 1);
    providers.unshift(explicit);
  }
  let lastError = null;
  for (const provider of providers) {
    try {
      const text = provider === 'gemini'
        ? await callGemini(payload)
        : provider === 'mistral'
          ? await callMistral(payload)
          : await callOpenAi(payload);
      return { text, provider };
    } catch (e) {
      lastError = e;
    }
  }
  throw lastError || new Error('no LLM provider configured');
}

async function refresh(conditions = {}) {
  if (process.env.GENERATIVE_MARKET_ENABLED === 'false') {
    const overlay = deterministicOverlay(conditions);
    cached = { at: Date.now(), overlay };
    return overlay;
  }
  // Do not pin the overlay to a cold-start snapshot; wait for the conditions
  // plane to have VIX or breadth before asking a provider.
  if (conditions.vix == null && !conditions.breadth) return deterministicOverlay(conditions);
  if (cached.overlay) {
    const age = Date.now() - cached.at;
    const cacheMs = cached.overlay.source === 'deterministic' ? 60 * 1000 : CACHE_MS;
    if (age < cacheMs) return cached.overlay;
  }
  if (inflight) return inflight;

  inflight = (async () => {
    try {
      const payload = snapshotForModel(conditions);
      const { text, provider } = await callProvider(payload);
      const parsed = parseJson(text);
      const overlay = normalizeOverlay(parsed, conditions, provider);
      cached = { at: Date.now(), overlay };
      return overlay;
    } catch (e) {
      console.warn(`[GenerativeMarket] overlay fallback: ${e.response?.status || e.message}`);
      const overlay = deterministicOverlay(conditions);
      cached = { at: Date.now(), overlay };
      return overlay;
    } finally {
      inflight = null;
    }
  })();
  return inflight;
}

function peek() {
  return cached.overlay;
}

module.exports = { refresh, peek, deterministicOverlay, snapshotForModel };
