// Queue Service - Redis-backed pub/sub for high-frequency signal updates
const Redis = require('ioredis');

const REDIS_URL = process.env.REDIS_URL || 'redis://localhost:6379';

const CHANNELS = {
  SIGNAL_UPDATES: 'signal:updates',
  SIGNAL_STOCK_PREFIX: 'signal:stock:',
  MARKET_UPDATES: 'market:updates',
  NOTIFICATION_SIGNALS: 'notification:signals',
  INDEX_UPDATES: 'index:updates',
  SECTOR_UPDATES: 'sector:updates',
};

let publisher = null;
let subscriber = null;
let isConnected = false;

function getPublisher() {
  if (!publisher) {
    publisher = new Redis(REDIS_URL, {
      retryStrategy(times) {
        if (times > 5) return null;
        return Math.min(times * 100, 3000);
      },
      maxRetriesPerRequest: 1,
      lazyConnect: true,
      enableOfflineQueue: false,
    });
    publisher.on('error', () => {});
    publisher.on('connect', () => { isConnected = true; });
    publisher.on('close', () => { isConnected = false; });
  }
  return publisher;
}

function getSubscriber() {
  if (!subscriber) {
    subscriber = new Redis(REDIS_URL, {
      retryStrategy(times) {
        if (times > 5) return null;
        return Math.min(times * 100, 3000);
      },
      maxRetriesPerRequest: 1,
      lazyConnect: true,
      enableOfflineQueue: false,
    });
    subscriber.on('error', () => {});
    subscriber.on('connect', () => { isConnected = true; });
    subscriber.on('close', () => { isConnected = false; });
  }
  return subscriber;
}

let connectAttempted = false;
let redisAvailable = false;

function isRedisAvailable() { return isConnected && redisAvailable; }

async function connect() {
  if (connectAttempted) return;
  connectAttempted = true;
  const pub = getPublisher();
  const sub = getSubscriber();
  try {
    await Promise.all([pub.connect(), sub.connect()]);
    console.log('[QueueService] Connected to Redis');
    redisAvailable = true;
  } catch (err) {
    console.warn('[QueueService] Redis unavailable, running without pub/sub. Start Redis with: docker compose up -d redis');
    isConnected = false;
  }
}

async function disconnect() {
  if (publisher) { await publisher.quit(); publisher = null; }
  if (subscriber) { await subscriber.quit(); subscriber = null; }
  isConnected = false;
}

// ─── Publish ─────────────────────────────────────────────────────────────────

async function publishSignalUpdate(signal) {
  if (!isRedisAvailable()) return;
  const pub = getPublisher();
  const channel = `${CHANNELS.SIGNAL_STOCK_PREFIX}${signal.ticker}`;
  await Promise.all([
    pub.publish(CHANNELS.SIGNAL_UPDATES, JSON.stringify(signal)),
    pub.publish(channel, JSON.stringify(signal)),
    pub.set(`signal:cache:${signal.ticker}`, JSON.stringify(signal), 'EX', 120),
  ]);
}

async function publishBatchSignalUpdate(signals) {
  if (!isRedisAvailable()) return;
  const pub = getPublisher();
  const multi = pub.multi();
  const batchPayload = JSON.stringify({ batch: true, count: signals.length, timestamp: new Date().toISOString(), signals });

  multi.publish(CHANNELS.SIGNAL_UPDATES, batchPayload);
  signals.forEach(s => {
    multi.publish(`${CHANNELS.SIGNAL_STOCK_PREFIX}${s.ticker}`, JSON.stringify(s));
    multi.set(`signal:cache:${s.ticker}`, JSON.stringify(s), 'EX', 120);
  });
  await multi.exec();
}

async function publishMarketUpdate(quote) {
  if (!isRedisAvailable()) return;
  const pub = getPublisher();
  await pub.publish(CHANNELS.MARKET_UPDATES, JSON.stringify(quote));
}

async function publishSignalNotifications(notifications) {
  if (!notifications || notifications.length === 0 || !isRedisAvailable()) return;
  const pub = getPublisher();
  await pub.publish(CHANNELS.NOTIFICATION_SIGNALS, JSON.stringify({
    batch: true,
    count: notifications.length,
    timestamp: new Date().toISOString(),
    notifications,
  }));
}

// ─── Subscribe ───────────────────────────────────────────────────────────────

function onSignalUpdate(callback) {
  if (!isRedisAvailable()) return;
  const sub = getSubscriber();
  sub.subscribe(CHANNELS.SIGNAL_UPDATES, (err) => {
    if (err) console.error('[QueueService] Subscribe error:', err.message);
    else console.log('[QueueService] Subscribed to', CHANNELS.SIGNAL_UPDATES);
  });
  sub.on('message', (channel, message) => {
    if (channel === CHANNELS.SIGNAL_UPDATES) {
      try { callback(JSON.parse(message)); }
      catch { /* ignore malformed */ }
    }
  });
}

