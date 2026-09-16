const axios = require('axios');

const OLLAMA_URL = process.env.OLLAMA_URL || 'http://localhost:11434';
const MODEL = process.env.LLM_MODEL || 'llama3';
const TIMEOUT = parseInt(process.env.LLM_TIMEOUT || '240000');
const MISTRAL_MODEL = process.env.MISTRAL_MODEL || 'mistral-large-latest';

const SYSTEM_PROMPT = `You are a professional financial market analyst writing for StocksIntels, an African stock market intelligence platform covering NSE (Nairobi Securities Exchange), NGX (Nigeria), GSE (Ghana), JSE and global markets. Write concise, insightful editorial content. Use natural Kenyan financial market terminology. Follow the length and format the task requests — if a task asks for a longer piece, write the full requested length. Never use markdown formatting unless the task explicitly requests a labeled format. Never mention you are an AI. Write as if you are the StocksIntels editorial team.`;

// Serialize Mistral calls with a minimum gap between them. Newsletter/insights
// generation fires many prompts in a row (per-stock narratives + editorial
// sections); bursting them trips the account rate limit (429 "Rate limit
// exceeded"), which pushed every narrative onto the generic fallback.
const LLM_MIN_GAP_MS = parseInt(process.env.LLM_MIN_GAP_MS || '1200', 10);
let _llmChain = Promise.resolve();
let _llmLastAt = 0;
function scheduleLlm(fn) {
  const run = async () => {
    const wait = Math.max(0, LLM_MIN_GAP_MS - (Date.now() - _llmLastAt));
    if (wait > 0) await new Promise(r => setTimeout(r, wait));
    _llmLastAt = Date.now();
    return fn();
  };
  const result = _llmChain.then(run, run);
  _llmChain = result.catch(() => {});
  return result;
}

// Circuit breakers: when a provider returns a rate-limit/auth error, stop hitting
// it (and paying its retry backoff) for a while and use the next provider. Without
// this, a rate-limited Mistral adds tens of seconds of backoff per call.
let _mistralDownUntil = 0;
let _geminiDownUntil = 0;

async function generateViaMistral(prompt, system, maxTokens, temperature) {
  // Read the key live from env at call time (a later dotenv override/load elsewhere in the
  // process may have replaced process.env values; never cache it at require time).
  const apiKey = process.env.MISTRAL_API_KEY;
  if (!apiKey) throw new Error('MISTRAL_API_KEY not set at call time');
  let lastErr;
  const MAX_ATTEMPTS = 3;
  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
    try {
      return await scheduleLlm(async () => {
        const res = await axios.post('https://api.mistral.ai/v1/chat/completions', {
          model: MISTRAL_MODEL,
          messages: [
            { role: 'system', content: system || SYSTEM_PROMPT },
            { role: 'user', content: prompt },
          ],
          max_tokens: maxTokens,
          temperature,
        }, { timeout: TIMEOUT, proxy: false, headers: { Authorization: `Bearer ${apiKey}` } });
        return res.data.choices[0].message.content.trim();
      });
    } catch (err) {
      lastErr = err;
      const status = err.response?.status;
      const retryAfter = parseInt(err.response?.headers?.['retry-after'], 10);
      // Retry transient/account-level failures with exponential backoff (honouring
      // Retry-After when Mistral sends one). Stop immediately on 400/422 (bad request).
      const retryable = status === 401 || status === 403 || status === 429 || status >= 500 || status === undefined;
      if (attempt < MAX_ATTEMPTS && retryable) {
        const backoff = Number.isFinite(retryAfter) && retryAfter > 0
          ? retryAfter * 1000
          : Math.min(20000, 1500 * Math.pow(2, attempt - 1)) + Math.floor(Math.random() * 500);
        await new Promise(r => setTimeout(r, backoff));
        continue;
      }
      throw err;
    }
  }
  throw lastErr;
}

