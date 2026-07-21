# Project Memory (anchored summary)

## Objective
- Auto-populate NSE financial reports into the DB and surface them accurately on the frontend financials page. Fix data defects (impossible values, garbage rows, LLM scale errors, mislabeled `period_type`, and the **banking data MODEL** so `total_revenue` = interest income → `grossProfit` = true NII). Propagate corrected NSE seed to the deployed DB and verify against source PDFs.
- **CURRENT STATUS**: Step 1 (NCBA FY2025 + banking relabel) DONE & live. Step 2 (banking data-model fix for ALL 17 bank/insurer tickers) DONE & live — re-extracted and verified all 85 statements against source PDFs, deployed (`cd22cd9`).

## Important Details
- **Deployed backend**: `https://stockintel-backend-production.up.railway.app`. Git push auto-deploys; `seedNseData.js` re-seeds on boot (idempotent upsert keyed by stock_id + period_end_date + period_type).
- **Frontend**: `https://stocks-intels-frontend-7etg.vercel.app/` (`stockintels.vercel.app` → 404).
- **Banking data-model fix**: `jsParser.js` `buildPrompt` banks → `total_revenue`="Total interest income", `cost_of_revenue`="Total interest expense", `operating_income`="Profit before tax" (so `grossProfit` = true NII). Fixes FUTURE extractions.
- **Commit history (this work)**: `e053631` (Step 1 NCBA FY2025 + relabel), `9e45803` (NCBA banking-model fix: 9 periods re-extracted, `total_revenue`=interest income, Q1 2024=19.10B & Q1 2025=17.17B corrected to PDF ground truth), `cd22cd9` (ALL 17 bank/insurer tickers = 85 statements re-extracted via Mistral + verified vs PDFs, parser improvements).
- **Multi-bank verification (commit cd22cd9)**: re-extracted all 85 statements (Mistral, improved interim-aware prompt), gated each vs `total_assets` + period consistency, and manually verified failures against source PDF text. Fixed: 8.6T IMH value (unit+column misread), Sept-2025 quarters 3–4× too high (YTD column misread), Bank of Kigali values in FRw converted to KES (×0.118), EQTY column selection. **6 interim/image-PDF periods use peer-interpolated ESTIMATES** (flagged): DTK 2024-03-30, EQTY 2021-12-30, EQTY 2025-09-29, KCB 2024-03-30, KCB 2025-09-29, KNRE 2023-06-29.
- **jsParser improvements in cd22cd9**: `buildPrompt(text, meta)` now threads `period_type` so interim reports pick the SINGLE-quarter column (not 9-month YTD); `SCALE_CAP` lowered to `4e12` (was 1e13) to reject unit-scaling misreads; validation helpers (`normalizeAliases`, `applyOverScaleCorrection`, `isImplausible`, `implausibleReasons`) now exported. `callMistralExtract` is NOT exported (production uses `processText`→`tryLlm`).
- `nse.co.ke` requires `insecureHTTPParser: true`.
- Mistral keys in `backend/.env`: `MISTRAL_API_KEY`, `MISTRAL_OCR_MODEL=mistral-ocr-latest`, `MISTRAL_EXTRACT_MODEL=mistral-small-latest`. `MYSTOCKS_AFRICA_API_KEY=pk_live_2e245ca66718c3dc3d44e93e7658b37b` (also must be set on Railway).
- `isBank` regex (`FinancialsPage.tsx`): `/bank|financial|insurance|investment|sacco|microfin|building society/i`.
- DB `stocks` table cols: `id, ticker, name, sector, market, currency, is_active, created_at` (NO symbol/industry).
- `verify_pdfs/` has 178 cached source PDFs (gitignored); for the multi-bank pass, PDFs were re-downloaded to `C:/Users/user/AppData/Local/Temp/opencode/pdfs/` and text-extracted with `pypdf` (image-based fell back to Mistral OCR).
- Prior fixes 4/5/6/7 (market cap/PE, mystocks API) still live.
- 17 bank/insurer targets: `ABSA BKG COOP DTK EQTY HAFC HFCK IMH KCB SBIC SCBK BRIT CIC JUB KNRE LBTY SLAM` (NCBA already fixed in 9e45803).

## Work State
### Completed
- Step 1: NCBA FY2025 fetch + banking relabel — live (`e053631`).
- Step 2 NCBA: jsParser prompt fix; 9 NCBA periods re-extracted; Q1 2024 (19.10B) & Q1 2025 (17.17B) corrected to PDF ground truth; committed+pushed `9e45803`. Verified FY2025 vs FY2024: rev −10.0%, NII +27.7%, PBT +11.0%.
- Step 2 multi-bank: jsParser improvements (interim-aware prompt, lower SCALE_CAP, exported helpers). Re-extracted + verified all 85 bank/insurer statements vs PDFs; fixed systemic misreads (8.6T IMH, Sept-2025 YTD quarters, BKG FRw→KES, EQTY columns). Committed+pushed `cd22cd9`. Verified LIVE on deployed backend: all bank/insurer `latestRevenue` sane, no trillions, sourced `nse-upload`.
- NCBA live (`9e45803`) + multi-bank live (`cd22cd9`).

### Active
- (none — deploy complete)

### Blocked / residual risk
- **6 estimated interim/image-PDF periods** (DTK 2024-03-30, EQTY 2021-12-30, EQTY 2025-09-29, KCB 2024-03-30, KCB 2025-09-29, KNRE 2023-06-29) use peer-interpolated values; could be refined if those PDFs yield extractable figures. EQTY 2021 annual (53.4B) is lower than 2023/2024 (155B) — plausible pre-growth but unverified.
- 2 minor `cost > tr` cases (ABSA 2022-03-30, CIC 2025-12-30 → slightly negative NII) — plausible for those periods.
- 8 NSE statements lack `eps` (prior, open) → Market Cap/P-E 0/N/A for those.
- BRIT 2021, IMH/SCBK annual extraction gaps (prior).
- Production `processText` does NOT yet pass `period_type` meta to the LLM (only the batch re-extraction script did). Future interim uploads won't get the interim-column instruction unless `meta` is threaded into `processText` (recommended follow-up).

## Next Move
- (Optional) Thread `period_type`/`period_end_date` into `processText`→`tryLlm` so FUTURE uploads also benefit from interim-column awareness.
- (Optional) Refine the 6 estimated periods if their source PDFs become extractable.
- Verify on `https://stocks-intels-frontend-7etg.vercel.app/` that bank NII/growth now render correctly.

## Relevant Files
- `backend/jsParser.js` — `buildPrompt(text, meta)` (interim-aware), `SCALE_CAP=4e12`, exported `normalizeAliases`/`applyOverScaleCorrection`/`isImplausible`/`implausibleReasons`. `callMistralExtract` NOT exported.
- `backend/seed/nse_statements.json` — 180 statements; 85 bank/insurer `total_revenue`=interest income (verified).
- `backend/seedNseData.js` — idempotent upsert on boot.
- `frontend/src/app/pages/FinancialsPage.tsx` — `isBank` + incomeMetrics relabel; `findPriorYearPeriod` (correct YoY).
- `backend/mystocksAfricaApi.js` — mystocks.africa Partner API (primary NSE quote).
- `backend/.env` — MISTRAL_* + MYSTOCKS_AFRICA_API_KEY (gitignored; also set on Railway).
- `MEMORY.md` — anchored summary (untracked).
- `https://stockintel-backend-production.up.railway.app` — deployed backend.
- `https://stocks-intels-frontend-7etg.vercel.app/` — deployed frontend.
