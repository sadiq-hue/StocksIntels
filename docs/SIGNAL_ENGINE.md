# StocksIntels — Signal Engine Reference

How a Buy / Hold / Sell signal is produced, every parameter that feeds it, and
how fresh the underlying data actually is. Written from a direct read of the
source; every claim carries a `file:line` reference.

**Scope:** the live signal path only (`generateSignals` → `processSymbol` →
`_buildSignal`). Tunables live in `backend/engineConfig.js` and are runtime-
editable via `GET/PUT /api/signals/engine/config` (persisted to the
`engine_config` table).

**Last reviewed:** October 2026.

---

## 1. The pipeline

```
generateSignals()            signalService.js:4153   // cache + market-hours + universe guards
  └─ detectMarketRegime()    signalService.js:1091   // bull / bear / sideways / crash
  └─ processSymbol()         signalService.js:4253   // per stock, batched 20 at a time
       ├─ analyzeFundamentals  analysisEngine.js:101
       ├─ analyzeTechnicals    analysisEngine.js:354
       ├─ analyzeFinancials    analysisEngine.js:584
       ├─ getMacroScore        macroService.js:469
       └─ _buildSignal()       signalService.js:5217  // composite, confidence, levels
  └─ applyPortfolioConstraints riskManager.js:216
  └─ filter minConfidence      signalService.js:4672
```

Market open/closed is decided in **`backend/marketHours.js`** (single source of
truth for the engine, the publisher, and the API/UI): NSE 09:30–15:00 EAT
(06:30–12:00 UTC), US 09:30–16:00 ET.

`generateSingleSignal(symbol)` (`signalService.js:4748`) is the on-demand twin
and calls the same `_buildSignal`.

---

## 2. The composite score

Assembled in `_buildSignal` (`signalService.js:5260-5310`):

```
adjScore = fundamental.score · w.fundamental
         + technical.score   · w.technical
         + financial.score   · w.financial
         + macro.score       · w.macro
         + mlProbScore       · w.ml_probability
adjScore /= (w.fundamental + w.technical + w.financial + w.macro + w.ml_probability)

adjScore += sparseFund&sparseTech ? -4 : 0        // engineConfig.js:158
adjScore += sparseFund&sparseFin  ? -3 : 0        // engineConfig.js:159
adjScore += news positive? +5 : negative? -5 : 0  // engineConfig.js:146-147
adjScore += catalyst ±10                          // engineConfig.js:148-149
adjScore += (insider.score-50)/50 · 8             // INSIDER_MAX_DELTA, signalService.js:666
// then: speculative-rally cap, clamp 0-100
overallScore = max(0, min(100, round(adjScore)))
```

> **Fixed Oct 2026.** The composite previously included a sixth term
> `50 · w.confidence`. Confidence is *derived from* this score, so that term was
> a constant, not an input — it shrank every score toward 50. It is removed and
> the weighting renormalized over the five real inputs. Effect: for every unit of
> `w.confidence` (0.13 base … 0.20 sideways), a name whose five-component average
> is `a` moves by `w.conf · (a − 50)` — i.e. stronger names score slightly higher,
> weaker ones slightly lower, unchanged at 50. Near the Buy bar (55) the shift is
> under a point.

### Weights (`engineConfig.js:22-31`)

| Component | Base | bull | bear | sideways | crash |
|---|---|---|---|---|---|
| fundamental | 0.30 | 0.30 | 0.18 | 0.23 | 0.20 |
| technical | 0.30 | 0.25 | 0.32 | 0.27 | 0.20 |
| financial | 0.08 | 0.10 | 0.10 | 0.10 | 0.15 |
| macro | 0.04 | 0.05 | 0.10 | 0.05 | 0.15 |
| ml_probability | 0.15 | 0.15 | 0.15 | 0.15 | 0.15 |
| confidence | 0.13 | 0.15 | 0.15 | 0.20 | 0.15 |

Regime weights come from `regime_adaptation.weights_per_regime`
(`engineConfig.js:62-67`) via `getWeightsForRegime` (`engineConfig.js:337`).

---

## 3. Sub-score inputs

