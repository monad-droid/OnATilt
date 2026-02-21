'use client';

import { useEffect, useRef, useState, useCallback } from 'react';
import { estimateFundingRate } from '@/lib/fundingRate';

export interface PremiumSample {
  time: number;      // Unix ms
  premium: number;   // raw premium from API
  markPx: number;
  oraclePx: number;
}

export interface FundingEstimate {
  hourStart: number;       // Unix ms — start of the funding hour
  premiumAvg: number;      // our TWAP premium estimate (raw)
  estimatedFR: number;     // computed hourly funding rate via Ventuals formula
  actual: number | null;   // actual settled funding rate (null until backfilled)
}

interface UsePremiumPollerResult {
  /** Samples collected during the current funding hour */
  samples: PremiumSample[];
  /** Time-weighted average premium for the current hour so far */
  runningAvg: number;
  /** Unix ms timestamp of the current funding hour start */
  hourStart: number;
  /** Whether the poller is actively running */
  active: boolean;
  /** Historical estimates vs actuals (persisted to localStorage) */
  estimates: FundingEstimate[];
}

const POLL_INTERVAL_MS = 30_000; // 30 seconds
const EST_STORAGE_KEY = 'funding-estimates';
const MAX_ESTIMATES = 168; // 1 week of hourly data

function getCurrentHourStart(): number {
  return Math.floor(Date.now() / 3_600_000) * 3_600_000;
}

// ---- localStorage persistence ----

function loadEstimates(coin: string): FundingEstimate[] {
  if (typeof window === 'undefined') return [];
  try {
    const raw = localStorage.getItem(`${EST_STORAGE_KEY}:${coin}`);
    return raw ? JSON.parse(raw) : [];
  } catch { return []; }
}

function persistEstimates(coin: string, est: FundingEstimate[]) {
  if (typeof window === 'undefined') return;
  try {
    localStorage.setItem(
      `${EST_STORAGE_KEY}:${coin}`,
      JSON.stringify(est.slice(-MAX_ESTIMATES)),
    );
  } catch { /* quota exceeded — ignore */ }
}

/**
 * Polls metaAndAssetCtxs every 30s and accumulates premium samples
 * for the current funding hour. Resets when the hour rolls over.
 *
 * On hour rollover, captures the final TWAP premium as an estimate
 * and persists to localStorage. Backfills actual settled rates from
 * the funding API after settlement.
 */
export function usePremiumPoller(coin: string | null): UsePremiumPollerResult {
  const [samples, setSamples] = useState<PremiumSample[]>([]);
  const [hourStart, setHourStart] = useState(getCurrentHourStart);
  const [estimates, setEstimates] = useState<FundingEstimate[]>([]);

  const samplesRef = useRef<PremiumSample[]>([]);
  const hourStartRef = useRef(hourStart);
  const estimatesRef = useRef<FundingEstimate[]>([]);
  const lastBackfillRef = useRef(0);

  // Keep refs in sync
  hourStartRef.current = hourStart;

  const poll = useCallback(async () => {
    if (!coin) return;

    try {
      const res = await fetch('/api/market-data', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'asset-context', coin }),
      });

      if (!res.ok) {
        console.warn(`[PremiumPoller] API returned ${res.status}`);
        return;
      }
      const data = await res.json();
      if (!data.context) {
        console.warn(`[PremiumPoller] No context in response for "${coin}"`, data);
        return;
      }

      const now = Date.now();
      const currentHour = getCurrentHourStart();

      // Hour rolled over — capture estimate, then flush samples
      if (currentHour !== hourStartRef.current) {
        if (samplesRef.current.length >= 2) {
          const avg = computeTimeWeightedAvg(samplesRef.current);
          const fr = estimateFundingRate(avg, coin);
          const est: FundingEstimate = {
            hourStart: hourStartRef.current,
            premiumAvg: avg,
            estimatedFR: fr,
            actual: null,
          };
          estimatesRef.current = [...estimatesRef.current, est].slice(-MAX_ESTIMATES);
          setEstimates([...estimatesRef.current]);
          persistEstimates(coin, estimatesRef.current);
          console.log(
            `[PremiumPoller] Hour rolled over — saved estimate: premiumAvg=${avg.toFixed(6)}, estimatedFR=${(fr * 100).toFixed(6)}%`,
          );
        }
        samplesRef.current = [];
        setHourStart(currentHour);
      }

      const sample: PremiumSample = {
        time: now,
        premium: parseFloat(data.context.premium),
        markPx: parseFloat(data.context.markPx),
        oraclePx: parseFloat(data.context.oraclePx),
      };

      samplesRef.current = [...samplesRef.current, sample];
      setSamples([...samplesRef.current]);

      // ---- Backfill actual rates for pending estimates (throttled to every 2 min) ----
      const pendingEstimates = estimatesRef.current.filter(
        e => e.actual === null && now - (e.hourStart + 3_600_000) > 90_000,
      );
      if (pendingEstimates.length > 0 && now - lastBackfillRef.current > 120_000) {
        lastBackfillRef.current = now;
        try {
          const fRes = await fetch('/api/funding', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ coin, days: 1 }),
          });
          const fData = await fRes.json();
          if (fData.fundingHistory) {
            const rateByHour = new Map<number, number>();
            for (const f of fData.fundingHistory) {
              const hk = Math.floor(f.time / 3_600_000) * 3_600_000 - 3_600_000;
              rateByHour.set(hk, parseFloat(f.fundingRate));
            }
            let changed = false;
            const updated = estimatesRef.current.map(e => {
              if (e.actual === null) {
                const actual = rateByHour.get(e.hourStart);
                if (actual !== undefined) {
                  changed = true;
                  return { ...e, actual };
                }
              }
              return e;
            });
            if (changed) {
              estimatesRef.current = updated;
              setEstimates([...updated]);
              persistEstimates(coin, updated);
              console.log('[PremiumPoller] Backfilled actual rates for pending estimates');
            }
          }
        } catch { /* backfill is best-effort */ }
      }
    } catch (err) {
      console.error(`[PremiumPoller] Poll failed:`, err);
    }
  }, [coin]);

  useEffect(() => {
    if (!coin) {
      samplesRef.current = [];
      setSamples([]);
      return;
    }

    // Reset on coin change
    samplesRef.current = [];
    setSamples([]);
    setHourStart(getCurrentHourStart());

    // Load persisted estimates for this coin
    const loaded = loadEstimates(coin);
    estimatesRef.current = loaded;
    setEstimates(loaded);

    // Initial poll immediately
    poll();

    const id = setInterval(poll, POLL_INTERVAL_MS);
    return () => clearInterval(id);
  }, [coin, poll]);

  // Compute time-weighted average
  const runningAvg = computeTimeWeightedAvg(samples);

  return {
    samples,
    runningAvg,
    hourStart,
    active: !!coin,
    estimates,
  };
}

/**
 * Time-weighted average of premium samples within the current hour.
 * Each sample's weight = duration until the next sample (or until now for the last).
 */
function computeTimeWeightedAvg(samples: PremiumSample[]): number {
  if (samples.length === 0) return 0;
  if (samples.length === 1) return samples[0].premium;

  const now = Date.now();
  let weightedSum = 0;
  let totalWeight = 0;

  for (let i = 0; i < samples.length; i++) {
    const start = samples[i].time;
    const end = i < samples.length - 1 ? samples[i + 1].time : now;
    const weight = end - start;
    weightedSum += samples[i].premium * weight;
    totalWeight += weight;
  }

  return totalWeight > 0 ? weightedSum / totalWeight : samples[0].premium;
}
