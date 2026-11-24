#!/usr/bin/env node
/* Render the real Desktop component against deterministic sample data.
 * Usage: node --experimental-vm-modules scripts/render_screenshot.cjs <tab|settings> <output.html> [match|system|light|dark] [open] [unavailable] [anunnaki]
 */
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const validTabs = new Set(['overview', 'array', 'docker', 'vms', 'alerts', 'settings']);
const tab = process.argv[2] || 'overview';
if (!validTabs.has(tab)) {
  console.error(`Unknown tab: ${tab}`);
  process.exit(2);
}
const output = path.resolve(process.argv[3] || `.screenshots-preview/${tab}.html`);
const appearance = process.argv[4] || 'match';
const flags = new Set(process.argv.slice(5));
const showMaker = tab === 'settings' && flags.has('open');
const missingHardware = tab === 'overview' && flags.has('unavailable');
const anunnaki = flags.has('anunnaki');
const anunnakiPalettes = {
  light: { background: '#FAF8F3', panel: '#EAE2D3', text: '#1C1B1A', accent: '#704718', selected: '#E5D3B7' },
  dark: { background: '#0C1420', panel: '#64442D', text: '#E9EFF6', accent: '#F1BE77', selected: '#533829' },
};
if (!new Set(['match', 'system', 'light', 'dark']).has(appearance)) {
  console.error(`Unknown appearance: ${appearance}`);
  process.exit(2);
}
if (anunnaki && !anunnakiPalettes[appearance]) throw new Error('Anunnaki preview requires light or dark appearance');
const root = path.resolve(__dirname, '..');
const source = fs.readFileSync(path.join(root, 'desktop/plugin.js'), 'utf8');
const now = new Date('2026-10-16T14:45:00-04:00');

const summary = { info: 197, warning: 25, alert: 15, total: 237 };
const notifications = [
  ...Array.from({ length: 15 }, (_, index) => ({ id: `alert-${index}`, title: 'Disk 2 utilization', description: 'Capacity threshold crossed.', importance: 'ALERT', timestamp: '2026-10-16T18:44:00Z' })),
  ...Array.from({ length: 20 }, (_, index) => ({ id: `backup-${index}`, title: 'Appdata Backup', description: 'Please check the backup log.', importance: 'WARNING', timestamp: '2026-10-16T18:30:00Z' })),
  ...Array.from({ length: 5 }, (_, index) => ({ id: `advisory-${index}`, title: 'Fix Common Problems', description: 'Investigation recommended.', importance: 'WARNING', timestamp: '2026-10-16T17:45:00Z' })),
];
const disks = [
  { id: 'parity', name: 'parity', device: 'sda', type: 'PARITY', status: 'DISK_OK', temp: 36, numErrors: 0 },
  { id: 'd1', name: 'disk1', device: 'sdb', type: 'DATA', status: 'DISK_OK', temp: 37, numErrors: 0 },
  { id: 'd2', name: 'disk2', device: 'sdc', type: 'DATA', status: 'DISK_OK', temp: 41, numErrors: 0 },
  { id: 'd3', name: 'disk3', device: 'sdd', type: 'DATA', status: 'DISK_OK', temp: 39, numErrors: 0 },
  { id: 'd4', name: 'disk4', device: 'sde', type: 'DATA', status: 'DISK_OK', temp: null, isSpinning: false, numErrors: 0 },
  { id: 'cache1', name: 'cache', device: 'nvme0n1', type: 'CACHE', status: 'DISK_OK', temp: 43, numErrors: 0 },
];
const containers = [
  { id: 'c1', names: ['/Plex'], image: 'lscr.io/linuxserver/plex', state: 'RUNNING', status: 'Up 6 days', lanIpPorts: ['192.0.2.50:32400'] },
  { id: 'c2', names: ['/Home-Assistant'], image: 'ghcr.io/home-assistant/home-assistant', state: 'RUNNING', status: 'Up 6 days', lanIpPorts: ['192.0.2.50:8123'] },
  { id: 'c3', names: ['/Immich'], image: 'ghcr.io/immich-app/immich-server', state: 'RUNNING', status: 'Up 3 days', lanIpPorts: ['192.0.2.50:2283'] },
  { id: 'c4', names: ['/Paperless'], image: 'ghcr.io/paperless-ngx/paperless-ngx', state: 'RUNNING', status: 'Up 3 days', lanIpPorts: ['192.0.2.50:8010'] },
  { id: 'c5', names: ['/Mealie'], image: 'ghcr.io/mealie-recipes/mealie', state: 'RUNNING', status: 'Up 2 days', lanIpPorts: ['192.0.2.50:9925'] },
  { id: 'c6', names: ['/Archive-Worker'], image: 'example/archive-worker', state: 'EXITED', status: 'Exited (0) 12 hours ago', lanIpPorts: [] },
];
const domains = [
  { id: 'vm-4ef8f359-0a7f-4317-9fdd-dfd05fe8203f', name: 'Windows 11', state: 'RUNNING' },
  { id: 'vm-f9d7ad52-5056-4708-9d4b-d51cf21e1958', name: 'Home Lab', state: 'RUNNING' },
  { id: 'vm-03ee688c-73ea-4f9b-9340-64cffd95bd97', name: 'Test Bench', state: 'SHUTOFF' },
];
const array = {
  state: 'STARTED',
  capacity: { kilobytes: { used: 107803679129.6, total: 130029619814.4, free: 22225940684.8 } },
  parityCheckStatus: { status: 'COMPLETED', progress: 100, errors: 0 },
  disks,
};
const overviewArray = { state: array.state, capacity: array.capacity, parityCheckStatus: array.parityCheckStatus };
const GiB = 2 ** 30;
const cpu = { manufacturer: 'AMD', brand: 'AMD Ryzen 7 7700', cores: 8 };
const coreOverview = {
  info: { versions: { core: { unraid: '7.4.1' } }, cpu },
  metrics: { cpu: { percentTotal: 18.4 }, memory: { total: String(63 * GiB), available: String(42 * GiB) } },
  array: overviewArray,
  notifications: { overview: { unread: summary }, warningsAndAlerts: notifications },
};
const inventory = {
  os: { hostname: 'Atlas NAS' },
  baseboard: { manufacturer: 'ASRock Rack', model: 'B650D4U', memMax: 128 * GiB },
  cpu: { ...cpu, threads: 16, speed: 3.8 },
  memory: { layout: Array.from({ length: 2 }, () => ({ size: String(32 * GiB), type: 'DDR5' })) },
};
const states = [
  appearance,
  false,
  { loading: false, data: { configured: true }, error: null, updatedAt: now },
  { loading: false, data: { data: coreOverview }, error: null, updatedAt: now },
  { loading: false, data: { data: { array } }, error: null, updatedAt: now },
  { loading: false, data: { data: { docker: { containers } } }, error: null, updatedAt: now },
  { loading: false, data: { data: { vms: { domains } } }, error: null, updatedAt: now },
  { loading: false, data: { data: { notifications: { overview: { unread: summary }, warningsAndAlerts: notifications } } }, error: null, updatedAt: now },
  tab,
  false,
  { loading: false, data: missingHardware ? null : { data: { info: inventory } }, error: missingHardware ? 'Inventory not reported' : null, updatedAt: now },
];

