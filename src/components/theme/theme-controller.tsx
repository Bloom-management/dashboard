'use client';
import { useEffect } from 'react';
import { APPEARANCE_EVENT, APPEARANCE_KEY, readAppearance, resolveAppearance, type Appearance } from './appearance';
import { applyDarkTheme } from './dark-theme';

/** Applies the appearance preference to this document and keeps it in sync (device changes, other tabs and frames). */
export function ThemeController() {
  useEffect(() => {
    const root = document.documentElement;
    const apply = (value: Appearance = readAppearance()) => {
      const theme = resolveAppearance(value);
      applyDarkTheme(document, theme);
      root.style.colorScheme = theme;
      root.style.background = theme === 'dark' ? '#141012' : '';
    };
    apply();
    const media = window.matchMedia('(prefers-color-scheme: dark)');
    const onMedia = () => { if (readAppearance() === 'auto') apply('auto'); };
    const onChoice = (event: Event) => apply((event as CustomEvent<Appearance>).detail);
    const onStorage = (event: StorageEvent) => { if (event.key === APPEARANCE_KEY) apply(); };
    media.addEventListener('change', onMedia);
    window.addEventListener(APPEARANCE_EVENT, onChoice);
    window.addEventListener('storage', onStorage);
    return () => { media.removeEventListener('change', onMedia); window.removeEventListener(APPEARANCE_EVENT, onChoice); window.removeEventListener('storage', onStorage); };
  }, []);
  return null;
}
