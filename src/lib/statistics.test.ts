import { describe, expect, it } from "vitest";
import fs from "node:fs";
import path from "node:path";
import {
  linearRegression,
  mean,
  normalCdf,
  normalInv,
  sampleStdev,
  studentTCdf,
  studentTInv,
} from "./math";
import {
  computeAutocorrelation,
  computeGarmanKlassVolatility,
  computeHurstExponent,
  computeLogReturns,
  computeParkinsonVolatility,
  runStatisticalAnalysis,
} from "./statistics";
import {
  generateOfflineFallbackSeries,
  getExternalPlatformLinks,
  inferDecimalsFromPrice,
  parseOhlcvCsv,
  parseSymbolMeta,
} from "./marketData";

describe("Numerical and Statistical Foundations", () => {
  it("computes normalCdf and normalInv accurately", () => {
    expect(normalCdf(0)).toBeCloseTo(0.5, 7);
    expect(normalCdf(1.95996398454)).toBeCloseTo(0.975, 6);
    expect(normalInv(0.975)).toBeCloseTo(1.95996398, 5);
    expect(normalInv(0.05)).toBeCloseTo(-1.6448536, 5);
  });

  it("computes Student-t CDF and inverse quantiles accurately", () => {
    expect(studentTCdf(0, 10)).toBeCloseTo(0.5, 7);
    const q95 = studentTInv(0.975, 20);
    expect(q95).toBeCloseTo(2.08596, 4);
    expect(studentTCdf(q95, 20)).toBeCloseTo(0.975, 6);
  });

  it("fits Ordinary Least Squares regression with exact slope and R^2", () => {
    const x = [0, 1, 2, 3, 4, 5];
    const y = x.map((v) => 2.5 + 1.75 * v);
    const fit = linearRegression(x, y);
    expect(fit.intercept).toBeCloseTo(2.5, 8);
    expect(fit.slope).toBeCloseTo(1.75, 8);
    expect(fit.rSquared).toBeCloseTo(1.0, 8);
    expect(fit.residualStdError).toBeCloseTo(0, 8);
  });

  it("produces monotonic quantiles and valid probabilities in runStatisticalAnalysis", () => {
    const series = generateOfflineFallbackSeries("BTCUSDT", "1h", 180);
    const result = runStatisticalAnalysis(series, "1h", 16);

    expect(result.stats.sampleSize).toBe(180);
    expect(result.stats.perBarVolPct).toBeGreaterThan(0);
    expect(result.stats.parkinsonAnnualVolPct).toBeGreaterThan(0);
    expect(result.stats.garmanKlassAnnualVolPct).toBeGreaterThan(0);
    expect(result.stats.hurstExponent).toBeGreaterThanOrEqual(0.1);
    expect(result.stats.hurstExponent).toBeLessThanOrEqual(0.9);

    for (const modelId of ["ensemble", "ols_drift", "ewma_holt", "ar1_ou"] as const) {
      const pts = result.forecasts[modelId];
      expect(pts).toHaveLength(16);
      for (const p of pts) {
        expect(p.q05).toBeLessThan(p.q25);
        expect(p.q25).toBeLessThan(p.mean);
        expect(p.mean).toBeLessThan(p.q75);
        expect(p.q75).toBeLessThan(p.q95);
        expect(p.probUp).toBeGreaterThan(0);
        expect(p.probUp).toBeLessThan(1);
      }
    }

    const constituentWeights = result.backtests
      .filter((b) => b.modelId !== "ensemble")
      .reduce((acc, b) => acc + b.weight, 0);
    expect(constituentWeights).toBeCloseTo(1.0, 6);
  });

  it("parses custom OHLCV CSV strings accurately", () => {
    const rows = ["timestamp,open,high,low,close,volume"];
    let price = 100;
    for (let i = 0; i < 50; i++) {
      const open = price;
      const close = price * (1 + (i % 2 === 0 ? 0.004 : -0.002));
      const high = Math.max(open, close) * 1.002;
      const low = Math.min(open, close) * 0.998;
      rows.push(`${1700000000 + i * 3600},${open},${high},${low},${close},${1000 + i * 10}`);
      price = close;
    }
    const parsed = parseOhlcvCsv(rows.join("\n"));
    expect(parsed).toHaveLength(50);
    const analysis = runStatisticalAnalysis(parsed, "1h", 8);
    expect(analysis.forecasts.ensemble).toHaveLength(8);
  });

  it("parses dynamic exchange symbols and generates Binance deep links", () => {
    const meta = parseSymbolMeta("pepeusdt", 0.000012);
    expect(meta.symbol).toBe("PEPEUSDT");
    expect(meta.baseAsset).toBe("PEPE");
    expect(meta.quoteAsset).toBe("USDT");
    expect(inferDecimalsFromPrice(0.000012)).toBe(8);

    const links = getExternalPlatformLinks(meta);
    expect(links.binanceSpot).toContain("PEPE_USDT");
    expect(links.binanceFutures).toContain("PEPEUSDT");
    expect(links.tradingView).toContain("BINANCE:PEPEUSDT");
  });

  it("validates volatility and autocorrelation helpers", () => {
    const series = generateOfflineFallbackSeries("ETHUSDT", "1h", 120);
    const rets = computeLogReturns(series);
    expect(rets).toHaveLength(119);
    expect(sampleStdev(rets)).toBeGreaterThan(0);
    expect(Math.abs(mean(rets))).toBeLessThan(0.1);
    expect(computeParkinsonVolatility(series, 8760)).toBeGreaterThan(0);
    expect(computeGarmanKlassVolatility(series, 8760)).toBeGreaterThan(0);
    expect(Math.abs(computeAutocorrelation(rets, 1))).toBeLessThan(1);
    expect(computeHurstExponent(rets)).toBeGreaterThan(0);
  });
});