// Google Gemini (generativelanguage) — fallback for when Mistral is rate-limited
// or its key is absent. GEMINI_MODEL overrides the model.
async function generateViaGemini(prompt, system, maxTokens, temperature) {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) throw new Error('GEMINI_API_KEY not set at call time');
  const model = process.env.GEMINI_MODEL || 'gemini-3.6-flash';
  let lastErr;
  for (let attempt = 1; attempt <= 3; attempt++) {
    try {
      return await scheduleLlm(async () => {
        const res = await axios.post(
          `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${apiKey}`,
          {
            systemInstruction: system ? { parts: [{ text: system }] } : undefined,
            contents: [{ role: 'user', parts: [{ text: prompt }] }],
            generationConfig: { temperature, maxOutputTokens: maxTokens },
          },
          { timeout: TIMEOUT, proxy: false });
        const parts = res.data?.candidates?.[0]?.content?.parts || [];
        const text = parts.map(p => p.text).filter(Boolean).join('').trim();
        if (!text) throw new Error('empty Gemini response');
        return text;
      });
    } catch (err) {
      lastErr = err;
      const status = err.response?.status;
      if (attempt < 3 && (status === 429 || status >= 500 || status === undefined)) {
        await new Promise(r => setTimeout(r, 1500 * attempt));
        continue;
      }
      throw err;
    }
  }
  throw lastErr;
}

async function generate(prompt, options = {}) {
  const { temperature = 0.7, maxTokens = 300, system } = options;
  const errors = [];
  // 1) Ollama (self-hosted), 2) Mistral, 3) Gemini — first that answers wins, so a
  // rate-limited/absent Mistral key no longer forces the generic fallback text.
  if (OLLAMA_URL) {
    try {
      const res = await axios.post(`${OLLAMA_URL}/api/generate`, {
        model: MODEL,
        prompt,
        system: system || SYSTEM_PROMPT,
        stream: false,
        options: { temperature, num_predict: maxTokens },
      }, { timeout: TIMEOUT, proxy: false });
      if (res.data?.response?.trim()) return res.data.response.trim();
    } catch (e) { errors.push('ollama: ' + e.message); }
  }
  if (process.env.MISTRAL_API_KEY && Date.now() > _mistralDownUntil) {
    try { return await generateViaMistral(prompt, system, maxTokens, temperature); }
    catch (e) {
      const s = e.response?.status;
      if (s === 429 || s === 401 || s === 403) _mistralDownUntil = Date.now() + 10 * 60 * 1000;
      errors.push('mistral: ' + e.message);
    }
  } else if (process.env.MISTRAL_API_KEY) {
    errors.push('mistral: cooling down after rate limit');
  }
  if (process.env.GEMINI_API_KEY && Date.now() > _geminiDownUntil) {
    try { return await generateViaGemini(prompt, system, maxTokens, temperature); }
    catch (e) {
      if (e.response?.status === 429) _geminiDownUntil = Date.now() + 60 * 1000;
      errors.push('gemini: ' + e.message);
    }
  }
  throw new Error('No LLM backend available (' + (errors.join('; ') || 'no provider configured') + ')');
}

async function generateNseSummary(nse20, nasi, gainers, losers, topSector, worstSector) {
  const ctx = [
    `NSE 20: ${nse20?.value || 'N/A'} (${nse20?.change || 'N/A'})`,
    `NASI: ${nasi?.value || 'N/A'} (${nasi?.change || 'N/A'})`,
    `Top gainers: ${(gainers || []).slice(0,3).map(s => `${s.name||s.symbol} ${s.change||''}`).join(', ') || 'none'}`,
    `Top losers: ${(losers || []).slice(0,3).map(s => `${s.name||s.symbol} ${s.change||''}`).join(', ') || 'none'}`,
    `Best sector: ${topSector ? `${topSector.sector} (${topSector.avgChange}%)` : 'N/A'}`,
    `Worst sector: ${worstSector ? `${worstSector.sector} (${worstSector.avgChange}%)` : 'N/A'}`,
  ].join('\n');
  return generate(`Summarise this week's NSE market performance in 3-4 sentences. Include the index movement, notable movers, and sector trends.\n\nMarket data:\n${ctx}`, { maxTokens: 250 });
}

