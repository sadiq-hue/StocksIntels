const https = require('https');

const INDEXING_API = 'https://indexing.googleapis.com/v3/urlNotifications:publish';

let _cachedToken = null;
let _tokenExpiry = 0;

function getRefreshToken() {
  return process.env.GOOGLE_REFRESH_TOKEN || null;
}

function getClientId() {
  return process.env.GOOGLE_OAUTH_CLIENT_ID || '';
}

function getClientSecret() {
  return process.env.GOOGLE_OAUTH_CLIENT_SECRET || '';
}

function isConfigured() {
  return !!(getRefreshToken() && getClientId() && getClientSecret());
}

async function getAccessToken() {
  if (_cachedToken && Date.now() < _tokenExpiry) return _cachedToken;

  const refreshToken = getRefreshToken();
  const clientId = getClientId();
  const clientSecret = getClientSecret();
  if (!refreshToken || !clientId || !clientSecret) return null;

  const body = JSON.stringify({
    client_id: clientId,
    client_secret: clientSecret,
    refresh_token: refreshToken,
    grant_type: 'refresh_token',
  });

  const accessToken = await new Promise((resolve, reject) => {
    const req = https.request('https://oauth2.googleapis.com/token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(body) },
    }, (res) => {
      let data = '';
      res.on('data', (c) => data += c);
      res.on('end', () => {
        try {
          const parsed = JSON.parse(data);
          if (parsed.access_token) {
            _cachedToken = parsed.access_token;
            _tokenExpiry = Date.now() + (parsed.expires_in - 60) * 1000;
            resolve(parsed.access_token);
          } else {
            console.error('[GoogleIndexing] Token error:', parsed);
            reject(new Error(parsed.error || 'Failed to get access token'));
          }
        } catch (e) { reject(e); }
      });
    });
    req.on('error', reject);
    req.write(body);
    req.end();
  });

  return accessToken;
}

async function publishUrl(url, type = 'URL_UPDATED') {
  const accessToken = await getAccessToken();
  if (!accessToken) {
    console.warn('[GoogleIndexing] Not configured. Set GOOGLE_REFRESH_TOKEN, GOOGLE_OAUTH_CLIENT_ID, GOOGLE_OAUTH_CLIENT_SECRET on Railway.');
    return { success: false, error: 'Not configured' };
  }

  const body = JSON.stringify({ url, type });

  return new Promise((resolve, reject) => {
    const req = https.request(INDEXING_API, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${accessToken}`,
        'Content-Length': Buffer.byteLength(body),
      },
    }, (res) => {
      let data = '';
      res.on('data', (c) => data += c);
      res.on('end', () => {
        try {
          const parsed = JSON.parse(data);
          if (res.statusCode >= 200 && res.statusCode < 300) {
            console.log(`[GoogleIndexing] Published: ${url} (${type})`);
            resolve({ success: true, url, type, response: parsed });
          } else {
            console.error(`[GoogleIndexing] Failed: ${url} -`, parsed);
            resolve({ success: false, url, error: parsed });
          }
        } catch (e) { reject(e); }
      });
    });
    req.on('error', reject);
    req.write(body);
    req.end();
  });
}

async function batchPublish(urls, type = 'URL_UPDATED') {
  const results = [];
  for (const url of urls) {
    const result = await publishUrl(url, type);
    results.push(result);
    await new Promise(r => setTimeout(r, 200));
  }
  return results;
}

module.exports = { publishUrl, batchPublish, getAccessToken, getCredentials: isConfigured };
