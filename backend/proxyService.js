const axios = require('axios');
const { HttpsProxyAgent } = require('https-proxy-agent');
const { SocksProxyAgent } = require('socks-proxy-agent');

// ─── Configuration ──────────────────────────────────────────────────────────
const PROXY_REFRESH_MS = 15 * 60 * 1000;
const HEALTH_CHECK_URL = 'https://query1.finance.yahoo.com/v8/finance/chart/AAPL?interval=1d&range=1d';
const HEALTH_CHECK_TIMEOUT = 8000;
const MAX_FAILURES_BEFORE_COOLDOWN = 3;
const COOLDOWN_MS = 5 * 60 * 1000;
const MAX_WORKING_PROXIES = 10;

const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36';

// Public CORS relays (low priority fallback)
const CORS_PROXIES = [
  'https://api.allorigins.win/raw?url=',
  'https://api.codetabs.com/v1/proxy?quest=',
  'https://api.allorigins.win/get?url=',
];

// ─── Proxy Pool State ───────────────────────────────────────────────────────
let proxyPool = [];        // { host, port, type, url, failures, cooldownUntil }
let poolLastRefresh = 0;
let poolIndex = 0;

function parseProxyUrl(raw) {
  try {
    const hasProtocol = /^https?:\/\//i.test(raw);
    const url = hasProtocol ? raw : `http://${raw}`;
    const parsed = new URL(url);
    return {
      host: parsed.hostname,
      port: parseInt(parsed.port) || (parsed.protocol === 'https:' ? 443 : 80),
      type: parsed.protocol === 'https:' ? 'https' : 'http',
      auth: parsed.username ? `${parsed.username}:${parsed.password}` : null,
      url: url,
    };
  } catch {
    return null;
  }
}

function loadProxiesFromEnv() {
  const raw = process.env.YAHOO_PROXY_LIST;
  if (!raw) return [];
  return raw.split(',')
    .map(s => s.trim())
    .filter(Boolean)
    .map(parseProxyUrl)
    .filter(Boolean);
}

function createAgent(proxy) {
  if (!proxy) return null;
  const target = proxy.auth
    ? `http://${proxy.auth}@${proxy.host}:${proxy.port}`
    : `http://${proxy.host}:${proxy.port}`;
  if (proxy.type === 'socks' || proxy.type === 'socks5') {
    return new SocksProxyAgent(target);
  }
  return new HttpsProxyAgent(target);
}

