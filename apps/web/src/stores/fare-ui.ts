import { create } from 'zustand';

interface FareUiState {
  /** Whether the full fare comparison table is open. */
  compareOpen: boolean;
  setCompareOpen: (open: boolean) => void;
}

/**
 * Presentation-only state for the fare pages. It lives outside the components so the
 * comparison stays open when moving from departing to return fares. Prices and selections
 * never live here: they come from the server-backed shopping session.
 */
export const useFareUiStore = create<FareUiState>()((set) => ({
  compareOpen: false,
  setCompareOpen: (compareOpen) => set({ compareOpen }),
}));