async function generateStoryOfWeek(gainers, losers, topNews) {
  const newsCtx = topNews ? `Top story: "${topNews.headline}" (${topNews.excerpt || ''}) — Source: ${topNews.source || ''}` : 'No standout news this week.';
  const topGainer = gainers?.length ? `${gainers[0].name||gainers[0].symbol} (${gainers[0].change||''})` : 'none';
  return generate(`Write 2-3 sentences about the most significant story or market move this week on the NSE and African markets.\n\n${newsCtx}\nTop mover: ${topGainer}`, { maxTokens: 200 });
}

async function generateMilestone(nse20, gainers) {
  const ctx = [
    nse20 ? `NSE 20 at ${nse20.value} (${nse20.change})` : '',
    gainers?.length ? `Standout stock: ${gainers[0].name||gainers[0].symbol} up ${gainers[0].change||''}` : '',
  ].filter(Boolean).join('\n');
  return generate(`Identify one key milestone or notable level achieved in markets this week. Write 2-3 sentences.\n\n${ctx || 'Markets were relatively quiet this week.'}`, { maxTokens: 150 });
}

async function generateGlobalTheme(indices, sectors, globalGainers) {
  const sp = (indices||[]).find(i => i.symbol?.includes('GSPC'));
  const ndx = (indices||[]).find(i => i.symbol?.includes('IXIC'));
  const ctx = [
    sp ? `S&P 500: ${sp.value} (${sp.change})` : '',
    ndx ? `Nasdaq: ${ndx.value} (${ndx.change})` : '',
    sectors?.length ? `Top sectors: ${sectors.filter(s=>s.avgChange>0).slice(0,3).map(s=>`${s.sector} ${s.avgChange}%`).join(', ')}` : '',
    globalGainers?.length ? `Best global: ${globalGainers[0].name||globalGainers[0].symbol} (${globalGainers[0].change||''})` : '',
  ].filter(Boolean).join('\n');
  return generate(`Summarise the key global market themes this week in 3-4 sentences. Cover US indices performance and sector trends.\n\n${ctx || 'Global markets were mixed this week.'}`, { maxTokens: 250 });
}

async function generateWhatToWatch(signals, sectors) {
  const total = signals?.total || 0;
  const strongBuys = signals?.strongBuys || 0;
  const sells = signals?.sells || 0;
  const topSectors = (sectors||[]).slice(0,3).map(s => `${s.sector} (${s.avgChange}%)`).join(', ');
  const ctx = `Active signals: ${total} (${strongBuys} strong buy, ${sells} sell)${topSectors ? `\nLeading sectors: ${topSectors}` : ''}`;
  return generate(`Write 2-3 sentences on what traders should watch in the coming week. Reference signal counts and key levels.\n\n${ctx}`, { maxTokens: 200 });
}

async function generateNseGlobalConnection(nse20, sp500) {
  const ctx = [
    nse20 ? `NSE 20: ${nse20.value} (${nse20.change})` : '',
    sp500 ? `S&P 500: ${sp500.value} (${sp500.change})` : '',
  ].filter(Boolean).join('\n');
  return generate(`Write 2-3 sentences connecting global market movements to the NSE outlook for the coming week.\n\n${ctx || 'Global and local market data loading.'}`, { maxTokens: 200 });
}

