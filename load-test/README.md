# Load Testing for StocksIntels

Uses [Artillery](https://www.artillery.io/) to simulate concurrent users and measure capacity.

## Quick Start

```bash
# 1. Install dependencies
cd backend
npm install

# 2. Create test users in the database
node ../load-test/setup-test-users.js

# 3. Run the load test against local server
npm run load-test

# 4. Generate a visual HTML report
npm run load-test:report
```

## Configuration

| Env Variable | Default | Description |
|---|---|---|
| `TARGET_URL` | `http://localhost:3001` | Server to test |
| `LOAD_TEST_USERS` | `50` | Number of test users to create |
| `LOAD_TEST_PASSWORD` | `TestPass123!` | Password for test users |
| `USERS_CSV` | `./load-test/users.csv` | Path to user credentials CSV |

## Running Against Different Environments

```bash
# Local
npm run load-test

# Staging
TARGET_URL=https://staging.example.com npm run load-test

# Production (test carefully!)
TARGET_URL=https://your-app.com npm run load-test
```

## Understanding Results

Artillery outputs these key metrics after each phase:

- **http.codes.200** - Successful responses
- **http.codes.429** - Rate-limited (too many requests)
- **http.codes.5xx** - Server errors (potential crashing)
- **http.response_time** - Latency (p50, p95, p99)
- **http.request_rate** - Requests per second

### Signs of hitting capacity:

- `http.response_time.p99` exceeds 5000ms
- `http.errors` > 0 (connection timeouts, socket hangs)
- `http.codes.5xx` appear
- `http.codes.429` spike (rate limiter kicking in — adjust in `rateLimiter.js` if needed)

## Test Scenarios

1. **Browse public market data** (weight: 3) — Health, stocks, news, indices, quotes
2. **Authenticated user session** (weight: 2) — Login, watchlist, portfolio, signals
3. **Heavy data browsing** (weight: 1) — Full stock lists, movers, sectors, history

## Notes

- Rate limiter is set to 1000 req/15min globally. In a real load test, requests come from one IP, so the rate limiter will cap throughput. Adjust `rateLimiter.js` or test against a staging server without rate limits.
- Database connection pool defaults to 10 connections (pg default). This is often the first bottleneck.
- The Socket.IO real-time layer is not tested here. Add socket.io scenarios via `engine: "socket.io"` if needed.
