const { chromium } = require('playwright');
(async () => {
  const b = await chromium.launch({ headless: true });
  const p = await b.newPage({ viewport: { width: 1280, height: 900 } });
  await p.goto('https://webtradingdemo.fxpesa.com/terminal', { waitUntil: 'networkidle', timeout: 30000 });
  await p.waitForTimeout(2000);
  await p.locator('input[name=login]').fill('1153446');
  await p.locator('input[name=password]').fill('39055230Sadik#');
  await p.locator('button[type=submit]').click();
  await p.waitForFunction('document.body.innerText.includes("Balance")', { timeout: 15000 }).catch(() => {});
  await p.waitForTimeout(2000);

  // Check ALL elements for tab-related keywords in attributes
  const attrs = await p.evaluate(() => {
    const results = [];
    const keywords = ['tab', 'tab', 'history', 'deal', 'order', 'trade', 'journal', 'account', 'view'];
    const all = document.querySelectorAll('*');
    all.forEach(el => {
      const att = el.getAttributeNames().map(n => `${n}=${el.getAttribute(n)}`).join(' ');
      const cls = typeof el.className === 'string' ? el.className : (el.className && el.className.baseVal ? el.className.baseVal : '');
      const origText = (el.textContent || '').trim();
      const textLC = origText.toLowerCase();
      const combined = (att + ' ' + cls + ' ' + textLC).toLowerCase();
      for (const kw of keywords) {
        if (combined.includes(kw) && origText.length < 30) {
          results.push({
            tag: el.tagName,
            keyword: kw,
            text: origText.slice(0,30),
            cls: String(cls).slice(0,40),
            attrs: att.slice(0,100),
            rect: (() => { const r = el.getBoundingClientRect(); return {y:Math.round(r.top),x:Math.round(r.left)}; })(),
          });
          break;
        }
      }
    });
    return results;
  });

  console.log('Elements matching tab/history/deal/etc keywords:');
  const seen = new Set();
  for (const a of attrs) {
    const key = a.text + a.cls + a.tag;
    if (!seen.has(key)) {
      seen.add(key);
      console.log(`  <${a.tag}> y=${a.rect.y} keyword="${a.keyword}" text="${a.text}" class="${a.cls}"`);
    }
  }

  await b.close();
})().catch(e => { console.error(e.message); process.exit(1); });
