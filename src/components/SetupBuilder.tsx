'use client';

import { useState } from 'react';
import { useAppStore } from '@/store';
import type {
  TradingSetup,
  SetupCondition,
  ConditionTarget,
  ConditionOperator,
  SetupDirection,
  Timeframe,
} from '@/types';

const CONDITION_TARGETS: { value: ConditionTarget; label: string; operators: ConditionOperator[]; values: string[] }[] = [
  {
    value: 'trend',
    label: 'Market Trend',
    operators: ['is', 'is_not'],
    values: ['bullish', 'bearish', 'ranging'],
  },
  {
    value: 'last_structure_break',
    label: 'Last Structure Break',
    operators: ['is'],
    values: ['BOS', 'CHoCH'],
  },
  {
    value: 'price_zone',
    label: 'Price Zone',
    operators: ['is'],
    values: ['premium', 'discount', 'equilibrium'],
  },
  {
    value: 'sfp_present',
    label: 'SFP Present',
    operators: ['is'],
    values: ['bullish', 'bearish', 'any'],
  },
  {
    value: 'at_range_high',
    label: 'At Range High',
    operators: ['is'],
    values: ['true'],
  },
  {
    value: 'at_range_low',
    label: 'At Range Low',
    operators: ['is'],
    values: ['true'],
  },
  {
    value: 'at_order_block',
    label: 'At Order Block',
    operators: ['is'],
    values: ['bullish', 'bearish', 'any'],
  },
  {
    value: 'fvg_present',
    label: 'FVG Present',
    operators: ['is'],
    values: ['bullish', 'bearish', 'any'],
  },
  {
    value: 'near_swing_high',
    label: 'Near Swing High',
    operators: ['is'],
    values: ['true'],
  },
  {
    value: 'near_swing_low',
    label: 'Near Swing Low',
    operators: ['is'],
    values: ['true'],
  },
];

const TIMEFRAMES: Timeframe[] = ['1m', '5m', '15m', '30m', '1h', '2h', '4h', '8h', '12h', '1d', '1w'];

function generateId(): string {
  return Math.random().toString(36).slice(2, 11);
}

