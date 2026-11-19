/* Bloom dark theme ("plum night"), generated at runtime from the light stylesheets.
 * Reads every same-origin stylesheet in a document and emits overrides scoped to
 * :root[data-theme="dark"], so hardcoded colours, CSS modules, hover states and Clerk's
 * injected styles all follow. Hand-tuned decisions live in build(). Components that
 * define their own dark values (selectors mentioning data-theme, or --theme-* tokens) are
 * left untouched. The generated CSS is cached so the next load paints dark immediately. */

export type ResolvedTheme = 'light' | 'dark';
export const THEME_ATTR = 'data-theme';
export const DARK_STYLE_ID = 'bloom-dark-theme';
export const DARK_CSS_CACHE = 'bloom-dark-css';
const ATTR = THEME_ATTR;
const STYLE_ID = DARK_STYLE_ID;
const ROOT = `:root[${ATTR}="dark"]`;

/** Existing Bloom tokens mapped onto the proposed dark palette. */
const tokens: Record<string, string> = {
  '--cream': '#141012', '--cream-2': '#262024', '--card': '#1D181B',
  '--ink': '#F6EFF1', '--ink-2': '#C2B6BB', '--muted': '#968A90', '--muted-2': '#6E6268',
  '--olive': '#C2B6BB', '--sand': '#4A4045',
  '--bloom': '#F29BB7', '--bloom-soft': '#3A2230', '--bloom-deep': '#F5A3BD',
  '--line': '#352D31', '--line-2': '#4A4045', '--gray-fill': '#2C2529', '--gray-stack': '#3A3136',
  '--shadow-sm': '0 0 #0000', '--shadow-md': '0 0 0 1px #352D31', '--shadow-lg': '0 0 0 1px #4A4045, 0 24px 60px rgba(0,0,0,.5)',
};

type Kind = 'bg' | 'text' | 'border' | 'shadow';
type RGBA = { r: number; g: number; b: number; a: number };
const families = {
  rose: { deep: '#B4506F', tint: '#3A2230', ink: '#F5A3BD', line: '#6B3A50', solid: '#F29BB7' },
  orange: { deep: '#A8531C', tint: '#3D2416', ink: '#F7A877', line: '#F08A45', solid: '#F08A45' },
  yellow: { deep: '#7F6200', tint: '#3A2F12', ink: '#F2CF6A', line: '#E0B020', solid: '#E0B020' },
  green: { deep: '#3D7A4E', tint: '#1E3324', ink: '#8FD19E', line: '#5DA571', solid: '#5DA571' },
  blue: { deep: '#3F6AA8', tint: '#1C2638', ink: '#9CC2F5', line: '#4F78B0', solid: '#6E9BD8' },
  violet: { deep: '#6E55A8', tint: '#2C2238', ink: '#C9B2F2', line: '#6C5A96', solid: '#A88FE0' },
};

let context: CanvasRenderingContext2D | null = null;
const parseCache = new Map<string, RGBA | null>();
function parse(value: string): RGBA | null {
  if (parseCache.has(value)) return parseCache.get(value)!;
  context ??= document.createElement('canvas').getContext('2d');
  let result: RGBA | null = null;
  if (context) {
    context.fillStyle = '#010203';
    context.fillStyle = value;
    const out = String(context.fillStyle);
    if (out !== '#010203' || value.replace(/\s/g, '') === '#010203') {
      const hex = out.match(/^#([0-9a-f]{6})$/i);
      const rgba = out.match(/^rgba?\(([^)]+)\)$/);
      if (hex) result = { r: parseInt(hex[1].slice(0, 2), 16), g: parseInt(hex[1].slice(2, 4), 16), b: parseInt(hex[1].slice(4, 6), 16), a: 1 };
      else if (rgba) { const [r, g, b, a = '1'] = rgba[1].split(',').map(part => part.trim()); result = { r: +r, g: +g, b: +b, a: +a }; }
    }
  }
  parseCache.set(value, result);
  return result;
}
const lum = ({ r, g, b }: RGBA) => { const c = (v: number) => { v /= 255; return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4; }; return 0.2126 * c(r) + 0.7152 * c(g) + 0.0722 * c(b); };
function hsl({ r, g, b }: RGBA) {
  r /= 255; g /= 255; b /= 255;
  const max = Math.max(r, g, b), min = Math.min(r, g, b), l = (max + min) / 2, d = max - min;
  if (!d) return { h: 0, s: 0, l };
  const s = d / (1 - Math.abs(2 * l - 1));
  const h = max === r ? ((g - b) / d + 6) % 6 : max === g ? (b - r) / d + 2 : (r - g) / d + 4;
  return { h: h * 60, s, l };
}
function family(h: number) {
  return h < 18 || h >= 320 ? families.rose : h < 40 ? families.orange : h < 70 ? families.yellow : h < 170 ? families.green : h < 255 ? families.blue : families.violet;
}
const withAlpha = (hex: string, a: number) => a >= 1 ? hex : `rgba(${parseInt(hex.slice(1, 3), 16)},${parseInt(hex.slice(3, 5), 16)},${parseInt(hex.slice(5, 7), 16)},${+a.toFixed(3)})`;

