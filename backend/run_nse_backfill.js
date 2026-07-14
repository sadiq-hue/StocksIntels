const fs = require('fs');
const env = {};
for (const l of fs.readFileSync('.env', 'utf8').split('\n')) { const i = l.indexOf('='); if (i > 0) env[l.slice(0, i).trim()] = l.slice(i + 1).trim(); }
for (const k in env) process.env[k] = env[k];
const { scrapeNseFinancialResults, processFiling } = require('./nseReportsDetector');

(async () => {
  console.log('Enumerating NSE reports (free, direct)...');
  const pdfs = await scrapeNseFinancialResults();
  console.log('PDFs to process:', pdfs.length);

  const CONC = 6;
  let done = 0, matched = 0, parsed = 0, failed = 0, unmatched = 0, skipped = 0;
  for (let i = 0; i < pdfs.length; i += CONC) {
    const batch = pdfs.slice(i, i + CONC);
    await Promise.all(batch.map(async (p) => {
      try {
        const r = await processFiling(p, true); // suppress alerts
        done++;
        if (!r || !r.matched) { unmatched++; }
        else if (r.skipped) { matched++; skipped++; }
        else if (r.parsed) { matched++; parsed++; }
        else { matched++; failed++; }
      } catch (e) {
        done++; failed++;
        console.error('  ERR', p.filename.slice(0, 50), e.message);
      }
      if (done % 10 === 0) console.log(`  progress ${done}/${pdfs.length} | parsed ${parsed} | skipped ${skipped} | failed ${failed} | unmatched ${unmatched}`);
    }));
  }
  console.log(`\n=== BACKFILL COMPLETE ===`);
  console.log(`processed: ${done}/${pdfs.length} | matched(known ticker): ${matched} | parsed OK: ${parsed} | already-completed(skipped): ${skipped} | parse failed: ${failed} | unmatched: ${unmatched}`);
})().catch(e => { console.error('FATAL', e.message); process.exit(1); });
