import { useSyncExternalStore } from 'react';

const subscribe = () => () => {};

/** `true` once React has hydrated this component in the browser (`false` in server HTML). */
export function useHydrated(): boolean {
  return useSyncExternalStore(
    subscribe,
    () => true,
    () => false,
  );
}
