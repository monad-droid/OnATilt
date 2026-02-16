import type {
  Candle,
  SwingPoint,
  StructurePoint,
  StructureType,
  StructureBreak,
  MarketStructure,
  Trend,
  SFP,
  Range,
  OrderBlock,
  FairValueGap,
  AnalysisResult,
  Timeframe,
} from '@/types';

// ============================================================
// Swing Point Detection
// ============================================================

/**
 * Detect swing highs and lows using a lookback/lookahead window.
 * A swing high: candle high is the highest in [i - strength, i + strength]
 * A swing low: candle low is the lowest in [i - strength, i + strength]
 */
export function detectSwingPoints(candles: Candle[], strength: number = 3): SwingPoint[] {
  const swings: SwingPoint[] = [];
  if (candles.length < strength * 2 + 1) return swings;

  for (let i = strength; i < candles.length - strength; i++) {
    let isSwingHigh = true;
    let isSwingLow = true;

    for (let j = 1; j <= strength; j++) {
      if (candles[i].high <= candles[i - j].high || candles[i].high <= candles[i + j].high) {
        isSwingHigh = false;
      }
      if (candles[i].low >= candles[i - j].low || candles[i].low >= candles[i + j].low) {
        isSwingLow = false;
      }
    }

    if (isSwingHigh) {
      swings.push({
        type: 'high',
        price: candles[i].high,
        time: candles[i].time,
        index: i,
        broken: false,
      });
    }

    if (isSwingLow) {
      swings.push({
        type: 'low',
        price: candles[i].low,
        time: candles[i].time,
        index: i,
        broken: false,
      });
    }
  }

  // Check which swings have been broken by subsequent price action
  for (const swing of swings) {
    for (let i = swing.index + 1; i < candles.length; i++) {
      if (swing.type === 'high' && candles[i].close > swing.price) {
        swing.broken = true;
        swing.brokenAt = i;
        break;
      }
      if (swing.type === 'low' && candles[i].close < swing.price) {
        swing.broken = true;
        swing.brokenAt = i;
        break;
      }
    }
  }

  return swings;
}

// ============================================================
// Market Structure Analysis
// ============================================================

const EQUAL_THRESHOLD = 0.001; // 0.1% tolerance for "equal" highs/lows

function classifySwing(current: SwingPoint, previous: SwingPoint | undefined): StructureType {
  if (!previous) {
    return current.type === 'high' ? 'HH' : 'HL';
  }

  if (current.type === 'high' && previous.type === 'high') {
    const ratio = current.price / previous.price;
    if (Math.abs(ratio - 1) < EQUAL_THRESHOLD) return 'EH';
    return current.price > previous.price ? 'HH' : 'LH';
  }

  if (current.type === 'low' && previous.type === 'low') {
    const ratio = current.price / previous.price;
    if (Math.abs(ratio - 1) < EQUAL_THRESHOLD) return 'EL';
    return current.price > previous.price ? 'HL' : 'LL';
  }

  // Mixed types — classify relative to same-type predecessor
  return current.type === 'high' ? 'HH' : 'HL';
}

function determineTrend(structurePoints: StructurePoint[]): Trend {
  if (structurePoints.length < 4) return 'ranging';

  const recent = structurePoints.slice(-6);
  const highs = recent.filter(p => p.swing.type === 'high');
  const lows = recent.filter(p => p.swing.type === 'low');

  const hasHH = highs.some(h => h.label === 'HH');
  const hasHL = lows.some(l => l.label === 'HL');
  const hasLH = highs.some(h => h.label === 'LH');
  const hasLL = lows.some(l => l.label === 'LL');

  if (hasHH && hasHL && !hasLL) return 'bullish';
  if (hasLH && hasLL && !hasHH) return 'bearish';
  return 'ranging';
}