function onStockSignal(symbol, callback) {
  if (!isRedisAvailable()) return;
  const sub = getSubscriber();
  const channel = `${CHANNELS.SIGNAL_STOCK_PREFIX}${symbol}`;
  sub.subscribe(channel, (err) => {
    if (err) console.error(`[QueueService] Subscribe error for ${channel}:`, err.message);
  });
  sub.on('message', (channel, message) => {
    if (channel === `${CHANNELS.SIGNAL_STOCK_PREFIX}${symbol}`) {
      try { callback(JSON.parse(message)); }
      catch { /* ignore malformed */ }
    }
  });
}

function onMarketUpdate(callback) {
  if (!isRedisAvailable()) return;
  const sub = getSubscriber();
  sub.subscribe(CHANNELS.MARKET_UPDATES, (err) => {
    if (err) console.error('[QueueService] Subscribe error:', err.message);
  });
  sub.on('message', (channel, message) => {
    if (channel === CHANNELS.MARKET_UPDATES) {
      try { callback(JSON.parse(message)); }
      catch { /* ignore malformed */ }
    }
  });
}

// ─── Caching ─────────────────────────────────────────────────────────────────

async function getCachedSignal(symbol) {
  if (!isRedisAvailable()) return null;
  const pub = getPublisher();
  const cached = await pub.get(`signal:cache:${symbol}`);
  return cached ? JSON.parse(cached) : null;
}

async function getCachedSignals(symbols) {
  if (!isRedisAvailable()) return {};
  const pub = getPublisher();
  const keys = symbols.map(s => `signal:cache:${s}`);
  const results = await pub.mget(keys);
  const map = {};
  symbols.forEach((s, i) => {
    if (results[i]) map[s] = JSON.parse(results[i]);
  });
  return map;
}

async function setCachedSignal(symbol, signal, ttl = 120) {
  if (!isRedisAvailable()) return;
  const pub = getPublisher();
  await pub.set(`signal:cache:${symbol}`, JSON.stringify(signal), 'EX', ttl);
}

function onSignalNotification(callback) {
  if (!isRedisAvailable()) return;
  const sub = getSubscriber();
  sub.subscribe(CHANNELS.NOTIFICATION_SIGNALS, (err) => {
    if (err) console.error(`[QueueService] Subscribe error:`, err.message);
  });
  sub.on('message', (channel, message) => {
    if (channel === CHANNELS.NOTIFICATION_SIGNALS) {
      try { callback(JSON.parse(message)); }
      catch { /* ignore malformed */ }
    }
  });
}

async function publishIndexUpdate(indices) {
  if (!isRedisAvailable()) return;
  const pub = getPublisher();
  await pub.publish(CHANNELS.INDEX_UPDATES, JSON.stringify(indices));
}

async function publishSectorUpdate(sectors) {
  if (!isRedisAvailable()) return;
  const pub = getPublisher();
  await pub.publish(CHANNELS.SECTOR_UPDATES, JSON.stringify(sectors));
}

function onIndexUpdate(callback) {
  if (!isRedisAvailable()) return;
  const sub = getSubscriber();
  sub.subscribe(CHANNELS.INDEX_UPDATES, (err) => {
    if (err) console.error('[QueueService] Subscribe error on index:', err.message);
  });
  sub.on('message', (channel, message) => {
    if (channel === CHANNELS.INDEX_UPDATES) {
      try { callback(JSON.parse(message)); }
      catch { /* ignore malformed */ }
    }
  });
}

function onSectorUpdate(callback) {
  if (!isRedisAvailable()) return;
  const sub = getSubscriber();
  sub.subscribe(CHANNELS.SECTOR_UPDATES, (err) => {
    if (err) console.error('[QueueService] Subscribe error on sector:', err.message);
  });
  sub.on('message', (channel, message) => {
    if (channel === CHANNELS.SECTOR_UPDATES) {
      try { callback(JSON.parse(message)); }
      catch { /* ignore malformed */ }
    }
  });
}

module.exports = {
  connect,
  disconnect,
  publishSignalUpdate,
  publishBatchSignalUpdate,
  publishMarketUpdate,
  publishSignalNotifications,
  onSignalUpdate,
  onStockSignal,
  onMarketUpdate,
  onSignalNotification,
  publishIndexUpdate,
  publishSectorUpdate,
  onIndexUpdate,
  onSectorUpdate,
  getCachedSignal,
  getCachedSignals,
  setCachedSignal,
  isRedisAvailable,
  CHANNELS,
};
