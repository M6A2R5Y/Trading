#!/usr/bin/env node
/**
 * Layer 3 Deterministic Execution Script:
 * Fetches live OHLCV klines from Binance public API (data-api.binance.vision)
 * and computes verified statistical forecast parameters from the command line.
 *
 * Usage:
 *   node .agent/skills/statistical-market-forecaster/scripts/verify_forecast_cli.mjs [SYMBOL] [INTERVAL] [HORIZON]
 */

const symbol = (process.argv[2] || "BTCUSDT").toUpperCase();
const interval = process.argv[3] || "1h";
const horizon = Math.max(1, Math.min(60, Number(process.argv[4]) || 16));

async function main() {
  const url = `https://data-api.binance.vision/api/v3/klines?symbol=${encodeURIComponent(
    symbol,
  )}&interval=${encodeURIComponent(interval)}&limit=120`;

  const res = await fetch(url);
  if (!res.ok) {
    console.error(`HTTP ${res.status} fetching ${symbol} (${interval})`);
    process.exit(1);
  }
  const rows = await res.json();
  const closes = rows.map((r) => Number(r[4]));
  const n = closes.length;
  const returns = [];
  for (let i = 1; i < n; i++) {
    returns.push(Math.log(closes[i] / closes[i - 1]));
  }
  const meanRet = returns.reduce((a, b) => a + b, 0) / returns.length;
  const variance =
    returns.reduce((a, b) => a + (b - meanRet) * (b - meanRet), 0) / (returns.length - 1);
  const stdRet = Math.sqrt(variance);
  const lastClose = closes[n - 1];
  const muH = Math.log(lastClose) + meanRet * horizon;
  const stdH = stdRet * Math.sqrt(horizon);

  const summary = {
    symbol,
    interval,
    barsLoaded: n,
    lastClose,
    meanLogReturnBps: Number((meanRet * 10000).toFixed(3)),
    perBarVolPct: Number((stdRet * 100).toFixed(4)),
    horizonBars: horizon,
    expectedPrice: Number(Math.exp(muH + 0.5 * stdH * stdH).toFixed(4)),
    band90Low: Number(Math.exp(muH - 1.64485 * stdH).toFixed(4)),
    band90High: Number(Math.exp(muH + 1.64485 * stdH).toFixed(4)),
  };

  console.log(JSON.stringify(summary, null, 2));
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
