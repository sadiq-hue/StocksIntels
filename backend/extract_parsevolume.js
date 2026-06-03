const fs = require('fs');
let orig = fs.readFileSync('./index_cleaned.js', 'utf8');

// Find parseVolume
let idx = orig.indexOf('function parseVolume');
if (idx < 0) idx = orig.indexOf('parseVolume =');
if (idx < 0) idx = orig.indexOf('function parseVolume');

console.log('parseVolume at:', idx);
if (idx >= 0) {
  let braceIdx = orig.indexOf('{', idx);
  if (braceIdx > 0) {
    let depth = 0, inStr1 = false, inStr2 = false, inTpl = false;
    for (let i = braceIdx; i < orig.length; i++) {
      let c = orig[i], p = i > braceIdx ? orig[i-1] : '';
      if (c === "'" && !inStr2 && !inTpl && p !== '\\') inStr1 = !inStr1;
      if (c === '"' && !inStr1 && !inTpl && p !== '\\') inStr2 = !inStr2;
      if (c === '`' && !inStr1 && !inStr2 && p !== '\\') inTpl = !inTpl;
      if (!inStr1 && !inStr2 && !inTpl) {
        if (c === '{') depth++;
        if (c === '}') {
          depth--;
          if (depth === 0) {
            let end = i + 1;
            if (orig[end] === ';') end++;
            console.log('parseVolume:', orig.substring(idx, end));
            process.exit(0);
          }
        }
      }
    }
  }
}
console.log('NOT FOUND - parseVolume might be inline or not exist');
