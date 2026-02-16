import { NextRequest, NextResponse } from 'next/server';
import { fetchCandles } from '@/lib/hyperliquid';
import { runFullAnalysis } from '@/lib/analysis';
import type { Timeframe } from '@/types';

export async function POST(request: NextRequest) {
  try {
    const { coin, timeframe, swingStrength } = await request.json();

    if (!coin || !timeframe) {
      return NextResponse.json({ error: 'coin and timeframe required' }, { status: 400 });
    }

    const candles = await fetchCandles(coin, timeframe as Timeframe, 500);

    if (candles.length === 0) {
      return NextResponse.json({ error: 'No candle data returned' }, { status: 404 });
    }

    const analysis = runFullAnalysis(coin, timeframe as Timeframe, candles, swingStrength || 3);

    return NextResponse.json({ analysis, candles });
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Unknown error';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
