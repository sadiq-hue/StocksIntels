const jwt = require('jsonwebtoken');
const https = require('https');

const INDEXING_API = 'https://indexing.googleapis.com/v3/urlNotifications:publish';
const TOKEN_URI = 'https://oauth2.googleapis.com/serviceaccount';

let _cachedToken = null;
let _tokenExpiry = 0;

async function getAccessToken() {
  if (_cachedToken && Date.now() < _tokenExpiry) return _cachedToken;

  const creds = getCredentials();
  if (!creds) return null;

  const now = Math.floor(Date.now() / 1000);
  const payload = {
    iss: creds.client_email,
    scope: 'https://www.googleapis.com/auth/indexing',
    aud: TOKEN_URI,
    exp: now + 3600,
    iat: now,
  };

  const token = jwt.sign(payload, creds.private_key, { algorithm: 'RS256' });

  const body = JSON.stringify({ grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer', assertion: token });

  const accessToken = await new Promise((resolve, reject) => {
    const req = https.request(TOKEN_URI, { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded', 'Content-Length': Buffer.byteLength(body) } }, (res) => {
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

function getCredentials() {
  if (process.env.GOOGLE_INDEXING_CREDENTIALS) {
    try {
      return JSON.parse(process.env.GOOGLE_INDEXING_CREDENTIALS);
    } catch (e) {
      console.error('[GoogleIndexing] Failed to parse GOOGLE_INDEXING_CREDENTIALS:', e.message);
    }
  }
  try {
    const fs = require('fs');
    const path = require('path');
    const credPath = path.join(__dirname, 'google-service-account.json');
    if (fs.existsSync(credPath)) {
      return JSON.parse(fs.readFileSync(credPath, 'utf8'));
    }
  } catch (e) {}
  return null;
}

async function publishUrl(url, type = 'URL_UPDATED') {
  const accessToken = await getAccessToken();
  if (!accessToken) {
    console.warn('[GoogleIndexing] No credentials configured. Set GOOGLE_INDEXING_CREDENTIALS env var or add google-service-account.json');
    return { success: false, error: 'No credentials configured' };
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

module.exports = { publishUrl, batchPublish, getAccessToken, getCredentials };
