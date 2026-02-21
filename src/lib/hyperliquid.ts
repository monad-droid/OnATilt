import { Hyperliquid } from 'hyperliquid';
import type { Candle, Timeframe, TradeRequest, FundingRate } from '@/types';

// Re-export config type locally since ours differs from SDK's
export interface HLConfig {
  privateKey: string;
  walletAddress?: string;
  testnet: boolean;
}

// ============================================================
// Hyperliquid Client Wrapper
// ============================================================

let clientInstance: Hyperliquid | null = null;
let currentConfig: HLConfig | null = null;

/**
 * Get or create the Hyperliquid SDK client.
 * For read-only operations (market data), no privateKey is needed.
 * For trading, a privateKey must be configured.
 */
export function getClient(config?: HLConfig): Hyperliquid {
  if (config) {
    clientInstance = new Hyperliquid({
      privateKey: config.privateKey || undefined,
      testnet: config.testnet ?? false,
      walletAddress: config.walletAddress || undefined,
    });
    currentConfig = config;
    return clientInstance;
  }

  if (!clientInstance) {
    clientInstance = new Hyperliquid({
      testnet: false,
    });
  }

  return clientInstance;
}

export function isAuthenticated(): boolean {
  return currentConfig?.privateKey !== undefined && currentConfig.privateKey !== '';
}

// ============================================================
// Market Data (direct REST — no SDK auth needed)
// ============================================================

export async function fetchCandles(
  coin: string,
  timeframe: Timeframe,
  limit: number = 500
): Promise<Candle[]> {
  // Monthly candles: aggregate from daily data
  if (timeframe === '1M') {
    return fetchMonthlyCandles(coin, limit);
  }

  const now = Date.now();
  const intervalMs = timeframeToMs(timeframe);
  const startTime = now - intervalMs * limit;

  // Retry with exponential backoff for rate limits
  const maxRetries = 3;
  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    const response = await fetch('https://api.hyperliquid.xyz/info', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        type: 'candleSnapshot',
        req: {
          coin: coin.replace('-PERP', ''),
          interval: timeframe,
          startTime,
          endTime: now,
        },
      }),
    });

    // Rate limited — back off and retry
    if (response.status === 429) {
      if (attempt < maxRetries) {
        await sleep(1000 * Math.pow(2, attempt)); // 1s, 2s, 4s
        continue;
      }
      throw new Error(`Rate limited fetching ${coin} after ${maxRetries} retries`);
    }

    const data = await response.json();

    // Hyperliquid returns null when rate limited (even with 200 status)
    if (data === null || data === undefined) {
      if (attempt < maxRetries) {
        await sleep(1000 * Math.pow(2, attempt));
        continue;
      }
      throw new Error(`Null response for ${coin} after ${maxRetries} retries (likely rate limited)`);
    }

    if (!Array.isArray(data)) {
      throw new Error(`Unexpected candle response for ${coin}: ${JSON.stringify(data).slice(0, 100)}`);
    }

    return data.map((c: { t: number; o: string; h: string; l: string; c: string; v: string }) => ({
      time: c.t,
      open: parseFloat(c.o),
      high: parseFloat(c.h),
      low: parseFloat(c.l),
      close: parseFloat(c.c),
      volume: parseFloat(c.v),
    }));
  }

  throw new Error(`Failed to fetch candles for ${coin}`);
}

async function fetchMonthlyCandles(coin: string, limit: number): Promise<Candle[]> {
  // Fetch enough daily candles to cover the requested months
  const dailyCandles = await fetchCandles(coin, '1d', limit * 31);

  // Group by year-month
  const months = new Map<string, Candle[]>();
  for (const c of dailyCandles) {
    const d = new Date(c.time);
    const key = `${d.getUTCFullYear()}-${d.getUTCMonth()}`;
    if (!months.has(key)) months.set(key, []);
    months.get(key)!.push(c);
  }

  // Aggregate each month
  const result: Candle[] = [];
  for (const [, days] of months) {
    if (days.length === 0) continue;
    result.push({
      time: days[0].time,
      open: days[0].open,
      high: Math.max(...days.map(d => d.high)),
      low: Math.min(...days.map(d => d.low)),
      close: days[days.length - 1].close,
      volume: days.reduce((sum, d) => sum + d.volume, 0),
    });
  }

  return result.sort((a, b) => a.time - b.time).slice(-limit);
}

export async function fetchAssets(): Promise<{ name: string; szDecimals: number }[]> {
  const response = await fetch('https://api.hyperliquid.xyz/info', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ type: 'meta' }),
  });

  const data = await response.json();
  return data.universe.map((a: { name: string; szDecimals: number }) => ({
    name: a.name,
    szDecimals: a.szDecimals,
  }));
}