Baselines and caps are in `engineConfig.js:164-214`; deltas are read at scoring
time by `analysisEngine.getScoring`.

### Fundamental — baseline 40, cap ±25 (`analysisEngine.js:101`)

| Input | Condition → delta |
|---|---|
| Data completeness | <4 fields −14 / <7 −8 / <10 −3 |
| P/E vs sector | <0.7 → +up to 12; >1.8 → −up to 8 |
| EV/EBITDA vs industry | below median +10 |
| P/B | <1.0 +15; >5 −5 |
| Dividend yield | >2× T-bill +10; > T-bill +5 (T-bill 16%) |
| Revenue growth | >15% +12 / >10% +8 / >5% +3 / <0 −5 |
| EPS surprise | >10 +10 / <−10 −10 / >0 +3 |
| Margin change | >2pp +10 / <−3pp −5 / >0 +3 |
| FCF yield | >5% +10 / >0 +3 / <0 −8 |
| Debt/Equity | <0.5 +8 / >3 −8 / <1 +3 |
| Current ratio | >1.5 +5 / <1.0 −5 |
| ROE | >15% +8 / <5% −5 |
| Altman Z | >3 +5; <1.81 **caps score at 50** |
| News sentiment | +5 / −5 |

### Technical — baseline 50, cap ±25 (`analysisEngine.js:354`)

| Input | Condition → delta |
|---|---|
| Bar history | <20 −12 / <50 −5 |
| RSI(14) | <30 +15 / <40 +5 / >75 −5 / >60 −3 |
| MACD(12,26,9) | bullish +15 / turning +5 / bearish −15 / turning −5 |
| SMA trend (20/50) | golden cross +20 / strong uptrend +15 / uptrend +5 / downtrend −3 / strong downtrend −10 / death cross −15 |
| Bollinger(20,2) | near lower +10 / near upper −10 / below middle +3 |
| Volume (vs 10) | >2× +10 / >1.5× +5 / <0.5× −3 |
| Momentum | >20% +15 / >10% +10 / >5% +5 / <−20% −10 / <−10% −5 / <−5% −3 |

### Financial — baseline 50, cap ±25 (`analysisEngine.js:584`)
D/E <0.5 +15 / >2 −15; current ratio >2 +10 / <1 −10; ROE >15 +15 / <5 −5;
Altman Z >3.5 +2 / <1.5 −3; sparse penalty −8; strength aggregate ±8...±20;
signal-agreement ±10; Altman <1.81 caps at 40.

### Macro — average of 7 conditions, 0–100 (`macroService.js:469`)
Interest-rate differential vs the live Fed rate, GDP growth, inflation, current
account, political risk, credit rating, PMI. A sector overlay
(`analysisEngine.js:82`) adds +5/−3/+8 etc. for rate-sensitive / defensive /
cyclical sectors.

### ML (`mlSignalModel.js`)
24 features (`mlSignalModel.js:6-16`): RSI, MACD hist, BB %B, SMA ratio, ATR
ratio, volume ratio, 5d momentum, P/E, revenue growth, the three sub-score
levels, plus forward/live-test outcomes. Predicted via Modal serverless
(`modalBridge.js`) or a JS logistic regression fallback; `mlProbScore =
round(mlWinProb·100)`, default 50 when unavailable (`signalService.js:5258`).

---

## 4. Score → label

`classifySignalBucket` (`signalService.js:4957`) with thresholds
(`engineConfig.js:33-39`):

| Label | Score |
|---|---|
| Strong Buy | ≥ 68 |
| Buy | ≥ 55 |
| Hold | ≥ 30 |
| Sell | ≥ 18 |
| Strong Sell | < 18 |

Below Buy, an "evidence" score (sub-scores <40, negative news/catalyst, Altman
distress, deteriorating ROE/EPS/revenue) decides Hold vs Sell vs Strong Sell.
An RSI ≤30 oversold guard blocks Strong Sell unless evidence is strong.

---

## 5. Confidence (`signalService.js:5335-5369`)

