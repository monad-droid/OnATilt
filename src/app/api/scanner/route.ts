import { NextRequest, NextResponse } from 'next/server';
import { fetchCandles } from '@/lib/hyperliquid';
import { scanForSFPs, debugSFPDetection } from '@/lib/analysis';
import type { Timeframe, ScannerResult } from '@/types';

const CANDLE_LIMITS: Partial<Record<Timeframe, number>> = {
  '1w': 100,
  '1d': 200,
  '12h': 200,
  '4h': 300,
};

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { action } = body as { action?: string };

    // Debug mode: trace SFP detection for a single coin
    if (action === 'debug') {
      const { coin, timeframe = '1w' } = body as { coin: string; timeframe?: Timeframe };
      if (!coin) {
        return NextResponse.json({ error: 'coin required for debug' }, { status: 400 });
      }

      const limit = CANDLE_LIMITS[timeframe] ?? 100;
      const candles = await fetchCandles(coin, timeframe, limit);

      if (candles.length < 10) {
        return NextResponse.json({ error: `Only ${candles.length} candles — not enough data` }, { status: 400 });
      }

      const debug = debugSFPDetection(candles, 3);
      return NextResponse.json({ coin, timeframe, debug });
    }

    // Normal batch scan
    const { coins, timeframe = '1w', recentCandles = 2 } = body as {
      coins: string[];
      timeframe?: Timeframe;
      recentCandles?: number;
    };

    if (!coins || !Array.isArray(coins) || coins.length === 0) {
      return NextResponse.json({ error: 'coins array required' }, { status: 400 });
    }

    if (coins.length > 10) {
      return NextResponse.json({ error: 'max 10 coins per batch' }, { status: 400 });
    }

    const limit = CANDLE_LIMITS[timeframe] ?? 100;
    const results: ScannerResult[] = [];

    const promises = coins.map(async (coin): Promise<ScannerResult | null> => {
      try {
        const candles = await fetchCandles(coin, timeframe, limit);

        if (candles.length < 10) return null;

        const { trend, sfps, currentPrice } = scanForSFPs(candles, 3, recentCandles);

        if (sfps.length === 0) return null;

        return {
          coin,
          currentPrice,
          trend,
          sfps,
          totalCandles: candles.length,
          scannedAt: Date.now(),
        };
      } catch {
        return null;
      }
    });

    const settled = await Promise.all(promises);
    for (const r of settled) {
      if (r) results.push(r);
    }

    return NextResponse.json({ results });
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Unknown error';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
