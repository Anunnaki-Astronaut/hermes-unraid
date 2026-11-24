import React, { useCallback, useEffect, useMemo, useState, useSyncExternalStore } from 'react';
import { jsx, jsxs } from 'react/jsx-runtime';
import {
  Button,
  Codicon,
  ErrorState,
  GlyphSpinner,
  host,
  PALETTE_AREA,
  ROUTES_AREA,
  SIDEBAR_NAV_AREA,
  StatusDot,
} from '@hermes/plugin-sdk';

const ROUTE = '/unraid';
const SERVER_ICON = 'server';
const SETTINGS_ROUTE = '/settings?tab=plugins&plugin=unraid';
const AGENT_SETTINGS_ROUTE = '/settings?tab=plugins&agent=unraid';
// Shared by the Dashboard and Settings; the UI tests check it against plugin.yaml.
const PLUGIN_VERSION = '0.4.1';
const APPEARANCE_KEY = 'unraid.appearance';
const APPEARANCE_CHOICES = ['match', 'system', 'light', 'dark'];
const APPEARANCE_LABELS = { match: 'Match Desktop', system: 'System', light: 'Light', dark: 'Dark' };
// Keep the other Kalends glyphs; Light uses the shared FigCraft sun below.
const APPEARANCE_ICONS = {
  match: 'M3 4h18v13H3z M8 21h8 M12 17v4',
  system: 'M12 3a9 9 0 1 0 0 18V3z M12 3a9 9 0 0 1 0 18',
  dark: 'M20 15A9 9 0 0 1 9 4a9 9 0 1 0 11 11z',
};
let pluginContext = null;
let paletteStore;

