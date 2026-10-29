import {
  linearRegression,
  mean,
  normalCdf,
  normalInv,
  sampleStdev,
  sampleVariance,
  studentTCdf,
  studentTInv,
} from "./math";

export interface Candle {
  /** Unix timestamp in seconds (UTC) */
  time: number;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
}

export type IntervalKey = "5m" | "15m" | "1h" | "4h" | "1d";

export const INTERVAL_SECONDS: Record<IntervalKey, number> = {
  "5m": 300,
  "15m": 900,
  "1h": 3600,
  "4h": 14400,
  "1d": 86400,
};

export const BARS_PER_YEAR: Record<IntervalKey, number> = {
  "5m": (365 * 86400) / 300,
  "15m": (365 * 86400) / 900,
  "1h": (365 * 86400) / 3600,
  "4h": (365 * 86400) / 14400,
  "1d": 365,
};

export type ForecastModelId = "ensemble" | "ols_drift" | "ewma_holt" | "ar1_ou";

export interface ForecastPoint {
  step: number;
  time: number;
  mean: number;
  q05: number;
  q95: number;
  q25: number;
  q75: number;
  logReturnMean: number;
  logReturnStd: number;
  probUp: number;
}

export interface WalkForwardResult {
  modelId: ForecastModelId;
  modelName: string;
  evaluations: number;
  rmsePrice: number;
  maeReturnBps: number;
  mapePercent: number;
  directionalHitRate: number;
  brierScore: number;
  coverage80: number;
  weight: number;
}

export interface IndicatorPoint {
  time: number;
  ema20: number | null;
  ema50: number | null;
  bbUpper: number | null;
  bbMiddle: number | null;
  bbLower: number | null;
  vwap: number | null;
  rsi14: number | null;
}

export interface DescriptiveStats {
  sampleSize: number;
  lastClose: number;
  periodReturnPct: number;
  meanLogReturnBps: number;
  perBarVolPct: number;
  annualizedCloseVolPct: number;
  ewmaBarVolPct: number;
  annualizedEwmaVolPct: number;
  parkinsonAnnualVolPct: number;
  garmanKlassAnnualVolPct: number;
  skewness: number;
  excessKurtosis: number;
  jarqueBeraStat: number;
  jarqueBeraPValue: number;
  autocorrLag1: number;
  autocorrLag2: number;
  autocorrLag5: number;
  ljungBoxQ5: number;
  hurstExponent: number;
  varianceRatio4: number;
  regimeLabel: "MEAN-REVERTING" | "RANDOM WALK" | "PERSISTENT TREND";
  rsi14: number;
  atr14: number;
  atrPct: number;
  bollingerZScore: number;
  vwapDeviationPct: number;
  olsSlopeBpsPerBar: number;
  olsSlopeTStat: number;
  olsSlopePValue: number;
  olsRSquared: number;
  ar1Phi: number;
  ar1InterceptBps: number;
  halfLifeBars: number | null;
  var95HorizonPct: number;
  cvar95HorizonPct: number;
}

export interface StatisticalAnalysis {
  stats: DescriptiveStats;
  indicators: IndicatorPoint[];
  forecasts: Record<ForecastModelId, ForecastPoint[]>;
  backtests: WalkForwardResult[];
  returnHistogram: { binStartPct: number; binEndPct: number; count: number; normalExpected: number }[];
}

export function computeLogReturns(candles: readonly Candle[]): number[] {
  const out: number[] = [];
  for (let i = 1; i < candles.length; i++) {
    const prev = candles[i - 1].close;
    const curr = candles[i].close;
    if (prev > 0 && curr > 0) {
      out.push(Math.log(curr / prev));
    } else {
      out.push(0);
    }
  }
  return out;
}

export function computeEWMAVarianceSeries(returns: readonly number[], lambda = 0.94): number[] {
  if (returns.length === 0) return [];
  const initCount = Math.min(20, returns.length);
  const initSlice = returns.slice(0, initCount);
  let v = sampleVariance(initSlice);
  if (!Number.isFinite(v) || v <= 0) v = returns[0] * returns[0] || 1e-8;
  const series: number[] = [v];
  for (let i = 1; i < returns.length; i++) {
    const r = returns[i - 1];
    v = lambda * v + (1 - lambda) * r * r;
    series.push(v);
  }
  return series;
}

