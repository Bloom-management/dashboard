/** Appearance preference: Light, Dark or Auto (follows the device). Stored per browser and synced across tabs and frames. */
export type Appearance = 'light' | 'dark' | 'auto';
export const APPEARANCE_KEY = 'bloom-appearance';
export const APPEARANCE_EVENT = 'bloom:appearance';

export function readAppearance(): Appearance {
  try {
    const value = window.localStorage.getItem(APPEARANCE_KEY);
    return value === 'light' || value === 'dark' ? value : 'auto';
  } catch { return 'auto'; }
}

export function prefersDark() {
  return typeof window !== 'undefined' && window.matchMedia('(prefers-color-scheme: dark)').matches;
}

export function resolveAppearance(value: Appearance): 'light' | 'dark' {
  return value === 'auto' ? (prefersDark() ? 'dark' : 'light') : value;
}

export function setAppearance(value: Appearance) {
  try { window.localStorage.setItem(APPEARANCE_KEY, value); } catch { /* storage blocked: applies to this page only */ }
  window.dispatchEvent(new CustomEvent<Appearance>(APPEARANCE_EVENT, { detail: value }));
}

/** Inline <head> script: applies the stored theme before first paint, using the dark CSS cached from the last visit. */
export const themeBootScript = `(function(){try{
var v=localStorage.getItem('${APPEARANCE_KEY}');
var dark=v==='dark'||(v!=='light'&&matchMedia('(prefers-color-scheme: dark)').matches);
if(!dark)return;
var d=document.documentElement;d.setAttribute('data-theme','dark');d.style.colorScheme='dark';d.style.background='#141012';
var css=localStorage.getItem('bloom-dark-css');
if(css){var s=document.createElement('style');s.id='bloom-dark-theme';s.textContent=css;document.head.appendChild(s);}
}catch(e){}})();`;
