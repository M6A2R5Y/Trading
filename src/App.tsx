import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  Candle,
  ForecastModelId,
  INTERVAL_SECONDS,
  IntervalKey,
  runStatisticalAnalysis,
} from "./lib/statistics";
import {
  DEFAULT_INSTRUMENTS,
  fetchAllTickers24h,
  fetchKlines,
  fetchSingleTicker24h,
  generateOfflineFallbackSeries,
  inferDecimalsFromPrice,
  InstrumentMeta,
  MarketTicker24h,
  parseOhlcvCsv,
  parseSymbolMeta,
  subscribeLiveKline,
} from "./lib/marketData";
import {
  formatCompactVolume,
  formatPrice,
  formatSignedBps,
  formatSignedPct,
  formatTimestampUtc,
} from "./lib/format";
import { OverlayMode, PriceForecastChart } from "./components/PriceForecastChart";
import { DistributionPanel } from "./components/DistributionPanel";
import { BinanceCompanionPanel } from "./components/BinanceCompanionPanel";

type ActiveTab = "terminal" | "methodology" | "privacy" | "terms";
type SidebarMode = "ticket" | "schedule";
type MobilePane = "ticket" | "chart" | "watchlist" | "diagnostics";

interface PersistedPrefs {
  symbol: string;
  interval: IntervalKey;
  horizon: number;
  modelId: ForecastModelId;
  overlay: OverlayMode;
  companionMode: boolean;
  customSymbols: string[];
}

const PREFS_KEY = "tickframe_prefs_v1";

function loadPrefs(): PersistedPrefs {
  const params = new URLSearchParams(window.location.search);
  const urlMode = params.get("mode");
  const urlSymbol = params.get("symbol")?.toUpperCase();
  const urlInterval = params.get("interval") as IntervalKey | null;

  try {
    const raw = window.localStorage.getItem(PREFS_KEY);
    if (raw) {
      const parsed = JSON.parse(raw) as Partial<PersistedPrefs>;
      return {
        symbol: urlSymbol || parsed.symbol || "BTCUSDT",
        interval: urlInterval || parsed.interval || "1h",
        horizon: typeof parsed.horizon === "number" ? parsed.horizon : 16,
        modelId: parsed.modelId || "ensemble",
        overlay: parsed.overlay || "bollinger",
        companionMode:
          urlMode === "companion" || urlMode === "dock"
            ? true
            : Boolean(parsed.companionMode),
        customSymbols: Array.isArray(parsed.customSymbols) ? parsed.customSymbols : [],
      };
    }
  } catch {
    // ignore storage errors
  }
  return {
    symbol: urlSymbol || "BTCUSDT",
    interval: urlInterval || "1h",
    horizon: 16,
    modelId: "ensemble",
    overlay: "bollinger",
    companionMode: urlMode === "companion" || urlMode === "dock",
    customSymbols: [],
  };
}

