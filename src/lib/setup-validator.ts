import type {
  AnalysisResult,
  SetupCondition,
  TradingSetup,
  SetupValidation,
  TradeRequest,
  Timeframe,
} from '@/types';
import { fetchCandles } from './hyperliquid';
import { runFullAnalysis } from './analysis';

// ============================================================
// Setup Condition Evaluator
// ============================================================

const NEAR_THRESHOLD = 0.005; // 0.5% = "near" a level

function evaluateCondition(
  condition: SetupCondition,
  analysis: AnalysisResult
): { met: boolean; reason: string } {
  const { target, operator, value } = condition;

  switch (target) {
    // ----- Trend -----
    case 'trend': {
      const currentTrend = analysis.marketStructure.trend;
      if (operator === 'is') {
        const met = currentTrend === value;
        return {
          met,
          reason: met
            ? `Trend is ${currentTrend} as required`
            : `Trend is ${currentTrend}, expected ${value}`,
        };
      }
      if (operator === 'is_not') {
        const met = currentTrend !== value;
        return {
          met,
          reason: met
            ? `Trend is ${currentTrend} (not ${value}) as required`
            : `Trend is ${currentTrend}, but should not be`,
        };
      }
      return { met: false, reason: `Invalid operator "${operator}" for trend` };
    }

    // ----- Last Structure Break -----
    case 'last_structure_break': {
      const lastBOS = analysis.marketStructure.lastBOS;
      const lastCHoCH = analysis.marketStructure.lastCHoCH;

      if (value === 'BOS') {
        const met = lastBOS !== undefined && (!lastCHoCH || lastBOS.swing.index > lastCHoCH.swing.index);
        return {
          met,
          reason: met
            ? `Last structure break was BOS at ${lastBOS!.swing.price}`
            : 'Last structure break was not BOS',
        };
      }
      if (value === 'CHoCH') {
        const met = lastCHoCH !== undefined && (!lastBOS || lastCHoCH.swing.index > lastBOS.swing.index);
        return {
          met,
          reason: met
            ? `Last structure break was CHoCH at ${lastCHoCH!.swing.price}`
            : 'Last structure break was not CHoCH',
        };
      }
      return { met: false, reason: `Unknown structure break type: ${value}` };
    }

    // ----- Price Zone -----
    case 'price_zone': {
      if (!analysis.priceRelativeToRange) {
        return { met: false, reason: 'No active range found to determine price zone' };
      }
      const zone = analysis.priceRelativeToRange.zone;
      const met = zone === value;
      return {
        met,
        reason: met
          ? `Price is in ${zone} zone as required`
          : `Price is in ${zone} zone, expected ${value}`,
      };
    }

    // ----- SFP Present -----
    case 'sfp_present': {
      const recentSFPs = analysis.sfps.filter(sfp => {
        // Only consider SFPs from the last 20 candles
        const lastIndex = analysis.sfps.length > 0 ? Math.max(...analysis.sfps.map(s => s.sweepCandleIndex)) : 0;
        return sfp.sweepCandleIndex >= lastIndex - 20;
      });

      if (value === 'bullish') {
        const met = recentSFPs.some(s => s.type === 'bullish');
        return {
          met,
          reason: met
            ? `Bullish SFP detected (sweep of ${recentSFPs.find(s => s.type === 'bullish')!.sweptSwing.price})`
            : 'No recent bullish SFP found',
        };
      }
      if (value === 'bearish') {
        const met = recentSFPs.some(s => s.type === 'bearish');
        return {
          met,
          reason: met
            ? `Bearish SFP detected (sweep of ${recentSFPs.find(s => s.type === 'bearish')!.sweptSwing.price})`
            : 'No recent bearish SFP found',
        };
      }
      if (value === 'any') {
        const met = recentSFPs.length > 0;
        return {
          met,
          reason: met
            ? `SFP detected: ${recentSFPs[recentSFPs.length - 1].type}`
            : 'No recent SFP found',
        };
      }
      return { met: false, reason: `Unknown SFP value: ${value}` };
    }

    // ----- At Range High -----
    case 'at_range_high': {
      const activeRanges = analysis.ranges.filter(r => !r.broken);
      if (activeRanges.length === 0) {
        return { met: false, reason: 'No active ranges found' };
      }

      const nearRangeHigh = activeRanges.some(r => {
        const distance = Math.abs(analysis.currentPrice - r.high) / r.high;
        return distance < NEAR_THRESHOLD;
      });

      return {
        met: nearRangeHigh,
        reason: nearRangeHigh
          ? `Price is near range high`
          : `Price is not near any range high`,
      };
    }

    // ----- At Range Low -----
    case 'at_range_low': {
      const activeRanges = analysis.ranges.filter(r => !r.broken);
      if (activeRanges.length === 0) {
        return { met: false, reason: 'No active ranges found' };
      }

      const nearRangeLow = activeRanges.some(r => {
        const distance = Math.abs(analysis.currentPrice - r.low) / r.low;
        return distance < NEAR_THRESHOLD;
      });

      return {
        met: nearRangeLow,
        reason: nearRangeLow
          ? `Price is near range low`
          : `Price is not near any range low`,
      };
    }

    // ----- At Order Block -----
    case 'at_order_block': {
      const unmitigated = analysis.orderBlocks.filter(ob => !ob.mitigated);
      const price = analysis.currentPrice;

      if (value === 'bullish') {
        const atBullishOB = unmitigated.some(ob => ob.type === 'bullish' && price >= ob.low && price <= ob.high);
        return {
          met: atBullishOB,
          reason: atBullishOB
            ? 'Price is at a bullish order block'
            : 'Price is not at any bullish order block',
        };
      }
      if (value === 'bearish') {
        const atBearishOB = unmitigated.some(ob => ob.type === 'bearish' && price >= ob.low && price <= ob.high);
        return {
          met: atBearishOB,
          reason: atBearishOB
            ? 'Price is at a bearish order block'
            : 'Price is not at any bearish order block',
        };
      }
      const atAnyOB = unmitigated.some(ob => price >= ob.low && price <= ob.high);
      return {
        met: atAnyOB,
        reason: atAnyOB ? 'Price is at an order block' : 'Price is not at any order block',
      };
    }

    // ----- FVG Present -----
    case 'fvg_present': {
      const unfilled = analysis.fvgs.filter(f => !f.filled && f.fillPercent < 50);

      if (value === 'bullish') {
        const met = unfilled.some(f => f.type === 'bullish');
        return { met, reason: met ? 'Unfilled bullish FVG present' : 'No unfilled bullish FVG found' };
      }
      if (value === 'bearish') {
        const met = unfilled.some(f => f.type === 'bearish');
        return { met, reason: met ? 'Unfilled bearish FVG present' : 'No unfilled bearish FVG found' };
      }
      const met = unfilled.length > 0;
      return { met, reason: met ? 'Unfilled FVG present' : 'No unfilled FVGs found' };
    }

    // ----- Near Swing High -----
    case 'near_swing_high': {
      const swingHighs = analysis.marketStructure.swings.filter(s => s.type === 'high' && !s.broken);
      const nearSwingHigh = swingHighs.some(s => {
        const distance = Math.abs(analysis.currentPrice - s.price) / s.price;
        return distance < NEAR_THRESHOLD;
      });

      return {
        met: nearSwingHigh,
        reason: nearSwingHigh
          ? 'Price is near an unbroken swing high'
          : 'Price is not near any unbroken swing high',
      };
    }

    // ----- Near Swing Low -----
    case 'near_swing_low': {
      const swingLows = analysis.marketStructure.swings.filter(s => s.type === 'low' && !s.broken);
      const nearSwingLow = swingLows.some(s => {
        const distance = Math.abs(analysis.currentPrice - s.price) / s.price;
        return distance < NEAR_THRESHOLD;
      });

      return {
        met: nearSwingLow,
        reason: nearSwingLow
          ? 'Price is near an unbroken swing low'
          : 'Price is not near any unbroken swing low',
      };
    }

    default:
      return { met: false, reason: `Unknown condition target: ${target}` };
  }
}

