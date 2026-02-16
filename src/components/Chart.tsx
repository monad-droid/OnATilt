'use client';

import { useEffect, useRef, memo } from 'react';
import type { AnalysisResult } from '@/types';

interface ChartProps {
  analysis: AnalysisResult | null;
  height?: number;
}

function Chart({ analysis, height = 600 }: ChartProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const mountedRef = useRef(false);

  useEffect(() => {
    if (!containerRef.current || mountedRef.current) return;
    mountedRef.current = true;

    const script = document.createElement('script');
    script.src = 'https://s3.tradingview.com/external-embedding/embed-widget-advanced-chart.js';
    script.type = 'text/javascript';
    script.async = true;
    script.innerHTML = JSON.stringify({
      autosize: true,
      symbol: 'BYBIT:BTCUSDT.P',
      interval: '240',
      timezone: 'Etc/UTC',
      theme: 'dark',
      style: '1',
      locale: 'en',
      backgroundColor: 'rgba(10, 10, 15, 1)',
      gridColor: 'rgba(31, 41, 55, 0.5)',
      allow_symbol_change: true,
      calendar: false,
      support_host: 'https://www.tradingview.com',
      hide_side_toolbar: false,
      studies: ['STD;Volume'],
      withdateranges: true,
      hide_volume: false,
      save_image: true,
      show_popup_button: true,
      popup_width: '1200',
      popup_height: '800',
    });

    const widgetContainer = document.createElement('div');
    widgetContainer.className = 'tradingview-widget-container';
    widgetContainer.style.height = '100%';
    widgetContainer.style.width = '100%';

    const widgetInner = document.createElement('div');
    widgetInner.className = 'tradingview-widget-container__widget';
    widgetInner.style.height = '100%';
    widgetInner.style.width = '100%';

    widgetContainer.appendChild(widgetInner);
    widgetContainer.appendChild(script);
    containerRef.current.appendChild(widgetContainer);
  }, []);

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
