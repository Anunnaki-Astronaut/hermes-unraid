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
const PLUGIN_VERSION = '0.3.1';
const APPEARANCE_KEY = 'unraid.appearance';
const APPEARANCE_CHOICES = ['match', 'system', 'light', 'dark'];
const APPEARANCE_LABELS = { match: 'Match Desktop', system: 'System', light: 'Light', dark: 'Dark' };
// Match the four Kalends glyphs without changing Unraid's saved mode values.
const APPEARANCE_ICONS = {
  match: 'M3 4h18v13H3z M8 21h8 M12 17v4',
  system: 'M12 3a9 9 0 1 0 0 18V3z M12 3a9 9 0 0 1 0 18',
  light: 'M12 8a4 4 0 1 0 0 8 4 4 0 0 0 0-8 M12 1v3 M12 20v3 M1 12h3 M20 12h3 M4 4l2 2 M18 18l2 2 M4 20l2-2 M18 6l2-2',
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

function themeStyle(palette) {
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

const CUSTOM_STATUS_CSS = `
/* Keep semantic markers, but use verified foreground ink for their labels on
   user-selected surfaces. This does not alter the original status tokens. */
.unraid-deck[data-custom-palette=true] :is(.ud-tone-good,.ud-tone-warn,.ud-tone-bad,.ud-pair-alert .ud-pair-value,.ud-pair-warn .ud-pair-value,.ud-list-state,.ud-pill){color:var(--ud-text)!important}
.unraid-deck[data-custom-palette=true] .ud-pill{background:var(--ud-surface-2);border-inline-start:1px solid var(--tone)}
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

function SettingsGear() {
  return jsx('button', {
    type: 'button', className: 'ud-settings-button us-gear', 'aria-label': 'Unraid Settings',
    title: 'Unraid Settings', onClick: () => host.navigate(SETTINGS_ROUTE),
    children: jsx(Codicon, { name: 'settings-gear', size: '1.125rem' }),
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
      children: jsx('svg', { width: 16, height: 16, viewBox: '0 0 24 24', fill: 'none', stroke: 'currentColor',
        strokeWidth: 1.6, 'aria-hidden': true, focusable: 'false', children: jsx('path', { d: APPEARANCE_ICONS[name] }) }),
    }, name)),
  });
}

function StorageSample({ palette, mode }) {
  return jsxs('div', {
    className: 'us-storage-preview', style: themeStyle(palette), 'data-appearance': mode,
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
    Object.keys(PRESETS).find((preset) => JSON.stringify(PRESETS[preset][name]) === JSON.stringify(palettes[name])) ?? 'Daybook',
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
            jsx('div', { className: 'us-presets', role: 'group', 'aria-label': 'Palette presets', children: Object.entries(PRESETS).map(([name, pair]) => {
              const preset = pair[mode];
              return jsxs('button', {
                type: 'button', className: 'ud-settings-button', 'aria-label': name,
                'aria-pressed': !errors.length && JSON.stringify(palette) === JSON.stringify(preset),
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
            ] : [jsx('strong', { children: 'Preview text passes contrast checks' }), jsx('p', { children: 'Status colors stay the same.' })] }),
          ] }),
        ] }),
        jsxs('div', { className: 'us-editor-actions', children: [
          jsx('p', { children: 'Applies colors only for this Desktop profile. Connection settings stay unchanged.' }),
          jsxs('div', { children: [
            jsx('button', { type: 'button', className: 'ud-settings-button', onClick: () => replace(PRESETS[bases[mode]][mode]), children: 'Reset to preset' }),
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
    'data-custom-palette': custom ? 'true' : undefined, style: themeStyle(custom),
    children: [
      jsx('style', { children: DECK_CSS + SETTINGS_BUTTON_CSS + SETTINGS_CSS + THEME_MAKER_CSS + CUSTOM_STATUS_CSS }),
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

function LoadCard({ metrics }) {
  const cpu = metrics?.cpu?.percentTotal;
  const memory = metrics?.memory?.percentTotal;
  return jsxs('article', {
    className: 'ud-card',
    children: [
      jsx('h3', { className: 'ud-card-title', children: 'Current load' }),
      jsxs('div', {
        className: 'ud-pair',
        children: [
          jsxs('div', {
            className: 'ud-pair-cell',
            children: [jsx('span', { className: 'ud-pair-value', children: percentText(cpu) }), jsx('span', { className: 'ud-pair-label', children: 'CPU' })],
          }),
          jsxs('div', {
            className: 'ud-pair-cell',
            children: [jsx('span', { className: 'ud-pair-value', children: percentText(memory) }), jsx('span', { className: 'ud-pair-label', children: 'Memory' })],
          }),
        ],
      }),
      jsx('div', { className: 'ud-divider' }),
      jsx('div', { className: 'ud-card-sub', children: 'Snapshot values' }),
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

function DockerPreviewCard({ containers, onOpen }) {
  const visible = (containers || []).slice(0, 3);
  return jsxs('article', {
    className: 'ud-card',
    children: [
      jsx('div', {
        className: 'ud-card-head',
        children: jsxs('div', {
          children: [jsx('h3', { className: 'ud-card-title', children: 'Docker' }), jsx('div', { className: 'ud-card-sub', children: 'Container status' })],
        }),
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
        : jsx('div', { className: 'ud-empty', children: 'No Docker containers were returned.' }),
      jsx('div', { className: 'ud-card-foot', children: jsx('button', { type: 'button', className: 'ud-linkbtn', onClick: onOpen, children: 'View Docker →' }) }),
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

function OverviewView({ overview, array, disks, containers, alertGroups, alertSummary, onTab }) {
  const info = overview?.info;
  const metrics = overview?.metrics;
  const model = info?.system?.model || 'Unraid server';
  const serverDetail = [info?.os?.release, info?.cpu?.brand, info?.cpu?.cores ? `${info.cpu.cores} cores` : null].filter(Boolean).join('  ·  ');

  return jsxs('section', {
    className: 'ud-page',
    children: [
      jsxs('div', {
        className: 'ud-page-head',
        children: [
          jsxs('div', {
            children: [
              jsx('h2', { className: 'ud-page-title', children: model }),
              jsx('p', { className: 'ud-page-sub', children: serverDetail || 'System details unavailable' }),
            ],
          }),
          jsx('span', { className: 'ud-page-label', children: 'System overview' }),
        ],
      }),
      jsxs('div', {
        className: 'ud-grid-4',
        children: [
          jsx(ArrayCapacityCard, { array, onOpen: () => onTab('array') }),
          jsx(ParityCard, { array, onOpen: () => onTab('array') }),
          jsx(LoadCard, { metrics }),
          jsx(NotificationsCard, { summary: alertSummary }),
        ],
      }),
      jsxs('div', {
        className: 'ud-grid-3',
        children: [
          jsx(StoragePreviewCard, { disks, onOpen: () => onTab('array') }),
          jsx(DockerPreviewCard, { containers, onOpen: () => onTab('docker') }),
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

  const refreshAll = useCallback(async () => {
    if (refreshing) return;
    setRefreshing(true);
    try {
      const tasks = [health.refresh()];
      if (configured) tasks.push(overview.refresh(), arrayData.refresh(), docker.refresh(), vms.refresh(), alerts.refresh());
      await Promise.all(tasks);
    } finally {
      setRefreshing(false);
    }
  }, [refreshing, configured, health.refresh, overview.refresh, arrayData.refresh, docker.refresh, vms.refresh, alerts.refresh]);

  const anyError = health.error || overview.error || arrayData.error || docker.error || vms.error || alerts.error;
  const overviewData = overview.data?.data;
  const overviewArray = overviewData?.array;
  const arrayPayload = arrayData.data?.data?.array;
  // Aggregates (state/capacity/parity) come from the overview query; the disk
  // records come from /array. Never let a disk-less overview object mask them.
  const array = overviewArray || arrayPayload;
  const storageDisks = resolveArrayDisks(overviewArray, arrayPayload);
  const containers = docker.data?.data?.docker?.containers || [];
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
    style: themeStyle(custom),
    children: [
      jsx('style', { children: DECK_CSS + SETTINGS_BUTTON_CSS + (custom ? CUSTOM_STATUS_CSS : '') }),
      jsxs('header', {
        className: 'ud-topbar',
        children: [
          jsxs('div', {
            className: 'ud-brand',
            children: [
              jsx('span', { className: 'ud-logo', 'aria-hidden': true, children: jsx(Codicon, { name: SERVER_ICON, size: '1.25rem' }) }),
              jsxs('div', { className: 'ud-brand-title', children: [
                jsx('h1', { className: 'ud-app-title', children: 'Hermes for Unraid' }),
                jsx('span', { className: 'ud-app-version', children: `v${PLUGIN_VERSION}` }),
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
              jsx(Button, { onClick: refreshAll, disabled: refreshing, style: { minHeight: 40 }, children: refreshing ? 'Refreshing…' : 'Refresh' }),
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
          configured && !initialLoading && tab === 'overview' ? jsx(OverviewView, { overview: overviewData, array, disks: storageDisks, containers, alertGroups, alertSummary, onTab: setTab }) : null,
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
