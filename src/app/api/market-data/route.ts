import { NextRequest, NextResponse } from 'next/server';
import { fetchCandles, fetchAllMids, fetchAssets, fetchOrderbook, fetchAssetContext, fetchPredictedFunding } from '@/lib/hyperliquid';
import type { Timeframe } from '@/types';

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { action } = body;

    switch (action) {
      case 'candles': {
        const { coin, timeframe, limit } = body;
        if (!coin || !timeframe) {
          return NextResponse.json({ error: 'coin and timeframe required' }, { status: 400 });
        }
        const candles = await fetchCandles(coin, timeframe as Timeframe, limit || 500);
        return NextResponse.json({ candles });
      }

      case 'mids': {
        const mids = await fetchAllMids();
        return NextResponse.json({ mids });
      }

      case 'assets': {
        const assets = await fetchAssets();
        return NextResponse.json({ assets });
      }

      case 'orderbook': {
        const { coin } = body;
        if (!coin) {
          return NextResponse.json({ error: 'coin required' }, { status: 400 });
        }
        const orderbook = await fetchOrderbook(coin);
        return NextResponse.json({ orderbook });
      }

      case 'asset-context': {
        const { coin } = body;
        if (!coin) {
          return NextResponse.json({ error: 'coin required' }, { status: 400 });
        }
        const context = await fetchAssetContext(coin);
        return NextResponse.json({ context });
      }

      case 'predicted-funding': {
        const { coin } = body;
        if (!coin) {
          return NextResponse.json({ error: 'coin required' }, { status: 400 });
        }
        const predicted = await fetchPredictedFunding(coin);
        return NextResponse.json({ predicted });
      }

      default:
        return NextResponse.json({ error: `Unknown action: ${action}` }, { status: 400 });
    }
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Unknown error';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
