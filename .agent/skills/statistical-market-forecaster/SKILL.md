---
name: statistical-market-forecaster
description: Deterministic OHLCV statistical forecasting, volatility estimation, walk-forward backtesting, and Binance order ticket generation. Activate when computing price predictions, confidence bands, regime diagnostics, or position sizing for any trading pair.
---

# Statistical Market Forecaster Skill

## 1. Goal
Transform raw Open-High-Low-Close-Volume (OHLCV) candle series from Binance (`data-api.binance.vision`) or user CSV files into verified multi-horizon statistical price forecasts, regime classifications, and volatility-adjusted execution parameters suitable for side-by-side use with the Binance desktop or Android app.

## 2. Instructions
1. **Ingest & Validate Input Series**:
   - Fetch at least 40 (default 240) OHLCV bars for the target symbol and interval (`5m`, `15m`, `1h`, `4h`, `1d`).
   - Verify strictly ascending timestamps and strictly positive `open`, `high`, `low`, `close` values with `high >= max(open, close)` and `low <= min(open, close)`.
2. **Compute Descriptive & Regime Diagnostics**:
   - Compute log returns `r_t = ln(C_t / C_(t-1))`.
   - Estimate Close-to-Close volatility, RiskMetrics EWMA volatility (`lambda = 0.94`), Parkinson High-Low volatility, Garman-Klass OHLC volatility, and Wilder ATR(14).
   - Compute the Rescaled-Range (R/S) Hurst Exponent `H` and Lo-MacKinlay Variance Ratio `VR(4)` to classify the regime as `MEAN-REVERTING`, `RANDOM WALK`, or `PERSISTENT TREND`.
3. **Execute Constituent Models & Walk-Forward Self-Annealing**:
   - Run `ols_drift` (Log-Linear OLS Drift + Student-t prediction fan), `ewma_holt` (Damped Holt Double Exponential Smoothing + EWMA variance), and `ar1_ou` (AR(1) Ornstein-Uhlenbeck process).
   - Evaluate strictly out-of-sample 1-step-ahead forecasts over the trailing rolling windows.
   - Compute inverse-MSE weights `w_i = (1 / MSE_i) / sum_j (1 / MSE_j)` to construct the `ensemble` forecast and law-of-total-variance prediction bands (`Q05`, `Q25`, `Mean`, `Q75`, `Q95`).
4. **Synthesize Execution Ticket Parameters**:
   - Determine directional bias from terminal `P(C_(t+h) > C_t)` and OLS slope significance.
   - Compute reference entry, `2 * ATR(14)` volatility stop-loss, statistical take-profit targets (`TP1 = E[P]` or `Q75`/`Q25`, `TP2 = Q95`/`Q05`), and risk-budgeted position quantity.

## 3. Examples
- **Input**: `symbol = BTCUSDT`, `interval = 1h`, `horizon = 16`, `equity = 10000`, `riskPct = 1.0`
- **Output**:
  - Regime classification (`MEAN-REVERTING` / `RANDOM WALK` / `PERSISTENT TREND`)
  - 16-bar forecast fan with `[Q05, Q25, Mean, Q75, Q95]` and `P(Up)`
  - Walk-forward RMSE, MAE (bps), Directional Hit Rate (%), Brier Score, and Ensemble Weights
  - Copy-ready Binance Spot/Futures order ticket values (Entry, Stop-Loss, TP1, TP2, Base Quantity)

## 4. Constraints
- Never fabricate metrics or hardcode static forecast percentages. Every figure must be calculated from the active OHLCV array.
- Require at least 40 valid bars before running regression or walk-forward evaluation.
- Shrink raw OLS slope by `0.55` toward unconditional drift to prevent short-window extrapolation blowups.
- Clamp AR(1) autoregression parameter `phi` to `[-0.85, 0.85]` to guarantee stationarity.

## 5. Tools/Scripts
- Browser / TypeScript runtime: `src/lib/math.ts` and `src/lib/statistics.ts` (`runStatisticalAnalysis`)
- Deterministic CLI verifier:
  ```bash
  node .agent/skills/statistical-market-forecaster/scripts/verify_forecast_cli.mjs BTCUSDT 1h 16
  ```
- Unit & Compliance Test Suite:
  ```bash
  npm test
  ```

## 6. Failure Modes
- **Exchange REST / WebSocket Unreachable**: Automatically transition to the explicitly labeled `OFFLINE SYNTHETIC SERIES` generator (`generateOfflineFallbackSeries`) and badge the UI status indicator in amber so the trader knows live connectivity is interrupted.
- **Invalid Symbol Lookup**: When a user enters an unrecognized exchange pair, catch the HTTP 400 response from `data-api.binance.vision/api/v3/ticker/24hr` and display a clear error banner without crashing the workspace.
- **Degenerate Flat Price Series (`sxx == 0`)**: Guard division by zero in OLS and volatility estimators.

## 7. Definition of Done
- Quantile ordering `Q05 < Q25 < Mean < Q75 < Q95` holds at every forecast horizon step `h = 1..H`.
- Constituent model weights sum to `1.0` (`100.0%`).
- All unit and UI compliance tests (`npm test`) and production build (`npm run build`) pass with zero errors.
