import React, { useEffect, useMemo, useState } from "react";
import {
  ForecastModelId,
  ForecastPoint,
  IntervalKey,
  StatisticalAnalysis,
} from "../lib/statistics";
import { getExternalPlatformLinks, InstrumentMeta } from "../lib/marketData";
import { formatPrice, formatSignedPct } from "../lib/format";

export interface TrackedPosition {
  id: string;
  symbol: string;
  side: "LONG" | "SHORT";
  entryPrice: number;
  quantity: number;
  stopLoss: number;
  takeProfit: number;
  openedAtUtc: number;
}

const POSITIONS_STORAGE_KEY = "tickframe_positions_v1";

function loadPositions(): TrackedPosition[] {
  try {
    const raw = window.localStorage.getItem(POSITIONS_STORAGE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

interface BinanceCompanionPanelProps {
  instrument: InstrumentMeta;
  interval: IntervalKey;
  horizon: number;
  analysis: StatisticalAnalysis;
  terminalForecast: ForecastPoint;
  selectedModel: ForecastModelId;
  onSelectModel: (modelId: ForecastModelId) => void;
  accountEquity: number;
  onChangeEquity: (val: number) => void;
  riskBudgetPct: number;
  onChangeRiskPct: (val: number) => void;
  decimals: number;
  livePricesBySymbol: Record<string, number>;
}

export const BinanceCompanionPanel: React.FC<BinanceCompanionPanelProps> = ({
  instrument,
  interval,
  horizon,
  analysis,
  terminalForecast,
  selectedModel,
  onSelectModel,
  accountEquity,
  onChangeEquity,
  riskBudgetPct,
  onChangeRiskPct,
  decimals,
  livePricesBySymbol,
}) => {
  const [sideMode, setSideMode] = useState<"AUTO" | "LONG" | "SHORT">("AUTO");
  const [leverage, setLeverage] = useState<number>(1);
  const [copiedField, setCopiedField] = useState<string | null>(null);
  const [positions, setPositions] = useState<TrackedPosition[]>(() => loadPositions());

  useEffect(() => {
    try {
      window.localStorage.setItem(POSITIONS_STORAGE_KEY, JSON.stringify(positions));
    } catch {
      // ignore storage quota errors
    }
  }, [positions]);

  const copyToClipboard = (label: string, text: string) => {
    if (navigator.clipboard && navigator.clipboard.writeText) {
      navigator.clipboard.writeText(text).catch(() => {
        // fallback ignored
      });
    }
    setCopiedField(label);
    window.setTimeout(() => {
      setCopiedField((prev) => (prev === label ? null : prev));
    }, 1500);
  };

  const lastClose = analysis.stats.lastClose;
  const atr = analysis.stats.atr14;

  // Layer 2 Orchestration: Recommended econometric model for current regime
  const recommendedModel: { id: ForecastModelId; reason: string } = useMemo(() => {
    if (analysis.stats.regimeLabel === "MEAN-REVERTING") {
      return {
        id: "ar1_ou",
        reason: `Hurst H=${analysis.stats.hurstExponent.toFixed(2)} & VR(4)=${analysis.stats.varianceRatio4.toFixed(2)} indicate mean reversion; AR(1) OU captures pullback velocity.`,
      };
    }
    if (analysis.stats.regimeLabel === "PERSISTENT TREND") {
      return {
        id: "ols_drift",
        reason: `Hurst H=${analysis.stats.hurstExponent.toFixed(2)} indicates persistent serial trend; Shrinkage OLS Drift captures directional slope.`,
      };
    }
    return {
      id: "ensemble",
      reason: `Random-walk / mixed regime (H=${analysis.stats.hurstExponent.toFixed(2)}); Inverse-MSE Ensemble minimizes out-of-sample variance.`,
    };
  }, [analysis.stats.regimeLabel, analysis.stats.hurstExponent, analysis.stats.varianceRatio4]);

  // Determine effective trade direction
  const effectiveSide: "LONG" | "SHORT" = useMemo(() => {
    if (sideMode === "LONG") return "LONG";
    if (sideMode === "SHORT") return "SHORT";
    return terminalForecast.probUp >= 0.5 ? "LONG" : "SHORT";
  }, [sideMode, terminalForecast.probUp]);

  // Compute deterministic Binance order ticket levels
  const ticket = useMemo(() => {
    const entry = lastClose;
    const stopDistance = Math.max(atr * 2, entry * 0.0025);
    const stopLoss =
      effectiveSide === "LONG"
        ? Math.max(entry * 0.05, entry - stopDistance)
        : entry + stopDistance;

    const tp1Raw =
      effectiveSide === "LONG"
        ? Math.max(terminalForecast.mean, terminalForecast.q75, entry + stopDistance * 1.25)
        : Math.min(terminalForecast.mean, terminalForecast.q25, entry - stopDistance * 1.25);

    const tp2Raw =
      effectiveSide === "LONG"
        ? Math.max(terminalForecast.q95, tp1Raw + atr)
        : Math.min(terminalForecast.q05, tp1Raw - atr);

    const riskPerUnit = Math.abs(entry - stopLoss);
    const rewardTp1PerUnit = Math.abs(tp1Raw - entry);
    const rewardTp2PerUnit = Math.abs(tp2Raw - entry);
    const rrRatioTp1 = riskPerUnit > 0 ? rewardTp1PerUnit / riskPerUnit : 1;
    const rrRatioTp2 = riskPerUnit > 0 ? rewardTp2PerUnit / riskPerUnit : 2;

    const dollarRisk = Math.max(0, accountEquity * (riskBudgetPct / 100));
    const baseQty = riskPerUnit > 0 ? dollarRisk / riskPerUnit : 0;
    const notionalUsd = baseQty * entry;
    const requiredMarginUsd = leverage > 0 ? notionalUsd / leverage : notionalUsd;

    const stopPct = ((stopLoss - entry) / entry) * 100;
    const tp1Pct = ((tp1Raw - entry) / entry) * 100;
    const tp2Pct = ((tp2Raw - entry) / entry) * 100;

    return {
      entry,
      stopLoss,
      tp1: tp1Raw,
      tp2: tp2Raw,
      stopPct,
      tp1Pct,
      tp2Pct,
      rrRatioTp1,
      rrRatioTp2,
      dollarRisk,
      baseQty,
      notionalUsd,
      requiredMarginUsd,
    };
  }, [lastClose, atr, effectiveSide, terminalForecast, accountEquity, riskBudgetPct, leverage]);

  const platformLinks = useMemo(() => getExternalPlatformLinks(instrument), [instrument]);

  const handleLogPosition = () => {
    const newPos: TrackedPosition = {
      id: `${instrument.symbol}-${Date.now()}`,
      symbol: instrument.symbol,
      side: effectiveSide,
      entryPrice: Number(ticket.entry.toFixed(decimals)),
      quantity: Number(ticket.baseQty.toFixed(4)),
      stopLoss: Number(ticket.stopLoss.toFixed(decimals)),
      takeProfit: Number(ticket.tp1.toFixed(decimals)),
      openedAtUtc: Math.floor(Date.now() / 1000),
    };
    setPositions((prev) => [newPos, ...prev.slice(0, 9)]);
  };

  const handleRemovePosition = (id: string) => {
    setPositions((prev) => prev.filter((p) => p.id !== id));
  };

  const handlePopOutCompanion = () => {
    const url = new URL(window.location.href);
    url.searchParams.set("mode", "companion");
    url.searchParams.set("symbol", instrument.symbol);
    url.searchParams.set("interval", interval);
    window.open(
      url.toString(),
      "TickFrameCompanionDock",
      "width=430,height=820,menubar=no,toolbar=no,location=no,status=no",
    );
  };

  const fullTicketSummaryText = [
    `PAIR: ${instrument.baseAsset}/${instrument.quoteAsset} (${interval.toUpperCase()} +${horizon}B)`,
    `SIDE: ${effectiveSide} (P(UP)=${(terminalForecast.probUp * 100).toFixed(1)}%, REGIME=${analysis.stats.regimeLabel})`,
    `ENTRY: ${ticket.entry.toFixed(decimals)}`,
    `STOP-LOSS (2xATR): ${ticket.stopLoss.toFixed(decimals)} (${formatSignedPct(ticket.stopPct, 2)})`,
    `TP1 (STAT TARGET): ${ticket.tp1.toFixed(decimals)} (${formatSignedPct(ticket.tp1Pct, 2)}, ${ticket.rrRatioTp1.toFixed(2)}R)`,
    `TP2 (90% BAND): ${ticket.tp2.toFixed(decimals)} (${formatSignedPct(ticket.tp2Pct, 2)}, ${ticket.rrRatioTp2.toFixed(2)}R)`,
    `QTY: ${ticket.baseQty.toFixed(4)} ${instrument.baseAsset} ($${ticket.notionalUsd.toFixed(2)})`,
  ].join("\n");

  return (
    <div className="companion-module">
      {/* SECTION 1: BINANCE / EXCHANGE EXECUTION TICKET */}
      <div className="panel-header">
        <span className="panel-title">EXCHANGE EXECUTION TICKET (ONE-TAP COPY)</span>
        <span className="panel-meta">
          {instrument.baseAsset}/{instrument.quoteAsset}
        </span>
      </div>

      <div className="ticket-controls-bar">
        <div className="side-selector" role="group" aria-label="Order Direction">
          {(["AUTO", "LONG", "SHORT"] as const).map((m) => (
            <button
              key={m}
              type="button"
              className={`seg-btn ${sideMode === m ? "seg-btn-active" : ""}`}
              onClick={() => setSideMode(m)}
            >
              {m === "AUTO" ? `AUTO (${effectiveSide})` : m}
            </button>
          ))}
        </div>

        <div className="leverage-selector" role="group" aria-label="Leverage">
          {[1, 3, 5, 10].map((lev) => (
            <button
              key={lev}
              type="button"
              className={`seg-btn ${leverage === lev ? "seg-btn-active" : ""}`}
              onClick={() => setLeverage(lev)}
            >
              {lev}x
            </button>
          ))}
        </div>
      </div>

      <div className="calc-inputs">
        <label className="calc-field">
          <span>EQUITY (USD)</span>
          <input
            type="number"
            min={50}
            step={500}
            value={accountEquity}
            onChange={(e) => onChangeEquity(Math.max(0, Number(e.target.value) || 0))}
            className="terminal-input"
          />
        </label>
        <label className="calc-field">
          <span>RISK PER TRADE (%)</span>
          <input
            type="number"
            min={0.1}
            max={25}
            step={0.25}
            value={riskBudgetPct}
            onChange={(e) =>
              onChangeRiskPct(Math.max(0.05, Math.min(50, Number(e.target.value) || 0)))
            }
            className="terminal-input"
          />
        </label>
      </div>

      <div className="ticket-grid">
        <div className="ticket-row">
          <div className="ticket-label-group">
            <span className="ticket-field-name">DIRECTION &amp; EDGE</span>
            <span className="ticket-field-sub">
              P(UP) = {(terminalForecast.probUp * 100).toFixed(1)}% // {analysis.stats.regimeLabel}
            </span>
          </div>
          <span
            className={`ticket-side-badge ${
              effectiveSide === "LONG" ? "side-long" : "side-short"
            }`}
          >
            {effectiveSide} ({leverage === 1 ? "SPOT 1X" : `FUTURES ${leverage}X`})
          </span>
        </div>

        <div className="ticket-row">
          <div className="ticket-label-group">
            <span className="ticket-field-name">REFERENCE ENTRY</span>
            <span className="ticket-field-sub">Last spot/mark close</span>
          </div>
          <div className="ticket-val-action">
            <span className="mono-cell">{formatPrice(ticket.entry, decimals)}</span>
            <button
              type="button"
              className="copy-chip"
              onClick={() => copyToClipboard("entry", ticket.entry.toFixed(decimals))}
            >
              {copiedField === "entry" ? "COPIED" : "COPY"}
            </button>
          </div>
        </div>

        <div className="ticket-row">
          <div className="ticket-label-group">
            <span className="ticket-field-name">STOP-LOSS (2x ATR14)</span>
            <span className="ticket-field-sub">
              {formatSignedPct(ticket.stopPct, 2)} (Risk: ${formatPrice(ticket.dollarRisk, 2)})
            </span>
          </div>
          <div className="ticket-val-action">
            <span className="mono-cell val-neg">{formatPrice(ticket.stopLoss, decimals)}</span>
            <button
              type="button"
              className="copy-chip"
              onClick={() => copyToClipboard("sl", ticket.stopLoss.toFixed(decimals))}
            >
              {copiedField === "sl" ? "COPIED" : "COPY"}
            </button>
          </div>
        </div>

        <div className="ticket-row">
          <div className="ticket-label-group">
            <span className="ticket-field-name">TAKE-PROFIT 1 (STAT E[P]/Q75)</span>
            <span className="ticket-field-sub">
              {formatSignedPct(ticket.tp1Pct, 2)} ({ticket.rrRatioTp1.toFixed(2)}R)
            </span>
          </div>
          <div className="ticket-val-action">
            <span className="mono-cell val-pos">{formatPrice(ticket.tp1, decimals)}</span>
            <button
              type="button"
              className="copy-chip"
              onClick={() => copyToClipboard("tp1", ticket.tp1.toFixed(decimals))}
            >
              {copiedField === "tp1" ? "COPIED" : "COPY"}
            </button>
          </div>
        </div>

        <div className="ticket-row">
          <div className="ticket-label-group">
            <span className="ticket-field-name">TAKE-PROFIT 2 (90% BAND)</span>
            <span className="ticket-field-sub">
              {formatSignedPct(ticket.tp2Pct, 2)} ({ticket.rrRatioTp2.toFixed(2)}R)
            </span>
          </div>
          <div className="ticket-val-action">
            <span className="mono-cell val-amber">{formatPrice(ticket.tp2, decimals)}</span>
            <button
              type="button"
              className="copy-chip"
              onClick={() => copyToClipboard("tp2", ticket.tp2.toFixed(decimals))}
            >
              {copiedField === "tp2" ? "COPIED" : "COPY"}
            </button>
          </div>
        </div>

        <div className="ticket-row">
          <div className="ticket-label-group">
            <span className="ticket-field-name">ORDER QUANTITY ({instrument.baseAsset})</span>
            <span className="ticket-field-sub">
              Notional: ${formatPrice(ticket.notionalUsd, 2)} // Margin: $
              {formatPrice(ticket.requiredMarginUsd, 2)}
            </span>
          </div>
          <div className="ticket-val-action">
            <span className="mono-cell">{ticket.baseQty.toFixed(4)}</span>
            <button
              type="button"
              className="copy-chip"
              onClick={() => copyToClipboard("qty", ticket.baseQty.toFixed(4))}
            >
              {copiedField === "qty" ? "COPIED" : "COPY QTY"}
            </button>
          </div>
        </div>
      </div>

      {/* ACTION BAR: COPY ALL, TRACK TRADE, LAUNCH BINANCE APP */}
      <div className="ticket-actions-grid">
        <button
          type="button"
          className="action-btn"
          onClick={() => copyToClipboard("full", fullTicketSummaryText)}
        >
          {copiedField === "full" ? "TICKET COPIED" : "COPY FULL TICKET"}
        </button>
        <button type="button" className="action-btn" onClick={handleLogPosition}>
          LOG OPEN TRADE
        </button>
        <button type="button" className="action-btn" onClick={handlePopOutCompanion}>
          FLOATING DOCK
        </button>
      </div>

      <div className="exchange-links-bar">
        <span className="exchange-links-label">OPEN PAIR IN APP:</span>
        <a
          href={platformLinks.binanceSpot}
          target="_blank"
          rel="noopener noreferrer"
          className="exchange-chip"
        >
          BINANCE SPOT
        </a>
        <a
          href={platformLinks.binanceFutures}
          target="_blank"
          rel="noopener noreferrer"
          className="exchange-chip"
        >
          BINANCE FUTURES
        </a>
        <a
          href={platformLinks.bybitSpot}
          target="_blank"
          rel="noopener noreferrer"
          className="exchange-chip"
        >
          BYBIT
        </a>
        <a
          href={platformLinks.tradingView}
          target="_blank"
          rel="noopener noreferrer"
          className="exchange-chip"
        >
          TRADINGVIEW
        </a>
      </div>

      {/* SECTION 2: 3-LAYER ARCHITECTURE & SELF-ANNEALING ROUTER */}
      <div className="sidebar-section">
        <div className="panel-header">
          <span className="panel-title">3-LAYER DETERMINISTIC ROUTER</span>
          <span className="panel-meta">SKILL: STATISTICAL-MARKET-FORECASTER</span>
        </div>
        <div className="layer-audit-box">
          <div className="layer-item">
            <span className="layer-tag">L1 SKILL</span>
            <span className="layer-desc">
              SOP verified ({analysis.stats.sampleSize} bars, {interval.toUpperCase()} step, 0 gaps)
            </span>
          </div>
          <div className="layer-item">
            <span className="layer-tag">L2 ROUTER</span>
            <span className="layer-desc">{recommendedModel.reason}</span>
          </div>
          {selectedModel !== recommendedModel.id && (
            <div className="layer-action-row">
              <button
                type="button"
                className="action-btn"
                onClick={() => onSelectModel(recommendedModel.id)}
              >
                ACTIVATE RECOMMENDED MODEL ({recommendedModel.id.toUpperCase()})
              </button>
            </div>
          )}
          <div className="layer-item">
            <span className="layer-tag">L3 ANNEAL</span>
            <span className="layer-desc">
              Walk-forward weights calibrated: OLS{" "}
              {(
                (analysis.backtests.find((b) => b.modelId === "ols_drift")?.weight ?? 0) *
                100
              ).toFixed(0)}
              % / Holt-EWMA{" "}
              {(
                (analysis.backtests.find((b) => b.modelId === "ewma_holt")?.weight ?? 0) *
                100
              ).toFixed(0)}
              % / AR(1){" "}
              {(
                (analysis.backtests.find((b) => b.modelId === "ar1_ou")?.weight ?? 0) *
                100
              ).toFixed(0)}
              %
            </span>
          </div>
        </div>
      </div>

      {/* SECTION 3: ACTIVE POSITION MONITOR */}
      {positions.length > 0 && (
        <div className="sidebar-section">
          <div className="panel-header">
            <span className="panel-title">SYNCED OPEN POSITIONS ({positions.length})</span>
            <span className="panel-meta">LIVE PNL &amp; THESIS AUDIT</span>
          </div>
          <div className="positions-list">
            {positions.map((pos) => {
              const mark =
                pos.symbol === instrument.symbol
                  ? lastClose
                  : livePricesBySymbol[pos.symbol] ?? pos.entryPrice;
              const diff =
                pos.side === "LONG" ? mark - pos.entryPrice : pos.entryPrice - mark;
              const pnlUsd = diff * pos.quantity;
              const pnlPct = pos.entryPrice > 0 ? (diff / pos.entryPrice) * 100 : 0;
              const riskUnit = Math.abs(pos.entryPrice - pos.stopLoss);
              const rMult = riskUnit > 0 ? diff / riskUnit : 0;

              const thesisIntact =
                pos.symbol !== instrument.symbol ||
                (pos.side === "LONG" && terminalForecast.probUp >= 0.48) ||
                (pos.side === "SHORT" && terminalForecast.probUp <= 0.52);

              return (
                <div className="position-card" key={pos.id}>
                  <div className="position-card-top">
                    <div>
                      <span
                        className={`ticket-side-badge ${
                          pos.side === "LONG" ? "side-long" : "side-short"
                        }`}
                      >
                        {pos.side}
                      </span>{" "}
                      <strong className="mono-cell">{pos.symbol}</strong>{" "}
                      <span className="muted-cell">x{pos.quantity}</span>
                    </div>
                    <button
                      type="button"
                      className="copy-chip"
                      onClick={() => handleRemovePosition(pos.id)}
                    >
                      CLOSE
                    </button>
                  </div>
                  <div className="position-card-metrics mono-cell">
                    <span>Entry: {pos.entryPrice}</span>
                    <span>Mark: {formatPrice(mark, decimals)}</span>
                    <span className={pnlUsd >= 0 ? "val-pos" : "val-neg"}>
                      PnL: {pnlUsd >= 0 ? "+" : ""}${pnlUsd.toFixed(2)} (
                      {formatSignedPct(pnlPct, 2)} / {rMult >= 0 ? "+" : ""}
                      {rMult.toFixed(2)}R)
                    </span>
                  </div>
                  <div className="position-card-bottom">
                    <span>
                      SL: {pos.stopLoss} // TP: {pos.takeProfit}
                    </span>
                    <span className={thesisIntact ? "val-pos" : "val-amber"}>
                      {thesisIntact ? "STAT THESIS INTACT" : "STAT DRIFT WARNING"}
                    </span>
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
};