export default function SetupBuilder() {
  const { addSetup, setups, removeSetup, toggleSetup, availableCoins } = useAppStore();

  const [name, setName] = useState('');
  const [direction, setDirection] = useState<SetupDirection>('long');
  const [requireAll, setRequireAll] = useState(true);
  const [selectedCoins, setSelectedCoins] = useState<string[]>([]);
  const [conditions, setConditions] = useState<SetupCondition[]>([]);
  const [editing, setEditing] = useState(false);

  const addCondition = () => {
    const target = CONDITION_TARGETS[0];
    setConditions([
      ...conditions,
      {
        id: generateId(),
        target: target.value,
        operator: target.operators[0],
        value: target.values[0],
        timeframe: '4h',
        description: '',
      },
    ]);
  };

  const updateCondition = (index: number, updates: Partial<SetupCondition>) => {
    setConditions(conditions.map((c, i) => {
      if (i !== index) return c;
      const updated = { ...c, ...updates };

      // If target changed, reset operator and value
      if (updates.target) {
        const targetConfig = CONDITION_TARGETS.find(t => t.value === updates.target);
        if (targetConfig) {
          updated.operator = targetConfig.operators[0];
          updated.value = targetConfig.values[0];
        }
      }

      // Auto-generate description
      updated.description = `${updated.target} ${updated.operator} ${updated.value} on ${updated.timeframe}`;
      return updated;
    }));
  };

  const removeCondition = (index: number) => {
    setConditions(conditions.filter((_, i) => i !== index));
  };

  const saveSetup = () => {
    if (!name.trim() || conditions.length === 0) return;

    const setup: TradingSetup = {
      id: generateId(),
      name: name.trim(),
      direction,
      conditions: conditions.map(c => ({
        ...c,
        description: c.description || `${c.target} ${c.operator} ${c.value} on ${c.timeframe}`,
      })),
      requireAll,
      coins: selectedCoins,
      enabled: true,
      createdAt: Date.now(),
      updatedAt: Date.now(),
    };

    addSetup(setup);
    resetForm();
  };

  const resetForm = () => {
    setName('');
    setDirection('long');
    setRequireAll(true);
    setSelectedCoins([]);
    setConditions([]);
    setEditing(false);
  };

  return (
    <div className="space-y-6">
      {/* Existing Setups */}
      <div className="space-y-3">
        <h3 className="text-lg font-semibold text-white">Your Setups</h3>
        {setups.length === 0 ? (
          <p className="text-gray-500 text-sm">No setups defined. Create one to start gating your trades.</p>
        ) : (
          <div className="space-y-2">
            {setups.map((setup) => (
              <div
                key={setup.id}
                className={`border rounded-lg p-4 ${
                  setup.enabled ? 'border-green-500/30 bg-green-500/5' : 'border-gray-700 bg-gray-900/50'
                }`}
              >
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-3">
                    <button
                      onClick={() => toggleSetup(setup.id)}
                      className={`w-10 h-5 rounded-full transition-colors relative ${
                        setup.enabled ? 'bg-green-500' : 'bg-gray-600'
                      }`}
                    >
                      <span
                        className={`absolute top-0.5 w-4 h-4 rounded-full bg-white transition-transform ${
                          setup.enabled ? 'left-5' : 'left-0.5'
                        }`}
                      />
                    </button>
                    <div>
                      <span className="text-white font-medium">{setup.name}</span>
                      <span className={`ml-2 text-xs px-2 py-0.5 rounded ${
                        setup.direction === 'long' ? 'bg-green-500/20 text-green-400' :
                        setup.direction === 'short' ? 'bg-red-500/20 text-red-400' :
                        'bg-blue-500/20 text-blue-400'
                      }`}>
                        {setup.direction.toUpperCase()}
                      </span>
                    </div>
                  </div>
                  <button
                    onClick={() => removeSetup(setup.id)}
                    className="text-gray-500 hover:text-red-400 transition-colors"
                  >
                    Remove
                  </button>
                </div>
                <div className="mt-2 space-y-1">
                  {setup.conditions.map((c, i) => (
                    <div key={c.id} className="text-xs text-gray-400 flex items-center gap-1">
                      <span className="text-gray-600">{i > 0 ? (setup.requireAll ? 'AND' : 'OR') : '   '}</span>
                      <span>{c.description}</span>
                    </div>
                  ))}
                </div>
                {setup.coins.length > 0 && (
                  <div className="mt-2 text-xs text-gray-500">
                    Coins: {setup.coins.join(', ')}
                  </div>
                )}
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Create New Setup */}
      {!editing ? (
        <button
          onClick={() => setEditing(true)}
          className="w-full py-3 border border-dashed border-gray-600 rounded-lg text-gray-400 hover:border-blue-500 hover:text-blue-400 transition-colors"
        >
          + New Setup
        </button>
      ) : (
        <div className="border border-blue-500/30 rounded-lg p-5 bg-blue-500/5 space-y-4">
          <h3 className="text-lg font-semibold text-white">New Setup</h3>

          {/* Name */}
          <div>
            <label className="block text-sm text-gray-400 mb-1">Setup Name</label>
            <input
              type="text"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="e.g. BTC 4H Range Low Long"
              className="w-full bg-gray-900 border border-gray-700 rounded-lg px-3 py-2 text-white text-sm focus:outline-none focus:border-blue-500"
            />
          </div>

          {/* Direction */}
          <div>
            <label className="block text-sm text-gray-400 mb-1">Direction</label>
            <div className="flex gap-2">
              {(['long', 'short', 'both'] as SetupDirection[]).map((d) => (
                <button
                  key={d}
                  onClick={() => setDirection(d)}
                  className={`px-4 py-2 rounded-lg text-sm font-medium transition-colors ${
                    direction === d
                      ? d === 'long' ? 'bg-green-500 text-white' :
                        d === 'short' ? 'bg-red-500 text-white' :
                        'bg-blue-500 text-white'
                      : 'bg-gray-800 text-gray-400 hover:bg-gray-700'
                  }`}
                >
                  {d.toUpperCase()}
                </button>
              ))}
            </div>
          </div>

          {/* Logic */}
          <div>
            <label className="block text-sm text-gray-400 mb-1">Condition Logic</label>
            <div className="flex gap-2">
              <button
                onClick={() => setRequireAll(true)}
                className={`px-4 py-2 rounded-lg text-sm transition-colors ${
                  requireAll ? 'bg-blue-500 text-white' : 'bg-gray-800 text-gray-400'
                }`}
              >
                ALL conditions (AND)
              </button>
              <button
                onClick={() => setRequireAll(false)}
                className={`px-4 py-2 rounded-lg text-sm transition-colors ${
                  !requireAll ? 'bg-blue-500 text-white' : 'bg-gray-800 text-gray-400'
                }`}
              >
                ANY condition (OR)
              </button>
            </div>
          </div>

          {/* Coin Filter */}
          <div>
            <label className="block text-sm text-gray-400 mb-1">
              Coins (leave empty for all)
            </label>
            <input
              type="text"
              value={selectedCoins.join(', ')}
              onChange={(e) =>
                setSelectedCoins(
                  e.target.value
                    .split(',')
                    .map((s) => s.trim().toUpperCase())
                    .filter(Boolean)
                )
              }
              placeholder="BTC, ETH, SOL"
              className="w-full bg-gray-900 border border-gray-700 rounded-lg px-3 py-2 text-white text-sm focus:outline-none focus:border-blue-500"
            />
          </div>

          {/* Conditions */}
          <div className="space-y-3">
            <label className="block text-sm text-gray-400">Conditions</label>
            {conditions.map((condition, index) => {
              const targetConfig = CONDITION_TARGETS.find(t => t.value === condition.target);

              return (
                <div key={condition.id} className="flex items-start gap-2 bg-gray-900/50 rounded-lg p-3">
                  {index > 0 && (
                    <span className="text-xs text-gray-500 mt-2 w-8">
                      {requireAll ? 'AND' : 'OR'}
                    </span>
                  )}

                  <div className="flex-1 grid grid-cols-4 gap-2">
                    {/* Target */}
                    <select
                      value={condition.target}
                      onChange={(e) => updateCondition(index, { target: e.target.value as ConditionTarget })}
                      className="bg-gray-800 border border-gray-700 rounded px-2 py-1.5 text-white text-xs focus:outline-none"
                    >
                      {CONDITION_TARGETS.map((t) => (
                        <option key={t.value} value={t.value}>{t.label}</option>
                      ))}
                    </select>

                    {/* Operator */}
                    <select
                      value={condition.operator}
                      onChange={(e) => updateCondition(index, { operator: e.target.value as ConditionOperator })}
                      className="bg-gray-800 border border-gray-700 rounded px-2 py-1.5 text-white text-xs focus:outline-none"
                    >
                      {targetConfig?.operators.map((op) => (
                        <option key={op} value={op}>{op}</option>
                      ))}
                    </select>

                    {/* Value */}
                    <select
                      value={condition.value}
                      onChange={(e) => updateCondition(index, { value: e.target.value })}
                      className="bg-gray-800 border border-gray-700 rounded px-2 py-1.5 text-white text-xs focus:outline-none"
                    >
                      {targetConfig?.values.map((v) => (
                        <option key={v} value={v}>{v}</option>
                      ))}
                    </select>

                    {/* Timeframe */}
                    <select
                      value={condition.timeframe}
                      onChange={(e) => updateCondition(index, { timeframe: e.target.value as Timeframe })}
                      className="bg-gray-800 border border-gray-700 rounded px-2 py-1.5 text-white text-xs focus:outline-none"
                    >
                      {TIMEFRAMES.map((tf) => (
                        <option key={tf} value={tf}>{tf}</option>
                      ))}
                    </select>
                  </div>

                  <button
                    onClick={() => removeCondition(index)}
                    className="text-gray-500 hover:text-red-400 text-sm mt-1"
                  >
                    x
                  </button>
                </div>
              );
            })}

            <button
              onClick={addCondition}
              className="text-sm text-blue-400 hover:text-blue-300"
            >
              + Add Condition
            </button>
          </div>

          {/* Actions */}
          <div className="flex gap-3 pt-2">
            <button
              onClick={saveSetup}
              disabled={!name.trim() || conditions.length === 0}
              className="px-6 py-2 bg-blue-500 text-white rounded-lg text-sm font-medium disabled:opacity-50 disabled:cursor-not-allowed hover:bg-blue-600 transition-colors"
            >
              Save Setup
            </button>
            <button
              onClick={resetForm}
              className="px-6 py-2 bg-gray-800 text-gray-400 rounded-lg text-sm hover:bg-gray-700 transition-colors"
            >
              Cancel
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
