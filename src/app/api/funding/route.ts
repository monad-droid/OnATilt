import { NextRequest, NextResponse } from 'next/server';
import { fetchFundingHistory } from '@/lib/hyperliquid';

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { coin, days } = body;

    if (!coin) {
      return NextResponse.json({ error: 'coin is required' }, { status: 400 });
    }

    const fundingHistory = await fetchFundingHistory(coin, days || 30);

    return NextResponse.json({ fundingHistory });
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Unknown error';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
