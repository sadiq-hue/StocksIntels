const modalBridge = require('./modalBridge');

async function main() {
  if (!process.env.MODAL_URL) {
    console.error('MODAL_URL not set — cannot trigger training. Deploy modal_ml.py first: modal deploy backend.modal_ml');
    process.exit(1);
  }
  console.log('Triggering Modal ML training...');
  const result = await modalBridge.train();
  console.log('Train result:', JSON.stringify(result, null, 2));
  process.exit(0);
}
main().catch(e => { console.error('FAIL:', e.message); process.exit(1); });