const PALETTE_FIELDS = { background: 'Background', panel: 'Panels', text: 'Text', accent: 'Accent', selected: 'Selected row' };
const PRESETS = {
  Daybook: {
    light: { background: '#F8FAF7', panel: '#EEF4EF', text: '#17302A', accent: '#27674E', selected: '#D5EBDD' },
    dark: { background: '#111A19', panel: '#1A2725', text: '#F3F8F5', accent: '#A8EBC9', selected: '#304D3D' },
  },
  Dusk: {
    light: { background: '#FCF6FA', panel: '#FFFFFF', text: '#37253F', accent: '#794526', selected: '#EEDDEC' },
    dark: { background: '#1B1725', panel: '#2A2337', text: '#F5EAF7', accent: '#FFBC91', selected: '#483753' },
  },
  Coast: {
    light: { background: '#F2FAFB', panel: '#FFFFFF', text: '#163B42', accent: '#166373', selected: '#D2EAF0' },
    dark: { background: '#10252C', panel: '#193640', text: '#E5F7FA', accent: '#8AD9E6', selected: '#2C4D58' },
  },
  Marigold: {
    light: { background: '#FFF9E4', panel: '#F6E7AE', text: '#352600', accent: '#725000', selected: '#F9DF82' },
    dark: { background: '#211900', panel: '#342800', text: '#FFF0BE', accent: '#FFCD4E', selected: '#523D00' },
  },
  Cobalt: {
    light: { background: '#F1F5FF', panel: '#E1E9FF', text: '#12234D', accent: '#234AC5', selected: '#CFDDFF' },
    dark: { background: '#10182F', panel: '#1B2850', text: '#E8F0FF', accent: '#9FB4FF', selected: '#304787' },
  },
};
// Anunnaki is opt-in per mode. Exact palette matching preserves the existing
// storage schema and drops the preset-specific overrides after customization.
const ANUNNAKI = { background: '#0C1420', panel: '#64442D', text: '#E9EFF6', accent: '#F1BE77', selected: '#533829' };
const ANUNNAKI_LIGHT = { background: '#FAF8F3', panel: '#EAE2D3', text: '#1C1B1A', accent: '#704718', selected: '#E5D3B7' };
const ANUNNAKI_BY_MODE = { light: ANUNNAKI_LIGHT, dark: ANUNNAKI };
const presetsFor = (mode) => ({
  ...Object.fromEntries(Object.entries(PRESETS).map(([name, pair]) => [name, pair[mode]])),
  ...(ANUNNAKI_BY_MODE[mode] ? { Anunnaki: ANUNNAKI_BY_MODE[mode] } : {}),
});
const samePalette = (a, b) => Object.keys(PALETTE_FIELDS).every((key) => a?.[key] === b[key]);
const isAnunnaki = (palette, mode) => Boolean(ANUNNAKI_BY_MODE[mode]) && samePalette(palette, ANUNNAKI_BY_MODE[mode]);
const hexColor = (value) => typeof value === 'string' && /^[#][0-9a-f]{6}$/i.test(value) ? value.toUpperCase() : null;
const MODES = ['light', 'dark'];

function contrast(a, b) {
  const luminance = (hex) => [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255)
    .map((n) => n <= .04045 ? n / 12.92 : ((n + .055) / 1.055) ** 2.4)
    .reduce((sum, n, i) => sum + n * [.2126, .7152, .0722][i], 0);
  const x = luminance(a), y = luminance(b);
  return (Math.max(x, y) + .05) / (Math.min(x, y) + .05);
}

function inspectPalette(value) {
  const palette = {}, errors = [];
  for (const [key, label] of Object.entries(PALETTE_FIELDS)) {
    palette[key] = hexColor(value?.[key]);
    if (!palette[key]) errors.push(`${label}: enter #RRGGBB.`);
  }
  if (!errors.length) {
    for (const ink of ['text', 'accent']) {
      for (const surface of ['background', 'panel', 'selected']) {
        // Selected rows use Text for all copy; Accent only draws markers and focus rings there.
        const minimum = ink === 'accent' && surface === 'selected' ? 3 : 4.5;
        if (contrast(palette[ink], palette[surface]) < minimum) {
          errors.push(`${PALETTE_FIELDS[ink]} needs ${minimum}:1 against ${PALETTE_FIELDS[surface]}.`);
        }
      }
    }
  }
  return { palette, errors };
}

const themeProfile = () => host.state?.profile?.get() || 'default';
const subscribeThemeProfile = (listener) => host.state?.profile?.subscribe(listener) ?? (() => {});

function createPaletteStore(storage) {
  const current = new Map();
  const listeners = new Set();
  // SDK storage namespaces by plugin, not by profile. Keep separate, versioned
  // keys for each active Desktop profile and mode; never touch the old mode key.
  const keyOf = (profile, mode) => `unraid.palette.v1.${encodeURIComponent(profile)}.${mode}`;
  const read = (key) => {
    try {
      const { palette, errors } = inspectPalette(storage?.get(key));
      return errors.length ? null : palette;
    } catch (_) { return null; }
  };
  const get = (profile) => {
    if (!current.has(profile)) current.set(profile, Object.fromEntries(MODES.map((mode) => [mode, read(keyOf(profile, mode))])));
    return current.get(profile);
  };
  return {
    get,
    subscribe(listener) { listeners.add(listener); return () => listeners.delete(listener); },
    save(profile, mode, draft) {
      if (profile !== themeProfile() || !MODES.includes(mode)) return false;
      const { palette, errors } = inspectPalette(draft);
      if (errors.length || typeof storage?.set !== 'function') return false;
      try {
        const key = keyOf(profile, mode);
        storage.set(key, palette);
        if (JSON.stringify(read(key)) !== JSON.stringify(palette)) return false;
        current.set(profile, { ...get(profile), [mode]: palette });
        listeners.forEach((listener) => listener());
        return true;
      } catch (_) { return false; }
    },
  };
}

function usePalettes() {
  const profile = useSyncExternalStore(subscribeThemeProfile, themeProfile);
  const palettes = useSyncExternalStore(paletteStore.subscribe, () => paletteStore.get(profile));
  return { profile, palettes };
}

function themeStyle(palette, mode) {
  if (!palette) return undefined;
  const { background, panel, text, accent, selected } = palette;
  const divider = `color-mix(in srgb, ${text} 27%, ${background})`;
  return {
    '--ud-canvas': background, '--ud-surface': panel, '--ud-surface-2': selected,
    '--ud-chrome': panel, '--ud-topbar': panel, '--ud-featured': panel, '--ud-featured-badge': selected,
    '--ud-on-featured': text, '--ud-on-featured-2': text, '--ud-on-chrome': text, '--ud-on-chrome-muted': text, '--ud-on-chrome-faint': text,
    '--ud-text': text, '--ud-text-2': text, '--ud-text-3': text, '--ud-divider': divider, '--ud-divider-soft': divider,
    '--ud-accent': accent, '--ud-brand': accent, '--ud-focus': accent, '--ud-hover': selected,
    '--ud-badge-bg': selected, '--ud-badge-text': text, '--ud-track': selected, '--ud-track-fill': accent,
    '--ui-bg-card': panel, '--ui-bg-secondary': panel, '--ui-bg-tertiary': selected,
    '--ui-text-primary': text, '--ui-text-secondary': text, '--ui-text-tertiary': text,
    '--ui-stroke-secondary': divider, '--ui-stroke-tertiary': divider, '--ui-accent': accent,
    ...(mode === 'dark' && isAnunnaki(palette, mode) ? {
      '--ud-topbar': '#3D2D26', '--ud-chrome': '#281F1C', '--ud-divider': '#9A6B45',
      '--ud-divider-soft': '#9A6B45', '--ud-control-border': '#AD8A6D',
      '--ud-text-2': '#DCC9B6', '--ud-text-3': '#DCC9B6', '--ud-on-featured-2': '#DCC9B6',
      '--ud-on-chrome-muted': '#DCC9B6', '--ud-on-chrome-faint': '#DCC9B6',
      '--ud-good': '#91D5B1', '--ud-good-bright': '#91D5B1', '--ud-warn': '#F4D786',
      '--ud-alert': '#FFACA4', '--ud-badge-bg': '#4D3033', '--ud-badge-text': '#FFACA4',
      '--ud-featured-badge': '#244638', '--ud-track': '#362820', '--ud-track-fill': '#DFAC73',
      '--ud-memory-fill': '#8ABFE5', '--ud-memory-track': '#425A72',
      '--ui-stroke-secondary': '#9A6B45', '--ui-stroke-tertiary': '#9A6B45',
    } : {}),
    ...(mode === 'light' && isAnunnaki(palette, mode) ? {
      '--ud-topbar': '#F0E1CB', '--ud-chrome': '#F5ECDD', '--ud-divider': '#B19576',
      '--ud-divider-soft': '#B19576', '--ud-control-border': '#806244',
      '--ud-text-2': '#584738', '--ud-text-3': '#584738', '--ud-on-featured-2': '#584738',
      '--ud-on-chrome-muted': '#584738', '--ud-on-chrome-faint': '#584738',
      '--ud-good': '#24553B', '--ud-good-bright': '#24553B', '--ud-warn': '#69490C',
      '--ud-alert': '#883635', '--ud-badge-bg': '#F2DBD3', '--ud-badge-text': '#883635',
      '--ud-featured-badge': '#DCE8DC', '--ud-track': '#D7C2A6', '--ud-track-fill': '#80501D',
      '--ud-memory-fill': '#295D87', '--ud-memory-track': '#AEC0CF',
      '--ui-stroke-secondary': '#B19576', '--ui-stroke-tertiary': '#B19576',
    } : {}),
  };
}

/*
 * Harbor Dashboard candidate styling.
 *
 * Components reference only semantic roles. The default ("match") maps every
 * role to a Hermes Desktop CSS variable and adds no color of its own, so the
 * page inherits the active Desktop theme. The fixed Harbor palettes live ONLY
 * under .unraid-deck[data-appearance="light"|"dark"], scoped to this plugin's
 * root; nothing here calls setTheme/setMode.
 */
const DECK_CSS = `
.unraid-deck{
--ud-canvas:transparent;
--ud-surface:var(--ui-bg-card);
--ud-surface-2:var(--ui-bg-secondary);
--ud-chrome:var(--ui-bg-secondary);
--ud-topbar:var(--ui-bg-card);
--ud-featured:var(--ui-bg-secondary);
--ud-featured-badge:color-mix(in srgb,var(--ui-accent) 24%,transparent);
--ud-on-featured:var(--ui-text-primary);
--ud-on-featured-2:var(--ui-text-secondary);
--ud-on-chrome:var(--ui-text-primary);
--ud-on-chrome-muted:var(--ui-text-secondary);
--ud-on-chrome-faint:var(--ui-text-tertiary);
--ud-text:var(--ui-text-primary);
--ud-text-2:var(--ui-text-secondary);
--ud-text-3:var(--ui-text-tertiary);
--ud-divider:var(--ui-stroke-secondary);
--ud-divider-soft:var(--ui-stroke-tertiary);
--ud-accent:var(--ui-accent);
--ud-brand:var(--ui-accent);
--ud-good:var(--ui-success);
--ud-good-bright:var(--ui-success);
--ud-alert:var(--ui-red);
--ud-warn:var(--ui-yellow);
--ud-badge-bg:color-mix(in srgb,var(--ui-red) 22%,transparent);
--ud-badge-text:var(--ui-red);
--ud-track:color-mix(in srgb,var(--ui-text-primary) 18%,transparent);
--ud-track-fill:var(--ui-success);
--ud-hover:var(--ui-row-hover-background);
--ud-focus:var(--ui-accent);
container-type:inline-size;container-name:unraid-deck;
box-sizing:border-box;width:100%;min-height:100%;margin:0;display:flex;flex-direction:column;overflow-x:hidden;color:var(--ud-text);background:var(--ud-canvas);font-size:.875rem;line-height:1.45}
.unraid-deck[data-appearance="light"]{--ud-canvas:#f0f3f1;--ud-surface:#ffffff;--ud-surface-2:#e7eeea;--ud-chrome:#182923;--ud-topbar:#ffffff;--ud-featured:#103c30;--ud-featured-badge:#275c49;--ud-on-featured:#ffffff;--ud-on-featured-2:#c8e2d2;--ud-on-chrome:#ffffff;--ud-on-chrome-muted:#c3d2ca;--ud-on-chrome-faint:#b9d4c4;--ud-text:#142722;--ud-text-2:#52645e;--ud-text-3:#6a7973;--ud-divider:#d8e1dc;--ud-divider-soft:#e7eeea;--ud-accent:#17664c;--ud-brand:#ef873b;--ud-good:#17664c;--ud-good-bright:#6ec9a0;--ud-alert:#a3423d;--ud-warn:#a56a17;--ud-badge-bg:#583a30;--ud-badge-text:#ffbc9b;--ud-track:#578571;--ud-track-fill:#bce4c8;--ud-hover:#eef3f0;--ud-focus:#17664c}
.unraid-deck[data-appearance="dark"]{--ud-canvas:#101a16;--ud-surface:#1d2c26;--ud-surface-2:#2a3e33;--ud-chrome:#0c1712;--ud-topbar:#1d2c26;--ud-featured:#176048;--ud-featured-badge:#287454;--ud-on-featured:#ffffff;--ud-on-featured-2:#e0f0e3;--ud-on-chrome:#ffffff;--ud-on-chrome-muted:#c0d7c6;--ud-on-chrome-faint:#c1dfca;--ud-text:#f0f6f1;--ud-text-2:#bed0c4;--ud-text-3:#a9beb0;--ud-divider:#3b5146;--ud-divider-soft:#2a3e33;--ud-accent:#8dd8ab;--ud-brand:#f99a51;--ud-good:#8dd8ab;--ud-good-bright:#6ec9a0;--ud-alert:#f0a09b;--ud-warn:#f0bf70;--ud-badge-bg:#6a3d31;--ud-badge-text:#ffcfb6;--ud-track:#416d56;--ud-track-fill:#9adbb1;--ud-hover:#243832;--ud-focus:#8dd8ab}
.unraid-deck *{box-sizing:border-box}
.ud-topbar{display:flex;align-items:center;justify-content:space-between;gap:1rem;flex-wrap:wrap;padding:.85rem 1.25rem;background:var(--ud-topbar);border-bottom:1px solid var(--ud-divider)}
.ud-brand{display:flex;align-items:center;gap:.75rem;min-width:0}
.ud-logo{width:2.6rem;height:2.6rem;flex:0 0 auto;display:grid;place-items:center;border-radius:.75rem;background:var(--ud-featured);color:var(--ud-on-featured)}
.ud-brand-title{min-width:0;display:flex;align-items:baseline;flex-wrap:wrap;gap:.15rem .625rem}
.ud-app-title{min-width:0;margin:0;font-size:1.35rem;line-height:1.2;font-weight:750;letter-spacing:-.02em}
.ud-app-version{color:var(--ud-text-2);font-size:.8125rem;white-space:nowrap}
.ud-topbar-actions{display:flex;align-items:center;gap:.6rem;flex-wrap:wrap}
.ud-conn{display:inline-flex;align-items:center;gap:.4rem;font-size:.8rem;white-space:nowrap;color:var(--ud-text-2)}
.ud-tone-good{color:var(--ud-good)}.ud-tone-warn{color:var(--ud-warn)}.ud-tone-bad{color:var(--ud-alert)}.ud-tone-muted{color:var(--ud-text-3)}
.ud-appearance{display:inline-flex;flex-wrap:wrap;gap:5px;max-width:100%}
.ud-appearance-option{display:grid;place-items:center;width:2rem;height:2rem;border:1px solid var(--ud-divider);border-radius:7px;background:transparent;color:var(--ud-text);padding:0;cursor:pointer}
.ud-appearance-option:hover{background:var(--ud-hover);color:var(--ud-text)}
.ud-appearance-option[aria-pressed="true"]{background:var(--ud-surface-2);border-color:var(--ud-accent);color:var(--ud-text)}
.ud-nav{display:flex;align-items:stretch;gap:1.5rem;padding:0 1.25rem;background:var(--ud-chrome);color:var(--ud-on-chrome-muted);overflow-x:auto;scrollbar-width:thin}
.ud-tabs{display:flex;gap:.25rem}
.ud-tab{border:0;border-bottom:3px solid transparent;background:transparent;color:var(--ud-on-chrome-muted);padding:.85rem .55rem;white-space:nowrap;cursor:pointer;font:inherit;font-size:.9rem}
.ud-tab:hover{color:var(--ud-on-chrome)}
.ud-tab[aria-selected="true"]{color:var(--ud-on-chrome);font-weight:700;border-color:var(--ud-brand)}
.ud-tab-count{display:inline-block;margin-left:.4rem;padding:.05rem .42rem;border-radius:999px;background:var(--ud-badge-bg);color:var(--ud-badge-text);font-size:.68rem;font-weight:700}
.ud-nav-right{margin-left:auto;display:flex;align-items:center;color:var(--ud-on-chrome-faint);font-size:.8rem;white-space:nowrap}
.ud-body{width:100%;max-width:90rem;margin:0 auto;padding:1.25rem;display:flex;flex-direction:column;gap:1rem}
.ud-notice{padding:1rem 1.1rem;border:1px solid var(--ud-divider);border-radius:1rem;background:var(--ud-surface)}
.ud-notice strong{display:block;font-size:.95rem}
.ud-notice p{margin:.4rem 0 0;color:var(--ud-text-2);font-size:.82rem}
.ud-loading{display:flex;align-items:center;gap:.5rem;color:var(--ud-text-2);font-size:.85rem}
.ud-error{padding:1rem 1.1rem;border:1px solid var(--ud-divider);border-radius:1rem;background:var(--ud-surface)}
.ud-page{display:flex;flex-direction:column;gap:1rem}
.ud-page-head{display:flex;align-items:flex-start;justify-content:space-between;gap:1rem;flex-wrap:wrap}
.ud-page-title{margin:0;font-size:1.65rem;line-height:1.15;font-weight:750;letter-spacing:-.03em}
.ud-page-sub{margin:.3rem 0 0;color:var(--ud-text-2);font-size:.82rem}
.ud-page-label{color:var(--ud-accent);font-size:.82rem;font-weight:650;white-space:nowrap}
.ud-grid-4{display:grid;grid-template-columns:repeat(4,minmax(0,1fr));gap:1rem}
.ud-grid-3{display:grid;grid-template-columns:minmax(0,1.9fr) minmax(0,1fr) minmax(0,1fr);gap:1rem}
.ud-grid-2{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:1rem}
.ud-card{display:flex;flex-direction:column;border:1px solid var(--ud-divider);border-radius:1rem;background:var(--ud-surface);padding:1.05rem;min-width:0}
.ud-card-featured{border-color:transparent;background:var(--ud-featured);color:var(--ud-on-featured);padding:0;overflow:hidden}
.ud-card-featured .ud-card-head{padding:.85rem 1.1rem}
.ud-card-featured .ud-card-body{padding:.35rem 1.1rem 1.05rem;display:flex;flex-direction:column;gap:.35rem}
.ud-card-head{display:flex;align-items:center;justify-content:space-between;gap:.75rem}
.ud-card-title{margin:0;font-size:1.05rem;font-weight:750;letter-spacing:-.015em}
.ud-card-featured .ud-card-title{color:var(--ud-on-featured)}
.ud-card-sub{margin:.15rem 0 0;color:var(--ud-text-3);font-size:.78rem}
.ud-card-body{margin-top:.65rem;display:flex;flex-direction:column;gap:.4rem}
.ud-card-foot{margin-top:auto;padding-top:.85rem;border-top:1px solid var(--ud-divider-soft)}
.ud-card-featured .ud-card-foot{border-color:color-mix(in srgb,var(--ud-on-featured) 22%,transparent)}
.ud-split-foot{display:flex;align-items:center;justify-content:space-between;gap:.75rem;color:var(--ud-on-featured-2);font-size:.76rem}
.ud-badge{display:inline-flex;align-items:center;padding:.1rem .5rem;border-radius:.4rem;background:var(--ud-featured-badge);color:var(--ud-on-featured);font-size:.68rem;font-weight:700;letter-spacing:.02em}
.ud-figure{margin:.5rem 0 0;font-size:2.2rem;font-weight:750;letter-spacing:-.035em;line-height:1.05}
.ud-figure-sub{color:var(--ud-on-featured-2);font-size:.85rem}
.ud-progress{height:.55rem;border-radius:999px;background:var(--ud-track);overflow:hidden;margin:.55rem 0 .1rem}
.ud-progress>span{display:block;height:100%;border-radius:inherit;background:var(--ud-track-fill)}
.ud-divider{height:1px;background:var(--ud-divider);margin:.85rem 0}
.ud-metric{display:flex;flex-direction:column;gap:.25rem;border:1px solid var(--ud-divider);border-radius:1rem;background:var(--ud-surface);padding:1rem}
.ud-metric-label{color:var(--ud-text-3);font-size:.72rem;font-weight:650;letter-spacing:.07em;text-transform:uppercase}
.ud-metric-value{margin-top:.3rem;font-size:1.5rem;font-weight:750;letter-spacing:-.03em;overflow-wrap:anywhere}
.ud-metric-sub{color:var(--ud-text-3);font-size:.74rem}
.ud-pair{display:flex;gap:1.5rem;margin-top:.35rem}
.ud-pair-cell{display:flex;flex-direction:column}
.ud-pair-value{font-size:1.55rem;font-weight:750;letter-spacing:-.03em;line-height:1.1}
.ud-pair-label{color:var(--ud-text-3);font-size:.74rem}
.ud-pair-alert .ud-pair-value{color:var(--ud-alert)}
.ud-pair-warn .ud-pair-value{color:var(--ud-warn)}
.ud-figure-value{margin-top:.4rem;font-size:1.9rem;font-weight:750;letter-spacing:-.035em;color:var(--ud-accent);line-height:1.1}
.ud-linkbtn{border:0;background:transparent;color:var(--ud-accent);padding:0;cursor:pointer;font:inherit;font-size:.8rem;font-weight:650;text-align:left}
.ud-linkbtn:hover{text-decoration:underline}
.ud-table{display:flex;flex-direction:column;margin-top:.85rem}
.ud-table-head,.ud-table-row{display:grid;grid-template-columns:minmax(0,1.5fr) minmax(4rem,.6fr) minmax(4rem,.6fr) minmax(5rem,.8fr);gap:.75rem;align-items:center}
.ud-table-head{padding-bottom:.5rem;border-bottom:1px solid var(--ud-divider);color:var(--ud-text-3);font-size:.68rem;font-weight:700;letter-spacing:.08em;text-transform:uppercase}
.ud-table-row{padding:.6rem 0;border-bottom:1px solid var(--ud-divider-soft)}
.ud-table-row:last-child{border-bottom:0}
.ud-device{min-width:0}
.ud-device-name{font-weight:700;font-size:.88rem;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.ud-device-sub,.ud-list-sub{color:var(--ud-text-3);font-size:.72rem;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.ud-cell-num{font-size:.85rem;color:var(--ud-text)}
.ud-cell-asleep{color:var(--ud-text-3);font-style:italic;font-size:.78rem}
.ud-state{display:inline-flex;align-items:center;gap:.4rem;font-size:.8rem;white-space:nowrap}
.ud-list{display:flex;flex-direction:column;margin-top:.6rem}
.ud-list-row{display:flex;align-items:center;justify-content:space-between;gap:.75rem;padding:.55rem 0;border-bottom:1px solid var(--ud-divider-soft)}
.ud-list-row:last-child{border-bottom:0}
.ud-list-main{display:flex;align-items:center;gap:.55rem;min-width:0}
.ud-list-name{font-weight:700;font-size:.88rem;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.ud-list-state{font-size:.72rem;font-weight:700;white-space:nowrap}
.ud-pill{display:inline-flex;align-items:center;gap:.3rem;border-radius:999px;padding:.12rem .45rem;font-size:.66rem;font-weight:700;white-space:nowrap;background:color-mix(in srgb,var(--tone) 14%,transparent);color:var(--tone)}
.ud-empty{padding:.85rem 0;color:var(--ud-text-3);font-size:.82rem}
.ud-filters{display:flex;gap:.4rem;flex-wrap:wrap}
.ud-chip{border:1px solid var(--ud-divider);border-radius:999px;background:transparent;color:var(--ud-text-2);padding:.32rem .65rem;cursor:pointer;font:inherit;font-size:.72rem}
.ud-chip[aria-pressed="true"]{background:var(--ud-surface-2);color:var(--ud-text);font-weight:700}
.ud-detail-row{display:grid;grid-template-columns:minmax(0,1.4fr) minmax(0,1fr) auto;gap:.75rem;align-items:center;padding:.7rem 0;border-bottom:1px solid var(--ud-divider-soft)}
.ud-detail-row:last-child{border-bottom:0}
.ud-footer{margin-top:auto;background:var(--ud-chrome);color:var(--ud-on-chrome-muted)}
.ud-statusbar{display:flex;align-items:center;justify-content:space-between;gap:1rem;padding:.7rem 1.25rem;font-size:.78rem;flex-wrap:wrap}
.ud-status-slot{display:inline-flex;align-items:center;gap:.4rem}
.ud-status-left{color:var(--ud-on-chrome);font-weight:650}
.ud-status-right{color:var(--ud-on-chrome-faint)}
.ud-safety{padding:.1rem 1.25rem .75rem;color:var(--ud-on-chrome-faint);font-size:.7rem;margin:0}
.ud-tab:focus-visible,.ud-linkbtn:focus-visible,.ud-chip:focus-visible,.ud-appearance-option:focus-visible{outline:2px solid var(--ud-focus);outline-offset:2px}
@container unraid-deck (max-width:64rem){.ud-grid-4{grid-template-columns:repeat(2,minmax(0,1fr))}.ud-grid-3{grid-template-columns:1fr}.ud-grid-2{grid-template-columns:1fr}}
@container unraid-deck (max-width:40rem){.ud-body{padding:1rem}.ud-topbar{padding:.75rem 1rem}.ud-nav{padding:0 1rem}.ud-nav-right{display:none}.ud-grid-4{grid-template-columns:1fr}.ud-table-head,.ud-table-row{grid-template-columns:minmax(0,1fr) auto auto}.ud-table-head>*:nth-child(2),.ud-table-row>*:nth-child(2){display:none}.ud-detail-row{grid-template-columns:minmax(0,1fr) auto}.ud-utility-row>*:nth-child(2){display:none}.ud-statusbar{justify-content:flex-start;gap:.35rem}}
@media(max-width:64rem){.ud-grid-4{grid-template-columns:repeat(2,minmax(0,1fr))}.ud-grid-3{grid-template-columns:1fr}.ud-grid-2{grid-template-columns:1fr}}
@media(max-width:40rem){.ud-body{padding:1rem}.ud-topbar{padding:.75rem 1rem}.ud-nav{padding:0 1rem}.ud-nav-right{display:none}.ud-grid-4{grid-template-columns:1fr}.ud-table-head,.ud-table-row{grid-template-columns:minmax(0,1fr) auto auto}.ud-table-head>*:nth-child(2),.ud-table-row>*:nth-child(2){display:none}.ud-detail-row{grid-template-columns:minmax(0,1fr) auto}.ud-utility-row>*:nth-child(2){display:none}.ud-statusbar{justify-content:flex-start;gap:.35rem}}
.ud-overview-header{overflow-wrap:anywhere}
.ud-overview-summary{grid-template-columns:repeat(3,minmax(0,1fr))}
.ud-overview-summary .ud-pair{gap:clamp(.4rem,1.5cqi,1.5rem);flex-wrap:wrap}
@container unraid-deck (max-width:64rem){.ud-overview-summary{grid-template-columns:repeat(2,minmax(0,1fr))}.ud-overview-summary>:first-child{grid-column:1/-1}}
@media(max-width:64rem){.ud-overview-summary{grid-template-columns:repeat(2,minmax(0,1fr))}.ud-overview-summary>:first-child{grid-column:1/-1}}
.ud-system{display:flex;flex-direction:column;gap:.6rem}
.ud-system-heading{font-size:1.2rem;line-height:1.25;margin:0}
.ud-board-facts{margin:.65rem 0 0}
.ud-board-facts>div{padding:.42rem 0;min-width:0}
.ud-board-facts>div+div{border-top:1px solid var(--ud-divider-soft)}
.ud-board-facts dt,.ud-memory-footer{color:var(--ud-text-2);font-size:.8rem}
.ud-board-facts dd,.ud-memory-legend dd{margin:0;font-weight:650;overflow-wrap:anywhere}
.ud-board-facts .ud-cpu-specs{color:var(--ud-text-2);font-size:.8rem;font-weight:400}
.ud-memory-body{display:flex;align-items:center;gap:clamp(.65rem,3cqi,1.6rem);margin:.75rem 0;flex-wrap:wrap}
.ud-memory-ring{display:grid;place-items:center;flex:none;width:6.25rem;height:6.25rem;border-radius:50%;position:relative;text-align:center;background:conic-gradient(var(--ud-memory-fill,var(--ud-good)) 0% var(--ud-memory-used),var(--ud-memory-track,var(--ud-text-3)) var(--ud-memory-used) 100%)}
.ud-memory-ring::before{content:'';position:absolute;inset:.6rem;border-radius:50%;background:var(--ud-surface)}
.ud-memory-ring>span{position:relative;color:var(--ud-text-2);font-size:.72rem;line-height:1.2}
.ud-memory-ring strong{display:block;font-size:1.45rem;color:var(--ud-text)}
.ud-memory-legend{flex:1 1 8.5rem;min-width:0;margin:0}
.ud-memory-legend>div{display:flex;align-items:baseline;justify-content:space-between;gap:.5rem;padding:.32rem 0}
.ud-memory-legend dt{display:flex;align-items:center;gap:.45rem;color:var(--ud-text-2)}
.ud-memory-legend i{display:inline-block;width:.45rem;height:.45rem;flex:none;border-radius:50%;background:var(--ud-memory-fill,var(--ud-good))}
.ud-memory-legend>div+div i{background:var(--ud-memory-track,var(--ud-text-3))}
.ud-memory-legend dd{text-align:right}
.ud-memory-footer{border-top:1px solid var(--ud-divider-soft);padding-top:.6rem;margin:auto 0 0}
`;

const SAFE_ERRORS = Object.freeze({
  not_configured: 'Configure UNRAID_URL and a read-only API key to connect.',
  authentication_failed: 'Unraid rejected the API key.',
  upstream_http_error: 'Unraid returned an HTTP error. Check the server and try again.',
  unraid_unreachable: 'Unable to reach the configured Unraid API.',
  invalid_upstream_response: 'Unraid returned an invalid response.',
  graphql_error: 'The installed Unraid API did not satisfy this read-only query. Check API version and key permissions.',
  missing_data: 'Unraid returned no data.',
});
const GENERIC_ERROR = 'Could not load Unraid data. Check the connection and try again.';

function errorText(error) {
  // SDK exceptions can include a full URL or upstream body. Display only known
  // error codes; never reflect arbitrary messages into the Desktop UI.
  let code = error?.detail?.code || error?.code;
  if (!Object.hasOwn(SAFE_ERRORS, code)) {
    const raw = String(error?.message || error || '');
    const start = raw.indexOf('{');
    if (start >= 0) {
      try {
        const parsed = JSON.parse(raw.slice(start));
        code = parsed?.detail?.code || parsed?.code;
      } catch (_) {}
    }
  }
  return Object.hasOwn(SAFE_ERRORS, code) ? SAFE_ERRORS[code] : GENERIC_ERROR;
}

function readAppearance(storage) {
  try {
    const value = storage && typeof storage.get === 'function' ? storage.get(APPEARANCE_KEY) : null;
    return APPEARANCE_CHOICES.includes(value) ? value : 'match';
  } catch (_) {
    return 'match';
  }
}

function writeAppearance(storage, choice) {
  try {
    if (storage && typeof storage.set === 'function') storage.set(APPEARANCE_KEY, choice);
  } catch (_) {}
}

function resolveAppearance(choice, systemDark) {
  if (choice === 'light' || choice === 'dark') return choice;
  if (choice === 'system') return systemDark ? 'dark' : 'light';
  return 'match';
}

function systemPrefersDark() {
  try {
    return (
      typeof window !== 'undefined' &&
      typeof window.matchMedia === 'function' &&
      window.matchMedia('(prefers-color-scheme: dark)').matches === true
    );
  } catch (_) {
    return false;
  }
}

function useAppearance() {
  const [choice, setChoice] = useState(() => readAppearance(pluginContext?.storage));
  const [systemDark, setSystemDark] = useState(() => systemPrefersDark());

  useEffect(() => {
    if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') return undefined;
    const media = window.matchMedia('(prefers-color-scheme: dark)');
    const update = (event) => setSystemDark(event.matches === true);
    setSystemDark(media.matches === true);
    if (typeof media.addEventListener === 'function') {
      media.addEventListener('change', update);
      return () => media.removeEventListener('change', update);
    }
    if (typeof media.addListener === 'function') {
      media.addListener(update);
      return () => media.removeListener(update);
    }
    return undefined;
  }, []);

  const choose = useCallback((next) => {
    if (!APPEARANCE_CHOICES.includes(next)) return;
    setChoice(next);
    writeAppearance(pluginContext?.storage, next);
  }, []);

  return { choice, resolved: resolveAppearance(choice, systemDark), choose };
}

function useEndpoint(path, enabled = true, refreshMs = 15000) {
  const [state, setState] = useState({ loading: enabled, data: null, error: null, updatedAt: null });
  const refresh = useCallback(async () => {
    if (!enabled) return;
    setState((current) => ({ ...current, loading: current.data == null, error: null }));
    try {
      const response = await pluginContext.rest(path, { timeoutMs: 15000 });
      setState({ loading: false, data: response, error: null, updatedAt: new Date() });
    } catch (error) {
      setState((current) => ({ ...current, loading: false, error: errorText(error) }));
    }
  }, [path, enabled]);

  useEffect(() => {
    refresh();
    if (!enabled || !refreshMs) return undefined;
    const timer = window.setInterval(refresh, refreshMs);
    return () => window.clearInterval(timer);
  }, [refresh, enabled, refreshMs]);
  return { ...state, refresh };
}

function numberText(value, digits = 1) {
  if (value == null) return 'Unknown';
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) return 'Unknown';
  return numeric.toLocaleString(undefined, { maximumFractionDigits: digits });
}

