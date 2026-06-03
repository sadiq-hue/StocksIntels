const fs = require('fs');
let orig = fs.readFileSync('./index_cleaned.js', 'utf8');

// Try multiple patterns
const patterns = [
  "app.get('/api/stocks'",
  'app.get("/api/stocks"',
  "app.get('/api/stocks '",
];

let idx = -1;
for (const p of patterns) {
  idx = orig.indexOf(p);
  if (idx >= 0) break;
}

console.log('Found at index:', idx);

if (idx < 0) {
  // Search more broadly
  const m = orig.match(/app\.(?:get|post)\(['"].*\/api\/stocks.*?['"]/);
  console.log('Regex match:', m ? m[0] : 'none');
  
  // Just find any endpoint with /api/stocks
  idx = orig.indexOf('/api/stocks');
  console.log('Free text at:', idx);
  if (idx > 0) {
    // Go back to find app.get/app.post
    let start = orig.lastIndexOf('app.', idx);
    console.log('Start at:', start);
    if (start >= 0) {
      console.log('Context:', orig.substring(start, start + 80));
    }
  }
  process.exit(0);
}

// Extract the function body
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
        // Also include closing paren and semicolon
        let end = orig.indexOf(';', i);
        if (end < 0) end = i + 1;
        console.log('Route:\n' + orig.substring(idx, end + 1));
        break;
      }
    }
  }
}
