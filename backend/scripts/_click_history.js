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

  // Find the bottom icon buttons with details
  const icons = await p.evaluate(() => {
    const all = document.querySelectorAll('.icon-button.svelte-1iwf8ix');
    return Array.from(all).map(el => ({
      tag: el.tagName,
      cls: (el.className || ''),
      y: Math.round(el.getBoundingClientRect().top),
      x: Math.round(el.getBoundingClientRect().left),
      w: Math.round(el.getBoundingClientRect().width),
      h: Math.round(el.getBoundingClientRect().height),
      // Get ALL attributes
      attrs: el.getAttributeNames().map(n => n + '=' + el.getAttribute(n)),
      // Get inner svg title if any
      svgTitle: el.querySelector('svg title') ? el.querySelector('svg title').textContent : '',
      innerHtml: el.innerHTML.slice(0, 300),
    }));
  });
  console.log('Icon buttons at bottom:');
  for (const icon of icons) console.log(JSON.stringify(icon, null, 2));

  // Try clicking the history one (y=820)
  const historyIcon = icons.find(i => i.y >= 800 && i.y <= 850);
  if (historyIcon) {
    console.log(`\nClicking history icon at (${historyIcon.x+10}, ${historyIcon.y+10})...`);
    const before = await p.evaluate(() => document.body.innerText);
    await p.mouse.click(historyIcon.x + 10, historyIcon.y + 10);
    await p.waitForTimeout(2000);
    const after = await p.evaluate(() => document.body.innerText);
    if (before !== after) {
      console.log('PAGE CHANGED! New text (last 2000 chars):');
      console.log(after.slice(-2000));
    } else {
      console.log('No change in text');
    }
  }

  await b.close();
})().catch(e => { console.error(e.message); process.exit(1); });
