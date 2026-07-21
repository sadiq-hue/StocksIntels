const axios = require('axios');
(async () => {
  const r = await axios.get('https://www.google.com/finance/quote/SCOM:NSE', {
    headers: { 'User-Agent': 'Mozilla/5.0' },
    timeout: 10000
  });
  const h = r.data;
  const regex = /AF_initDataCallback\({key: '(ds:\d+)'/g;
  let m;
  while ((m = regex.exec(h)) !== null) {
    const key = m[1];
    const s = h.indexOf(`AF_initDataCallback({key: '${key}'`);
    if (s === -1) continue;
    const dp = h.indexOf('data:', s);
    let i = dp + 5;
    while (h[i] !== '[' && i < h.length) i++;
    if (h[i] !== '[') continue;
    let d = 0, si = i, ei = -1, ins = false;
    for (; i < h.length; i++) {
      const c = h[i];
      if (ins) { if (c === '\\') i++; else if (c === '"') ins = false; continue; }
      if (c === '"') { ins = true; continue; }
      if (c === '[') d++;
      else if (c === ']') { d--; if (d === 0) { ei = i + 1; break; } }
    }
    if (ei === -1) continue;
    try {
      const arr = JSON.parse(h.substring(si, ei));
      const str = JSON.stringify(arr);
      if (str.length > 10) {
        console.log(`${key} (${str.length} chars): ${str.substring(0, 400)}`);
        console.log('---');
      }
    } catch (e) {
      console.log(`${key}: parse error`);
    }
  }
})();
