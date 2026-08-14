import { create } from "zustand";
import { persist } from "zustand/middleware";

/**
 * Self-serve "Trade Mode" toggle — no login required. When on, every price
 * shown while browsing reflects TRADE_DISCOUNT_PERCENT off (see lib/trade.ts),
 * and checkout applies the same reduction to the real charge. Persisted so it
 * survives page loads until the shopper explicitly switches it off again.
 */
interface TradeModeStore {
  isTradeMode: boolean;
  enable: () => void;
  disable: () => void;
  toggle: () => void;
}

export const useTradeModeStore = create<TradeModeStore>()(
  persist(
    (set) => ({
      isTradeMode: false,
      enable: () => set({ isTradeMode: true }),
      disable: () => set({ isTradeMode: false }),
      toggle: () => set((s) => ({ isTradeMode: !s.isTradeMode })),
    }),
    {
      name: "trade-mode-storage",
    },
  ),
);