const context = vm.createContext({ console, JSON, Date, Map, Math, Number, String, Object, Array, Intl, Promise, Set, window: { setInterval() { return 1; }, clearInterval() {} } });
const Fragment = Symbol('Fragment');
const reactDefault = { Fragment };
let stateIndex = 0;
const react = new vm.SyntheticModule(['default', 'useCallback', 'useEffect', 'useMemo', 'useState', 'useSyncExternalStore'], function () {
  this.setExport('default', reactDefault);
  this.setExport('useSyncExternalStore', (_subscribe, get) => get());
  this.setExport('useCallback', (fn) => fn);
  this.setExport('useEffect', () => {});
  this.setExport('useMemo', (fn) => fn());
  this.setExport('useState', (initial) => {
    const index = stateIndex++;
    const value = index < (tab === 'settings' ? 2 : states.length) ? states[index] : (typeof initial === 'function' ? initial() : initial);
    return [value, () => {}];
  });
}, { context });
const jsxFn = (type, props, key) => ({ type, props: props || {}, key });
const runtime = new vm.SyntheticModule(['jsx', 'jsxs'], function () { this.setExport('jsx', jsxFn); this.setExport('jsxs', jsxFn); }, { context });
const Button = (props) => jsxFn('button', { ...props, className: `preview-button ${props.className || ''}`.trim(), type: 'button' });
// The standalone fixture does not load the host's icon font. Draw the server
// stand-in here so the documentation preview doesn't show an empty brand tile.
const Codicon = ({ name, size }) => name === 'server' ? jsxFn('svg', {
  width: size, height: size, viewBox: '0 0 20 20', fill: 'none', stroke: 'currentColor',
  strokeWidth: 1.25, 'aria-hidden': true, children: [
    jsxFn('rect', { x: 2.5, y: 3.5, width: 15, height: 5, rx: 1 }),
    jsxFn('rect', { x: 2.5, y: 11.5, width: 15, height: 5, rx: 1 }),
    jsxFn('path', { d: 'M5 6h1.5m-1.5 8h1.5M9 6h5m-5 8h5' }),
  ],
}) : jsxFn('i', { className: `codicon codicon-${name}`, 'aria-hidden': true, style: { fontSize: size } });
const StatusDot = ({ tone }) => jsxFn('span', { className: `preview-status-dot preview-${tone}`, 'aria-hidden': true });
const sdk = new vm.SyntheticModule(['Button', 'Codicon', 'ErrorState', 'GlyphSpinner', 'host', 'PALETTE_AREA', 'ROUTES_AREA', 'SIDEBAR_NAV_AREA', 'StatusDot'], function () {
  this.setExport('Button', Button);
  this.setExport('Codicon', Codicon);
  this.setExport('ErrorState', (props) => jsxFn('div', { children: props.description }));
  this.setExport('GlyphSpinner', () => jsxFn('span', { children: 'Loading' }));
  this.setExport('host', { navigate() {} });
  this.setExport('PALETTE_AREA', 'palette');
  this.setExport('ROUTES_AREA', 'routes');
  this.setExport('SIDEBAR_NAV_AREA', 'sidebar');
  this.setExport('StatusDot', StatusDot);
}, { context });

