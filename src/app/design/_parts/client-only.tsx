'use client';
/* Design gallery: fixtures use the live clock, so skip server rendering to avoid hydration mismatches. */
import { useSyncExternalStore, type ReactNode } from 'react';
const subscribe = () => () => {};
export function ClientOnly({ children }: { children: ReactNode }) {
  return useSyncExternalStore(subscribe, () => true, () => false) ? children : null;
}
