'use client';

import { useEffect, useRef, useState, useCallback, useMemo } from 'react';
import {
  createChart,
  HistogramSeries,
  LineSeries,
} from 'lightweight-charts';
import type { IChartApi, UTCTimestamp } from 'lightweight-charts';
import type { FundingRate, Candle } from '@/types';

interface FundingChartProps {
  height?: number;
}

type RangeOption = '7d' | '14d' | '30d' | '90d';

const RANGE_OPTIONS: { label: string; value: RangeOption; days: number }[] = [
  { label: '7D', value: '7d', days: 7 },
  { label: '14D', value: '14d', days: 14 },
  { label: '30D', value: '30d', days: 30 },
  { label: '90D', value: '90d', days: 90 },
];

function toTime(ms: number): UTCTimestamp {
  return (ms / 1000) as UTCTimestamp;
}

export default function FundingChart({ height = 600 }: FundingChartProps) {
  const chartContainerRef = useRef<HTMLDivElement>(null);
  const chartRef = useRef<IChartApi | null>(null);
  const priceChartContainerRef = useRef<HTMLDivElement>(null);
  const priceChartRef = useRef<IChartApi | null>(null);

  const [coin, setCoin] = useState('vntl:OPENAI');
  const [range, setRange] = useState<RangeOption>('30d');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [fundingData, setFundingData] = useState<FundingRate[]>([]);
  const [priceData, setPriceData] = useState<Candle[]>([]);
  const [currentPrices, setCurrentPrices] = useState<{ markPx: number; oraclePx: number; premium: number } | null>(null);
  const [crosshairPrices, setCrosshairPrices] = useState<{ trade: number; oracle: number; diff: number } | null>(null);
  const isSyncing = useRef(false);

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

      // Fetch current real oracle/mark prices from API
      const ctxRes = await fetch('/api/market-data', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'asset-context', coin: c }),
      });
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

  // Render chart when data changes
  useEffect(() => {
    if (!chartContainerRef.current || fundingData.length === 0) return;

    // Clean up previous chart
    if (chartRef.current) {
      chartRef.current.remove();
      chartRef.current = null;
    }

    const chart = createChart(chartContainerRef.current, {
      width: chartContainerRef.current.clientWidth,
      height: height - 200, // leave room for stats
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

    const histogramSeries = chart.addSeries(HistogramSeries, {
      priceFormat: {
        type: 'price',
        precision: 6,
        minMove: 0.000001,
      },
    });

    const histogramData = fundingData.map(r => {
      const rate = parseFloat(r.fundingRate);
      return {
        time: toTime(r.time),
        value: rate * 100, // convert to percentage
        color: rate >= 0 ? '#22c55e' : '#ef4444',
      };
    });

    histogramSeries.setData(histogramData);
    chart.timeScale().fitContent();

    // Sync zoom with price chart
    chart.timeScale().subscribeVisibleLogicalRangeChange((logicalRange) => {
      if (!logicalRange || isSyncing.current) return;
      isSyncing.current = true;
      priceChartRef.current?.timeScale().setVisibleLogicalRange(logicalRange);
      isSyncing.current = false;
    });

    // Handle resize
    const handleResize = () => {
      if (chartContainerRef.current && chartRef.current) {
        chartRef.current.applyOptions({
          width: chartContainerRef.current.clientWidth,
        });
      }
    };

    const resizeObserver = new ResizeObserver(handleResize);
    resizeObserver.observe(chartContainerRef.current);

    return () => {
      resizeObserver.disconnect();
      if (chartRef.current) {
        chartRef.current.remove();
        chartRef.current = null;
      }
    };
  }, [fundingData, height]);

  // Build premium map from funding data for oracle estimate
  const premiumMap = useMemo(() => {
    const map = new Map<number, number>();
    for (const f of fundingData) {
      const hourKey = Math.round(f.time / 3_600_000) * 3_600_000;
      map.set(hourKey, parseFloat(f.premium));
    }
    return map;
  }, [fundingData]);

  // Render price chart with trade price + oracle estimate
  useEffect(() => {
    if (!priceChartContainerRef.current || priceData.length === 0) return;

    if (priceChartRef.current) {
      priceChartRef.current.remove();
      priceChartRef.current = null;
    }

    const chart = createChart(priceChartContainerRef.current, {
      width: priceChartContainerRef.current.clientWidth,
      height: 250,
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

    priceChartRef.current = chart;

    // Trade price line (cyan)
    const tradeSeries = chart.addSeries(LineSeries, {
      color: '#06b6d4',
      lineWidth: 2,
      title: 'Trade',
      priceFormat: {
        type: 'price',
        precision: 4,
        minMove: 0.0001,
      },
    });

    // Oracle estimate line (purple) — trade / (1 + premium)
    const oracleSeries = chart.addSeries(LineSeries, {
      color: '#8b5cf6',
      lineWidth: 2,
      title: 'Oracle (est.)',
      priceFormat: {
        type: 'price',
        precision: 4,
        minMove: 0.0001,
      },
    });

    const tradeData = priceData.map(c => ({
      time: toTime(c.time),
      value: c.close,
    }));

    const oracleData = priceData
      .map(c => {
        const hourKey = Math.round(c.time / 3_600_000) * 3_600_000;
        const premium = premiumMap.get(hourKey);
        if (premium === undefined) return null;
        return {
          time: toTime(c.time),
          value: c.close / (1 + premium),
        };
      })
      .filter((d): d is { time: UTCTimestamp; value: number } => d !== null);

    tradeSeries.setData(tradeData);
    oracleSeries.setData(oracleData);
    chart.timeScale().fitContent();

    // Sync zoom with funding chart
    chart.timeScale().subscribeVisibleLogicalRangeChange((logicalRange) => {
      if (!logicalRange || isSyncing.current) return;
      isSyncing.current = true;
      chartRef.current?.timeScale().setVisibleLogicalRange(logicalRange);
      isSyncing.current = false;
    });

    // Crosshair move: show trade/oracle/diff values
    chart.subscribeCrosshairMove((param) => {
      if (!param.time || !param.seriesData) {
        setCrosshairPrices(null);
        return;
      }
      const tradePoint = param.seriesData.get(tradeSeries) as { value?: number } | undefined;
      const oraclePoint = param.seriesData.get(oracleSeries) as { value?: number } | undefined;
      const trade = tradePoint?.value;
      const oracle = oraclePoint?.value;
      if (trade !== undefined && oracle !== undefined && oracle > 0) {
        const diff = ((trade - oracle) / oracle) * 100;
        setCrosshairPrices({ trade, oracle, diff });
      } else if (trade !== undefined) {
        setCrosshairPrices({ trade, oracle: 0, diff: 0 });
      } else {
        setCrosshairPrices(null);
      }
    });

    const handleResize = () => {
      if (priceChartContainerRef.current && priceChartRef.current) {
        priceChartRef.current.applyOptions({
          width: priceChartContainerRef.current.clientWidth,
        });
      }
    };

    const resizeObserver = new ResizeObserver(handleResize);
    resizeObserver.observe(priceChartContainerRef.current);

    return () => {
      resizeObserver.disconnect();
      if (priceChartRef.current) {
        priceChartRef.current.remove();
        priceChartRef.current = null;
      }
    };
  }, [priceData, premiumMap]);

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

      {/* Funding Rate Chart */}
      <div ref={chartContainerRef} />

      {/* Current Prices (real API values from metaAndAssetCtxs) */}
      {currentPrices && (
        <div className="mt-4 grid grid-cols-3 gap-3">
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
        </div>
      )}

      {/* Price Chart (historical) */}
      {priceData.length > 0 && (
        <div className="mt-4">
          <div className="flex items-center gap-4 mb-2">
            <h4 className="text-white text-sm font-medium">Price</h4>
            <div className="flex items-center gap-3 text-xs">
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
          </div>
          <div ref={priceChartContainerRef} />
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