```
confidence = clamp( round(overallScore − maxSubScoreVariance × 0.3), 10, 95 )
           × degFactor                     // data-source health 0..1 (signalService.js:3510)
           × circuitBreaker                // 0.5 @3 losses, 0.25 @5+ (riskManager.js:202)
           → mlModel.calibrateConfidence   // 0.7·raw + 0.3·binAccuracy (mlSignalModel.js:260)
           × 0.7 if portfolio drawdown > 20%
```

**Confidence gate:** a Buy whose confidence < 55 is demoted to **Hold**; a
Strong Buy < 68 is demoted to Buy (`signalService.js:5361-5369`). Sells are not
gated here. The final feed also drops anything below `minConfidence` (default
30) and sells below 40 (`signalService.js:4680,4483`).

---

## 6. Trade levels & position sizing

`calculateTradeLevels` (`riskManager.js:103`):

```
volatility = ATR(14)
baseDistancePct = max(volatility × tradeTypeMult, MIN_STOP_PCT)   // tradeTypeMult: momentum 1.5, swing 2, long-term/value 3
stopLoss   = entry − entry·baseDistancePct     (capped at MAX_STOP_PCT)
target1/2/3 = entry + risk·2 / 4 / 6           (snapped up to real resistance)
riskReward  ≈ 2.0 by construction
```

Constants: `MIN_STOP_PCT = 0.18`, `MAX_STOP_PCT = 0.30` (`riskManager.js:55,61`),
targets 2/4/6× risk (`riskManager.js:72-74`). This is why targets are wide —
they are multiples of an 18–30% stop.

**Sizing:** Kelly (`mlWinProb > 0.5`) else strength×regime×confidence, capped at
`maxConcentration` 25% (`riskManager.js:9-31`). Sells get size 0.

---

## 7. Emission gates

| Gate | Where | Effect |
|---|---|---|
| Market-hours | `marketHours.nseOpen/usOpen` | no full regen unless open (NSE 09:30–15:00 EAT; US 09:30–16:00 ET) |
| Monitor-first | `signalService.js:4406-4457` | a symbol with an open position emits no new signal until it closes (6h min-age) |
| `meetsSignalConditions` | `signalService.js:5506` | needs ≥20 bars, volume>0, finite sub-scores, monotonic stop<entry<target1, R/R≥1.2 |
| Speculative-rally cap | `signalService.js:5297` | >40% momentum on fund≤40 capped at 54 (cannot Buy) |
| Entry deviation | `signalService.js:653` | skips a quote >±50% from prior close |
| Sector concentration | `riskManager.js:216` | >30% of buys in one sector shrinks size/confidence |
| Tracked-position cap | `riskManager.js:625` | `MAX_TRACKED_POSITIONS = 500`; live positions never evicted |

---

## 8. Cadence

| Cycle | Interval | Where |
|---|---|---|
| Full signal regeneration | 15 min | `SIGNALS_CACHE_TTL`, `signalService.js:220,4074` |
| Redis publisher (quick mode) | 5 min | `engineConfig.signalInterval`, `signalPublisher.js:25` |
| Forward-test resolution | 5 min | `signalService.js:4068` |
| Prediction-log batch resolve | 1 h | `signalService.js:5593` |
| Auto weight optimization | 24 h | `signalService.js:5601` |
| Regime cache | 1 h | `signalService.js:618` |
| NSE index history recorder | 30 min | `index.js:5041` |

---

## 9. Data freshness — is it real-time?

**No. It is polling over delayed / EOD sources. There is no market-data
streaming.**

### NSE (`getNseBaseQuote`, `marketService.js:391`) — tried in order

| # | Source | Nature | Cache |
|---|---|---|---|
| 1 | NSE official portal ticker (`nseTickerScraper.js`) | the nse.co.ke widget feed; upstream delay undocumented; only used if within 0.75–1.35× the KenyanStocks close | 3 min (10 min stale) |
| 2 | KenyanStocks (`kenyanStocksScraper.js`) | **EOD close**, doubles as the sanity baseline | 1 h |
| 3 | MyStocks Africa Partner API (`mystocksAfricaApi.js:6`) | **"DELAYED ~15 min"** (08:00–16:00 UTC Mon–Fri) | 5 min |
| 4 | mystocks.co.ke scraper | disabled when the partner key is set | 5 min |
| 5 | Apify actor | last resort | 5 min |

