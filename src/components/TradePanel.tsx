'use client';

import { useState } from 'react';
import { useAppStore } from '@/store';
import type { OrderSide, OrderType, TIF } from '@/types';

interface ValidationResult {
  setupName: string;
  valid: boolean;
  conditions: { description: string; met: boolean; reason: string }[];
}

export default function TradePanel() {
  const { selectedCoin, setups, config } = useAppStore();

  const [side, setSide] = useState<OrderSide>('buy');
  const [orderType, setOrderType] = useState<OrderType>('market');
  const [size, setSize] = useState('');
  const [price, setPrice] = useState('');
  const [leverage, setLeverage] = useState('10');
  const [tif, setTif] = useState<TIF>('Gtc');
  const [reduceOnly, setReduceOnly] = useState(false);

  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState<{
    success?: boolean;
    blocked?: boolean;
    blockReason?: string;
    error?: string;
    orderId?: string;
    validations?: ValidationResult[];
  } | null>(null);

  const handleTrade = async () => {
    if (!size || (orderType === 'limit' && !price)) return;
    if (!config?.privateKey) {
      setResult({ error: 'Connect your API key first' });
      return;
    }

    setLoading(true);
    setResult(null);

    try {
      const response = await fetch('/api/trade', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          trade: {
            coin: selectedCoin,
            side,
            size: parseFloat(size),
            price: price ? parseFloat(price) : undefined,
            orderType,
            reduceOnly,
            tif,
            leverage: parseInt(leverage),
          },
          setups,
          config,
        }),
      });

      const data = await response.json();
      setResult(data);
    } catch (err) {
      setResult({ error: err instanceof Error ? err.message : 'Request failed' });
    } finally {
      setLoading(false);
    }
  };

  const enabledSetups = setups.filter(s => s.enabled);

  return (
    <div className="space-y-4">
      <h3 className="text-lg font-semibold text-white">Trade {selectedCoin}-PERP</h3>

      {/* Connection Warning */}
      {!config?.privateKey && (
        <div className="bg-yellow-500/10 border border-yellow-500/30 rounded-lg p-3 text-yellow-400 text-sm">
          Connect your Hyperliquid API key to place trades
        </div>
      )}

      {/* No Setup Warning */}
      {enabledSetups.length === 0 && (
        <div className="bg-orange-500/10 border border-orange-500/30 rounded-lg p-3 text-orange-400 text-sm">
          No enabled setups. Trades will be blocked until you define and enable a setup.
        </div>
      )}

      {/* Side */}
      <div className="grid grid-cols-2 gap-2">
        <button
          onClick={() => setSide('buy')}
          className={`py-3 rounded-lg font-semibold text-sm transition-colors ${
            side === 'buy'
              ? 'bg-green-500 text-white'
              : 'bg-gray-800 text-gray-400 hover:bg-gray-700'
          }`}
        >
          LONG
        </button>
        <button
          onClick={() => setSide('sell')}
          className={`py-3 rounded-lg font-semibold text-sm transition-colors ${
            side === 'sell'
              ? 'bg-red-500 text-white'
              : 'bg-gray-800 text-gray-400 hover:bg-gray-700'
          }`}
        >
          SHORT
        </button>
      </div>

      {/* Order Type */}
      <div className="flex gap-2">
        <button
          onClick={() => setOrderType('market')}
          className={`flex-1 py-2 rounded-lg text-sm transition-colors ${
            orderType === 'market' ? 'bg-blue-500 text-white' : 'bg-gray-800 text-gray-400'
          }`}
        >
          Market
        </button>
        <button
          onClick={() => setOrderType('limit')}
          className={`flex-1 py-2 rounded-lg text-sm transition-colors ${
            orderType === 'limit' ? 'bg-blue-500 text-white' : 'bg-gray-800 text-gray-400'
          }`}
        >
          Limit
        </button>
      </div>

      {/* Size */}
      <div>
        <label className="block text-sm text-gray-400 mb-1">Size</label>
        <input
          type="number"
          value={size}
          onChange={(e) => setSize(e.target.value)}
          placeholder="0.001"
          step="any"
          className="w-full bg-gray-900 border border-gray-700 rounded-lg px-3 py-2 text-white text-sm focus:outline-none focus:border-blue-500"
        />
      </div>

      {/* Price (for limit orders) */}
      {orderType === 'limit' && (
        <>
          <div>
            <label className="block text-sm text-gray-400 mb-1">Limit Price</label>
            <input
              type="number"
              value={price}
              onChange={(e) => setPrice(e.target.value)}
              placeholder="50000"
              step="any"
              className="w-full bg-gray-900 border border-gray-700 rounded-lg px-3 py-2 text-white text-sm focus:outline-none focus:border-blue-500"
            />
          </div>

          <div>
            <label className="block text-sm text-gray-400 mb-1">Time in Force</label>
            <select
              value={tif}
              onChange={(e) => setTif(e.target.value as TIF)}
              className="w-full bg-gray-900 border border-gray-700 rounded-lg px-3 py-2 text-white text-sm focus:outline-none"
            >
              <option value="Gtc">Good Til Canceled</option>
              <option value="Ioc">Immediate or Cancel</option>
              <option value="Alo">Post Only</option>
            </select>
          </div>
        </>
      )}

      {/* Leverage */}
      <div>
        <label className="block text-sm text-gray-400 mb-1">Leverage: {leverage}x</label>
        <input
          type="range"
          min="1"
          max="50"
          value={leverage}
          onChange={(e) => setLeverage(e.target.value)}
          className="w-full accent-blue-500"
        />
      </div>

      {/* Reduce Only */}
      <label className="flex items-center gap-2 cursor-pointer">
        <input
          type="checkbox"
          checked={reduceOnly}
          onChange={(e) => setReduceOnly(e.target.checked)}
          className="accent-blue-500"
        />
        <span className="text-sm text-gray-400">Reduce Only</span>
      </label>

      {/* Submit */}
      <button
        onClick={handleTrade}
        disabled={loading || !size || (orderType === 'limit' && !price)}
        className={`w-full py-3 rounded-lg font-semibold text-sm transition-colors disabled:opacity-50 disabled:cursor-not-allowed ${
          side === 'buy'
            ? 'bg-green-500 hover:bg-green-600 text-white'
            : 'bg-red-500 hover:bg-red-600 text-white'
        }`}
      >
        {loading ? 'Validating Setup...' : `${side === 'buy' ? 'Long' : 'Short'} ${selectedCoin}`}
      </button>

      {/* Result */}
      {result && (
        <div className={`rounded-lg p-4 text-sm space-y-2 ${
          result.blocked
            ? 'bg-red-500/10 border border-red-500/30'
            : result.error
            ? 'bg-yellow-500/10 border border-yellow-500/30'
            : 'bg-green-500/10 border border-green-500/30'
        }`}>
          {result.blocked && (
            <>
              <div className="text-red-400 font-semibold">TRADE BLOCKED</div>
              <div className="text-red-300 whitespace-pre-line">{result.blockReason}</div>
            </>
          )}

          {result.error && !result.blocked && (
            <div className="text-yellow-400">{result.error}</div>
          )}

          {result.success && (
            <div className="text-green-400">
              Order placed successfully
              {result.orderId && <span className="text-gray-500 ml-2">({result.orderId})</span>}
            </div>
          )}

          {/* Validation Details */}
          {result.validations && result.validations.length > 0 && (
            <div className="mt-3 space-y-2">
              <div className="text-gray-400 text-xs font-medium">Setup Validation:</div>
              {result.validations.map((v, i) => (
                <div key={i} className="bg-black/30 rounded p-2">
                  <div className="flex items-center gap-2">
                    <span className={v.valid ? 'text-green-400' : 'text-red-400'}>
                      {v.valid ? 'PASS' : 'FAIL'}
                    </span>
                    <span className="text-white text-xs">{v.setupName}</span>
                  </div>
                  <div className="mt-1 space-y-0.5">
                    {v.conditions.map((c, j) => (
                      <div key={j} className="flex items-center gap-2 text-xs">
                        <span className={c.met ? 'text-green-500' : 'text-red-500'}>
                          {c.met ? '+' : '-'}
                        </span>
                        <span className="text-gray-400">{c.reason}</span>
                      </div>
                    ))}
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
