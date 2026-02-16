'use client';

import { useEffect, useRef, useCallback } from 'react';
import {
  createChart,
  createSeriesMarkers,
  CandlestickSeries,
  LineSeries,
  type IChartApi,
  type ISeriesApi,
  type CandlestickData,
  type Time,
  type SeriesMarker,
  type ISeriesMarkersPluginApi,
} from 'lightweight-charts';
import type { Candle, AnalysisResult } from '@/types';

interface ChartProps {
  candles: Candle[];
  analysis: AnalysisResult | null;
  height?: number;
}

export default function Chart({ candles, analysis, height = 500 }: ChartProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const chartRef = useRef<IChartApi | null>(null);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const candleSeriesRef = useRef<ISeriesApi<any> | null>(null);
  const markersRef = useRef<ISeriesMarkersPluginApi<Time> | null>(null);

  const initChart = useCallback(() => {
    if (!containerRef.current) return;

    if (chartRef.current) {
      chartRef.current.remove();
    }

    const chart = createChart(containerRef.current, {
      width: containerRef.current.clientWidth,
      height,
      layout: {
        background: { color: '#0a0a0f' },
        textColor: '#9ca3af',
      },
      grid: {
        vertLines: { color: '#1f2937' },
        horzLines: { color: '#1f2937' },
      },
      crosshair: {
        mode: 0,
      },
      rightPriceScale: {
        borderColor: '#374151',
      },
      timeScale: {
        borderColor: '#374151',
        timeVisible: true,
      },
    });

    const series = chart.addSeries(CandlestickSeries, {
      upColor: '#22c55e',
      downColor: '#ef4444',
      borderUpColor: '#22c55e',
      borderDownColor: '#ef4444',
      wickUpColor: '#22c55e',
      wickDownColor: '#ef4444',
    });

    chartRef.current = chart;
    candleSeriesRef.current = series;

    const handleResize = () => {
      if (containerRef.current && chartRef.current) {
        chartRef.current.applyOptions({ width: containerRef.current.clientWidth });
      }
    };
    window.addEventListener('resize', handleResize);

    return () => {
      window.removeEventListener('resize', handleResize);
    };
  }, [height]);

  useEffect(() => {
    const cleanup = initChart();
    return () => {
      cleanup?.();
      if (chartRef.current) {
        chartRef.current.remove();
        chartRef.current = null;
      }
    };
  }, [initChart]);

  // Update candle data
  useEffect(() => {
    if (!candleSeriesRef.current || candles.length === 0) return;

    const data: CandlestickData<Time>[] = candles.map((c) => ({
      time: (c.time / 1000) as Time,
      open: c.open,
      high: c.high,
      low: c.low,
      close: c.close,
    }));

    candleSeriesRef.current.setData(data);
    chartRef.current?.timeScale().fitContent();
  }, [candles]);

  // Draw analysis overlays
  useEffect(() => {
    if (!chartRef.current || !candleSeriesRef.current || !analysis) return;

    const chart = chartRef.current;

    // Build markers
    const markers: SeriesMarker<Time>[] = [];

    for (const sp of analysis.marketStructure.structurePoints) {
      const markerColor =
        sp.breakType === 'BOS' ? '#3b82f6' :
        sp.breakType === 'CHoCH' ? '#f59e0b' :
        '#6b7280';

      markers.push({
        time: (sp.swing.time / 1000) as Time,
        position: sp.swing.type === 'high' ? 'aboveBar' : 'belowBar',
        color: markerColor,
        shape: sp.swing.type === 'high' ? 'arrowDown' : 'arrowUp',
        text: sp.breakType !== 'none' ? `${sp.label} ${sp.breakType}` : sp.label,
      });
    }

    for (const sfp of analysis.sfps) {
      markers.push({
        time: (sfp.sweepCandle.time / 1000) as Time,
        position: sfp.type === 'bullish' ? 'belowBar' : 'aboveBar',
        color: sfp.type === 'bullish' ? '#22c55e' : '#ef4444',
        shape: 'circle',
        text: 'SFP',
      });
    }

    markers.sort((a, b) => (a.time as number) - (b.time as number));

    // Clean up old markers
    if (markersRef.current) {
      markersRef.current.detach();
    }

    if (markers.length > 0) {
      markersRef.current = createSeriesMarkers(candleSeriesRef.current, markers);
    }

    // Draw range lines — only ranges within 5% of current price
    const currentPrice = analysis.currentPrice;
    const relevantRanges = analysis.ranges.filter(r => {
      if (r.broken) return false;
      const distHigh = Math.abs(currentPrice - r.high) / currentPrice;
      const distLow = Math.abs(currentPrice - r.low) / currentPrice;
      return Math.min(distHigh, distLow) < 0.05;
    });

    for (const range of relevantRanges) {
      const startTime = (Math.min(range.highTime, range.lowTime) / 1000) as Time;
      const endTime = (candles[candles.length - 1].time / 1000) as Time;

      // Use the same price scale as candles so lines overlay correctly,
      // but attach to priceScaleId 'right' and use pricelines instead of
      // separate series to avoid distorting auto-scale.
      const rangeHighLine = chart.addSeries(LineSeries, {
        color: '#ef444480',
        lineWidth: 1,
        lineStyle: 2,
        priceLineVisible: false,
        lastValueVisible: false,
        autoscaleInfoProvider: () => null,
      });

      const rangeLowLine = chart.addSeries(LineSeries, {
        color: '#22c55e80',
        lineWidth: 1,
        lineStyle: 2,
        priceLineVisible: false,
        lastValueVisible: false,
        autoscaleInfoProvider: () => null,
      });

      const eqLine = chart.addSeries(LineSeries, {
        color: '#6b728080',
        lineWidth: 1,
        lineStyle: 1,
        priceLineVisible: false,
        lastValueVisible: false,
        autoscaleInfoProvider: () => null,
      });

      rangeHighLine.setData([
        { time: startTime, value: range.high },
        { time: endTime, value: range.high },
      ]);

      rangeLowLine.setData([
        { time: startTime, value: range.low },
        { time: endTime, value: range.low },
      ]);

      eqLine.setData([
        { time: startTime, value: range.equilibrium },
        { time: endTime, value: range.equilibrium },
      ]);
    }
  }, [analysis, candles]);

  return (
    <div className="relative">
      <div ref={containerRef} className="w-full rounded-lg overflow-hidden" />

      {analysis && (
        <div className="absolute top-2 left-2 bg-black/80 rounded-lg p-3 text-xs space-y-1">
          <div className="flex items-center gap-2">
            <span className="text-gray-400">Trend:</span>
            <span className={
              analysis.marketStructure.trend === 'bullish' ? 'text-green-400' :
              analysis.marketStructure.trend === 'bearish' ? 'text-red-400' :
              'text-yellow-400'
            }>
              {analysis.marketStructure.trend.toUpperCase()}
            </span>
          </div>

          {analysis.priceRelativeToRange && (
            <div className="flex items-center gap-2">
              <span className="text-gray-400">Zone:</span>
              <span className={
                analysis.priceRelativeToRange.zone === 'discount' ? 'text-green-400' :
                analysis.priceRelativeToRange.zone === 'premium' ? 'text-red-400' :
                'text-yellow-400'
              }>
                {analysis.priceRelativeToRange.zone.toUpperCase()}
              </span>
            </div>
          )}

          <div className="flex items-center gap-2">
            <span className="text-gray-400">SFPs:</span>
            <span className="text-white">{analysis.sfps.length}</span>
          </div>

          <div className="flex items-center gap-2">
            <span className="text-gray-400">Ranges:</span>
            <span className="text-white">{analysis.ranges.filter(r => !r.broken).length} active</span>
          </div>

          <div className="flex items-center gap-2">
            <span className="text-gray-400">OBs:</span>
            <span className="text-white">{analysis.orderBlocks.filter(ob => !ob.mitigated).length} unmitigated</span>
          </div>
        </div>
      )}
    </div>
  );
}
