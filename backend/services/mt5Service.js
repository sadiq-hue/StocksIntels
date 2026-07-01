const { chromium } = require('playwright');

const WEBTRADER_URLS = {
  'scopemarkets-live': 'https://webterminal.scopemarkets.com/terminal',
  'scfmlimited-live2': 'https://webterminal.scopemarkets.co.ke/terminal',
};

const PEPPERSTONE_URL = 'https://mt5-1.pepperstone.com/terminal';
const PEPPERSTONE_MT4_URL = 'https://webtrader.pepperstone.com/';
const HFM_URL = 'https://live.webterminal-hfm.com:1951/terminal';
const HFM_MT4_URL = 'https://live.webterminal-hfm.com/';
const FXPESA_DEMO_URL = 'https://webtradingdemo.fxpesa.com/terminal';
const FXPESA_DEMO_MT4_URL = 'https://webtradingdemo.fxpesa.com/';
const FXPESA_LIVE_URL = 'https://webtrading.fxpesa.com/terminal';
const FXPESA_LIVE_MT4_URL = 'https://webtrading.fxpesa.com/';
const INGOT_URL = 'https://mt5-1.pepperstone.com/terminal';
const XM_URL = 'https://mt5-cy.xm.com/terminal';
const ROBOFOREX_PRO_URL = 'https://mt5-pro-terminal.roboforex.com/terminal';
const ROBOFOREX_ECN_URL = 'https://mt5-ecn-terminal.roboforex.com/terminal';

const ICMARKETS_DOMAIN_MAP = [
  ['icmarketssc', 'icmarkets.com'],
  ['icmarketseu', 'icmarkets.eu'],
  ['icmarketsinternational', 'icmarkets.bs'],
  ['icmarketske', 'icmarkets.co.ke'],
  ['capitalpointtrading', 'ictrading.com'],
  ['icmarketsky', 'icmarkets.ky'],
  ['icmarkets', 'icmarkets.com.au'],
];

function getICMarketsUrl(server) {
  const lower = server.toLowerCase();
  let entityPrefix = null, entityDomain = null;
  for (const [prefix, domain] of ICMARKETS_DOMAIN_MAP) {
    if (lower.startsWith(prefix)) { entityPrefix = prefix; entityDomain = domain; break; }
  }
  if (!entityDomain) return null;
  const serverType = server.substring(entityPrefix.length).replace(/^-/, '');
  if (serverType.toLowerCase().startsWith('demo')) return `https://mt5demo.${entityDomain}/terminal`;
  const numMatch = serverType.match(/MT5-?(\d+)?/i);
  const num = numMatch ? numMatch[1] || '' : '';
  const webPrefix = num ? `mt5${num.padStart(2, '0')}web` : 'mt5web';
  return `https://${webPrefix}.${entityDomain}/terminal`;
}

function getWebTraderUrl(server, platformType) {
  const key = (server || '').toLowerCase();
  const isMt4 = platformType === 'mt4';
  if (WEBTRADER_URLS[key]) return WEBTRADER_URLS[key];
  if (key.includes('pepperstone')) return isMt4 ? PEPPERSTONE_MT4_URL : PEPPERSTONE_URL;
  if (key.includes('hfmarket') || key.includes('hf market')) return isMt4 ? HFM_MT4_URL : HFM_URL;
  if (key.includes('egmsecurities') || key.includes('fxpesa')) {
    if (isMt4) return key.includes('demo') ? FXPESA_DEMO_MT4_URL : FXPESA_LIVE_MT4_URL;
    return key.includes('demo') ? FXPESA_DEMO_URL : FXPESA_LIVE_URL;
  }
  if (key.includes('scopemarkets')) return 'https://webterminal.scopemarkets.com/terminal';
  if (key.includes('scfm')) return 'https://webterminal.scopemarkets.co.ke/terminal';
  if (key.includes('ingot')) return INGOT_URL;
  // IC Markets entity-specific WebTrader routing
  const icMarketsUrl = getICMarketsUrl(server);
  if (icMarketsUrl) return icMarketsUrl;
  // XM WebTrader - single terminal handles all server variants (XM.COM, XMGlobal, XMTrading)
  if (key.includes('xmglobal') || key.includes('xmtrading') || key.includes('xm.com') || key.includes('xmcom')) return XM_URL;
  // FXTM - no discoverable WebTrader URL; use generic terminal with server override
  if (key.includes('forextime') || key.includes('fxtm')) return 'https://web.metatrader.app/terminal';
  // Exness - uses generic MetaQuotes terminal, server override handles it
  if (key.includes('exness')) return 'https://web.metatrader.app/terminal';
  // RoboForex - server-aware routing (Pro terminal vs ECN terminal)
  if (key.includes('roboforex')) return key.includes('ecn') ? ROBOFOREX_ECN_URL : ROBOFOREX_PRO_URL;
  // JustMarkets - all WebTraders behind CloudFlare; use Pepperstone WebTrader as fallback (same approach as INGOT)
  if (key.includes('justmarkets')) return INGOT_URL;
  return isMt4 ? PEPPERSTONE_MT4_URL : PEPPERSTONE_URL;
}

