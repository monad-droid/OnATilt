'use client';

import { useEffect, useRef, memo } from 'react';
import type { Timeframe, AnalysisResult } from '@/types';

interface ChartProps {
  coin: string;
  timeframe: Timeframe;
  analysis: AnalysisResult | null;
  height?: number;
}

// Map our timeframes to TradingView intervals
const TV_INTERVALS: Record<Timeframe, string> = {
  '1m': '1',
  '3m': '3',
  '5m': '5',
  '15m': '15',
  '30m': '30',
  '1h': '60',
  '2h': '120',
  '4h': '240',
  '8h': '480',
  '12h': '720',
  '1d': 'D',
  '3d': '3D',
  '1w': 'W',
};

function Chart({ coin, timeframe, analysis, height = 550 }: ChartProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const widgetRef = useRef<string | null>(null);

  // Build the TradingView symbol — Hyperliquid perps are listed on TradingView
  const tvSymbol = `HYPERLIQUID:${coin}USD.P`;
  const tvInterval = TV_INTERVALS[timeframe] || '240';

  useEffect(() => {
    if (!containerRef.current) return;

    // Avoid re-creating if same symbol+interval
    const widgetKey = `${tvSymbol}_${tvInterval}`;
    if (widgetRef.current === widgetKey) return;
    widgetRef.current = widgetKey;

    // Clear previous widget
    containerRef.current.innerHTML = '';

    const script = document.createElement('script');
    script.src = 'https://s3.tradingview.com/external-embedding/embed-widget-advanced-chart.js';
    script.type = 'text/javascript';
    script.async = true;
    script.innerHTML = JSON.stringify({
      autosize: true,
      symbol: tvSymbol,
      interval: tvInterval,
      timezone: 'Etc/UTC',
      theme: 'dark',
      style: '1', // Candlestick
      locale: 'en',
      backgroundColor: 'rgba(10, 10, 15, 1)',
      gridColor: 'rgba(31, 41, 55, 0.5)',
      allow_symbol_change: true,
      calendar: false,
      support_host: 'https://www.tradingview.com',
      // Enable all drawing tools
      hide_side_toolbar: false,
      // Show drawing toolbar
      drawings_access: {
        type: 'all',
      },
      // Enable volume by default
      studies: ['STD;Volume'],
      // Toolbar settings
      withdateranges: true,
      hide_volume: false,
      save_image: true,
      show_popup_button: true,
      popup_width: '1200',
      popup_height: '800',
    });

    const widgetContainer = document.createElement('div');
    widgetContainer.className = 'tradingview-widget-container';
    widgetContainer.style.height = `${height}px`;
    widgetContainer.style.width = '100%';

    const widgetInner = document.createElement('div');
    widgetInner.className = 'tradingview-widget-container__widget';
    widgetInner.style.height = '100%';
    widgetInner.style.width = '100%';

    widgetContainer.appendChild(widgetInner);
    widgetContainer.appendChild(script);
    containerRef.current.appendChild(widgetContainer);
  }, [tvSymbol, tvInterval, height]);

  return (
    <div className="relative">
      <div ref={containerRef} style={{ height: `${height}px` }} className="w-full rounded-lg overflow-hidden" />

      {/* Analysis overlay */}
      {analysis && (
        <div className="absolute top-2 right-2 bg-black/90 border border-gray-700 rounded-lg p-3 text-xs space-y-1 z-10 max-w-[200px]">
          <div className="text-gray-500 font-medium mb-1">OnATilt Analysis</div>
          <div className="flex items-center justify-between gap-3">
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
            <div className="flex items-center justify-between gap-3">
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

          {analysis.marketStructure.lastBOS && (
            <div className="flex items-center justify-between gap-3">
              <span className="text-gray-400">Last BOS:</span>
              <span className="text-blue-400">{analysis.marketStructure.lastBOS.label}</span>
            </div>
          )}

          {analysis.marketStructure.lastCHoCH && (
            <div className="flex items-center justify-between gap-3">
              <span className="text-gray-400">Last CHoCH:</span>
              <span className="text-yellow-400">{analysis.marketStructure.lastCHoCH.label}</span>
            </div>
          )}

          <div className="flex items-center justify-between gap-3">
            <span className="text-gray-400">SFPs:</span>
            <span className="text-white">{analysis.sfps.length}</span>
          </div>

          <div className="flex items-center justify-between gap-3">
            <span className="text-gray-400">Ranges:</span>
            <span className="text-white">{analysis.ranges.filter(r => !r.broken).length}</span>
          </div>

          <div className="flex items-center justify-between gap-3">
            <span className="text-gray-400">OBs:</span>
            <span className="text-white">{analysis.orderBlocks.filter(ob => !ob.mitigated).length}</span>
          </div>

          <div className="flex items-center justify-between gap-3">
            <span className="text-gray-400">FVGs:</span>
            <span className="text-white">{analysis.fvgs.filter(f => !f.filled).length}</span>
          </div>
        </div>
      )}
    </div>
  );
}

export default memo(Chart);
