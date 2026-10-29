import { Candle, INTERVAL_SECONDS, IntervalKey } from "./statistics";

export interface InstrumentMeta {
  symbol: string;
  baseAsset: string;
  quoteAsset: string;
  displayName: string;
  category: string;
  tickSize: number;
  decimals: number;
}

export const DEFAULT_INSTRUMENTS: readonly InstrumentMeta[] = [
  {
    symbol: "BTCUSDT",
    baseAsset: "BTC",
    quoteAsset: "USDT",
    displayName: "Bitcoin Spot",
    category: "Layer 1",
    tickSize: 0.01,
    decimals: 2,
  },
  {
    symbol: "ETHUSDT",
    baseAsset: "ETH",
    quoteAsset: "USDT",
    displayName: "Ethereum Spot",
    category: "Layer 1",
    tickSize: 0.01,
    decimals: 2,
  },
  {
    symbol: "SOLUSDT",
    baseAsset: "SOL",
    quoteAsset: "USDT",
    displayName: "Solana Spot",
    category: "Layer 1",
    tickSize: 0.01,
    decimals: 2,
  },
  {
    symbol: "BNBUSDT",
    baseAsset: "BNB",
    quoteAsset: "USDT",
    displayName: "BNB Spot",
    category: "Exchange",
    tickSize: 0.01,
    decimals: 2,
  },
  {
    symbol: "XRPUSDT",
    baseAsset: "XRP",
    quoteAsset: "USDT",
    displayName: "XRP Ledger",
    category: "Payments",
    tickSize: 0.0001,
    decimals: 4,
  },
  {
    symbol: "DOGEUSDT",
    baseAsset: "DOGE",
    quoteAsset: "USDT",
    displayName: "Dogecoin Spot",
    category: "Payments",
    tickSize: 0.00001,
    decimals: 5,
  },
  {
    symbol: "SUIUSDT",
    baseAsset: "SUI",
    quoteAsset: "USDT",
    displayName: "Sui Network",
    category: "Layer 1",
    tickSize: 0.0001,
    decimals: 4,
  },
  {
    symbol: "AVAXUSDT",
    baseAsset: "AVAX",
    quoteAsset: "USDT",
    displayName: "Avalanche Spot",
    category: "Layer 1",
    tickSize: 0.01,
    decimals: 2,
  },
  {
    symbol: "LINKUSDT",
    baseAsset: "LINK",
    quoteAsset: "USDT",
    displayName: "Chainlink Spot",
    category: "Oracle",
    tickSize: 0.001,
    decimals: 3,
  },
  {
    symbol: "ADAUSDT",
    baseAsset: "ADA",
    quoteAsset: "USDT",
    displayName: "Cardano Spot",
    category: "Layer 1",
    tickSize: 0.0001,
    decimals: 4,
  },
  {
    symbol: "PAXGUSDT",
    baseAsset: "PAXG",
    quoteAsset: "USDT",
    displayName: "PAX Gold (XAU)",
    category: "Commodity",
    tickSize: 0.01,
    decimals: 2,
  },
] as const;

export const INSTRUMENTS = DEFAULT_INSTRUMENTS;

export interface MarketTicker24h {
  symbol: string;
  lastPrice: number;
  priceChange: number;
  priceChangePercent: number;
  highPrice: number;
  lowPrice: number;
  volume: number;
  quoteVolume: number;
  weightedAvgPrice: number;
  bidPrice: number;
  askPrice: number;
  spreadBps: number;
  tradeCount: number;
}

const API_BASE = "https://data-api.binance.vision/api/v3";
const WS_BASE = "wss://data-stream.binance.vision/ws";

export function inferDecimalsFromPrice(price: number): number {
  if (!Number.isFinite(price) || price <= 0) return 2;
  if (price >= 100) return 2;
  if (price >= 10) return 3;
  if (price >= 0.1) return 4;
  if (price >= 0.001) return 6;
  return 8;
}