async function scrapeWebTrader(login, password, server, accountType, platformType) {
  const url = getWebTraderUrl(server, platformType);
  const browser = await chromium.launch({
    headless: true,
    args: [
      '--no-sandbox',
      '--disable-setuid-sandbox',
      '--disable-blink-features=AutomationControlled',
    ],
  });
  const context = await browser.newContext({
    viewport: { width: 1280, height: 800 },
    locale: 'en-US',
    userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0.0.0 Safari/537.36',
  });
  await context.addInitScript((serverName) => {
    Object.defineProperty(navigator, 'webdriver', { get: () => undefined });
    Object.defineProperty(navigator, 'plugins', { get: () => [1, 2, 3, 4, 5] });
    if (serverName) {
      const origDefProp = Object.defineProperty;
      Object.defineProperty(window, '__terminal_params', {
        configurable: true,
        set(val) {
          if (val) {
            val.trade_server_demo = serverName;
            val.trade_server_real = serverName;
            if (val.servers) {
              val.servers = val.servers.map(function(s) {
                return { server: serverName, type: s.type, groups: s.groups || [] };
              });
            }
          }
          origDefProp(window, '__terminal_params', {
            value: val, writable: true, configurable: true,
          });
        },
      });
    }
  }, server);
  const page = await context.newPage();

  try {
    await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 30000 });
    try {
      await page.waitForSelector('input[name=login]', { timeout: 25000 });
    } catch {
      const bodyText = await page.innerText('body').catch(() => '');
      if (bodyText.includes('unsupported')) {
        return { error: 'Your browser is not supported by this WebTrader.' };
      }
      throw new Error('Login form did not appear');
    }
    await page.waitForTimeout(1000);

    await page.locator('input[name=login]').fill(login);
    await page.locator('input[name=password]').fill(password);

    // Try to set the server - some terminals have a dropdown, others a text input
    try {
      const serverSelect = page.locator('select[name=server], select.server, [class*="server"] select');
      if (await serverSelect.isVisible({ timeout: 500 })) {
        await serverSelect.selectOption(server);
      }
    } catch {
      try {
        const serverInput = page.locator('input[name=server]');
        if (await serverInput.isVisible({ timeout: 500 })) {
          await serverInput.fill(server);
        }
      } catch { /* server field not present, __terminal_params override handles it */ }
    }

    await page.locator('button[type=submit]').click();

    try {
      await page.waitForFunction(
        'document.body.innerText.includes("Balance")',
        { timeout: 15000 }
      );
    } catch {
      const bodyText = await page.innerText('body');
      if (bodyText.includes('Login failed') || bodyText.includes('Invalid account') || bodyText.includes('Invalid account or password')) {
        return { error: 'Login failed. Check your account ID, password, and server.' };
      }
      return { error: 'Connection timed out. Check your server name.' };
    }

    await page.waitForTimeout(2000);

    const data = await page.evaluate(() => {
      const fullText = document.body.innerText;

      const positions = [];
      const tableCandidates = [];
      document.querySelectorAll('[class~="tbody"], [class~="table"]').forEach(el => {
        const rect = el.getBoundingClientRect();
        if (rect.width === 0 || rect.height === 0) return;
        const headers = Array.from(el.querySelectorAll('[class~="th"], [class~="content"]')).map(h => h.textContent.trim()).filter(Boolean);
        if (headers.some(h => /symbol/i.test(h)) && headers.some(h => /volume|vol/i.test(h)) && !headers.some(h => /bid/i.test(h))) {
          tableCandidates.push(el);
        }
      });
      const tableEl = tableCandidates[0];
      function extractHeaders(el) {
        const th = Array.from(el.querySelectorAll('[class~="th"]')).map(h => h.textContent.trim()).filter(Boolean);
        return th.length > 0 ? th
          : Array.from(el.querySelectorAll('[class~="content"]')).map(h => h.textContent.trim()).filter(Boolean);
      }
      function makeUnique(hdrs) {
        const seen = {};
        return hdrs.map(h => {
          const key = h.toLowerCase().replace(/[\s\/]+/g, '_');
          seen[key] = (seen[key] || 0) + 1;
          return seen[key] > 1 ? `${key}_${seen[key]}` : key;
        });
      }
      const actualHeaders = tableEl ? extractHeaders(tableEl) : [];
      const uniqueHeaders = makeUnique(actualHeaders);
      if (tableEl) {
        const rows = tableEl.querySelectorAll('[class~="tr"], [class~="row"]');
        for (const row of rows) {
          const cells = row.querySelectorAll('[class~="td"]');
          const dataCells = cells.length > 0 ? cells
            : row.querySelectorAll('[class~="content"]');
          if (dataCells.length >= 4) {
            const cellTexts = Array.from(dataCells).map(c => c.textContent.trim());
            if (actualHeaders.length > 0 && cellTexts[0] === actualHeaders[0]) continue;
            const pos = {};
            uniqueHeaders.forEach((h, i) => {
              if (i < cellTexts.length) pos[h] = cellTexts[i];
            });
            if (pos.symbol && pos.volume) positions.push(pos);
          }
        }
      }

      let balance = null, equity = null, margin = null, freeMargin = null, level = null;
      const balMatch = fullText.match(/Balance:\s*([\d,.\s]+)/);
      const eqMatch = fullText.match(/Equity:\s*([\d,.\s]+)/);
      const margMatch = fullText.match(/Margin:\s*([\d,.\s]+)/);
      const freeMatch = fullText.match(/Free margin:\s*([\d,.\s]+)/);
      const lvlMatch = fullText.match(/Level:\s*([\d,.\s]+)%/);
      if (balMatch) balance = parseFloat(balMatch[1].replace(/[,\s]/g, ''));
      if (eqMatch) equity = parseFloat(eqMatch[1].replace(/[,\s]/g, ''));
      if (margMatch) margin = parseFloat(margMatch[1].replace(/[,\s]/g, ''));
      if (freeMatch) freeMargin = parseFloat(freeMatch[1].replace(/[,\s]/g, ''));
      if (lvlMatch) level = parseFloat(lvlMatch[1].replace(/[,\s]/g, ''));

      return { account: { balance, equity, margin, freeMargin, level }, positions };
    });

    // Extract trade history from the History tab
    if (!data.error) {
      try {
        const historyBtn = page.locator('[title="History"]');
        if (await historyBtn.isVisible({ timeout: 3000 })) {
          await historyBtn.click();
          await page.waitForTimeout(1500);

          // Try clicking a "Get" or "Load" button if present
          try {
            const getBtn = page.locator('button:has-text("Get"), button:has-text("Load"), input[value="Get"], input[value="Load"]');
            if (await getBtn.isVisible({ timeout: 2000 })) {
              await getBtn.click();
              await page.waitForTimeout(2000);
            }
          } catch {}

          try {
            await page.waitForFunction(
              'document.body.innerText.includes("Ticket")',
              { timeout: 10000 }
            );
          } catch {
            // History tab might be empty, that's ok
          }

          const tradeHistory = await page.evaluate(() => {
            const trades = [];
            // Strategy 1: Try DOM parsing with visibility check
            let tableEl = null;
            document.querySelectorAll('[class~="tbody"], [class~="table"]').forEach(el => {
              const rect = el.getBoundingClientRect();
              if (rect.width === 0 || rect.height === 0) return;
              const text = el.textContent || '';
              const headers = Array.from(el.querySelectorAll('[class~="th"], [class~="content"]')).map(h => h.textContent.trim());
              if (headers.some(h => /ticket/i.test(h)) && headers.some(h => /time|date/i.test(h))) {
                tableEl = el;
              }
            });
            if (tableEl) {
              const headerCells = tableEl.querySelectorAll('[class~="th"]');
              const headers = Array.from(headerCells).map(h => h.textContent.trim());
              const actualHeaders = headers.length > 0 ? headers
                : Array.from(tableEl.querySelectorAll('[class~="content"]')).map(h => h.textContent.trim());
              const seen = {};
              const uniqueHeaders = actualHeaders.map(h => {
                const key = h.toLowerCase().replace(/[\s\/]+/g, '_');
                seen[key] = (seen[key] || 0) + 1;
                return seen[key] > 1 ? `${key}_${seen[key]}` : key;
              });
              const rows = tableEl.querySelectorAll('[class~="tr"], [class~="row"]');
              for (const row of rows) {
                const cells = row.querySelectorAll('[class~="td"]');
                const dataCells = cells.length > 0 ? cells
                  : row.querySelectorAll('[class~="content"]');
                if (dataCells.length >= 2) {
                  const cellTexts = Array.from(dataCells).map(c => c.textContent.trim());
                  if (actualHeaders.length > 0 && cellTexts[0] === actualHeaders[0]) continue;
                  if (cellTexts[0] && !/^\d{2}\.\d{2}(\.\d{4})?\s/.test(cellTexts[0]) && !/^\d{4}\.\d{2}\.\d{2}/.test(cellTexts[0])) continue;
                  const entry = {};
                  uniqueHeaders.forEach((h, i) => {
                    if (i < cellTexts.length) entry[h] = cellTexts[i];
                  });
                  trades.push(entry);
                }
              }
            }
            // Strategy 2: Text-based fallback
            if (trades.length === 0) {
              const fullText = document.body.innerText;
              const lines = fullText.split('\n').map(l => l.trim()).filter(Boolean);
              let startIdx = -1;
              for (let i = 0; i < lines.length; i++) {
                if (lines[i] === 'Ticket') { startIdx = i + 1; break; }
              }
              if (startIdx > 0) {
                const parseBatch = (batch) => {
                  const time = batch[0] || '';
                  const ticket = batch.find(v => /^\d{6,}$/.test(v)) || '';
                  const type = batch.find(v => /^(buy|sell|balance|deposit|withdrawal)/i.test(v)) || '';
                  const volume = batch.find(v => /^\d[\d\s]*\.\d+$/.test(v) && parseFloat(v.replace(/\s/g,'')) > 0 && parseFloat(v.replace(/\s/g,'')) < 100000) || '';
                  const symbol = batch.find(v => /^[A-Z]{2,}\.?(p|m)?$/i.test(v) && !/^(TIME|TICKET|TYPE|VOLUME|SYMBOL|PRICE|BUY|SELL|BALANCE|DEPOSIT|WITHDRAWAL|COMMISSION|FEE|SWAP|PROFIT|COMMENT)$/i.test(v)) || '';
                  const prices = batch.filter(v => /^\d+\.\d{4,}$/.test(v));
                  const price = prices[0] || '';
                  const profit = batch.find(v => /^[+-]?\d+\.\d{2}$/.test(v)) || '';
                  return { time, ticket, type, volume, symbol, price, profit };
                };
                let batch = [];
                for (let i = startIdx; i < lines.length; i++) {
                  const t = lines[i];
                  if (/^(Profit:|Credit:|Deposit:|Withdrawal:|Balance:)/i.test(t)) break;
                  if (/^\d{4}\.\d{2}\.\d{2}/.test(t)) {
                    if (batch.length > 0) { trades.push(parseBatch(batch)); }
                    batch = [t];
                  } else {
                    batch.push(t);
                  }
                }
                if (batch.length > 0) trades.push(parseBatch(batch));
              }
            }
            return trades;
          });

          data.tradeHistory = tradeHistory;

          // Click back to Trade tab
          const tradeBtn = page.locator('[title="Trade"]');
          if (await tradeBtn.isVisible({ timeout: 3000 })) {
            await tradeBtn.click();
            await page.waitForTimeout(500);
          }
        }
      } catch (e) {
        data.tradeHistory = [];
      }
    }

    return data;
  } catch (err) {
    return { error: `WebTrader error: ${err.message}` };
  } finally {
    await browser.close();
  }
}

async function validateCredentials(apiKey, apiSecret, config = {}) {
  const { server, accountType, platformType } = config;
  if (!server) return { valid: false, error: 'Server is required for MT5 accounts' };
  try {
    const result = await scrapeWebTrader(apiKey, apiSecret, server, accountType, platformType);
    if (result.error) return { valid: false, error: result.error };
    return { valid: true, account: result.account };
  } catch (err) {
    return { valid: false, error: err.message };
  }
}

async function sync(apiKey, apiSecret, userId, pool, config = {}) {
  const { server, accountType, platformType } = config;
  if (!server) throw new Error('Server is required for MT5 accounts');

  const result = await scrapeWebTrader(apiKey, apiSecret, server, accountType, platformType);
  if (result.error) throw new Error(result.error);

  return { positions: result.positions, account: result.account, tradeHistory: result.tradeHistory || [] };
}

module.exports = { validateCredentials, sync };