export function computeParkinsonVolatility(candles: readonly Candle[], barsPerYear: number): number {
  if (candles.length === 0) return 0;
  const factor = 1 / (4 * candles.length * Math.LN2);
  let sum = 0;
  for (const c of candles) {
    if (c.high > 0 && c.low > 0) {
      const hl = Math.log(c.high / c.low);
      sum += hl * hl;
    }
  }
  return Math.sqrt(factor * sum * barsPerYear);
}

export function computeGarmanKlassVolatility(candles: readonly Candle[], barsPerYear: number): number {
  if (candles.length === 0) return 0;
  const coeff = 2 * Math.LN2 - 1;
  let sum = 0;
  for (const c of candles) {
    if (c.high > 0 && c.low > 0 && c.open > 0 && c.close > 0) {
      const hl = Math.log(c.high / c.low);
      const co = Math.log(c.close / c.open);
      sum += 0.5 * hl * hl - coeff * co * co;
    }
  }
  const variance = Math.max(0, sum / candles.length);
  return Math.sqrt(variance * barsPerYear);
}

export function computeAutocorrelation(values: readonly number[], lag: number): number {
  const n = values.length;
  if (n <= lag + 2) return 0;
  const m = mean(values);
  let num = 0;
  let den = 0;
  for (let i = 0; i < n; i++) {
    const d = values[i] - m;
    den += d * d;
    if (i >= lag) {
      num += d * (values[i - lag] - m);
    }
  }
  return den === 0 ? 0 : num / den;
}

export function computeHurstExponent(returns: readonly number[]): number {
  const n = returns.length;
  if (n < 32) return 0.5;
  const subSizes = [16, 32, 64, 128].filter((s) => s <= n);
  if (subSizes.length < 2) return 0.5;
  const logN: number[] = [];
  const logRS: number[] = [];

  for (const size of subSizes) {
    const numBlocks = Math.floor(n / size);
    if (numBlocks < 1) continue;
    let rsSum = 0;
    let validBlocks = 0;
    for (let b = 0; b < numBlocks; b++) {
      const block = returns.slice(b * size, (b + 1) * size);
      const m = mean(block);
      const s = sampleStdev(block);
      if (!Number.isFinite(s) || s <= 0) continue;
      let cum = 0;
      let minCum = 0;
      let maxCum = 0;
      for (const r of block) {
        cum += r - m;
        if (cum < minCum) minCum = cum;
        if (cum > maxCum) maxCum = cum;
      }
      const range = maxCum - minCum;
      if (range > 0) {
        rsSum += range / s;
        validBlocks++;
      }
    }
    if (validBlocks > 0) {
      logN.push(Math.log(size));
      logRS.push(Math.log(rsSum / validBlocks));
    }
  }

  if (logN.length < 2) return 0.5;
  let mx = 0;
  let my = 0;
  for (let i = 0; i < logN.length; i++) {
    mx += logN[i];
    my += logRS[i];
  }
  mx /= logN.length;
  my /= logRS.length;
  let sxx = 0;
  let sxy = 0;
  for (let i = 0; i < logN.length; i++) {
    sxx += (logN[i] - mx) * (logN[i] - mx);
    sxy += (logN[i] - mx) * (logRS[i] - my);
  }
  if (sxx === 0) return 0.5;
  const h = sxy / sxx;
  return Math.max(0.1, Math.min(0.9, h));
}

export function computeVarianceRatio(returns: readonly number[], q = 4): number {
  const n = returns.length;
  if (n < q * 4) return 1;
  const var1 = sampleVariance(returns);
  if (!Number.isFinite(var1) || var1 <= 0) return 1;
  const qReturns: number[] = [];
  for (let i = q - 1; i < n; i++) {
    let s = 0;
    for (let k = 0; k < q; k++) s += returns[i - k];
    qReturns.push(s);
  }
  const varQ = sampleVariance(qReturns);
  return varQ / (q * var1);
}

