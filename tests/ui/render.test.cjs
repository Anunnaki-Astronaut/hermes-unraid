'use strict';
/*
 * Behavior tests for the Harbor Dashboard candidate UI (desktop/plugin.js).
 * These render the real component in an isolated vm harness and assert on the
 * produced HTML. Run with: node --experimental-vm-modules --test tests/ui/*.test.cjs
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { execFileSync } = require('node:child_process');
const { loadPlugin } = require('./harness.cjs');

test('synthetic Array preview includes a spun-down device', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'unraid-preview-'));
  try {
    const output = path.join(dir, 'array.html');
    execFileSync(process.execPath, ['--experimental-vm-modules', path.join(__dirname, '../../scripts/render_screenshot.cjs'), 'array', output, 'dark'], { stdio: 'pipe' });
    const html = fs.readFileSync(output, 'utf8');
    assert.ok(html.includes('Zzz · Asleep'), 'preview should demonstrate the explicit sleep state');
    assert.ok(html.includes('6 reported'), 'preview remains a full synthetic Array page');
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('synthetic Overview preview renders Anunnaki in both modes', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'unraid-anunnaki-preview-'));
  try {
    const renderer = path.join(__dirname, '../../scripts/render_screenshot.cjs');
    for (const [mode, canvas] of [['light', '#FAF8F3'], ['dark', '#0C1420']]) {
      const output = path.join(dir, `${mode}.html`);
      execFileSync(process.execPath, ['--experimental-vm-modules', renderer, 'overview', output, mode, 'anunnaki'], { stdio: 'pipe' });
      const html = fs.readFileSync(output, 'utf8');
      assert.ok(html.includes(`data-appearance="${mode}"`));
      assert.ok(html.includes('data-preset="anunnaki"'));
      assert.ok(html.includes(`--ud-canvas:${canvas}`));
      assert.ok(html.includes('Showing 3 of 6'));
    }
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

const DISKS = [
  { id: 'parity', name: 'parity', device: 'sda', type: 'PARITY', status: 'DISK_OK', temp: 36, numErrors: 0 },
  { id: 'd1', name: 'disk1', device: 'sdb', type: 'DATA', status: 'DISK_OK', temp: 37, numErrors: 0 },
  { id: 'd2', name: 'disk2', device: 'sdc', type: 'DATA', status: 'DISK_OK', temp: 41, numErrors: 0 },
  { id: 'd3', name: 'disk3', device: 'sdd', type: 'DATA', status: 'DISK_OK', temp: 39, numErrors: 0 },
  { id: 'cache', name: 'cache', device: 'nvme0n1', type: 'CACHE', status: 'DISK_OK', temp: 43, numErrors: 0 },
];
const CONTAINERS = [
  { id: 'c1', names: ['/Plex'], image: 'lscr.io/linuxserver/plex', state: 'RUNNING', status: 'Up 6 days', lanIpPorts: ['192.168.1.50:32400'] },
  { id: 'c2', names: ['/Home-Assistant'], image: 'ghcr.io/home-assistant/home-assistant', state: 'RUNNING', status: 'Up 6 days', lanIpPorts: ['192.168.1.50:8123'] },
  { id: 'c3', names: ['/Immich'], image: 'ghcr.io/immich-app/immich-server', state: 'RUNNING', status: 'Up 3 days', lanIpPorts: ['192.168.1.50:2283'] },
  { id: 'c4', names: ['/Paperless'], image: 'ghcr.io/paperless-ngx/paperless-ngx', state: 'RUNNING', status: 'Up 3 days', lanIpPorts: ['192.168.1.50:8010'] },
];
const VMS = [
  { id: 'vm-1', name: 'Windows 11', state: 'RUNNING' },
  { id: 'vm-2', name: 'Test Bench', state: 'SHUTOFF' },
];
const ALERTS = [
  { id: 'a1', title: 'Disk 2 utilization', description: 'Capacity threshold crossed.', importance: 'ALERT', timestamp: '2026-10-16T18:44:00Z' },
  { id: 'a2', title: 'Appdata Backup', description: 'Please check the backup log.', importance: 'WARNING', timestamp: '2026-10-16T18:30:00Z' },
];
function makeDisks() {
  return DISKS.map((disk) => ({ ...disk }));
}

// The /array query returns full disk records (including isSpinning).
function makeArray() {
  return {
    state: 'STARTED',
    capacity: { kilobytes: { used: 107803679129.6, total: 130029619814.4, free: 22225940684.8 } },
    parityCheckStatus: { status: 'COMPLETED', progress: 100, errors: 0 },
    disks: makeDisks(),
  };
}

// The overview query errors returns array state/capacity/parity only - the real
// GraphQL response carries NO disk records, which is what masked the storage card.
function makeOverviewArray() {
  const { disks, ...aggregates } = makeArray();
  return aggregates;
}

function sampleResponses(model = 'Atlas NAS') {
  return {
    health: { configured: true },
    overview: {
      ok: true,
      data: {
        info: { os: { release: 'Unraid 7.3' }, versions: { core: { unraid: '7.4.1' } }, cpu: { brand: 'Intel Xeon E-2224', cores: 4 } },
        metrics: { cpu: { percentTotal: 18.4 }, memory: { total: String(63 * 2 ** 30), available: String(42 * 2 ** 30), percentTotal: 46.7 } },
        array: makeOverviewArray(),
        notifications: { overview: { unread: { info: 197, warning: 25, alert: 15, total: 237 } }, warningsAndAlerts: ALERTS },
      },
    },
    hardware: { ok: true, data: { info: { os: { hostname: model } } } },
    array: { ok: true, data: { array: makeArray() } },
    docker: { ok: true, data: { docker: { containers: CONTAINERS } } },
    vms: { ok: true, data: { vms: { domains: VMS } } },
    notifications: { ok: true, data: { notifications: { overview: { unread: { info: 197, warning: 25, alert: 15, total: 237 } }, warningsAndAlerts: ALERTS } } },
  };
}

test('overview storage card is fed by the /array disk records, not the disk-less overview array', async () => {
  const responses = sampleResponses();
  assert.ok(!('disks' in responses.overview.data.array), 'fixture must mirror the real overview query (no disks)');
  responses.array.data.array.disks = [
    { id: 'd4', name: 'disk4', device: 'sde', type: 'DATA', status: 'DISK_OK', temp: 38, isSpinning: true, numErrors: 0 },
    ...responses.array.data.array.disks,
  ];
  const { html } = await loadPlugin({ tab: 'overview', responses });
  assert.ok(html.includes('6 reported'), 'overview storage count must come from the /array disk list');
  assert.ok(html.includes('disk4'), 'overview storage rows must render /array-only devices');
  assert.ok(html.includes('Showing 4 of 6'), 'preview must honestly state it is truncating the /array list');
  assert.ok(html.includes('100.4 TB'), 'overview capacity aggregate must still come from the overview query');
});

test('overview does not claim "0 reported" when the /array device list is unavailable', async () => {
  const responses = sampleResponses();
  delete responses.array.data.array.disks;
  const { html } = await loadPlugin({ tab: 'overview', responses });
  assert.ok(!html.includes('0 reported'), 'must not assert a zero count it cannot verify');
  assert.ok(html.includes('Storage unavailable'), 'must state that storage data is unavailable');
  assert.ok(html.includes('Device details are unavailable.'), 'empty body must not imply there are no devices');
  assert.ok(!html.includes('No storage devices were returned.'), 'unknown list is not a verified empty list');
});

test('a spun-down drive is presented as asleep, never "Unknown"', async () => {
  const responses = sampleResponses();
  responses.array.data.array.disks = [
    { id: 'sd1', name: 'disk5', device: 'sdf', type: 'DATA', status: 'DISK_OK', temp: null, isSpinning: false, numErrors: 0 },
  ];
  const { html } = await loadPlugin({ tab: 'array', responses });
  assert.ok(html.includes('Zzz · Asleep'), 'a drive with isSpinning false must show an asleep presentation');
  assert.ok(html.includes('Spun down'), 'the asleep presentation must be accessible');
  assert.ok(html.includes('OK'), 'health state DISK_OK must remain shown separately from spin state');
  assert.ok(!html.includes('Unknown'), 'a spun-down drive has a known spin state, so it is not Unknown');
});

test('a missing temperature on a spinning or unknown-spin drive stays Unknown', async () => {
  const responses = sampleResponses();
  responses.array.data.array.disks = [
    { id: 'sd1', name: 'disk5', device: 'sdf', type: 'DATA', status: 'DISK_OK', temp: null, isSpinning: true, numErrors: 0 },
    { id: 'sd2', name: 'disk6', device: 'sdg', type: 'DATA', status: 'DISK_OK', temp: null, numErrors: 0 },
  ];
  const { html } = await loadPlugin({ tab: 'array', responses });
  assert.ok(!html.includes('Asleep'), 'must not infer asleep from a missing temperature alone');
  assert.ok(html.includes('Unknown'), 'a genuinely unknown temperature must stay Unknown');
});

test('overview renders values taken from live API props (not hardcoded)', async () => {
  const { html } = await loadPlugin({ tab: 'overview', responses: sampleResponses('Atlas NAS') });
  for (const expected of [
    'Hermes for Unraid',
    'Atlas NAS',
    'Unraid v7.4.1',
    '100.4 TB',
    '121.1 TB',
    '18.4%',
    '33%',
    'Parity check',
    'Completed',
    '0 errors reported',
    'parity',
    'disk1',
    'Plex',
    'Disk 2 utilization',
    'View all alerts',
  ]) {
    assert.ok(html.includes(expected), `expected overview to include ${JSON.stringify(expected)}`);
  }
});

test('overview reflects different API props and fabricates nothing', async () => {
  const responses = sampleResponses('Testbox');
  responses.overview.data.array = {
    state: 'STOPPED',
    capacity: { kilobytes: { used: 1048576, total: 2097152, free: 1048576 } },
    parityCheckStatus: { status: 'COMPLETED', progress: 100, errors: 0 },
    disks: [],
  };
  const { html } = await loadPlugin({ tab: 'overview', responses });
  assert.ok(html.includes('Testbox'), 'expected the hostname prop to drive the title');
  assert.ok(!html.includes('Atlas NAS'), 'must not contain a hardcoded sample model');
  assert.ok(html.includes('1.0 GB'), 'capacity must come from props');
  assert.ok(!html.includes('100.4 TB'), 'must not contain a hardcoded sample capacity');
});

test('missing fields show honest placeholders instead of invented values', async () => {
  const { html } = await loadPlugin({
    tab: 'overview',
    responses: { health: { configured: true }, overview: { ok: true, data: {} } },
  });
  assert.ok(html.includes('Unknown'), 'expected an Unknown placeholder');
  assert.ok(html.includes('Usage unknown') || html.includes('Unknown'), 'expected unknown capacity copy');
  assert.ok(!html.includes('TB'), 'must not invent capacity figures');
  assert.ok(html.includes('Device details are unavailable.'), 'expected honest unavailable storage copy');
  assert.ok(html.includes('Docker container count unavailable.'), 'missing response is not an empty list');
  assert.ok(html.includes('No unread warnings or alerts.'), 'expected empty alert copy');
});

test('explicit null capacity and load fields stay unknown', async () => {
  const responses = sampleResponses();
  responses.overview.data.array.capacity.kilobytes = { used: null, total: null, free: null };
  responses.overview.data.metrics.cpu.percentTotal = null;
  responses.overview.data.metrics.memory = { total: null, available: null, percentTotal: 0 };
  const { html } = await loadPlugin({ tab: 'overview', responses });
  assert.ok(!html.includes('0 B'), 'null capacity is not a measured zero');
  assert.ok(html.includes('Usage unknown'));
  assert.match(html, /aria-label="Array capacity used"[^>]*aria-valuetext="Unknown"/);
  assert.doesNotMatch(html, /aria-label="Array capacity used"[^>]*aria-valuenow=/);
  assert.match(html, /CPU load<[^>]+>\s*<[^>]+>Not reported/);
  assert.ok(html.includes('Memory readings unavailable'));
  assert.doesNotMatch(html, /aria-label="System memory in use"/);
});

test('null parity progress is not reported as zero', async () => {
  const responses = sampleResponses();
  responses.overview.data.array.parityCheckStatus = { status: 'RUNNING', progress: null, errors: null };
  const { html } = await loadPlugin({ tab: 'overview', responses });
  assert.ok(html.includes('Parity check running'), 'the known state remains visible');
  assert.ok(!html.includes('0% complete'), 'null progress is not a measured zero');
  assert.ok(!html.includes('Parity check running · 0%'), 'footer must not invent progress');
});

test('null notification counts remain unknown, not zero', async () => {
  const responses = sampleResponses();
  const unread = { info: 0, warning: null, alert: null, total: null };
  responses.overview.data.notifications.overview.unread = unread;
  responses.notifications.data.notifications.overview.unread = unread;
  const { html } = await loadPlugin({ tab: 'overview', responses });
  assert.match(html, /ud-pair-value">Unknown<\/span><span class="ud-pair-label">alerts/);
  assert.match(html, /ud-pair-value">Unknown<\/span><span class="ud-pair-label">warnings/);
  assert.ok(html.includes('Unread totals unavailable'));
  assert.ok(!html.includes('0 total unread'));
});

test('errorText maps known codes and never reflects raw upstream text', async () => {
  const { mod } = await loadPlugin({});
  assert.equal(typeof mod.errorText, 'function');
  assert.equal(typeof mod.SAFE_ERRORS, 'object');
  assert.equal(mod.errorText({ detail: { code: 'unraid_unreachable' } }), mod.SAFE_ERRORS.unraid_unreachable);
  assert.equal(mod.errorText({ code: 'graphql_error' }), mod.SAFE_ERRORS.graphql_error);
  assert.equal(
    mod.errorText(new Error('request failed {"detail":{"code":"authentication_failed"}}')),
    mod.SAFE_ERRORS.authentication_failed,
  );
  const leaky = mod.errorText(new Error('https://tower.local/graphql?token=top-secret rejected'));
  assert.ok(!leaky.includes('top-secret'), 'must not echo secrets from an error message');
  assert.ok(!leaky.includes('tower.local'), 'must not echo endpoints from an error message');
  assert.equal(mod.errorText({ code: 'totally_unknown' }), 'Could not load Unraid data. Check the connection and try again.');
});

test('appearance resolution honours the four plugin-scoped choices', async () => {
  const { mod } = await loadPlugin({});
  assert.equal(mod.resolveAppearance('match', true), 'match');
  assert.equal(mod.resolveAppearance('match', false), 'match');
  assert.equal(mod.resolveAppearance('system', true), 'dark');
  assert.equal(mod.resolveAppearance('system', false), 'light');
  assert.equal(mod.resolveAppearance('light', true), 'light');
  assert.equal(mod.resolveAppearance('dark', false), 'dark');
});

test('appearance persists through ctx.storage and defaults safely', async () => {
  const { mod } = await loadPlugin({});
  assert.equal(mod.readAppearance(undefined), 'match');
  assert.equal(mod.readAppearance({ get: () => 'nonsense' }), 'match');
  const store = { _v: undefined, get(k) { return k === mod.APPEARANCE_KEY ? this._v : undefined; }, set(k, v) { if (k === mod.APPEARANCE_KEY) this._v = v; } };
  mod.writeAppearance(store, 'dark');
  assert.equal(mod.readAppearance(store), 'dark');
  assert.deepEqual([...mod.APPEARANCE_CHOICES], ['match', 'system', 'light', 'dark']);
});

test('root element carries the resolved appearance attribute', async () => {
  assert.ok((await loadPlugin({ appearance: 'match' })).html.includes('data-appearance="match"'));
  assert.ok((await loadPlugin({ appearance: 'light' })).html.includes('data-appearance="light"'));
  assert.ok((await loadPlugin({ appearance: 'dark' })).html.includes('data-appearance="dark"'));
  assert.ok((await loadPlugin({ appearance: 'system', systemDark: true })).html.includes('data-appearance="dark"'));
  assert.ok((await loadPlugin({ appearance: 'system', systemDark: false })).html.includes('data-appearance="light"'));
});

test('card grids and chrome respond to the plugin pane width, not only the viewport', async () => {
  const { mod } = await loadPlugin({});
  const css = mod.DECK_CSS;
  assert.ok(/container-type:\s*inline-size/.test(css), 'the deck must be an inline-size query container');
  assert.ok(css.includes('@container unraid-deck (max-width:64rem)'), 'grid breakpoints must be container queries');
  const wide = css.slice(css.indexOf('@container unraid-deck (max-width:64rem)'));
  assert.ok(wide.includes('.ud-grid-4{'), 'grid-4 must reorganise with the pane width');
  assert.ok(wide.includes('.ud-grid-3{'), 'grid-3 must reorganise with the pane width');
  assert.ok(css.includes('@container unraid-deck (max-width:40rem)'), 'a narrow pane must use a container query too');
  const narrow = css.slice(css.indexOf('@container unraid-deck (max-width:40rem)'));
  assert.ok(narrow.includes('.ud-nav-right{display:none}'), 'the nav must adapt inside a narrow pane');
  assert.ok(narrow.includes('.ud-statusbar'), 'the footer must adapt inside a narrow pane');
  assert.ok(narrow.includes('.ud-topbar'), 'the header must adapt inside a narrow pane');
  assert.ok(/@media\s*\(max-width/.test(css), 'a viewport fallback must remain');
  assert.ok(!/:root\s*\{/.test(css), 'must not define global :root tokens');
  assert.ok(!/(^|})\s*body\s*[,{]/.test(css), 'must not style global body');
});

test('narrow-pane alert rows keep their title and description visible', async () => {
  const { mod, html } = await loadPlugin({ tab: 'alerts', responses: sampleResponses() });
  assert.ok(html.includes('Disk 2 utilization'));
  assert.ok(!mod.DECK_CSS.includes('.ud-detail-row>*:nth-child(2){display:none}'), 'must not hide every detail row second child, which is alert content');
  assert.ok(mod.DECK_CSS.includes('.ud-utility-row>*:nth-child(2){display:none}'), 'only three-cell utility rows may hide their middle column');
});

test('narrow-pane disk table retains a three-column device/errors/state layout', async () => {
  const { mod } = await loadPlugin({ tab: 'array', responses: sampleResponses() });
  assert.ok(mod.DECK_CSS.includes('.ud-table-head,.ud-table-row{grid-template-columns:minmax(0,1fr) auto auto}'), 'hidden temperature must leave three visible columns');
});

test('css is scoped to the plugin root and responsive', async () => {
  const { mod } = await loadPlugin({});
  const css = mod.DECK_CSS;
  assert.equal(typeof css, 'string');
  assert.ok(css.includes('.unraid-deck[data-appearance="light"]'), 'light palette must be scoped');
  assert.ok(css.includes('.unraid-deck[data-appearance="dark"]'), 'dark palette must be scoped');
  assert.ok(!/:root\s*\{/.test(css), 'must not define global :root tokens');
  assert.ok(!/(^|})\s*body\s*[,{]/.test(css), 'must not style global body');
  assert.ok(/@media\s*\(max-width/.test(css), 'must include a narrow-viewport media query');
  const mobileCss = css.slice(css.indexOf('@media(max-width:40rem)'));
  assert.ok(mobileCss.includes('.ud-nav-right{display:none}'), 'mobile navigation should hide secondary API label');
});

test('configured page exposes all five tabs, refresh, and the appearance control', async () => {
  const { html } = await loadPlugin({ tab: 'overview', responses: sampleResponses() });
  for (const label of ['Overview', 'Array', 'Docker', 'VMs', 'Alerts', 'Refresh']) {
    assert.ok(html.includes(label), `expected ${label} control`);
  }
  for (const choice of ['Match Desktop', 'System', 'Light', 'Dark']) {
    assert.ok(html.includes(choice), `expected appearance choice ${choice}`);
  }
  assert.ok((html.match(/role="tab"/g) || []).length === 5, 'expected exactly five tabs');
});

test('unconfigured state shows setup guidance and hides the tabs', async () => {
  const { html } = await loadPlugin({ responses: { health: { configured: false, message: 'UNRAID_URL is not configured.' } } });
  assert.ok(html.includes('Connect a read-only Unraid API key'));
  assert.ok(!/role="tab"/.test(html), 'tabs must not render before configuration');
  assert.ok(html.includes('Refresh'), 'refresh stays available');
});

test('an endpoint error surfaces the retry state', async () => {
  const { html } = await loadPlugin({
    tab: 'overview',
    responses: sampleResponses(),
    errors: { overview: 'Could not load Unraid data. Check the connection and try again.' },
  });
  assert.ok(html.includes('Could not load Unraid data. Check the connection and try again.'));
});

test('each secondary tab still renders its own content', async () => {
  const responses = sampleResponses();
  const arrayHtml = (await loadPlugin({ tab: 'array', responses })).html;
  assert.ok(arrayHtml.includes('Storage devices') || arrayHtml.includes('Array and pools') || arrayHtml.includes('disk1'));
  const dockerHtml = (await loadPlugin({ tab: 'docker', responses })).html;
  assert.ok(dockerHtml.includes('Plex'));
  const vmsHtml = (await loadPlugin({ tab: 'vms', responses })).html;
  assert.ok(vmsHtml.includes('Windows 11'));
  const alertsHtml = (await loadPlugin({ tab: 'alerts', responses })).html;
  assert.ok(alertsHtml.includes('Disk 2 utilization'));
});
