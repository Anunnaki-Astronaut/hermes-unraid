'use strict';
/*
 * Isolated render harness for desktop/plugin.js.
 *
 * Loads the real plugin module inside a Node vm with the Hermes plugin SDK and
 * React mocked, injects deterministic endpoint state, and renders the page to an
 * HTML string. Nothing here touches the network, the Unraid API, or the desktop
 * app; it only exercises the component output.
 */
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const ROOT = path.resolve(__dirname, '..', '..');
const SOURCE = fs.readFileSync(path.join(ROOT, 'desktop', 'plugin.js'), 'utf8');
const NOW = new Date('2026-10-16T14:45:00-04:00');

function escapeHtml(value) {
  return String(value)
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;');
}

function styleText(style) {
  const unitless = new Set(['opacity', 'zIndex', 'fontWeight', 'flex', 'order', 'zoom']);
  return Object.entries(style || {})
    .filter(([, value]) => value != null)
    .map(([key, value]) => {
      const name = key.startsWith('--') ? key : key.replace(/[A-Z]/g, (letter) => `-${letter.toLowerCase()}`);
      const rendered =
        typeof value === 'number' && value !== 0 && !key.startsWith('--') && !unitless.has(key) ? `${value}px` : value;
      return `${name}:${rendered}`;
    })
    .join(';');
}

function render(node, Fragment, visit = () => {}) {
  if (node == null || node === false || node === true) return '';
  if (typeof node === 'string' || typeof node === 'number') return escapeHtml(node);
  if (Array.isArray(node)) return node.map((child) => render(child, Fragment, visit)).join('');
  if (node.type === Fragment) return render(node.props.children, Fragment, visit);
  if (typeof node.type === 'function') return render(node.type(node.props || {}), Fragment, visit);
  const tag = node.type;
  const props = node.props || {};
  visit(node);
  if (tag === 'style') return `<style>${props.children || ''}</style>`;
  const attrs = [];
  for (const [key, value] of Object.entries(props)) {
    if (key === 'children' || key === 'className' || key === 'style' || key.startsWith('on') || value == null || (value === false && !key.startsWith('aria-'))) continue;
    const name = key === 'htmlFor' ? 'for' : key === 'strokeWidth' ? 'stroke-width' : key;
    const rendered = value === true && key.startsWith('aria-') ? 'true' : value === true ? '' : value;
    attrs.push(`${name}="${escapeHtml(rendered)}"`);
  }
  if (props.className) attrs.push(`class="${escapeHtml(props.className)}"`);
  if (props.style) attrs.push(`style="${escapeHtml(styleText(props.style))}"`);
  return `<${tag}${attrs.length ? ` ${attrs.join(' ')}` : ''}>${render(props.children, Fragment, visit)}</${tag}>`;
}

function buildStates(options) {
  const tab = options.tab || 'overview';
  const state = (response, error) => ({
    loading: false,
    data: response ?? null,
    error: error ?? null,
    updatedAt: NOW,
  });
  return [
    options.appearance,
    options.systemDark,
    state(options.responses?.health ?? { configured: true }),
    state(options.responses?.overview ?? { data: {} }, options.errors?.overview),
    state(options.responses?.array ?? { data: {} }, options.errors?.array),
    state(options.responses?.docker ?? { data: {} }, options.errors?.docker),
    state(options.responses?.vms ?? { data: {} }, options.errors?.vms),
    state(options.responses?.notifications ?? { data: {} }, options.errors?.notifications),
    tab,
    false,
    // The /hardware state joins after the tab and refreshing hooks to match
    // the useEndpoint call order in desktop/plugin.js; do not shift earlier.
    state(options.responses?.hardware, options.errors?.hardware),
  ];
}

