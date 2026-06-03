const fs = require('fs');
let orig = fs.readFileSync('./index_cleaned.js', 'utf8');

// Find getMarketSnapshot function
const patterns = [
  'async function getMarketSnapshot',
  'function getMarketSnapshot',
  'getMarketSnapshot = async',
];

let idx = -1;
for (const p of patterns) {
  idx = orig.indexOf(p);
  if (idx >= 0) break;
}
console.log('getMarketSnapshot at:', idx);

if (idx >= 0) {
  let braceIdx = orig.indexOf('{', idx);
  let depth = 0, inStr1 = false, inStr2 = false, inTpl = false;
  for (let i = braceIdx; i < orig.length; i++) {
    let c = orig[i];
    let p = i > braceIdx ? orig[i-1] : '';
    if (c === "'" && !inStr2 && !inTpl && p !== '\\') inStr1 = !inStr1;
    if (c === '"' && !inStr1 && !inTpl && p !== '\\') inStr2 = !inStr2;
    if (c === '`' && !inStr1 && !inStr2 && p !== '\\') inTpl = !inTpl;
    if (!inStr1 && !inStr2 && !inTpl) {
      if (c === '{') depth++;
      if (c === '}') {
        depth--;
        if (depth === 0) {
          let end = i + 1;
          let decl = orig.substring(idx, end);
          console.log('Declaration:\n' + decl);
          // Check if there's a semicolon
          if (orig[end] === ';') end++;
          decl = orig.substring(idx, end);
          break;
        }
      }
    }
  }
}

// Also extract the routes we need
function extractRoute(routePattern) {
  let ridx = orig.indexOf(routePattern);
  if (ridx < 0) { console.log('\nNOT FOUND: ' + routePattern); return null; }
  
  let braceIdx = orig.indexOf('{', ridx);
  let depth = 0, inStr1 = false, inStr2 = false, inTpl = false;
  for (let i = braceIdx; i < orig.length; i++) {
    let c = orig[i];
    let p = i > braceIdx ? orig[i-1] : '';
    if (c === "'" && !inStr2 && !inTpl && p !== '\\') inStr1 = !inStr1;
    if (c === '"' && !inStr1 && !inTpl && p !== '\\') inStr2 = !inStr2;
    if (c === '`' && !inStr1 && !inStr2 && p !== '\\') inTpl = !inTpl;
    if (!inStr1 && !inStr2 && !inTpl) {
      if (c === '{') depth++;
      if (c === '}') {
        depth--;
        if (depth === 0) {
          let end = orig.indexOf(';', i);
          if (end < 0) end = i + 1;
          let route = orig.substring(ridx, end + 1);
          console.log('\nRoute found:\n' + route);
          return route;
        }
      }
    }
  }
  return null;
}

console.log('\n\n=== Extracting routes ===');
extractRoute("app.get('/api/market/movers'");
extractRoute("app.get('/api/market/indices'");
extractRoute("app.get('/api/ai/market-summary'");
extractRoute("app.get('/api/users/:id'");
