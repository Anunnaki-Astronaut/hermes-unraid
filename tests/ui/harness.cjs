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

function render(node, Fragment) {
  if (node == null || node === false || node === true) return '';
  if (typeof node === 'string' || typeof node === 'number') return escapeHtml(node);
  if (Array.isArray(node)) return node.map((child) => render(child, Fragment)).join('');
  if (node.type === Fragment) return render(node.props.children, Fragment);
  if (typeof node.type === 'function') return render(node.type(node.props || {}), Fragment);
  const tag = node.type;
  const props = node.props || {};
  if (tag === 'style') return `<style>${props.children || ''}</style>`;
  const attrs = [];
  for (const [key, value] of Object.entries(props)) {
    if (key === 'children' || key === 'className' || key === 'style' || key.startsWith('on') || value == null || value === false) continue;
    const name = key === 'htmlFor' ? 'for' : key === 'strokeWidth' ? 'stroke-width' : key;
    const rendered = value === true && key.startsWith('aria-') ? 'true' : value === true ? '' : value;
    attrs.push(`${name}="${escapeHtml(rendered)}"`);
  }
  if (props.className) attrs.push(`class="${escapeHtml(props.className)}"`);
  if (props.style) attrs.push(`style="${escapeHtml(styleText(props.style))}"`);
  return `<${tag}${attrs.length ? ` ${attrs.join(' ')}` : ''}>${render(props.children, Fragment)}</${tag}>`;
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
    options.appearance || 'match',
    options.systemDark === true,
    state(options.responses?.health ?? { configured: true }),
    state(options.responses?.overview ?? { data: {} }, options.errors?.overview),
    state(options.responses?.array ?? { data: {} }, options.errors?.array),
    state(options.responses?.docker ?? { data: {} }, options.errors?.docker),
    state(options.responses?.vms ?? { data: {} }, options.errors?.vms),
    state(options.responses?.notifications ?? { data: {} }, options.errors?.notifications),
    tab,
    false,
  ];
}

async function loadPlugin(options = {}) {
  const states = buildStates(options);
  let stateIndex = 0;

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
    window: { setInterval() { return 1; }, clearInterval() {} },
  });

  const Fragment = Symbol('Fragment');
  const reactDefault = { Fragment };
  const react = new vm.SyntheticModule(['default', 'useCallback', 'useEffect', 'useMemo', 'useState'], function () {
    this.setExport('default', reactDefault);
    this.setExport('useCallback', (fn) => fn);
    this.setExport('useEffect', () => {});
    this.setExport('useMemo', (fn) => fn());
    this.setExport('useState', (initial) => {
      const value = stateIndex < states.length ? states[stateIndex++] : typeof initial === 'function' ? initial() : initial;
      return [value, () => {}];
    });
  }, { context });

  const jsxFn = (type, props, key) => ({ type, props: props || {}, key });
  const runtime = new vm.SyntheticModule(['jsx', 'jsxs'], function () {
    this.setExport('jsx', jsxFn);
    this.setExport('jsxs', jsxFn);
  }, { context });

  const Button = (props) => jsxFn('button', { ...props, className: `preview-button ${props.className || ''}`.trim(), type: 'button' });
  const StatusDot = ({ tone }) => jsxFn('span', { className: `preview-status-dot preview-${tone}`, 'aria-hidden': true });
  const sdk = new vm.SyntheticModule(
    ['Button', 'ErrorState', 'GlyphSpinner', 'host', 'PALETTE_AREA', 'ROUTES_AREA', 'SIDEBAR_NAV_AREA', 'StatusDot'],
    function () {
      this.setExport('Button', Button);
      this.setExport('ErrorState', (props) => jsxFn('div', { children: props.description }));
      this.setExport('GlyphSpinner', () => jsxFn('span', { children: 'Loading' }));
      this.setExport('host', { navigate() {} });
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
  const storage = options.storage || {
    _value: undefined,
    get(key) { return key === 'unraid.appearance' ? this._value : undefined; },
    set(key, value) { if (key === 'unraid.appearance') this._value = value; },
  };
  module.namespace.default.register({
    rest: async () => ({}),
    registerMany: (items) => registrations.push(...items),
    storage,
  });

  const page = registrations.find((item) => item.id === 'page');
  const html = render(page.render(), Fragment);
  return { html, mod: module.namespace, storage, registrations };
}

module.exports = { loadPlugin, render, escapeHtml, ROOT, NOW };
