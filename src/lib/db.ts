import Database from 'better-sqlite3';
import path from 'path';
import fs from 'fs';

// Store the DB file in data/ at project root
const DATA_DIR = path.join(process.cwd(), 'data');
const DB_PATH = path.join(DATA_DIR, 'sfp-history.db');

let _db: Database.Database | null = null;

function getDb(): Database.Database {
  if (_db) return _db;

  // Ensure data directory exists
  if (!fs.existsSync(DATA_DIR)) {
    fs.mkdirSync(DATA_DIR, { recursive: true });
  }

  _db = new Database(DB_PATH);
  _db.pragma('journal_mode = WAL'); // Better concurrent read performance
  _db.pragma('foreign_keys = ON');

  initSchema(_db);
  return _db;
}

function initSchema(db: Database.Database) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS sfp_detections (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      coin TEXT NOT NULL,
      timeframe TEXT NOT NULL,
      sfp_type TEXT NOT NULL,               -- 'bullish' or 'bearish'
      swept_swing_price REAL NOT NULL,      -- the swing level that was swept
      swept_swing_type TEXT NOT NULL,        -- 'high' or 'low'
      swept_swing_time INTEGER NOT NULL,    -- when the swing formed (ms)
      sweep_candle_time INTEGER NOT NULL,   -- when the sweep happened (ms)
      sweep_candle_open REAL NOT NULL,
      sweep_candle_high REAL NOT NULL,
      sweep_candle_low REAL NOT NULL,
      sweep_candle_close REAL NOT NULL,
      sweep_candle_volume REAL NOT NULL,
      wick_depth REAL NOT NULL,             -- how far past swing the wick went
      wick_pct REAL NOT NULL,               -- wick depth as % of swing price
      price_at_detection REAL NOT NULL,     -- market price when scanner ran
      trend_at_detection TEXT NOT NULL,     -- 'bullish', 'bearish', or 'ranging'
      detected_at INTEGER NOT NULL,         -- when our scanner found it (ms)
      UNIQUE(coin, timeframe, sfp_type, sweep_candle_time)
    );

    CREATE TABLE IF NOT EXISTS price_snapshots (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      detection_id INTEGER NOT NULL REFERENCES sfp_detections(id) ON DELETE CASCADE,
      interval_label TEXT NOT NULL,          -- e.g. '1h', '4h', '1d', '7d'
      price REAL NOT NULL,
      captured_at INTEGER NOT NULL,          -- when this snapshot was taken (ms)
      price_change_pct REAL NOT NULL,        -- % change from price_at_detection
      UNIQUE(detection_id, interval_label)
    );

    CREATE INDEX IF NOT EXISTS idx_detections_coin ON sfp_detections(coin);
    CREATE INDEX IF NOT EXISTS idx_detections_type ON sfp_detections(sfp_type);
    CREATE INDEX IF NOT EXISTS idx_detections_timeframe ON sfp_detections(timeframe);
    CREATE INDEX IF NOT EXISTS idx_detections_detected_at ON sfp_detections(detected_at);
    CREATE INDEX IF NOT EXISTS idx_snapshots_detection ON price_snapshots(detection_id);
  `);
}

// ============================================================
// Write helpers
// ============================================================

export interface SFPDetectionRow {
  coin: string;
  timeframe: string;
  sfp_type: string;
  swept_swing_price: number;
  swept_swing_type: string;
  swept_swing_time: number;
  sweep_candle_time: number;
  sweep_candle_open: number;
  sweep_candle_high: number;
  sweep_candle_low: number;
  sweep_candle_close: number;
  sweep_candle_volume: number;
  wick_depth: number;
  wick_pct: number;
  price_at_detection: number;
  trend_at_detection: string;
  detected_at: number;
}

const insertDetectionSQL = `
  INSERT OR IGNORE INTO sfp_detections (
    coin, timeframe, sfp_type,
    swept_swing_price, swept_swing_type, swept_swing_time,
    sweep_candle_time, sweep_candle_open, sweep_candle_high,
    sweep_candle_low, sweep_candle_close, sweep_candle_volume,
    wick_depth, wick_pct,
    price_at_detection, trend_at_detection, detected_at
  ) VALUES (
    @coin, @timeframe, @sfp_type,
    @swept_swing_price, @swept_swing_type, @swept_swing_time,
    @sweep_candle_time, @sweep_candle_open, @sweep_candle_high,
    @sweep_candle_low, @sweep_candle_close, @sweep_candle_volume,
    @wick_depth, @wick_pct,
    @price_at_detection, @trend_at_detection, @detected_at
  )
