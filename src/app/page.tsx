'use client';

import { useState, useCallback } from 'react';
import dynamic from 'next/dynamic';
import { useAppStore } from '@/store';
import ConnectWallet from '@/components/ConnectWallet';
import SetupBuilder from '@/components/SetupBuilder';
import TradePanel from '@/components/TradePanel';
import AnalysisPanel from '@/components/AnalysisPanel';
import SFPScanner from '@/components/SFPScanner';
import type { Candle, Timeframe } from '@/types';

// Dynamic imports (SSR incompatible — uses DOM / canvas)
const Chart = dynamic(() => import('@/components/Chart'), { ssr: false });
const TradingViewChart = dynamic(() => import('@/components/TradingViewChart'), { ssr: false });

const TIMEFRAMES: Timeframe[] = ['5m', '15m', '30m', '1h', '4h', '12h', '1d', '1w', '1M'];

type Tab = 'chart' | 'setups' | 'trade';
type ChartView = 'analysis' | 'tradingview' | 'scanner';

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
  const [chartView, setChartView] = useState<ChartView>('analysis');
  const [analysisCoin, setAnalysisCoin] = useState(selectedCoin);
  const [analysisTimeframe, setAnalysisTimeframe] = useState(selectedTimeframe);
  const [candles, setCandles] = useState<Candle[]>([]);

  const loadAnalysis = useCallback(async (overrideCoin?: string, overrideTf?: Timeframe) => {
    const coin = overrideCoin ?? analysisCoin;
    const tf = overrideTf ?? analysisTimeframe;
    setLoading(true);
    setError(null);

    try {
      setSelectedCoin(coin);
      setSelectedTimeframe(tf);

      const res = await fetch('/api/analyze', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          coin,
          timeframe: tf,
        }),
      });

      const data = await res.json();

      if (data.error) {
        setError(data.error);
        return;
      }

      setCandles(data.candles || []);
      setAnalysis(data.analysis);
      // Switch to analysis view when data loads
      setChartView('analysis');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load data');
    } finally {
      setLoading(false);
    }
  }, [analysisCoin, analysisTimeframe, setAnalysis, setSelectedCoin, setSelectedTimeframe]);

  // Called when a scanner result is clicked
  const handleScannerSelect = useCallback((coin: string, timeframe: Timeframe) => {
    setAnalysisCoin(coin);
    setAnalysisTimeframe(timeframe);
    loadAnalysis(coin, timeframe);
  }, [loadAnalysis]);

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
            {/* Analysis Controls + Chart View Toggle */}
            <div className="mb-3 border border-gray-800 rounded-xl p-3">
              <div className="flex items-center gap-3 flex-wrap">
                {chartView !== 'scanner' && (
                  <>
                    <input
                      type="text"
                      value={analysisCoin}
                      onChange={(e) => {
                        setAnalysisCoin(e.target.value.toUpperCase());
                        setAnalysis(null);
                        setCandles([]);
                      }}
                      placeholder="BTC"
                      className="w-24 bg-gray-900 border border-gray-700 rounded-lg px-3 py-1.5 text-white text-sm font-semibold focus:outline-none focus:border-blue-500 text-center uppercase"
                    />
                    <div className="flex gap-1 bg-gray-900 rounded-lg p-0.5">
                      {TIMEFRAMES.map((tf) => (
                        <button
                          key={tf}
                          onClick={() => {
                            setAnalysisTimeframe(tf);
                            if (analysisCoin.trim()) loadAnalysis(undefined, tf);
                          }}
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
                      onClick={() => loadAnalysis()}
                      disabled={loading || !analysisCoin.trim()}
                      className="px-5 py-1.5 bg-blue-500 text-white rounded-lg text-sm font-medium disabled:opacity-50 hover:bg-blue-600 transition-colors"
                    >
                      {loading ? 'Analyzing...' : 'Analyze'}
                    </button>

                    {/* Show what was analyzed */}
                    {analysis && (
                      <span className="text-xs text-gray-500 ml-2">
                        Showing: <span className="text-white font-medium">{analysis.coin}</span> {analysis.timeframe}
                        {' | '}
                        <span className="text-gray-400">
                          {analysis.marketStructure.trend.toUpperCase()} trend
                        </span>
                      </span>
                    )}
                  </>
                )}

                {/* Chart view toggle - pushed to right */}
                <div className={`flex gap-1 bg-gray-900 rounded-lg p-0.5 ${chartView === 'scanner' ? '' : 'ml-auto'}`}>
                  <button
                    onClick={() => setChartView('analysis')}
                    className={`px-3 py-1 rounded text-xs font-medium transition-colors ${
                      chartView === 'analysis'
                        ? 'bg-blue-500 text-white'
                        : 'text-gray-400 hover:text-white hover:bg-gray-800'
                    }`}
                  >
                    Analysis
                  </button>
                  <button
                    onClick={() => setChartView('tradingview')}
                    className={`px-3 py-1 rounded text-xs font-medium transition-colors ${
                      chartView === 'tradingview'
                        ? 'bg-blue-500 text-white'
                        : 'text-gray-400 hover:text-white hover:bg-gray-800'
                    }`}
                  >
                    TradingView
                  </button>
                  <button
                    onClick={() => setChartView('scanner')}
                    className={`px-3 py-1 rounded text-xs font-medium transition-colors ${
                      chartView === 'scanner'
                        ? 'bg-purple-500 text-white'
                        : 'text-gray-400 hover:text-white hover:bg-gray-800'
                    }`}
                  >
                    Scanner
                  </button>
                </div>
              </div>

              {error && (
                <div className="bg-red-500/10 border border-red-500/30 rounded-lg p-3 text-red-400 text-sm mt-3">
                  {error}
                </div>
              )}
            </div>

            {/* Chart / Scanner */}
            <div className="rounded-xl overflow-hidden bg-[#0a0a0f]">
              {chartView === 'analysis' ? (
                <Chart candles={candles} analysis={analysis} height={600} />
              ) : chartView === 'tradingview' ? (
                <TradingViewChart height={600} />
              ) : (
                <div className="border border-gray-800 rounded-xl p-4" style={{ minHeight: 600 }}>
                  <SFPScanner onSelectCoin={handleScannerSelect} />
                </div>
              )}
            </div>

            {/* Analysis Summary below chart */}
            {analysis && chartView === 'analysis' && (
              <div className="mt-3 border border-gray-800 rounded-xl p-4">
                <AnalysisPanel />
              </div>
            )}
          </div>

          {/* Right Sidebar */}
          <div className="lg:col-span-4 xl:col-span-3 space-y-4">
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