export async function fetchAllMids(): Promise<Record<string, string>> {
  const response = await fetch('https://api.hyperliquid.xyz/info', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ type: 'allMids' }),
  });

  return response.json();
}

export interface AssetContext {
  coin: string;
  markPx: string;
  oraclePx: string;
  premium: string;
  funding: string;
  openInterest: string;
}

/**
 * Fetch current oracle and mark prices for a specific coin from metaAndAssetCtxs.
 * Returns real API values — not derived.
 */
export async function fetchAssetContext(coin: string): Promise<AssetContext | null> {
  const response = await fetch('https://api.hyperliquid.xyz/info', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ type: 'metaAndAssetCtxs' }),
  });

  const data = await response.json();
  const universe: { name: string }[] = data[0]?.universe ?? [];
  const ctxs: Record<string, string>[] = data[1] ?? [];

  // Match coin name — handle vntl: prefix
  const searchName = coin.includes(':') ? coin : coin.replace('-PERP', '');

  // Also try matching just the token part (e.g. "OPENAI" from "vntl:OPENAI")
  const tokenPart = coin.includes(':') ? coin.split(':')[1] : null;

  for (let i = 0; i < universe.length; i++) {
    if (universe[i].name === searchName) {
      const ctx = ctxs[i];
      return {
        coin: universe[i].name,
        markPx: ctx.markPx ?? '0',
        oraclePx: ctx.oraclePx ?? '0',
        premium: ctx.premium ?? '0',
        funding: ctx.funding ?? '0',
        openInterest: ctx.openInterest ?? '0',
      };
    }
  }

  // Fallback: try matching just the token name without prefix
  if (tokenPart) {
    for (let i = 0; i < universe.length; i++) {
      if (universe[i].name === tokenPart) {
        console.log(`[fetchAssetContext] Matched "${coin}" via token fallback → universe name "${universe[i].name}"`);
        const ctx = ctxs[i];
        return {
          coin: universe[i].name,
          markPx: ctx.markPx ?? '0',
          oraclePx: ctx.oraclePx ?? '0',
          premium: ctx.premium ?? '0',
          funding: ctx.funding ?? '0',
          openInterest: ctx.openInterest ?? '0',
        };
      }
    }
    // Log what names contain the token for debugging
    const similar = universe
      .filter(u => u.name.toUpperCase().includes(tokenPart.toUpperCase()))
      .map(u => u.name);
    if (similar.length > 0) {
      console.log(`[fetchAssetContext] No exact match for "${searchName}" or "${tokenPart}". Similar names found: ${similar.join(', ')}`);
    } else {
      console.log(`[fetchAssetContext] No match for "${searchName}" or "${tokenPart}". No similar names found in ${universe.length} assets.`);
    }
  }

  return null;
}

export async function fetchOrderbook(coin: string) {
  const response = await fetch('https://api.hyperliquid.xyz/info', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ type: 'l2Book', coin: coin.replace('-PERP', '') }),
  });

  return response.json();
}

export async function fetchAccountState(walletAddress: string) {
  const response = await fetch('https://api.hyperliquid.xyz/info', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ type: 'clearinghouseState', user: walletAddress }),
  });

  return response.json();
}

export async function fetchOpenOrders(walletAddress: string) {
  const response = await fetch('https://api.hyperliquid.xyz/info', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ type: 'openOrders', user: walletAddress }),
  });

  return response.json();
}

// ============================================================
// Predicted Funding Rates
// ============================================================

export interface PredictedFunding {
  fundingRate: string;
  nextFundingTime: number; // ms epoch
}

/**
 * Fetch predicted funding rate for a coin from the predictedFundings endpoint.
 * Returns the Hyperliquid perp prediction, or null if not available.
 * Note: Only available for first perp dex (BTC, ETH, etc.), NOT vntl: tokens.
 */
export async function fetchPredictedFunding(coin: string): Promise<PredictedFunding | null> {
  const response = await fetch('https://api.hyperliquid.xyz/info', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ type: 'predictedFundings' }),
  });

  const data = await response.json();
  if (!Array.isArray(data)) return null;

  const searchName = coin.includes(':') ? coin : coin.replace('-PERP', '');

  for (const entry of data) {
    if (!Array.isArray(entry) || entry.length < 2) continue;
    const [name, venues] = entry;
    if (name !== searchName) continue;

    // Find Hyperliquid perp venue
    for (const v of venues) {
      if (v?.venue === 'HlPerp' && v.fundingRate && v.nextFundingTime) {
        return {
          fundingRate: v.fundingRate,
          nextFundingTime: v.nextFundingTime,
        };
      }
    }
  }

  return null;
}

