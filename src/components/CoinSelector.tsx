'use client';

import { useEffect, useState } from 'react';
import { useAppStore } from '@/store';
import type { Timeframe } from '@/types';

const TIMEFRAMES: Timeframe[] = ['1m', '5m', '15m', '30m', '1h', '2h', '4h', '8h', '12h', '1d', '1w'];
const POPULAR_COINS = ['BTC', 'ETH', 'SOL', 'DOGE', 'WIF', 'PEPE', 'ARB', 'OP', 'AVAX', 'LINK', 'SUI', 'APT'];

export default function CoinSelector() {
  const {
    selectedCoin,
    selectedTimeframe,
    setSelectedCoin,
    setSelectedTimeframe,
    availableCoins,
    setAvailableCoins,
  } = useAppStore();

  const [search, setSearch] = useState('');
  const [showDropdown, setShowDropdown] = useState(false);

  useEffect(() => {
    async function loadCoins() {
      try {
        const res = await fetch('/api/market-data', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ action: 'assets' }),
        });
        const data = await res.json();
        if (data.assets) {
          setAvailableCoins(data.assets.map((a: { name: string }) => a.name));
        }
      } catch {
        // Fall back to popular coins
        setAvailableCoins(POPULAR_COINS);
      }
    }

    if (availableCoins.length === 0) {
      loadCoins();
    }
  }, [availableCoins.length, setAvailableCoins]);

  const filteredCoins = search
    ? availableCoins.filter((c) => c.toLowerCase().includes(search.toLowerCase()))
    : POPULAR_COINS.filter((c) => availableCoins.includes(c));

  return (
    <div className="flex items-center gap-3">
      {/* Coin selector */}
      <div className="relative">
        <button
          onClick={() => setShowDropdown(!showDropdown)}
          className="flex items-center gap-2 bg-gray-800 border border-gray-700 rounded-lg px-4 py-2 text-white font-semibold hover:bg-gray-700 transition-colors"
        >
          {selectedCoin}
          <svg className="w-4 h-4 text-gray-400" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
          </svg>
        </button>

        {showDropdown && (
          <div className="absolute top-full mt-1 left-0 w-48 bg-gray-900 border border-gray-700 rounded-lg shadow-xl z-50 max-h-64 overflow-y-auto">
            <div className="p-2">
              <input
                type="text"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="Search..."
                autoFocus
                className="w-full bg-gray-800 border border-gray-700 rounded px-2 py-1.5 text-white text-sm focus:outline-none"
              />
            </div>
            <div className="py-1">
              {filteredCoins.slice(0, 20).map((coin) => (
                <button
                  key={coin}
                  onClick={() => {
                    setSelectedCoin(coin);
                    setShowDropdown(false);
                    setSearch('');
                  }}
                  className={`w-full text-left px-3 py-1.5 text-sm hover:bg-gray-800 transition-colors ${
                    coin === selectedCoin ? 'text-blue-400' : 'text-white'
                  }`}
                >
                  {coin}
                </button>
              ))}
            </div>
          </div>
        )}
      </div>

      {/* Timeframe tabs */}
      <div className="flex gap-1 bg-gray-900 rounded-lg p-1">
        {TIMEFRAMES.map((tf) => (
          <button
            key={tf}
            onClick={() => setSelectedTimeframe(tf)}
            className={`px-3 py-1.5 rounded text-xs font-medium transition-colors ${
              selectedTimeframe === tf
                ? 'bg-blue-500 text-white'
                : 'text-gray-400 hover:text-white hover:bg-gray-800'
            }`}
          >
            {tf}
          </button>
        ))}
      </div>
    </div>
  );
}
