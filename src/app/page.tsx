'use client';

import { useState, useCallback } from 'react';
import dynamic from 'next/dynamic';
import { useAppStore } from '@/store';
import CoinSelector from '@/components/CoinSelector';
import ConnectWallet from '@/components/ConnectWallet';
import SetupBuilder from '@/components/SetupBuilder';
import TradePanel from '@/components/TradePanel';
import AnalysisPanel from '@/components/AnalysisPanel';

// Dynamic import for chart (SSR incompatible — TradingView widget uses DOM)
const Chart = dynamic(() => import('@/components/Chart'), { ssr: false });

type Tab = 'chart' | 'setups' | 'trade';

export default function Home() {
  const {
    selectedCoin,
    selectedTimeframe,
    analysis,
    setAnalysis,
  } = useAppStore();

  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [activeTab, setActiveTab] = useState<Tab>('chart');

  const loadAnalysis = useCallback(async () => {
    setLoading(true);
    setError(null);

    try {
      const res = await fetch('/api/analyze', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          coin: selectedCoin,
          timeframe: selectedTimeframe,
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
  }, [selectedCoin, selectedTimeframe, setAnalysis]);

  return (
    <div className="min-h-screen bg-[#0a0a0f]">
      {/* Header */}
      <header className="border-b border-gray-800 px-6 py-4">
        <div className="max-w-[1600px] mx-auto flex items-center justify-between">
          <div className="flex items-center gap-4">
            <h1 className="text-xl font-bold text-white tracking-tight">
              <span className="text-red-400">On</span>ATilt
            </h1>
            <span className="text-xs text-gray-600 hidden sm:block">Setup Validator</span>
          </div>
          <ConnectWallet />
        </div>
      </header>

      {/* Controls */}
      <div className="border-b border-gray-800 px-6 py-3">
        <div className="max-w-[1600px] mx-auto flex items-center justify-between gap-4 flex-wrap">
          <CoinSelector />
          <button
            onClick={loadAnalysis}
            disabled={loading}
            className="px-6 py-2 bg-blue-500 text-white rounded-lg text-sm font-medium disabled:opacity-50 hover:bg-blue-600 transition-colors"
          >
            {loading ? 'Analyzing...' : 'Analyze'}
          </button>
        </div>
      </div>

      {/* Error */}
      {error && (
        <div className="max-w-[1600px] mx-auto px-6 pt-4">
          <div className="bg-red-500/10 border border-red-500/30 rounded-lg p-3 text-red-400 text-sm">
            {error}
          </div>
        </div>
      )}

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
      <main className="max-w-[1600px] mx-auto px-6 py-6">
        <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
          {/* Chart Area */}
          <div className={`lg:col-span-8 ${activeTab !== 'chart' ? 'hidden lg:block' : ''}`}>
            <div className="border border-gray-800 rounded-xl overflow-hidden bg-[#0a0a0f]">
              <Chart coin={selectedCoin} timeframe={selectedTimeframe} analysis={analysis} height={550} />
            </div>

            {/* Analysis Details (below chart on desktop) */}
            <div className="hidden lg:block mt-6 border border-gray-800 rounded-xl p-5">
              <h3 className="text-lg font-semibold text-white mb-4">Analysis</h3>
              <AnalysisPanel />
            </div>
          </div>

          {/* Right Sidebar */}
          <div className="lg:col-span-4 space-y-6">
            {/* Analysis (mobile only) */}
            <div className={`lg:hidden ${activeTab !== 'chart' ? 'hidden' : ''}`}>
              <div className="border border-gray-800 rounded-xl p-5">
                <h3 className="text-lg font-semibold text-white mb-4">Analysis</h3>
                <AnalysisPanel />
              </div>
            </div>

            {/* Setups */}
            <div className={`${activeTab !== 'setups' ? 'hidden lg:block' : ''}`}>
              <div className="border border-gray-800 rounded-xl p-5">
                <SetupBuilder />
              </div>
            </div>

            {/* Trade Panel */}
            <div className={`${activeTab !== 'trade' ? 'hidden lg:block' : ''}`}>
              <div className="border border-gray-800 rounded-xl p-5">
                <TradePanel />
              </div>
            </div>
          </div>
        </div>
      </main>

      {/* Footer */}
      <footer className="border-t border-gray-800 px-6 py-4 mt-8">
        <div className="max-w-[1600px] mx-auto flex items-center justify-between text-xs text-gray-600">
          <span>OnATilt - Trade only when your setup is valid</span>
          <span>Hyperliquid Perps</span>
        </div>
      </footer>
    </div>
  );
}
