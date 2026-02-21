'use client';

import { useEffect, useRef } from 'react';
import { createChart, LineSeries, BaselineSeries } from 'lightweight-charts';
import type { IChartApi, UTCTimestamp } from 'lightweight-charts';
import type { PremiumSample } from '@/hooks/usePremiumPoller';

interface IntraHourChartProps {
  samples: PremiumSample[];
  runningAvg: number;
  hourStart: number;
  height?: number;
}

function toTime(ms: number): UTCTimestamp {
  return (ms / 1000) as UTCTimestamp;
}

export default function IntraHourChart({
  samples,
  runningAvg,
  hourStart,
  height = 160,
}: IntraHourChartProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const chartRef = useRef<IChartApi | null>(null);

  useEffect(() => {
    if (!containerRef.current) return;

    if (chartRef.current) {
      chartRef.current.remove();
      chartRef.current = null;
    }

    const chart = createChart(containerRef.current, {
      width: containerRef.current.clientWidth,
      height,
      layout: {
        background: { color: '#0a0a0f' },
        textColor: '#9ca3af',
        fontSize: 10,
      },
      grid: {
        vertLines: { color: '#1f293780' },
        horzLines: { color: '#1f293780' },
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

    // Premium line (baseline at 0 — green above, red below)
    const premiumSeries = chart.addSeries(BaselineSeries, {
      baseValue: { type: 'price', price: 0 },
      topLineColor: '#22c55e',
      topFillColor1: 'rgba(34, 197, 94, 0.12)',
      topFillColor2: 'rgba(34, 197, 94, 0.01)',
      bottomLineColor: '#ef4444',
      bottomFillColor1: 'rgba(239, 68, 68, 0.01)',
      bottomFillColor2: 'rgba(239, 68, 68, 0.12)',
      lineWidth: 2,
      priceFormat: { type: 'price', precision: 6, minMove: 0.000001 },
    });

    // Running average line (dashed yellow)
    const avgSeries = chart.addSeries(LineSeries, {
      color: '#eab308',
      lineWidth: 1,
      lineStyle: 2, // dashed
      priceFormat: { type: 'price', precision: 6, minMove: 0.000001 },
      crosshairMarkerVisible: false,
    });

    if (samples.length > 0) {
      // Premium as percentage (multiply by 100 for readability)
      const premiumData = samples.map(s => ({
        time: toTime(s.time),
        value: s.premium * 100,
      }));

      premiumSeries.setData(premiumData);

      // Running avg as flat line across the sample range
      const avgValue = runningAvg * 100;
      avgSeries.setData([
        { time: toTime(samples[0].time), value: avgValue },
        { time: toTime(samples[samples.length - 1].time), value: avgValue },
      ]);

      chart.timeScale().fitContent();
    }

    const handleResize = () => {
      if (containerRef.current && chartRef.current) {
        chartRef.current.applyOptions({ width: containerRef.current.clientWidth });
      }
    };

    const resizeObserver = new ResizeObserver(handleResize);
    resizeObserver.observe(containerRef.current);

    return () => {
      resizeObserver.disconnect();
      if (chartRef.current) {
        chartRef.current.remove();
        chartRef.current = null;
      }
    };
  }, [samples, runningAvg, hourStart, height]);

  const elapsed = Math.floor((Date.now() - hourStart) / 60_000);
  const remaining = 60 - elapsed;
  const avgPct = (runningAvg * 100).toFixed(6);

  return (
    <div className="border border-gray-800 rounded-lg p-3 bg-gray-900/30">
      <div className="flex items-center justify-between mb-2">
        <div className="flex items-center gap-2">
          <h4 className="text-white text-sm font-medium">Intra-Hour Premium</h4>
          <span className="text-xs text-gray-500">
            {samples.length} sample{samples.length !== 1 ? 's' : ''} · polls every 30s
          </span>
        </div>
        <div className="flex items-center gap-3 text-xs">
          <span className="text-gray-400">
            {elapsed}m elapsed · {remaining}m to settlement
          </span>
          <span className="flex items-center gap-1">
            <span className="inline-block w-3 h-0.5 bg-[#eab308] rounded" />
            <span className="text-gray-400">Avg:</span>
            <span className={`font-medium ${runningAvg >= 0 ? 'text-green-400' : 'text-red-400'}`}>
              {runningAvg >= 0 ? '+' : ''}{avgPct}%
            </span>
          </span>
        </div>
      </div>

      <div ref={containerRef} />

      {samples.length < 2 && (
        <div className="text-gray-500 text-xs text-center mt-2">
          Collecting samples... chart will appear after 2+ data points
        </div>
      )}
    </div>
  );
}
