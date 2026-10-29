import React from "react";
import { Candle, computeAutocorrelation, computeLogReturns, DescriptiveStats } from "../lib/statistics";

interface DistributionPanelProps {
  candles: readonly Candle[];
  stats: DescriptiveStats;
  histogram: { binStartPct: number; binEndPct: number; count: number; normalExpected: number }[];
}

export const DistributionPanel: React.FC<DistributionPanelProps> = ({
  candles,
  stats,
  histogram,
}) => {
  const maxBinCount = Math.max(
    1,
    ...histogram.map((b) => Math.max(b.count, b.normalExpected)),
  );

  const returns = computeLogReturns(candles);
  const lags = [1, 2, 3, 4, 5].map((lag) => ({
    lag,
    acf: computeAutocorrelation(returns, lag),
  }));
  const confBand = returns.length > 0 ? 1.96 / Math.sqrt(returns.length) : 0.15;

  return (
    <div className="dist-grid">
      <div className="subpanel">
        <div className="subpanel-header">
          <span className="subpanel-title">LOG-RETURN DISTRIBUTION VS. GAUSSIAN FIT</span>
          <span className="subpanel-meta">
            JB = {stats.jarqueBeraStat.toFixed(2)} (p = {stats.jarqueBeraPValue.toFixed(3)})
          </span>
        </div>
        <div className="histogram-svg-wrap">
          <svg viewBox="0 0 360 130" className="histogram-svg" role="img" aria-label="Return distribution histogram">
            <line x1="24" y1="108" x2="348" y2="108" stroke="#1e2636" strokeWidth="1" />
            {histogram.map((bin, idx) => {
              const w = 316 / histogram.length;
              const x = 26 + idx * w;
              const barH = (bin.count / maxBinCount) * 88;
              const y = 108 - barH;
              const midPct = (bin.binStartPct + bin.binEndPct) / 2;
              const fill = midPct >= 0 ? "rgba(16, 185, 129, 0.55)" : "rgba(239, 68, 68, 0.55)";
              return (
                <g key={idx}>
                  <rect
                    x={x + 1}
                    y={y}
                    width={Math.max(2, w - 2)}
                    height={barH}
                    fill={fill}
                    stroke="#1e2636"
                    strokeWidth="0.5"
                  />
                </g>
              );
            })}
            <polyline
              fill="none"
              stroke="#f59e0b"
              strokeWidth="1.5"
              points={histogram
                .map((bin, idx) => {
                  const w = 316 / histogram.length;
                  const cx = 26 + idx * w + w / 2;
                  const cy = 108 - (bin.normalExpected / maxBinCount) * 88;
                  return `${cx.toFixed(1)},${cy.toFixed(1)}`;
                })
                .join(" ")}
            />
            <text x="26" y="122" fill="#8b95a7" fontSize="9" fontFamily="IBM Plex Mono">
              {histogram[0]?.binStartPct.toFixed(2)}%
            </text>
            <text x="184" y="122" fill="#8b95a7" fontSize="9" textAnchor="middle" fontFamily="IBM Plex Mono">
              0.00%
            </text>
            <text x="346" y="122" fill="#8b95a7" fontSize="9" textAnchor="end" fontFamily="IBM Plex Mono">
              +{histogram[histogram.length - 1]?.binEndPct.toFixed(2)}%
            </text>
          </svg>
        </div>
        <div className="dist-caption">
          <span>Skewness: <strong>{stats.skewness.toFixed(3)}</strong></span>
          <span>Excess Kurtosis: <strong>{stats.excessKurtosis.toFixed(3)}</strong></span>
          <span>Tail Regime: <strong>{stats.excessKurtosis > 1 ? "LEPTOKURTIC (FAT TAILS)" : "MESOKURTIC"}</strong></span>
        </div>
      </div>

      <div className="subpanel">
        <div className="subpanel-header">
          <span className="subpanel-title">SERIAL AUTOCORRELATION (ACF LAGS 1 TO 5)</span>
          <span className="subpanel-meta">
            Ljung-Box Q(5) = {stats.ljungBoxQ5.toFixed(2)}
          </span>
        </div>
        <div className="acf-list">
          {lags.map(({ lag, acf }) => {
            const clamped = Math.max(-0.4, Math.min(0.4, acf));
            const pctWidth = (Math.abs(clamped) / 0.4) * 50;
            const significant = Math.abs(acf) > confBand;
            return (
              <div className="acf-row" key={lag}>
                <span className="acf-label">LAG {lag}</span>
                <div className="acf-track">
                  <div className="acf-zero-line" />
                  <div
                    className={`acf-bar ${acf >= 0 ? "acf-pos" : "acf-neg"}`}
                    style={{
                      left: acf >= 0 ? "50%" : `${50 - pctWidth}%`,
                      width: `${pctWidth}%`,
                    }}
                  />
                </div>
                <span className={`acf-val ${significant ? "val-warn" : ""}`}>
                  {acf >= 0 ? `+${acf.toFixed(3)}` : acf.toFixed(3)}
                </span>
              </div>
            );
          })}
        </div>
        <div className="dist-caption">
          <span>95% Noise Band: <strong>+/-{confBand.toFixed(3)}</strong></span>
          <span>AR(1) Half-Life: <strong>{stats.halfLifeBars ? `${stats.halfLifeBars.toFixed(1)} bars` : "N/A"}</strong></span>
        </div>
      </div>
    </div>
  );
};