function percentText(value) {
  if (value == null) return 'Unknown';
  const numeric = Number(value);
  return Number.isFinite(numeric) ? `${numberText(numeric, 1)}%` : 'Unknown';
}

function formatBytesFromKb(value) {
  if (value == null) return 'Unknown';
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) return 'Unknown';
  let bytes = numeric * 1024;
  const units = ['B', 'KB', 'MB', 'GB', 'TB', 'PB'];
  let index = 0;
  while (bytes >= 1024 && index < units.length - 1) {
    bytes /= 1024;
    index += 1;
  }
  return `${bytes.toFixed(index < 3 ? 0 : 1)} ${units[index]}`;
}

function capacityPercent(capacity) {
  if (capacity?.used == null || capacity?.total == null) return null;
  const used = Number(capacity?.used);
  const total = Number(capacity?.total);
  if (!Number.isFinite(used) || !Number.isFinite(total) || total <= 0) return null;
  return Math.max(0, Math.min(100, (used / total) * 100));
}

function resolveArrayDisks(overviewArray, arrayPayload) {
  // The overview GraphQL query returns array state/capacity/parity only, so the
  // disk records live on the /array query. Trust an actual disk list when one
  // exists and never turn "unknown" into an invented zero.
  if (Array.isArray(arrayPayload?.disks)) return arrayPayload.disks;
  if (Array.isArray(overviewArray?.disks)) return overviewArray.disks;
  return null;
}

function toneForState(value) {
  const state = String(value || '').toUpperCase();
  if (!state) return 'muted';
  if (state.includes('ERROR') || state.includes('FAIL') || state.includes('ALERT') || state.includes('ORPHAN')) return 'bad';
  if (state.includes('RUNNING') || state.includes('STARTED') || state.includes('ONLINE') || state === 'OK' || state.includes('_OK') || state.includes('ACTIVE') || state.includes('COMPLETED')) return 'good';
  if (state.includes('STOPPED') || state.includes('EXITED') || state.includes('OFFLINE') || state.includes('SHUTOFF')) return 'muted';
  return 'warn';
}

function displayState(value, fallback = 'Unknown') {
  const text = String(value || fallback).toUpperCase();
  if (text === 'DISK_OK') return 'OK';
  if (text === 'SHUTOFF') return 'SHUT OFF';
  return text.replaceAll('_', ' ');
}

function toneColor(tone) {
  if (tone === 'good') return 'var(--ud-good)';
  if (tone === 'warn') return 'var(--ud-warn)';
  if (tone === 'bad') return 'var(--ud-alert)';
  return 'var(--ud-text-3)';
}

function importanceTone(value) {
  const importance = String(value || '').toUpperCase();
  return importance.includes('ALERT') || importance.includes('CRITICAL') || importance.includes('ERROR') ? 'bad' : 'warn';
}

function alertLabel(value) {
  return importanceTone(value) === 'bad' ? 'Alert' : 'Warning';
}

function groupAlerts(items) {
  const groups = new Map();
  for (const item of items || []) {
    const title = item.title || item.subject || 'Unraid notification';
    const description = item.description || item.subject || 'No description.';
    const label = alertLabel(item.importance);
    const key = `${label}\u0000${title}\u0000${description}`;
    const current = groups.get(key);
    if (current) {
      current.count += 1;
      if (item.timestamp && (!current.timestamp || item.timestamp > current.timestamp)) current.timestamp = item.timestamp;
    } else {
      groups.set(key, { ...item, title, description, label, tone: importanceTone(item.importance), count: 1 });
    }
  }
  return [...groups.values()].sort((a, b) => {
    if (a.tone !== b.tone) return a.tone === 'bad' ? -1 : 1;
    return String(b.timestamp || '').localeCompare(String(a.timestamp || ''));
  });
}

function attentionCount(summary) {
  if (summary?.warning == null || summary?.alert == null) return null;
  return Number(summary.warning) + Number(summary.alert);
}

function formatTimestamp(value) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return String(value);
  return date.toLocaleString([], {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  });
}

function formatUpdated(value) {
  if (!(value instanceof Date)) return 'Read-only · waiting for data';
  return `Read-only · Updated ${value.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })}`;
}

function parityLabel(status) {
  const value = String(status?.status || '').toUpperCase();
  if (!value) return null;
  if (value.includes('RUN')) return 'Running';
  if (value === 'COMPLETED') return 'Completed';
  if (value.includes('PAUSED')) return 'Paused';
  return displayState(value);
}

function parityDetail(status) {
  if (!status) return null;
  const label = parityLabel(status);
  if (!label) return null;
  const running = String(status.status || '').toUpperCase().includes('RUN');
  if (status.errors != null && !running) return `${numberText(status.errors, 0)} errors reported`;
  const progress = Number(status.progress);
  if (status.progress != null && Number.isFinite(progress)) return `${numberText(progress, 1)}% complete`;
  return status.errors != null ? `${numberText(status.errors, 0)} errors reported` : null;
}

function parityStripText(status) {
  if (!status || !status.status) return 'Parity check status unknown';
  const label = String(parityLabel(status) || '').toLowerCase();
  if (status.errors != null) return `Parity check ${label} · ${numberText(status.errors, 0)} errors`;
  const progress = Number(status.progress);
  if (status.progress != null && Number.isFinite(progress)) return `Parity check ${label} · ${numberText(progress, 1)}%`;
  return `Parity check ${label}`;
}

function arrayStateText(state) {
  if (!state) return 'Array state unknown';
  const value = String(state).toUpperCase();
  if (value === 'STARTED') return 'Array started';
  if (value === 'STOPPED') return 'Array stopped';
  return `Array ${displayState(state).toLowerCase()}`;
}

function connectionText(configured, anyError) {
  if (!configured) return 'API not configured';
  return anyError ? 'Degraded' : 'API configured';
}

function StatusPill({ tone = 'muted', children }) {
  return jsx('span', { className: 'ud-pill', style: { '--tone': toneColor(tone) }, children });
}

function StateLabel({ value, fallback = 'Unknown' }) {
  const text = value || fallback;
  const tone = toneForState(text);
  return jsxs('span', {
    className: `ud-state ud-tone-${tone}`,
    children: [jsx(StatusDot, { tone }), jsx('span', { children: displayState(text, fallback) })],
  });
}

function ProgressBar({ value, label }) {
  const numeric = Number(value);
  const determinate = value != null && Number.isFinite(numeric);
  const safe = determinate ? Math.max(0, Math.min(100, numeric)) : 0;
  return jsx('div', {
    className: 'ud-progress',
    role: 'progressbar',
    'aria-label': label,
    'aria-valuemin': 0,
    'aria-valuemax': 100,
    'aria-valuenow': determinate ? Math.round(safe * 10) / 10 : undefined,
    'aria-valuetext': determinate ? `${numberText(safe, 1)}%` : 'Unknown',
    children: jsx('span', { style: { width: `${safe}%` } }),
  });
}

const SETTINGS_BUTTON_CSS = `
.unraid-deck .ud-settings-button{display:inline-flex;align-items:center;justify-content:center;gap:.45rem;min-height:2.125rem;padding:.35rem .65rem;border:1px solid var(--ud-divider);border-radius:.375rem;background:var(--ud-surface);color:var(--ud-text);font:inherit;font-weight:650;cursor:pointer}
.unraid-deck .ud-settings-button:hover{background:var(--ud-surface-2)}
.unraid-deck .ud-settings-button:focus-visible{outline:2px solid var(--ud-focus);outline-offset:2px}
.unraid-deck .ud-settings-button svg{flex:none}
.unraid-deck .us-gear{width:2.5rem;height:2.5rem;padding:0}
`;

const THEME_MAKER_CSS = `
.unraid-settings .us-palette-row{position:relative}
.unraid-settings .us-palette-row h3{font-size:.9375rem}
.unraid-settings .us-maker{margin-top:.75rem;min-width:0}
.unraid-settings .us-maker summary{width:max-content;max-width:100%;margin-bottom:0}
.unraid-settings .us-maker summary::after{content:'';width:.45rem;height:.45rem;margin-inline:.4rem .15rem;border:solid currentColor;border-width:0 1.5px 1.5px 0;transform:translateY(-2px) rotate(45deg)}
.unraid-settings .us-maker[open] summary::after{transform:translateY(2px) rotate(225deg)}
.unraid-settings .us-editor{margin-top:.65rem;padding:clamp(.75rem,2cqi,1.3rem);border:1px solid var(--ud-divider);border-radius:.5rem;background:var(--ud-surface);min-width:0}
.unraid-settings .us-editor-top,.unraid-settings .us-editor-actions{display:flex;align-items:center;justify-content:space-between;gap:.65rem 1rem;flex-wrap:wrap}
.unraid-settings .us-editor-top h3{font-size:1.25rem;letter-spacing:-.02em}
.unraid-settings .us-editor-mode{display:flex;align-items:center;gap:.5rem;flex-wrap:wrap;color:var(--ud-text-2)}
.unraid-settings .us-editor :is(input,select){min-width:0;max-width:100%;min-height:2rem;font:inherit;color:var(--ud-text);background:var(--ud-canvas);border:1px solid var(--ud-divider);border-radius:.35rem}
.unraid-settings .us-editor :is(input,select):focus-visible{outline:2px solid var(--ud-focus);outline-offset:2px}
.unraid-settings .us-editor select{padding:.18rem .55rem;background:var(--ud-surface)}
.unraid-settings .us-editor input[aria-invalid=true]{border-color:var(--ud-alert)}
.unraid-settings .us-editor-grid{display:grid;grid-template-columns:minmax(0,4fr) minmax(0,5fr);gap:1.25rem clamp(1rem,4cqi,3.3rem);margin-top:.7rem}
.unraid-settings .us-editor-grid>*{min-width:0}
.unraid-settings .us-presets{display:flex;flex-wrap:wrap;gap:.45rem;margin:.35rem 0 .9rem}
.unraid-settings .us-presets button{font-weight:500;flex:1 1 auto;justify-content:flex-start}
.unraid-settings .us-presets button[aria-pressed=true]{border-color:var(--ud-accent);background:var(--ud-surface-2);font-weight:700}
.unraid-settings .us-swatch-dots{display:flex;padding-inline-start:.1rem}
.unraid-settings .us-swatch-dots span{width:.7rem;height:.7rem;border-radius:50%;border:1px solid var(--ud-divider)}
.unraid-settings .us-field{display:grid;grid-template-columns:minmax(0,1fr) 2.1rem minmax(4.6rem,1fr);gap:.45rem;align-items:center;margin-top:.45rem}
.unraid-settings .us-field input[type=color]{width:100%;padding:.18rem}
.unraid-settings .us-field input[type=text]{width:100%;padding:.2rem .55rem;font-variant-numeric:tabular-nums}
.unraid-settings .us-storage-preview{background:var(--ud-canvas);color:var(--ud-text);border:1px solid var(--ud-divider);border-radius:.45rem;padding:.8rem;margin:.3rem 0 .6rem;font-size:.8125rem}
.unraid-settings .us-sample-line{display:flex;align-items:baseline;justify-content:space-between;gap:.4rem .8rem;flex-wrap:wrap}
.unraid-settings .us-sample-top{font-size:.7rem;margin-bottom:.38rem}
.unraid-settings .us-sample-capacity{background:var(--ud-surface);border-radius:.3rem;padding:.6rem .7rem;margin-bottom:.55rem}
.unraid-settings .us-sample-capacity strong{display:block;font-size:1.4rem;letter-spacing:-.03em}
.unraid-settings .us-sample-track{height:.3rem;border-radius:999px;background:var(--ud-surface-2);margin-top:.32rem;overflow:hidden}
.unraid-settings .us-sample-track span{display:block;width:47.5%;height:100%;background:var(--ud-accent)}
.unraid-settings .us-sample-line-row{padding:.25rem .6rem}
.unraid-settings .us-sample-selected{background:var(--ud-surface-2);border-left:1px solid var(--ud-accent);border-radius:0 .25rem .25rem 0;font-weight:650}
.unraid-settings .us-sample-status{display:inline-flex;align-items:center;gap:.3rem}
.unraid-settings .us-sample-readonly{font-size:.7rem;margin:.35rem 0 0 .6rem}
.unraid-settings .us-check{font-size:.8125rem}
.unraid-settings .us-check ul{margin:.35rem 0;padding-left:1.2rem}
.unraid-settings .us-editor-actions{margin-top:.85rem;padding-top:.75rem;border-top:1px solid var(--ud-divider)}
.unraid-settings .us-editor-actions p{font-size:.78rem}
.unraid-settings .us-editor-actions div{display:flex;flex-wrap:wrap;gap:.45rem}
.unraid-settings .us-editor .us-apply{background:var(--ud-accent);color:var(--ud-canvas, var(--ud-surface));border-color:var(--ud-accent)}
.unraid-settings[data-appearance=match] .us-editor .us-apply{color:var(--ui-bg-editor);background:var(--ui-accent)}
.unraid-settings .us-editor button:disabled{opacity:.55;cursor:not-allowed}
.unraid-settings .us-result{margin-top:.55rem}
@container unraid-deck (min-width:41rem){
  .unraid-settings .us-palette-row>div:first-child{padding-inline-end:10rem}
  .unraid-settings .us-maker summary{position:absolute;inset-block-start:1.1rem;inset-inline-end:0}
}
@container unraid-deck (max-width:40rem){
  .unraid-settings .us-editor-grid{grid-template-columns:minmax(0,1fr)}
}
`;