export function analyzeMarketStructure(candles: Candle[], swingStrength: number = 3): MarketStructure {
  const swings = detectSwingPoints(candles, swingStrength);
  const structurePoints: StructurePoint[] = [];

  // Track last same-type swing for comparison
  let lastSwingHigh: SwingPoint | undefined;
  let lastSwingLow: SwingPoint | undefined;
  let prevTrend: Trend = 'ranging';

  for (const swing of swings) {
    const prev = swing.type === 'high' ? lastSwingHigh : lastSwingLow;
    const label = classifySwing(swing, prev);

    // Determine break type
    let breakType: StructureBreak = 'none';

    if (swing.type === 'high' && lastSwingHigh) {
      if (label === 'HH' && prevTrend === 'bearish') {
        breakType = 'CHoCH'; // was bearish, now breaking higher = reversal
      } else if (label === 'HH' && prevTrend === 'bullish') {
        breakType = 'BOS'; // continuation
      } else if (label === 'LH' && prevTrend === 'bullish') {
        // Potential weakness but not a break yet
        breakType = 'none';
      }
    }

    if (swing.type === 'low' && lastSwingLow) {
      if (label === 'LL' && prevTrend === 'bullish') {
        breakType = 'CHoCH'; // was bullish, now breaking lower = reversal
      } else if (label === 'LL' && prevTrend === 'bearish') {
        breakType = 'BOS'; // continuation
      }
    }

    const sp: StructurePoint = { swing, label, breakType };
    structurePoints.push(sp);

    if (swing.type === 'high') lastSwingHigh = swing;
    else lastSwingLow = swing;

    // Update trend after adding point
    prevTrend = determineTrend(structurePoints);
  }

  const trend = determineTrend(structurePoints);

  return {
    trend,
    swings,
    structurePoints,
    lastBOS: [...structurePoints].reverse().find(sp => sp.breakType === 'BOS'),
    lastCHoCH: [...structurePoints].reverse().find(sp => sp.breakType === 'CHoCH'),
  };
}

// ============================================================
// Swing Failure Pattern (SFP) Detection
// ============================================================

/**
 * An SFP occurs when price wicks beyond a swing point but closes back
 * on the other side (fails to hold the break).
 *
 * Bullish SFP: wick below a swing low, close above it
 * Bearish SFP: wick above a swing high, close below it
 */
export function detectSFPs(candles: Candle[], swings: SwingPoint[], minWickPercent: number = 0.0005): SFP[] {
  const sfps: SFP[] = [];

  for (const swing of swings) {
    // Only look at candles after the swing formed
    for (let i = swing.index + 1; i < candles.length; i++) {
      const c = candles[i];

      if (swing.type === 'high') {
        // Bearish SFP: wick above swing high, close below
        if (c.high > swing.price && c.close < swing.price) {
          const wickDepth = c.high - swing.price;
          if (wickDepth / swing.price >= minWickPercent) {
            sfps.push({
              type: 'bearish',
              sweptSwing: swing,
              sweepCandle: c,
              sweepCandleIndex: i,
              wickDepth,
            });
            break; // only count the first SFP per swing
          }
        }
        // If price closed above, swing is broken — no SFP
        if (c.close > swing.price) break;
      }

      if (swing.type === 'low') {
        // Bullish SFP: wick below swing low, close above
        if (c.low < swing.price && c.close > swing.price) {
          const wickDepth = swing.price - c.low;
          if (wickDepth / swing.price >= minWickPercent) {
            sfps.push({
              type: 'bullish',
              sweptSwing: swing,
              sweepCandle: c,
              sweepCandleIndex: i,
              wickDepth,
            });
            break;
          }
        }
        if (c.close < swing.price) break;
      }
    }
  }

  return sfps;
}

// ============================================================
// Range Detection
// ============================================================

/**
 * Identify horizontal ranges where price consolidates between
 * a swing high and swing low.
 */