`;

export function saveDetections(rows: SFPDetectionRow[]): number {
  const db = getDb();
  const insert = db.prepare(insertDetectionSQL);

  const insertMany = db.transaction((items: SFPDetectionRow[]) => {
    let inserted = 0;
    for (const row of items) {
      const result = insert.run(row);
      if (result.changes > 0) inserted++;
    }
    return inserted;
  });

  return insertMany(rows);
}

export function savePriceSnapshot(
  detectionId: number,
  intervalLabel: string,
  price: number,
  priceAtDetection: number,
): void {
  const db = getDb();
  const changePercent = ((price - priceAtDetection) / priceAtDetection) * 100;

  db.prepare(`
    INSERT OR REPLACE INTO price_snapshots (detection_id, interval_label, price, captured_at, price_change_pct)
    VALUES (?, ?, ?, ?, ?)
  `).run(detectionId, intervalLabel, price, Date.now(), changePercent);
}

// ============================================================
// Read helpers
// ============================================================

export interface DetectionQuery {
  coin?: string;
  sfp_type?: string;
  timeframe?: string;
  trend?: string;
  from?: number;      // detected_at >= from (ms)
  to?: number;        // detected_at <= to (ms)
  limit?: number;
  offset?: number;
}

export function queryDetections(query: DetectionQuery = {}) {
  const db = getDb();
  const conditions: string[] = [];
  const params: Record<string, string | number> = {};

  if (query.coin) {
    conditions.push('d.coin = @coin');
    params.coin = query.coin;
  }
  if (query.sfp_type) {
    conditions.push('d.sfp_type = @sfp_type');
    params.sfp_type = query.sfp_type;
  }
  if (query.timeframe) {
    conditions.push('d.timeframe = @timeframe');
    params.timeframe = query.timeframe;
  }
  if (query.trend) {
    conditions.push('d.trend_at_detection = @trend');
    params.trend = query.trend;
  }
  if (query.from) {
    conditions.push('d.detected_at >= @from');
    params.from = query.from;
  }
  if (query.to) {
    conditions.push('d.detected_at <= @to');
    params.to = query.to;
  }

  const where = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';
  const limit = query.limit ?? 500;
  const offset = query.offset ?? 0;

  const rows = db.prepare(`
    SELECT d.*,
      (SELECT json_group_array(json_object(
        'interval_label', p.interval_label,
        'price', p.price,
        'captured_at', p.captured_at,
        'price_change_pct', p.price_change_pct
      )) FROM price_snapshots p WHERE p.detection_id = d.id) as snapshots
    FROM sfp_detections d
    ${where}
    ORDER BY d.detected_at DESC
    LIMIT @limit OFFSET @offset
  `).all({ ...params, limit, offset });

  return rows.map((r) => {
    const row = r as Record<string, unknown>;
    return {
      ...row,
      snapshots: row.snapshots ? JSON.parse(row.snapshots as string).filter((s: Record<string, unknown>) => s.interval_label !== null) : [],
    };
  });
}

export function getDetectionStats(query: DetectionQuery = {}) {
  const db = getDb();
  const conditions: string[] = [];
  const params: Record<string, string | number> = {};

  if (query.coin) { conditions.push('coin = @coin'); params.coin = query.coin; }
  if (query.sfp_type) { conditions.push('sfp_type = @sfp_type'); params.sfp_type = query.sfp_type; }
  if (query.timeframe) { conditions.push('timeframe = @timeframe'); params.timeframe = query.timeframe; }
  if (query.from) { conditions.push('detected_at >= @from'); params.from = query.from; }
  if (query.to) { conditions.push('detected_at <= @to'); params.to = query.to; }

  const where = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';

  return db.prepare(`
    SELECT
      COUNT(*) as total,
      SUM(CASE WHEN sfp_type = 'bullish' THEN 1 ELSE 0 END) as bullish,
      SUM(CASE WHEN sfp_type = 'bearish' THEN 1 ELSE 0 END) as bearish,
      COUNT(DISTINCT coin) as unique_coins,
      MIN(detected_at) as earliest,
      MAX(detected_at) as latest
    FROM sfp_detections
    ${where}
  `).get(params);
}

export function getDetectionsNeedingSnapshots(intervalLabel: string, minAgeMs: number) {
  const db = getDb();
  const cutoff = Date.now() - minAgeMs;

  return db.prepare(`
    SELECT d.* FROM sfp_detections d
    WHERE d.detected_at <= ?
      AND NOT EXISTS (
        SELECT 1 FROM price_snapshots p
        WHERE p.detection_id = d.id AND p.interval_label = ?
      )
    ORDER BY d.detected_at DESC
  `).all(cutoff, intervalLabel) as Record<string, unknown>[];
}

export function exportDetectionsCSV(query: DetectionQuery = {}): string {
  const rows = queryDetections(query);
  if (rows.length === 0) return '';

  const headers = [
    'id', 'coin', 'timeframe', 'sfp_type',
    'swept_swing_price', 'swept_swing_type', 'swept_swing_time',
    'sweep_candle_time', 'sweep_candle_open', 'sweep_candle_high',
    'sweep_candle_low', 'sweep_candle_close', 'sweep_candle_volume',
    'wick_depth', 'wick_pct',
    'price_at_detection', 'trend_at_detection', 'detected_at',
  ];

  const csvRows = [headers.join(',')];
  for (const row of rows) {
    const r = row as Record<string, unknown>;
    csvRows.push(headers.map(h => r[h]).join(','));
  }
  return csvRows.join('\n');
}