export function computeIndicators(candles: readonly Candle[]): IndicatorPoint[] {
  const n = candles.length;
  const out: IndicatorPoint[] = [];
  const k20 = 2 / (20 + 1);
  const k50 = 2 / (50 + 1);
  let ema20: number | null = null;
  let ema50: number | null = null;
  let avgGain = 0;
  let avgLoss = 0;
  let cumPV = 0;
  let cumVol = 0;

  for (let i = 0; i < n; i++) {
    const c = candles[i];
    const typical = (c.high + c.low + c.close) / 3;
    cumPV += typical * c.volume;
    cumVol += c.volume;
    const vwap = cumVol > 0 ? cumPV / cumVol : c.close;

    if (ema20 === null) ema20 = c.close;
    else ema20 = c.close * k20 + ema20 * (1 - k20);

    if (ema50 === null) ema50 = c.close;
    else ema50 = c.close * k50 + ema50 * (1 - k50);

    let bbMiddle: number | null = null;
    let bbUpper: number | null = null;
    let bbLower: number | null = null;
    if (i >= 19) {
      const slice = candles.slice(i - 19, i + 1).map((x) => x.close);
      const m = mean(slice);
      const sd = sampleStdev(slice);
      bbMiddle = m;
      bbUpper = m + 2 * sd;
      bbLower = m - 2 * sd;
    }

    let rsi14: number | null = null;
    if (i > 0) {
      const diff = c.close - candles[i - 1].close;
      const gain = diff > 0 ? diff : 0;
      const loss = diff < 0 ? -diff : 0;
      if (i <= 14) {
        avgGain += gain / 14;
        avgLoss += loss / 14;
        if (i === 14) {
          const rs = avgLoss === 0 ? 100 : avgGain / avgLoss;
          rsi14 = 100 - 100 / (1 + rs);
        }
      } else {
        avgGain = (avgGain * 13 + gain) / 14;
        avgLoss = (avgLoss * 13 + loss) / 14;
        const rs = avgLoss === 0 ? 100 : avgGain / avgLoss;
        rsi14 = 100 - 100 / (1 + rs);
      }
    }

    out.push({
      time: c.time,
      ema20,
      ema50: i >= 10 ? ema50 : null,
      bbUpper,
      bbMiddle,
      bbLower,
      vwap,
      rsi14,
    });
  }
  return out;
}

/**
 * Model 1: Log-Linear OLS Drift + Student-t Prediction Intervals.
 * Fits y_t = ln(C_t) on local window of length L and projects h steps ahead
 * combining regression uncertainty and random-walk innovation variance.
 */
function forecastOlsDrift(
  candles: readonly Candle[],
  returns: readonly number[],
  horizon: number,
  stepSeconds: number,
  lookback = 60,
): ForecastPoint[] {
  const n = candles.length;
  const win = Math.min(lookback, n);
  const slice = candles.slice(n - win);
  const x: number[] = [];
  const y: number[] = [];
  for (let i = 0; i < slice.length; i++) {
    x.push(i);
    y.push(Math.log(slice[i].close));
  }
  const fit = linearRegression(x, y);
  const recentReturns = returns.slice(Math.max(0, returns.length - win));
  const sigmaEps = sampleStdev(recentReturns);
  const lastCandle = candles[n - 1];
  const lastLogPrice = Math.log(lastCandle.close);
  const df = Math.max(4, win - 2);
  const t95 = studentTInv(0.95, df);
  const t75 = studentTInv(0.75, df);

  // Shrink raw OLS slope toward mean log return to prevent overfitting short windows
  const shrinkage = 0.55;
  const driftPerBar = shrinkage * fit.slope + (1 - shrinkage) * mean(recentReturns);

  const points: ForecastPoint[] = [];
  for (let h = 1; h <= horizon; h++) {
    const xFuture = win - 1 + h;
    const regVar =
      (fit.residualStdError * fit.residualStdError) *
      (1 / win + ((xFuture - fit.meanX) * (xFuture - fit.meanX)) / fit.sxx);
    const innovVar = sigmaEps * sigmaEps * h;
    const totalStd = Math.sqrt( innovVar + 0.25 * regVar );
    const muLog = lastLogPrice + driftPerBar * h;
    const logReturnMean = driftPerBar * h;
    const probUp = studentTCdf(logReturnMean / (totalStd || 1e-8), df);

    points.push({
      step: h,
      time: lastCandle.time + h * stepSeconds,
      mean: Math.exp(muLog + 0.5 * totalStd * totalStd),
      q05: Math.exp(muLog - t95 * totalStd),
      q95: Math.exp(muLog + t95 * totalStd),
      q25: Math.exp(muLog - t75 * totalStd),
      q75: Math.exp(muLog + t75 * totalStd),
      logReturnMean,
      logReturnStd: totalStd,
      probUp,
    });
  }
  return points;
}