export function detectRanges(
  candles: Candle[],
  swings: SwingPoint[],
  minCandlesInRange: number = 10
): Range[] {
  const ranges: Range[] = [];
  const swingHighs = swings.filter(s => s.type === 'high');
  const swingLows = swings.filter(s => s.type === 'low');

  // Pair nearby swing highs and lows to form ranges
  for (const sh of swingHighs) {
    // Find the nearest swing low that forms a range with this high
    const nearbyLows = swingLows.filter(sl => {
      const distance = Math.abs(sl.index - sh.index);
      return distance <= minCandlesInRange * 3 && distance >= 2;
    });

    for (const sl of nearbyLows) {
      const startIdx = Math.min(sh.index, sl.index);
      const endIdx = Math.max(sh.index, sl.index);

      // Check if price stayed mostly within the range
      const rangeHigh = sh.price;
      const rangeLow = sl.price;
      const rangeSize = rangeHigh - rangeLow;
      if (rangeSize <= 0) continue;

      let candlesInRange = 0;
      for (let i = startIdx; i <= Math.min(endIdx + minCandlesInRange, candles.length - 1); i++) {
        const tolerance = rangeSize * 0.1; // 10% tolerance
        if (candles[i].high <= rangeHigh + tolerance && candles[i].low >= rangeLow - tolerance) {
          candlesInRange++;
        }
      }

      if (candlesInRange >= minCandlesInRange) {
        const eq = (rangeHigh + rangeLow) / 2;
        const range: Range = {
          high: rangeHigh,
          low: rangeLow,
          highTime: sh.time,
          lowTime: sl.time,
          highIndex: sh.index,
          lowIndex: sl.index,
          equilibrium: eq,
          premium: rangeLow + rangeSize * 0.75,
          discount: rangeLow + rangeSize * 0.25,
          broken: false,
        };

        // Check if range has been broken
        const rangeEnd = Math.max(sh.index, sl.index);
        for (let i = rangeEnd + 1; i < candles.length; i++) {
          if (candles[i].close > rangeHigh) {
            range.broken = true;
            range.brokenDirection = 'above';
            break;
          }
          if (candles[i].close < rangeLow) {
            range.broken = true;
            range.brokenDirection = 'below';
            break;
          }
        }

        ranges.push(range);
      }
    }
  }

  // Deduplicate overlapping ranges — keep the widest
  return deduplicateRanges(ranges);
}

function deduplicateRanges(ranges: Range[]): Range[] {
  if (ranges.length <= 1) return ranges;

  const sorted = [...ranges].sort((a, b) => (b.high - b.low) - (a.high - a.low));
  const result: Range[] = [];

  for (const range of sorted) {
    const overlaps = result.some(existing => {
      const overlapHigh = Math.min(existing.high, range.high);
      const overlapLow = Math.max(existing.low, range.low);
      if (overlapHigh <= overlapLow) return false;
      const overlapSize = overlapHigh - overlapLow;
      const smallerRange = Math.min(existing.high - existing.low, range.high - range.low);
      return overlapSize / smallerRange > 0.5;
    });

    if (!overlaps) {
      result.push(range);
    }
  }

  return result;
}

// ============================================================
// Order Block Detection
// ============================================================

/**
 * Bullish OB: last bearish candle before a significant up-move
 * Bearish OB: last bullish candle before a significant down-move
 */
export function detectOrderBlocks(
  candles: Candle[],
  moveThreshold: number = 0.01, // 1% minimum move
  lookback: number = 3
): OrderBlock[] {
  const obs: OrderBlock[] = [];

  for (let i = lookback; i < candles.length - lookback; i++) {
    const current = candles[i];
    const isBearish = current.close < current.open;
    const isBullish = current.close > current.open;

    // Check for significant move after this candle
    let maxMoveUp = 0;
    let maxMoveDown = 0;

    for (let j = 1; j <= lookback && i + j < candles.length; j++) {
      const futureClose = candles[i + j].close;
      const moveUp = (futureClose - current.close) / current.close;
      const moveDown = (current.close - futureClose) / current.close;
      maxMoveUp = Math.max(maxMoveUp, moveUp);
      maxMoveDown = Math.max(maxMoveDown, moveDown);
    }

    // Bullish OB: bearish candle followed by strong up move
    if (isBearish && maxMoveUp >= moveThreshold) {
      const ob: OrderBlock = {
        type: 'bullish',
        high: current.open, // open is higher for bearish candle
        low: current.close,
        time: current.time,
        index: i,
        mitigated: false,
      };

      // Check if mitigated (price returned to OB)
      for (let k = i + lookback; k < candles.length; k++) {
        if (candles[k].low <= ob.high) {
          ob.mitigated = true;
          ob.mitigatedAt = k;
          break;
        }
      }

      obs.push(ob);
    }

    // Bearish OB: bullish candle followed by strong down move
    if (isBullish && maxMoveDown >= moveThreshold) {
      const ob: OrderBlock = {
        type: 'bearish',
        high: current.close, // close is higher for bullish candle
        low: current.open,
        time: current.time,
        index: i,
        mitigated: false,
      };

      for (let k = i + lookback; k < candles.length; k++) {
        if (candles[k].high >= ob.low) {
          ob.mitigated = true;
          ob.mitigatedAt = k;
          break;
        }
      }

      obs.push(ob);
    }
  }

  return obs;
}

