// Isolated headless-browser renderer.
//
// Provider fund pages that are JS-rendered can't be scraped from server HTML.
// Launching Chromium inside the main backend process OOM-killed the app, so this
// runs as its OWN container: a tiny HTTP service that renders a URL and returns
// the visible text. The backend calls it over the compose network.
//
//   POST /render { url, waitUntil?, waitFor?, timeout?, selector? }
//     -> { ok, status, title, text }
//   GET /health -> { ok }

const express = require('express');
const { chromium } = require('playwright');

const PORT = Number(process.env.PORT) || 3000;
const UA = process.env.RENDERER_UA || 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36';

const app = express();
app.use(express.json({ limit: '2mb' }));

let browserPromise = null;
async function getBrowser() {
  if (!browserPromise) {
    browserPromise = chromium.launch({
      headless: true,
      args: [
        '--no-sandbox',
        '--disable-dev-shm-usage',
        '--disable-gpu',
        '--disable-extensions',
        '--disable-background-networking',
        '--disable-default-apps',
        '--disable-sync',
        '--no-first-run',
        '--mute-audio',
        '--js-flags=--max-old-space-size=384',
      ],
    }).catch(e => { browserPromise = null; throw e; });
  }
  return browserPromise;
}

// One render at a time — keeps a single Chromium tab in memory on a small box.
let chain = Promise.resolve();
function serialize(fn) {
  const p = chain.then(fn, fn);
  chain = p.then(() => {}, () => {});
  return p;
}

app.get('/health', (_req, res) => res.json({ ok: true }));

app.post('/render', async (req, res) => {
  const { url, waitUntil = 'networkidle', waitFor = 0, timeout = 30000, selector, raw = false, html = false, capture = false } = req.body || {};
  if (!/^https?:\/\//i.test(String(url || ''))) return res.status(400).json({ ok: false, error: 'valid http(s) url required' });
  const started = Date.now();
  try {
    const result = await serialize(async () => {
      const browser = await getBrowser();
      const context = await browser.newContext({ userAgent: UA, viewport: { width: 1366, height: 900 } });
      try {
        const page = await context.newPage();
        // Optionally capture XHR/fetch network calls (to discover data APIs).
        const network = [];
        if (capture) {
          page.on('response', async (resp) => {
            try {
              const rt = resp.request().resourceType();
              const ct = resp.headers()['content-type'] || '';
              if (rt !== 'xhr' && rt !== 'fetch' && !/json/i.test(ct)) return;
              const entry = { url: resp.url(), status: resp.status(), ct, type: rt };
              if (/json/i.test(ct) && network.length < 80) {
                try { entry.body = String(await resp.text()).slice(0, 6000); } catch { /* ignore */ }
              }
              network.push(entry);
            } catch { /* ignore */ }
          });
        }
        // Skip heavy resources — we only need text.
        await page.route('**/*', route => {
          const t = route.request().resourceType();
          if (t === 'image' || t === 'font' || t === 'media') return route.abort();
          return route.continue();
        });
        let status = 0;
        try {
          const resp = await page.goto(url, { waitUntil, timeout });
          status = resp ? resp.status() : 0;
        } catch (e) {
          // Navigation may "fail" (slow/never networkidle) — still read the DOM.
        }
        if (selector) { try { await page.waitForSelector(selector, { timeout: 8000 }); } catch { /* ignore */ } }
        if (waitFor) await page.waitForTimeout(Math.min(Number(waitFor) || 0, 15000));
        else await page.waitForTimeout(1500);
        const text = await page.evaluate(() => (document.body ? document.body.innerText : '')).catch(() => '');
        const title = await page.title().catch(() => '');
        const out = { status, title, text: String(text || '').replace(/[ \t]+\n/g, '\n').trim() };
        if (raw) {
          const rt = await page.evaluate(() => (document.body ? document.body.textContent : '')).catch(() => '');
          out.rawText = String(rt || '').replace(/[ \t]+/g, ' ').replace(/\n{2,}/g, '\n').trim();
        }
        if (html) {
          const h = await page.evaluate(() => document.documentElement.outerHTML).catch(() => '');
          out.html = String(h || '').slice(0, 400000);
        }
        if (capture) out.network = network;
        return out;
      } finally {
        await context.close().catch(() => {});
      }
    });
    res.json({ ok: true, ms: Date.now() - started, ...result });
  } catch (e) {
    res.status(500).json({ ok: false, error: e.message, ms: Date.now() - started });
  }
});

app.listen(PORT, () => console.log(`[renderer] listening on ${PORT}`));
