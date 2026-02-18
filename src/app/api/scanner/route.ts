import { NextRequest, NextResponse } from 'next/server';
import { fetchCandles } from '@/lib/hyperliquid';
import { scanForSFPs, debugSFPDetection } from '@/lib/analysis';
import { saveDetections, type SFPDetectionRow } from '@/lib/db';
import type { Timeframe, ScannerResult, SFP } from '@/types';

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

    // Persist SFP detections to SQLite
    const detectionRows: SFPDetectionRow[] = [];
    for (const r of results) {
      for (const sfp of r.sfps) {
        detectionRows.push(scannerResultToRow(r, sfp, timeframe));
      }
    }
    let saved = 0;
    if (detectionRows.length > 0) {
      try {
        saved = saveDetections(detectionRows);
      } catch {
        // Don't fail the scan if DB write fails
      }
    }

    return NextResponse.json({ results, saved });
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Unknown error';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

function scannerResultToRow(r: ScannerResult, sfp: SFP, timeframe: Timeframe): SFPDetectionRow {
  return {
    coin: r.coin,
    timeframe,
    sfp_type: sfp.type,
    swept_swing_price: sfp.sweptSwing.price,
    swept_swing_type: sfp.sweptSwing.type,
    swept_swing_time: sfp.sweptSwing.time,
    sweep_candle_time: sfp.sweepCandle.time,
    sweep_candle_open: sfp.sweepCandle.open,
    sweep_candle_high: sfp.sweepCandle.high,
    sweep_candle_low: sfp.sweepCandle.low,
    sweep_candle_close: sfp.sweepCandle.close,
    sweep_candle_volume: sfp.sweepCandle.volume,
    wick_depth: sfp.wickDepth,
    wick_pct: (sfp.wickDepth / sfp.sweptSwing.price) * 100,
    price_at_detection: r.currentPrice,
    trend_at_detection: r.trend,
    detected_at: r.scannedAt,
  };
}
