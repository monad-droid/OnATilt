'use client';

import type { FundingEstimate } from '@/hooks/usePremiumPoller';

interface EstimateTrackerProps {
  estimates: FundingEstimate[];
}

export default function EstimateTracker({ estimates }: EstimateTrackerProps) {
  if (estimates.length === 0) return null;

  // Most recent first
  const sorted = [...estimates].reverse();

  // Stats: only for estimates with actuals
  const withActuals = sorted.filter(e => e.actual !== null);
  const errors = withActuals.map(e => Math.abs(e.estimatedFR - e.actual!));
  const mae = errors.length > 0
    ? errors.reduce((a, b) => a + b, 0) / errors.length
    : 0;

  return (
    <div className="border border-gray-800 rounded-lg p-3 bg-gray-900/30">
      <div className="flex items-center justify-between mb-2">
        <h4 className="text-white text-sm font-medium">Estimate Accuracy</h4>
        <div className="flex items-center gap-3 text-xs">
          {withActuals.length > 0 && (
            <span className="text-gray-400">
              MAE: <span className="text-white font-medium">{(mae * 100).toFixed(6)}%</span>
            </span>
          )}
          <span className="text-gray-500">
            {withActuals.length} settled · {sorted.length - withActuals.length} pending
          </span>
        </div>
      </div>

      <div className="max-h-48 overflow-y-auto border border-gray-800 rounded-lg">
        <table className="w-full text-xs">
          <thead className="sticky top-0 bg-gray-900">
            <tr className="text-gray-400">
              <th className="text-left px-3 py-2">Hour</th>
              <th className="text-right px-3 py-2">Premium (TWAP)</th>
              <th className="text-right px-3 py-2">Est. FR</th>
              <th className="text-right px-3 py-2">Actual FR</th>
              <th className="text-right px-3 py-2">Error</th>
            </tr>
          </thead>
          <tbody>
            {sorted.map(e => {
              const premPct = e.premiumAvg * 100;
              const estPct = e.estimatedFR * 100;
              const actPct = e.actual !== null ? e.actual * 100 : null;
              const errPct = actPct !== null ? (e.estimatedFR - e.actual!) * 100 : null;

              return (
                <tr key={e.hourStart} className="border-t border-gray-800/50 hover:bg-gray-900/50">
                  <td className="px-3 py-1.5 text-gray-300">
                    {new Date(e.hourStart).toLocaleString([], {
                      month: 'short',
                      day: 'numeric',
                      hour: '2-digit',
                      minute: '2-digit',
                    })}
                  </td>
                  <td className={`px-3 py-1.5 text-right ${premPct >= 0 ? 'text-green-400' : 'text-red-400'}`}>
                    {premPct >= 0 ? '+' : ''}{premPct.toFixed(4)}%
                  </td>
                  <td className={`px-3 py-1.5 text-right ${estPct >= 0 ? 'text-green-400' : 'text-red-400'}`}>
                    {estPct >= 0 ? '+' : ''}{estPct.toFixed(6)}%
                  </td>
                  <td className={`px-3 py-1.5 text-right ${
                    actPct === null
                      ? 'text-gray-500 italic'
                      : actPct >= 0 ? 'text-green-400' : 'text-red-400'
                  }`}>
                    {actPct === null
                      ? 'pending'
                      : `${actPct >= 0 ? '+' : ''}${actPct.toFixed(6)}%`}
                  </td>
                  <td className={`px-3 py-1.5 text-right font-medium ${
                    errPct === null
                      ? 'text-gray-500'
                      : Math.abs(errPct) < 0.0001
                        ? 'text-gray-300'
                        : 'text-yellow-400'
                  }`}>
                    {errPct === null
                      ? '\u2014'
                      : `${errPct >= 0 ? '+' : ''}${errPct.toFixed(6)}%`}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}
