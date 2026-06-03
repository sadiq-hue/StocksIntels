async function validateCredentials() {
  return { valid: true };
}

async function sync(apiKey, apiSecret, userId, pool, config) {
  return { positions: [], account: null };
}

module.exports = { validateCredentials, sync };