/**
 * Model 2: Damped Holt Double Exponential Smoothing on log prices
 * paired with RiskMetrics EWMA conditional volatility (\lambda = 0.94).
 */
function forecastEwmaHolt(
  candles: readonly Candle[],
  returns: readonly number[],
  horizon: number,
  stepSeconds: number,
): ForecastPoint[] {
  const n = candles.length;
  const alpha = 0.28;
  const beta = 0.08;
  const phi = 0.88; // trend damping parameter

  let level = Math.log(candles[0].close);
  let trend = n > 1 ? Math.log(candles[1].close / candles[0].close) : 0;

  for (let i = 1; i < n; i++) {
    const y = Math.log(candles[i].close);
    const prevLevel = level;
    level = alpha * y + (1 - alpha) * (prevLevel + phi * trend);
    trend = beta * (level - prevLevel) + (1 - beta) * phi * trend;
  }

  const ewmaVars = computeEWMAVarianceSeries(returns, 0.94);
  const lastVar = ewmaVars.length > 0 ? ewmaVars[ewmaVars.length - 1] : sampleVariance(returns);
  const longRunVar = sampleVariance(returns);
  const persistence = 0.96;

  const lastCandle = candles[n - 1];
  const lastLogPrice = Math.log(lastCandle.close);
  const z95 = normalInv(0.95);
  const z75 = normalInv(0.75);

  const points: ForecastPoint[] = [];
  let cumulativeVar = 0;
  let dampedSum = 0;
  let phiPower = 1;

  for (let h = 1; h <= horizon; h++) {
    phiPower *= phi;
    dampedSum += phiPower;
    const stepVar = longRunVar + Math.pow(persistence, h) * (lastVar - longRunVar);
    cumulativeVar += Math.max(1e-10, stepVar);
    const stdH = Math.sqrt(cumulativeVar);
    const logReturnMean = trend * dampedSum;
    const muLog = lastLogPrice + logReturnMean;
    const probUp = normalCdf(logReturnMean / (stdH || 1e-8));

    points.push({
      step: h,
      time: lastCandle.time + h * stepSeconds,
      mean: Math.exp(muLog + 0.5 * cumulativeVar),
      q05: Math.exp(muLog - z95 * stdH),
      q95: Math.exp(muLog + z95 * stdH),
      q25: Math.exp(muLog - z75 * stdH),
      q75: Math.exp(muLog + z75 * stdH),
      logReturnMean,
      logReturnStd: stdH,
      probUp,
    });
  }
  return points;
}

/**
 * Model 3: AR(1) / Ornstein-Uhlenbeck Return Process.
 * Fits r_t = c + \phi r_{t-1} + \epsilon_t by OLS and analytically integrates
 * multi-step return expectation and variance.
 */
function forecastAr1Ou(
  candles: readonly Candle[],
  returns: readonly number[],
  horizon: number,
  stepSeconds: number,
): { points: ForecastPoint[]; phi: number; intercept: number } {
  const m = returns.length;
  const x = returns.slice(0, m - 1);
  const y = returns.slice(1);
  const fit = linearRegression(x, y);
  const phi = Math.max(-0.85, Math.min(0.85, fit.slope));
  const intercept = fit.intercept;
  const muUncond = Math.abs(1 - phi) > 1e-4 ? intercept / (1 - phi) : mean(returns);
  const sigmaEps = fit.residualStdError;
  const lastReturn = returns[m - 1];
  const lastCandle = candles[candles.length - 1];
  const lastLogPrice = Math.log(lastCandle.close);
  const z95 = normalInv(0.95);
  const z75 = normalInv(0.75);

  const points: ForecastPoint[] = [];
  let cumMean = 0;

  for (let h = 1; h <= horizon; h++) {
    const expectedStepReturn = muUncond + Math.pow(phi, h) * (lastReturn - muUncond);
    cumMean += expectedStepReturn;

    // Multi-step cumulative variance of AR(1) sum_{j=1..h} r_{t+j}
    let cumVar = 0;
    for (let j = 1; j <= h; j++) {
      const psi = Math.abs(1 - phi) > 1e-4 ? (1 - Math.pow(phi, h - j + 1)) / (1 - phi) : h - j + 1;
      cumVar += psi * psi * sigmaEps * sigmaEps;
    }
    const stdH = Math.sqrt(Math.max(1e-10, cumVar));
    const muLog = lastLogPrice + cumMean;
    const probUp = normalCdf(cumMean / stdH);

    points.push({
      step: h,
      time: lastCandle.time + h * stepSeconds,
      mean: Math.exp(muLog + 0.5 * cumVar),
      q05: Math.exp(muLog - z95 * stdH),
      q95: Math.exp(muLog + z95 * stdH),
      q25: Math.exp(muLog - z75 * stdH),
      q75: Math.exp(muLog + z75 * stdH),
      logReturnMean: cumMean,
      logReturnStd: stdH,
      probUp,
    });
  }
  return { points, phi, intercept };
}