export function parseSymbolMeta(rawSymbol: string, samplePrice = 100): InstrumentMeta {
  const clean = rawSymbol.trim().toUpperCase().replace(/[^A-Z0-9]/g, "");
  const existing = DEFAULT_INSTRUMENTS.find((i) => i.symbol === clean);
  if (existing) return existing;

  const quoteCandidates = ["USDT", "FDUSD", "USDC", "BUSD", "BTC", "ETH", "EUR", "TRY"];
  let baseAsset = clean;
  let quoteAsset = "USDT";
  for (const q of quoteCandidates) {
    if (clean.endsWith(q) && clean.length > q.length) {
      baseAsset = clean.slice(0, clean.length - q.length);
      quoteAsset = q;
      break;
    }
  }
  const decimals = inferDecimalsFromPrice(samplePrice);
  return {
    symbol: clean,
    baseAsset,
    quoteAsset,
    displayName: `${baseAsset}/${quoteAsset} Spot`,
    category: "Custom Exchange Pair",
    tickSize: Math.pow(10, -decimals),
    decimals,
  };
}

export interface ExternalPlatformLinks {
  binanceSpot: string;
  binanceFutures: string;
  bybitSpot: string;
  coinbaseSpot: string;
  tradingView: string;
}

export function getExternalPlatformLinks(inst: InstrumentMeta): ExternalPlatformLinks {
  const base = encodeURIComponent(inst.baseAsset);
  const quote = encodeURIComponent(inst.quoteAsset);
  const sym = encodeURIComponent(inst.symbol);
  return {
    binanceSpot: `https://www.binance.com/en/trade/${base}_${quote}?type=spot`,
    binanceFutures: `https://www.binance.com/en/futures/${sym}`,
    bybitSpot: `https://www.bybit.com/en/trade/spot/${base}/${quote}`,
    coinbaseSpot: `https://www.coinbase.com/advanced-trade/spot/${base}-${quote}`,
    tradingView: `https://www.tradingview.com/chart/?symbol=BINANCE:${sym}`,
  };
}

function parseTickerObject(item: Record<string, string | number>): MarketTicker24h {
  const symbol = String(item.symbol);
  const bid = Number(item.bidPrice) || 0;
  const ask = Number(item.askPrice) || 0;
  const mid = bid > 0 && ask > 0 ? (bid + ask) / 2 : Number(item.lastPrice) || 1;
  const spreadBps = bid > 0 && ask >= bid ? ((ask - bid) / mid) * 10000 : 0;
  return {
    symbol,
    lastPrice: Number(item.lastPrice),
    priceChange: Number(item.priceChange),
    priceChangePercent: Number(item.priceChangePercent),
    highPrice: Number(item.highPrice),
    lowPrice: Number(item.lowPrice),
    volume: Number(item.volume),
    quoteVolume: Number(item.quoteVolume),
    weightedAvgPrice: Number(item.weightedAvgPrice),
    bidPrice: bid,
    askPrice: ask,
    spreadBps,
    tradeCount: Number(item.count) || 0,
  };
}

export async function fetchAllTickers24h(
  symbols: readonly string[] = DEFAULT_INSTRUMENTS.map((i) => i.symbol),
): Promise<Record<string, MarketTicker24h>> {
  const unique = Array.from(new Set(symbols.map((s) => s.toUpperCase())));
  const symbolsParam = encodeURIComponent(JSON.stringify(unique));
  const res = await fetch(`${API_BASE}/ticker/24hr?symbols=${symbolsParam}`);
  if (!res.ok) {
    throw new Error(`Ticker HTTP ${res.status}`);
  }
  const raw = (await res.json()) as Array<Record<string, string | number>>;
  const out: Record<string, MarketTicker24h> = {};
  for (const item of raw) {
    const parsed = parseTickerObject(item);
    out[parsed.symbol] = parsed;
  }
  return out;
}

