import { NextRequest, NextResponse } from 'next/server';
import { fetchAccountState, fetchOpenOrders } from '@/lib/hyperliquid';

export async function POST(request: NextRequest) {
  try {
    const { walletAddress, action } = await request.json();

    if (!walletAddress) {
      return NextResponse.json({ error: 'walletAddress required' }, { status: 400 });
    }

    switch (action) {
      case 'state': {
        const state = await fetchAccountState(walletAddress);
        return NextResponse.json({ state });
      }

      case 'orders': {
        const orders = await fetchOpenOrders(walletAddress);
        return NextResponse.json({ orders });
      }

      default:
        return NextResponse.json({ error: `Unknown action: ${action}` }, { status: 400 });
    }
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Unknown error';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
