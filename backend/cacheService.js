const { pool } = require('./db');

class PersistentCache {
  constructor(namespace, ttlMs = 86400000) {
    this.namespace = namespace;
    this.ttlMs = ttlMs;
    this._map = new Map();
  }

  get(key) {
    const entry = this._map.get(key);
    if (!entry) return null;
    if (Date.now() - entry.ts > this.ttlMs) {
      this._map.delete(key);
      return null;
    }
    return entry.data;
  }

  set(key, data) {
    this._map.set(key, { data, ts: Date.now() });
    this._persistLater(key, data);
    return data;
  }

  delete(key) {
    this._map.delete(key);
    this._deleteFromDb(key);
  }

  has(key) {
    return this.get(key) !== null;
  }

  keys() {
    return [...this._map.keys()];
  }

  clear() {
    this._map.clear();
  }

  _dbKey(key) {
    return `${this.namespace}:${key}`;
  }

  async _persistLater(key, data) {
    try {
      await pool.query(
        `INSERT INTO app_cache (cache_key, cache_value, updated_at)
         VALUES ($1, $2::jsonb, NOW())
         ON CONFLICT (cache_key) DO UPDATE SET cache_value = $2::jsonb, updated_at = NOW()`,
        [this._dbKey(key), JSON.stringify({ data, ts: Date.now() })]
      );
    } catch {}
  }

  async _deleteFromDb(key) {
    try {
      await pool.query('DELETE FROM app_cache WHERE cache_key = $1', [this._dbKey(key)]);
    } catch {}
  }

  async loadFromDb() {
    try {
      const result = await pool.query(
        `SELECT cache_key, cache_value FROM app_cache WHERE cache_key LIKE $1`,
        [`${this.namespace}:%`]
      );
      let loaded = 0;
      for (const row of result.rows) {
        const key = row.cache_key.slice(this.namespace.length + 1);
        const stored = row.cache_value;
        if (stored && stored.data && stored.ts) {
          const age = Date.now() - stored.ts;
          if (age < this.ttlMs) {
            this._map.set(key, { data: stored.data, ts: stored.ts });
            loaded++;
          }
        }
      }
      return loaded;
    } catch { return 0; }
  }
}

module.exports = PersistentCache;
