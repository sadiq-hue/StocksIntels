// Client for the isolated headless-browser renderer service (see /renderer).
// Used only for provider pages that are JS-rendered and can't be read from
// server HTML. Returns the rendered visible text.

const axios = require('axios');

const RENDERER_URL = process.env.RENDERER_URL || 'http://renderer:3000';

async function render(url, opts = {}) {
  const timeout = (Number(opts.timeout) || 30000) + 20000;
  const { data } = await axios.post(`${RENDERER_URL}/render`, { url, ...opts }, { timeout });
  if (!data || !data.ok) throw new Error((data && data.error) || 'renderer failed');
  return data; // { ok, status, title, text, ms }
}

async function healthy() {
  try {
    const { data } = await axios.get(`${RENDERER_URL}/health`, { timeout: 5000 });
    return !!(data && data.ok);
  } catch {
    return false;
  }
}

module.exports = { render, healthy, RENDERER_URL };
