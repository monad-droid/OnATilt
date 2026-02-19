'use client';

import { useAppStore } from '@/store';

export default function AnalysisPanel() {
  const { analysis } = useAppStore();

  if (!analysis) {
    return (
      <div className="text-gray-500 text-sm p-4">
        Load a chart to see analysis
      </div>
    );
  }

  const ms = analysis.marketStructure;
  const recentStructure = ms.structurePoints.slice(-10);
  const activeSFPs = analysis.sfps.slice(-5);
  const activeRanges = analysis.ranges.filter(r => !r.broken);
  const activeOBs = analysis.orderBlocks.filter(ob => !ob.mitigated).slice(-5);
  const activeFVGs = analysis.fvgs.filter(f => !f.filled).slice(-5);

  return (
    <div className="space-y-4 text-sm">
      {/* Market Structure */}
      <div>
        <h4 className="text-white font-medium mb-2">Market Structure</h4>
        <div className="space-y-1">
          <div className="flex justify-between">
            <span className="text-gray-400">Trend</span>
            <span className={
              ms.trend === 'bullish' ? 'text-green-400' :
              ms.trend === 'bearish' ? 'text-red-400' : 'text-yellow-400'
            }>
              {ms.trend.toUpperCase()}
            </span>
          </div>

          {ms.lastBOS && (
            <div className="flex justify-between">
              <span className="text-gray-400">Last BOS</span>
              <span className="text-blue-400">
                {ms.lastBOS.label} @ {ms.lastBOS.swing.price.toFixed(2)}
              </span>
            </div>
          )}

          {ms.lastCHoCH && (
            <div className="flex justify-between">
              <span className="text-gray-400">Last CHoCH</span>
              <span className="text-yellow-400">
                {ms.lastCHoCH.label} @ {ms.lastCHoCH.swing.price.toFixed(2)}
              </span>
            </div>
          )}

          <div className="text-xs text-gray-500 mt-1">
            Recent: {recentStructure.map(sp => (
              <span
                key={sp.swing.index}
                className={`mr-1 ${
                  sp.breakType === 'BOS' ? 'text-blue-400' :
                  sp.breakType === 'CHoCH' ? 'text-yellow-400' :
                  'text-gray-500'
                }`}
              >
                {sp.label}
              </span>
            ))}
          </div>
        </div>
      </div>

      {/* Price Position */}
      {analysis.priceRelativeToRange && (
        <div>
          <h4 className="text-white font-medium mb-2">Price Position</h4>
          <div className="space-y-1">
            <div className="flex justify-between">
              <span className="text-gray-400">Zone</span>
              <span className={
                analysis.priceRelativeToRange.zone === 'discount' ? 'text-green-400' :
                analysis.priceRelativeToRange.zone === 'premium' ? 'text-red-400' :
                'text-yellow-400'
              }>
                {analysis.priceRelativeToRange.zone.toUpperCase()}
              </span>
            </div>
            <div className="flex justify-between">
              <span className="text-gray-400">Range %</span>
              <span className="text-white">{analysis.priceRelativeToRange.percentInRange.toFixed(1)}%</span>
            </div>
          </div>
        </div>
      )}

      {/* SFPs */}
      <div>
        <h4 className="text-white font-medium mb-2">
          Swing Failure Patterns
          <span className="text-gray-500 font-normal ml-2">({analysis.sfps.length})</span>
        </h4>
        {activeSFPs.length === 0 ? (
          <span className="text-gray-500 text-xs">None detected</span>
        ) : (
          <div className="space-y-1">
            {activeSFPs.map((sfp, i) => (
              <div key={i} className="flex justify-between text-xs">
                <span className={sfp.type === 'bullish' ? 'text-green-400' : 'text-red-400'}>
                  {sfp.type.toUpperCase()} SFP
                </span>
                <span className="text-gray-400">
                  Swept {sfp.sweptSwing.price.toFixed(2)} by {sfp.wickDepth.toFixed(2)}
                </span>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Ranges */}
      <div>
        <h4 className="text-white font-medium mb-2">
          Active Ranges
          <span className="text-gray-500 font-normal ml-2">({activeRanges.length})</span>
        </h4>
        {activeRanges.length === 0 ? (
          <span className="text-gray-500 text-xs">No active ranges</span>
        ) : (
          <div className="space-y-2">
            {activeRanges.slice(0, 3).map((r, i) => (
              <div key={i} className="bg-gray-900/50 rounded p-2 text-xs space-y-0.5">
                <div className="flex justify-between">
                  <span className="text-red-400">High</span>
                  <span className="text-white">{r.high.toFixed(2)}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-gray-400">EQ</span>
                  <span className="text-white">{r.equilibrium.toFixed(2)}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-green-400">Low</span>
                  <span className="text-white">{r.low.toFixed(2)}</span>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Order Blocks */}
      <div>
        <h4 className="text-white font-medium mb-2">
          Order Blocks
          <span className="text-gray-500 font-normal ml-2">({activeOBs.length} unmitigated)</span>
        </h4>
        {activeOBs.length === 0 ? (
          <span className="text-gray-500 text-xs">No unmitigated OBs</span>
        ) : (
          <div className="space-y-1">
            {activeOBs.map((ob, i) => (
              <div key={i} className="flex justify-between text-xs">
                <span className={ob.type === 'bullish' ? 'text-green-400' : 'text-red-400'}>
                  {ob.type.toUpperCase()}
                </span>
                <span className="text-gray-400">
                  {ob.low.toFixed(2)} - {ob.high.toFixed(2)}
                </span>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* FVGs */}
      <div>
        <h4 className="text-white font-medium mb-2">
          Fair Value Gaps
          <span className="text-gray-500 font-normal ml-2">({activeFVGs.length} unfilled)</span>
        </h4>
        {activeFVGs.length === 0 ? (
          <span className="text-gray-500 text-xs">No unfilled FVGs</span>
        ) : (
          <div className="space-y-1">
            {activeFVGs.map((fvg, i) => (
              <div key={i} className="flex justify-between text-xs">
                <span className={fvg.type === 'bullish' ? 'text-green-400' : 'text-red-400'}>
                  {fvg.type.toUpperCase()}
                </span>
                <span className="text-gray-400">
                  {fvg.low.toFixed(2)} - {fvg.high.toFixed(2)} ({fvg.fillPercent.toFixed(0)}% filled)
                </span>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