const ANUNNAKI_CSS = `
.unraid-deck[data-preset=anunnaki] .ud-card-featured{border-color:var(--ud-divider)}
.unraid-deck[data-preset=anunnaki] :is(.ud-appearance-option:not([aria-pressed=true]),.ud-settings-button){border-color:var(--ud-control-border)}
.unraid-deck[data-preset=anunnaki] :is(.ud-tab[aria-selected=true],.ud-appearance-option[aria-pressed=true],.ud-logo){color:var(--ud-accent)}
.unraid-deck[data-preset=anunnaki] button.ud-refresh{background:var(--ud-accent);color:var(--ud-canvas);border-color:var(--ud-accent)}
.unraid-deck[data-preset=anunnaki] button.ud-refresh:hover:enabled{background:color-mix(in srgb,var(--ud-accent) 85%,var(--ud-text))}
`;
const CUSTOM_STATUS_CSS = `
/* Keep semantic markers, but use verified foreground ink for their labels on
   user-selected surfaces. This does not alter the original status tokens. */
.unraid-deck[data-custom-palette=true]:not([data-preset=anunnaki]) :is(.ud-tone-good,.ud-tone-warn,.ud-tone-bad,.ud-pair-alert .ud-pair-value,.ud-pair-warn .ud-pair-value,.ud-list-state,.ud-pill){color:var(--ud-text)!important}
.unraid-deck[data-custom-palette=true]:not([data-preset=anunnaki]) .ud-pill{background:var(--ud-surface-2);border-inline-start:1px solid var(--tone)}
`;

const SETTINGS_CSS = `
.unraid-settings{overflow-x:visible}
.unraid-settings .us-content{width:100%;max-width:68.75rem;margin-inline:auto;padding:1.5rem clamp(1rem,5cqi,3.5rem) 2.5rem}
.unraid-settings h1,.unraid-settings h2,.unraid-settings h3,.unraid-settings p{margin:0}
.unraid-settings .us-brand{display:flex;align-items:baseline;gap:1.15rem;padding-bottom:1.1rem;font-size:.8125rem}
.unraid-settings .us-brand strong{color:var(--ud-accent);text-transform:uppercase}
.unraid-settings .us-brand span,.unraid-settings p{color:var(--ud-text-2)}
.unraid-settings .us-section{border-top:1px solid var(--ud-divider);padding-block:1.15rem 1.35rem}
.unraid-settings .us-heading{display:flex;flex-wrap:wrap;align-items:flex-start;justify-content:space-between;gap:.75rem 1.25rem}
.unraid-settings .us-heading>div{min-width:0}
.unraid-settings h1{font-size:2.125rem;line-height:1.16;letter-spacing:-.025em}
.unraid-settings h2{font-size:1.3125rem;line-height:1.25;letter-spacing:-.015em}
.unraid-settings h3{font-size:.875rem}
.unraid-settings h1+p,.unraid-settings h2+p,.unraid-settings h3+p{margin-top:.25rem}
.unraid-settings .us-intro p{font-size:.9375rem}
.unraid-settings .us-connections{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:.75rem 2.25rem;max-width:39.25rem;margin-top:.9rem}
.unraid-settings .us-connection{min-width:0;border-top:1px solid var(--ud-divider);padding-top:.625rem}

@container unraid-deck (max-width:35rem){
  .unraid-settings .us-connections{grid-template-columns:minmax(0,1fr)}
  .unraid-settings .us-heading{flex-direction:column}
}
`;