async function loadPlugin(options = {}) {
  let view;
  let stateIndex = 0;
  let effectIndex = 0;
  const forbiddenCalls = [];
  const navigations = [];
  let profile = options.profile || 'default';
  const deny = (name) => () => {
    forbiddenCalls.push(name);
    throw new Error(`Unexpected SDK/DOM call in offline fixture: ${name}`);
  };
  const mediaListeners = new Set();
  const media = {
    matches: options.systemDark === true,
    addEventListener(type, listener) { if (type === 'change') mediaListeners.add(listener); },
    removeEventListener(type, listener) { if (type === 'change') mediaListeners.delete(listener); },
  };

  const context = vm.createContext({
    console,
    JSON,
    Date,
    Map,
    Math,
    Number,
    String,
    Object,
    Array,
    Intl,
    Promise,
    Set,
    fetch: deny('fetch'),
    window: {
      fetch: deny('window.fetch'),
      matchMedia: () => media,
      setInterval: deny('setInterval'),
      clearInterval() {},
    },
  });

  const Fragment = Symbol('Fragment');
  const reactDefault = { Fragment };
  const react = new vm.SyntheticModule(['default', 'useCallback', 'useEffect', 'useMemo', 'useState', 'useSyncExternalStore'], function () {
    this.setExport('default', reactDefault);
    this.setExport('useSyncExternalStore', (_subscribe, get) => get());
    this.setExport('useCallback', (fn) => fn);
    this.setExport('useEffect', (fn, deps) => {
      if (!view.runEffects) return;
      const index = effectIndex++;
      const previous = view.effects[index];
      if (!previous || !deps || previous.deps?.length !== deps.length || deps.some((dep, i) => !Object.is(dep, previous.deps[i]))) {
        const target = view;
        view.pending.push(() => {
          previous?.cleanup?.();
          target.effects[index] = { deps, cleanup: fn() };
        });
      }
    });
    this.setExport('useMemo', (fn) => fn());
    this.setExport('useState', (initial) => {
      const index = stateIndex++;
      const values = view.states;
      if (!(index in values)) values[index] = view.seed[index] ?? (typeof initial === 'function' ? initial() : initial);
      return [values[index], (next) => { values[index] = typeof next === 'function' ? next(values[index]) : next; }];
    });
  }, { context });

  const jsxFn = (type, props, key) => ({ type, props: props || {}, key });
  const runtime = new vm.SyntheticModule(['jsx', 'jsxs'], function () {
    this.setExport('jsx', jsxFn);
    this.setExport('jsxs', jsxFn);
  }, { context });

  const Button = (props) => jsxFn('button', { ...props, className: `preview-button ${props.className || ''}`.trim(), type: 'button' });
  const Codicon = ({ name, size }) => jsxFn('i', { className: `codicon codicon-${name}`, 'aria-hidden': true, style: { fontSize: size } });
  const StatusDot = ({ tone }) => jsxFn('span', { className: `preview-status-dot preview-${tone}`, 'aria-hidden': true });
  const sdk = new vm.SyntheticModule(
    ['Button', 'Codicon', 'ErrorState', 'GlyphSpinner', 'host', 'PALETTE_AREA', 'ROUTES_AREA', 'SIDEBAR_NAV_AREA', 'StatusDot'],
    function () {
      this.setExport('Button', Button);
      this.setExport('Codicon', Codicon);
      this.setExport('ErrorState', (props) => jsxFn('div', { children: props.description }));
      this.setExport('GlyphSpinner', () => jsxFn('span', { children: 'Loading' }));
      this.setExport('host', {
        state: { profile: { get: () => profile } },
        navigate: (route) => navigations.push(route),
        request: deny('host.request'),
        onEvent: deny('host.onEvent'),
        settings: new Proxy({}, { get: deny('host.settings') }),
      });
      this.setExport('PALETTE_AREA', 'palette');
      this.setExport('ROUTES_AREA', 'routes');
      this.setExport('SIDEBAR_NAV_AREA', 'sidebar');
      this.setExport('StatusDot', StatusDot);
    },
    { context },
  );

  const module = new vm.SourceTextModule(SOURCE, { context });
  await module.link((specifier) =>
    specifier === 'react' ? react : specifier === 'react/jsx-runtime' ? runtime : specifier === '@hermes/plugin-sdk' ? sdk : null,
  );
  await module.evaluate();

  const registrations = [];
  const settingsPages = [];
  const storage = options.storage || {
    _value: undefined,
    get(key) { return key === 'unraid.appearance' ? this._value : undefined; },
    set(key, value) { if (key === 'unraid.appearance') this._value = value; },
  };
  module.namespace.default.register({
    rest: options.rest || deny('ctx.rest'),
    socket: deny('ctx.socket'),
    registerMany: (items) => registrations.push(...items),
    ...(options.legacyHost ? {} : { registerSettingsPage: (page) => settingsPages.push(page) }),
    storage,
  });

  function mount(contribution, seed = [], runEffects = true) {
    const target = { states: [], seed, runEffects, effects: [], pending: [] };
    return {
      render() {
        view = target;
        stateIndex = 0;
        effectIndex = 0;
        const controls = new Map();
        const elements = [];
        const html = render(contribution.render(), Fragment, ({ type, props }) => {
          elements.push({ type, props });
          if (type === 'button' && typeof props.onClick === 'function') {
            controls.set(props['aria-label'] ?? props.children, props);
          }
        });
        target.pending.splice(0).forEach((effect) => effect());
        return { html, controls, elements };
      },
      unmount() { target.effects.forEach(({ cleanup }) => cleanup?.()); },
    };
  }

  const page = registrations.find((item) => item.id === 'page');
  const mountDashboard = () => mount(page, buildStates(options), false);
  const { html } = mountDashboard().render();
  return {
    html, mod: module.namespace, storage, registrations, settingsPages, navigations, forbiddenCalls,
    mountDashboard, mountSettings: () => mount(settingsPages[0]),
    setProfile(value) { profile = value; },
    setSystemDark(matches) { media.matches = matches; for (const listener of mediaListeners) listener({ matches }); },
    systemListeners: () => mediaListeners.size,
  };
}

module.exports = { loadPlugin, render, escapeHtml, ROOT, NOW };
