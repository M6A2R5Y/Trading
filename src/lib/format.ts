export function formatPrice(value: number, decimals = 2): string {
  if (!Number.isFinite(value)) return "0.00";
  const abs = Math.abs(value);
  let d = decimals;
  if (abs > 0 && abs < 1 && d < 4) d = 4;
  if (abs >= 1000 && d > 2) d = 2;
  return value.toLocaleString("en-US", {
    minimumFractionDigits: d,
    maximumFractionDigits: d,
  });
}

export function formatSignedPct(value: number, decimals = 2): string {
  if (!Number.isFinite(value)) return "0.00%";
  const sign = value > 0 ? "+" : "";
  return `${sign}${value.toFixed(decimals)}%`;
}

export function formatSignedBps(value: number, decimals = 1): string {
  if (!Number.isFinite(value)) return "0.0 bps";
  const sign = value > 0 ? "+" : "";
  return `${sign}${value.toFixed(decimals)} bps`;
}

export function formatCompactVolume(value: number): string {
  if (!Number.isFinite(value)) return "0";
  const abs = Math.abs(value);
  if (abs >= 1e9) return `${(value / 1e9).toFixed(2)}B`;
  if (abs >= 1e6) return `${(value / 1e6).toFixed(2)}M`;
  if (abs >= 1e3) return `${(value / 1e3).toFixed(2)}K`;
  return value.toFixed(2);
}

export function formatTimestampUtc(unixSeconds: number, includeDate = false): string {
  const d = new Date(unixSeconds * 1000);
  const yyyy = d.getUTCFullYear();
  const mm = String(d.getUTCMonth() + 1).padStart(2, "0");
  const dd = String(d.getUTCDate()).padStart(2, "0");
  const hh = String(d.getUTCHours()).padStart(2, "0");
  const min = String(d.getUTCMinutes()).padStart(2, "0");
  if (includeDate) {
    return `${yyyy}-${mm}-${dd} ${hh}:${min} UTC`;
  }
  return `${mm}-${dd} ${hh}:${min}`;
}