/** Dark outline on buttons in light mode becomes the pink button outline in dark. */
const BUTTON_OUTLINE = '#B4506F', BUTTON_OUTLINE_HOVER = '#F29BB7';
function mapColor(c: RGBA, kind: Kind, button = false): string {
  if (c.a === 0) return 'transparent';
  const L = lum(c), { h, s } = hsl(c);
  if (kind === 'shadow') return `rgba(0,0,0,${Math.min(0.6, c.a * 2).toFixed(3)})`;
  const chroma = (Math.max(c.r, c.g, c.b) - Math.min(c.r, c.g, c.b)) / 255;
  // Bloom's neutrals are warm beiges (cream, sand, olive): only strongly saturated yellows/oranges in that band count as colour.
  const beige = h >= 30 && h < 65;
  // Strong chroma counts as colour even when HSL saturation is low (muted greens like the 'full' supply bar).
  const chromatic = L < 0.96 && (s > 0.28 || chroma >= 0.2) && chroma >= 0.04 && (!beige || (chroma >= 0.15 && s > 0.5));
  if (chromatic) {
    const f = family(h);
    if (kind === 'text') return withAlpha(f.ink, c.a);
    if (kind === 'border') return withAlpha(L > 0.6 ? f.tint : f.line, c.a);
    return withAlpha(L > 0.45 ? f.tint : f.solid, c.a);
  }
  if (c.a < 1) {
    // Translucent neutrals: dark veils become light veils, except heavy overlays (backdrops) stay dark.
    if (L < 0.4) return kind === 'bg' && c.a >= 0.3 ? `rgba(0,0,0,${Math.max(c.a, 0.55)})` : `rgba(246,239,241,${c.a})`;
    return `rgba(29,24,27,${c.a})`;
  }
  if (kind === 'text') return L < 0.04 ? '#F6EFF1' : L < 0.2 ? '#C2B6BB' : L < 0.6 ? '#968A90' : '#1D181B';
  if (kind === 'border' && button && L < 0.1) return BUTTON_OUTLINE;
  if (kind === 'border') return L >= 0.8 ? '#352D31' : L >= 0.45 ? '#4A4045' : L >= 0.1 ? '#968A90' : '#C2B6BB';
  return L >= 0.97 ? '#1D181B' : L >= 0.87 ? '#141012' : L >= 0.72 ? '#262024' : L >= 0.45 ? '#2C2529' : L >= 0.1 ? '#4A4045' : L >= 0.04 ? '#E6DCDF' : '#F6EFF1';
}

/** A solid colour fill (not a tint, neutral or translucent veil) that white text sits on. */
function solidColour(c: RGBA | null) {
  if (!c || c.a < 1) return null;
  const L = lum(c), { h, s } = hsl(c), chroma = (Math.max(c.r, c.g, c.b) - Math.min(c.r, c.g, c.b)) / 255;
  return L <= 0.5 && s > 0.28 && chroma >= 0.15 ? family(h) : null;
}