/**
 * Walk-forward out-of-sample evaluation across the historical candle series.
 * Evaluates 1-step-ahead forecasts over the last K origins without lookahead.
 */
function runWalkForwardBacktest(candles: readonly Candle[], stepSeconds: number): WalkForwardResult[] {
  const n = candles.length;
  const evalCount = Math.min(36, Math.max(10, Math.floor(n / 4)));
  const startIdx = n - evalCount;

  type Acc = {
    sqErrPrice: number;
    absErrBps: number;
    absPctErr: number;
    hits: number;
    brierSum: number;
    in80: number;
    count: number;
  };

  const initAcc = (): Acc => ({
    sqErrPrice: 0,
    absErrBps: 0,
    absPctErr: 0,
    hits: 0,
    brierSum: 0,
    in80: 0,
    count: 0,
  });

  const accMap: Record<ForecastModelId, Acc> = {
    ols_drift: initAcc(),
    ewma_holt: initAcc(),
    ar1_ou: initAcc(),
    ensemble: initAcc(),
  };

  for (let idx = startIdx; idx < n; idx++) {
    const trainCandles = candles.slice(0, idx);
    if (trainCandles.length < 35) continue;
    const trainReturns = computeLogReturns(trainCandles);
    const actualCandle = candles[idx];
    const prevClose = trainCandles[trainCandles.length - 1].close;
    const actualReturn = Math.log(actualCandle.close / prevClose);
    const actualUp = actualCandle.close > prevClose ? 1 : 0;

    const pOls = forecastOlsDrift(trainCandles, trainReturns, 1, stepSeconds)[0];
    const pHolt = forecastEwmaHolt(trainCandles, trainReturns, 1, stepSeconds)[0];
    const pAr1 = forecastAr1Ou(trainCandles, trainReturns, 1, stepSeconds).points[0];

    const logMeanEns = (pOls.logReturnMean + pHolt.logReturnMean + pAr1.logReturnMean) / 3;
    const logStdEns = Math.sqrt(
      (pOls.logReturnStd * pOls.logReturnStd +
        pHolt.logReturnStd * pHolt.logReturnStd +
        pAr1.logReturnStd * pAr1.logReturnStd) /
        3,
    );
    const muLogEns = Math.log(prevClose) + logMeanEns;
    const pEns: ForecastPoint = {
      step: 1,
      time: actualCandle.time,
      mean: Math.exp(muLogEns + 0.5 * logStdEns * logStdEns),
      q05: Math.exp(muLogEns - 1.64485 * logStdEns),
      q95: Math.exp(muLogEns + 1.64485 * logStdEns),
      q25: Math.exp(muLogEns - 0.67449 * logStdEns),
      q75: Math.exp(muLogEns + 0.67449 * logStdEns),
      logReturnMean: logMeanEns,
      logReturnStd: logStdEns,
      probUp: (pOls.probUp + pHolt.probUp + pAr1.probUp) / 3,
    };

    const candidates: [ForecastModelId, ForecastPoint][] = [
      ["ols_drift", pOls],
      ["ewma_holt", pHolt],
      ["ar1_ou", pAr1],
      ["ensemble", pEns],
    ];

    for (const [id, pred] of candidates) {
      const a = accMap[id];
      const priceDiff = pred.mean - actualCandle.close;
      a.sqErrPrice += priceDiff * priceDiff;
      a.absErrBps += Math.abs(pred.logReturnMean - actualReturn) * 10000;
      a.absPctErr += (Math.abs(priceDiff) / actualCandle.close) * 100;
      const predSign = pred.logReturnMean >= 0 ? 1 : -1;
      const actSign = actualReturn >= 0 ? 1 : -1;
      if (predSign === actSign) a.hits += 1;
      const brier = (pred.probUp - actualUp) * (pred.probUp - actualUp);
      a.brierSum += brier;
      const lo80 = Math.exp(Math.log(prevClose) + pred.logReturnMean - 1.28155 * pred.logReturnStd);
      const hi80 = Math.exp(Math.log(prevClose) + pred.logReturnMean + 1.28155 * pred.logReturnStd);
      if (actualCandle.close >= lo80 && actualCandle.close <= hi80) a.in80 += 1;
      a.count += 1;
    }
  }

  const invMseOls = 1 / Math.max(1e-12, accMap.ols_drift.sqErrPrice / Math.max(1, accMap.ols_drift.count));
  const invMseHolt = 1 / Math.max(1e-12, accMap.ewma_holt.sqErrPrice / Math.max(1, accMap.ewma_holt.count));
  const invMseAr1 = 1 / Math.max(1e-12, accMap.ar1_ou.sqErrPrice / Math.max(1, accMap.ar1_ou.count));
  const invSum = invMseOls + invMseHolt + invMseAr1;

  const weights: Record<ForecastModelId, number> = {
    ols_drift: invMseOls / invSum,
    ewma_holt: invMseHolt / invSum,
    ar1_ou: invMseAr1 / invSum,
    ensemble: 1,
  };

  const names: Record<ForecastModelId, string> = {
    ensemble: "Inverse-MSE Statistical Ensemble",
    ols_drift: "Log-Linear OLS Drift + Student-t",
    ewma_holt: "Damped Holt + EWMA Volatility",
    ar1_ou: "AR(1) Ornstein-Uhlenbeck Process",
  };

  const order: ForecastModelId[] = ["ensemble", "ols_drift", "ewma_holt", "ar1_ou"];
  return order.map((id) => {
    const a = accMap[id];
    const c = Math.max(1, a.count);
    return {
      modelId: id,
      modelName: names[id],
      evaluations: a.count,
      rmsePrice: Math.sqrt(a.sqErrPrice / c),
      maeReturnBps: a.absErrBps / c,
      mapePercent: a.absPctErr / c,
      directionalHitRate: (a.hits / c) * 100,
      brierScore: a.brierSum / c,
      coverage80: (a.in80 / c) * 100,
      weight: weights[id],
    };
  });
}