export const App: React.FC = () => {
  const initialPrefs = useMemo(() => loadPrefs(), []);
  const [activeTab, setActiveTab] = useState<ActiveTab>("terminal");
  const [selectedSymbol, setSelectedSymbol] = useState<string>(initialPrefs.symbol);
  const [interval, setIntervalState] = useState<IntervalKey>(initialPrefs.interval);
  const [horizon, setHorizon] = useState<number>(initialPrefs.horizon);
  const [selectedModel, setSelectedModel] = useState<ForecastModelId>(initialPrefs.modelId);
  const [overlay, setOverlay] = useState<OverlayMode>(initialPrefs.overlay);
  const [companionMode, setCompanionMode] = useState<boolean>(initialPrefs.companionMode);
  const [sidebarMode, setSidebarMode] = useState<SidebarMode>("ticket");
  const [mobilePane, setMobilePane] = useState<MobilePane>("ticket");

  const [customSymbols, setCustomSymbols] = useState<string[]>(initialPrefs.customSymbols);
  const [searchQuery, setSearchQuery] = useState<string>("");
  const [customPairInput, setCustomPairInput] = useState<string>("");

  const [tickers, setTickers] = useState<Record<string, MarketTicker24h>>({});
  const [candles, setCandles] = useState<Candle[]>([]);
  const [feedSource, setFeedSource] = useState<"LIVE" | "CSV" | "OFFLINE">("LIVE");
  const [customCsvName, setCustomCsvName] = useState<string | null>(null);
  const [wsConnected, setWsConnected] = useState<boolean>(false);
  const [lastUpdatedUtc, setLastUpdatedUtc] = useState<number>(() => Math.floor(Date.now() / 1000));
  const [loadingSeries, setLoadingSeries] = useState<boolean>(true);
  const [csvError, setCsvError] = useState<string | null>(null);

  const [accountEquity, setAccountEquity] = useState<number>(10000);
  const [riskBudgetPct, setRiskBudgetPct] = useState<number>(1.0);

  const fileInputRef = useRef<HTMLInputElement | null>(null);

  useEffect(() => {
    try {
      const prefs: PersistedPrefs = {
        symbol: selectedSymbol,
        interval,
        horizon,
        modelId: selectedModel,
        overlay,
        companionMode,
        customSymbols,
      };
      window.localStorage.setItem(PREFS_KEY, JSON.stringify(prefs));
    } catch {
      // ignore storage quota errors
    }
  }, [selectedSymbol, interval, horizon, selectedModel, overlay, companionMode, customSymbols]);

  const allInstruments: InstrumentMeta[] = useMemo(() => {
    const baseList = [...DEFAULT_INSTRUMENTS];
    for (const sym of customSymbols) {
      if (!baseList.some((i) => i.symbol === sym)) {
        const t = tickers[sym];
        baseList.push(parseSymbolMeta(sym, t?.lastPrice ?? 100));
      }
    }
    if (!baseList.some((i) => i.symbol === selectedSymbol)) {
      const t = tickers[selectedSymbol];
      baseList.push(parseSymbolMeta(selectedSymbol, t?.lastPrice ?? 100));
    }
    return baseList;
  }, [customSymbols, tickers, selectedSymbol]);

  const activeInstrument: InstrumentMeta = useMemo(() => {
    const found = allInstruments.find((i) => i.symbol === selectedSymbol);
    if (found) return found;
    return parseSymbolMeta(selectedSymbol, candles[candles.length - 1]?.close ?? 100);
  }, [allInstruments, selectedSymbol, candles]);

  const refreshTickers = useCallback(async () => {
    try {
      const symbolsToFetch = allInstruments.map((i) => i.symbol);
      const data = await fetchAllTickers24h(symbolsToFetch);
      setTickers((prev) => ({ ...prev, ...data }));
    } catch {
      // Keep existing ticker state
    }
  }, [allInstruments]);

  useEffect(() => {
    refreshTickers();
    const timer = window.setInterval(refreshTickers, 12000);
    return () => window.clearInterval(timer);
  }, [refreshTickers]);

  const loadMarketSeries = useCallback(async (sym: string, intv: IntervalKey) => {
    setLoadingSeries(true);
    setCsvError(null);
    try {
      const klines = await fetchKlines(sym, intv, 240);
      setCandles(klines);
      setFeedSource("LIVE");
      setCustomCsvName(null);
      setLastUpdatedUtc(Math.floor(Date.now() / 1000));
    } catch {
      const fallback = generateOfflineFallbackSeries(sym, intv, 240);
      setCandles(fallback);
      setFeedSource("OFFLINE");
      setCustomCsvName(null);
      setLastUpdatedUtc(Math.floor(Date.now() / 1000));
    } finally {
      setLoadingSeries(false);
    }
  }, []);

  useEffect(() => {
    if (feedSource === "CSV") return;
    loadMarketSeries(selectedSymbol, interval);
  }, [selectedSymbol, interval, feedSource, loadMarketSeries]);

  useEffect(() => {
    if (feedSource !== "LIVE") {
      setWsConnected(false);
      return;
    }
    const unsubscribe = subscribeLiveKline(
      selectedSymbol,
      interval,
      (liveCandle) => {
        setCandles((prev) => {
          if (prev.length === 0) return [liveCandle];
          const last = prev[prev.length - 1];
          if (liveCandle.time === last.time) {
            const next = prev.slice();
            next[next.length - 1] = liveCandle;
            return next;
          }
          if (liveCandle.time > last.time) {
            return [...prev.slice(1), liveCandle];
          }
          return prev;
        });
        setLastUpdatedUtc(Math.floor(Date.now() / 1000));
      },
      (connected) => setWsConnected(connected),
    );
    return unsubscribe;
  }, [selectedSymbol, interval, feedSource]);

  const handleSelectInstrument = (symbol: string) => {
    setFeedSource("LIVE");
    setCustomCsvName(null);
    setSelectedSymbol(symbol);
    setActiveTab("terminal");
  };

  const handleAddCustomPair = async (e: React.FormEvent) => {
    e.preventDefault();
    const raw = customPairInput.trim().toUpperCase().replace(/[^A-Z0-9]/g, "");
    if (!raw) return;
    const normalized =
      raw.endsWith("USDT") ||
      raw.endsWith("FDUSD") ||
      raw.endsWith("USDC") ||
      raw.endsWith("BTC")
        ? raw
        : `${raw}USDT`;

    setCsvError(null);
    try {
      const ticker = await fetchSingleTicker24h(normalized);
      setTickers((prev) => ({ ...prev, [normalized]: ticker }));
      if (!customSymbols.includes(normalized)) {
        setCustomSymbols((prev) => [...prev, normalized]);
      }
      setSelectedSymbol(normalized);
      setFeedSource("LIVE");
      setCustomPairInput("");
    } catch {
      // Allow adding even if offline by falling back gracefully
      if (!customSymbols.includes(normalized)) {
        setCustomSymbols((prev) => [...prev, normalized]);
      }
      setSelectedSymbol(normalized);
      setCustomPairInput("");
    }
  };

  const handleCsvUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => {
      try {
        const text = String(reader.result || "");
        const parsed = parseOhlcvCsv(text);
        setCandles(parsed);
        setFeedSource("CSV");
        setCustomCsvName(file.name);
        setCsvError(null);
        setLastUpdatedUtc(Math.floor(Date.now() / 1000));
      } catch (err) {
        setCsvError(err instanceof Error ? err.message : "Failed to parse CSV file.");
      }
    };
    reader.readAsText(file);
    e.target.value = "";
  };

  const analysis = useMemo(() => {
    if (candles.length < 40) return null;
    try {
      return runStatisticalAnalysis(candles, interval, horizon);
    } catch {
      return null;
    }
  }, [candles, interval, horizon]);

  const activeForecast = useMemo(() => {
    if (!analysis) return [];
    return analysis.forecasts[selectedModel] ?? analysis.forecasts.ensemble;
  }, [analysis, selectedModel]);

  const terminalForecastPoint = useMemo(() => {
    if (activeForecast.length === 0) return null;
    return activeForecast[activeForecast.length - 1];
  }, [activeForecast]);

  const filteredInstruments = useMemo(() => {
    const q = searchQuery.trim().toLowerCase();
    if (!q) return allInstruments;
    return allInstruments.filter(
      (i) =>
        i.symbol.toLowerCase().includes(q) ||
        i.displayName.toLowerCase().includes(q) ||
        i.category.toLowerCase().includes(q),
    );
  }, [allInstruments, searchQuery]);

  const currentTicker: MarketTicker24h | undefined = tickers[selectedSymbol];
  const lastClose = analysis?.stats.lastClose ?? candles[candles.length - 1]?.close ?? 0;

  const priceDecimals = useMemo(() => {
    if (feedSource === "CSV" || !DEFAULT_INSTRUMENTS.some((d) => d.symbol === selectedSymbol)) {
      return inferDecimalsFromPrice(lastClose);
    }
    return activeInstrument.decimals;
  }, [feedSource, selectedSymbol, lastClose, activeInstrument.decimals]);

  const livePricesBySymbol = useMemo(() => {
    const map: Record<string, number> = {};
    for (const [sym, t] of Object.entries(tickers)) {
      map[sym] = t.lastPrice;
    }
    if (lastClose > 0) {
      map[selectedSymbol] = lastClose;
    }
    return map;
  }, [tickers, selectedSymbol, lastClose]);

  return (
    <div className={`app-shell ${companionMode ? "shell-companion" : ""}`}>
      <header className="terminal-topbar">
        <div className="topbar-brand">
          <button
            type="button"
            className="brand-link brand-btn"
            onClick={() => setActiveTab("terminal")}
          >
            <span className="brand-square" />
            <span className="brand-title">TICKFRAME</span>
            <span className="brand-sub">
              {companionMode
                ? "BINANCE & ANDROID COMPANION"
                : "QUANTITATIVE TELEMETRY & ECONOMETRIC ENGINE"}
            </span>
          </button>
        </div>

        <div className="topbar-controls">
          <form className="quick-pair-form" onSubmit={handleAddCustomPair}>
            <input
              type="text"
              value={customPairInput}
              onChange={(e) => setCustomPairInput(e.target.value)}
              placeholder="Any pair (e.g. PEPEUSDT)"
              className="terminal-input quick-pair-input"
              aria-label="Load any Binance ticker symbol"
            />
            <button type="submit" className="action-btn">
              LOAD PAIR
            </button>
          </form>

          <div className="control-group" role="group" aria-label="Bar Interval">
            <span className="control-label">INTV</span>
            {(["5m", "15m", "1h", "4h", "1d"] as IntervalKey[]).map((intv) => (
              <button
                key={intv}
                type="button"
                className={`seg-btn ${interval === intv ? "seg-btn-active" : ""}`}
                onClick={() => {
                  setIntervalState(intv);
                  setActiveTab("terminal");
                }}
              >
                {intv.toUpperCase()}
              </button>
            ))}
          </div>

          <div className="control-group" role="group" aria-label="Forecast Horizon">
            <span className="control-label">HORIZON</span>
            {[8, 16, 24, 36].map((h) => (
              <button
                key={h}
                type="button"
                className={`seg-btn ${horizon === h ? "seg-btn-active" : ""}`}
                onClick={() => {
                  setHorizon(h);
                  setActiveTab("terminal");
                }}
              >
                +{h}B
              </button>
            ))}
          </div>

          {!companionMode && (
            <div className="control-group" role="group" aria-label="Chart Overlay">
              <span className="control-label">OVERLAY</span>
              {(
                [
                  ["bollinger", "BB(20,2)"],
                  ["ema", "EMA(20/50)"],
                  ["vwap", "VWAP"],
                  ["none", "NONE"],
                ] as [OverlayMode, string][]
              ).map(([mode, label]) => (
                <button
                  key={mode}
                  type="button"
                  className={`seg-btn ${overlay === mode ? "seg-btn-active" : ""}`}
                  onClick={() => setOverlay(mode)}
                >
                  {label}
                </button>
              ))}
            </div>
          )}

          <div className="control-group">
            <button
              type="button"
              className={`action-btn ${companionMode ? "action-btn-active" : ""}`}
              onClick={() => setCompanionMode((prev) => !prev)}
              title="Toggle compact side-by-side layout for Android Split-Screen or desktop Binance dock"
            >
              {companionMode ? "EXIT SPLIT DOCK" : "SPLIT / ANDROID DOCK"}
            </button>
            <input
              ref={fileInputRef}
              type="file"
              accept=".csv,text/csv"
              className="sr-only-input"
              onChange={handleCsvUpload}
              aria-label="Upload OHLCV CSV file"
            />
            <button
              type="button"
              className="action-btn"
              onClick={() => fileInputRef.current?.click()}
            >
              CSV
            </button>
            {feedSource === "CSV" && (
              <button
                type="button"
                className="action-btn"
                onClick={() => {
                  setFeedSource("LIVE");
                  loadMarketSeries(selectedSymbol, interval);
                }}
              >
                LIVE
              </button>
            )}
          </div>
        </div>

        <nav className="topbar-nav" aria-label="Workspace Navigation">
          <div className="feed-indicator">
            <span
              className={`status-dot ${
                feedSource === "LIVE" && wsConnected
                  ? "dot-live"
                  : feedSource === "CSV"
                  ? "dot-csv"
                  : "dot-fallback"
              }`}
            />
            <span className="feed-text">
              {feedSource === "LIVE"
                ? wsConnected
                  ? "BINANCE WS LIVE"
                  : "BINANCE REST"
                : feedSource === "CSV"
                ? `CSV: ${customCsvName}`
                : "OFFLINE SYNTHETIC"}
            </span>
          </div>
          <button
            type="button"
            className={`nav-btn ${activeTab === "terminal" ? "nav-btn-active" : ""}`}
            onClick={() => setActiveTab("terminal")}
          >
            Terminal
          </button>
          <button
            type="button"
            className={`nav-btn ${activeTab === "methodology" ? "nav-btn-active" : ""}`}
            onClick={() => setActiveTab("methodology")}
          >
            3-Layer &amp; Math
          </button>
          <button
            type="button"
            className={`nav-btn ${activeTab === "privacy" ? "nav-btn-active" : ""}`}
            onClick={() => setActiveTab("privacy")}
          >
            Privacy
          </button>
          <button
            type="button"
            className={`nav-btn ${activeTab === "terms" ? "nav-btn-active" : ""}`}
            onClick={() => setActiveTab("terms")}
          >
            Terms
          </button>
        </nav>
      </header>

      {csvError && (
        <div className="error-banner" role="alert">
          <span>INPUT ERROR: {csvError}</span>
          <button type="button" className="banner-close" onClick={() => setCsvError(null)}>
            DISMISS
          </button>
        </div>
      )}

      {activeTab === "terminal" && (
        <>
          {/* ANDROID / COMPACT QUICK PAIR SWITCHER STRIP */}
          <div className="mobile-pair-ribbon" aria-label="Quick Pair Switcher">
            {allInstruments.map((inst) => {
              const active = feedSource !== "CSV" && inst.symbol === selectedSymbol;
              const t = tickers[inst.symbol];
              const chg = t?.priceChangePercent ?? 0;
              return (
                <button
                  key={inst.symbol}
                  type="button"
                  className={`ribbon-pair-btn ${active ? "ribbon-pair-active" : ""}`}
                  onClick={() => handleSelectInstrument(inst.symbol)}
                >
                  <span className="ribbon-sym">{inst.baseAsset}</span>
                  {t && (
                    <span className={chg >= 0 ? "val-pos" : "val-neg"}>
                      {formatSignedPct(chg, 1)}
                    </span>
                  )}
                </button>
              );
            })}
          </div>

          <main
            className={`workspace-grid ${
              companionMode ? "workspace-companion" : ""
            } mobile-pane-${mobilePane}`}
          >
            {/* LEFT COLUMN: MARKET WATCHLIST & REGIME DIAGNOSTICS */}
            <aside className="panel watchlist-panel" aria-label="Market Watchlist">
              <div className="panel-header">
                <span className="panel-title">EXCHANGE WATCHLIST (24H)</span>
                <span className="panel-meta">{allInstruments.length} PAIRS</span>
              </div>
              <div className="watchlist-search">
                <input
                  type="search"
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  placeholder="Filter watchlist..."
                  className="terminal-input"
                  aria-label="Filter instruments"
                />
              </div>
              <div className="watchlist-table-wrap">
                <table className="terminal-table watchlist-table">
                  <thead>
                    <tr>
                      <th>PAIR</th>
                      <th className="num-col">LAST</th>
                      <th className="num-col">24H %</th>
                      <th className="num-col">SPREAD</th>
                    </tr>
                  </thead>
                  <tbody>
                    {filteredInstruments.map((inst) => {
                      const t = tickers[inst.symbol];
                      const isSelected = feedSource !== "CSV" && inst.symbol === selectedSymbol;
                      const price = t ? t.lastPrice : isSelected ? lastClose : 0;
                      const chg = t ? t.priceChangePercent : 0;
                      const spread = t ? t.spreadBps : 0;
                      const d = inferDecimalsFromPrice(price || inst.tickSize);
                      return (
                        <tr
                          key={inst.symbol}
                          className={`clickable-row ${isSelected ? "row-selected" : ""}`}
                          onClick={() => handleSelectInstrument(inst.symbol)}
                        >
                          <td>
                            <div className="sym-cell">
                              <span className="sym-code">
                                {inst.baseAsset}/{inst.quoteAsset}
                              </span>
                              <span className="sym-name">{inst.displayName}</span>
                            </div>
                          </td>
                          <td className="num-col mono-cell">
                            {price > 0 ? formatPrice(price, d) : "..."}
                          </td>
                          <td
                            className={`num-col mono-cell ${
                              chg > 0 ? "val-pos" : chg < 0 ? "val-neg" : ""
                            }`}
                          >
                            {t ? formatSignedPct(chg, 2) : "..."}
                          </td>
                          <td className="num-col mono-cell muted-cell">
                            {t ? `${spread.toFixed(1)} bps` : "..."}
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>

              {analysis && (
                <div className="regime-summary-box">
                  <div className="panel-header">
                    <span className="panel-title">REGIME DIAGNOSTICS</span>
                    <span
                      className={`regime-badge ${
                        analysis.stats.regimeLabel === "PERSISTENT TREND"
                          ? "badge-trend"
                          : analysis.stats.regimeLabel === "MEAN-REVERTING"
                          ? "badge-revert"
                          : "badge-random"
                      }`}
                    >
                      {analysis.stats.regimeLabel}
                    </span>
                  </div>
                  <dl className="kv-grid">
                    <div className="kv-row">
                      <dt>Hurst Exponent (R/S)</dt>
                      <dd>{analysis.stats.hurstExponent.toFixed(3)}</dd>
                    </div>
                    <div className="kv-row">
                      <dt>Variance Ratio VR(4)</dt>
                      <dd>{analysis.stats.varianceRatio4.toFixed(3)}</dd>
                    </div>
                    <div className="kv-row">
                      <dt>AR(1) Autoregression</dt>
                      <dd>{analysis.stats.ar1Phi.toFixed(3)}</dd>
                    </div>
                    <div className="kv-row">
                      <dt>OLS Drift Slope</dt>
                      <dd>{formatSignedBps(analysis.stats.olsSlopeBpsPerBar, 2)}/bar</dd>
                    </div>
                    <div className="kv-row">
                      <dt>OLS Slope t-Stat (p)</dt>
                      <dd>
                        {analysis.stats.olsSlopeTStat.toFixed(2)} (p=
                        {analysis.stats.olsSlopePValue.toFixed(3)})
                      </dd>
                    </div>
                    <div className="kv-row">
                      <dt>Bollinger Z-Score (20)</dt>
                      <dd
                        className={
                          Math.abs(analysis.stats.bollingerZScore) > 2 ? "val-warn" : ""
                        }
                      >
                        {analysis.stats.bollingerZScore >= 0
                          ? `+${analysis.stats.bollingerZScore.toFixed(2)}s`
                          : `${analysis.stats.bollingerZScore.toFixed(2)}s`}
                      </dd>
                    </div>
                    <div className="kv-row">
                      <dt>Wilder RSI (14)</dt>
                      <dd>{analysis.stats.rsi14.toFixed(1)}</dd>
                    </div>
                    <div className="kv-row">
                      <dt>Session VWAP Delta</dt>
                      <dd
                        className={
                          analysis.stats.vwapDeviationPct >= 0 ? "val-pos" : "val-neg"
                        }
                      >
                        {formatSignedPct(analysis.stats.vwapDeviationPct, 2)}
                      </dd>
                    </div>
                  </dl>
                </div>
              )}
            </aside>

            {/* CENTER COLUMN: CHART + WALK-FORWARD BACKTEST + RETURN DISTRIBUTION */}
            <section className="center-column" aria-label="Market Chart and Model Validation">
              <div className="panel instrument-strip">
                <div className="strip-left">
                  <div className="strip-pair-block">
                    <h1 className="strip-symbol">
                      {feedSource === "CSV"
                        ? customCsvName || "CUSTOM CSV"
                        : `${activeInstrument.baseAsset}/${activeInstrument.quoteAsset}`}
                    </h1>
                    <span className="strip-category">
                      {feedSource === "CSV"
                        ? `USER DATASET (${candles.length} BARS)`
                        : `${activeInstrument.displayName} // ${interval.toUpperCase()} BARS`}
                    </span>
                  </div>

                  <div className="strip-price-block">
                    <span className="strip-price">{formatPrice(lastClose, priceDecimals)}</span>
                    {analysis && (
                      <span
                        className={`strip-change ${
                          analysis.stats.periodReturnPct >= 0 ? "val-pos" : "val-neg"
                        }`}
                      >
                        {formatSignedPct(analysis.stats.periodReturnPct, 2)} ({candles.length}B)
                      </span>
                    )}
                  </div>
                </div>

                {analysis && terminalForecastPoint && (
                  <div className="strip-kpis">
                    <div className="kpi-cell">
                      <span className="kpi-label">
                        E[P] AT +{horizon} BARS ({interval.toUpperCase()})
                      </span>
                      <span className="kpi-val val-amber">
                        {formatPrice(terminalForecastPoint.mean, priceDecimals)} (
                        {formatSignedPct(
                          ((terminalForecastPoint.mean - lastClose) / lastClose) * 100,
                          2,
                        )}
                        )
                      </span>
                    </div>
                    <div className="kpi-cell">
                      <span className="kpi-label">90% PREDICTION INTERVAL</span>
                      <span className="kpi-val">
                        {formatPrice(terminalForecastPoint.q05, priceDecimals)} to{" "}
                        {formatPrice(terminalForecastPoint.q95, priceDecimals)}
                      </span>
                    </div>
                    <div className="kpi-cell">
                      <span className="kpi-label">DIRECTIONAL PROB P(UP)</span>
                      <span
                        className={`kpi-val ${
                          terminalForecastPoint.probUp >= 0.52
                            ? "val-pos"
                            : terminalForecastPoint.probUp <= 0.48
                            ? "val-neg"
                            : ""
                        }`}
                      >
                        {(terminalForecastPoint.probUp * 100).toFixed(1)}%
                      </span>
                    </div>
                    <div className="kpi-cell">
                      <span className="kpi-label">24H QUOTE VOLUME</span>
                      <span className="kpi-val">
                        {currentTicker && feedSource !== "CSV"
                          ? `$${formatCompactVolume(currentTicker.quoteVolume)}`
                          : `${formatCompactVolume(
                              candles.reduce((acc, c) => acc + c.volume, 0),
                            )} units`}
                      </span>
                    </div>
                  </div>
                )}
              </div>

              <div className="panel chart-panel">
                {loadingSeries && candles.length === 0 ? (
                  <div className="chart-loading">Loading OHLCV market series...</div>
                ) : (
                  analysis && (
                    <PriceForecastChart
                      candles={candles}
                      indicators={analysis.indicators}
                      forecast={activeForecast}
                      overlay={overlay}
                      decimals={priceDecimals}
                      symbolLabel={
                        feedSource === "CSV"
                          ? `${customCsvName} (${interval.toUpperCase()})`
                          : `${activeInstrument.baseAsset}/${activeInstrument.quoteAsset} (${interval.toUpperCase()})`
                      }
                    />
                  )
                )}
              </div>

              {analysis && (
                <div className="panel backtest-panel">
                  <div className="panel-header">
                    <span className="panel-title">
                      WALK-FORWARD OUT-OF-SAMPLE MODEL EVALUATION (CLICK ROW TO SELECT MODEL)
                    </span>
                    <span className="panel-meta">
                      ROLLING 1-STEP ORIGIN EVALUATION (N = {analysis.backtests[0]?.evaluations ?? 0} WINDOWS)
                    </span>
                  </div>
                  <div className="table-scroll">
                    <table className="terminal-table">
                      <thead>
                        <tr>
                          <th>ECONOMETRIC MODEL</th>
                          <th className="num-col">WEIGHT</th>
                          <th className="num-col">RMSE (PRICE)</th>
                          <th className="num-col">MAE (BPS)</th>
                          <th className="num-col">MAPE (%)</th>
                          <th className="num-col">HIT RATE</th>
                          <th className="num-col">BRIER SCORE</th>
                          <th className="num-col">80% CI COV</th>
                        </tr>
                      </thead>
                      <tbody>
                        {analysis.backtests.map((bt) => {
                          const active = bt.modelId === selectedModel;
                          return (
                            <tr
                              key={bt.modelId}
                              className={`clickable-row ${active ? "row-selected" : ""}`}
                              onClick={() => setSelectedModel(bt.modelId)}
                            >
                              <td>
                                <span className="model-radio-indicator">
                                  {active ? "[ACTIVE]" : "[SELECT]"}
                                </span>{" "}
                                <strong>{bt.modelName}</strong>
                              </td>
                              <td className="num-col mono-cell">
                                {bt.modelId === "ensemble"
                                  ? "100.0%"
                                  : `${(bt.weight * 100).toFixed(1)}%`}
                              </td>
                              <td className="num-col mono-cell">
                                {formatPrice(bt.rmsePrice, priceDecimals)}
                              </td>
                              <td className="num-col mono-cell">
                                {bt.maeReturnBps.toFixed(1)} bps
                              </td>
                              <td className="num-col mono-cell">
                                {bt.mapePercent.toFixed(3)}%
                              </td>
                              <td
                                className={`num-col mono-cell ${
                                  bt.directionalHitRate >= 52 ? "val-pos" : ""
                                }`}
                              >
                                {bt.directionalHitRate.toFixed(1)}%
                              </td>
                              <td className="num-col mono-cell">
                                {bt.brierScore.toFixed(4)}
                              </td>
                              <td className="num-col mono-cell">
                                {bt.coverage80.toFixed(1)}%
                              </td>
                            </tr>
                          );
                        })}
                      </tbody>
                    </table>
                  </div>
                </div>
              )}

              {analysis && !companionMode && (
                <DistributionPanel
                  candles={candles}
                  stats={analysis.stats}
                  histogram={analysis.returnHistogram}
                />
              )}
            </section>

            {/* RIGHT COLUMN: BINANCE EXECUTION COMPANION + HORIZON SCHEDULE + VOLATILITY */}
            <aside className="panel forecast-sidebar" aria-label="Companion Order Ticket and Forecast">
              <div className="sidebar-mode-tabs">
                <button
                  type="button"
                  className={`sidebar-tab-btn ${sidebarMode === "ticket" ? "sidebar-tab-active" : ""}`}
                  onClick={() => setSidebarMode("ticket")}
                >
                  BINANCE TICKET &amp; 3-LAYER ROUTER
                </button>
                <button
                  type="button"
                  className={`sidebar-tab-btn ${sidebarMode === "schedule" ? "sidebar-tab-active" : ""}`}
                  onClick={() => setSidebarMode("schedule")}
                >
                  HORIZON &amp; VOLATILITY TABLE
                </button>
              </div>

              {sidebarMode === "ticket" && analysis && terminalForecastPoint && (
                <BinanceCompanionPanel
                  instrument={activeInstrument}
                  interval={interval}
                  horizon={horizon}
                  analysis={analysis}
                  terminalForecast={terminalForecastPoint}
                  selectedModel={selectedModel}
                  onSelectModel={setSelectedModel}
                  accountEquity={accountEquity}
                  onChangeEquity={setAccountEquity}
                  riskBudgetPct={riskBudgetPct}
                  onChangeRiskPct={setRiskBudgetPct}
                  decimals={priceDecimals}
                  livePricesBySymbol={livePricesBySymbol}
                />
              )}

              {sidebarMode === "schedule" && (
                <>
                  <div className="panel-header">
                    <span className="panel-title">HORIZON PROJECTION SCHEDULE</span>
                    <span className="panel-meta">{selectedModel.toUpperCase()}</span>
                  </div>

                  <div className="horizon-table-wrap">
                    <table className="terminal-table">
                      <thead>
                        <tr>
                          <th>STEP</th>
                          <th className="num-col">E[PRICE]</th>
                          <th className="num-col">E[RET]</th>
                          <th className="num-col">90% BAND [Q05, Q95]</th>
                          <th className="num-col">P(UP)</th>
                        </tr>
                      </thead>
                      <tbody>
                        {activeForecast
                          .filter(
                            (_, idx) =>
                              horizon <= 16 || idx % 2 === 0 || idx === activeForecast.length - 1,
                          )
                          .map((fp) => {
                            const retPct = ((fp.mean - lastClose) / lastClose) * 100;
                            return (
                              <tr key={fp.step}>
                                <td className="mono-cell">
                                  +{fp.step}B{" "}
                                  <span className="muted-cell">
                                    ({formatTimestampUtc(fp.time, false)})
                                  </span>
                                </td>
                                <td className="num-col mono-cell val-amber">
                                  {formatPrice(fp.mean, priceDecimals)}
                                </td>
                                <td
                                  className={`num-col mono-cell ${
                                    retPct >= 0 ? "val-pos" : "val-neg"
                                  }`}
                                >
                                  {formatSignedPct(retPct, 2)}
                                </td>
                                <td className="num-col mono-cell muted-cell">
                                  {formatPrice(fp.q05, priceDecimals)} ..{" "}
                                  {formatPrice(fp.q95, priceDecimals)}
                                </td>
                                <td
                                  className={`num-col mono-cell ${
                                    fp.probUp >= 0.52
                                      ? "val-pos"
                                      : fp.probUp <= 0.48
                                      ? "val-neg"
                                      : ""
                                  }`}
                                >
                                  {(fp.probUp * 100).toFixed(1)}%
                                </td>
                              </tr>
                            );
                          })}
                      </tbody>
                    </table>
                  </div>

                  {analysis && (
                    <div className="sidebar-section">
                      <div className="panel-header">
                        <span className="panel-title">VOLATILITY &amp; TAIL RISK ESTIMATORS</span>
                        <span className="panel-meta">N = {analysis.stats.sampleSize}</span>
                      </div>
                      <dl className="kv-grid">
                        <div className="kv-row">
                          <dt>Per-Bar Close Volatility</dt>
                          <dd>{analysis.stats.perBarVolPct.toFixed(3)}%</dd>
                        </div>
                        <div className="kv-row">
                          <dt>Annualized Close-to-Close Vol</dt>
                          <dd>{analysis.stats.annualizedCloseVolPct.toFixed(2)}%</dd>
                        </div>
                        <div className="kv-row">
                          <dt>RiskMetrics EWMA Vol (l=0.94)</dt>
                          <dd>{analysis.stats.annualizedEwmaVolPct.toFixed(2)}%</dd>
                        </div>
                        <div className="kv-row">
                          <dt>Parkinson High-Low Vol (Ann.)</dt>
                          <dd>{analysis.stats.parkinsonAnnualVolPct.toFixed(2)}%</dd>
                        </div>
                        <div className="kv-row">
                          <dt>Garman-Klass OHLC Vol (Ann.)</dt>
                          <dd>{analysis.stats.garmanKlassAnnualVolPct.toFixed(2)}%</dd>
                        </div>
                        <div className="kv-row">
                          <dt>Wilder ATR (14 Bars)</dt>
                          <dd>
                            {formatPrice(analysis.stats.atr14, priceDecimals)} (
                            {analysis.stats.atrPct.toFixed(2)}%)
                          </dd>
                        </div>
                        <div className="kv-row">
                          <dt>Horizon 95% Value-at-Risk (VaR)</dt>
                          <dd className="val-neg">-{analysis.stats.var95HorizonPct.toFixed(2)}%</dd>
                        </div>
                        <div className="kv-row">
                          <dt>Horizon 95% Expected Shortfall</dt>
                          <dd className="val-neg">-{analysis.stats.cvar95HorizonPct.toFixed(2)}%</dd>
                        </div>
                      </dl>
                    </div>
                  )}
                </>
              )}
            </aside>
          </main>

          {/* STICKY BOTTOM BAR FOR ANDROID SPLIT-SCREEN & MOBILE VIEWPORTS */}
          <nav className="mobile-bottom-nav" aria-label="Android Split-Screen Navigation">
            <button
              type="button"
              className={`mobile-nav-item ${mobilePane === "ticket" ? "mobile-nav-active" : ""}`}
              onClick={() => {
                setMobilePane("ticket");
                setSidebarMode("ticket");
              }}
            >
              ORDER TICKET
            </button>
            <button
              type="button"
              className={`mobile-nav-item ${mobilePane === "chart" ? "mobile-nav-active" : ""}`}
              onClick={() => setMobilePane("chart")}
            >
              CHART &amp; FAN
            </button>
            <button
              type="button"
              className={`mobile-nav-item ${mobilePane === "watchlist" ? "mobile-nav-active" : ""}`}
              onClick={() => setMobilePane("watchlist")}
            >
              WATCHLIST
            </button>
            <button
              type="button"
              className={`mobile-nav-item ${mobilePane === "diagnostics" ? "mobile-nav-active" : ""}`}
              onClick={() => {
                setMobilePane("diagnostics");
                setSidebarMode("schedule");
              }}
            >
              HORIZON &amp; VOL
            </button>
          </nav>
        </>
      )}

      {activeTab === "methodology" && (
        <main className="legal-container">
          <div className="legal-card">
            <div className="legal-meta">
              SPECIFICATION: TF-QUANT-SPEC-2026 // 3-LAYER ARCHITECTURE &amp; ECONOMETRIC METHODOLOGY
            </div>
            <h1>3-Layer Deterministic Architecture &amp; Statistical Forecasting</h1>
            <p className="legal-lead">
              TickFrame separates capability specifications (Layer 1 Skills), regime orchestration (Layer 2 Routing), and deterministic mathematical execution (Layer 3 Scripts &amp; Self-Annealing) so financial calculations are never left to probabilistic guesswork.
            </p>

            <section className="legal-section">
              <h2>1. The 3-Layer Architecture (AGENTS.md / SKILL.md Standard)</h2>
              <ul>
                <li>
                  <strong>Layer 1 (Skills / SOP Capability Packages):</strong> Packaged in{" "}
                  <code>.agent/skills/statistical-market-forecaster/SKILL.md</code> with explicit input invariants, econometric formulas in <code>references/econometric_formulas.md</code>, and CLI execution tooling in <code>scripts/verify_forecast_cli.mjs</code>.
                </li>
                <li>
                  <strong>Layer 2 (Orchestration &amp; Regime Routing):</strong> Inspects the active series Hurst Exponent <code>H</code> and Lo-MacKinlay Variance Ratio <code>VR(4)</code> to classify the market into <code>MEAN-REVERTING</code>, <code>RANDOM WALK</code>, or <code>PERSISTENT TREND</code> and routes to the optimal econometric specification.
                </li>
                <li>
                  <strong>Layer 3 (Deterministic Execution &amp; Self-Annealing Loop):</strong> Executes closed-form estimators in TypeScript and recalibrates ensemble weights at every bar using rolling walk-forward out-of-sample Mean Squared Error (<code>w_i ~ 1 / MSE_i</code>).
                </li>
              </ul>
            </section>

            <section className="legal-section">
              <h2>2. Android Split-Screen &amp; Binance Companion Workflow</h2>
              <p>
                TickFrame includes a Web App Manifest (<code>manifest.webmanifest</code>) and Service Worker (<code>sw.js</code>) for standalone installation on Android devices. When running in Android Split-Screen or Pop-Up View alongside the Binance Android App:
              </p>
              <ul>
                <li>
                  Use <strong>SPLIT / ANDROID DOCK</strong> mode or the bottom navigation bar to view the <strong>Exchange Execution Ticket</strong>.
                </li>
                <li>
                  Tap <strong>COPY</strong> next to Reference Entry, 2x ATR(14) Stop-Loss, Take-Profit 1, Take-Profit 2, or Risk-Budgeted Quantity and paste directly into the Binance Spot or Futures order form.
                </li>
                <li>
                  Tap <strong>BINANCE SPOT</strong> or <strong>BINANCE FUTURES</strong> to trigger Android App Links and jump straight to the active symbol inside the Binance app.
                </li>
              </ul>
            </section>

            <section className="legal-section">
              <h2>3. Constituent Econometric Models</h2>
              <p>
                <strong>Log-Linear OLS Drift + Student-t Prediction Fan:</strong> Fits <code>y_t = ln(C_t)</code> over a rolling 60-bar window with 0.55 shrinkage toward unconditional drift and exact Student-t prediction bands.
              </p>
              <p>
                <strong>Damped Holt Double Exponential Smoothing + RiskMetrics EWMA:</strong> Filters level and damped trend (<code>alpha=0.28, beta=0.08, phi=0.88</code>) while scaling confidence bands by conditional variance (<code>lambda=0.94</code>).
              </p>
              <p>
                <strong>AR(1) Ornstein-Uhlenbeck Process:</strong> Fits <code>r_t = c + phi * r_(t-1) + epsilon_t</code> and integrates multi-step moving-average variance analytically.
              </p>
            </section>
          </div>
        </main>
      )}

      {activeTab === "privacy" && (
        <main className="legal-container">
          <div className="legal-card">
            <div className="legal-meta">
              DOCUMENT ID: TF-POL-PRIV-2026 // EFFECTIVE DATE: OCTOBER 29, 2026
            </div>
            <h1>Privacy Policy</h1>
            <p className="legal-lead">
              TickFrame operates as a client-side quantitative market telemetry and statistical modeling workstation. We do not sell personal data, run behavioral advertising trackers, or custody user funds.
            </p>
            <section className="legal-section">
              <h2>1. Architecture and Data Processing Scope</h2>
              <p>
                All econometric calculations, including Ordinary Least Squares (OLS) drift estimation, Holt-Winters double exponential smoothing, Autoregressive AR(1) Ornstein-Uhlenbeck modeling, and walk-forward backtests, execute locally inside your browser process.
              </p>
              <ul>
                <li>
                  <strong>Custom CSV Datasets:</strong> When you import an OHLCV CSV file for statistical evaluation, the file contents are parsed strictly in local browser memory and are never uploaded to any external server.
                </li>
                <li>
                  <strong>Workspace Preferences &amp; Tracked Positions:</strong> Watchlist selections, custom symbols, and logged positions are stored locally in your browser using <code>window.localStorage</code>.
                </li>
              </ul>
            </section>
            <section className="legal-section">
              <h2>2. Market Data Feed Connections</h2>
              <p>
                To display real-time spot market candles and 24-hour orderbook ticker summaries, your browser establishes direct HTTPS and WebSocket connections to public market data endpoints (<code>data-api.binance.vision</code> and <code>data-stream.binance.vision</code>).
              </p>
            </section>
            <section className="legal-section">
              <h2>3. Full Standalone Document</h2>
              <p>
                You can also access or bookmark the standalone Privacy Policy page directly at{" "}
                <a href="/privacy.html" className="inline-link">
                  /privacy.html
                </a>
                .
              </p>
            </section>
          </div>
        </main>
      )}

      {activeTab === "terms" && (
        <main className="legal-container">
          <div className="legal-card">
            <div className="legal-meta">
              DOCUMENT ID: TF-POL-TERMS-2026 // EFFECTIVE DATE: OCTOBER 29, 2026
            </div>
            <h1>Terms and Conditions of Use</h1>
            <p className="legal-lead">
              By accessing or using the TickFrame Quantitative Terminal, you acknowledge and agree to the operational terms, statistical modeling limitations, and financial risk disclosures set forth below.
            </p>
            <section className="legal-section">
              <h2>1. No Investment, Legal, or Brokerage Advice</h2>
              <p>
                TickFrame is an analytical software utility that computes mathematical and statistical summaries over historical and real-time Open-High-Low-Close-Volume (OHLCV) time series. Nothing displayed in this software constitutes investment advice, a recommendation to buy or sell any financial instrument, or an offer of brokerage services.
              </p>
            </section>
            <section className="legal-section">
              <h2>2. Statistical Forecast Limitations and Model Risk</h2>
              <p>
                All price projections, confidence intervals (50% and 90% bands), directional probabilities, Value-at-Risk (VaR), and Expected Shortfall (CVaR) outputs are derived strictly from mathematical formulas applied to historical price series. Financial return distributions exhibit regime shifts, structural breaks, volatility clustering, and fat tails that can invalidate parametric assumptions without warning.
              </p>
            </section>
            <section className="legal-section">
              <h2>3. Full Standalone Document</h2>
              <p>
                You can also access or bookmark the standalone Terms and Conditions page directly at{" "}
                <a href="/terms.html" className="inline-link">
                  /terms.html
                </a>
                .
              </p>
            </section>
          </div>
        </main>
      )}

      <footer className="terminal-footer">
        <div className="footer-left">
          <span>TICKFRAME QUANTITATIVE TERMINAL</span>
          <span className="footer-sep">/</span>
          <span>STEP: {INTERVAL_SECONDS[interval]}S</span>
          <span className="footer-sep">/</span>
          <span>LAST SYNC: {formatTimestampUtc(lastUpdatedUtc, true)}</span>
          <span className="footer-sep">/</span>
          <span>STATISTICAL OUTPUTS ARE NOT INVESTMENT ADVICE</span>
        </div>
        <div className="footer-right">
          <a
            href="/"
            onClick={(e) => {
              e.preventDefault();
              setActiveTab("terminal");
            }}
          >
            Workspace
          </a>
          <a
            href="#methodology"
            onClick={(e) => {
              e.preventDefault();
              setActiveTab("methodology");
            }}
          >
            3-Layer &amp; Math
          </a>
          <a href="/privacy.html">Privacy Policy</a>
          <a href="/terms.html">Terms &amp; Conditions</a>
        </div>
      </footer>
    </div>
  );
};