// ============================================================
// Full Setup Validation
// ============================================================

/**
 * Validate a trading setup against current market conditions.
 * Fetches candle data for each unique timeframe referenced in conditions,
 * runs analysis, and evaluates all conditions.
 */
export async function validateSetup(
  setup: TradingSetup,
  coin: string
): Promise<SetupValidation> {
  // Collect all unique timeframes from conditions
  const timeframes = [...new Set(setup.conditions.map(c => c.timeframe))];

  // Fetch candles and run analysis for each timeframe
  const analyses = new Map<Timeframe, AnalysisResult>();
  for (const tf of timeframes) {
    const candles = await fetchCandles(coin, tf, 500);
    const analysis = runFullAnalysis(coin, tf, candles);
    analyses.set(tf, analysis);
  }

  // Evaluate each condition against its timeframe's analysis
  const conditionResults = setup.conditions.map(condition => {
    const analysis = analyses.get(condition.timeframe);
    if (!analysis) {
      return {
        condition,
        met: false,
        reason: `No analysis available for timeframe ${condition.timeframe}`,
      };
    }
    const result = evaluateCondition(condition, analysis);
    return { condition, ...result };
  });

  // Determine if setup is valid
  const valid = setup.requireAll
    ? conditionResults.every(r => r.met)
    : conditionResults.some(r => r.met);

  // Use the first analysis for the primary result
  const primaryAnalysis = analyses.values().next().value!;

  return {
    setup,
    valid,
    conditionResults,
    analysis: primaryAnalysis,
  };
}

/**
 * Gate a trade request: validate all applicable setups before allowing execution.
 * Returns { allowed, reason, validations }.
 */
export async function gateTrade(
  request: TradeRequest,
  setups: TradingSetup[]
): Promise<{
  allowed: boolean;
  reason: string;
  validations: SetupValidation[];
}> {
  const coin = request.coin.replace('-PERP', '');

  // Filter setups that apply to this coin and direction
  const applicable = setups.filter(setup => {
    if (!setup.enabled) return false;
    if (setup.coins.length > 0 && !setup.coins.includes(coin)) return false;
    if (setup.direction === 'long' && request.side !== 'buy') return false;
    if (setup.direction === 'short' && request.side !== 'sell') return false;
    return true;
  });

  if (applicable.length === 0) {
    return {
      allowed: false,
      reason: 'No enabled setups match this trade. Define a setup first.',
      validations: [],
    };
  }

  // Validate each applicable setup
  const validations: SetupValidation[] = [];
  for (const setup of applicable) {
    const validation = await validateSetup(setup, coin);
    validations.push(validation);
  }

  // Trade is allowed if ANY applicable setup is valid
  const anyValid = validations.some(v => v.valid);

  if (anyValid) {
    const validSetup = validations.find(v => v.valid)!;
    return {
      allowed: true,
      reason: `Setup "${validSetup.setup.name}" conditions met`,
      validations,
    };
  }

  // Build detailed rejection reason
  const reasons = validations.map(v => {
    const failed = v.conditionResults.filter(c => !c.met);
    return `"${v.setup.name}": ${failed.map(f => f.reason).join('; ')}`;
  });

  return {
    allowed: false,
    reason: `No setup conditions met.\n${reasons.join('\n')}`,
    validations,
  };
}
