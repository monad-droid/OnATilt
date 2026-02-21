'use client';

import { useEffect, useRef, useState, useCallback, useMemo } from 'react';
import {
  createChart,
  HistogramSeries,
  LineSeries,
} from 'lightweight-charts';
import type { IChartApi, UTCTimestamp } from 'lightweight-charts';
import type { FundingRate, Candle } from '@/types';
import { usePremiumPoller } from '@/hooks/usePremiumPoller';
import IntraHourChart from './IntraHourChart';

interface FundingChartProps {
  height?: number;
}

type RangeOption = '7d' | '14d' | '30d' | '90d' | 'max';

const RANGE_OPTIONS: { label: string; value: RangeOption; days: number }[] = [
  { label: '7D', value: '7d', days: 7 },
  { label: '14D', value: '14d', days: 14 },
  { label: '30D', value: '30d', days: 30 },
  { label: '90D', value: '90d', days: 90 },
  { label: 'MAX', value: 'max', days: 365 },
];

function toTime(ms: number): UTCTimestamp {
  return (ms / 1000) as UTCTimestamp;
}

export default function FundingChart({ height = 600 }: FundingChartProps) {
  const chartContainerRef = useRef<HTMLDivElement>(null);
  const chartRef = useRef<IChartApi | null>(null);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const tradeSeriesRef = useRef<any>(null);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const oracleSeriesRef = useRef<any>(null);

  const [coin, setCoin] = useState('vntl:OPENAI');
  const [range, setRange] = useState<RangeOption>('30d');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [fundingData, setFundingData] = useState<FundingRate[]>([]);
  const [priceData, setPriceData] = useState<Candle[]>([]);
  const [currentPrices, setCurrentPrices] = useState<{ markPx: number; oraclePx: number; premium: number } | null>(null);
  const [crosshairPrices, setCrosshairPrices] = useState<{ trade: number; oracle: number; diff: number } | null>(null);
  const [crosshairFundingRate, setCrosshairFundingRate] = useState<number | null>(null);
  const [predictedFunding, setPredictedFunding] = useState<{ rate: number; nextTime: number; estimated: boolean } | null>(null);

  // Normalized coin for polling (matches format sent to API)
  const normalizedCoin = useMemo(() => {
    const raw = coin.trim();
    if (!raw) return null;
    return raw.includes(':')
      ? raw.split(':')[0].toLowerCase() + ':' + raw.split(':')[1].toUpperCase()
      : raw.toUpperCase();
  }, [coin]);

  // Poll premium every 30s for intra-hour chart (start immediately when coin is set)
  const premiumPoller = usePremiumPoller(normalizedCoin);

  const fetchFunding = useCallback(async (overrideCoin?: string, overrideRange?: RangeOption) => {
    const raw = overrideCoin ?? coin;
    const r = overrideRange ?? range;
    const days = RANGE_OPTIONS.find(o => o.value === r)?.days ?? 30;

    if (!raw.trim()) return;

    // Normalize: vntl: prefix stays lowercase, coin name uppercased
    const c = raw.includes(':')
      ? raw.split(':')[0].toLowerCase() + ':' + raw.split(':')[1].toUpperCase()
      : raw.toUpperCase();

    setLoading(true);
    setError(null);

    try {
      const res = await fetch('/api/funding', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ coin: c, days }),
      });

      const data = await res.json();

      if (data.error) {
        setError(data.error);
        return;
      }

      const history = data.fundingHistory || [];
      setFundingData(history);

      if (history.length === 0) {
        setError(`No funding data returned for "${c}". Check the coin symbol matches exactly (e.g. vntl:OPENAI, vntl:ANTHROPIC).`);
      }

      // Fetch current prices + predicted funding in parallel
      const [ctxRes, predRes] = await Promise.all([
        fetch('/api/market-data', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ action: 'asset-context', coin: c }),
        }),
        fetch('/api/market-data', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ action: 'predicted-funding', coin: c }),
        }),
      ]);
      const ctxData = await ctxRes.json();
      if (ctxData.context) {
        setCurrentPrices({
          markPx: parseFloat(ctxData.context.markPx),
          oraclePx: parseFloat(ctxData.context.oraclePx),
          premium: parseFloat(ctxData.context.premium),
        });
      } else {
        setCurrentPrices(null);
      }
      const predData = await predRes.json();
      if (predData.predicted) {
        setPredictedFunding({
          rate: parseFloat(predData.predicted.fundingRate),
          nextTime: predData.predicted.nextFundingTime,
          estimated: !!predData.estimated,
        });
      } else {
        setPredictedFunding(null);
      }

      // Fetch hourly candle data for price chart (non-fatal — some tokens don't have candles)
      try {
        const candleCoin = c.replace('-PERP', '');
        const candleRes = await fetch('/api/market-data', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            action: 'candles',
            coin: candleCoin,
            timeframe: '1h',
            limit: days * 24,
          }),
        });
        if (candleRes.ok) {
          const candleData = await candleRes.json();
          setPriceData(candleData.candles || []);
        } else {
          setPriceData([]);
        }
      } catch {
        setPriceData([]);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to fetch funding data');
    } finally {
      setLoading(false);
    }
  }, [coin, range]);

  // Build sorted premium + funding arrays for nearest-timestamp matching.
  // Funding `time` is the settlement (end-of-hour), candle `time` is the open
  // (start-of-hour), so we snap funding to the previous hour boundary to align.
  const { premiumByHour, fundingByHour } = useMemo(() => {
    const pMap = new Map<number, number>();
    const fMap = new Map<number, number>();
    for (const f of fundingData) {
      // Snap to previous hour: settlement at 15:00:00.048 → period start 14:00
      const hourStart = Math.floor(f.time / 3_600_000) * 3_600_000 - 3_600_000;
      pMap.set(hourStart, parseFloat(f.premium));
      fMap.set(hourStart, parseFloat(f.fundingRate));
    }
    return { premiumByHour: pMap, fundingByHour: fMap };
  }, [fundingData]);

  // Single chart with two panes (v5 multi-pane: shared time scale, no sync needed)
  useEffect(() => {
    if (!chartContainerRef.current || fundingData.length === 0) return;

    if (chartRef.current) {
      chartRef.current.remove();
      chartRef.current = null;
    }

    const chartHeight = priceData.length > 0 ? height - 50 : height - 200;

    const chart = createChart(chartContainerRef.current, {
      width: chartContainerRef.current.clientWidth,
      height: chartHeight,
      layout: {
        background: { color: '#0a0a0f' },
        textColor: '#9ca3af',
        fontSize: 11,
      },
      grid: {
        vertLines: { color: '#1f2937' },
        horzLines: { color: '#1f2937' },
      },
      timeScale: {
        timeVisible: true,
        secondsVisible: false,
        borderColor: '#374151',
      },
      rightPriceScale: {
        borderColor: '#374151',
      },
      crosshair: {
        horzLine: { color: '#4b5563' },
        vertLine: { color: '#4b5563' },
      },
    });

    chartRef.current = chart;

    // --- Pane 0 (top): Price lines ---
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    let tradeSeries: any = null;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    let oracleSeries: any = null;

    if (priceData.length > 0) {
      tradeSeries = chart.addSeries(LineSeries, {
        color: '#06b6d4',
        lineWidth: 2,
        title: 'Trade',
        priceFormat: { type: 'price', precision: 4, minMove: 0.0001 },
      }, 0);

      oracleSeries = chart.addSeries(LineSeries, {
        color: '#8b5cf6',
        lineWidth: 2,
        title: 'Oracle (est.)',
        priceFormat: { type: 'price', precision: 4, minMove: 0.0001 },
      }, 0);

      const tradeData = priceData.map(c => ({
        time: toTime(c.time),
        value: c.close,
      }));

      const oracleData = priceData
        .map(c => {
          const hourKey = Math.floor(c.time / 3_600_000) * 3_600_000;
          const premium = premiumByHour.get(hourKey);
          if (premium === undefined) return null;
          return { time: toTime(c.time), value: c.close / (1 + premium) };
        })
        .filter((d): d is { time: UTCTimestamp; value: number } => d !== null);

      tradeSeries.setData(tradeData);
      oracleSeries.setData(oracleData);

      tradeSeriesRef.current = tradeSeries;
      oracleSeriesRef.current = oracleSeries;
    }

    // --- Pane 1 (bottom): Funding rate histogram ---
    const fundingPane = priceData.length > 0 ? 1 : 0;
    const histogramSeries = chart.addSeries(HistogramSeries, {
      priceFormat: {
        type: 'price',
        precision: 6,
        minMove: 0.000001,
      },
    }, fundingPane);

    // Snap funding bars to the same hour grid as candles (period start)
    const histogramData = fundingData.map(r => {
      const rate = parseFloat(r.fundingRate);
      const hourStart = Math.floor(r.time / 3_600_000) * 3_600_000 - 3_600_000;
      return {
        time: toTime(hourStart),
        value: rate * 100,
        color: rate >= 0 ? '#22c55e' : '#ef4444',
      };
    });

    histogramSeries.setData(histogramData);
    chart.timeScale().fitContent();

    // Crosshair: show all values from both panes.
    // Keep last-known values so hovering a funding-only timestamp
    // doesn't blank the price / diff legend.
    chart.subscribeCrosshairMove((param) => {
      if (!param.time || !param.seriesData) {
        setCrosshairFundingRate(null);
        setCrosshairPrices(null);
        return;
      }

      // Funding rate
      const fundingPoint = param.seriesData.get(histogramSeries) as { value?: number } | undefined;
      if (fundingPoint?.value !== undefined) {
        setCrosshairFundingRate(fundingPoint.value);
      }

      // Price + diff — only update when we actually have data
      if (tradeSeries && oracleSeries) {
        const tradePoint = param.seriesData.get(tradeSeries) as { value?: number } | undefined;
        const oraclePoint = param.seriesData.get(oracleSeries) as { value?: number } | undefined;
        const trade = tradePoint?.value;
        const oracle = oraclePoint?.value;
        if (trade !== undefined && oracle !== undefined && oracle > 0) {
          setCrosshairPrices({ trade, oracle, diff: ((trade - oracle) / oracle) * 100 });
        } else if (trade !== undefined) {
          setCrosshairPrices({ trade, oracle: 0, diff: 0 });
        }
        // else: keep previous values
      }
    });

    const handleResize = () => {
      if (chartContainerRef.current && chartRef.current) {
        chartRef.current.applyOptions({ width: chartContainerRef.current.clientWidth });
      }
    };

    const resizeObserver = new ResizeObserver(handleResize);
    resizeObserver.observe(chartContainerRef.current);

    return () => {
      resizeObserver.disconnect();
      tradeSeriesRef.current = null;
      oracleSeriesRef.current = null;
      if (chartRef.current) {
        chartRef.current.remove();
        chartRef.current = null;
      }
    };
  }, [fundingData, priceData, premiumByHour, fundingByHour, height]);

  // Stream live mark/oracle prices from the premium poller onto the price chart
  useEffect(() => {
    if (!tradeSeriesRef.current || !oracleSeriesRef.current) return;
    if (premiumPoller.samples.length === 0 || priceData.length === 0) return;

    // Rebuild historical arrays
    const tradeData = priceData.map(c => ({
      time: toTime(c.time),
      value: c.close,
    }));

    const oracleData = priceData
      .map(c => {
        const hourKey = Math.floor(c.time / 3_600_000) * 3_600_000;
        const premium = premiumByHour.get(hourKey);
        if (premium === undefined) return null;
        return { time: toTime(c.time), value: c.close / (1 + premium) };
      })
      .filter((d): d is { time: UTCTimestamp; value: number } => d !== null);

    // Append live samples (only those after the last historical candle)
    const lastHistTime = tradeData[tradeData.length - 1].time;
    for (const sample of premiumPoller.samples) {
      const t = toTime(sample.time);
      if (t > lastHistTime) {
        tradeData.push({ time: t, value: sample.markPx });
        oracleData.push({ time: t, value: sample.oraclePx });
      }
    }

    tradeSeriesRef.current.setData(tradeData);
    oracleSeriesRef.current.setData(oracleData);
  }, [premiumPoller.samples, priceData, premiumByHour]);

  // Keep current-prices cards in sync with latest poller sample
  useEffect(() => {
    if (premiumPoller.samples.length === 0) return;
    const latest = premiumPoller.samples[premiumPoller.samples.length - 1];
    setCurrentPrices({
      markPx: latest.markPx,
      oraclePx: latest.oraclePx,
      premium: latest.premium,
    });
  }, [premiumPoller.samples]);

  // Compute stats
  const stats = computeStats(fundingData);

  return (
    <div className="border border-gray-800 rounded-xl p-4" style={{ minHeight: height }}>
      {/* Controls */}
      <div className="flex items-center gap-3 flex-wrap mb-4">
        <input
          type="text"
          value={coin}
          onChange={(e) => setCoin(e.target.value)}
          placeholder="vntl:OPENAI"
          className="w-36 bg-gray-900 border border-gray-700 rounded-lg px-3 py-1.5 text-white text-sm font-semibold focus:outline-none focus:border-blue-500 text-center"
        />

        <div className="flex gap-1 bg-gray-900 rounded-lg p-0.5">
          {RANGE_OPTIONS.map((opt) => (
            <button
              key={opt.value}
              onClick={() => {
                setRange(opt.value);
                if (coin.trim()) fetchFunding(undefined, opt.value);
              }}
              className={`px-3 py-1 rounded text-xs font-medium transition-colors ${
                range === opt.value
                  ? 'bg-blue-500 text-white'
                  : 'text-gray-400 hover:text-white hover:bg-gray-800'
              }`}
            >
              {opt.label}
            </button>
          ))}
        </div>

        <button
          onClick={() => fetchFunding()}
          disabled={loading || !coin.trim()}
          className="px-5 py-1.5 bg-blue-500 text-white rounded-lg text-sm font-medium disabled:opacity-50 hover:bg-blue-600 transition-colors"
        >
          {loading ? 'Loading...' : 'Load Funding'}
        </button>

        {fundingData.length > 0 && (
          <span className="text-xs text-gray-500 ml-2">
            <span className="text-white font-medium">{fundingData.length}</span> hourly samples
          </span>
        )}
      </div>

      {error && (
        <div className="bg-red-500/10 border border-red-500/30 rounded-lg p-3 text-red-400 text-sm mb-4">
          {error}
        </div>
      )}

      {/* Chart legend */}
      {fundingData.length > 0 && (
        <div className="flex items-center gap-4 flex-wrap mb-2">
          {priceData.length > 0 && (
            <div className="flex items-center gap-3 text-xs">
              {premiumPoller.samples.length > 0 && (
                <span className="flex items-center gap-1.5 text-green-400">
                  <span className="relative flex h-2 w-2">
                    <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-green-400 opacity-75" />
                    <span className="relative inline-flex rounded-full h-2 w-2 bg-green-500" />
                  </span>
                  <span className="text-[10px] font-semibold uppercase tracking-wider">Live</span>
                </span>
              )}
              <span className="flex items-center gap-1.5">
                <span className="inline-block w-3 h-0.5 bg-[#06b6d4] rounded" />
                <span className="text-gray-400">Trade</span>
                {crosshairPrices && (
                  <span className="text-[#06b6d4] font-medium">${crosshairPrices.trade.toFixed(4)}</span>
                )}
              </span>
              <span className="flex items-center gap-1.5">
                <span className="inline-block w-3 h-0.5 bg-[#8b5cf6] rounded" />
                <span className="text-gray-400">Oracle (est.)</span>
                {crosshairPrices && crosshairPrices.oracle > 0 && (
                  <span className="text-[#8b5cf6] font-medium">${crosshairPrices.oracle.toFixed(4)}</span>
                )}
              </span>
              {crosshairPrices && crosshairPrices.oracle > 0 && (
                <span className={`font-medium ${crosshairPrices.diff >= 0 ? 'text-green-400' : 'text-red-400'}`}>
                  Diff: {crosshairPrices.diff >= 0 ? '+' : ''}{crosshairPrices.diff.toFixed(4)}%
                </span>
              )}
            </div>
          )}
          <div className="flex items-center gap-1.5 text-xs">
            <span className="text-gray-400">Funding</span>
            {crosshairFundingRate !== null && (
              <span className={`font-medium ${crosshairFundingRate >= 0 ? 'text-green-400' : 'text-red-400'}`}>
                {crosshairFundingRate >= 0 ? '+' : ''}{crosshairFundingRate.toFixed(6)}%
              </span>
            )}
          </div>
        </div>
      )}

      {/* Single multi-pane chart */}
      <div ref={chartContainerRef} />

      {/* Current Prices (real API values from metaAndAssetCtxs) */}
      {currentPrices && (
        <div className="mt-4 grid grid-cols-2 md:grid-cols-4 gap-3">
          <div className="bg-gray-900/50 border border-gray-800 rounded-lg p-3">
            <div className="text-gray-400 text-xs mb-1">Mark Price</div>
            <div className="text-lg font-semibold text-[#06b6d4]">${currentPrices.markPx.toFixed(4)}</div>
            <div className="text-gray-500 text-xs mt-0.5">live from API</div>
          </div>
          <div className="bg-gray-900/50 border border-gray-800 rounded-lg p-3">
            <div className="text-gray-400 text-xs mb-1">Oracle Price</div>
            <div className="text-lg font-semibold text-[#8b5cf6]">${currentPrices.oraclePx.toFixed(4)}</div>
            <div className="text-gray-500 text-xs mt-0.5">live from API</div>
          </div>
          <div className="bg-gray-900/50 border border-gray-800 rounded-lg p-3">
            <div className="text-gray-400 text-xs mb-1">Mark-Oracle Diff</div>
            {(() => {
              const diff = currentPrices.oraclePx > 0
                ? ((currentPrices.markPx - currentPrices.oraclePx) / currentPrices.oraclePx) * 100
                : 0;
              return (
                <div className={`text-lg font-semibold ${diff >= 0 ? 'text-green-400' : 'text-red-400'}`}>
                  {diff >= 0 ? '+' : ''}{diff.toFixed(4)}%
                </div>
              );
            })()}
            <div className="text-gray-500 text-xs mt-0.5">premium={currentPrices.premium.toFixed(6)}</div>
          </div>
          <div className="bg-gray-900/50 border border-gray-800 rounded-lg p-3">
            <div className="text-gray-400 text-xs mb-1">
              Next Funding{predictedFunding?.estimated ? ' (est.)' : ''}
            </div>
            {predictedFunding ? (
              <>
                <div className={`text-lg font-semibold ${predictedFunding.rate >= 0 ? 'text-green-400' : 'text-red-400'}`}>
                  {predictedFunding.rate >= 0 ? '+' : ''}{(predictedFunding.rate * 100).toFixed(4)}%
                </div>
                <div className="text-gray-500 text-xs mt-0.5">
                  {(predictedFunding.rate * 100 * 8760).toFixed(1)}% ann.
                  {' · '}settles {new Date(predictedFunding.nextTime).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                </div>
              </>
            ) : (
              <div className="text-gray-500 text-sm">unavailable</div>
            )}
          </div>
        </div>
      )}

      {/* Intra-hour premium chart */}
      {premiumPoller.active && (
        <div className="mt-4">
          <IntraHourChart
            samples={premiumPoller.samples}
            runningAvg={premiumPoller.runningAvg}
            hourStart={premiumPoller.hourStart}
          />
        </div>
      )}

      {/* Stats */}
      {fundingData.length > 0 && stats && (
        <div className="mt-4 grid grid-cols-2 md:grid-cols-4 gap-3">
          <StatCard
            label="Current Rate"
            value={`${stats.currentRate >= 0 ? '+' : ''}${stats.currentRate.toFixed(4)}%`}
            sub="per hour"
            color={stats.currentRate >= 0 ? 'green' : 'red'}
          />
          <StatCard
            label="Average Rate"
            value={`${stats.avgRate >= 0 ? '+' : ''}${stats.avgRate.toFixed(4)}%`}
            sub={`over ${stats.sampleCount} hours`}
            color={stats.avgRate >= 0 ? 'green' : 'red'}
          />
          <StatCard
            label="Cumulative"
            value={`${stats.cumulative >= 0 ? '+' : ''}${stats.cumulative.toFixed(4)}%`}
            sub={`${stats.days}d total`}
            color={stats.cumulative >= 0 ? 'green' : 'red'}
          />
          <StatCard
            label="Annualized"
            value={`${stats.annualized >= 0 ? '+' : ''}${stats.annualized.toFixed(2)}%`}
            sub="projected APR"
            color={stats.annualized >= 0 ? 'green' : 'red'}
          />
        </div>
      )}

      {/* Detailed breakdown table */}
      {fundingData.length > 0 && stats && (
        <div className="mt-4">
          <div className="flex items-center justify-between mb-2">
            <h4 className="text-white text-sm font-medium">Daily Breakdown</h4>
            <div className="flex gap-3 text-xs">
              <span className="text-gray-400">
                Positive hours: <span className="text-green-400">{stats.positiveCount}</span>
              </span>
              <span className="text-gray-400">
                Negative hours: <span className="text-red-400">{stats.negativeCount}</span>
              </span>
            </div>
          </div>

          <div className="max-h-48 overflow-y-auto border border-gray-800 rounded-lg">
            <table className="w-full text-xs">
              <thead className="sticky top-0 bg-gray-900">
                <tr className="text-gray-400">
                  <th className="text-left px-3 py-2">Date</th>
                  <th className="text-right px-3 py-2">Avg Rate/hr</th>
                  <th className="text-right px-3 py-2">Min</th>
                  <th className="text-right px-3 py-2">Max</th>
                  <th className="text-right px-3 py-2">Daily Total</th>
                  <th className="text-right px-3 py-2">Samples</th>
                </tr>
              </thead>
              <tbody>
                {stats.dailyBreakdown.map((day) => (
                  <tr key={day.date} className="border-t border-gray-800/50 hover:bg-gray-900/50">
                    <td className="px-3 py-1.5 text-gray-300">{day.date}</td>
                    <td className={`px-3 py-1.5 text-right ${day.avg >= 0 ? 'text-green-400' : 'text-red-400'}`}>
                      {day.avg >= 0 ? '+' : ''}{day.avg.toFixed(4)}%
                    </td>
                    <td className={`px-3 py-1.5 text-right ${day.min >= 0 ? 'text-green-400' : 'text-red-400'}`}>
                      {day.min >= 0 ? '+' : ''}{day.min.toFixed(4)}%
                    </td>
                    <td className={`px-3 py-1.5 text-right ${day.max >= 0 ? 'text-green-400' : 'text-red-400'}`}>
                      {day.max >= 0 ? '+' : ''}{day.max.toFixed(4)}%
                    </td>
                    <td className={`px-3 py-1.5 text-right font-medium ${day.total >= 0 ? 'text-green-400' : 'text-red-400'}`}>
                      {day.total >= 0 ? '+' : ''}{day.total.toFixed(4)}%
                    </td>
                    <td className="px-3 py-1.5 text-right text-gray-500">{day.count}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* Empty state */}
      {fundingData.length === 0 && !loading && !error && (
        <div className="flex items-center justify-center text-gray-500 text-sm" style={{ height: height - 200 }}>
          Enter a coin symbol and click &quot;Load Funding&quot; to view historical funding rates
        </div>
      )}
    </div>
  );
}

// ============================================================
// Stats Computation
// ============================================================

interface DailyBreakdown {
  date: string;
  avg: number;
  min: number;
  max: number;
  total: number;
  count: number;
}

interface FundingStats {
  currentRate: number;
  avgRate: number;
  cumulative: number;
  annualized: number;
  positiveCount: number;
  negativeCount: number;
  sampleCount: number;
  days: number;
  dailyBreakdown: DailyBreakdown[];
}

function computeStats(data: FundingRate[]): FundingStats | null {
  if (data.length === 0) return null;

  const rates = data.map(d => parseFloat(d.fundingRate) * 100); // as percentages

  const currentRate = rates[rates.length - 1];
  const avgRate = rates.reduce((sum, r) => sum + r, 0) / rates.length;
  const cumulative = rates.reduce((sum, r) => sum + r, 0);
  const positiveCount = rates.filter(r => r >= 0).length;
  const negativeCount = rates.filter(r => r < 0).length;

  // Annualized: average hourly rate * 8760 hours/year
  const annualized = avgRate * 8760;

  // Time span in days
  const firstTime = data[0].time;
  const lastTime = data[data.length - 1].time;
  const days = Math.max(1, Math.round((lastTime - firstTime) / 86_400_000));

  // Daily breakdown
  const dayMap = new Map<string, number[]>();
  for (const d of data) {
    const date = new Date(d.time).toISOString().split('T')[0];
    if (!dayMap.has(date)) dayMap.set(date, []);
    dayMap.get(date)!.push(parseFloat(d.fundingRate) * 100);
  }

  const dailyBreakdown: DailyBreakdown[] = [];
  for (const [date, dayRates] of dayMap) {
    dailyBreakdown.push({
      date,
      avg: dayRates.reduce((s, r) => s + r, 0) / dayRates.length,
      min: Math.min(...dayRates),
      max: Math.max(...dayRates),
      total: dayRates.reduce((s, r) => s + r, 0),
      count: dayRates.length,
    });
  }

  // Sort most recent first
  dailyBreakdown.sort((a, b) => b.date.localeCompare(a.date));

  return {
    currentRate,
    avgRate,
    cumulative,
    annualized,
    positiveCount,
    negativeCount,
    sampleCount: rates.length,
    days,
    dailyBreakdown,
  };
}

// ============================================================
// Stat Card Component
// ============================================================

function StatCard({ label, value, sub, color }: {
  label: string;
  value: string;
  sub: string;
  color: 'green' | 'red';
}) {
  return (
    <div className="bg-gray-900/50 border border-gray-800 rounded-lg p-3">
      <div className="text-gray-400 text-xs mb-1">{label}</div>
      <div className={`text-lg font-semibold ${color === 'green' ? 'text-green-400' : 'text-red-400'}`}>
        {value}
      </div>
      <div className="text-gray-500 text-xs mt-0.5">{sub}</div>
    </div>
  );
}