describe("Strict UI, 3-Layer Skill & Android PWA Compliance Guardrails", () => {
  const rootDir = path.resolve(__dirname, "../..");
  const filesToAudit = [
    "index.html",
    "privacy.html",
    "terms.html",
    "AGENTS.md",
    ".agent/skills/statistical-market-forecaster/SKILL.md",
    ".agent/skills/statistical-market-forecaster/references/econometric_formulas.md",
    ".agent/skills/statistical-market-forecaster/scripts/verify_forecast_cli.mjs",
    "public/favicon.svg",
    "public/manifest.webmanifest",
    "public/sw.js",
    "src/styles.css",
    "src/App.tsx",
    "src/main.tsx",
    "src/components/PriceForecastChart.tsx",
    "src/components/DistributionPanel.tsx",
    "src/components/BinanceCompanionPanel.tsx",
    "src/lib/math.ts",
    "src/lib/statistics.ts",
    "src/lib/marketData.ts",
    "src/lib/format.ts",
  ];

  it("contains zero em dashes, zero emojis, and zero 'Made with AI' tags across all project files", () => {
    const emojiRegex = /[\u{1F300}-\u{1FAFF}\u{2600}-\u{27BF}]/u;
    for (const relPath of filesToAudit) {
      const fullPath = path.join(rootDir, relPath);
      expect(fs.existsSync(fullPath), `Missing file: ${relPath}`).toBe(true);
      const content = fs.readFileSync(fullPath, "utf8");
      expect(content.includes("\u2014"), `Em dash found in ${relPath}`).toBe(false);
      expect(content.includes("&mdash;"), `HTML em dash entity found in ${relPath}`).toBe(false);
      expect(emojiRegex.test(content), `Emoji character found in ${relPath}`).toBe(false);
      expect(/made with ai/i.test(content), `Made with AI tag found in ${relPath}`).toBe(false);
    }
  });

  it("contains zero purple gradients or pill-shaped border radii in styles", () => {
    const css = fs.readFileSync(path.join(rootDir, "src/styles.css"), "utf8");
    expect(/purple|violet|indigo|#7c3aed|#8b5cf6|#a855f7|#6366f1|#9333ea/i.test(css)).toBe(false);
    expect(/border-radius:\s*(9999px|999px|50px|100px)/i.test(css)).toBe(false);
  });

  it("includes favicon links, Android PWA manifest, and standalone privacy and terms pages", () => {
    for (const htmlFile of ["index.html", "privacy.html", "terms.html"]) {
      const html = fs.readFileSync(path.join(rootDir, htmlFile), "utf8");
      expect(html).toContain('rel="icon"');
      expect(html).toContain("/favicon.svg");
    }
    const indexHtml = fs.readFileSync(path.join(rootDir, "index.html"), "utf8");
    expect(indexHtml).toContain('rel="manifest"');
    expect(indexHtml).toContain("/manifest.webmanifest");
  });
});
