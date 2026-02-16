'use client';

import { useEffect, useRef, useState } from 'react';
import {
  createChart,
  CandlestickSeries,
  createSeriesMarkers,
} from 'lightweight-charts';
import type { IChartApi, UTCTimestamp, SeriesMarker, Time } from 'lightweight-charts';
import type { Candle, AnalysisResult } from '@/types';

interface ChartProps {
  candles: Candle[];
  analysis: AnalysisResult | null;
  height?: number;
}

interface IndicatorToggles {
  structure: boolean;
  sfp: boolean;
  ob: boolean;
  fvg: boolean;
  range: boolean;
}

function toTime(ms: number): UTCTimestamp {
  return (ms / 1000) as UTCTimestamp;
}

export default function Chart({ candles, analysis, height = 600 }: ChartProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const chartContainerRef = useRef<HTMLDivElement>(null);
  const chartRef = useRef<IChartApi | null>(null);

  const [toggles, setToggles] = useState<IndicatorToggles>({
    structure: true,
    sfp: true,
    ob: true,
    fvg: true,
    range: true,
  });

  const toggle = (key: keyof IndicatorToggles) => {
    setToggles((prev) => ({ ...prev, [key]: !prev[key] }));
  };

  // Track the visible range so toggles don't reset your scroll position
  const savedRangeRef = useRef<{ from: number; to: number } | null>(null);

  useEffect(() => {
    if (!chartContainerRef.current) return;

    // Save current visible range before disposing
    if (chartRef.current) {
      try {
        const vr = chartRef.current.timeScale().getVisibleRange();
        if (vr) {
          savedRangeRef.current = { from: vr.from as number, to: vr.to as number };
        }
      } catch { /* no range yet */ }
      chartRef.current.remove();
      chartRef.current = null;
    }

    if (candles.length === 0) return;

    const chart = createChart(chartContainerRef.current, {
      width: chartContainerRef.current.clientWidth,
      height: height - 36, // leave room for toggle bar
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
        rightOffset: 20,
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
      // Build markers array
      const markers: SeriesMarker<Time>[] = [];

      // Structure point markers
      if (toggles.structure) {
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
      }

      // SFP markers
      if (toggles.sfp) {
        for (const sfp of analysis.sfps) {
          markers.push({
            time: toTime(sfp.sweepCandle.time),
            position: sfp.type === 'bullish' ? 'belowBar' : 'aboveBar',
            color: sfp.type === 'bullish' ? '#22c55e' : '#ef4444',
            shape: 'circle',
            text: 'SFP',
          });
        }
      }

      // Order block markers
      if (toggles.ob) {
        for (const ob of analysis.orderBlocks.filter((o) => !o.mitigated)) {
          markers.push({
            time: toTime(ob.time),
            position: ob.type === 'bullish' ? 'belowBar' : 'aboveBar',
            color: ob.type === 'bullish' ? '#22c55e80' : '#ef444480',
            shape: 'square',
            text: 'OB',
          });
        }
      }

      // FVG markers
      if (toggles.fvg) {
        for (const fvg of analysis.fvgs.filter((f) => !f.filled)) {
          markers.push({
            time: toTime(fvg.time),
            position: fvg.type === 'bullish' ? 'belowBar' : 'aboveBar',
            color: fvg.type === 'bullish' ? '#22c55e60' : '#ef444460',
            shape: 'square',
            text: 'FVG',
          });
        }
      }

      // Sort markers by time (required by lightweight-charts)
      markers.sort((a, b) => (a.time as number) - (b.time as number));

      // Deduplicate: if two markers have the same time + position, combine text
      const colorPriority = (color: string) => {
        if (color === '#22c55e' || color === '#ef4444') return 3;
        if (color === '#3b82f6') return 2;
        if (color === '#eab308') return 2;
        return 1;
      };
      const deduped: SeriesMarker<Time>[] = [];
      for (const m of markers) {
        const prev = deduped[deduped.length - 1];
        if (
          prev &&
          prev.time === m.time &&
          prev.position === m.position
        ) {
          prev.text = `${prev.text} | ${m.text}`;
          if (colorPriority(m.color) > colorPriority(prev.color)) {
            prev.color = m.color;
            prev.shape = m.shape;
          }
        } else {
          deduped.push({ ...m });
        }
      }

      if (deduped.length > 0) {
        createSeriesMarkers(candleSeries, deduped);
      }

      // --- Range Lines (dealing ranges) via price lines ---
      // Price lines span the full visible width, acting as horizontal rays.
      if (toggles.range) {
        const drawRanges = analysis.ranges.filter((r) => !r.broken);

        for (let ri = 0; ri < drawRanges.length; ri++) {
          const range = drawRanges[ri];
          const isOuter = ri > 0;
          const opacity = isOuter ? 0.3 : 0.6;

          candleSeries.createPriceLine({
            price: range.high,
            color: `rgba(239, 68, 68, ${opacity})`,
            lineWidth: isOuter ? 1 : 2,
            lineStyle: 2,
            axisLabelVisible: !isOuter,
            title: !isOuter ? 'Range H' : '',
          });

          candleSeries.createPriceLine({
            price: range.low,
            color: `rgba(34, 197, 94, ${opacity})`,
            lineWidth: isOuter ? 1 : 2,
            lineStyle: 2,
            axisLabelVisible: !isOuter,
            title: !isOuter ? 'Range L' : '',
          });

          candleSeries.createPriceLine({
            price: range.equilibrium,
            color: `rgba(234, 179, 8, ${isOuter ? 0.15 : 0.35})`,
            lineWidth: 1,
            lineStyle: 3,
            axisLabelVisible: false,
            title: '',
          });
        }
      }
    }

    // --- OHLC Legend (top-left overlay) ---
    const legend = document.createElement('div');
    legend.style.position = 'absolute';
    legend.style.top = '8px';
    legend.style.left = '8px';
    legend.style.zIndex = '10';
    legend.style.fontFamily = 'monospace';
    legend.style.fontSize = '12px';
    legend.style.lineHeight = '1.4';
    legend.style.pointerEvents = 'none';
    legend.style.color = '#9ca3af';
    chartContainerRef.current.appendChild(legend);

    const formatPrice = (p: number) => {
      if (p >= 1000) return p.toFixed(2);
      if (p >= 1) return p.toFixed(4);
      return p.toFixed(6);
    };

    const updateLegend = (o: number, h: number, l: number, c: number) => {
      const pct = ((c - o) / o * 100);
      const up = c >= o;
      const pctColor = up ? '#26a69a' : '#ef5350';
      const pctSign = pct >= 0 ? '+' : '';
      legend.innerHTML =
        `<span style="color:#6b7280">O</span> <span style="color:${up ? '#26a69a' : '#ef5350'}">${formatPrice(o)}</span>` +
        `  <span style="color:#6b7280">H</span> <span style="color:#26a69a">${formatPrice(h)}</span>` +
        `  <span style="color:#6b7280">L</span> <span style="color:#ef5350">${formatPrice(l)}</span>` +
        `  <span style="color:#6b7280">C</span> <span style="color:${up ? '#26a69a' : '#ef5350'}">${formatPrice(c)}</span>` +
        `  <span style="color:${pctColor}">${pctSign}${pct.toFixed(2)}%</span>`;
    };

    const lastCandle = candles[candles.length - 1];
    updateLegend(lastCandle.open, lastCandle.high, lastCandle.low, lastCandle.close);

    chart.subscribeCrosshairMove((param) => {
      if (!param || !param.seriesData || param.seriesData.size === 0) {
        updateLegend(lastCandle.open, lastCandle.high, lastCandle.low, lastCandle.close);
        return;
      }
      const data = param.seriesData.get(candleSeries) as { open: number; high: number; low: number; close: number } | undefined;
      if (data && data.open !== undefined) {
        updateLegend(data.open, data.high, data.low, data.close);
      }
    });

    // Restore previous scroll position, or fit content on first load
    if (savedRangeRef.current) {
      chart.timeScale().setVisibleRange({
        from: savedRangeRef.current.from as UTCTimestamp,
        to: savedRangeRef.current.to as UTCTimestamp,
      });
    } else {
      chart.timeScale().fitContent();
    }

    const handleResize = () => {
      if (chartContainerRef.current && chartRef.current) {
        chartRef.current.applyOptions({
          width: chartContainerRef.current.clientWidth,
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
  }, [candles, analysis, height, toggles]);

  const toggleButtons: { key: keyof IndicatorToggles; label: string; color: string }[] = [
    { key: 'structure', label: 'Structure', color: '#6b7280' },
    { key: 'sfp', label: 'SFPs', color: '#22c55e' },
    { key: 'ob', label: 'OBs', color: '#a78bfa' },
    { key: 'fvg', label: 'FVGs', color: '#f97316' },
    { key: 'range', label: 'Range', color: '#eab308' },
  ];

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
    <div ref={containerRef} style={{ height: `${height}px` }} className="w-full rounded-lg overflow-hidden">
      {/* Indicator toggle bar */}
      <div className="flex items-center gap-1.5 px-2 py-1 bg-[#0a0a0f] border-b border-gray-800" style={{ height: '36px' }}>
        <span className="text-[10px] text-gray-600 mr-1">Indicators:</span>
        {toggleButtons.map(({ key, label, color }) => (
          <button
            key={key}
            onClick={() => toggle(key)}
            className="px-2 py-0.5 rounded text-[11px] font-medium transition-all"
            style={{
              backgroundColor: toggles[key] ? `${color}20` : 'transparent',
              color: toggles[key] ? color : '#4b5563',
              border: `1px solid ${toggles[key] ? `${color}40` : '#374151'}`,
            }}
          >
            {label}
          </button>
        ))}
      </div>
      {/* Chart canvas */}
      <div
        ref={chartContainerRef}
        style={{ height: `${height - 36}px`, position: 'relative' }}
        className="w-full"
      />
    </div>
  );
}