export function runStatisticalAnalysis(
  candles: readonly Candle[],
  interval: IntervalKey,
  horizon = 16,
): StatisticalAnalysis {
  if (candles.length < 40) {
    throw new Error("At least 40 OHLCV bars are required for statistical estimation.");
  }
  const stepSeconds = INTERVAL_SECONDS[interval];
  const barsPerYear = BARS_PER_YEAR[interval];
  const returns = computeLogReturns(candles);
  const nRet = returns.length;
  const meanRet = mean(returns);
  const stdRet = sampleStdev(returns);

  // Skewness and excess kurtosis
  let m3 = 0;
  let m4 = 0;
  for (const r of returns) {
    const z = (r - meanRet) / (stdRet || 1e-8);
    m3 += z * z * z;
    m4 += z * z * z * z;
  }
  const skewness = m3 / nRet;
  const excessKurtosis = m4 / nRet - 3;
  const jarqueBeraStat = (nRet / 6) * (skewness * skewness + 0.25 * excessKurtosis * excessKurtosis);
  // Chi-square(df=2) survival function is exp(-x/2)
  const jarqueBeraPValue = Math.exp(-0.5 * jarqueBeraStat);

  const acf1 = computeAutocorrelation(returns, 1);
  const acf2 = computeAutocorrelation(returns, 2);
  const acf3 = computeAutocorrelation(returns, 3);
  const acf4 = computeAutocorrelation(returns, 4);
  const acf5 = computeAutocorrelation(returns, 5);
  const ljungBoxQ5 =
    nRet *
    (nRet + 2) *
    ((acf1 * acf1) / (nRet - 1) +
      (acf2 * acf2) / (nRet - 2) +
      (acf3 * acf3) / (nRet - 3) +
      (acf4 * acf4) / (nRet - 4) +
      (acf5 * acf5) / (nRet - 5));

  const hurstExponent = computeHurstExponent(returns);
  const varianceRatio4 = computeVarianceRatio(returns, 4);

  let regimeLabel: DescriptiveStats["regimeLabel"] = "RANDOM WALK";
  if (hurstExponent < 0.46 && varianceRatio4 < 0.94) {
    regimeLabel = "MEAN-REVERTING";
  } else if (hurstExponent > 0.54 || varianceRatio4 > 1.06) {
    regimeLabel = "PERSISTENT TREND";
  }

  const ewmaVars = computeEWMAVarianceSeries(returns, 0.94);
  const ewmaBarVol = Math.sqrt(ewmaVars[ewmaVars.length - 1]);
  const parkinsonAnnual = computeParkinsonVolatility(candles, barsPerYear);
  const gkAnnual = computeGarmanKlassVolatility(candles, barsPerYear);

  // ATR(14)
  let atrSum = 0;
  const atrPeriod = Math.min(14, candles.length - 1);
  for (let i = candles.length - atrPeriod; i < candles.length; i++) {
    const c = candles[i];
    const prevClose = candles[i - 1].close;
    const tr = Math.max(c.high - c.low, Math.abs(c.high - prevClose), Math.abs(c.low - prevClose));
    atrSum += tr;
  }
  const atr14 = atrSum / atrPeriod;

  const indicators = computeIndicators(candles);
  const lastInd = indicators[indicators.length - 1];
  const lastClose = candles[candles.length - 1].close;
  const firstClose = candles[0].close;

  // Bollinger Z-score over last 20 closes
  const recent20 = candles.slice(-20).map((c) => c.close);
  const bbMean = mean(recent20);
  const bbStd = sampleStdev(recent20);
  const bollingerZScore = bbStd > 0 ? (lastClose - bbMean) / bbStd : 0;

  const vwap = lastInd.vwap ?? lastClose;
  const vwapDeviationPct = ((lastClose - vwap) / vwap) * 100;

  // OLS trend over last 60 bars
  const olsWin = Math.min(60, candles.length);
  const olsX = Array.from({ length: olsWin }, (_, idx) => idx);
  const olsY = candles.slice(-olsWin).map((c) => Math.log(c.close));
  const olsFit = linearRegression(olsX, olsY);
  const olsSlopeTStat = olsFit.slopeStdError > 0 ? olsFit.slope / olsFit.slopeStdError : 0;
  const olsSlopePValue = 2 * (1 - studentTCdf(Math.abs(olsSlopeTStat), Math.max(2, olsWin - 2)));

  // Run the three constituent models and backtest
  const olsPoints = forecastOlsDrift(candles, returns, horizon, stepSeconds, 60);
  const holtPoints = forecastEwmaHolt(candles, returns, horizon, stepSeconds);
  const ar1Res = forecastAr1Ou(candles, returns, horizon, stepSeconds);
  const backtests = runWalkForwardBacktest(candles, stepSeconds);

  const wOls = backtests.find((b) => b.modelId === "ols_drift")?.weight ?? 1 / 3;
  const wHolt = backtests.find((b) => b.modelId === "ewma_holt")?.weight ?? 1 / 3;
  const wAr1 = backtests.find((b) => b.modelId === "ar1_ou")?.weight ?? 1 / 3;

  const lastLogPrice = Math.log(lastClose);
  const z95 = normalInv(0.95);
  const z75 = normalInv(0.75);

  const ensemblePoints: ForecastPoint[] = [];
  for (let i = 0; i < horizon; i++) {
    const p1 = olsPoints[i];
    const p2 = holtPoints[i];
    const p3 = ar1Res.points[i];

    const logMean = wOls * p1.logReturnMean + wHolt * p2.logReturnMean + wAr1 * p3.logReturnMean;
    // Law of total variance across mixture of models
    const secondMoment =
      wOls * (p1.logReturnStd * p1.logReturnStd + p1.logReturnMean * p1.logReturnMean) +
      wHolt * (p2.logReturnStd * p2.logReturnStd + p2.logReturnMean * p2.logReturnMean) +
      wAr1 * (p3.logReturnStd * p3.logReturnStd + p3.logReturnMean * p3.logReturnMean);
    const logVar = Math.max(1e-10, secondMoment - logMean * logMean);
    const logStd = Math.sqrt(logVar);
    const muLog = lastLogPrice + logMean;
    const probUp = wOls * p1.probUp + wHolt * p2.probUp + wAr1 * p3.probUp;

    ensemblePoints.push({
      step: p1.step,
      time: p1.time,
      mean: Math.exp(muLog + 0.5 * logVar),
      q05: Math.exp(muLog - z95 * logStd),
      q95: Math.exp(muLog + z95 * logStd),
      q25: Math.exp(muLog - z75 * logStd),
      q75: Math.exp(muLog + z75 * logStd),
      logReturnMean: logMean,
      logReturnStd: logStd,
      probUp,
    });
  }

  const finalEns = ensemblePoints[ensemblePoints.length - 1];
  // Parametric + Cornish-Fisher adjusted 95% VaR and Expected Shortfall over horizon
  const zAlpha = 1.6448536;
  const varLog = -(finalEns.logReturnMean - zAlpha * finalEns.logReturnStd);
  const pdfAlpha = Math.exp(-0.5 * zAlpha * zAlpha) / Math.sqrt(2 * Math.PI);
  const cvarLog = -(finalEns.logReturnMean - (pdfAlpha / 0.05) * finalEns.logReturnStd);

  const halfLifeBars =
    ar1Res.phi > 0 && ar1Res.phi < 0.99 ? -Math.LN2 / Math.log(ar1Res.phi) : null;

  // Return histogram (15 bins across [mean - 3.2*sd, mean + 3.2*sd])
  const binCount = 15;
  const span = Math.max(stdRet * 3.2, 0.005);
  const minR = meanRet - span;
  const maxR = meanRet + span;
  const binWidth = (maxR - minR) / binCount;
  const returnHistogram: StatisticalAnalysis["returnHistogram"] = [];
  for (let b = 0; b < binCount; b++) {
    const lo = minR + b * binWidth;
    const hi = lo + binWidth;
    let count = 0;
    for (const r of returns) {
      if ((b === 0 && r <= hi) || (b === binCount - 1 && r >= lo) || (r >= lo && r < hi)) {
        count++;
      }
    }
    const pNorm =
      normalCdf((hi - meanRet) / (stdRet || 1e-8)) - normalCdf((lo - meanRet) / (stdRet || 1e-8));
    returnHistogram.push({
      binStartPct: lo * 100,
      binEndPct: hi * 100,
      count,
      normalExpected: pNorm * nRet,
    });
  }

  return {
    stats: {
      sampleSize: candles.length,
      lastClose,
      periodReturnPct: ((lastClose - firstClose) / firstClose) * 100,
      meanLogReturnBps: meanRet * 10000,
      perBarVolPct: stdRet * 100,
      annualizedCloseVolPct: stdRet * Math.sqrt(barsPerYear) * 100,
      ewmaBarVolPct: ewmaBarVol * 100,
      annualizedEwmaVolPct: ewmaBarVol * Math.sqrt(barsPerYear) * 100,
      parkinsonAnnualVolPct: parkinsonAnnual * 100,
      garmanKlassAnnualVolPct: gkAnnual * 100,
      skewness,
      excessKurtosis,
      jarqueBeraStat,
      jarqueBeraPValue,
      autocorrLag1: acf1,
      autocorrLag2: acf2,
      autocorrLag5: acf5,
      ljungBoxQ5,
      hurstExponent,
      varianceRatio4,
      regimeLabel,
      rsi14: lastInd.rsi14 ?? 50,
      atr14,
      atrPct: (atr14 / lastClose) * 100,
      bollingerZScore,
      vwapDeviationPct,
      olsSlopeBpsPerBar: olsFit.slope * 10000,
      olsSlopeTStat,
      olsSlopePValue,
      olsRSquared: olsFit.rSquared,
      ar1Phi: ar1Res.phi,
      ar1InterceptBps: ar1Res.intercept * 10000,
      halfLifeBars,
      var95HorizonPct: Math.max(0, (1 - Math.exp(-varLog)) * 100),
      cvar95HorizonPct: Math.max(0, (1 - Math.exp(-cvarLog)) * 100),
    },
    indicators,
    forecasts: {
      ensemble: ensemblePoints,
      ols_drift: olsPoints,
      ewma_holt: holtPoints,
      ar1_ou: ar1Res.points,
    },
    backtests,
    returnHistogram,
  };
}
