# TickFrame Quantitative Terminal

TickFrame is a real-time market telemetry and statistical price forecasting workstation built with TypeScript, React, and TradingView Lightweight Charts.

## Capabilities

- **Live Market Telemetry**: Streams real-time spot OHLCV klines and 24-hour orderbook tickers (`BTC/USDT`, `ETH/USDT`, `SOL/USDT`, `BNB/USDT`, `XRP/USDT`, `AVAX/USDT`, `LINK/USDT`, `ADA/USDT`) via REST and WebSocket feeds (`data-api.binance.vision`), with an explicitly badged deterministic synthetic fallback when offline and full custom CSV dataset import support.
- **Econometric & Statistical Forecasting Engine**:
  1. **Log-Linear OLS Drift + Student-t Prediction Fan**: Shrinkage-regularized ordinary least squares over rolling log prices with finite-sample Student-t prediction intervals.
  2. **Damped Holt Double Exponential Smoothing + RiskMetrics EWMA Volatility**: Recursive level and damped trend filtering paired with conditional variance recursion ($\lambda = 0.94$).
  3. **AR(1) Ornstein-Uhlenbeck Return Process**: First-order serial autoregression on log returns with analytical multi-step variance integration and half-life estimation.
  4. **Inverse-MSE Statistical Ensemble**: Combines the three constituent models using weights derived from rolling walk-forward out-of-sample Mean Squared Error.
- **Walk-Forward Out-of-Sample Validation**: Evaluates 1-step-ahead forecasts across trailing historical origins without lookahead bias, reporting RMSE, MAE (bps), MAPE (%), Directional Hit Rate (%), Brier Score, and 80% Interval Empirical Coverage.
- **Volatility, Tail-Risk & Regime Diagnostics**:
  - Close-to-Close Annualized Volatility, RiskMetrics EWMA Volatility, Parkinson High-Low Extreme Value Volatility, Garman-Klass OHLC Volatility, and Wilder ATR(14).
  - Rescaled-Range (R/S) Hurst Exponent $H$, Lo-MacKinlay Variance Ratio $VR(4)$, Ljung-Box $Q(5)$ serial autocorrelation, and Jarque-Bera normality testing.
  - Parametric 95% Horizon Value-at-Risk ($\text{VaR}_{95\%}$), Expected Shortfall ($\text{CVaR}_{95\%}$), and a volatility-targeted position sizing calculator.

## Commands

```bash
npm install
npm test
npm run build
npm run dev
```
