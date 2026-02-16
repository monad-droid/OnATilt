// ============================================================
// Core Types for OnATilt - Crypto Setup Validator
// ============================================================

// --- Candle / OHLCV Data ---

export interface Candle {
  time: number;       // Unix timestamp in ms
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
}

export type Timeframe = '1m' | '3m' | '5m' | '15m' | '30m' | '1h' | '2h' | '4h' | '8h' | '12h' | '1d' | '3d' | '1w';

// --- Swing Points ---

export type SwingType = 'high' | 'low';

export interface SwingPoint {
  type: SwingType;
  price: number;
  time: number;
  index: number;         // index in the candle array
  broken: boolean;       // has this swing been broken?
  brokenAt?: number;     // index where it was broken
}

// --- Market Structure ---

export type StructureType =
  | 'HH'    // Higher High
  | 'HL'    // Higher Low
  | 'LH'    // Lower High
  | 'LL'    // Lower Low
  | 'EH'    // Equal High
  | 'EL';   // Equal Low

export type StructureBreak =
  | 'BOS'   // Break of Structure (trend continuation)
  | 'CHoCH' // Change of Character (trend reversal)
  | 'none';

export type Trend = 'bullish' | 'bearish' | 'ranging';

export interface StructurePoint {
  swing: SwingPoint;
  label: StructureType;
  breakType: StructureBreak;
}

export interface MarketStructure {
  trend: Trend;
  swings: SwingPoint[];
  structurePoints: StructurePoint[];
  lastBOS?: StructurePoint;
  lastCHoCH?: StructurePoint;
}

// --- Swing Failure Pattern (SFP) ---

export interface SFP {
  type: 'bullish' | 'bearish';  // bullish SFP = sweep low then close above, bearish = sweep high then close below
  sweptSwing: SwingPoint;       // the swing that was swept
  sweepCandle: Candle;          // the candle that swept it
  sweepCandleIndex: number;
  wickDepth: number;            // how far past the swing the wick went
}

// --- Ranges ---

export interface Range {
  high: number;
  low: number;
  highTime: number;
  lowTime: number;
  highIndex: number;
  lowIndex: number;
  equilibrium: number;          // midpoint
  premium: number;              // 75% of range (premium zone)
  discount: number;             // 25% of range (discount zone)
  broken: boolean;
  brokenDirection?: 'above' | 'below';
}

// --- Order Blocks ---

export interface OrderBlock {
  type: 'bullish' | 'bearish';
  high: number;
  low: number;
  time: number;
  index: number;
  mitigated: boolean;
  mitigatedAt?: number;
}

// --- Fair Value Gaps ---

export interface FairValueGap {
  type: 'bullish' | 'bearish';
  high: number;               // top of gap
  low: number;                // bottom of gap
  time: number;
  index: number;
  filled: boolean;
  fillPercent: number;
}

// --- Analysis Result ---

export interface AnalysisResult {
  coin: string;
  timeframe: Timeframe;
  timestamp: number;
  marketStructure: MarketStructure;
  sfps: SFP[];
  ranges: Range[];
  orderBlocks: OrderBlock[];
  fvgs: FairValueGap[];
  currentPrice: number;
  priceRelativeToRange?: {
    inRange: boolean;
    zone: 'premium' | 'equilibrium' | 'discount' | 'above' | 'below';
    percentInRange: number;
  };
}

// --- Setup Conditions ---

export type ConditionOperator = 'is' | 'is_not' | 'above' | 'below' | 'at' | 'near' | 'swept';

export type ConditionTarget =
  | 'trend'
  | 'last_structure_break'
  | 'price_zone'
  | 'sfp_present'
  | 'at_range_high'
  | 'at_range_low'
  | 'at_order_block'
  | 'fvg_present'
  | 'near_swing_high'
  | 'near_swing_low';

export interface SetupCondition {
  id: string;
  target: ConditionTarget;
  operator: ConditionOperator;
  value: string;
  timeframe: Timeframe;
  description: string;
}

export type SetupDirection = 'long' | 'short' | 'both';

export interface TradingSetup {
  id: string;
  name: string;
  direction: SetupDirection;
  conditions: SetupCondition[];
  requireAll: boolean;           // AND vs OR for conditions
  coins: string[];               // which coins this setup applies to, empty = all
  enabled: boolean;
  createdAt: number;
  updatedAt: number;
}

export interface SetupValidation {
  setup: TradingSetup;
  valid: boolean;
  conditionResults: {
    condition: SetupCondition;
    met: boolean;
    reason: string;
  }[];
  analysis: AnalysisResult;
}

// --- Trade Types ---

export type OrderSide = 'buy' | 'sell';
export type OrderType = 'market' | 'limit';
export type TIF = 'Gtc' | 'Ioc' | 'Alo';

export interface TradeRequest {
  coin: string;
  side: OrderSide;
  size: number;
  price?: number;               // required for limit orders
  orderType: OrderType;
  reduceOnly: boolean;
  tif: TIF;
  leverage?: number;
}

export interface TradeResult {
  success: boolean;
  orderId?: string;
  error?: string;
  setupValidation?: SetupValidation;
  blocked?: boolean;
  blockReason?: string;
}

