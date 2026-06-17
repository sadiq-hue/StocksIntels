const axios = require('axios');
const { HttpsProxyAgent } = require('https-proxy-agent');
const { SocksProxyAgent } = require('socks-proxy-agent');

const CORS_PROXIES = [
  'https://corsproxy.io/?url=',
  'https://api.allorigins.win/raw?url=',
  'https://api.codetabs.com/v1/proxy?quest=',
];

const PROXY_REFRESH_MS = 10 * 60 * 1000;
const TEST_TIMEOUT = 6000;
const TEST_URL = 'https://query1.finance.yahoo.com/v8/finance/chart/AAPL?interval=1d&range=1d';
const MAX_WORKING = 10;

let workingProxies = [];
let lastRefresh = 0;

// Fetch Yahoo URL through a free CORS proxy relay (no agent needed)
async function fetchViaCorsProxy(url) {
  for (const proxy of CORS_PROXIES) {
    try {
      const resp = await axios.get(proxy + encodeURIComponent(url), {
        timeout: 10000,
        headers: {
          'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
          'Accept': 'application/json',
        },
      });
      if (resp.data) return resp.data;
    } catch {}
  }
  return null;
}

async function fetchFreeProxyList() {
  const proxies = [];
  try {
    const { data } = await axios.get('https://free-proxy-list.net/', { timeout: 8000 });
    const rows = data.match(/<tr><td>(\d+\.\d+\.\d+\.\d+)<\/td><td>(\d+)<\/td><td>[^<]+<\/td><td class='[^']*'>([^<]+)/g) || [];
    for (const row of rows) {
      const m = row.match(/<tr><td>(\d+\.\d+\.\d+\.\d+)<\/td><td>(\d+)<\/td><td[^>]*>([^<]+)/);
      if (m && m[3].toLowerCase() === 'yes') {
        proxies.push({ host: m[1], port: parseInt(m[2]), type: 'http' });
      }
    }
  } catch {}
  return proxies;
}

async function fetchGeonodeProxies() {
  const proxies = [];
  try {
    const { data } = await axios.get(
      'https://proxylist.geonode.com/api/proxy-list?protocols=http&protocols=https&limit=30&speed=fast&country=US&upTime=80',
      { timeout: 8000 }
    );
    if (data?.data) {
      for (const p of data.data) {
        proxies.push({ host: p.ip, port: parseInt(p.port), type: p.protocols?.[0] || 'http' });
      }
    }
  } catch {}
  return proxies;
}

async function testProxy(proxy) {
  const agent = proxy.type === 'socks' || proxy.type === 'socks5'
    ? new SocksProxyAgent(`socks5://${proxy.host}:${proxy.port}`)
    : new HttpsProxyAgent(`http://${proxy.host}:${proxy.port}`);
  try {
    await axios.get(TEST_URL, {
      httpsAgent: agent,
      timeout: TEST_TIMEOUT,
      headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36' },
    });
    return true;
  } catch {
    return false;
  }
}

async function refreshProxies() {
  const [list1, list2] = await Promise.allSettled([
    fetchFreeProxyList(),
    fetchGeonodeProxies(),
  ]);
  const candidates = [
    ...(list1.status === 'fulfilled' ? list1.value : []),
    ...(list2.status === 'fulfilled' ? list2.value : []),
  ];
  if (candidates.length === 0) return;
  const deduped = [];
  const seen = new Set();
  for (const p of candidates) {
    const key = `${p.host}:${p.port}`;
    if (!seen.has(key)) { seen.add(key); deduped.push(p); }
  }
  const testResults = await Promise.allSettled(deduped.slice(0, 20).map(p => testProxy(p)));
  workingProxies = [];
  for (let i = 0; i < testResults.length; i++) {
    if (testResults[i].status === 'fulfilled' && testResults[i].value) {
      workingProxies.push(deduped[i]);
      if (workingProxies.length >= MAX_WORKING) break;
    }
  }
  lastRefresh = Date.now();
  console.log(`[ProxyService] ${candidates.length} candidates, ${workingProxies.length} working`);
}

function getRandomProxy() {
  if (workingProxies.length === 0) return null;
  return workingProxies[Math.floor(Math.random() * workingProxies.length)];
}

function createProxyAgent(proxy) {
  if (!proxy) return null;
  return proxy.type === 'socks' || proxy.type === 'socks5'
    ? new SocksProxyAgent(`socks5://${proxy.host}:${proxy.port}`)
    : new HttpsProxyAgent(`http://${proxy.host}:${proxy.port}`);
}

function getWorkingCount() {
  return workingProxies.length;
}

// Warm up on module load
refreshProxies().catch(() => {});

module.exports = { refreshProxies, getRandomProxy, createProxyAgent, getWorkingCount, fetchViaCorsProxy };
