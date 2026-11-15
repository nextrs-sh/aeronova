import {
  compareIsoDates,
  flightSearchDraftSchema,
  isIsoDate,
  type FlightSearchDraft,
} from '@aeronova/contracts';
import { create } from 'zustand';
import { createJSONStorage, persist } from 'zustand/middleware';

interface SearchDraftState {
  /** The traveller's most recent search inputs, kept while they browse. */
  draft: FlightSearchDraft | null;
  setDraft: (draft: FlightSearchDraft) => void;
}

/**
 * Shared search selections. Persisted to sessionStorage so choices survive
 * navigation and reloads within a tab, but not across visits.
 * Hydration is manual (`persist.rehydrate()`) so server and first client
 * render always match.
 */
export const useSearchDraftStore = create<SearchDraftState>()(
  persist(
    (set) => ({
      draft: null,
      setDraft: (draft) => set({ draft }),
    }),
    {
      name: 'aeronova:search-draft',
      version: 1,
      storage: createJSONStorage(() => sessionStorage),
      skipHydration: true,
      partialize: (state) => ({ draft: state.draft }),
    },
  ),
);

/**
 * Prepare a saved draft for reuse: discard anything malformed, drop dates that
 * are now in the past, and apply a destination preset when one is given.
 */
export function restoreDraft(
  saved: unknown,
  today: string,
  presetDestination?: string,
): FlightSearchDraft | null {
  const parsed = flightSearchDraftSchema.safeParse(saved);
  if (!parsed.success) return null;
  const draft = { ...parsed.data, passengers: { ...parsed.data.passengers } };

  const isPast = (date: string) => !isIsoDate(date) || compareIsoDates(date, today) < 0;
  if (draft.departDate && isPast(draft.departDate)) {
    draft.departDate = '';
    draft.returnDate = '';
  }
  if (draft.returnDate && isPast(draft.returnDate)) draft.returnDate = '';

  if (presetDestination) {
    draft.destination = presetDestination;
    if (draft.origin === presetDestination) draft.origin = '';
  }
  return draft;
}
