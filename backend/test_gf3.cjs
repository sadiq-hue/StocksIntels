const axios = require('axios');
(async () => {
  const r = await axios.get('https://www.google.com/finance/quote/SCOM:NSE', {
    headers: { 'User-Agent': 'Mozilla/5.0' },
    timeout: 10000
  });
  const h = r.data;
  
  // Find all ds keys
  const regex = /AF_initDataCallback\({key: '(ds:\d+)'/g;
  let m;
  const keys = [];
  while ((m = regex.exec(h)) !== null) {
    keys.push(m[1]);
  }
  console.log('ds keys:', keys);

  // Extract ds:1 which often has price data for NSE
  for (const key of keys) {
    const mk = `AF_initDataCallback({key: '${key}'`;
    const s = h.indexOf(mk);
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
      const str = JSON.stringify(arr).substring(0, 500);
      // Look for price-like numbers
      const hasPrice = /"35\.\d"/.test(str);
      if (hasPrice || key === 'ds:1' || key === 'ds:2' || key === 'ds:3' || key === 'ds:8') {
        console.log(`${key}: ${str}`);
        console.log('---');
      }
    } catch (e) {
      console.log(`${key}: parse error`);
    }
  }
})();
