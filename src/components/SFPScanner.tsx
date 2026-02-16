'use client';

import { useState, useRef, useCallback } from 'react';
import type { Timeframe, ScannerResult } from '@/types';

const SCAN_TIMEFRAMES: { value: Timeframe; label: string; desc: string }[] = [
  { value: '1w', label: '1W', desc: 'Weekly SFPs' },
  { value: '1d', label: '1D', desc: 'Daily SFPs' },
  { value: '12h', label: '12H', desc: '12h SFPs' },
  { value: '4h', label: '4H', desc: '4h SFPs' },
];

const BATCH_SIZE = 10;

interface SFPScannerProps {
  onSelectCoin: (coin: string, timeframe: Timeframe) => void;
}

export default function SFPScanner({ onSelectCoin }: SFPScannerProps) {
  const [timeframe, setTimeframe] = useState<Timeframe>('1w');
  const [scanning, setScanning] = useState(false);
  const [progress, setProgress] = useState({ scanned: 0, total: 0, found: 0 });
  const [results, setResults] = useState<ScannerResult[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [hasScanned, setHasScanned] = useState(false);
  const [filter, setFilter] = useState<'all' | 'bullish' | 'bearish'>('all');
  const cancelRef = useRef(false);

  const startScan = useCallback(async () => {
    setScanning(true);
    setError(null);
    setResults([]);
    setHasScanned(false);
    cancelRef.current = false;
    setProgress({ scanned: 0, total: 0, found: 0 });

    try {
      // Fetch all available perp tokens
      const assetsRes = await fetch('/api/market-data', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'assets' }),
      });

      const assetsData = await assetsRes.json();
      if (assetsData.error) {
        setError(assetsData.error);
        setScanning(false);
        return;
      }

      const allCoins: string[] = assetsData.assets.map((a: { name: string }) => a.name);
      setProgress({ scanned: 0, total: allCoins.length, found: 0 });

      // Batch scan
      const allResults: ScannerResult[] = [];

      for (let i = 0; i < allCoins.length; i += BATCH_SIZE) {
        if (cancelRef.current) break;

        const batch = allCoins.slice(i, i + BATCH_SIZE);

        try {
          const res = await fetch('/api/scanner', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ coins: batch, timeframe, recentCandles: 2 }),
          });

          const data = await res.json();

          if (data.results) {
            allResults.push(...data.results);
            setResults([...allResults]);
          }
        } catch {
          // Continue scanning even if a batch fails
        }

        setProgress({
          scanned: Math.min(i + BATCH_SIZE, allCoins.length),
          total: allCoins.length,
          found: allResults.length,
        });
      }

      setResults(allResults);
      setHasScanned(true);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to start scan');
    } finally {
      setScanning(false);
    }
  }, [timeframe]);

  const cancelScan = useCallback(() => {
    cancelRef.current = true;
  }, []);

  const filteredResults = results.filter((r) => {
    if (filter === 'all') return true;
    return r.sfps.some((sfp) => sfp.type === filter);
  });

  // Sort: bearish first (potential shorts at top), then bullish
  const sortedResults = [...filteredResults].sort((a, b) => {
    const aType = a.sfps[0]?.type === 'bearish' ? 0 : 1;
    const bType = b.sfps[0]?.type === 'bearish' ? 0 : 1;
    if (aType !== bType) return aType - bType;
    // Within same type, sort by wick depth % (largest first)
    const aWick = a.sfps[0] ? (a.sfps[0].wickDepth / a.sfps[0].sweptSwing.price) * 100 : 0;
    const bWick = b.sfps[0] ? (b.sfps[0].wickDepth / b.sfps[0].sweptSwing.price) * 100 : 0;
    return bWick - aWick;
  });

  const progressPercent = progress.total > 0 ? (progress.scanned / progress.total) * 100 : 0;

  const tfLabel = SCAN_TIMEFRAMES.find((t) => t.value === timeframe)?.desc ?? timeframe;

  return (
    <div className="h-full flex flex-col">
      {/* Header */}
      <div className="flex items-center justify-between mb-4">
        <h2 className="text-lg font-bold text-white">SFP Scanner</h2>
        <span className="text-xs text-gray-500">All Hyperliquid Perps</span>
      </div>

      {/* Controls */}
      <div className="flex items-center gap-3 mb-4 flex-wrap">
        {/* Timeframe selector */}
        <div className="flex gap-1 bg-gray-900 rounded-lg p-0.5">
          {SCAN_TIMEFRAMES.map((tf) => (
            <button
              key={tf.value}
              onClick={() => setTimeframe(tf.value)}
              disabled={scanning}
              className={`px-3 py-1.5 rounded text-xs font-medium transition-colors ${
                timeframe === tf.value
                  ? 'bg-blue-500 text-white'
                  : 'text-gray-400 hover:text-white hover:bg-gray-800'
              } disabled:opacity-50`}
            >
              {tf.label}
            </button>
          ))}
        </div>

        {/* Scan / Cancel button */}
        {scanning ? (
          <button
            onClick={cancelScan}
            className="px-5 py-1.5 bg-red-500/20 text-red-400 border border-red-500/30 rounded-lg text-sm font-medium hover:bg-red-500/30 transition-colors"
          >
            Cancel
          </button>
        ) : (
          <button
            onClick={startScan}
            className="px-5 py-1.5 bg-blue-500 text-white rounded-lg text-sm font-medium hover:bg-blue-600 transition-colors"
          >
            Scan All
          </button>
        )}

        {/* Filter (only show after scan) */}
        {hasScanned && results.length > 0 && (
          <div className="flex gap-1 bg-gray-900 rounded-lg p-0.5 ml-auto">
            {(['all', 'bullish', 'bearish'] as const).map((f) => (
              <button
                key={f}
                onClick={() => setFilter(f)}
                className={`px-3 py-1 rounded text-xs font-medium transition-colors ${
                  filter === f
                    ? f === 'bullish'
                      ? 'bg-green-500/20 text-green-400'
                      : f === 'bearish'
                        ? 'bg-red-500/20 text-red-400'
                        : 'bg-blue-500 text-white'
                    : 'text-gray-400 hover:text-white hover:bg-gray-800'
                }`}
              >
                {f === 'all' ? 'All' : f === 'bullish' ? 'Bullish' : 'Bearish'}
              </button>
            ))}
          </div>
        )}
      </div>

      {/* Progress bar */}
      {scanning && (
        <div className="mb-4">
          <div className="flex items-center justify-between text-xs text-gray-400 mb-1.5">
            <span>
              Scanning {progress.scanned} of {progress.total} tokens...
            </span>
            <span className="text-blue-400 font-medium">{progress.found} found</span>
          </div>
          <div className="w-full bg-gray-800 rounded-full h-1.5">
            <div
              className="bg-blue-500 h-1.5 rounded-full transition-all duration-300"
              style={{ width: `${progressPercent}%` }}
            />
          </div>
        </div>
      )}

      {/* Error */}
      {error && (
        <div className="bg-red-500/10 border border-red-500/30 rounded-lg p-3 text-red-400 text-sm mb-4">
          {error}
        </div>
      )}

      {/* Summary stats */}
      {hasScanned && (
        <div className="grid grid-cols-3 gap-3 mb-4">
          <div className="bg-gray-900 rounded-lg p-3 text-center">
            <div className="text-2xl font-bold text-white">{results.length}</div>
            <div className="text-xs text-gray-500">Tokens w/ SFP</div>
          </div>
          <div className="bg-gray-900 rounded-lg p-3 text-center">
            <div className="text-2xl font-bold text-green-400">
              {results.filter((r) => r.sfps.some((s) => s.type === 'bullish')).length}
            </div>
            <div className="text-xs text-gray-500">Bullish</div>
          </div>
          <div className="bg-gray-900 rounded-lg p-3 text-center">
            <div className="text-2xl font-bold text-red-400">
              {results.filter((r) => r.sfps.some((s) => s.type === 'bearish')).length}
            </div>
            <div className="text-xs text-gray-500">Bearish</div>
          </div>
        </div>
      )}

      {/* Results table */}
      {sortedResults.length > 0 && (
        <div className="flex-1 overflow-auto -mx-1">
          <table className="w-full text-sm">
            <thead>
              <tr className="text-gray-500 text-xs border-b border-gray-800">
                <th className="text-left py-2 px-2 font-medium">Token</th>
                <th className="text-left py-2 px-2 font-medium">Type</th>
                <th className="text-right py-2 px-2 font-medium">Price</th>
                <th className="text-right py-2 px-2 font-medium">Swept</th>
                <th className="text-right py-2 px-2 font-medium">Wick%</th>
                <th className="text-left py-2 px-2 font-medium">Trend</th>
              </tr>
            </thead>
            <tbody>
              {sortedResults.map((r) =>
                r.sfps.map((sfp, j) => {
                  const wickPct = ((sfp.wickDepth / sfp.sweptSwing.price) * 100).toFixed(2);
                  const isBullish = sfp.type === 'bullish';

                  return (
                    <tr
                      key={`${r.coin}-${j}`}
                      onClick={() => onSelectCoin(r.coin, timeframe)}
                      className="border-b border-gray-800/50 hover:bg-gray-800/40 cursor-pointer transition-colors"
                    >
                      <td className="py-2.5 px-2 font-semibold text-white">{r.coin}</td>
                      <td className="py-2.5 px-2">
                        <span
                          className={`inline-flex items-center gap-1 px-2 py-0.5 rounded text-xs font-medium ${
                            isBullish
                              ? 'bg-green-500/15 text-green-400'
                              : 'bg-red-500/15 text-red-400'
                          }`}
                        >
                          {isBullish ? '\u25B2' : '\u25BC'} {sfp.type}
                        </span>
                      </td>
                      <td className="py-2.5 px-2 text-right text-white font-mono text-xs">
                        {formatPrice(r.currentPrice)}
                      </td>
                      <td className="py-2.5 px-2 text-right text-gray-400 font-mono text-xs">
                        {formatPrice(sfp.sweptSwing.price)}
                      </td>
                      <td className="py-2.5 px-2 text-right font-mono text-xs">
                        <span className={isBullish ? 'text-green-400' : 'text-red-400'}>
                          {wickPct}%
                        </span>
                      </td>
                      <td className="py-2.5 px-2">
                        <span
                          className={`text-xs ${
                            r.trend === 'bullish'
                              ? 'text-green-400'
                              : r.trend === 'bearish'
                                ? 'text-red-400'
                                : 'text-gray-400'
                          }`}
                        >
                          {r.trend}
                        </span>
                      </td>
                    </tr>
                  );
                })
              )}
            </tbody>
          </table>
        </div>
      )}

      {/* Empty states */}
      {!scanning && !hasScanned && results.length === 0 && (
        <div className="flex-1 flex items-center justify-center">
          <div className="text-center">
            <div className="text-gray-600 text-4xl mb-3">&#x1F50D;</div>
            <p className="text-gray-400 text-sm mb-1">
              Scan all Hyperliquid perps for {tfLabel}
            </p>
            <p className="text-gray-600 text-xs">
              Checks current + last completed candle for swing sweeps
            </p>
          </div>
        </div>
      )}

      {hasScanned && results.length === 0 && (
        <div className="flex-1 flex items-center justify-center">
          <div className="text-center">
            <div className="text-gray-600 text-3xl mb-3">&#x2205;</div>
            <p className="text-gray-400 text-sm">
              No {tfLabel.toLowerCase()} found across {progress.total} tokens
            </p>
            <p className="text-gray-600 text-xs mt-1">
              Try a different timeframe or check back later
            </p>
          </div>
        </div>
      )}

      {hasScanned && results.length > 0 && filteredResults.length === 0 && (
        <div className="flex-1 flex items-center justify-center">
          <p className="text-gray-500 text-sm">
            No {filter} SFPs — try &quot;All&quot; filter
          </p>
        </div>
      )}

      {/* Footer hint */}
      {sortedResults.length > 0 && (
        <div className="mt-3 pt-3 border-t border-gray-800">
          <p className="text-xs text-gray-600 text-center">
            Click a row to analyze that token
          </p>
        </div>
      )}
    </div>
  );
}

function formatPrice(price: number): string {
  if (price >= 1000) return price.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  if (price >= 1) return price.toFixed(4);
  if (price >= 0.001) return price.toFixed(6);
  return price.toPrecision(4);
}