// ============================================================
// Fair Value Gap Detection
// ============================================================

/**
 * FVG = gap between candle[i-1] and candle[i+1] that candle[i] didn't fill.
 * Bullish FVG: candle[i-1].high < candle[i+1].low (gap up)
 * Bearish FVG: candle[i-1].low > candle[i+1].high (gap down)
 */
export function detectFVGs(candles: Candle[]): FairValueGap[] {
  const fvgs: FairValueGap[] = [];

  for (let i = 1; i < candles.length - 1; i++) {
    const prev = candles[i - 1];
    const next = candles[i + 1];

    // Bullish FVG
    if (next.low > prev.high) {
      const fvg: FairValueGap = {
        type: 'bullish',
        high: next.low,
        low: prev.high,
        time: candles[i].time,
        index: i,
        filled: false,
        fillPercent: 0,
      };

      // Check fill
      const gapSize = fvg.high - fvg.low;
      for (let k = i + 2; k < candles.length; k++) {
        if (candles[k].low <= fvg.low) {
          fvg.filled = true;
          fvg.fillPercent = 100;
          break;
        }
        const filled = fvg.high - candles[k].low;
        fvg.fillPercent = Math.max(fvg.fillPercent, Math.min(100, (filled / gapSize) * 100));
      }

      fvgs.push(fvg);
    }

    // Bearish FVG
    if (prev.low > next.high) {
      const fvg: FairValueGap = {
        type: 'bearish',
        high: prev.low,
        low: next.high,
        time: candles[i].time,
        index: i,
        filled: false,
        fillPercent: 0,
      };

      const gapSize = fvg.high - fvg.low;
      for (let k = i + 2; k < candles.length; k++) {
        if (candles[k].high >= fvg.high) {
          fvg.filled = true;
          fvg.fillPercent = 100;
          break;
        }
        const filled = candles[k].high - fvg.low;
        fvg.fillPercent = Math.max(fvg.fillPercent, Math.min(100, (filled / gapSize) * 100));
      }

      fvgs.push(fvg);
    }
  }

  return fvgs;
}

// ============================================================
// Price Position Relative to Range
// ============================================================

function getPricePosition(price: number, range: Range) {
  if (price > range.high) {
    return { inRange: false, zone: 'above' as const, percentInRange: 100 };
  }
  if (price < range.low) {
    return { inRange: false, zone: 'below' as const, percentInRange: 0 };
  }

  const percent = ((price - range.low) / (range.high - range.low)) * 100;

  let zone: 'premium' | 'equilibrium' | 'discount';
  if (percent >= 75) zone = 'premium';
  else if (percent <= 25) zone = 'discount';
  else zone = 'equilibrium';

  return { inRange: true, zone, percentInRange: percent };
}

// ============================================================
// Full Analysis
// ============================================================

export function runFullAnalysis(
  coin: string,
  timeframe: Timeframe,
  candles: Candle[],
  swingStrength: number = 3
): AnalysisResult {
  const marketStructure = analyzeMarketStructure(candles, swingStrength);
  const sfps = detectSFPs(candles, marketStructure.swings);
  const ranges = detectRanges(candles, marketStructure.swings);
  const orderBlocks = detectOrderBlocks(candles);
  const fvgs = detectFVGs(candles);

  const currentPrice = candles[candles.length - 1]?.close ?? 0;

  // Find the most relevant active (unbroken) range
  const activeRanges = ranges.filter(r => !r.broken);
  let priceRelativeToRange: AnalysisResult['priceRelativeToRange'];

  if (activeRanges.length > 0) {
    // Pick the nearest range
    const nearest = activeRanges.reduce((best, r) => {
      const distCurrent = Math.min(
        Math.abs(currentPrice - r.high),
        Math.abs(currentPrice - r.low)
      );
      const distBest = Math.min(
        Math.abs(currentPrice - best.high),
        Math.abs(currentPrice - best.low)
      );
      return distCurrent < distBest ? r : best;
    });

    priceRelativeToRange = getPricePosition(currentPrice, nearest);
  }

  return {
    coin,
    timeframe,
    timestamp: Date.now(),
    marketStructure,
    sfps,
    ranges,
    orderBlocks,
    fvgs,
    currentPrice,
    priceRelativeToRange,
  };
}