### US / global (`yahooService.fetchQuote`)
Google Finance scrape → proxy pool → Yahoo v8 → yahoo-finance2 → RapidAPI.
Near-real-time at source, but cached 5 min.

### Cache TTLs

| Layer | TTL | Where |
|---|---|---|
| marketService quote cache | 5 min (serves stale ≤10 min) | `marketService.js:20,644` |
| signalService internal quote cache | 30 s | `signalService.js:643` |
| Yahoo quote / historical | 5 min / 1 h | `yahooService.js:7-10` |
| Signals cache | 15 min | `signalService.js:220` |
| Fundamentals (Yahoo / Alpha Vantage / EDGAR) | 24 h | `financialReportsService.js`, `signalService.js:336` |
| NSE fundamentals reseed | 4 h (from a static table) | `nseFundamentalsSeeder.js:63` |

**Net:** a displayed US price is ≥~5 min old; a displayed NSE price is ≥~5 min
old at the app layer over a feed that is EOD or ~15-min delayed; worst case
~10 min stale.

### Client updates are polled
`RealtimeQuotesContext` posts `/api/market/quotes` every 30 s; dashboard quotes
60 s, signals 60 s, signals page 5 min. Socket.io carries signals / indices /
notifications only. The market-quote push path is **dead code**
(`queueService.publishMarketUpdate` is defined and exported but never called;
the frontend `market:update` handler is a no-op).

### Outside market hours
No new generation; `/api/signals` serves an in-memory cache backed by a Postgres
snapshot loaded with a **shape check, not a TTL check**
(`signalService.js:246`) — it can be arbitrarily old until the next rebuild.
Stop/target resolution is gated to open markets so stale quotes cannot fabricate
fills.

---

## 10. Known quirks / caveats

Fixed Oct 2026 (see the composite note in §2): the constant-50 `confidence`
composite term, the missing `insider_activity` config block, the unused
`volatility_lookback` key, the dead `determineSignal()`, the NSE session
mismatch (now centralized in `backend/marketHours.js`), and the misleading
"primary" comment on the MyStocks Africa source.

Still open:

1. **`mlWinProb` is passed to `calibrateConfidence` but ignored** inside it
   (`mlSignalModel.js:260`); ML reaches confidence only via outcome-bin
   calibration. Harmless (ML already contributes through the composite), but the
   unused parameter is misleading.
2. `portfolio.stopLoss = 0.05` only governs Hold-signal levels; buy stops come
   from `MIN_STOP_PCT = 0.18`, so the config value does not affect tradeable
   setups.

---

## 11. Key constants

| Constant | Value | Where |
|---|---|---|
| Score thresholds | SB 68 / B 55 / H 30 / S 18 | `engineConfig.js:33-39` |
| Base weights | .30/.30/.08/.04/.15/.13 | `engineConfig.js:22-31` |
| variance_multiplier | 0.3 | `engineConfig.js:144` |
| confidence min/max | 10 / 95 | `engineConfig.js:142-143` |
| news / catalyst delta | ±5 / ±10 | `engineConfig.js:146-149` |
| speculative cap | momentum ≥40%, fund ≤40 → 54 | `engineConfig.js:150-157` |
| ML train trigger | ≥50 resolved, 5-min cooldown | `signalService.js:639,4674` |
| MIN_SIGNAL_HISTORY | 20 bars | `signalService.js:664` |
| MIN_RISK_REWARD | 1.2 | `signalService.js:665` |
| INSIDER_MAX_DELTA | 8 | `signalService.js:666` |
| MAX_ENTRY_DEVIATION | 0.5 | `signalService.js:653` |
| SCORE_CLOSE_MIN_AGE | 6 h | `signalService.js:1983` |
| MIN_STOP_PCT / MAX_STOP_PCT | 0.18 / 0.30 | `riskManager.js:55,61` |
| Target multiples | 2 / 4 / 6 × risk | `riskManager.js:72-74` |
| Circuit breaker | ×0.5 @3, ×0.25 @5+ (floored) | `riskManager.js:202-211` |
| MAX_TRACKED_POSITIONS | 500 | `riskManager.js:625` |