// ============================================================
// Ventuals Pre-IPO Predicted Funding
// ============================================================
//
// Ventuals applies a dynamic multiplier to Hyperliquid's funding formula
// based on the mark-to-oracle deviation. The multiplier schedule:
//   <5%  deviation → targets ~15% annualized (~0.00171%/hr)
//   5-19% deviation → exponential curve
//   ≥19% deviation → targets 4.0%/hr max
//
// Lookup table from Ventuals docs (mark-to-oracle deviation → hourly FR).

const VENTUALS_FR_TABLE: [number, number][] = [
  [0.00, 0.0000171],
  [0.01, 0.0000171],
  [0.02, 0.0000171],
  [0.03, 0.0000171],
  [0.04, 0.0000171],
  [0.05, 0.0000186],
  [0.06, 0.0000223],
  [0.07, 0.0000261],
  [0.08, 0.0000298],
  [0.09, 0.0000336],
  [0.10, 0.0000373],
  [0.11, 0.0000411],
  [0.12, 0.0000448],
  [0.13, 0.0000487],
  [0.14, 0.0000531],
  [0.15, 0.0000594],
  [0.16, 0.0000737],
  [0.17, 0.0001284],
  [0.18, 0.0006107],
  [0.19, 0.0400000],
  [0.20, 0.0400000],
];

/**
 * Estimate the Ventuals pre-IPO hourly funding rate from the current
 * mark-to-oracle deviation. Uses linear interpolation on the published
 * Ventuals funding schedule.
 *
 * @param markPx  Current mark price
 * @param oraclePx  Current oracle price
 * @returns Signed hourly funding rate as a decimal (e.g. 0.0000373 = 0.00373%)
 */
export function estimateVentualsFundingRate(markPx: number, oraclePx: number): number {
  if (oraclePx <= 0) return 0;

  const deviation = (markPx - oraclePx) / oraclePx; // signed
  const absDeviation = Math.abs(deviation);
  const sign = deviation >= 0 ? 1 : -1;

  // Clamp to table range
  if (absDeviation >= 0.19) return sign * 0.04;
  if (absDeviation <= 0) return 0;

  // Linear interpolation between table points
  const step = 0.01;
  const idx = Math.min(Math.floor(absDeviation / step), VENTUALS_FR_TABLE.length - 2);
  const lower = VENTUALS_FR_TABLE[idx];
  const upper = VENTUALS_FR_TABLE[idx + 1];
  const t = (absDeviation - lower[0]) / step;
  const rate = lower[1] + t * (upper[1] - lower[1]);

  return sign * rate;
}

/**
 * For vntl: tokens, compute a predicted funding rate locally since the
 * predictedFundings endpoint doesn't cover them.
 * Returns the estimated rate + next settlement time (top of next hour).
 */
export async function estimateVntlPredictedFunding(coin: string): Promise<PredictedFunding | null> {
  const ctx = await fetchAssetContext(coin);
  if (!ctx) return null;

  const markPx = parseFloat(ctx.markPx);
  const oraclePx = parseFloat(ctx.oraclePx);
  if (oraclePx <= 0) return null;

  const rate = estimateVentualsFundingRate(markPx, oraclePx);

  // Next settlement is the top of the next hour
  const now = Date.now();
  const nextHour = Math.ceil(now / 3_600_000) * 3_600_000;

  return {
    fundingRate: rate.toFixed(10),
    nextFundingTime: nextHour,
  };
}

// ============================================================
// Funding Rate History
// ============================================================

/**
 * Fetch historical funding rates for a coin.
 * Hyperliquid returns max 500 hours per request, so we paginate.
 * @param coin - Asset symbol (e.g. "BTC", "OPENAI")
 * @param days - Number of days of history to fetch (default 30)
 */