function escapeHtml(value) { return String(value).replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;').replaceAll('"', '&quot;'); }
function styleText(style) {
  const unitless = new Set(['opacity', 'zIndex', 'fontWeight', 'flex', 'order', 'zoom']);
  return Object.entries(style || {}).filter(([, value]) => value != null).map(([key, value]) => {
    const name = key.startsWith('--') ? key : key.replace(/[A-Z]/g, (letter) => `-${letter.toLowerCase()}`);
    const rendered = typeof value === 'number' && value !== 0 && !key.startsWith('--') && !unitless.has(key) ? `${value}px` : value;
    return `${name}:${rendered}`;
  }).join(';');
}
function render(node, selected) {
  if (node == null || node === false || node === true) return '';
  if (typeof node === 'string' || typeof node === 'number') return escapeHtml(node);
  if (Array.isArray(node)) return node.map((entry) => render(entry, selected)).join('');
  if (node.type === Fragment) return render(node.props.children, selected);
  if (typeof node.type === 'function') return render(node.type(node.props || {}), selected);
  const tag = node.type;
  const props = node.props || {};
  if (tag === 'style') return `<style>${props.children || ''}</style>`;
  const attrs = [];
  for (const [key, value] of Object.entries(props)) {
    if (key === 'children' || key === 'className' || key === 'style' || key.startsWith('on') || value == null || (value === false && !key.startsWith('aria-'))) continue;
    const name = key === 'htmlFor' ? 'for' : key === 'strokeWidth' ? 'stroke-width' : key;
    const rendered = value === true && key.startsWith('aria-') ? 'true' : value === true ? '' : value;
    attrs.push(`${name}="${escapeHtml(rendered)}"`);
  }
  if (props.className) attrs.push(`class="${escapeHtml(props.className)}"`);
  if (tag === 'details' && showMaker && props.className === 'us-maker') attrs.push('open');
  if (tag === 'option' && props.value === selected) attrs.push('selected');
  if (props.style) attrs.push(`style="${escapeHtml(styleText(props.style))}"`);
  if (tag === 'input') return `<input${attrs.length ? ` ${attrs.join(' ')}` : ''}>`;
  return `<${tag}${attrs.length ? ` ${attrs.join(' ')}` : ''}>${render(props.children, tag === 'select' ? props.value : selected)}</${tag}>`;
}

(async () => {
  const module = new vm.SourceTextModule(source, { context });
  await module.link((specifier) => specifier === 'react' ? react : specifier === 'react/jsx-runtime' ? runtime : specifier === '@hermes/plugin-sdk' ? sdk : null);
  await module.evaluate();
  const registrations = [];
  let settings;
  module.namespace.default.register({
    rest() { throw new Error('The screenshot fixture cannot make backend requests'); },
    storage: { get: (key) => anunnaki && key === `unraid.palette.v1.default.${appearance}`
      ? anunnakiPalettes[appearance]
      : undefined },
    registerMany: (items) => registrations.push(...items),
    registerSettingsPage: (page) => { settings = page; },
  });
  const page = tab === 'settings' ? settings : registrations.find((item) => item.id === 'page');
  const body = render(page.render());
  const shellCss = `<style>:root{--ui-base:#edf4ef;--ui-accent:#61d18b;--ui-success:#52c987;--ui-yellow:#f2b84b;--ui-red:#ef6471;--ui-text-primary:#f4f7f5;--ui-text-secondary:#9eaaa3;--ui-text-tertiary:#748078;--ui-stroke-secondary:#2b3530;--ui-stroke-tertiary:#222b27;--ui-bg-card:#121715;--ui-bg-secondary:#28302c;--ui-row-hover-background:#18201c;--ui-bg-editor:#0b0e0d;--dt-destructive:#ef6471}html,body{margin:0;height:100%;background:var(--ui-bg-editor);font:14px/1.45 ui-sans-serif,system-ui;color:var(--ui-text-primary)}button{font:inherit}.preview-button{border:1px solid var(--ui-stroke-secondary);border-radius:8px;background:var(--ui-bg-secondary);color:var(--ui-text-primary);padding:8px 12px;font-weight:700}.preview-status-dot{display:inline-block;width:.42rem;height:.42rem;border-radius:50%;background:var(--ui-text-secondary)}.preview-good{background:var(--ui-success)}.preview-warn{background:var(--ui-yellow)}.preview-bad{background:var(--ui-red)}</style>`;
  fs.mkdirSync(path.dirname(output), { recursive: true });
  fs.writeFileSync(output, `<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">${shellCss}</head><body>${body}</body></html>`);
  console.log(JSON.stringify({ tab, appearance, output, bytes: body.length }));
})().catch((error) => { console.error(error); process.exit(1); });
