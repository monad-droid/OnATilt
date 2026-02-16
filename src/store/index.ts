import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import type {
  TradingSetup,
  AnalysisResult,
  SetupValidation,
  Timeframe,
} from '@/types';
import type { HLConfig } from '@/lib/hyperliquid';

// ============================================================
// App Store
// ============================================================

interface AppState {
  // Connection
  config: HLConfig | null;
  connected: boolean;
  setConfig: (config: HLConfig) => void;
  disconnect: () => void;

  // Setups
  setups: TradingSetup[];
  addSetup: (setup: TradingSetup) => void;
  updateSetup: (id: string, updates: Partial<TradingSetup>) => void;
  removeSetup: (id: string) => void;
  toggleSetup: (id: string) => void;

  // Active analysis
  selectedCoin: string;
  selectedTimeframe: Timeframe;
  analysis: AnalysisResult | null;
  setSelectedCoin: (coin: string) => void;
  setSelectedTimeframe: (tf: Timeframe) => void;
  setAnalysis: (analysis: AnalysisResult | null) => void;

  // Validation state
  lastValidation: SetupValidation | null;
  setLastValidation: (v: SetupValidation | null) => void;

  // Available coins
  availableCoins: string[];
  setAvailableCoins: (coins: string[]) => void;

  // Account
  accountState: Record<string, unknown> | null;
  setAccountState: (state: Record<string, unknown> | null) => void;
}

export const useAppStore = create<AppState>()(
  persist(
    (set) => ({
      // Connection
      config: null,
      connected: false,
      setConfig: (config) => set({ config, connected: true }),
      disconnect: () => set({ config: null, connected: false, accountState: null }),

      // Setups
      setups: [],
      addSetup: (setup) => set((state) => ({ setups: [...state.setups, setup] })),
      updateSetup: (id, updates) =>
        set((state) => ({
          setups: state.setups.map((s) =>
            s.id === id ? { ...s, ...updates, updatedAt: Date.now() } : s
          ),
        })),
      removeSetup: (id) =>
        set((state) => ({ setups: state.setups.filter((s) => s.id !== id) })),
      toggleSetup: (id) =>
        set((state) => ({
          setups: state.setups.map((s) =>
            s.id === id ? { ...s, enabled: !s.enabled, updatedAt: Date.now() } : s
          ),
        })),

      // Active analysis
      selectedCoin: 'BTC',
      selectedTimeframe: '4h',
      analysis: null,
      setSelectedCoin: (coin) => set({ selectedCoin: coin, analysis: null }),
      setSelectedTimeframe: (tf) => set({ selectedTimeframe: tf, analysis: null }),
      setAnalysis: (analysis) => set({ analysis }),

      // Validation
      lastValidation: null,
      setLastValidation: (v) => set({ lastValidation: v }),

      // Available coins
      availableCoins: [],
      setAvailableCoins: (coins) => set({ availableCoins: coins }),

      // Account
      accountState: null,
      setAccountState: (accountState) => set({ accountState }),
    }),
    {
      name: 'onatilt-storage',
      partialize: (state) => ({
        setups: state.setups,
        config: state.config ? { ...state.config, privateKey: '' } : null,
        selectedCoin: state.selectedCoin,
        selectedTimeframe: state.selectedTimeframe,
      }),
    }
  )
);
