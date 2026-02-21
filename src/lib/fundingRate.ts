/**
 * Ventuals pre-IPO funding rate estimation.
 *
 * Ventuals applies a dynamic multiplier to Hyperliquid's funding formula
 * based on the mark-to-oracle deviation. The lookup table below is sourced
 * directly from Ventuals documentation.
 *
 * - <5% deviation:  fixed ~15% annualized (0.00171%/hr)
 * - 5–19% deviation: exponential multiplier curve
 * - ≥19% deviation:  capped at 4%/hr (Hyperliquid max)
 */

// [mark-to-oracle deviation (decimal), hourly funding rate (decimal)]
const VENTUALS_FR_TABLE: [number, number][] = [
  [0.00, 0.0000171],
  [0.01, 0.0000171],
  [0.02, 0.0000171],
  [0.03, 0.0000171],
  [0.04, 0.0000171],
  [0.05, 0.0000186],
  [0.06, 0.0000223],
  [0.07, 0.0000261],
  [0.08, 0.0000298],
  [0.09, 0.0000336],
  [0.10, 0.0000373],
  [0.11, 0.0000411],
  [0.12, 0.0000448],
  [0.13, 0.0000487],
  [0.14, 0.0000531],
  [0.15, 0.0000594],
  [0.16, 0.0000737],
  [0.17, 0.0001284],
  [0.18, 0.0006107],
  [0.19, 0.04],
  [1.00, 0.04], // anything above 19% is capped
];

/**
 * Estimate the hourly funding rate for a Ventuals pre-IPO market
 * given the average mark-to-oracle premium (TWAP).
 * Uses linear interpolation on the official rate table.
 *
 * @param premium  TWAP premium as a decimal (e.g. 0.18 for 18%)
 * @returns        hourly funding rate as a decimal (e.g. 0.0006107 for 0.06107%)
 */
export function estimateVentualsFundingRate(premium: number): number {
  const abs = Math.abs(premium);
  const sign = premium >= 0 ? 1 : -1;

  for (let i = 0; i < VENTUALS_FR_TABLE.length - 1; i++) {
    const [d0, r0] = VENTUALS_FR_TABLE[i];
    const [d1, r1] = VENTUALS_FR_TABLE[i + 1];
    if (abs >= d0 && abs < d1) {
      const t = (abs - d0) / (d1 - d0);
      return sign * (r0 + t * (r1 - r0));
    }
  }

  return sign * 0.04; // above table range — capped
}

/**
 * Estimate the hourly funding rate for a standard Hyperliquid perp.
 * Simple clamp of the TWAP premium to ±4%.
 */
export function estimateHyperliquidFundingRate(premium: number): number {
  return Math.max(-0.04, Math.min(0.04, premium));
}

/**
 * Estimate the hourly funding rate, dispatching to the correct formula
 * based on coin type.
 *
 * Ventuals coins (vntl:*) use the Ventuals multiplier table.
 * Regular Hyperliquid coins use direct premium clamping.
 */
export function estimateFundingRate(premium: number, coin: string): number {
  if (coin.toLowerCase().startsWith('vntl:')) {
    return estimateVentualsFundingRate(premium);
  }
  return estimateHyperliquidFundingRate(premium);
}