// Exact vectors from FigCraft #85, Settings gear and Brightness. Keep the
// exported viewBox and offset; fill follows the active toolbar color.
const FIGCRAFT_TOOLBAR_ICONS = {
  gear: { transform: 'matrix(1 0 0 1 1.819 2.04)', d: 'M0.003 13.604C-0.004 13.502 0.001 13.401 0.02 13.3L0.762 9.378L1.246 9.121C1.385 9.047 1.53 8.993 1.683 8.96L3.246 8.616C3.409 8.58 3.534 8.491 3.621 8.349L3.842 7.987C3.897 7.896 3.941 7.8 3.972 7.698L4.035 7.495C4.067 7.393 4.063 7.292 4.023 7.193L3.324 5.451C3.285 5.354 3.278 5.254 3.302 5.153L3.351 4.949C3.375 4.847 3.424 4.76 3.499 4.687L3.815 4.379C3.938 4.26 4.065 4.145 4.196 4.035L6.422 2.164C6.504 2.095 6.596 2.045 6.697 2.013L6.904 1.947C7.004 1.916 7.105 1.912 7.206 1.935L7.41 1.981C7.512 2.004 7.607 2.043 7.695 2.099L8.831 2.817C9.004 2.926 9.192 2.971 9.396 2.951L9.829 2.908C10.015 2.889 10.177 2.817 10.315 2.691L10.592 2.44C10.73 2.314 10.827 2.162 10.883 1.984L11.227 0.895C11.263 0.781 11.316 0.676 11.387 0.579L11.536 0.376C11.603 0.286 11.687 0.218 11.788 0.173L11.992 0.081C12.094 0.036 12.201 0.013 12.312 0.012L15.554 0C15.657 0 15.759 0.008 15.861 0.023L16.065 0.055C16.166 0.07 16.253 0.115 16.324 0.19L16.574 0.45C16.675 0.557 16.749 0.68 16.796 0.819L17.157 1.908C17.21 2.067 17.287 2.212 17.388 2.344L17.592 2.609C17.694 2.742 17.826 2.826 17.989 2.862L18.457 2.967C18.661 3.012 18.852 2.981 19.031 2.874L20.15 2.205C20.243 2.149 20.341 2.101 20.443 2.062L20.656 1.98C20.751 1.943 20.85 1.928 20.952 1.936L21.156 1.951C21.257 1.959 21.348 1.995 21.427 2.06L24.264 4.397C24.33 4.452 24.391 4.511 24.448 4.574L24.562 4.701C24.619 4.764 24.656 4.838 24.671 4.922L24.714 5.153C24.733 5.254 24.726 5.354 24.692 5.452L24.087 7.196C24.053 7.293 24.044 7.393 24.061 7.495L24.095 7.698C24.112 7.8 24.146 7.896 24.198 7.985L24.33 8.211C24.387 8.31 24.462 8.395 24.553 8.465L24.735 8.604C24.826 8.674 24.928 8.719 25.041 8.739L26.771 9.049C26.862 9.066 26.943 9.104 27.014 9.165L27.155 9.287C27.226 9.348 27.281 9.42 27.32 9.505L27.426 9.735C27.473 9.836 27.507 9.942 27.526 10.053L28.085 13.247C28.109 13.383 28.101 13.517 28.062 13.649L27.985 13.913C27.946 14.045 27.868 14.148 27.753 14.223L26.055 15.319C25.882 15.431 25.778 15.589 25.744 15.793L25.651 16.349C25.634 16.453 25.639 16.556 25.667 16.658L25.723 16.862C25.75 16.964 25.799 17.054 25.869 17.133L27.01 18.426C27.079 18.503 27.121 18.593 27.136 18.695L27.167 18.898C27.183 19 27.166 19.096 27.115 19.185L25.246 22.496C25.202 22.575 25.149 22.648 25.087 22.714L24.964 22.846C24.903 22.912 24.828 22.957 24.741 22.981L24.516 23.042C24.414 23.069 24.311 23.074 24.207 23.055L22.489 22.741C22.38 22.722 22.275 22.733 22.174 22.776L21.97 22.862C21.868 22.905 21.779 22.966 21.702 23.045L21.338 23.421C21.201 23.562 21.134 23.731 21.137 23.928L21.156 25.428C21.158 25.589 21.123 25.741 21.051 25.885L20.907 26.173C20.835 26.317 20.724 26.417 20.573 26.472L16.884 27.834C16.779 27.873 16.675 27.869 16.574 27.822L16.37 27.729C16.268 27.683 16.18 27.618 16.106 27.534L14.793 26.06C14.724 25.983 14.639 25.936 14.537 25.92L14.334 25.888C14.232 25.873 14.131 25.876 14.03 25.898L13.468 26.02C13.265 26.065 13.094 26.165 12.957 26.322L11.736 27.715C11.669 27.792 11.585 27.833 11.483 27.838L11.279 27.848C11.177 27.853 11.078 27.839 10.983 27.804L8.975 27.07C8.712 26.974 8.456 26.864 8.205 26.74L7.217 26.251C7.119 26.202 7.049 26.127 7.008 26.025L6.925 25.822C6.884 25.72 6.864 25.614 6.866 25.504L6.892 23.831C6.894 23.699 6.853 23.582 6.768 23.48L6.576 23.248C6.507 23.165 6.428 23.092 6.341 23.028L6.16 22.895C6.077 22.834 5.985 22.797 5.883 22.783L5.679 22.754C5.577 22.739 5.475 22.741 5.374 22.758L3.667 23.048C3.549 23.068 3.439 23.046 3.337 22.983L3.134 22.856C3.032 22.793 2.951 22.709 2.891 22.605L0.924 19.189C0.871 19.097 0.859 19 0.889 18.898L0.949 18.695C0.978 18.593 1.027 18.501 1.095 18.42L2.158 17.142C2.229 17.057 2.286 16.964 2.329 16.862L2.417 16.658C2.46 16.556 2.468 16.452 2.44 16.345L2.297 15.793C2.244 15.589 2.127 15.433 1.948 15.324L0.591 14.5C0.488 14.437 0.395 14.361 0.313 14.272L0.131 14.073C0.062 13.998 0.024 13.909 0.017 13.807L0.003 13.604ZM1.69 12.759C1.671 12.881 1.692 12.996 1.752 13.104L1.873 13.319C1.933 13.427 2.017 13.511 2.124 13.572L3.306 14.24C3.429 14.309 3.521 14.407 3.582 14.534L3.704 14.788C3.765 14.915 3.808 15.047 3.831 15.186L4.074 16.601C4.121 16.877 4.064 17.129 3.903 17.358L2.711 19.051L3.999 21.306L5.876 21.037C5.983 21.022 6.087 21.032 6.188 21.066L6.392 21.135C6.494 21.17 6.586 21.221 6.669 21.29L8.144 22.509C8.229 22.58 8.294 22.666 8.338 22.767L8.425 22.971C8.469 23.073 8.494 23.179 8.5 23.29L8.592 25.16L9.823 25.692C10.013 25.774 10.21 25.835 10.414 25.875L11.126 26.015L12.367 24.69C12.558 24.485 12.794 24.381 13.074 24.376L15.023 24.342C15.14 24.339 15.25 24.367 15.352 24.426L15.556 24.543C15.657 24.602 15.745 24.676 15.82 24.767L16.626 25.755C16.693 25.837 16.777 25.893 16.879 25.922L17.083 25.981C17.185 26.01 17.285 26.006 17.384 25.967L19.463 25.16L19.505 23.3C19.508 23.183 19.538 23.073 19.597 22.971L19.715 22.767C19.774 22.666 19.848 22.576 19.937 22.499L21.18 21.415C21.265 21.341 21.359 21.279 21.461 21.229L21.68 21.122C21.771 21.077 21.868 21.055 21.97 21.055L22.174 21.055C22.275 21.055 22.376 21.065 22.476 21.085L23.854 21.369L24.21 21.047C24.312 20.954 24.396 20.848 24.463 20.728L25.401 19.051L24.233 17.647C24.164 17.565 24.114 17.473 24.082 17.371L24.018 17.167C23.985 17.066 23.976 16.962 23.99 16.856L24.213 15.147C24.228 15.034 24.261 14.927 24.311 14.825L24.412 14.622C24.463 14.52 24.536 14.439 24.632 14.378L25.936 13.551C26.041 13.484 26.128 13.4 26.199 13.298L26.447 12.942L25.89 10.606L24.158 10.22C23.955 10.175 23.784 10.075 23.645 9.92L23.367 9.61C23.228 9.455 23.106 9.288 23.002 9.107L22.731 8.634C22.626 8.451 22.547 8.258 22.494 8.055L22.387 7.647C22.334 7.444 22.348 7.245 22.43 7.051L22.891 5.955C22.93 5.862 22.948 5.764 22.943 5.662L22.934 5.458C22.929 5.356 22.889 5.271 22.813 5.204L22.506 4.93C22.386 4.822 22.26 4.722 22.129 4.63L20.799 3.697L19.406 4.555C19.317 4.61 19.221 4.649 19.119 4.674L18.916 4.723C18.814 4.747 18.712 4.746 18.611 4.719L18.05 4.571C17.847 4.517 17.65 4.444 17.461 4.352L16.663 3.962C16.412 3.839 16.223 3.653 16.098 3.403L15.199 1.607L13.326 1.576C13.217 1.574 13.111 1.59 13.008 1.624L12.801 1.691C12.698 1.725 12.624 1.791 12.579 1.89L11.636 3.954L9.491 4.629C9.224 4.713 8.965 4.692 8.715 4.567L7.054 3.736L5.314 5.207C5.236 5.272 5.194 5.356 5.187 5.458L5.173 5.662C5.166 5.764 5.182 5.862 5.22 5.957L5.72 7.2C5.758 7.295 5.775 7.393 5.771 7.495L5.763 7.698C5.759 7.8 5.73 7.894 5.676 7.981L4.579 9.74C4.518 9.838 4.438 9.918 4.341 9.98L4.146 10.104C4.048 10.167 3.942 10.206 3.827 10.223L2.678 10.39C2.541 10.41 2.423 10.469 2.324 10.566L2.126 10.76C2.027 10.857 1.967 10.974 1.946 11.111L1.69 12.759ZM6.086 14.376C6.046 14.099 6.043 13.821 6.077 13.543L6.226 12.34C6.26 12.063 6.325 11.792 6.422 11.529L6.713 10.732C6.795 10.508 6.898 10.294 7.023 10.091L7.271 9.684C7.396 9.48 7.537 9.289 7.694 9.11L8.303 8.419C8.488 8.209 8.696 8.024 8.926 7.865L10.272 6.934C10.502 6.775 10.749 6.648 11.013 6.553L11.749 6.289C12.013 6.194 12.284 6.134 12.563 6.107L13.763 5.99C14.042 5.963 14.32 5.964 14.599 5.993L15.29 6.064C15.569 6.093 15.841 6.15 16.108 6.236L16.908 6.495C17.127 6.566 17.338 6.654 17.541 6.76L17.948 6.972C18.152 7.078 18.342 7.205 18.517 7.353L19.46 8.147C19.674 8.327 19.868 8.526 20.043 8.745L20.744 9.622C20.885 9.799 21.006 9.989 21.105 10.193L21.303 10.6C21.402 10.803 21.482 11.014 21.541 11.233L21.899 12.537C21.972 12.807 22.013 13.082 22.02 13.362L22.036 14.049C22.043 14.329 22.016 14.606 21.953 14.879L21.543 16.681C21.492 16.904 21.416 17.117 21.313 17.32L21.107 17.727C21.004 17.931 20.878 18.119 20.729 18.291L19.408 19.804C19.254 19.981 19.085 20.141 18.9 20.285L18.531 20.574C18.346 20.718 18.147 20.837 17.932 20.932L16.602 21.52C16.345 21.633 16.078 21.704 15.8 21.733L14.09 21.908C13.811 21.937 13.533 21.936 13.254 21.905L12.562 21.829C12.284 21.798 12.013 21.736 11.749 21.641L11.013 21.377C10.749 21.283 10.498 21.162 10.26 21.014L9.366 20.459C9.182 20.345 9.01 20.215 8.85 20.07L8.531 19.778C8.371 19.633 8.222 19.477 8.083 19.312L7.693 18.847C7.522 18.644 7.376 18.424 7.255 18.187L6.585 16.879C6.458 16.63 6.374 16.367 6.334 16.09L6.086 14.376ZM7.671 13.548C7.618 13.823 7.618 14.097 7.672 14.372L8.007 16.088C8.05 16.307 8.123 16.517 8.225 16.716L8.428 17.115C8.53 17.314 8.651 17.5 8.792 17.674L9.335 18.344C9.511 18.561 9.714 18.75 9.944 18.91L10.853 19.542C11.035 19.669 11.228 19.776 11.432 19.863L11.839 20.038C12.043 20.125 12.255 20.181 12.475 20.205L13.763 20.343C14.042 20.373 14.319 20.365 14.595 20.32L15.756 20.129C15.998 20.089 16.231 20.019 16.454 19.919L16.9 19.72C17.124 19.62 17.332 19.494 17.523 19.343L18.222 18.791C18.432 18.625 18.624 18.44 18.797 18.236L19.181 17.787C19.33 17.612 19.459 17.422 19.568 17.218L19.786 16.811C19.895 16.607 19.982 16.395 20.049 16.174L20.322 15.271C20.381 15.076 20.416 14.876 20.429 14.673L20.455 14.265C20.468 14.062 20.468 13.858 20.456 13.655L20.432 13.247C20.42 13.044 20.384 12.844 20.325 12.649L20.052 11.746C19.985 11.525 19.897 11.313 19.788 11.109L19.571 10.702C19.462 10.498 19.332 10.309 19.181 10.134L18.794 9.684C18.619 9.48 18.424 9.296 18.211 9.133L17.499 8.585C17.304 8.435 17.094 8.309 16.871 8.207L16.424 8.004C16.2 7.902 15.967 7.832 15.724 7.794L14.596 7.616C14.319 7.572 14.042 7.565 13.763 7.595L12.473 7.735C12.254 7.758 12.043 7.812 11.839 7.897L11.432 8.066C11.228 8.151 11.037 8.258 10.86 8.388L9.846 9.13C9.62 9.295 9.428 9.494 9.271 9.725L8.308 11.14C8.151 11.371 8.045 11.625 7.992 11.9L7.671 13.548Z' },
  sun: { transform: 'matrix(1 0 0 1 2.281 2.223)', d: 'M11.819 6.556C11.817 6.458 11.817 6.359 11.819 6.261L11.873 1.831C11.875 1.607 11.938 1.403 12.061 1.217L12.388 0.722C12.456 0.618 12.54 0.528 12.638 0.453L12.835 0.301C12.933 0.225 13.042 0.173 13.164 0.145L13.67 0.028C13.866 -0.018 14.06 -0.007 14.25 0.06L14.675 0.21C14.856 0.274 15.013 0.376 15.146 0.516L15.503 0.892C15.574 0.967 15.626 1.054 15.66 1.152L15.727 1.349C15.76 1.447 15.776 1.548 15.776 1.652L15.727 7.216C15.726 7.332 15.694 7.44 15.631 7.538L15.506 7.735C15.442 7.833 15.365 7.917 15.273 7.989L14.69 8.439C14.534 8.559 14.357 8.624 14.161 8.636L13.628 8.668C13.524 8.674 13.424 8.661 13.326 8.63L13.13 8.567C13.031 8.535 12.943 8.485 12.865 8.419L12.461 8.073C12.312 7.945 12.2 7.791 12.124 7.611L11.881 7.036C11.843 6.945 11.823 6.85 11.822 6.752L11.819 6.556ZM13.334 6.236C13.333 6.351 13.347 6.464 13.375 6.576L13.473 6.967L13.965 7.155L14.157 6.976C14.211 6.925 14.239 6.862 14.241 6.787L14.315 2.164C14.316 2.046 14.282 1.94 14.212 1.846L13.965 1.515L13.353 1.988L13.334 6.236ZM3.707 5.721C3.67 5.524 3.682 5.331 3.744 5.141L3.885 4.706C3.941 4.531 4.036 4.38 4.168 4.252L4.433 3.996C4.565 3.868 4.721 3.784 4.901 3.746L5.32 3.656C5.516 3.614 5.712 3.613 5.908 3.653L6.301 3.734C6.497 3.774 6.666 3.865 6.808 4.008L10.454 7.67C10.594 7.811 10.682 7.98 10.718 8.177L10.79 8.57C10.825 8.766 10.809 8.959 10.742 9.147L10.597 9.552C10.527 9.748 10.411 9.913 10.251 10.047L9.828 10.398C9.638 10.555 9.42 10.632 9.174 10.63L8.49 10.623C8.21 10.62 7.967 10.523 7.763 10.332L4.887 7.647C4.703 7.476 4.534 7.292 4.379 7.096L4.021 6.644C3.897 6.487 3.816 6.31 3.78 6.114L3.707 5.721ZM16.968 9.149C16.902 8.959 16.89 8.766 16.931 8.57L17.037 8.052C17.06 7.938 17.105 7.835 17.171 7.741L17.304 7.552C17.37 7.457 17.443 7.369 17.525 7.287L20.721 4.074C20.801 3.992 20.891 3.923 20.989 3.865L21.186 3.748C21.284 3.689 21.389 3.653 21.503 3.639L22.021 3.576C22.217 3.552 22.407 3.577 22.592 3.649L23.103 3.849C23.233 3.899 23.344 3.977 23.437 4.081L23.651 4.319C23.725 4.402 23.789 4.493 23.842 4.591L23.947 4.788C23.999 4.886 24.027 4.99 24.03 5.102L24.043 5.623C24.047 5.819 24.005 6.004 23.915 6.179L23.695 6.605C23.594 6.801 23.464 6.977 23.306 7.131L20.076 10.269C19.931 10.409 19.761 10.5 19.565 10.544L19.17 10.63C18.974 10.672 18.778 10.675 18.582 10.639L18.176 10.563C17.988 10.528 17.825 10.444 17.688 10.312L17.413 10.046C17.275 9.913 17.175 9.756 17.113 9.576L16.968 9.149ZM5.22 5.426L5.297 5.77C5.318 5.868 5.364 5.952 5.436 6.024L8.18 8.782C8.235 8.837 8.292 8.89 8.352 8.94L8.472 9.04C8.531 9.09 8.6 9.117 8.678 9.122L9.052 9.145L9.289 8.865L9.192 8.521C9.164 8.422 9.115 8.337 9.043 8.265L6.989 6.203C6.799 6.012 6.595 5.838 6.377 5.68L5.614 5.127L5.22 5.426ZM18.425 8.865L18.877 9.163L19.221 9.009C19.319 8.965 19.406 8.904 19.482 8.828L22.274 6.027C22.346 5.953 22.399 5.868 22.433 5.77L22.548 5.426L22.315 5.122L21.963 5.123C21.87 5.123 21.789 5.154 21.719 5.215L21.58 5.335C21.51 5.395 21.442 5.458 21.377 5.524L18.646 8.266C18.575 8.337 18.528 8.422 18.505 8.521L18.425 8.865ZM9.253 14.194C9.217 13.916 9.218 13.638 9.254 13.36L9.349 12.628C9.377 12.411 9.438 12.205 9.533 12.009L9.73 11.598C9.819 11.413 9.93 11.242 10.062 11.085L10.327 10.772C10.459 10.614 10.605 10.471 10.765 10.341L11.259 9.938C11.425 9.802 11.606 9.691 11.803 9.604L12.196 9.431C12.392 9.343 12.597 9.282 12.809 9.248L13.55 9.126C13.826 9.08 14.1 9.094 14.37 9.167L15.524 9.476C15.794 9.548 16.039 9.672 16.258 9.847L17.107 10.524C17.304 10.681 17.473 10.865 17.614 11.076L17.894 11.497C18.034 11.707 18.135 11.934 18.197 12.18L18.497 13.37C18.565 13.641 18.564 13.912 18.496 14.184L18.204 15.335C18.135 15.606 18.017 15.854 17.85 16.079L17.238 16.899C17.08 17.11 16.894 17.292 16.68 17.444L16.251 17.748C16.037 17.9 15.803 18.011 15.549 18.081L14.37 18.403C14.1 18.477 13.826 18.491 13.55 18.445L12.807 18.321C12.596 18.285 12.392 18.226 12.196 18.144L11.803 17.978C11.606 17.894 11.426 17.785 11.262 17.649L10.766 17.236C10.606 17.103 10.46 16.956 10.329 16.796L10.066 16.474C9.934 16.313 9.823 16.139 9.732 15.953L9.531 15.545C9.435 15.349 9.373 15.142 9.345 14.925L9.253 14.194ZM10.765 13.482C10.742 13.678 10.743 13.875 10.769 14.071L10.819 14.465C10.844 14.661 10.906 14.845 11.004 15.018L11.41 15.73C11.475 15.844 11.557 15.946 11.656 16.035L11.852 16.212C11.95 16.3 12.059 16.374 12.177 16.434L12.717 16.703C12.893 16.791 13.08 16.846 13.277 16.867L13.67 16.909C13.866 16.929 14.062 16.921 14.256 16.884L14.652 16.809C14.848 16.771 15.03 16.698 15.198 16.588L15.654 16.287C15.838 16.165 15.999 16.019 16.137 15.849L16.413 15.507C16.551 15.336 16.651 15.145 16.711 14.933L16.924 14.181C17 13.911 17 13.642 16.923 13.373L16.665 12.476C16.631 12.36 16.581 12.254 16.513 12.156L16.376 11.959C16.307 11.861 16.225 11.776 16.13 11.704L15.187 10.992C15.027 10.871 14.848 10.792 14.652 10.754L14.256 10.678C14.062 10.64 13.866 10.633 13.67 10.657L13.277 10.705C13.08 10.728 12.892 10.782 12.714 10.868L12.181 11.122C12.06 11.18 11.95 11.254 11.852 11.346L11.656 11.528C11.557 11.619 11.474 11.722 11.406 11.838L10.993 12.539C10.893 12.709 10.831 12.893 10.809 13.089L10.765 13.482ZM0.034 13.918C0.004 13.824 -0.006 13.728 0.004 13.63L0.024 13.433C0.034 13.335 0.065 13.244 0.119 13.161L0.524 12.531C0.642 12.347 0.799 12.206 0.996 12.11L1.419 11.902C1.595 11.815 1.782 11.767 1.979 11.757L2.372 11.737C2.568 11.727 2.764 11.723 2.961 11.725L6.744 11.772C6.972 11.774 7.188 11.828 7.392 11.934L7.799 12.145C8.001 12.25 8.167 12.398 8.295 12.588L8.681 13.162C8.736 13.244 8.771 13.335 8.785 13.433L8.813 13.63C8.827 13.728 8.815 13.823 8.778 13.915L8.558 14.465C8.479 14.661 8.362 14.831 8.207 14.975L7.693 15.449C7.617 15.519 7.529 15.572 7.431 15.606L7.235 15.675C7.136 15.709 7.035 15.727 6.931 15.729L5.542 15.76C5.262 15.766 4.983 15.768 4.703 15.768L2.476 15.761C2.275 15.76 2.076 15.739 1.88 15.699L1.487 15.618C1.291 15.576 1.118 15.489 0.969 15.355L0.536 14.966C0.382 14.828 0.274 14.661 0.211 14.465L0.034 13.918ZM19.05 14.07C19.004 13.874 19.002 13.678 19.042 13.482L19.122 13.085C19.16 12.891 19.248 12.723 19.384 12.58L19.749 12.194C19.822 12.116 19.908 12.057 20.007 12.016L20.21 11.931C20.304 11.891 20.4 11.857 20.498 11.831L20.694 11.778C20.792 11.751 20.892 11.738 20.994 11.738L24.966 11.726C25.164 11.725 25.361 11.737 25.558 11.761L25.973 11.813C26.154 11.835 26.324 11.892 26.484 11.984L26.871 12.207C26.983 12.271 27.081 12.352 27.165 12.451L27.334 12.647C27.418 12.745 27.473 12.858 27.5 12.984L27.604 13.482C27.645 13.678 27.643 13.874 27.597 14.07L27.458 14.663C27.442 14.727 27.414 14.784 27.373 14.836L27.29 14.938C27.248 14.988 27.203 15.036 27.155 15.081L26.884 15.332C26.786 15.423 26.673 15.488 26.545 15.528L26.049 15.682C25.852 15.742 25.651 15.77 25.446 15.765L20.51 15.637C20.404 15.634 20.301 15.612 20.203 15.571L20.007 15.488C19.908 15.446 19.822 15.387 19.748 15.311L19.404 14.959C19.274 14.825 19.188 14.668 19.146 14.487L19.05 14.07ZM1.507 13.777L1.975 14.134C2.108 14.236 2.259 14.287 2.427 14.288L4.703 14.299C4.983 14.3 5.262 14.299 5.542 14.297L6.348 14.289C6.513 14.287 6.661 14.236 6.792 14.134L7.249 13.777L6.922 13.433C6.828 13.335 6.713 13.277 6.579 13.261L6.308 13.229C6.172 13.212 6.037 13.204 5.901 13.205L2.344 13.207C2.231 13.207 2.126 13.234 2.028 13.288L1.775 13.428C1.714 13.462 1.666 13.508 1.631 13.568L1.507 13.777ZM20.521 13.777L20.749 14.069C20.811 14.148 20.891 14.197 20.989 14.217L21.186 14.255C21.284 14.274 21.383 14.284 21.483 14.285L25.111 14.303C25.212 14.303 25.312 14.292 25.41 14.269L25.607 14.223C25.705 14.199 25.788 14.151 25.857 14.077L26.137 13.777L25.754 13.24L25.41 13.211C25.312 13.202 25.213 13.198 25.115 13.198L21.489 13.201C21.385 13.201 21.281 13.209 21.179 13.227L20.819 13.286L20.521 13.777ZM3.701 22.415C3.639 22.223 3.63 22.029 3.672 21.833L3.785 21.312C3.808 21.2 3.852 21.098 3.916 21.005L4.044 20.818C4.108 20.724 4.179 20.636 4.259 20.556L6.301 18.483C6.497 18.283 6.702 18.093 6.916 17.912L7.75 17.204C7.963 17.022 8.21 16.93 8.49 16.927L9.177 16.919C9.421 16.916 9.637 16.994 9.823 17.153L10.237 17.504C10.396 17.639 10.511 17.805 10.583 18.002L10.729 18.407C10.797 18.595 10.811 18.787 10.772 18.984L10.694 19.377C10.654 19.573 10.571 19.749 10.443 19.903L10.063 20.359C9.899 20.555 9.725 20.742 9.541 20.92L6.815 23.539C6.669 23.679 6.497 23.773 6.301 23.822L5.907 23.919C5.711 23.967 5.515 23.968 5.319 23.923L4.913 23.83C4.725 23.786 4.56 23.699 4.419 23.569L4.135 23.307C3.993 23.175 3.892 23.018 3.834 22.834L3.701 22.415ZM16.898 18.984C16.848 18.787 16.857 18.593 16.925 18.403L17.072 17.986C17.138 17.8 17.243 17.639 17.388 17.505L17.677 17.235C17.821 17.1 17.991 17.013 18.185 16.973L18.582 16.889C18.778 16.848 18.975 16.849 19.171 16.892L19.565 16.977C19.761 17.019 19.931 17.111 20.075 17.252L23.316 20.424C23.472 20.577 23.6 20.752 23.698 20.949L23.908 21.372C23.995 21.548 24.033 21.735 24.022 21.931L24 22.324C23.988 22.52 23.925 22.698 23.809 22.858L23.399 23.421C23.331 23.513 23.249 23.589 23.151 23.649L22.954 23.768C22.856 23.827 22.749 23.857 22.635 23.857L21.701 23.858C21.455 23.858 21.234 23.784 21.038 23.638L20.645 23.345C20.449 23.198 20.265 23.037 20.093 22.863L17.522 20.25C17.442 20.169 17.37 20.083 17.304 19.992L17.171 19.809C17.104 19.717 17.057 19.617 17.03 19.507L16.898 18.984ZM5.17 22.128L5.614 22.441L6.301 21.949C6.497 21.808 6.681 21.652 6.852 21.481L9.028 19.29C9.1 19.217 9.152 19.131 9.184 19.033L9.295 18.689L9.052 18.393L8.708 18.411C8.61 18.416 8.524 18.452 8.451 18.518L7.965 18.952C7.795 19.104 7.63 19.262 7.471 19.426L5.418 21.527C5.346 21.6 5.297 21.686 5.269 21.784L5.17 22.128ZM18.37 18.689L18.526 19.033C18.57 19.131 18.631 19.219 18.707 19.295L21.436 22.043C21.492 22.099 21.55 22.153 21.611 22.205L21.733 22.307C21.793 22.358 21.864 22.383 21.944 22.381L22.315 22.372L22.515 22.128L22.427 21.784C22.401 21.686 22.353 21.601 22.282 21.529L19.484 18.72C19.406 18.642 19.319 18.579 19.221 18.53L18.877 18.36L18.37 18.689ZM11.808 21.293C11.807 21.194 11.809 21.096 11.813 20.998L11.82 20.802C11.823 20.703 11.844 20.609 11.884 20.519L12.139 19.936C12.215 19.76 12.327 19.609 12.473 19.484L12.865 19.146C12.943 19.078 13.031 19.029 13.13 18.997L13.326 18.934C13.424 18.902 13.524 18.89 13.628 18.896L14.286 18.933C14.399 18.939 14.505 18.97 14.603 19.028L14.8 19.142C14.898 19.199 14.983 19.272 15.056 19.36L15.487 19.882C15.641 20.069 15.72 20.284 15.722 20.527L15.766 25.904C15.767 26.006 15.753 26.107 15.723 26.205L15.664 26.402C15.634 26.5 15.584 26.586 15.515 26.662L15.149 27.058C15.014 27.203 14.853 27.307 14.665 27.37L14.105 27.555C14.011 27.586 13.915 27.596 13.817 27.586L13.621 27.565C13.522 27.555 13.426 27.534 13.333 27.504L13.13 27.437C13.031 27.404 12.945 27.352 12.871 27.28L12.344 26.765C12.196 26.621 12.092 26.45 12.03 26.254L11.907 25.861C11.845 25.664 11.814 25.463 11.814 25.258L11.808 21.293ZM13.376 20.98C13.348 21.09 13.334 21.202 13.334 21.316L13.341 25.566L13.965 26.068L14.228 25.688C14.284 25.606 14.316 25.517 14.322 25.419L14.334 25.223C14.339 25.124 14.34 25.026 14.338 24.928L14.225 20.758C14.223 20.688 14.197 20.631 14.145 20.585L13.965 20.422L13.473 20.593L13.376 20.98Z' },
};