export async function fetchSingleTicker24h(symbol: string): Promise<MarketTicker24h> {
  const clean = symbol.trim().toUpperCase();
  const res = await fetch(`${API_BASE}/ticker/24hr?symbol=${encodeURIComponent(clean)}`);
  if (!res.ok) {
    throw new Error(`Symbol ${clean} not found on exchange feed (HTTP ${res.status}).`);
  }
  const raw = (await res.json()) as Record<string, string | number>;
  return parseTickerObject(raw);
}

export async function fetchKlines(
  symbol: string,
  interval: IntervalKey,
  limit = 240,
): Promise<Candle[]> {
  const url = `${API_BASE}/klines?symbol=${encodeURIComponent(symbol)}&interval=${encodeURIComponent(interval)}&limit=${limit}`;
  const res = await fetch(url);
  if (!res.ok) {
    throw new Error(`Klines HTTP ${res.status}`);
  }
  const rows = (await res.json()) as Array<[number, string, string, string, string, string]>;
  const candles: Candle[] = [];
  for (const r of rows) {
    candles.push({
      time: Math.floor(Number(r[0]) / 1000),
      open: Number(r[1]),
      high: Number(r[2]),
      low: Number(r[3]),
      close: Number(r[4]),
      volume: Number(r[5]),
    });
  }
  return candles;
}

export function subscribeLiveKline(
  symbol: string,
  interval: IntervalKey,
  onCandle: (candle: Candle) => void,
  onStatusChange?: (connected: boolean) => void,
): () => void {
  const streamName = `${symbol.toLowerCase()}@kline_${interval}`;
  let ws: WebSocket | null = null;
  let closedByClient = false;
  let reconnectTimer: number | null = null;

  const connect = () => {
    if (closedByClient) return;
    try {
      ws = new WebSocket(`${WS_BASE}/${streamName}`);
      ws.onopen = () => {
        onStatusChange?.(true);
      };
      ws.onmessage = (event) => {
        try {
          const payload = JSON.parse(String(event.data));
          const k = payload?.k;
          if (!k) return;
          onCandle({
            time: Math.floor(Number(k.t) / 1000),
            open: Number(k.o),
            high: Number(k.h),
            low: Number(k.l),
            close: Number(k.c),
            volume: Number(k.v),
          });
        } catch {
          // Ignore malformed frame
        }
      };
      ws.onerror = () => {
        onStatusChange?.(false);
      };
      ws.onclose = () => {
        onStatusChange?.(false);
        if (!closedByClient) {
          reconnectTimer = window.setTimeout(connect, 4000);
        }
      };
    } catch {
      onStatusChange?.(false);
    }
  };

  connect();

  return () => {
    closedByClient = true;
    if (reconnectTimer !== null) {
      window.clearTimeout(reconnectTimer);
    }
    if (ws) {
      ws.close();
    }
  };
}

/**
 * Deterministic fallback series generator used only when live exchange feeds are unreachable
 * (e.g., air-gapped environment). Explicitly marked in UI state as offline fallback.
 */
export function generateOfflineFallbackSeries(
  symbol: string,
  interval: IntervalKey,
  bars = 240,
): Candle[] {
  const basePrices: Record<string, number> = {
    BTCUSDT: 80850,
    ETHUSDT: 2940,
    SOLUSDT: 178,
    BNBUSDT: 612,
    XRPUSDT: 0.585,
    DOGEUSDT: 0.162,
    SUIUSDT: 2.14,
    AVAXUSDT: 28.4,
    LINKUSDT: 16.8,
    ADAUSDT: 0.442,
    PAXGUSDT: 2745,
  };
  let seed = 0;
  for (let i = 0; i < symbol.length; i++) {
    seed = (seed * 31 + symbol.charCodeAt(i)) >>> 0;
  }
  const nextRand = () => {
    seed = (1664525 * seed + 1013904223) >>> 0;
    return seed / 4294967296;
  };
  const nextNormal = () => {
    const u1 = Math.max(1e-7, nextRand());
    const u2 = nextRand();
    return Math.sqrt(-2 * Math.log(u1)) * Math.cos(2 * Math.PI * u2);
  };

  const stepSec = INTERVAL_SECONDS[interval];
  const nowFloor = Math.floor(Date.now() / 1000 / stepSec) * stepSec;
  const startTime = nowFloor - (bars - 1) * stepSec;

  let price = basePrices[symbol] ?? 100;
  let prevRet = 0;
  const candles: Candle[] = [];

  for (let i = 0; i < bars; i++) {
    const open = price;
    const shock = nextNormal() * 0.0055 + 0.08 * prevRet + 0.00012;
    const close = Math.max(open * 0.1, open * Math.exp(shock));
    const intrabarRange = Math.abs(shock) + Math.abs(nextNormal()) * 0.0035;
    const high = Math.max(open, close) * (1 + intrabarRange * 0.65);
    const low = Math.min(open, close) * (1 - intrabarRange * 0.65);
    const volume = (120 + Math.abs(shock) * 45000) * (0.7 + 0.6 * nextRand());

    candles.push({
      time: startTime + i * stepSec,
      open,
      high,
      low,
      close,
      volume,
    });
    prevRet = shock;
    price = close;
  }
  return candles;
}

