const axios = require('axios');

async function test() {
  const url = 'https://www.google.com/finance/quote/SCOM:NSE';
  try {
    const resp = await axios.get(url, {
      headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36', 'Accept-Language': 'en-US,en;q=0.9' },
      timeout: 10000,
    });
    const html = resp.data;
    const marker = "AF_initDataCallback({key: 'ds:2'";
    const start = html.indexOf(marker);
    if (start === -1) { console.log('ds:2 not found'); return; }
    const dataPos = html.indexOf('data:', start);
    if (dataPos === -1) { console.log('data: not found'); return; }
    let i = dataPos + 5;
    while (html[i] !== '[' && i < html.length) i++;
    if (html[i] !== '[') { console.log('no [ after data:'); return; }
    let depth = 0, jsonStart = i, jsonEnd = -1, inString = false;
    for (; i < html.length; i++) {
      const ch = html[i];
      if (inString) { if (ch === '\\') i++; else if (ch === '"') inString = false; continue; }
      if (ch === '"') { inString = true; continue; }
      if (ch === '[') depth++;
      else if (ch === ']') { depth--; if (depth === 0) { jsonEnd = i + 1; break; } }
    }
    if (jsonEnd === -1) { console.log('no closing bracket'); return; }
    const jsonStr = html.substring(jsonStart, jsonEnd);
    const data = JSON.parse(jsonStr);
    const inner = data[0]?.[0]?.[0];
    if (!inner) { console.log('inner is null, keys:', Object.keys(data)); return; }
    console.log('inner length:', inner.length);
    console.log('inner[4] (currency):', inner[4]);
    console.log('inner[5] (price arr):', inner[5]);
    const priceArr = inner[5];
    console.log('  price:', priceArr?.[0]);
    console.log('  change:', priceArr?.[1]);
    console.log('  changePct:', priceArr?.[2]);
    
    // Check ds:8 for previousClose
    const marker8 = "AF_initDataCallback({key: 'ds:8'";
    const start8 = html.indexOf(marker8);
    if (start8 !== -1) {
      const dataPos8 = html.indexOf('data:', start8);
      let i8 = dataPos8 + 5;
      while (html[i8] !== '[' && i8 < html.length) i8++;
      let d8 = 0, s8 = i8, e8 = -1, inS8 = false;
      for (; i8 < html.length; i8++) {
        const ch = html[i8];
        if (inS8) { if (ch === '\\') i8++; else if (ch === '"') inS8 = false; continue; }
        if (ch === '"') { inS8 = true; continue; }
        if (ch === '[') d8++;
        else if (ch === ']') { d8--; if (d8 === 0) { e8 = i8 + 1; break; } }
      }
      if (e8 !== -1) {
        const d8Data = JSON.parse(html.substring(s8, e8));
        const row = d8Data[0]?.[0];
        console.log('ds:8 row:', row);
        if (row && row.length >= 7) {
          console.log('  previousClose:', row[2]);
          console.log('  dayLow:', row[4]);
          console.log('  dayHigh:', row[5]);
        }
      }
    }
  } catch(e) { console.error('ERR:', e.message); }
}
test();
