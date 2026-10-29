import React, { useEffect, useRef, useState } from "react";
import {
  ColorType,
  CrosshairMode,
  IChartApi,
  ISeriesApi,
  LineStyle,
  UTCTimestamp,
  createChart,
} from "lightweight-charts";
import { Candle, ForecastPoint, IndicatorPoint } from "../lib/statistics";
import { formatCompactVolume, formatPrice, formatSignedPct, formatTimestampUtc } from "../lib/format";

export type OverlayMode = "bollinger" | "ema" | "vwap" | "none";

interface PriceForecastChartProps {
  candles: readonly Candle[];
  indicators: readonly IndicatorPoint[];
  forecast: readonly ForecastPoint[];
  overlay: OverlayMode;
  decimals: number;
  symbolLabel: string;
}

interface HoveredBarInfo {
  time: number;
  isForecast: boolean;
  open?: number;
  high?: number;
  low?: number;
  close?: number;
  volume?: number;
  mean?: number;
  q05?: number;
  q95?: number;
  probUp?: number;
}

export const PriceForecastChart: React.FC<PriceForecastChartProps> = ({
  candles,
  indicators,
  forecast,
  overlay,
  decimals,
  symbolLabel,
}) => {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const chartRef = useRef<IChartApi | null>(null);
  const candleSeriesRef = useRef<ISeriesApi<"Candlestick"> | null>(null);
  const volumeSeriesRef = useRef<ISeriesApi<"Histogram"> | null>(null);
  const overlayUpperRef = useRef<ISeriesApi<"Line"> | null>(null);
  const overlayMidRef = useRef<ISeriesApi<"Line"> | null>(null);
  const overlayLowerRef = useRef<ISeriesApi<"Line"> | null>(null);
  const forecastMeanRef = useRef<ISeriesApi<"Line"> | null>(null);
  const forecastQ95Ref = useRef<ISeriesApi<"Line"> | null>(null);
  const forecastQ05Ref = useRef<ISeriesApi<"Line"> | null>(null);
  const forecastQ75Ref = useRef<ISeriesApi<"Line"> | null>(null);
  const forecastQ25Ref = useRef<ISeriesApi<"Line"> | null>(null);

  const [hovered, setHovered] = useState<HoveredBarInfo | null>(null);

  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;

    const chart = createChart(el, {
      width: el.clientWidth,
      height: 410,
      layout: {
        background: { type: ColorType.Solid, color: "#0b0e14" },
        textColor: "#8b95a7",
        fontFamily: "'IBM Plex Mono', monospace",
        fontSize: 11,
      },
      grid: {
        vertLines: { color: "#151b26", style: LineStyle.Solid },
        horzLines: { color: "#151b26", style: LineStyle.Solid },
      },
      crosshair: {
        mode: CrosshairMode.Normal,
        vertLine: {
          color: "#384459",
          width: 1,
          style: LineStyle.Dashed,
          labelBackgroundColor: "#1b2230",
        },
        horzLine: {
          color: "#384459",
          width: 1,
          style: LineStyle.Dashed,
          labelBackgroundColor: "#1b2230",
        },
      },
      rightPriceScale: {
        borderColor: "#1e2636",
        scaleMargins: { top: 0.08, bottom: 0.22 },
      },
      timeScale: {
        borderColor: "#1e2636",
        timeVisible: true,
        secondsVisible: false,
        rightOffset: 18,
      },
    });

    const candleSeries = chart.addCandlestickSeries({
      upColor: "#10b981",
      downColor: "#ef4444",
      borderUpColor: "#10b981",
      borderDownColor: "#ef4444",
      wickUpColor: "#10b981",
      wickDownColor: "#ef4444",
    });

    const volumeSeries = chart.addHistogramSeries({
      priceFormat: { type: "volume" },
      priceScaleId: "",
    });
    volumeSeries.priceScale().applyOptions({
      scaleMargins: { top: 0.82, bottom: 0 },
    });

    const overlayUpper = chart.addLineSeries({
      color: "#38bdf8",
      lineWidth: 1,
      priceLineVisible: false,
      lastValueVisible: false,
    });
    const overlayMid = chart.addLineSeries({
      color: "#0ea5e9",
      lineWidth: 1,
      lineStyle: LineStyle.Dotted,
      priceLineVisible: false,
      lastValueVisible: false,
    });
    const overlayLower = chart.addLineSeries({
      color: "#38bdf8",
      lineWidth: 1,
      priceLineVisible: false,
      lastValueVisible: false,
    });

    const forecastQ95 = chart.addLineSeries({
      color: "rgba(245, 158, 11, 0.55)",
      lineWidth: 1,
      lineStyle: LineStyle.Dashed,
      priceLineVisible: false,
      lastValueVisible: true,
      title: "95% CI",
    });
    const forecastQ75 = chart.addLineSeries({
      color: "rgba(245, 158, 11, 0.35)",
      lineWidth: 1,
      lineStyle: LineStyle.Dotted,
      priceLineVisible: false,
      lastValueVisible: false,
    });
    const forecastMean = chart.addLineSeries({
      color: "#f59e0b",
      lineWidth: 2,
      lineStyle: LineStyle.Solid,
      priceLineVisible: false,
      lastValueVisible: true,
      title: "E[P]",
    });
    const forecastQ25 = chart.addLineSeries({
      color: "rgba(245, 158, 11, 0.35)",
      lineWidth: 1,
      lineStyle: LineStyle.Dotted,
      priceLineVisible: false,
      lastValueVisible: false,
    });
    const forecastQ05 = chart.addLineSeries({
      color: "rgba(245, 158, 11, 0.55)",
      lineWidth: 1,
      lineStyle: LineStyle.Dashed,
      priceLineVisible: false,
      lastValueVisible: true,
      title: "5% CI",
    });

    chartRef.current = chart;
    candleSeriesRef.current = candleSeries;
    volumeSeriesRef.current = volumeSeries;
    overlayUpperRef.current = overlayUpper;
    overlayMidRef.current = overlayMid;
    overlayLowerRef.current = overlayLower;
    forecastMeanRef.current = forecastMean;
    forecastQ95Ref.current = forecastQ95;
    forecastQ05Ref.current = forecastQ05;
    forecastQ75Ref.current = forecastQ75;
    forecastQ25Ref.current = forecastQ25;

    const handleResize = () => {
      if (containerRef.current && chartRef.current) {
        chartRef.current.applyOptions({ width: containerRef.current.clientWidth });
      }
    };
    window.addEventListener("resize", handleResize);

    return () => {
      window.removeEventListener("resize", handleResize);
      chart.remove();
      chartRef.current = null;
    };
  }, []);

  useEffect(() => {
    const chart = chartRef.current;
    const candleSeries = candleSeriesRef.current;
    const volumeSeries = volumeSeriesRef.current;
    const overlayUpper = overlayUpperRef.current;
    const overlayMid = overlayMidRef.current;
    const overlayLower = overlayLowerRef.current;
    const forecastMean = forecastMeanRef.current;
    const forecastQ95 = forecastQ95Ref.current;
    const forecastQ05 = forecastQ05Ref.current;
    const forecastQ75 = forecastQ75Ref.current;
    const forecastQ25 = forecastQ25Ref.current;

    if (
      !chart ||
      !candleSeries ||
      !volumeSeries ||
      !overlayUpper ||
      !overlayMid ||
      !overlayLower ||
      !forecastMean ||
      !forecastQ95 ||
      !forecastQ05 ||
      !forecastQ75 ||
      !forecastQ25 ||
      candles.length === 0
    ) {
      return;
    }

    const minMove = Math.pow(10, -decimals);
    candleSeries.applyOptions({
      priceFormat: { type: "price", precision: decimals, minMove },
    });
    forecastMean.applyOptions({
      priceFormat: { type: "price", precision: decimals, minMove },
    });
    forecastQ95.applyOptions({
      priceFormat: { type: "price", precision: decimals, minMove },
    });
    forecastQ05.applyOptions({
      priceFormat: { type: "price", precision: decimals, minMove },
    });

    candleSeries.setData(
      candles.map((c) => ({
        time: c.time as UTCTimestamp,
        open: c.open,
        high: c.high,
        low: c.low,
        close: c.close,
      })),
    );

    volumeSeries.setData(
      candles.map((c) => ({
        time: c.time as UTCTimestamp,
        value: c.volume,
        color: c.close >= c.open ? "rgba(16, 185, 129, 0.28)" : "rgba(239, 68, 68, 0.28)",
      })),
    );

    if (overlay === "bollinger") {
      overlayUpper.setData(
        indicators
          .filter((p) => p.bbUpper !== null)
          .map((p) => ({ time: p.time as UTCTimestamp, value: p.bbUpper as number })),
      );
      overlayMid.setData(
        indicators
          .filter((p) => p.bbMiddle !== null)
          .map((p) => ({ time: p.time as UTCTimestamp, value: p.bbMiddle as number })),
      );
      overlayLower.setData(
        indicators
          .filter((p) => p.bbLower !== null)
          .map((p) => ({ time: p.time as UTCTimestamp, value: p.bbLower as number })),
      );
    } else if (overlay === "ema") {
      overlayUpper.setData(
        indicators
          .filter((p) => p.ema20 !== null)
          .map((p) => ({ time: p.time as UTCTimestamp, value: p.ema20 as number })),
      );
      overlayMid.setData(
        indicators
          .filter((p) => p.ema50 !== null)
          .map((p) => ({ time: p.time as UTCTimestamp, value: p.ema50 as number })),
      );
      overlayLower.setData([]);
    } else if (overlay === "vwap") {
      overlayUpper.setData(
        indicators
          .filter((p) => p.vwap !== null)
          .map((p) => ({ time: p.time as UTCTimestamp, value: p.vwap as number })),
      );
      overlayMid.setData([]);
      overlayLower.setData([]);
    } else {
      overlayUpper.setData([]);
      overlayMid.setData([]);
      overlayLower.setData([]);
    }

    const lastCandle = candles[candles.length - 1];
    const anchor = { time: lastCandle.time as UTCTimestamp, value: lastCandle.close };

    forecastMean.setData([
      anchor,
      ...forecast.map((f) => ({ time: f.time as UTCTimestamp, value: f.mean })),
    ]);
    forecastQ95.setData([
      anchor,
      ...forecast.map((f) => ({ time: f.time as UTCTimestamp, value: f.q95 })),
    ]);
    forecastQ75.setData([
      anchor,
      ...forecast.map((f) => ({ time: f.time as UTCTimestamp, value: f.q75 })),
    ]);
    forecastQ25.setData([
      anchor,
      ...forecast.map((f) => ({ time: f.time as UTCTimestamp, value: f.q25 })),
    ]);
    forecastQ05.setData([
      anchor,
      ...forecast.map((f) => ({ time: f.time as UTCTimestamp, value: f.q05 })),
    ]);

    const candleMap = new Map<number, Candle>();
    for (const c of candles) candleMap.set(c.time, c);
    const forecastMap = new Map<number, ForecastPoint>();
    for (const f of forecast) forecastMap.set(f.time, f);

    const sub = (param: { time?: unknown }) => {
      if (!param.time || typeof param.time !== "number") {
        setHovered(null);
        return;
      }
      const c = candleMap.get(param.time);
      if (c) {
        setHovered({
          time: c.time,
          isForecast: false,
          open: c.open,
          high: c.high,
          low: c.low,
          close: c.close,
          volume: c.volume,
        });
        return;
      }
      const f = forecastMap.get(param.time);
      if (f) {
        setHovered({
          time: f.time,
          isForecast: true,
          mean: f.mean,
          q05: f.q05,
          q95: f.q95,
          probUp: f.probUp,
        });
      } else {
        setHovered(null);
      }
    };

    chart.subscribeCrosshairMove(sub);
    return () => {
      chart.unsubscribeCrosshairMove(sub);
    };
  }, [candles, indicators, forecast, overlay, decimals]);

  const lastCandle = candles[candles.length - 1];
  const activeBar = hovered ?? (lastCandle
    ? {
        time: lastCandle.time,
        isForecast: false,
        open: lastCandle.open,
        high: lastCandle.high,
        low: lastCandle.low,
        close: lastCandle.close,
        volume: lastCandle.volume,
      }
    : null);

  return (
    <div className="chart-wrapper">
      <div className="chart-hud">
        <div className="hud-primary">
          <span className="hud-symbol">{symbolLabel}</span>
          {activeBar && (
            <span className="hud-time">{formatTimestampUtc(activeBar.time, true)}</span>
          )}
        </div>
        {activeBar && !activeBar.isForecast && (
          <div className="hud-metrics">
            <span>
              O <strong>{formatPrice(activeBar.open ?? 0, decimals)}</strong>
            </span>
            <span>
              H <strong>{formatPrice(activeBar.high ?? 0, decimals)}</strong>
            </span>
            <span>
              L <strong>{formatPrice(activeBar.low ?? 0, decimals)}</strong>
            </span>
            <span>
              C{" "}
              <strong
                className={
                  (activeBar.close ?? 0) >= (activeBar.open ?? 0) ? "val-pos" : "val-neg"
                }
              >
                {formatPrice(activeBar.close ?? 0, decimals)}
              </strong>
            </span>
            <span>
              VOL <strong>{formatCompactVolume(activeBar.volume ?? 0)}</strong>
            </span>
          </div>
        )}
        {activeBar && activeBar.isForecast && (
          <div className="hud-metrics hud-forecast">
            <span className="hud-tag">PROJECTED HORIZON</span>
            <span>
              E[P] <strong>{formatPrice(activeBar.mean ?? 0, decimals)}</strong>
            </span>
            <span>
              90% BAND{" "}
              <strong>
                [{formatPrice(activeBar.q05 ?? 0, decimals)},{" "}
                {formatPrice(activeBar.q95 ?? 0, decimals)}]
              </strong>
            </span>
            <span>
              P(UP) <strong>{formatSignedPct(((activeBar.probUp ?? 0.5) * 100), 1).replace("+", "")}</strong>
            </span>
          </div>
        )}
      </div>
      <div ref={containerRef} className="chart-canvas" />
    </div>
  );
};