export async function fetchFundingHistory(
  coin: string,
  days: number = 30
): Promise<FundingRate[]> {
  const now = Date.now();
  const startTime = now - days * 86_400_000;
  const maxHoursPerRequest = 500;
  const msPerChunk = maxHoursPerRequest * 3_600_000;

  const allRates: FundingRate[] = [];
  let cursor = startTime;

  while (cursor < now) {
    const chunkEnd = Math.min(cursor + msPerChunk, now);

    const maxRetries = 3;
    for (let attempt = 0; attempt <= maxRetries; attempt++) {
      const response = await fetch('https://api.hyperliquid.xyz/info', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          type: 'fundingHistory',
          coin: coin.includes(':') ? coin : coin.replace('-PERP', ''),
          startTime: cursor,
          endTime: chunkEnd,
        }),
      });

      if (response.status === 429) {
        if (attempt < maxRetries) {
          await sleep(1000 * Math.pow(2, attempt));
          continue;
        }
        throw new Error(`Rate limited fetching funding for ${coin} after ${maxRetries} retries`);
      }

      const data = await response.json();

      // Null response could be rate limit (retry) or no data for this chunk (skip)
      if (data === null || data === undefined) {
        if (attempt < maxRetries) {
          await sleep(1000 * Math.pow(2, attempt));
          continue;
        }
        // No data for this time range — skip instead of throwing
        break;
      }

      if (!Array.isArray(data)) {
        // Empty array-like or error object — skip this chunk
        break;
      }

      allRates.push(...data);
      break;
    }

    cursor = chunkEnd;

    // Small delay between paginated requests to avoid rate limits
    if (cursor < now) {
      await sleep(200);
    }
  }

  // Deduplicate by timestamp (overlapping boundaries)
  const seen = new Set<number>();
  return allRates.filter(r => {
    if (seen.has(r.time)) return false;
    seen.add(r.time);
    return true;
  }).sort((a, b) => a.time - b.time);
}

// ============================================================
// Trade Execution (uses SDK for signing)
// ============================================================

export async function executeTrade(request: TradeRequest): Promise<{
  success: boolean;
  orderId?: string;
  error?: string;
}> {
  const client = getClient();

  if (!isAuthenticated()) {
    return { success: false, error: 'Not authenticated. Configure your API key first.' };
  }

  try {
    await client.ensureInitialized();
    const coinSymbol = request.coin.includes('-PERP') ? request.coin : `${request.coin}-PERP`;

    // Set leverage if specified
    if (request.leverage) {
      await client.exchange.updateLeverage(coinSymbol, 'cross', request.leverage);
    }

    if (request.orderType === 'market') {
      // For market orders, use a limit IOC with aggressive pricing
      const mids = await fetchAllMids();
      const mid = parseFloat(mids[request.coin.replace('-PERP', '')] || '0');
      if (!mid) {
        return { success: false, error: `Could not get mid price for ${request.coin}` };
      }

      // 1% slippage for market order
      const slippage = 0.01;
      const limitPx = request.side === 'buy'
        ? mid * (1 + slippage)
        : mid * (1 - slippage);

      const result = await client.exchange.placeOrder({
        coin: coinSymbol,
        is_buy: request.side === 'buy',
        sz: request.size,
        limit_px: limitPx,
        reduce_only: request.reduceOnly,
        order_type: { limit: { tif: 'Ioc' } },
      });

      return { success: true, orderId: JSON.stringify(result) };
    } else {
      if (!request.price) {
        return { success: false, error: 'Price is required for limit orders.' };
      }

      const result = await client.exchange.placeOrder({
        coin: coinSymbol,
        is_buy: request.side === 'buy',
        sz: request.size,
        limit_px: request.price,
        reduce_only: request.reduceOnly,
        order_type: { limit: { tif: request.tif } },
      });

      return { success: true, orderId: JSON.stringify(result) };
    }
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return { success: false, error: message };
  }
}

export async function cancelOrder(coin: string, orderId: number): Promise<{ success: boolean; error?: string }> {
  const client = getClient();

  if (!isAuthenticated()) {
    return { success: false, error: 'Not authenticated.' };
  }

  try {
    await client.ensureInitialized();
    await client.exchange.cancelOrder({
      coin: coin.includes('-PERP') ? coin : `${coin}-PERP`,
      o: orderId,
    });
    return { success: true };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return { success: false, error: message };
  }
}

// ============================================================
// Helpers
// ============================================================

function timeframeToMs(tf: Timeframe): number {
  const map: Record<Timeframe, number> = {
    '1m': 60_000,
    '3m': 3 * 60_000,
    '5m': 5 * 60_000,
    '15m': 15 * 60_000,
    '30m': 30 * 60_000,
    '1h': 3_600_000,
    '2h': 2 * 3_600_000,
    '4h': 4 * 3_600_000,
    '8h': 8 * 3_600_000,
    '12h': 12 * 3_600_000,
    '1d': 86_400_000,
    '3d': 3 * 86_400_000,
    '1w': 7 * 86_400_000,
    '1M': 30 * 86_400_000,
  };
  return map[tf];
}

function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}
