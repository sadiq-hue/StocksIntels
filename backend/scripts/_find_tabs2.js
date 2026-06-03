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

  // Dump all elements with y < 100 (top of page)
  const top = await p.evaluate(() => {
    const all = document.querySelectorAll('*');
    const res = [];
    all.forEach(el => {
      const r = el.getBoundingClientRect();
      if (r.top < 100 && (el.textContent||'').trim().length > 0 && (el.textContent||'').trim().length < 50 && el.children.length === 0) {
        res.push({ tag: el.tagName, text: (el.textContent||'').trim().slice(0,40), cls: (el.className||'').slice(0,60), y: Math.round(r.top) });
      }
    });
    return res;
  });
  console.log('=== Top elements ===');
  for (const e of top) console.log(`  <${e.tag}> y=${e.y} text="${e.text}" class="${e.cls}"`);

  // Try keyboard shortcut for History (F10, Ctrl+H, etc.)
  console.log('\n=== Trying Alt+T (Trade History shortcut in some terminals) ===');
  const textBefore = await p.evaluate(() => document.body.innerText);
  await p.keyboard.press('Alt+t');
  await p.waitForTimeout(2000);
  const textAfter = await p.evaluate(() => document.body.innerText);
  if (textBefore !== textAfter) {
    console.log('Alt+T CHANGED the view!');
    console.log('New text around balance:');
    const lines = textAfter.split('\n').filter(l => l.includes('Balance') || l.includes('Equity') || l.includes('History') || l.includes('Deal') || l.includes('Profit'));
    for (const l of lines) console.log('  ' + l.trim());
  } else console.log('No change');

  // Try Ctrl+F12 or F12 (common MT5 history shortcut)
  console.log('\n=== Trying F12 ===');
  await p.keyboard.press('F12');
  await p.waitForTimeout(2000);
  const textAfter2 = await p.evaluate(() => document.body.innerText);
  if (textBefore !== textAfter2) {
    console.log('F12 CHANGED the view!');
    const lines = textAfter2.split('\n').filter(l => l.includes('Balance') || l.includes('Equity') || l.includes('History') || l.includes('Deal') || l.includes('Profit') || l.includes('Swap') || l.includes('Commission'));
    for (const l of lines) console.log('  ' + l.trim());
  } else console.log('No change');

  await b.close();
})().catch(e => { console.error(e.message); process.exit(1); });
