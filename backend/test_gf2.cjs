const axios = require('axios');
(async () => {
  const r = await axios.get('https://www.google.com/finance/quote/SCOM:NSE', {
    headers: { 'User-Agent': 'Mozilla/5.0' },
    timeout: 10000
  });
  const h = r.data;
  const mk = "AF_initDataCallback({key: 'ds:2'";
  const s = h.indexOf(mk);
  if (s === -1) { console.log('no ds:2'); return; }
  const dp = h.indexOf('data:', s);
  let i = dp + 5;
  while (h[i] !== '[' && i < h.length) i++;
  let d = 0, si = i, ei = -1, ins = false;
  for (; i < h.length; i++) {
    const c = h[i];
    if (ins) { if (c === '\\') i++; else if (c === '"') ins = false; continue; }
    if (c === '"') { ins = true; continue; }
    if (c === '[') d++;
    else if (c === ']') { d--; if (d === 0) { ei = i + 1; break; } }
  }
  const arr = JSON.parse(h.substring(si, ei));
  console.log('arr length:', arr.length);
  console.log('arr[0] type:', typeof arr[0], Array.isArray(arr[0]) ? 'len=' + arr[0].length : '');
  if (Array.isArray(arr[0])) {
    for (let j = 0; j < Math.min(arr[0].length, 3); j++) {
      const item = arr[0][j];
      if (Array.isArray(item)) {
        console.log(`arr[0][${j}] len=${item.length}, sample:`, JSON.stringify(item).substring(0, 300));
      } else {
        console.log(`arr[0][${j}]:`, item);
      }
    }
  }
})();