// ─── Free Proxy List Scraping ───────────────────────────────────────────────
async function scrapeFreeProxies() {
  const all = [];
  try {
    const resp = await axios.get('https://free-proxy-list.net/', { timeout: 8000 });
    const rowRegex = /<tr><td>(\d+\.\d+\.\d+\.\d+)<\/td><td>(\d+)<\/td>/g;
    let m;
    while ((m = rowRegex.exec(resp.data)) !== null) {
      all.push({ host: m[1], port: parseInt(m[2]), type: 'http' });
    }
  } catch {}
  try {
    const resp = await axios.get(
      'https://proxylist.geonode.com/api/proxy-list?protocols=http&protocols=https&limit=30&speed=fast&country=US&upTime=80',
      { timeout: 8000 }
    );
    const data = typeof resp.data === 'string' ? JSON.parse(resp.data) : resp.data;
    if (data?.data) {
      for (const p of data.data) {
        all.push({ host: p.ip, port: parseInt(p.port), type: p.protocols?.[0] || 'http' });
      }
    }
  } catch {}
  const seen = new Set();
  return all.filter(p => {
    const key = `${p.host}:${p.port}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

async function testProxy(proxy) {
  const agent = createAgent(proxy);
  try {
    await axios.get(HEALTH_CHECK_URL, {
      httpsAgent: agent,
      httpAgent: agent,
      timeout: HEALTH_CHECK_TIMEOUT,
      headers: { 'User-Agent': UA },
      validateStatus: s => s < 500,
    });
    return true;
  } catch {
    return false;
  }
}

async function refreshPool() {
  const configured = loadProxiesFromEnv();

  if (configured.length > 0) {
    // Test configured proxies; keep only working ones
    const results = await Promise.allSettled(
      configured.slice(0, MAX_WORKING_PROXIES * 2).map(p => testProxy(p))
    );
    proxyPool = [];
    configured.forEach((p, i) => {
      if (i < results.length && results[i].status === 'fulfilled' && results[i].value) {
        proxyPool.push({ ...p, failures: 0, cooldownUntil: 0 });
      }
    });
    if (proxyPool.length > MAX_WORKING_PROXIES) {
      proxyPool.length = MAX_WORKING_PROXIES;
    }
    console.log(`[ProxyService] ${configured.length} configured, ${proxyPool.length} working`);
  } else {
    // No configured proxies — scrape free proxy lists
    const candidates = await scrapeFreeProxies();
    if (candidates.length > 0) {
      const testResults = await Promise.allSettled(
        candidates.slice(0, 20).map(p => testProxy(p))
      );
      proxyPool = [];
      candidates.forEach((p, i) => {
        if (i < testResults.length && testResults[i].status === 'fulfilled' && testResults[i].value) {
          proxyPool.push({ ...p, failures: 0, cooldownUntil: 0 });
          if (proxyPool.length >= MAX_WORKING_PROXIES) return;
        }
      });
    } else {
      proxyPool = [];
    }
    console.log(`[ProxyService] No YAHOO_PROXY_LIST set — scraped ${candidates.length} free proxies, ${proxyPool.length} working`);
  }

  poolLastRefresh = Date.now();
}

function getNextProxy() {
  const now = Date.now();
  // Filter out proxies still in cooldown
  const available = proxyPool.filter(p => p.cooldownUntil <= now);
  if (available.length === 0) return null;

  // Round-robin with skip of cooling proxies
  for (let i = 0; i < available.length; i++) {
    const idx = (poolIndex + i) % available.length;
    const proxy = available[idx];
    if (proxy.cooldownUntil <= now) {
      poolIndex = (idx + 1) % available.length;
      return proxy;
    }
  }
  return null;
}

function markProxyFailure(proxy) {
  if (!proxy) return;
  proxy.failures = (proxy.failures || 0) + 1;
  if (proxy.failures >= MAX_FAILURES_BEFORE_COOLDOWN) {
    proxy.cooldownUntil = Date.now() + COOLDOWN_MS;
    proxy.failures = 0;
    console.log(`[ProxyService] Proxy ${proxy.host}:${proxy.port} cooled for ${COOLDOWN_MS / 1000}s`);
  }
}

function markProxySuccess(proxy) {
  if (proxy) proxy.failures = 0;
}

function getWorkingCount() {
  const now = Date.now();
  return proxyPool.filter(p => p.cooldownUntil <= now).length;
}

// ─── External Fetch Helpers ─────────────────────────────────────────────────

async function fetchViaProxy(url, params = {}) {
  const proxy = getNextProxy();
  if (!proxy) return { data: null, source: 'no_proxy' };
  const agent = createAgent(proxy);
  try {
    const resp = await axios.get(url, {
      params,
      httpsAgent: agent,
      httpAgent: agent,
      timeout: 10000,
      headers: { 'User-Agent': UA, 'Accept': 'application/json' },
      validateStatus: s => s < 500,
    });
    markProxySuccess(proxy);
    return { data: resp.data, source: `proxy:${proxy.host}` };
  } catch (err) {
    markProxyFailure(proxy);
    return { data: null, source: `failed:${proxy.host}`, error: err.message };
  }
}

async function fetchViaCorsProxy(url) {
  for (const corsUrl of CORS_PROXIES) {
    try {
      const resp = await axios.get(corsUrl + encodeURIComponent(url), {
        timeout: 5000,
        headers: { 'User-Agent': UA, 'Accept': 'application/json' },
        validateStatus: s => s < 500,
      });
      if (resp.data) return { data: resp.data, source: 'cors' };
    } catch {
      continue;
    }
  }
  return { data: null, source: 'cors_failed' };
}

async function fetchViaDirect(url, params = {}) {
  try {
    const resp = await axios.get(url, {
      params,
      timeout: 5000,
      headers: { 'User-Agent': UA, 'Accept': 'application/json' },
      validateStatus: s => s < 500,
    });
    return { data: resp.data, source: 'direct' };
  } catch {
    return { data: null, source: 'direct_failed' };
  }
}

async function fetchWithProxyFallback(url, params = {}) {
  const result = await Promise.race([
    (async () => {
      const proxyResult = await fetchViaProxy(url, params);
      if (proxyResult.data) return proxyResult;
      const corsResult = await fetchViaCorsProxy(url);
      if (corsResult.data) return corsResult;
      return fetchViaDirect(url, params);
    })(),
    new Promise(r => setTimeout(() => r({ data: null, source: 'global_timeout' }), 20000)),
  ]);
  return result;
}

// ─── Init ───────────────────────────────────────────────────────────────────
refreshPool().catch(() => {});
setInterval(() => refreshPool().catch(() => {}), PROXY_REFRESH_MS);

module.exports = {
  refreshPool,
  getNextProxy,
  getWorkingCount,
  createProxyAgent: createAgent,
  markProxyFailure,
  markProxySuccess,
  fetchViaProxy,
  fetchViaCorsProxy,
  fetchViaDirect,
  fetchWithProxyFallback,
};
