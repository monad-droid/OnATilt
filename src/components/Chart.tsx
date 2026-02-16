'use client';

import { useEffect, useRef } from 'react';
import {
  createChart,
  CandlestickSeries,
  LineSeries,
  createSeriesMarkers,
} from 'lightweight-charts';
import type { IChartApi, UTCTimestamp, SeriesMarker, Time } from 'lightweight-charts';
import type { Candle, AnalysisResult } from '@/types';

interface ChartProps {
  candles: Candle[];
  analysis: AnalysisResult | null;
  height?: number;
}

function toTime(ms: number): UTCTimestamp {
  return (ms / 1000) as UTCTimestamp;
}

export default function Chart({ candles, analysis, height = 600 }: ChartProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const chartRef = useRef<IChartApi | null>(null);

  useEffect(() => {
    if (!containerRef.current) return;

    // Dispose previous chart
    if (chartRef.current) {
      chartRef.current.remove();
      chartRef.current = null;
    }

    if (candles.length === 0) return;

    const chart = createChart(containerRef.current, {
      width: containerRef.current.clientWidth,
      height,
      layout: {
        background: { color: '#0a0a0f' },
        textColor: '#9ca3af',
      },
      grid: {
        vertLines: { color: 'rgba(31, 41, 55, 0.5)' },
        horzLines: { color: 'rgba(31, 41, 55, 0.5)' },
      },
      crosshair: { mode: 0 },
      rightPriceScale: { borderColor: '#374151' },
      timeScale: {
        borderColor: '#374151',
        timeVisible: true,
      },
    });
    chartRef.current = chart;

    // --- Candlestick Series ---
    const candleSeries = chart.addSeries(CandlestickSeries, {
      upColor: '#26a69a',
      downColor: '#ef5350',
      borderUpColor: '#26a69a',
      borderDownColor: '#ef5350',
      wickUpColor: '#26a69a',
      wickDownColor: '#ef5350',
    });

    const candleData = candles.map((c) => ({
      time: toTime(c.time),
      open: c.open,
      high: c.high,
      low: c.low,
      close: c.close,
    }));
    candleSeries.setData(candleData);

    // --- Analysis Overlays ---
    if (analysis) {
      const lastTime = toTime(candles[candles.length - 1].time);
      const currentPrice = analysis.currentPrice;

      // Build markers array
      const markers: SeriesMarker<Time>[] = [];

      // Structure point markers (HH, HL, LH, LL + BOS/CHoCH labels)
      for (const sp of analysis.marketStructure.structurePoints) {
        const isHigh =
          sp.label === 'HH' || sp.label === 'LH' || sp.label === 'EH';
        const color =
          sp.breakType === 'BOS'
            ? '#3b82f6'
            : sp.breakType === 'CHoCH'
            ? '#eab308'
            : '#6b7280';
        const text =
          sp.breakType !== 'none'
            ? `${sp.label} (${sp.breakType})`
            : sp.label;

        markers.push({
          time: toTime(sp.swing.time),
          position: isHigh ? 'aboveBar' : 'belowBar',
          color,
          shape: isHigh ? 'arrowDown' : 'arrowUp',
          text,
        });
      }

      // SFP markers
      for (const sfp of analysis.sfps) {
        markers.push({
          time: toTime(sfp.sweepCandle.time),
          position: sfp.type === 'bullish' ? 'belowBar' : 'aboveBar',
          color: sfp.type === 'bullish' ? '#22c55e' : '#ef4444',
          shape: 'circle',
          text: 'SFP',
        });
      }

      // Order block markers (unmitigated only)
      for (const ob of analysis.orderBlocks.filter((o) => !o.mitigated)) {
        markers.push({
          time: toTime(ob.time),
          position: ob.type === 'bullish' ? 'belowBar' : 'aboveBar',
          color: ob.type === 'bullish' ? '#22c55e80' : '#ef444480',
          shape: 'square',
          text: 'OB',
        });
      }

      // FVG markers (unfilled only)
      for (const fvg of analysis.fvgs.filter((f) => !f.filled)) {
        markers.push({
          time: toTime(fvg.time),
          position: fvg.type === 'bullish' ? 'belowBar' : 'aboveBar',
          color: fvg.type === 'bullish' ? '#22c55e60' : '#ef444460',
          shape: 'square',
          text: 'FVG',
        });
      }

      // Sort markers by time (required by lightweight-charts)
      markers.sort((a, b) => (a.time as number) - (b.time as number));

      // Deduplicate: if two markers have the same time + position, combine text
      const deduped: SeriesMarker<Time>[] = [];
      for (const m of markers) {
        const prev = deduped[deduped.length - 1];
        if (
          prev &&
          prev.time === m.time &&
          prev.position === m.position
        ) {
          // Combine - keep the more important color (BOS/CHoCH > SFP > normal)
          prev.text = `${prev.text} | ${m.text}`;
        } else {
          deduped.push({ ...m });
        }
      }

      createSeriesMarkers(candleSeries, deduped);

      // --- Range Lines ---
      const activeRanges = analysis.ranges.filter((r) => !r.broken);
      // Only show ranges within 5% of current price to avoid zoom distortion
      const nearRanges = activeRanges.filter((r) => {
        const distHigh = Math.abs(r.high - currentPrice) / currentPrice;
        const distLow = Math.abs(r.low - currentPrice) / currentPrice;
        return distHigh < 0.05 || distLow < 0.05;
      });

      for (const range of nearRanges.slice(0, 3)) {
        const startTime = toTime(Math.min(range.highTime, range.lowTime));

        // Range High line (red dashed)
        const highLine = chart.addSeries(LineSeries, {
          color: 'rgba(239, 68, 68, 0.6)',
          lineWidth: 1,
          lineStyle: 2,
          crosshairMarkerVisible: false,
          lastValueVisible: true,
          priceLineVisible: false,
          autoscaleInfoProvider: () => null,
        });
        highLine.setData([
          { time: startTime, value: range.high },
          { time: lastTime, value: range.high },
        ]);

        // Range Low line (green dashed)
        const lowLine = chart.addSeries(LineSeries, {
          color: 'rgba(34, 197, 94, 0.6)',
          lineWidth: 1,
          lineStyle: 2,
          crosshairMarkerVisible: false,
          lastValueVisible: true,
          priceLineVisible: false,
          autoscaleInfoProvider: () => null,
        });
        lowLine.setData([
          { time: startTime, value: range.low },
          { time: lastTime, value: range.low },
        ]);

        // Equilibrium line (yellow dotted)
        const eqLine = chart.addSeries(LineSeries, {
          color: 'rgba(234, 179, 8, 0.35)',
          lineWidth: 1,
          lineStyle: 3,
          crosshairMarkerVisible: false,
          lastValueVisible: false,
          priceLineVisible: false,
          autoscaleInfoProvider: () => null,
        });
        eqLine.setData([
          { time: startTime, value: range.equilibrium },
          { time: lastTime, value: range.equilibrium },
        ]);
      }
    }

    // Fit content
    chart.timeScale().fitContent();

    // Handle resize
    const handleResize = () => {
      if (containerRef.current && chartRef.current) {
        chartRef.current.applyOptions({
          width: containerRef.current.clientWidth,
        });
      }
    };
    window.addEventListener('resize', handleResize);

    return () => {
      window.removeEventListener('resize', handleResize);
      if (chartRef.current) {
        chartRef.current.remove();
        chartRef.current = null;
      }
    };
  }, [candles, analysis, height]);

  if (candles.length === 0) {
    return (
      <div
        ref={containerRef}
        style={{ height: `${height}px` }}
        className="w-full rounded-lg overflow-hidden bg-[#0a0a0f] flex items-center justify-center"
      >
        <p className="text-gray-500">
          Enter a coin and click Analyze to load chart data
        </p>
      </div>
    );
  }

  return (
    <div
      ref={containerRef}
      style={{ height: `${height}px` }}
      className="w-full rounded-lg overflow-hidden"
    />
  );
}