function figcraftToolbarIcon(name, size) {
  const { d, transform } = FIGCRAFT_TOOLBAR_ICONS[name];
  return jsx('svg', { width: size, height: size, viewBox: '0 0 32 32', 'aria-hidden': true, focusable: 'false',
    children: jsx('path', { d, transform, fill: 'currentColor' }) });
}

function SettingsGear() {
  return jsx('button', {
    type: 'button', className: 'ud-settings-button us-gear', 'aria-label': 'Unraid Settings',
    title: 'Unraid Settings', onClick: () => host.navigate(SETTINGS_ROUTE),
    children: figcraftToolbarIcon('gear', 18),
  });
}

function AppearanceControl({ choice, onChange }) {
  return jsx('div', {
    className: 'ud-appearance',
    role: 'group',
    'aria-label': 'Appearance mode',
    children: APPEARANCE_CHOICES.map((name) => jsx('button', {
      type: 'button',
      className: 'ud-appearance-option',
      'aria-pressed': choice === name,
      'aria-label': APPEARANCE_LABELS[name],
      title: APPEARANCE_LABELS[name],
      onClick: () => onChange(name),
      children: name === 'light' ? figcraftToolbarIcon('sun', 16) : jsx('svg', { width: 16, height: 16, viewBox: '0 0 24 24', fill: 'none', stroke: 'currentColor',
        strokeWidth: 1.6, 'aria-hidden': true, focusable: 'false', children: jsx('path', { d: APPEARANCE_ICONS[name] }) }),
    }, name)),
  });
}

function StorageSample({ palette, mode }) {
  return jsxs('div', {
    className: 'us-storage-preview', style: themeStyle(palette, mode), 'data-appearance': mode,
    children: [
      jsxs('div', { className: 'us-sample-line us-sample-top', children: [jsx('strong', { children: 'OVERVIEW' }), jsx('span', { children: 'Sample data' })] }),
      jsxs('div', { className: 'us-sample-capacity', children: [
        'Array capacity', jsx('strong', { children: '38 of 80 TB' }),
        jsx('div', { className: 'us-sample-track', 'aria-hidden': true, children: jsx('span', {}) }),
      ] }),
      jsxs('div', { className: 'us-sample-line us-sample-line-row us-sample-selected', children: [
        'Main array', jsxs('span', { className: 'us-sample-status', children: [jsx(StatusDot, { tone: 'good' }), 'Healthy'] }),
      ] }),
      jsxs('div', { className: 'us-sample-line us-sample-line-row', children: [jsx('span', { children: 'Docker' }), jsx('span', { children: '8 running' })] }),
      jsx('div', { className: 'us-sample-readonly', children: 'Read-only' }),
    ],
  });
}

function ThemeMaker({ profile, palettes, resolved }) {
  const [editMode, setMode] = useState(null);
  const mode = editMode ?? (resolved === 'dark' ? 'dark' : 'light');
  const [drafts, setDrafts] = useState(() => Object.fromEntries(MODES.map((name) => [name, palettes[name] ?? PRESETS.Daybook[name]])));
  const [bases, setBases] = useState(() => Object.fromEntries(MODES.map((name) => [name,
    Object.entries(presetsFor(name)).find(([, preset]) => samePalette(palettes[name], preset))?.[0] ?? 'Daybook',
  ])));
  const [messages, setMessages] = useState({});
  const label = mode === 'dark' ? 'Dark' : 'Light';
  const draft = drafts[mode];
  const { palette, errors } = inspectPalette(draft);
  const preview = errors.length ? (palettes[mode] ?? PRESETS.Daybook[mode]) : palette;
  const replace = (next) => {
    setDrafts((current) => ({ ...current, [mode]: next }));
    setMessages((current) => ({ ...current, [mode]: '' }));
  };
  const change = (field, value) => {
    setDrafts((current) => ({ ...current, [mode]: { ...current[mode], [field]: value } }));
    setMessages((current) => ({ ...current, [mode]: '' }));
  };
  const apply = () => {
    if (errors.length) return;
    const ok = paletteStore.save(profile, mode, draft);
    setMessages((current) => ({ ...current, [mode]: ok ? `${label} palette saved for Unraid.${resolved === mode ? '' : ' Your appearance mode has not changed.'}` : 'Palette was not saved. Local storage may be unavailable.' }));
  };
  return jsxs('section', { className: 'us-section us-palette-row', children: [
    jsxs('div', { children: [jsx('h3', { children: 'Color palette' }), jsx('p', { children: 'Pick a preset or make a palette just for the Unraid plugin.' })] }),
    jsxs('details', { className: 'us-maker', children: [
      jsx('summary', { className: 'ud-settings-button', children: 'Theme Maker' }),
      jsxs('div', { className: 'us-editor', children: [
        jsxs('header', { className: 'us-editor-top', children: [
          jsx('h3', { children: 'Theme Maker' }),
          jsxs('label', { className: 'us-editor-mode', children: ['Editing palette for', jsxs('select', {
            'aria-label': 'Edit palette', value: mode,
            onChange: (event) => { if (MODES.includes(event.target.value)) setMode(event.target.value); },
            children: [jsx('option', { value: 'light', children: 'Light appearance' }), jsx('option', { value: 'dark', children: 'Dark appearance' })],
          })] }),
        ] }),
        jsxs('div', { className: 'us-editor-grid', children: [
          jsxs('div', { children: [
            jsx('h3', { children: 'Start from a preset' }),
            jsx('div', { className: 'us-presets', role: 'group', 'aria-label': 'Palette presets', children: Object.entries(presetsFor(mode)).map(([name, preset]) => {
              return jsxs('button', {
                type: 'button', className: 'ud-settings-button', 'aria-label': name,
                'aria-pressed': !errors.length && samePalette(palette, preset),
                onClick: () => { setBases((current) => ({ ...current, [mode]: name })); replace(preset); },
                children: [jsx('span', { className: 'us-swatch-dots', 'aria-hidden': true, children: ['panel', 'accent', 'selected'].map((key) => jsx('span', { style: { background: preset[key] } }, key)) }), name],
              }, name);
            }) }),
            ...Object.entries(PALETTE_FIELDS).map(([key, name]) => jsxs('div', { className: 'us-field', children: [
              jsx('span', { children: name }),
              jsx('input', { type: 'color', 'aria-label': `${label} ${name} swatch`, value: (hexColor(draft[key]) ?? preview[key]).toLowerCase(), onChange: (event) => change(key, event.target.value.toUpperCase()) }),
              jsx('input', { type: 'text', 'aria-label': `${label} ${name} hex`, 'aria-invalid': !hexColor(draft[key]), value: draft[key], maxLength: 7, spellCheck: false, autoComplete: 'off', onChange: (event) => change(key, event.target.value) }),
            ] }, key)),
          ] }),
          jsxs('section', { 'aria-label': 'Fictional storage preview', children: [
            jsx('h3', { children: 'Storage preview' }), jsx(StorageSample, { palette: preview, mode }),
            jsxs('div', { className: 'us-check', 'aria-live': 'polite', children: errors.length ? [
              jsx('strong', { children: 'Not ready to apply. Preview uses the saved palette or Daybook.' }),
              jsx('ul', { children: errors.map((error) => jsx('li', { children: error }, error)) }),
            ] : [jsx('strong', { children: 'Preview text passes contrast checks' }), jsx('p', { children: isAnunnaki(preview, mode) ? 'Healthy, warning, and alert colors stay distinct.' : 'Status colors stay the same.' })] }),
          ] }),
        ] }),
        jsxs('div', { className: 'us-editor-actions', children: [
          jsx('p', { children: 'Applies colors only for this Desktop profile. Connection settings stay unchanged.' }),
          jsxs('div', { children: [
            jsx('button', { type: 'button', className: 'ud-settings-button', onClick: () => replace(presetsFor(mode)[bases[mode]]), children: 'Reset to preset' }),
            jsx('button', { type: 'button', className: 'ud-settings-button us-apply', disabled: errors.length > 0, onClick: apply, children: `Apply to ${label}` }),
          ] }),
        ] }),
        jsx('div', { className: 'us-result', role: 'status', children: messages[mode] || null }),
      ] }),
    ] }),
  ] });
}

function UnraidSettingsPage() {
  const { choice, resolved, choose } = useAppearance();
  const { profile, palettes } = usePalettes();
  const custom = palettes[resolved];
  return jsxs('section', {
    className: 'unraid-deck unraid-settings', 'data-appearance': resolved, 'aria-label': 'Unraid Settings',
    'data-custom-palette': custom ? 'true' : undefined,
    'data-preset': isAnunnaki(custom, resolved) ? 'anunnaki' : undefined, style: themeStyle(custom, resolved),
    children: [
      jsx('style', { children: DECK_CSS + SETTINGS_BUTTON_CSS + SETTINGS_CSS + THEME_MAKER_CSS + CUSTOM_STATUS_CSS + ANUNNAKI_CSS }),
      jsxs('div', {
        className: 'us-content', children: [
          jsxs('div', { className: 'us-brand', children: [jsx('strong', { children: 'Unraid' }), jsx('span', { children: `v${PLUGIN_VERSION}` })] }),
          jsxs('header', {
            className: 'us-section us-heading us-intro', children: [
              jsxs('div', { children: [jsx('h1', { children: 'Settings' }), jsx('p', { children: 'Set up read-only monitoring and personalize the dashboard.' })] }),
              jsx('button', { type: 'button', className: 'ud-settings-button', 'aria-label': 'Back to Unraid dashboard', onClick: () => host.navigate(ROUTE), children: '‹ Dashboard' }),
            ],
          }),
          jsxs('section', {
            className: 'us-section', children: [
              jsxs('div', {
                className: 'us-heading', children: [
                  jsxs('div', { children: [jsx('h2', { children: 'Connections' }), jsx('p', { children: 'Edit connection details and API keys in Agent settings for the selected profile.' })] }),
                  // No profile parameter: keep the scope already selected in Hermes Settings.
                  jsx('button', { type: 'button', className: 'ud-settings-button', onClick: () => host.navigate(AGENT_SETTINGS_ROUTE), children: 'Open Agent settings' }),
                ],
              }),
              jsxs('div', {
                className: 'us-connections', children: [
                  jsxs('div', { className: 'us-connection', children: [jsx('h3', { children: 'Unraid server' }), jsx('p', { children: 'Use the /graphql endpoint and a dedicated read-only Viewer API key.' })] }),
                  jsxs('div', { className: 'us-connection', children: [jsx('h3', { children: 'Transport' }), jsx('p', { children: 'Use HTTPS by default. Plain HTTP is off by default; enable it only on a trusted private LAN when HTTPS is unavailable.' })] }),
                ],
              }),
            ],
          }),
          jsxs('section', {
            className: 'us-section us-heading', children: [
              jsxs('div', { children: [jsx('h2', { children: 'Appearance' }), jsx('p', { children: 'Match Desktop uses the Hermes Desktop theme. System follows your device.' })] }),
              jsx(AppearanceControl, { choice, onChange: choose }),
            ],
          }),
          jsx(ThemeMaker, { profile, palettes, resolved }, profile),
        ],
      }),
    ],
  });
}

function ArrayCapacityCard({ array, onOpen }) {
  const capacity = array?.capacity?.kilobytes;
  const percent = capacityPercent(capacity);
  return jsxs('article', {
    className: 'ud-card ud-card-featured',
    children: [
      jsxs('div', {
        className: 'ud-card-head',
        children: [
          jsx('h3', { className: 'ud-card-title', children: 'Array' }),
          jsx('span', { className: 'ud-badge', children: displayState(array?.state) }),
        ],
      }),
      jsxs('div', {
        className: 'ud-card-body',
        children: [
          jsx('div', { className: 'ud-figure', children: formatBytesFromKb(capacity?.used) }),
          jsx('div', { className: 'ud-figure-sub', children: `of ${formatBytesFromKb(capacity?.total)} used` }),
          jsx(ProgressBar, { value: percent, label: 'Array capacity used' }),
          jsxs('div', {
            className: 'ud-card-foot ud-split-foot',
            children: [
              jsx('span', { children: percent == null ? 'Usage unknown' : `${numberText(percent, 1)}% used` }),
              jsx('span', { children: `${formatBytesFromKb(capacity?.free)} free` }),
            ],
          }),
          jsx('button', {
            type: 'button',
            className: 'ud-linkbtn',
            style: { color: 'var(--ud-on-featured)' },
            onClick: onOpen,
            children: 'Details in Array →',
          }),
        ],
      }),
    ],
  });
}

function ParityCard({ array, onOpen }) {
  const status = array?.parityCheckStatus;
  const label = parityLabel(status);
  const detail = parityDetail(status);
  return jsxs('article', {
    className: 'ud-card',
    children: [
      jsx('h3', { className: 'ud-card-title', children: 'Parity check' }),
      jsxs('div', {
        className: 'ud-card-body',
        children: [
          jsx('div', { className: 'ud-figure-value', children: label || 'Unknown' }),
          jsx('div', { className: 'ud-card-sub', children: detail || 'No parity status reported.' }),
        ],
      }),
      jsx('div', { className: 'ud-divider' }),
      jsx('button', { type: 'button', className: 'ud-linkbtn', onClick: onOpen, children: 'Details in Array →' }),
    ],
  });
}

function reportedText(value) {
  return typeof value === 'string' ? value.trim() : '';
}