const colorToken = /#[0-9a-fA-F]{3,8}\b|(?:rgba?|hsla?|oklch|oklab|lab|lch)\([^()]*\)|(?<![-\w])(?:white|black)(?![-\w])/g;
function mapValue(value: string, kind: Kind, button = false): string {
  return value.replace(colorToken, token => { const c = parse(token); return c ? mapColor(c, kind, button) : token; });
}
function kindOf(property: string, value: string): Kind | null {
  if (property.startsWith('--')) {
    if (/shadow/.test(property)) return 'shadow';
    if (/line|border|sand|stroke/.test(property)) return 'border';
    if (/ink|muted|text|fg|olive|color/.test(property)) return 'text';
    return 'bg';
  }
  if (property === 'box-shadow') return /inset\s+0(px)?\s+0(px)?\s+0(px)?\s/.test(value) || /^\s*0(px)?\s+0(px)?\s+0(px)?\s+\d/.test(value) ? 'border' : 'shadow';
  if (property === 'text-shadow' || property === 'filter') return 'shadow';
  if (property.startsWith('background')) return 'bg';
  if (property.startsWith('border') || property.startsWith('outline') || property === 'column-rule-color') return 'border';
  if (['color', 'fill', 'stroke', 'caret-color', 'accent-color', '-webkit-text-fill-color', 'text-decoration-color'].includes(property)) return 'text';
  return null;
}

function splitSelectors(text: string) {
  const parts: string[] = []; let depth = 0, start = 0;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (ch === '(' || ch === '[') depth++;
    else if (ch === ')' || ch === ']') depth--;
    else if (ch === ',' && depth === 0) { parts.push(text.slice(start, i)); start = i + 1; }
  }
  parts.push(text.slice(start));
  return parts.map(part => part.trim()).filter(Boolean);
}
function scope(selector: string) {
  const root = selector.match(/^(:root|html)(?![-\w])/);
  if (root) return `${root[1]}[${ATTR}="dark"]${selector.slice(root[1].length)}`;
  return `${ROOT} ${selector}`;
}

/** Custom properties declared anywhere in the document, for resolving var() in fills. */
let customProperties = new Map<string, string>();
function resolveVars(value: string, depth = 0): string {
  if (depth > 4) return value;
  return value.replace(/var\(\s*(--[\w-]+)\s*(?:,\s*([^()]*))?\)/g, (_, name: string, fallback?: string) => resolveVars(customProperties.get(name) ?? fallback ?? '', depth + 1));
}
function collectCustomProperties(rules: CSSRuleList) {
  for (const rule of Array.from(rules) as (CSSRule & Partial<CSSStyleRule>)[]) {
    if (rule.style) for (let i = 0; i < rule.style.length; i++) { const name = rule.style[i]; if (name.startsWith('--')) customProperties.set(name, rule.style.getPropertyValue(name).trim()); }
    if (rule.cssRules) try { collectCustomProperties(rule.cssRules); } catch { /* unsupported */ }
  }
}
/** Layout-only longhands that never need copying. */
const layoutOnly = /^(background-(position|size|repeat|clip|origin|attachment|blend-mode)(-[xy])?|border-(.*-)?(radius|width|style)|border-(spacing|collapse)|border-image.*|outline-(offset|width|style)|filter)$/;

