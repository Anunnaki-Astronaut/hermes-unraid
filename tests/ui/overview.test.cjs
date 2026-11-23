'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { loadPlugin } = require('./harness.cjs');
const GiB = 2 ** 30;

function fixture() {
  return {
    health: { configured: true },
    overview: { data: {
      info: { os: { release: 'Linux 6.12' }, system: { model: 'Not the hostname' }, versions: { core: { unraid: '7.4.1', api: '4.37.12' } } },
      array: { state: 'STARTED', parityCheckStatus: { status: 'COMPLETED', errors: 0 } },
      notifications: { overview: { unread: { alert: 0, warning: 2, total: 2 } } },
      metrics: { cpu: { percentTotal: 18.4 }, memory: { total: String(63 * GiB), available: String(42 * GiB), used: String(44 * GiB), percentTotal: 99 } },
    } },
    hardware: { data: { info: {
      os: { hostname: 'Atlas NAS' },
      baseboard: { manufacturer: 'ASRock Rack', model: 'B650D4U', memMax: 128 * GiB },
      cpu: { manufacturer: 'AMD', vendor: 'AuthenticAMD', brand: 'AMD Ryzen 7 7700', cores: 8, threads: 16, speed: 3.8 },
      memory: { layout: [{ size: String(32 * GiB), type: 'DDR5' }, { size: 32 * GiB, type: 'DDR5' }] },
    } } },
  };
}

function view(responses, options = {}) {
  return loadPlugin({ responses, ...options }).then(p => p.mountDashboard().render());
}

function title(rendered) {
  return rendered.elements.find(({ type, props }) => type === 'h2' && props.className.includes('ud-page-title')).props.children;
}

function meter(rendered) {
  return rendered.elements.find(({ props }) => props.role === 'meter' && props['aria-label'] === 'System memory in use');
}

test('the host line uses the full Unraid OS version, not the release, API, board, or plugin version', async () => {
  const f = fixture();
  assert.equal(title(await view(f)), 'Atlas NAS · Unraid v7.4.1');
  f.overview.data.info.versions.core.unraid = ' v7.4.10-rc.2 ';
  assert.equal(title(await view(f)), 'Atlas NAS · Unraid v7.4.10-rc.2');
  f.hardware.data.info.os.hostname = '  ';
  assert.equal(title(await view(f)), 'Unraid v7.4.10-rc.2');
  f.hardware.data.info.os.hostname = 'Testbench';
  f.overview.data.info.versions.core.unraid = '';
  assert.equal(title(await view(f)), 'Testbench');
  delete f.hardware.data.info.os;
  assert.equal(title(await view(f)), 'Unraid server');
});

test('the approved summary stays first; the motherboard tile shows only reported board, CPU and load values', async () => {
  const f = fixture();
  const { html } = await view(f);
  const titles = ['Array', 'Parity check', 'Notifications', 'Motherboard / Processor', 'System Memory', 'Storage devices'];
  let previous = -1;
  for (const heading of titles) {
    const at = html.indexOf(`>${heading}</h`);
    assert.ok(at > previous, `${heading} should follow previous Overview card`);
    previous = at;
  }
  for (const text of ['ASRock Rack B650D4U', 'AMD Ryzen 7 7700', '8 cores', '16 threads', '3.8 GHz', '18.4%']) assert.ok(html.includes(text), `expected ${text}`);
  assert.doesNotMatch(html, /AMD AMD|Current load|Package temperature/);
  f.hardware.data.info.baseboard = { manufacturer: 'ASRock Rack' };
  f.hardware.data.info.cpu = { vendor: 'AuthenticAMD', cores: 0, speed: -1 };
  const partial = (await view(f)).html;
  assert.match(partial, /ASRock Rack/);
  assert.match(partial, /AuthenticAMD/);
  assert.doesNotMatch(partial, /0 cores|0 threads|-1 GHz|undefined|>B650D4U</);
});

test('denied old-schema hardware cannot degrade working Overview or preview cards', async () => {
  const f = fixture();
  const requests = [];
  const plugin = await loadPlugin({ responses: f, rest: async (path) => {
    requests.push(path);
    if (path === '/hardware') throw { detail: { code: 'graphql_error' } };
    return f[path.slice(1)] ?? { data: {} };
  } });
  const dashboard = plugin.mountDashboard();
  assert.match(dashboard.render().html, /B650D4U/);
  await dashboard.render().controls.get('Refresh').onClick();
  assert.equal(requests.filter(path => path === '/hardware').length, 1);
  assert.ok(requests.includes('/overview'));
  const { html } = dashboard.render();
  for (const text of ['Unraid v7.4.1', 'STARTED'.toLowerCase(), 'Completed', 'Notifications', '21 GiB', '42 GiB', 'Storage devices', 'Needs attention']) {
    assert.ok(html.toLowerCase().includes(text.toLowerCase()), `core data should preserve ${text}`);
  }
  assert.doesNotMatch(html, /class="ud-error"|Synthetic GraphQL error|Atlas NAS|B650D4U|64 GiB DDR5/);
});

test('memory distinguishes computed in-use and available from installed, usable and maximum', async () => {
  const rendered = await view(fixture());
  assert.ok(Math.abs(meter(rendered).props['aria-valuenow'] - (100 / 3)) < 0.01);
  for (const text of ['33%', 'In use', '21 GiB', 'Available', '42 GiB', '64 GiB DDR5 installed', '63 GiB usable', '128 GiB max (board reported)']) {
    assert.ok(rendered.html.includes(text), `expected ${text}`);
  }
  assert.doesNotMatch(rendered.html, /99%/);
});

test('memory distinguishes genuine zero and full usage from invalid or missing measurements', async () => {
  const f = fixture();
  const memory = f.overview.data.metrics.memory;
  for (const [available, expected] of [[memory.total, 0], [0, 100]]) {
    memory.available = available;
    assert.equal(meter(await view(f)).props['aria-valuenow'], expected);
  }
  for (const [total, available] of [[0, 0], [GiB, null], [GiB, ' '], [GiB, false], [GiB, -1], [GiB, 2 * GiB], ['9007199254740993', 0], [GiB, '1.25'], [GiB, '0x10']]) {
    f.overview.data.metrics.memory = { total, available, percentTotal: 0 };
    const rendered = await view(f);
    assert.equal(meter(rendered), undefined);
    assert.match(rendered.html, /Memory readings unavailable/);
    assert.doesNotMatch(rendered.html, />0%<|>0 GiB</);
  }
});

test('invalid or contradictory inventory cannot be presented as installed memory or a board maximum', async () => {
  const f = fixture();
  f.hardware.data.info.memory.layout = [{ size: 32 * GiB, type: 'DDR5' }, { size: null, type: 'DDR5' }];
  f.hardware.data.info.baseboard.memMax = 16 * GiB;
  const { html } = await view(f);
  assert.match(html, /63 GiB usable/);
  assert.doesNotMatch(html, /DDR5 installed|16 GiB max/);
});
