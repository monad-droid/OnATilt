import { NextRequest, NextResponse } from 'next/server';
import {
  queryDetections,
  getDetectionStats,
  getDetectionsNeedingSnapshots,
  savePriceSnapshot,
  exportDetectionsCSV,
  type DetectionQuery,
} from '@/lib/db';
import { fetchAllMids } from '@/lib/hyperliquid';

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { action } = body as { action: string };

    // --------------------------------------------------------
    // Query saved SFP detections with optional filters
    // --------------------------------------------------------
    if (action === 'query') {
      const query: DetectionQuery = {
        coin: body.coin,
        sfp_type: body.sfp_type,
        timeframe: body.timeframe,
        trend: body.trend,
        from: body.from,
        to: body.to,
        limit: body.limit,
        offset: body.offset,
      };

      const detections = queryDetections(query);
      const stats = getDetectionStats(query);

      return NextResponse.json({ detections, stats });
    }

    // --------------------------------------------------------
    // Get aggregate stats
    // --------------------------------------------------------
    if (action === 'stats') {
      const stats = getDetectionStats({
        coin: body.coin,
        sfp_type: body.sfp_type,
        timeframe: body.timeframe,
        from: body.from,
        to: body.to,
      });

      return NextResponse.json({ stats });
    }

    // --------------------------------------------------------
    // Export as CSV
    // --------------------------------------------------------
    if (action === 'export') {
      const csv = exportDetectionsCSV({
        coin: body.coin,
        sfp_type: body.sfp_type,
        timeframe: body.timeframe,
        trend: body.trend,
        from: body.from,
        to: body.to,
        limit: body.limit ?? 10000,
      });

      return new NextResponse(csv, {
        headers: {
          'Content-Type': 'text/csv',
          'Content-Disposition': `attachment; filename="sfp-detections-${Date.now()}.csv"`,
        },
      });
    }

    // --------------------------------------------------------
    // Backfill price snapshots for detections old enough
    // Fetches current prices and saves them as snapshots
    // --------------------------------------------------------
    if (action === 'backfill') {
      const { interval } = body as { interval: string };

      // Map interval labels to minimum age in ms
      const intervalAges: Record<string, number> = {
        '1h': 60 * 60 * 1000,
        '4h': 4 * 60 * 60 * 1000,
        '1d': 24 * 60 * 60 * 1000,
        '3d': 3 * 24 * 60 * 60 * 1000,
        '7d': 7 * 24 * 60 * 60 * 1000,
        '14d': 14 * 24 * 60 * 60 * 1000,
        '30d': 30 * 24 * 60 * 60 * 1000,
      };

      const minAge = intervalAges[interval];
      if (!minAge) {
        return NextResponse.json(
          { error: `Invalid interval. Valid: ${Object.keys(intervalAges).join(', ')}` },
          { status: 400 },
        );
      }

      const detections = getDetectionsNeedingSnapshots(interval, minAge);
      if (detections.length === 0) {
        return NextResponse.json({ message: 'No detections need snapshots for this interval', filled: 0 });
      }

      // Fetch current prices for all coins
      const mids = await fetchAllMids();
      let filled = 0;

      for (const det of detections) {
        const coin = det.coin as string;
        const midStr = mids[coin];
        if (midStr !== undefined) {
          const price = parseFloat(midStr);
          if (!isNaN(price)) {
            savePriceSnapshot(
              det.id as number,
              interval,
              price,
              det.price_at_detection as number,
            );
            filled++;
          }
        }
      }

      return NextResponse.json({ filled, total: detections.length });
    }

    return NextResponse.json({ error: `Unknown action: ${action}` }, { status: 400 });
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Unknown error';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