/** Iframe rules come from another realm, so `instanceof` fails: identify rules by constructor name. */
const ruleIs = (rule: CSSRule, name: string) => rule.constructor.name === name;
function convertRules(rules: CSSRuleList, out: string[]) {
  for (const rule of Array.from(rules) as (CSSRule & Partial<CSSStyleRule & CSSMediaRule & CSSImportRule>)[]) {
    // Rules that already carry real dark values (themed components) are left untouched.
    if (ruleIs(rule, 'CSSStyleRule') && rule.selectorText && /data-(design-)?theme/.test(rule.selectorText)) continue;
    if (ruleIs(rule, 'CSSStyleRule') && rule.style && rule.selectorText) {
      const decls: string[] = [];
      // White text on its own rule's colour fill (selected days, accent pills) stays white on a deeper fill.
      const fillValue = rule.style.getPropertyValue('background-color') || rule.style.getPropertyValue('background');
      const textValue = rule.style.getPropertyValue('color');
      const fillToken = fillValue ? resolveVars(fillValue).match(colorToken)?.[0] : undefined;
      colorToken.lastIndex = 0;
      const textColour = textValue ? parse(resolveVars(textValue).trim()) : null;
      const fillFamily = fillToken ? solidColour(parse(fillToken)) : null;
      const whiteOnColour = !!fillFamily && !!textColour && lum(textColour) > 0.85;
      const button = /button|btn|trigger/i.test(rule.selectorText);
      const seen = new Set<string>();
      for (let i = 0; i < rule.style.length; i++) {
        let property = rule.style[i];
        let value = rule.style.getPropertyValue(property);
        if (!value) {
          // Shorthands containing var() leave their longhands empty: copy the shorthand instead.
          const parts = property.split('-');
          for (let n = parts.length - 1; n > 0 && !value; n--) { const shorthand = parts.slice(0, n).join('-'); const v = rule.style.getPropertyValue(shorthand); if (v) { property = shorthand; value = v; } }
          if (!value || seen.has(property)) continue;
          // Copy only the colour of border/outline/background shorthands: copying widths or styles would
          // override the original cascade (e.g. a later `border:0` would regain a 1px border).
          if (/^(border|outline|background)/.test(property)) {
            const colour = value.match(/var\([^()]*(?:\([^()]*\))?[^()]*\)/)?.[0] ?? value.match(colorToken)?.[0];
            colorToken.lastIndex = 0;
            if (!colour) continue;
            seen.add(property);
            property = `${property}-color`;
            value = colour;
            if (seen.has(property)) continue;
          }
        }
        seen.add(property);
        const important = rule.style.getPropertyPriority(property) ? ' !important' : '';
        if (property.startsWith('--theme-')) continue; // themed component tokens define their own dark values
        if (property in tokens && property.startsWith('--')) { decls.push(`${property}:${tokens[property]}${important}`); continue; }
        const kind = kindOf(property, value);
        if (!kind || layoutOnly.test(property) || !value) continue;
        if (whiteOnColour && property === 'color') { decls.push(`color:#FFFFFF${important}`); continue; }
        if (whiteOnColour && (property === 'background-color' || property === 'background')) { decls.push(`${property}:${fillFamily!.deep}${important}`); continue; }
        // Re-emit every colour declaration, mapped or not, so the original cascade order still holds.
        decls.push(`${property}:${colorToken.test(value) ? mapValue(value, kind, button) : value}${important}`);
        colorToken.lastIndex = 0;
      }
      if (decls.length) out.push(`${splitSelectors(rule.selectorText).map(scope).join(',')}{${decls.join(';')}}`);
    } else if (ruleIs(rule, 'CSSMediaRule') && rule.cssRules) {
      const inner: string[] = []; convertRules(rule.cssRules, inner);
      if (inner.length) out.push(`@media ${rule.conditionText}{${inner.join('')}}`);
    } else if (ruleIs(rule, 'CSSSupportsRule') && rule.cssRules) {
      const inner: string[] = []; convertRules(rule.cssRules, inner);
      if (inner.length) out.push(`@supports ${rule.conditionText}{${inner.join('')}}`);
    } else if (ruleIs(rule, 'CSSImportRule') && rule.styleSheet) {
      try { convertRules(rule.styleSheet.cssRules, out); } catch { /* cross-origin */ }
    } else if (rule.cssRules && !ruleIs(rule, 'CSSKeyframesRule')) {
      try { convertRules(rule.cssRules, out); } catch { /* unsupported */ }
    }
  }
}