async function generateAiSignalContext(sentiment, signals, topSignals) {
  const ctx = [
    `Market sentiment: ${sentiment || 'neutral'}`,
    `Total signals: ${signals?.total || 0}`,
    `Strong buys: ${signals?.strongBuys || 0}`,
    topSignals?.length ? `Top signal: ${topSignals[0].name||topSignals[0].ticker} (${topSignals[0].signal}, ${topSignals[0].confidence}%)${topSignals[0].reason ? ` — ${topSignals[0].reason}` : ''}` : '',
  ].filter(Boolean).join('\n');
  return generate(`Provide a brief analysis of today's market sentiment and what it means for traders at the open. 2-3 sentences.\n\n${ctx}`, { maxTokens: 200 });
}

async function generateAnalystTake(signals, sectors, sentiment) {
  const top = Array.isArray(signals) ? signals.filter(s => s.signal === 'Strong Buy' || s.signal === 'Buy').slice(0,3) : [];
  const ctx = [
    sentiment ? `Overall sentiment: ${sentiment}` : '',
    top.map(s => `${s.name||s.ticker}: ${s.signal} (${s.confidence}% conf)${s.reason ? ` — ${s.reason}` : ''}`).join('\n'),
    (sectors||[]).slice(0,2).map(s => `${s.sector}: ${s.avgChange}%`).join(', '),
  ].filter(Boolean).join('\n');
  return generate(`Write a brief analyst take for today's market open. 2-3 sentences covering sentiment, key signals, and sector guidance.\n\n${ctx || 'Market data loading.'}`, { maxTokens: 200 });
}

async function generateEarningsAnalysis(company, verdict, metrics, reason) {
  const ctx = [
    `Company: ${company}`,
    `AI Verdict: ${verdict}`,
    metrics ? JSON.stringify(metrics) : '',
    reason || '',
  ].filter(Boolean).join('\n');
  return generate(`Write 2-3 sentences analysing this earnings result. Explain what the numbers mean for the company and investors.\n\n${ctx}`, { maxTokens: 200 });
}

async function generateMacroBackdrop() {
  return generate(`Write 2-3 sentences on the current macro economic backdrop affecting African markets — interest rates, inflation trends, currency movements.`, { maxTokens: 200 });
}

async function generateDailyGlobalConnection(sp500, ndx, nse20) {
  const ctx = [
    sp500 ? `S&P 500: ${sp500.value} (${sp500.change})` : '',
    ndx ? `Nasdaq: ${ndx.value} (${ndx.change})` : '',
    nse20 ? `NSE 20: ${nse20.value}` : '',
  ].filter(Boolean).join('\n');
  return generate(`Write 2-3 sentences on how overnight global market action sets the tone for today's NSE trading session.\n\n${ctx || 'Global markets data loading.'}`, { maxTokens: 200 });
}

// ── Combined generators (faster — single LLM call per email) ──

