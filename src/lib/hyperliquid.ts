import { Hyperliquid } from 'hyperliquid';
import type { Candle, Timeframe, TradeRequest } from '@/types';

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
  const now = Date.now();
  const intervalMs = timeframeToMs(timeframe);
  const startTime = now - intervalMs * limit;

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

  const data = await response.json();

  if (!Array.isArray(data)) {
    throw new Error(`Unexpected candle response: ${JSON.stringify(data)}`);
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
  };
  return map[tf];
}