/** Dark neutral colours hardcoded as SVG attributes in the source, plus any found on the page at build time. */
const knownSvgDarks = ['#000', '#000000', 'black', '#020202', '#2d2a1f', '#302f26', '#4a4538'];
const LOGO = '.brand-logo,.brand-logo *,[class*="startup-module__"][class*="__flower"],[class*="startup-module__"][class*="__flower"] *';
function svgAttributeRules(doc: Document) {
  const values = new Set(knownSvgDarks);
  for (const node of Array.from(doc.querySelectorAll('svg[fill],svg [fill],svg[stroke],svg [stroke]'))) for (const name of ['fill', 'stroke']) { const v = node.getAttribute(name); if (v) values.add(v); }
  const rules: string[] = [];
  for (const value of values) {
    // Keywords follow CSS (currentColor tracks the already-mapped text colour); only literal colours are forced.
    if (!/^(#|rgb|hsl|black$)/i.test(value.trim())) continue;
    const c = parse(value);
    if (!c || c.a === 0) continue;
    const chroma = (Math.max(c.r, c.g, c.b) - Math.min(c.r, c.g, c.b)) / 255;
    if (lum(c) > 0.2 || chroma > 0.15) continue;
    for (const name of ['fill', 'stroke']) {
      const attr = `[${name}="${value.replace(/"/g, '')}" i]`;
      rules.push(`${ROOT} :is(svg${attr},svg ${attr}):not(${LOGO},[data-theme="light"] *){${name}:#F6EFF1}`);
    }
  }
  return rules.join('\n');
}

function build(doc: Document) {
  const out: string[] = [`${ROOT}{color-scheme:dark;background:#141012;color:#F6EFF1}${ROOT} body{background:#141012}`];
  customProperties = new Map();
  for (const sheet of Array.from(doc.styleSheets)) {
    if ((sheet.ownerNode as Element | null)?.id === STYLE_ID) continue;
    try { collectCustomProperties(sheet.cssRules); } catch { /* cross-origin sheet */ }
  }
  for (const sheet of Array.from(doc.styleSheets)) {
    if ((sheet.ownerNode as Element | null)?.id === STYLE_ID) continue;
    try { convertRules(sheet.cssRules, out); } catch { /* cross-origin sheet (e.g. a CDN) */ }
  }
  // Hand-tuned dark decisions: carry these into the real dark theme.
  out.push([
    // Secondary and outline buttons pick up a pink outline on hover.
    `${ROOT} :is(.bloom-cleaner,.bloom-owner) .bloom-button.secondary:hover:not(:disabled){box-shadow:inset 0 0 0 1px ${BUTTON_OUTLINE_HOVER}}`,
    `${ROOT} [class*="outline-button-module__"][class*="__button"]:hover:not(:disabled),${ROOT} .bloom-cleaner .bloom-button.cleaner-city-trigger:hover{border-color:${BUTTON_OUTLINE_HOVER}}`,
    // Dropdown triggers (location picker, shared Select): a visible --neutral-line outline, not the faint card border.
    `${ROOT} .bloom-cleaner .bloom-button.cleaner-city-trigger,${ROOT} .bloom-select{border-color:#6E6268}`,
    `${ROOT} .bloom-cleaner .bloom-button.cleaner-city-trigger:hover:not(:disabled),${ROOT} .bloom-select:hover:not(:disabled){border-color:${BUTTON_OUTLINE_HOVER}}`,
    // Sign-in showcase panel is the dark brand surface in light mode: keep it a dark surface (not a flipped light card).
    `${ROOT} [class*="sign-in-module__"][class*="__story"]{background:#262024;color:#F6EFF1}`,
    `${ROOT} [class*="sign-in-module__"][class*="__story"] :is([class*="__story-copy"]>p:last-child,[class*="__product-slide"]>p:not([class*="__eyebrow"])){color:#C2B6BB}`,
    `${ROOT} [class*="sign-in-module__"][class*="__story"] [class*="__carousel-arrows"] button{background:#262024;color:#F6EFF1;border-color:#6E6268}`,
    `${ROOT} [class*="sign-in-module__"][class*="__story"] [class*="__carousel-arrows"] button:hover{border-color:${BUTTON_OUTLINE_HOVER}}`,
    `${ROOT} [class*="sign-in-module__"][class*="__story"] [class*="__product-tabs"] button:not([aria-selected="true"]){background:transparent;color:#C2B6BB;border-color:#6E6268}`,
    `${ROOT} [class*="sign-in-module__"][class*="__story"] [class*="__product-tabs"] button[aria-selected="true"]{background:#F6EFF1;color:#1D181B;border-color:#F6EFF1}`,
    // Mapbox control icons are SVG images with a baked-in #333 fill: invert them to near-white on the dark buttons.
    `${ROOT} .mapboxgl-ctrl button .mapboxgl-ctrl-icon{filter:invert(1) brightness(1.4)}`,
    // Cleanings / Bookings: white label on the deep pink indicator.
    `${ROOT} .calendar-type-toggle .bloom-selector-indicator{background:#B4506F;box-shadow:none}`,
    `${ROOT} .calendar-type-toggle.bloom-selector-pill .vt-btn.active{color:#FFFFFF}`,
    // Keep the cleaning card outline around the complete card, with the action inside it.
    `${ROOT} .bloom-cleaner .cleaner-day-jobs li{border-color:#6E6268;background:#1D181B}`,
    `${ROOT} .bloom-cleaner .cleaner-day-jobs li:is(:hover,:focus-within,.selected){border-color:#F29BB7;background:#262024}`,
    `${ROOT} .bloom-cleaner .cleaner-day-jobs li > button.cleaner-day-link{background:#1D181B;color:#F6EFF1;border-color:#6E6268}`,
    `${ROOT} .bloom-cleaner .cleaner-day-jobs li > button.cleaner-day-link:hover{border-color:#F29BB7}`,
  ].join('\n'));
  // SVG icons: dark colours written as fill/stroke attributes (not CSS) turn white. Logos keep their colours.
  out.push(svgAttributeRules(doc));
  // Shared Select chevron is a data-URI image with a dark stroke: swap in a light one.
  out.push(`${ROOT} .bloom-select:not([multiple]):not([size]){background-image:url("data:image/svg+xml,%3Csvg xmlns=%27http://www.w3.org/2000/svg%27 viewBox=%270 0 16 16%27 fill=%27none%27%3E%3Cpath d=%27m4 6 4 4 4-4%27 stroke=%27%23F6EFF1%27 stroke-width=%271.5%27 stroke-linecap=%27round%27 stroke-linejoin=%27round%27/%3E%3C/svg%3E")!important}`);
  // Fixed images and photos keep their real colours.
  out.push(`${ROOT} img,${ROOT} video,${ROOT} canvas{color-scheme:light}`);
  return out.join('\n');
}

/** Changes on every module load, so hot-reloaded preview code replaces CSS generated by older code. */
const BUILD = `${Date.now()}`;
type Watch = { build: string; observer: MutationObserver; onLoad: EventListener; timer?: number; poll?: number; signature?: string };
type WatchedDocument = Document & { __bloomDesignWatch?: Watch };
function signature(doc: Document) { return Array.from(doc.styleSheets).map(sheet => { try { return sheet.cssRules.length; } catch { return -1; } }).join(','); }
function stopWatching(doc: WatchedDocument) {
  const watch = doc.__bloomDesignWatch; if (!watch) return;
  watch.observer.disconnect(); doc.head?.removeEventListener('load', watch.onLoad, true);
  doc.defaultView?.clearTimeout(watch.timer); doc.defaultView?.clearInterval(watch.poll);
  delete doc.__bloomDesignWatch;
}
/** Apply or remove the dark preview on any same-origin document (the gallery or an iframe). */
export function applyDarkTheme(target: Document | null | undefined, theme: ResolvedTheme) {
  if (!target?.documentElement || !target.head) return;
  const doc = target as WatchedDocument, root = doc.documentElement;
  if (theme === 'light') { stopWatching(doc); root.removeAttribute(ATTR); doc.getElementById(STYLE_ID)?.remove(); return; }
  // Watchers left by an older copy of this module would keep writing old CSS: replace them.
  if (doc.__bloomDesignWatch && doc.__bloomDesignWatch.build !== BUILD) stopWatching(doc);
  const render = () => {
    let style = doc.getElementById(STYLE_ID);
    if (!style) { style = doc.createElement('style'); style.id = STYLE_ID; }
    style.textContent = build(doc);
    style.dataset.build = BUILD;
    try { if (doc === document) window.localStorage.setItem(DARK_CSS_CACHE, style.textContent ?? ''); } catch { /* storage full or blocked */ }
    doc.head.appendChild(style); // always last, so it wins equal-specificity ties
    root.setAttribute(ATTR, 'dark');
    if (doc.__bloomDesignWatch) doc.__bloomDesignWatch.signature = signature(doc);
  };
  render();
  if (doc.__bloomDesignWatch) return;
  const schedule = () => { const view = doc.defaultView; if (!view || !doc.__bloomDesignWatch) return; view.clearTimeout(doc.__bloomDesignWatch.timer); doc.__bloomDesignWatch.timer = view.setTimeout(render, 120); };
  const observer = new MutationObserver(records => {
    const own = doc.getElementById(STYLE_ID);
    if (records.every(record => record.target === own || record.target.parentNode === own || Array.from(record.addedNodes).every(node => node === own))) return;
    schedule();
  });
  doc.__bloomDesignWatch = { build: BUILD, observer, onLoad: schedule, signature: signature(doc) };
  observer.observe(doc.head, { childList: true, subtree: true, characterData: true });
  doc.head.addEventListener('load', schedule, true);
  // Clerk and other CSS-in-JS insert rules through CSSOM, which mutation observers cannot see.
  doc.__bloomDesignWatch.poll = doc.defaultView?.setInterval(() => { if (doc.__bloomDesignWatch && signature(doc) !== doc.__bloomDesignWatch.signature) render(); }, 1500);
}

/** On hot reload, regenerate the preview wherever an older build of it is active. */
if (typeof document !== 'undefined') {
  const docs = [document, ...Array.from(document.querySelectorAll('iframe')).map(frame => { try { return frame.contentDocument; } catch { return null; } })];
  for (const doc of docs) { const style = doc?.getElementById(STYLE_ID); if (doc && style && style.dataset.build !== BUILD) applyDarkTheme(doc, 'dark'); }
}