/**
 * Parses user-supplied CSV containing OHLC(V) columns.
 * Accepts headers with time/timestamp/date, open, high, low, close, volume.
 */
export function parseOhlcvCsv(csvText: string): Candle[] {
  const lines = csvText
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter((l) => l.length > 0);
  if (lines.length < 2) {
    throw new Error("CSV file must contain a header row and at least 40 data rows.");
  }
  const headers = lines[0].split(",").map((h) => h.trim().toLowerCase());
  const idxTime = headers.findIndex((h) => h.includes("time") || h.includes("date"));
  const idxOpen = headers.findIndex((h) => h === "open" || h === "o");
  const idxHigh = headers.findIndex((h) => h === "high" || h === "h");
  const idxLow = headers.findIndex((h) => h === "low" || h === "l");
  const idxClose = headers.findIndex((h) => h === "close" || h === "c");
  const idxVol = headers.findIndex((h) => h.includes("vol") || h === "v");

  if (idxClose === -1) {
    throw new Error("CSV must include a 'close' column.");
  }

  const parsed: Candle[] = [];
  for (let i = 1; i < lines.length; i++) {
    const cols = lines[i].split(",").map((c) => c.trim());
    const close = Number(cols[idxClose]);
    if (!Number.isFinite(close) || close <= 0) continue;
    const open = idxOpen >= 0 && Number.isFinite(Number(cols[idxOpen])) ? Number(cols[idxOpen]) : close;
    const high =
      idxHigh >= 0 && Number.isFinite(Number(cols[idxHigh])) ? Number(cols[idxHigh]) : Math.max(open, close);
    const low =
      idxLow >= 0 && Number.isFinite(Number(cols[idxLow])) ? Number(cols[idxLow]) : Math.min(open, close);
    const volume = idxVol >= 0 && Number.isFinite(Number(cols[idxVol])) ? Number(cols[idxVol]) : 1;

    let timeSec = 1700000000 + i * 3600;
    if (idxTime >= 0 && cols[idxTime]) {
      const rawTime = cols[idxTime];
      const numTime = Number(rawTime);
      if (Number.isFinite(numTime) && numTime > 0) {
        timeSec = numTime > 1e11 ? Math.floor(numTime / 1000) : Math.floor(numTime);
      } else {
        const dt = Date.parse(rawTime);
        if (Number.isFinite(dt)) {
          timeSec = Math.floor(dt / 1000);
        }
      }
    }
    parsed.push({ time: timeSec, open, high, low, close, volume });
  }

  parsed.sort((a, b) => a.time - b.time);
  const dedup: Candle[] = [];
  for (const c of parsed) {
    if (dedup.length === 0 || c.time > dedup[dedup.length - 1].time) {
      dedup.push(c);
    }
  }
  if (dedup.length < 40) {
    throw new Error(`Parsed ${dedup.length} valid rows; at least 40 rows are required.`);
  }
  return dedup;
}
