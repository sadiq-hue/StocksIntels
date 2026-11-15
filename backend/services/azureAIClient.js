// Azure AI Foundry client — official OpenAI SDK, Responses API.
// Direct model calls only. No Azure Foundry Agent.
//
// Environment variables:
//   AZURE_AI_ENDPOINT   e.g. https://stocksintels-foundry.services.ai.azure.com/api/projects/stocksintels/openai/v1
//   AZURE_AI_API_KEY    supplied privately via environment, never logged or exposed
//   AZURE_AI_MODEL      gpt-5-mini
//   AZURE_AI_ENABLED    true | false  (default: false)

const { OpenAI } = require('openai');
const logger = require('../logger');

const ENDPOINT = process.env.AZURE_AI_ENDPOINT;
const API_KEY = process.env.AZURE_AI_API_KEY;
const MODEL = process.env.AZURE_AI_MODEL || 'gpt-5-mini';
const ENABLED = process.env.AZURE_AI_ENABLED === 'true';
const TIMEOUT_MS = Number(process.env.AZURE_AI_TIMEOUT_MS || '60000');
const MAX_RETRIES = Number(process.env.AZURE_AI_MAX_RETRIES || '3');
const INITIAL_BACKOFF_MS = Number(process.env.AZURE_AI_INITIAL_BACKOFF_MS || '1000');

let _client = null;
let _initError = null;

function _maskKey(key) {
  if (!key) return undefined;
  if (key.length <= 8) return '***';
  return key.slice(0, 4) + '…' + key.slice(-4);
}

function _sanitizeError(err) {
  const status = err.status || err.statusCode || 500;
  const message = err.message || 'Azure AI request failed';
  const safeMessage = message
    .replace(/api[_-]?key/i, '***')
    .replace(/AZURE_AI_API_KEY/i, '***')
    .replace(/Bearer\s+\S+/i, 'Bearer ***');
  return { status, message: safeMessage };
}

function _isRetryable(status) {
  return status === 408 || status === 429 || status === 500 || status === 502 || status === 503 || status === 504;
}

function _sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

function init() {
  if (_client) return _client;
  if (_initError) throw _initError;

  if (!ENABLED) {
    _initError = new Error('AZURE_AI_ENABLED is not true — Azure AI integration is disabled');
    throw _initError;
  }
  if (!ENDPOINT) {
    _initError = new Error('AZURE_AI_ENDPOINT is not configured');
    throw _initError;
  }
  if (!API_KEY) {
    _initError = new Error('AZURE_AI_API_KEY is not configured');
    throw _initError;
  }

  try {
    // Use OpenAI client (not AzureOpenAI) with baseURL pointing to the Foundry endpoint.
    // The /v1 path in the endpoint already includes the API version.
    _client = new OpenAI({
      apiKey: API_KEY,
      baseURL: ENDPOINT,
      defaultHeaders: {},
      maxRetries: 0,
      timeout: TIMEOUT_MS,
    });
    logger.info('[AzureAI] client initialized', {
      endpoint: ENDPOINT,
      model: MODEL,
      timeoutMs: TIMEOUT_MS,
      maskedKey: _maskKey(API_KEY),
    });
    return _client;
  } catch (err) {
    _initError = err;
    logger.error('[AzureAI] client init failed', { message: err.message });
    throw _initError;
  }
}

function isEnabled() {
  return ENABLED && !!_client;
}

async function createResponse(systemPrompt, userPrompt, options = {}) {
  const {
    maxOutputTokens = 2000,
    requestId = null,
    reasoningEffort = 'low',
  } = options;

  const client = init();

  let lastErr;
  for (let attempt = 1; attempt <= MAX_RETRIES; attempt++) {
    try {
      const reqBody = {
        model: MODEL,
        input: [
          { type: 'message', role: 'system', content: systemPrompt },
          { type: 'message', role: 'user', content: userPrompt },
        ],
        max_output_tokens: maxOutputTokens,
      };
      // Reasoning models (gpt-5-mini) spend output tokens on hidden reasoning.
      // Keep it low so the token budget is available for the JSON response.
      if (reasoningEffort) reqBody.reasoning = { effort: reasoningEffort };

      const res = await client.responses.create(reqBody);

      logger.info('[AzureAI] response received', {
        requestId,
        attempt,
        model: MODEL,
        responseId: res.id || null,
        usage: res.usage || null,
      });

      return {
        id: res.id || null,
        model: MODEL,
        outputText: res.output_text || '',
        output: res.output || null,
        usage: res.usage || null,
        createdAt: new Date().toISOString(),
      };
    } catch (err) {
      lastErr = err;
      const safe = _sanitizeError(err);
      const status = safe.status;

      logger.warn('[AzureAI] request attempt failed', {
        requestId,
        attempt,
        status,
        message: safe.message,
      });

      if (!_isRetryable(status)) {
        throw new Error(`Azure AI request failed (HTTP ${status}): ${safe.message}`);
      }

      if (attempt < MAX_RETRIES) {
        const backoff = INITIAL_BACKOFF_MS * Math.pow(2, attempt - 1);
        await _sleep(backoff);
        continue;
      }

      throw new Error(`Azure AI request failed after ${MAX_RETRIES} attempts (HTTP ${status}): ${safe.message}`);
    }
  }

  throw lastErr || new Error('Azure AI request failed');
}

async function testConnection() {
  const client = init();
  try {
    const res = await client.responses.create({
      model: MODEL,
      input: [
        { type: 'message', role: 'user', content: 'Say "Azure AI Foundry connectivity OK" and nothing else.' },
      ],
      max_output_tokens: 50,
    });
    return {
      ok: true,
      model: MODEL,
      responseId: res.id || null,
      outputText: (res.output_text || '').trim(),
      createdAt: new Date().toISOString(),
    };
  } catch (err) {
    const safe = _sanitizeError(err);
    logger.error('[AzureAI] connectivity test failed', { status: safe.status, message: safe.message });
    return {
      ok: false,
      model: MODEL,
      status: safe.status,
      error: safe.message,
      createdAt: new Date().toISOString(),
    };
  }
}

module.exports = {
  init,
  isEnabled,
  createResponse,
  testConnection,
  _sanitizeError,
  _isRetryable,
};

// Initialize the client on module load so isEnabled() returns true
// when env vars are present (AZURE_AI_ENABLED=true, endpoint, api key).
try {
  init();
} catch {
  // init may fail if env vars are missing; isEnabled() will return false.
}