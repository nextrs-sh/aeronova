import type { Airport } from '@aeronova/contracts';
import { useEffect, useSyncExternalStore } from 'react';
import { fetchAirports } from './airports-api';

export type AirportsStatus = 'loading' | 'ready' | 'error';

interface AirportsSnapshot {
  status: AirportsStatus;
  airports: Airport[];
}

/*
 * The airport catalogue is small and shared by every search widget on a page,
 * so it is fetched once per session and kept in a tiny module-level store.
 */
const SERVER_SNAPSHOT: AirportsSnapshot = { status: 'loading', airports: [] };
let snapshot: AirportsSnapshot = SERVER_SNAPSHOT;
let inflight: Promise<void> | null = null;
const listeners = new Set<() => void>();

function publish(next: AirportsSnapshot) {
  snapshot = next;
  for (const listener of listeners) listener();
}

function subscribe(listener: () => void) {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

function loadAirports() {
  if (inflight || snapshot.status === 'ready') return;
  if (snapshot.status !== 'loading') publish(SERVER_SNAPSHOT);
  inflight = fetchAirports()
    .then(
      (airports) => publish({ status: 'ready', airports }),
      () => publish({ status: 'error', airports: [] }),
    )
    .finally(() => {
      inflight = null;
    });
}

export function useAirports() {
  const state = useSyncExternalStore(
    subscribe,
    () => snapshot,
    () => SERVER_SNAPSHOT,
  );
  useEffect(loadAirports, []);
  return { ...state, retry: loadAirports };
}
