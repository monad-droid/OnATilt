import { NextRequest, NextResponse } from 'next/server';
import { getClient, executeTrade, type HLConfig } from '@/lib/hyperliquid';
import { gateTrade } from '@/lib/setup-validator';
import type { TradeRequest, TradingSetup } from '@/types';

export async function POST(request: NextRequest) {
  try {
    const { trade, setups, config } = (await request.json()) as {
      trade: TradeRequest;
      setups: TradingSetup[];
      config: HLConfig;
    };

    if (!trade || !config) {
      return NextResponse.json({ error: 'trade and config required' }, { status: 400 });
    }

    if (!config.privateKey) {
      return NextResponse.json({ error: 'API key not configured' }, { status: 401 });
    }

    // Initialize client with user's credentials
    getClient(config);

    // Gate the trade through setup validation
    const gateResult = await gateTrade(trade, setups || []);

    if (!gateResult.allowed) {
      return NextResponse.json({
        success: false,
        blocked: true,
        blockReason: gateResult.reason,
        validations: gateResult.validations.map(v => ({
          setupName: v.setup.name,
          valid: v.valid,
          conditions: v.conditionResults.map(c => ({
            description: c.condition.description,
            met: c.met,
            reason: c.reason,
          })),
        })),
      });
    }

    // Setup conditions met — execute the trade
    const result = await executeTrade(trade);

    return NextResponse.json({
      ...result,
      blocked: false,
      validations: gateResult.validations.map(v => ({
        setupName: v.setup.name,
        valid: v.valid,
        conditions: v.conditionResults.map(c => ({
          description: c.condition.description,
          met: c.met,
          reason: c.reason,
        })),
      })),
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Unknown error';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
