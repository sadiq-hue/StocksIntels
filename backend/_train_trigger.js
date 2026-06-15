const py = require('./pythonBridge');

async function main() {
  console.log('Waiting for Python ML service...');
  await py.waitForReady(30000);
  console.log('Sending train command...');
  const result = await py.train();
  console.log('Train result:', JSON.stringify(result, null, 2));
  process.exit(0);
}
main().catch(e => { console.error('FAIL:', e.message); process.exit(1); });