async function generateAllWeeklySections(data) {
  const ctx = [
    `NSE 20: ${data.nse20?.value || 'N/A'} (${data.nse20?.change || 'N/A'})`,
    `NASI: ${data.nasi?.value || 'N/A'} (${data.nasi?.change || 'N/A'})`,
    `NSE gainers: ${(data.nseGainers||[]).map(s => `${s.name||s.symbol} ${s.change||''}`).join(', ') || 'none'}`,
    `NSE losers: ${(data.nseLosers||[]).map(s => `${s.name||s.symbol} ${s.change||''}`).join(', ') || 'none'}`,
    `Best sector: ${data.topSector ? `${data.topSector.sector} ${data.topSector.avgChange}%` : 'N/A'}`,
    `Worst sector: ${data.worstSector ? `${data.worstSector.sector} ${data.worstSector.avgChange}%` : 'N/A'}`,
    `S&P 500: ${data.sp500?.value || 'N/A'} (${data.sp500?.change || 'N/A'})`,
    `Global gainers: ${(data.globalGainers||[]).map(s => `${s.name||s.symbol} ${s.change||''}`).join(', ') || 'none'}`,
    `Signals: ${data.summary?.signals?.total || 0} total, ${data.summary?.signals?.strongBuys || 0} strong buy, ${data.summary?.signals?.sells || 0} sell`,
    data.topStory ? `Top news: "${data.topStory.headline}"` : '',
  ].filter(Boolean).join('\n');

  const prompt = `Generate the following 7 editorial sections for a weekly market digest email. Use the market data below. Keep each section 2-4 sentences. Use natural Kenyan financial language. Do NOT use markdown. Do NOT use asterisks or bullet points.

Output exactly in this format with the section headers:

[NSE SUMMARY]
(your text here)

[STORY OF THE WEEK]
(your text here)

[MILESTONE]
(your text here)

[GLOBAL THEME]
(your text here)

[MACRO BACKDROP]
(your text here)

[WHAT TO WATCH]
(your text here)

[NSE GLOBAL CONNECTION]
(your text here)

Market data:
${ctx}`;

  const raw = await generate(prompt, { maxTokens: 1000, temperature: 0.7 });
  const parse = (tag) => {
    const re = new RegExp(`\\[${tag}\\][\\s\\n]*([^\\[]+)`, 'i');
    const m = raw.match(re);
    return m ? m[1].trim() : '';
  };
  return {
    nseSummary: parse('NSE SUMMARY'),
    storyOfWeek: parse('STORY OF THE WEEK'),
    milestone: parse('MILESTONE'),
    globalTheme: parse('GLOBAL THEME'),
    macroBackdrop: parse('MACRO BACKDROP'),
    whatToWatch: parse('WHAT TO WATCH'),
    nseGlobalConnection: parse('NSE GLOBAL CONNECTION'),
  };
}

async function generateAllBriefSections(data) {
  const ctx = [
    `Sentiment: ${data.sentiment || 'neutral'}`,
    `Signals: ${data.signals?.total || 0} total, ${data.signals?.strongBuys || 0} strong buy`,
    data.topSignals?.length ? `Top signals: ${data.topSignals.map(s => `${s.name||s.ticker} ${s.signal} ${s.confidence}%`).join(', ')}` : '',
    `S&P 500: ${data.sp500?.value || 'N/A'} (${data.sp500?.change || 'N/A'})`,
    `Nasdaq: ${data.ndx?.value || 'N/A'} (${data.ndx?.change || 'N/A'})`,
    `NSE 20: ${data.nse20?.value || 'N/A'}`,
    `Sectors: ${(data.sectors||[]).slice(0,3).map(s => `${s.sector} ${s.avgChange}%`).join(', ')}`,
  ].filter(Boolean).join('\n');

  const prompt = `Generate the following 3 editorial sections for a daily market brief email. Use the market data below. Keep each section 2-4 sentences. Do NOT use markdown. Do NOT use asterisks or bullet points.

Output exactly in this format with the section headers:

[AI SIGNAL CONTEXT]
(your text here)

[GLOBAL CONNECTION]
(your text here)

[ANALYST TAKE]
(your text here)

Market data:
${ctx}`;

  const raw = await generate(prompt, { maxTokens: 600, temperature: 0.7 });
  const parse = (tag) => {
    const re = new RegExp(`\\[${tag}\\][\\s\\n]*([^\\[]+)`, 'i');
    const m = raw.match(re);
    return m ? m[1].trim() : '';
  };
  return {
    aiSignalContext: parse('AI SIGNAL CONTEXT'),
    globalToNseConnection: parse('GLOBAL CONNECTION'),
    analystTake: parse('ANALYST TAKE'),
  };
}

module.exports = {
  generate, generateNseSummary, generateStoryOfWeek, generateMilestone,
  generateGlobalTheme, generateWhatToWatch, generateNseGlobalConnection,
  generateAiSignalContext, generateAnalystTake, generateEarningsAnalysis,
  generateMacroBackdrop, generateDailyGlobalConnection,
  generateAllWeeklySections, generateAllBriefSections,
};
