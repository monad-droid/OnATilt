'use client';

import { useState, useCallback } from 'react';
import dynamic from 'next/dynamic';
import { useAppStore } from '@/store';
import ConnectWallet from '@/components/ConnectWallet';
import SetupBuilder from '@/components/SetupBuilder';
import TradePanel from '@/components/TradePanel';
import AnalysisPanel from '@/components/AnalysisPanel';
import type { Timeframe } from '@/types';

// Dynamic import for chart (SSR incompatible — TradingView widget uses DOM)
const Chart = dynamic(() => import('@/components/Chart'), { ssr: false });

const TIMEFRAMES: Timeframe[] = ['5m', '15m', '30m', '1h', '4h', '1d'];

type Tab = 'chart' | 'setups' | 'trade';

export default function Home() {
  const {
    selectedCoin,
    selectedTimeframe,
    analysis,
    setAnalysis,
    setSelectedCoin,
    setSelectedTimeframe,
  } = useAppStore();

  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [activeTab, setActiveTab] = useState<Tab>('chart');
  const [analysisCoin, setAnalysisCoin] = useState(selectedCoin);
  const [analysisTimeframe, setAnalysisTimeframe] = useState(selectedTimeframe);

  const loadAnalysis = useCallback(async () => {
    setLoading(true);
    setError(null);

    try {
      setSelectedCoin(analysisCoin);
      setSelectedTimeframe(analysisTimeframe);

      const res = await fetch('/api/analyze', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          coin: analysisCoin,
          timeframe: analysisTimeframe,
        }),
      });

      const data = await res.json();

      if (data.error) {
        setError(data.error);
        return;
      }

      setAnalysis(data.analysis);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load data');
    } finally {
      setLoading(false);
    }
  }, [analysisCoin, analysisTimeframe, setAnalysis, setSelectedCoin, setSelectedTimeframe]);

  return (
    <div className="min-h-screen bg-[#0a0a0f]">
      {/* Header */}
      <header className="border-b border-gray-800 px-6 py-3">
        <div className="max-w-[1800px] mx-auto flex items-center justify-between">
          <div className="flex items-center gap-4">
            <h1 className="text-xl font-bold text-white tracking-tight">
              <span className="text-red-400">On</span>ATilt
            </h1>
          </div>
          <ConnectWallet />
        </div>
      </header>

      {/* Mobile Tabs */}
      <div className="lg:hidden border-b border-gray-800">
        <div className="flex">
          {([['chart', 'Chart'], ['setups', 'Setups'], ['trade', 'Trade']] as [Tab, string][]).map(([tab, label]) => (
            <button
              key={tab}
              onClick={() => setActiveTab(tab)}
              className={`flex-1 py-3 text-sm font-medium transition-colors ${
                activeTab === tab
                  ? 'text-blue-400 border-b-2 border-blue-400'
                  : 'text-gray-500'
              }`}
            >
              {label}
            </button>
          ))}
        </div>
      </div>

      {/* Main Content */}
      <main className="max-w-[1800px] mx-auto px-4 py-4">
        <div className="grid grid-cols-1 lg:grid-cols-12 gap-4">
          {/* Chart Area */}
          <div className={`lg:col-span-8 xl:col-span-9 ${activeTab !== 'chart' ? 'hidden lg:block' : ''}`}>
            <div className="rounded-xl overflow-hidden bg-[#0a0a0f]">
              <Chart height={600} />
            </div>

            {/* Analysis bar below chart */}
            <div className="mt-3 border border-gray-800 rounded-xl p-4">
              {/* Analyze controls */}
              <div className="flex items-center gap-3 flex-wrap">
                <span className="text-xs text-gray-500">Run setup analysis:</span>
                <input
                  type="text"
                  value={analysisCoin}
                  onChange={(e) => {
                    setAnalysisCoin(e.target.value.toUpperCase());
                    setAnalysis(null);
                  }}
                  placeholder="BTC"
                  className="w-24 bg-gray-900 border border-gray-700 rounded-lg px-3 py-1.5 text-white text-sm font-semibold focus:outline-none focus:border-blue-500 text-center uppercase"
                />
                <div className="flex gap-1 bg-gray-900 rounded-lg p-0.5">
                  {TIMEFRAMES.map((tf) => (
                    <button
                      key={tf}
                      onClick={() => setAnalysisTimeframe(tf)}
                      className={`px-2.5 py-1 rounded text-xs font-medium transition-colors ${
                        analysisTimeframe === tf
                          ? 'bg-blue-500 text-white'
                          : 'text-gray-400 hover:text-white hover:bg-gray-800'
                      }`}
                    >
                      {tf}
                    </button>
                  ))}
                </div>
                <button
                  onClick={loadAnalysis}
                  disabled={loading || !analysisCoin.trim()}
                  className="px-5 py-1.5 bg-blue-500 text-white rounded-lg text-sm font-medium disabled:opacity-50 hover:bg-blue-600 transition-colors"
                >
                  {loading ? 'Analyzing...' : 'Analyze'}
                </button>

                {/* Show what was analyzed */}
                {analysis && (
                  <span className="text-xs text-gray-500 ml-2">
                    Showing: <span className="text-white font-medium">{analysis.coin}</span> {analysis.timeframe}
                  </span>
                )}
              </div>

              {/* Error */}
              {error && (
                <div className="bg-red-500/10 border border-red-500/30 rounded-lg p-3 text-red-400 text-sm mt-3">
                  {error}
                </div>
              )}

              {/* Analysis results */}
              {analysis && (
                <div className="mt-4 border-t border-gray-800 pt-4">
                  <AnalysisPanel />
                </div>
              )}
            </div>
          </div>

          {/* Right Sidebar */}
          <div className="lg:col-span-4 xl:col-span-3 space-y-4">
            {/* Analysis (mobile only) */}
            <div className={`lg:hidden ${activeTab !== 'chart' ? 'hidden' : ''}`}>
              <div className="border border-gray-800 rounded-xl p-4">
                <AnalysisPanel />
              </div>
            </div>

            {/* Setups */}
            <div className={`${activeTab !== 'setups' ? 'hidden lg:block' : ''}`}>
              <div className="border border-gray-800 rounded-xl p-4">
                <SetupBuilder />
              </div>
            </div>

            {/* Trade Panel */}
            <div className={`${activeTab !== 'trade' ? 'hidden lg:block' : ''}`}>
              <div className="border border-gray-800 rounded-xl p-4">
                <TradePanel />
              </div>
            </div>
          </div>
        </div>
      </main>
    </div>
  );
}
