'use client';

import { useEffect, useRef, useState, useCallback } from 'react';

export interface PremiumSample {
  time: number;      // Unix ms
  premium: number;   // raw premium from API
  markPx: number;
  oraclePx: number;
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
}

const POLL_INTERVAL_MS = 30_000; // 30 seconds

function getCurrentHourStart(): number {
  return Math.floor(Date.now() / 3_600_000) * 3_600_000;
}

/**
 * Polls metaAndAssetCtxs every 30s and accumulates premium samples
 * for the current funding hour. Resets when the hour rolls over.
 */
export function usePremiumPoller(coin: string | null): UsePremiumPollerResult {
  const [samples, setSamples] = useState<PremiumSample[]>([]);
  const [hourStart, setHourStart] = useState(getCurrentHourStart);
  const samplesRef = useRef<PremiumSample[]>([]);
  const hourStartRef = useRef(hourStart);

  // Keep refs in sync
  hourStartRef.current = hourStart;

  const poll = useCallback(async () => {
    if (!coin) return;

    try {
      console.log(`[PremiumPoller] Polling for coin: "${coin}"`);
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

      // Hour rolled over — flush old samples
      if (currentHour !== hourStartRef.current) {
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
      console.log(`[PremiumPoller] Sample #${samplesRef.current.length}: premium=${sample.premium}, mark=${sample.markPx}, oracle=${sample.oraclePx}`);
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

    // Initial poll immediately
    poll();

    const id = setInterval(poll, POLL_INTERVAL_MS);
    return () => clearInterval(id);
  }, [coin, poll]);

  // Compute time-weighted average
  const runningAvg = computeTimeWeightedAvg(samples, hourStart);

  return {
    samples,
    runningAvg,
    hourStart,
    active: !!coin,
  };
}

/**
 * Time-weighted average of premium samples within the current hour.
 * Each sample's weight = duration until the next sample (or until now for the last).
 */
function computeTimeWeightedAvg(samples: PremiumSample[], hourStart: number): number {
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