function overviewNumber(value) {
  if (typeof value === 'string' && /^\d+(?:\.\d+)?$/.test(value.trim())) value = Number(value);
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

function byteCount(value) {
  if (typeof value === 'string' && /^\d+$/.test(value.trim())) value = Number(value);
  return Number.isSafeInteger(value) && value >= 0 ? value : null;
}

function ramCapacity(bytes) {
  const units = ['B', 'KiB', 'MiB', 'GiB', 'TiB'];
  let amount = bytes;
  let index = 0;
  while (amount >= 1024 && index < units.length - 1) { amount /= 1024; index++; }
  return `${numberText(amount, 1)} ${units[index]}`;
}

function joinedIdentity(maker, name) {
  const prefix = reportedText(maker);
  const suffix = reportedText(name);
  if (!prefix || !suffix || suffix.toLowerCase() === prefix.toLowerCase() || suffix.toLowerCase().startsWith(`${prefix.toLowerCase()} `)) return suffix || prefix;
  return `${prefix} ${suffix}`;
}

function MotherboardProcessorCard({ inventory, coreSystem, coreCpu, load }) {
  const board = inventory?.baseboard;
  const cpu = inventory?.cpu;
  const boardModel = reportedText(board?.model);
  // Some servers expose the board identity only as the system model in /overview.
  const boardName = boardModel ? joinedIdentity(board?.manufacturer, boardModel) : reportedText(coreSystem?.model);
  const cpuName = joinedIdentity(reportedText(cpu?.manufacturer) || reportedText(cpu?.vendor) || coreCpu?.manufacturer, reportedText(cpu?.brand) || coreCpu?.brand);
  const positiveCount = (value) => {
    const count = overviewNumber(value);
    return Number.isSafeInteger(count) && count > 0 ? count : null;
  };
  const cores = positiveCount(cpu?.cores) ?? positiveCount(coreCpu?.cores);
  const threads = positiveCount(cpu?.threads);
  const ghz = overviewNumber(cpu?.speed);
  const usage = overviewNumber(load);
  const specs = [
    cores ? `${cores} ${cores === 1 ? 'core' : 'cores'}` : null,
    threads ? `${threads} ${threads === 1 ? 'thread' : 'threads'}` : null,
    ghz > 0 ? `${numberText(ghz, 2)} GHz` : null,
  ].filter(Boolean).join(' · ');
  return jsxs('article', {
    className: 'ud-card',
    children: [
      jsx('h4', { className: 'ud-card-title', children: 'Motherboard / Processor' }),
      jsxs('dl', { className: 'ud-board-facts', children: [
        jsxs('div', { children: [jsx('dt', { children: 'Motherboard' }), jsx('dd', { children: boardName || 'Not reported' })] }),
        jsxs('div', { children: [jsx('dt', { children: 'Processor' }), jsx('dd', { children: cpuName || 'Not reported' }), specs ? jsx('dd', { className: 'ud-cpu-specs', children: specs }) : null] }),
        jsxs('div', { children: [jsx('dt', { children: 'CPU load' }), jsx('dd', { children: usage != null && usage >= 0 && usage <= 100 ? percentText(usage) : 'Not reported' })] }),
      ] }),
    ],
  });
}

function memoryInventory(info, usable) {
  const dimms = info?.memory?.layout;
  const sizes = Array.isArray(dimms) ? dimms.map((module) => byteCount(module?.size)) : [];
  const sum = sizes.length && sizes.every((size) => size > 0) ? sizes.reduce((a, b) => a + b, 0) : 0;
  const installed = Number.isSafeInteger(sum) && sum > 0 && sum >= (usable ?? 0) ? sum : null;
  const types = installed ? new Set(dimms.map((module) => reportedText(module?.type).toUpperCase())) : new Set();
  const type = types.size === 1 ? [...types][0] : '';
  const ddr = /^(?:LP)?DDR[2-6]X?$/.test(type) ? type : '';
  const limit = byteCount(info?.baseboard?.memMax);
  return { installed, ddr, boardMax: limit > 0 && limit >= Math.max(usable ?? 0, installed ?? 0) ? limit : null };
}

function SystemMemoryCard({ readings, inventory }) {
  const total = byteCount(readings?.total);
  const available = byteCount(readings?.available);
  const valid = total > 0 && available != null && available <= total;
  const { installed, ddr, boardMax } = memoryInventory(inventory, total);
  const footer = [valid ? `${ramCapacity(total)} usable` : null, boardMax ? `${ramCapacity(boardMax)} max (board reported)` : null].filter(Boolean).join(' · ');
  const inUse = valid ? total - available : null;
  const percent = valid ? inUse / total * 100 : null;
  const rounded = Math.round(percent);
  const percentLabel = percent > 0 && rounded === 0 ? '<1%' : percent < 100 && rounded === 100 ? '>99%' : `${rounded}%`;
  return jsxs('article', {
    className: 'ud-card',
    children: [
      jsx('h4', { className: 'ud-card-title', children: 'System Memory' }),
      installed ? jsx('p', { className: 'ud-card-sub', children: `${ramCapacity(installed)}${ddr ? ` ${ddr}` : ''} installed` }) : null,
      valid ? jsxs('div', { className: 'ud-memory-body', children: [
        jsx('div', {
          className: 'ud-memory-ring', role: 'meter', 'aria-label': 'System memory in use',
          'aria-valuemin': 0, 'aria-valuemax': 100, 'aria-valuenow': percent,
          'aria-valuetext': `${percentLabel} in use`, style: { '--ud-memory-used': `${percent}%` },
          children: jsxs('span', { children: [jsx('strong', { children: percentLabel }), 'in use'] }),
        }),
        jsxs('dl', { className: 'ud-memory-legend', children: [
          jsxs('div', { children: [jsxs('dt', { children: [jsx('i', { 'aria-hidden': true }), 'In use'] }), jsx('dd', { children: ramCapacity(inUse) })] }),
          jsxs('div', { children: [jsxs('dt', { children: [jsx('i', { 'aria-hidden': true }), 'Available'] }), jsx('dd', { children: ramCapacity(available) })] }),
        ] }),
      ] }) : jsx('p', { className: 'ud-empty', children: 'Memory readings unavailable' }),
      footer ? jsx('p', { className: 'ud-memory-footer', children: footer }) : null,
    ],
  });
}

function NotificationsCard({ summary }) {
  const alerts = summary?.alert == null ? null : Number(summary.alert);
  const warnings = summary?.warning == null ? null : Number(summary.warning);
  const total = summary?.total == null ? null : Number(summary.total);
  return jsxs('article', {
    className: 'ud-card',
    children: [
      jsx('h3', { className: 'ud-card-title', children: 'Notifications' }),
      jsxs('div', {
        className: 'ud-pair',
        children: [
          jsxs('div', {
            className: 'ud-pair-cell ud-pair-alert',
            children: [jsx('span', { className: 'ud-pair-value', children: alerts == null ? 'Unknown' : numberText(alerts, 0) }), jsx('span', { className: 'ud-pair-label', children: 'alerts' })],
          }),
          jsxs('div', {
            className: 'ud-pair-cell ud-pair-warn',
            children: [jsx('span', { className: 'ud-pair-value', children: warnings == null ? 'Unknown' : numberText(warnings, 0) }), jsx('span', { className: 'ud-pair-label', children: 'warnings' })],
          }),
        ],
      }),
      jsx('div', { className: 'ud-divider' }),
      jsx('div', { className: 'ud-card-sub', children: total == null ? 'Unread totals unavailable' : `${numberText(total, 0)} total unread` }),
    ],
  });
}

function StorageDeviceRows({ disks, limit }) {
  const visible = limit ? (disks || []).slice(0, limit) : disks || [];
  return jsxs('div', {
    className: 'ud-table',
    children: [
      jsxs('div', {
        className: 'ud-table-head',
        children: ['DEVICE', 'TEMP', 'ERRORS', 'STATE'].map((label) => jsx('span', { children: label }, label)),
      }, 'head'),
      ...visible.map((disk, index) => {
        // isSpinning === false is the API telling us the drive is spun down, so a
        // missing temperature is expected, not unknown. Any other case (spinning,
        // or the field absent) keeps the honest "Unknown" - never inferred.
        const asleep = disk.isSpinning === false && disk.temp == null;
        const temp = disk.temp != null ? `${disk.temp}°C` : asleep ? 'Zzz · Asleep' : 'Unknown';
        return jsxs('div', {
          className: 'ud-table-row',
          children: [
            jsxs('div', {
              className: 'ud-device',
              children: [
                jsx('div', { className: 'ud-device-name', children: disk.name || disk.device || 'Disk' }),
                jsx('div', { className: 'ud-device-sub', children: `${disk.device || 'unknown device'} · ${disk.type || 'disk'}` }),
              ],
            }),
            jsx('div', {
              className: asleep ? 'ud-cell-num ud-cell-asleep' : 'ud-cell-num',
              'aria-label': asleep ? 'Spun down' : undefined,
              title: asleep ? 'Spun down' : undefined,
              children: temp,
            }),
            jsx('div', { className: 'ud-cell-num', children: disk.numErrors == null ? 'Unknown' : `${disk.numErrors}` }),
            jsx(StateLabel, { value: disk.status }),
          ],
        }, disk.id || disk.name || `disk-${index}`);
      }),
    ],
  });
}

function StoragePreviewCard({ disks, onOpen }) {
  const known = Array.isArray(disks);
  const list = known ? disks : [];
  return jsxs('article', {
    className: 'ud-card',
    children: [
      jsxs('div', {
        className: 'ud-card-head',
        children: [
          jsx('h3', { className: 'ud-card-title', children: 'Storage devices' }),
          jsx('span', { className: 'ud-card-sub', children: known ? `${list.length} reported` : 'Storage unavailable' }),
        ],
      }),
      !known
        ? jsx('div', { className: 'ud-empty', children: 'Device details are unavailable.' })
        : list.length
          ? jsx(StorageDeviceRows, { disks: list, limit: 4 })
          : jsx('div', { className: 'ud-empty', children: 'No storage devices were returned.' }),
      jsx('div', {
        className: 'ud-card-foot',
        children: jsx('button', {
          type: 'button',
          className: 'ud-linkbtn',
          onClick: onOpen,
          children: list.length > 4 ? `Showing 4 of ${list.length} · View all in Array →` : 'View all in Array →',
        }),
      }),
    ],
  });
}

function DockerPreviewCard({ containers, loading, onOpen }) {
  const visible = containers?.slice(0, 3) || [];
  return jsxs('article', {
    className: 'ud-card',
    children: [
      jsxs('div', {
        className: 'ud-card-head',
        children: [
          jsxs('div', {
            children: [jsx('h3', { className: 'ud-card-title', children: 'Docker' }), jsx('div', { className: 'ud-card-sub', children: 'Container status' })],
          }),
          containers ? jsx('span', { className: 'ud-card-sub', children: `${containers.length} reported` }) : null,
        ],
      }),
      visible.length
        ? jsx('div', {
            className: 'ud-list',
            children: visible.map((container, index) => {
              const name = container.names?.[0]?.replace(/^\//, '') || container.image || 'Container';
              const tone = toneForState(container.state);
              return jsxs('div', {
                className: 'ud-list-row',
                children: [
                  jsxs('div', {
                    className: 'ud-list-main',
                    children: [
                      jsx(StatusDot, { tone }),
                      jsxs('div', {
                        children: [
                          jsx('div', { className: 'ud-list-name', children: name }),
                          jsx('div', { className: 'ud-list-sub', children: container.lanIpPorts?.[0] || container.status || 'No endpoint returned' }),
                        ],
                      }),
                    ],
                  }),
                  jsx('span', { className: 'ud-list-state', style: { color: toneColor(tone) }, children: displayState(container.state) }),
                ],
              }, container.id || `${name}-${index}`);
            }),
          })
        : jsx('div', {
            className: 'ud-empty',
            children: containers ? 'No Docker containers were returned.' : loading ? 'Loading Docker containers…' : 'Docker container count unavailable.',
          }),
      jsx('div', { className: 'ud-card-foot', children: jsx('button', {
        type: 'button', className: 'ud-linkbtn', onClick: onOpen,
        children: containers && containers.length > visible.length
          ? `Showing ${visible.length} of ${containers.length} · View Docker →` : 'View Docker →',
      }) }),
    ],
  });
}

function AttentionCard({ groups, summary, onOpen }) {
  const visible = (groups || []).slice(0, 3);
  return jsxs('article', {
    className: 'ud-card',
    children: [
      jsx('div', {
        className: 'ud-card-head',
        children: jsxs('div', {
          children: [jsx('h3', { className: 'ud-card-title', children: 'Needs attention' }), jsx('div', { className: 'ud-card-sub', children: 'Grouped unread notifications' })],
        }),
      }),
      visible.length
        ? jsx('div', {
            className: 'ud-list',
            children: visible.map((item, index) => jsxs('div', {
              className: 'ud-list-row',
              children: [
                jsxs('div', {
                  children: [
                    jsx('div', { className: 'ud-list-name', children: item.title }),
                    jsx('div', { className: 'ud-list-sub', children: item.count > 1 ? `${item.count} occurrences` : item.description }),
                  ],
                }),
                jsx('span', {
                  className: 'ud-list-state',
                  style: { color: item.tone === 'bad' ? 'var(--ud-alert)' : 'var(--ud-warn)' },
                  children: item.label.toUpperCase(),
                }),
              ],
            }, item.id || `${item.title}-${index}`)),
          })
        : jsx('div', { className: 'ud-empty', children: 'No unread warnings or alerts.' }),
      jsx('div', {
        className: 'ud-card-foot',
        children: jsx('button', { type: 'button', className: 'ud-linkbtn', onClick: onOpen, children: 'View all alerts →' }),
      }),
    ],
  });
}

function OverviewView({ overview, inventory, array, disks, containers, dockerLoading, alertGroups, alertSummary, onTab }) {
  const info = overview?.info;
  const metrics = overview?.metrics;
  const hostname = reportedText(inventory?.os?.hostname);
  const version = /^v?(\d[\w.+-]*)$/i.exec(reportedText(info?.versions?.core?.unraid))?.[1];
  const server = [hostname, version ? `Unraid v${version}` : null].filter(Boolean).join(' · ') || 'Unraid server';

  return jsxs('section', {
    className: 'ud-page',
    children: [
      jsx('h2', { className: 'ud-page-title ud-overview-header', children: server }),
      jsxs('div', {
        className: 'ud-grid-3 ud-overview-summary',
        children: [
          jsx(ArrayCapacityCard, { array, onOpen: () => onTab('array') }),
          jsx(ParityCard, { array, onOpen: () => onTab('array') }),
          jsx(NotificationsCard, { summary: alertSummary }),
        ],
      }),
      jsxs('section', { className: 'ud-system', 'aria-label': 'System', children: [
        jsx('h3', { className: 'ud-system-heading', children: 'System' }),
        jsxs('div', { className: 'ud-grid-2', children: [
          jsx(MotherboardProcessorCard, { inventory, coreSystem: info?.system, coreCpu: info?.cpu, load: metrics?.cpu?.percentTotal }),
          jsx(SystemMemoryCard, { readings: metrics?.memory, inventory }),
        ] }),
      ] }),
      jsxs('div', {
        className: 'ud-grid-3',
        children: [
          jsx(StoragePreviewCard, { disks, onOpen: () => onTab('array') }),
          jsx(DockerPreviewCard, { containers, loading: dockerLoading, onOpen: () => onTab('docker') }),
          jsx(AttentionCard, { groups: alertGroups, summary: alertSummary, onOpen: () => onTab('alerts') }),
        ],
      }),
    ],
  });
}

function ArrayView({ payload }) {
  const array = payload?.data?.array;
  if (!array) {
    return jsx('div', { className: 'ud-notice', children: jsx('p', { children: 'Array data is unavailable on this API version or key.' }) });
  }
  const capacity = array.capacity?.kilobytes;
  const disks = array.disks || [];
  return jsxs('section', {
    className: 'ud-page',
    children: [
      jsxs('div', {
        className: 'ud-page-head',
        children: [
          jsxs('div', {
            children: [
              jsx('h2', { className: 'ud-page-title', children: 'Array and pools' }),
              jsx('p', { className: 'ud-page-sub', children: `${disks.length} storage devices` }),
            ],
          }),
          jsx('span', { className: 'ud-page-label', children: 'Storage' }),
        ],
      }),
      jsxs('div', {
        className: 'ud-grid-4',
        children: [
          jsxs('article', {
            className: 'ud-metric',
            children: [jsx('span', { className: 'ud-metric-label', children: 'Array state' }), jsx('span', { className: 'ud-metric-value', children: displayState(array.state) }), jsx('span', { className: 'ud-metric-sub', children: 'Reported by the API' })],
          }),
          jsxs('article', {
            className: 'ud-metric',
            children: [jsx('span', { className: 'ud-metric-label', children: 'Used' }), jsx('span', { className: 'ud-metric-value', children: formatBytesFromKb(capacity?.used) }), jsx('span', { className: 'ud-metric-sub', children: `of ${formatBytesFromKb(capacity?.total)}` })],
          }),
          jsxs('article', {
            className: 'ud-metric',
            children: [jsx('span', { className: 'ud-metric-label', children: 'Free' }), jsx('span', { className: 'ud-metric-value', children: formatBytesFromKb(capacity?.free) }), jsx('span', { className: 'ud-metric-sub', children: 'Remaining capacity' })],
          }),
          jsxs('article', {
            className: 'ud-metric',
            children: [jsx('span', { className: 'ud-metric-label', children: 'Parity' }), jsx('span', { className: 'ud-metric-value', children: parityLabel(array.parityCheckStatus) || 'Unknown' }), jsx('span', { className: 'ud-metric-sub', children: parityDetail(array.parityCheckStatus) || 'No parity status reported.' })],
          }),
        ],
      }),
      jsxs('article', {
        className: 'ud-card',
        children: [
          jsxs('div', {
            className: 'ud-card-head',
            children: [
              jsx('h3', { className: 'ud-card-title', children: 'Storage devices' }),
              jsx('span', { className: 'ud-card-sub', children: `${disks.length} reported` }),
            ],
          }),
          disks.length
            ? jsx(StorageDeviceRows, { disks })
            : jsx('div', { className: 'ud-empty', children: 'No storage devices were returned.' }),
        ],
      }),
    ],
  });
}

function DockerView({ payload }) {
  const containers = payload?.data?.docker?.containers || [];
  const [filter, setFilter] = useState('all');
  const filtered = containers.filter((container) => filter === 'all' || (filter === 'running' ? container.state === 'RUNNING' : container.state !== 'RUNNING'));
  const running = containers.filter((container) => container.state === 'RUNNING').length;
  return jsxs('section', {
    className: 'ud-page',
    children: [
      jsxs('div', {
        className: 'ud-page-head',
        children: [
          jsxs('div', {
            children: [
              jsx('h2', { className: 'ud-page-title', children: 'Docker' }),
              jsx('p', { className: 'ud-page-sub', children: `${running} running · ${containers.length - running} not running` }),
            ],
          }),
          jsx('div', {
            className: 'ud-filters',
            children: ['all', 'running', 'stopped'].map((name) => jsx('button', {
              type: 'button',
              className: 'ud-chip',
              'aria-pressed': filter === name,
              onClick: () => setFilter(name),
              children: name[0].toUpperCase() + name.slice(1),
            }, name)),
          }),
        ],
      }),
      filtered.length
        ? jsx('div', {
            className: 'ud-card',
            children: filtered.map((container, index) => {
              const name = container.names?.[0]?.replace(/^\//, '') || container.image || 'Container';
              return jsxs('div', {
                className: 'ud-detail-row ud-utility-row',
                children: [
                  jsxs('div', {
                    children: [
                      jsx('div', { className: 'ud-device-name', children: name }),
                      jsx('div', { className: 'ud-device-sub', children: container.image || 'Image unavailable' }),
                    ],
                  }),
                  jsx('div', { className: 'ud-device-sub', children: container.lanIpPorts?.join(' · ') || container.status || 'No published endpoint' }),
                  jsx(StateLabel, { value: container.state }),
                ],
              }, container.id || `${name}-${index}`);
            }),
          })
        : jsx('div', { className: 'ud-notice', children: jsx('p', { children: containers.length ? 'No containers match this filter.' : 'No Docker containers were returned.' }) }),
    ],
  });
}

function VmView({ payload }) {
  const domains = payload?.data?.vms?.domains || [];
  return jsxs('section', {
    className: 'ud-page',
    children: [
      jsxs('div', {
        className: 'ud-page-head',
        children: [
          jsxs('div', {
            children: [
              jsx('h2', { className: 'ud-page-title', children: 'Virtual machines' }),
              jsx('p', { className: 'ud-page-sub', children: `${domains.length} ${domains.length === 1 ? 'VM' : 'VMs'}` }),
            ],
          }),
          jsx('span', { className: 'ud-page-label', children: 'Virtualization' }),
        ],
      }),
      domains.length
        ? jsx('div', {
            className: 'ud-card',
            children: domains.map((vm, index) => jsxs('div', {
              className: 'ud-detail-row ud-utility-row',
              children: [
                jsx('div', { className: 'ud-device-name', children: vm.name || 'Virtual machine' }),
                jsx('div', { className: 'ud-device-sub', children: 'Virtual machine' }),
                jsx(StateLabel, { value: vm.state }),
              ],
            }, vm.id || vm.name || `vm-${index}`)),
          })
        : jsx('div', { className: 'ud-notice', children: jsx('p', { children: 'No virtual machines were returned.' }) }),
    ],
  });
}

function AlertView({ groups, summary }) {
  return jsxs('section', {
    className: 'ud-page',
    children: [
      jsxs('div', {
        className: 'ud-page-head',
        children: [
          jsxs('div', {
            children: [
              jsx('h2', { className: 'ud-page-title', children: 'Notifications requiring attention' }),
              jsx('p', { className: 'ud-page-sub', children: summary ? `${summary.alert || 0} alerts · ${summary.warning || 0} warnings` : 'Unread severity totals unavailable' }),
            ],
          }),
          jsx('span', { className: 'ud-page-label', children: 'Grouped by severity' }),
        ],
      }),
      groups.length
        ? jsx('div', {
            className: 'ud-card',
            children: groups.map((item, index) => jsxs('div', {
              className: 'ud-detail-row',
              style: { gridTemplateColumns: 'auto minmax(0,1fr)' },
              children: [
                jsx(StatusPill, { tone: item.tone, children: item.label }),
                jsxs('div', {
                  children: [
                    jsxs('div', { className: 'ud-device-name', children: [item.title, item.count > 1 ? ` · ${item.count} occurrences` : null].filter(Boolean) }),
                    jsx('div', { className: 'ud-device-sub', children: item.description }),
                    item.timestamp ? jsx('div', { className: 'ud-device-sub', children: formatTimestamp(item.timestamp) }) : null,
                  ].filter(Boolean),
                }),
              ],
            }, item.id || `${item.title}-${index}`)),
          })
        : jsx('div', { className: 'ud-notice', children: jsx('p', { children: 'No unread warnings or alerts.' }) }),
    ],
  });
}

function UnraidPage() {
  const { choice, resolved, choose } = useAppearance();
  const { palettes } = usePalettes();
  const custom = palettes[resolved];
  const health = useEndpoint('/health', true, 30000);
  const configured = Boolean(health.data?.configured);
  const overview = useEndpoint('/overview', configured, 15000);
  const arrayData = useEndpoint('/array', configured, 30000);
  const docker = useEndpoint('/docker', configured, 15000);
  const vms = useEndpoint('/vms', configured, 15000);
  const alerts = useEndpoint('/notifications', configured, 15000);
  const [tab, setTab] = useState('overview');
  const [refreshing, setRefreshing] = useState(false);
  // Optional inventory can fail on older APIs or narrower keys. Keep it out
  // of the core connection and loading state, with no additional polling.
  const hardware = useEndpoint('/hardware', configured && tab === 'overview', 0);
  const inventory = hardware.error ? null : hardware.data?.data?.info;

  const refreshAll = useCallback(async () => {
    if (refreshing) return;
    setRefreshing(true);
    try {
      const tasks = [health.refresh()];
      if (configured) tasks.push(overview.refresh(), arrayData.refresh(), docker.refresh(), vms.refresh(), alerts.refresh());
      if (configured && tab === 'overview') tasks.push(hardware.refresh());
      await Promise.all(tasks);
    } finally {
      setRefreshing(false);
    }
  }, [refreshing, configured, tab, health.refresh, overview.refresh, arrayData.refresh, docker.refresh, vms.refresh, alerts.refresh, hardware.refresh]);

  const anyError = health.error || overview.error || arrayData.error || docker.error || vms.error || alerts.error;
  const overviewData = overview.data?.data;
  const overviewArray = overviewData?.array;
  const arrayPayload = arrayData.data?.data?.array;
  // Aggregates (state/capacity/parity) come from the overview query; the disk
  // records come from /array. Never let a disk-less overview object mask them.
  const array = overviewArray || arrayPayload;
  const storageDisks = resolveArrayDisks(overviewArray, arrayPayload);
  const reportedContainers = docker.data?.data?.docker?.containers;
  // A failed refresh may retain old data. Don't present a stale count as current.
  const containers = !docker.error && Array.isArray(reportedContainers) ? reportedContainers : null;
  const alertItems = alerts.data?.data?.notifications?.warningsAndAlerts || overviewData?.notifications?.warningsAndAlerts || [];
  const alertGroups = useMemo(() => groupAlerts(alertItems), [alertItems]);
  const alertSummary = alerts.data?.data?.notifications?.overview?.unread || overviewData?.notifications?.overview?.unread;
  const alertCount = attentionCount(alertSummary);
  const latestUpdate = [health, overview, arrayData, docker, vms, alerts]
    .map((entry) => entry.updatedAt)
    .filter((value) => value instanceof Date)
    .sort((a, b) => b.getTime() - a.getTime())[0];
  const initialLoading = configured && !overviewData && (overview.loading || arrayData.loading || docker.loading || vms.loading || alerts.loading);
  const tabs = ['overview', 'array', 'docker', 'vms', 'alerts'];
  const connectionTone = !configured ? 'muted' : anyError ? 'warn' : 'good';

  return jsxs('main', {
    className: 'unraid-deck',
    'data-appearance': resolved,
    'data-custom-palette': custom ? 'true' : undefined,
    'data-preset': isAnunnaki(custom, resolved) ? 'anunnaki' : undefined,
    style: themeStyle(custom, resolved),
    children: [
      jsx('style', { children: DECK_CSS + SETTINGS_BUTTON_CSS + (custom ? CUSTOM_STATUS_CSS + ANUNNAKI_CSS : '') }),
      jsxs('header', {
        className: 'ud-topbar',
        children: [
          jsxs('div', {
            className: 'ud-brand',
            children: [
              jsx('span', { className: 'ud-logo', 'aria-hidden': true, children: jsx(Codicon, { name: SERVER_ICON, size: '1.25rem' }) }),
              jsxs('div', { className: 'ud-brand-title', children: [
                jsx('h1', { className: 'ud-app-title', children: 'Hermes for Unraid' }),
                jsx('span', { className: 'ud-app-version', children: `Plugin v${PLUGIN_VERSION}` }),
              ] }),
            ],
          }),
          jsxs('div', {
            className: 'ud-topbar-actions',
            children: [
              jsxs('span', {
                className: `ud-conn ud-tone-${connectionTone}`,
                role: 'status',
                'aria-live': 'polite',
                children: [jsx(StatusDot, { tone: connectionTone }), connectionText(configured, Boolean(anyError))],
              }),
              jsx(AppearanceControl, { choice, onChange: choose }),
              jsx(Button, { className: 'ud-refresh', onClick: refreshAll, disabled: refreshing, style: { minHeight: 40 }, children: refreshing ? 'Refreshing…' : 'Refresh' }),
              typeof pluginContext?.registerSettingsPage === 'function' ? jsx(SettingsGear, {}) : null,
            ],
          }),
        ],
      }),
      jsx('nav', {
        className: 'ud-nav',
        'aria-label': 'Unraid sections',
        children: configured
          ? [
              jsx('div', {
                className: 'ud-tabs',
                role: 'tablist',
                children: tabs.map((name) => jsx('button', {
                  type: 'button',
                  role: 'tab',
                  className: 'ud-tab',
                  'aria-selected': tab === name,
                  onClick: () => setTab(name),
                  children: name === 'alerts'
                    ? jsxs(React.Fragment, { children: ['Alerts', alertCount ? jsx('span', { className: 'ud-tab-count', children: alertCount }) : null] })
                    : name === 'vms' ? 'VMs' : name[0].toUpperCase() + name.slice(1),
                }, name)),
              }, 'tabs'),
              jsx('span', { className: 'ud-nav-right', children: 'Official GraphQL API' }, 'api'),
            ]
          : jsx('span', { className: 'ud-nav-right', style: { marginLeft: 0 }, children: 'Read-only monitoring' }, 'api'),
      }),
      jsxs('div', {
        className: 'ud-body',
        children: [
          !configured && !health.loading ? jsxs('section', {
            className: 'ud-notice',
            children: [
              jsx('strong', { children: 'Connect a read-only Unraid API key' }),
              jsx('p', { children: health.data?.message || (typeof pluginContext?.registerSettingsPage === 'function'
                ? 'Open Unraid Settings, then Agent settings, to enter the server URL and API key.'
                : 'Open Settings → Plugins → Unraid to enter the server URL and API key.') }),
              jsx('p', { children: 'Use the masked API-key field, retain any custom WebGUI port in the /graphql URL, save, then return here and press Refresh.' }),
              jsx('p', { children: 'The API key is stored by the Hermes backend and is never returned to this page.' }),
            ],
          }) : null,
          anyError ? jsx('div', { className: 'ud-error', children: jsx(ErrorState, { title: 'Some Unraid data could not be loaded', description: anyError, onRetry: refreshAll }) }) : null,
          configured && initialLoading ? jsxs('div', { className: 'ud-loading', children: [jsx(GlyphSpinner, {}), 'Loading Unraid data…'] }) : null,
          configured && !initialLoading && tab === 'overview' ? jsx(OverviewView, { overview: overviewData, inventory, array, disks: storageDisks, containers, dockerLoading: docker.loading && !docker.error, alertGroups, alertSummary, onTab: setTab }) : null,
          configured && !initialLoading && tab === 'array' ? jsx(ArrayView, { payload: arrayData.data }) : null,
          configured && !initialLoading && tab === 'docker' ? jsx(DockerView, { payload: docker.data }) : null,
          configured && !initialLoading && tab === 'vms' ? jsx(VmView, { payload: vms.data }) : null,
          configured && !initialLoading && tab === 'alerts' ? jsx(AlertView, { groups: alertGroups, summary: alertSummary }) : null,
        ].filter(Boolean),
      }),
      jsxs('footer', {
        className: 'ud-footer',
        children: [
          jsxs('div', {
            className: 'ud-statusbar',
            children: [
              jsxs('span', { className: 'ud-status-slot ud-status-left', children: [jsx(StatusDot, { tone: toneForState(array?.state) }), arrayStateText(array?.state)] }),
              jsx('span', { className: 'ud-status-slot', children: parityStripText(array?.parityCheckStatus) }),
              jsx('span', { className: 'ud-status-slot ud-status-right', children: formatUpdated(latestUpdate) }),
            ],
          }),
          jsx('p', { className: 'ud-safety', children: 'Read-only safety mode · No MCP · No SSH · No GraphQL mutations' }),
        ],
      }),
    ].filter(Boolean),
  });
}

export {
  APPEARANCE_CHOICES,
  APPEARANCE_KEY,
  APPEARANCE_LABELS,
  DECK_CSS,
  SAFE_ERRORS,
  arrayStateText,
  connectionText,
  errorText,
  groupAlerts,
  parityLabel,
  parityStripText,
  readAppearance,
  resolveAppearance,
  toneForState,
  writeAppearance,
};

export default {
  id: 'unraid',
  name: 'Unraid',
  defaultEnabled: false,
  register(ctx) {
    pluginContext = ctx;
    paletteStore = createPaletteStore(ctx.storage);
    ctx.registerMany([
      { id: 'page', area: ROUTES_AREA, data: { path: ROUTE }, render: () => jsx(UnraidPage, {}) },
      { id: 'nav', area: SIDEBAR_NAV_AREA, data: { path: ROUTE, label: 'Unraid', codicon: SERVER_ICON } },
      {
        id: 'open',
        area: PALETTE_AREA,
        data: { id: 'unraid.open', label: 'Open Unraid', keywords: ['server', 'nas', 'docker'], run: () => host.navigate(ROUTE) },
      },
    ]);
    ctx.registerSettingsPage?.({ id: 'settings', title: 'Unraid', icon: 'server', render: () => jsx(UnraidSettingsPage, {}) });
  },
};
