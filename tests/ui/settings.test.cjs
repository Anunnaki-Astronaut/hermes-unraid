'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { readFileSync } = require('node:fs');
const { join } = require('node:path');
const { loadPlugin, ROOT } = require('./harness.cjs');

function activate(view, name) {
  const control = view.controls.get(name);
  assert.ok(control, `Missing native button: ${name}`);
  assert.equal(control.type, 'button');
  assert.ok(control.tabIndex == null || control.tabIndex >= 0);
  assert.ok(!control.disabled);
  control.onClick();
}

test('dashboard and Settings show four distinct appearance icons without visible button labels', async () => {
  const plugin = await loadPlugin();
  const labels = ['Match Desktop', 'System', 'Light', 'Dark'];
  for (const view of [plugin.mountDashboard().render(), plugin.mountSettings().render()]) {
    const group = view.elements.find(({ props }) => props.role === 'group' && props['aria-label'] === 'Appearance mode');
    assert.ok(group);
    assert.deepEqual(Array.from(group.props.children, (button) => button.props['aria-label']), labels);
    const icons = labels.map((label) => {
      const button = view.controls.get(label);
      assert.equal(button.title, label);
      assert.equal(button.children.type, 'svg');
      assert.equal(button.children.props['aria-hidden'], true);
      const path = button.children.props.children.props;
      if (label === 'Light') {
        assert.equal(button.children.props.viewBox, '0 0 32 32');
        assert.equal(path.fill, 'currentColor');
        assert.equal(path.transform, 'matrix(1 0 0 1 2.281 2.223)');
      }
      return path.d;
    });
    assert.equal(new Set(icons).size, 4);
  }
});

test('dashboard masthead uses the sidebar server glyph and shared Settings gear without a subtitle', async () => {
  const plugin = await loadPlugin();
  const sidebarIcon = plugin.registrations.find(({ id }) => id === 'nav').data.codicon;
  const { html, controls } = plugin.mountDashboard().render();
  assert.match(html, /class="ud-logo"[^>]*>\s*<i[^>]*class="codicon codicon-server"/);
  assert.equal(sidebarIcon, 'server');
  assert.match(html, /<h1[^>]*>Hermes for Unraid<\/h1>/);
  assert.doesNotMatch(html, /Read-only server monitoring/);
  const gear = controls.get('Unraid Settings').children;
  assert.equal(gear.type, 'svg');
  assert.equal(gear.props['aria-hidden'], true);
  assert.equal(gear.props.viewBox, '0 0 32 32');
  assert.equal(gear.props.children.props.fill, 'currentColor');
  assert.equal(gear.props.children.props.transform, 'matrix(1 0 0 1 1.819 2.04)');
  assert.match(html, /Read-only safety mode/);
});

test('the dashboard title version and Settings both track the plugin release manifest', async () => {
  const plugin = await loadPlugin();
  const version = /^version: ([^\r\n]+)$/m.exec(readFileSync(join(ROOT, 'plugin.yaml'), 'utf8'))[1];
  const dashboard = plugin.mountDashboard().render();
  const title = dashboard.elements.find(({ type, props }) => type === 'h1' && props.className === 'ud-app-title');
  const label = dashboard.elements.find(({ type, props }) => type === 'span' && props.className === 'ud-app-version');
  const group = dashboard.elements.find(({ props }) => props.className === 'ud-brand-title');
  assert.ok(title && label && group);
  assert.deepEqual(Array.from(group.props.children, (child) => child.props.className), ['ud-app-title', 'ud-app-version']);
  assert.equal(label.props.children, `Plugin v${version}`);
  assert.ok(plugin.mountSettings().render().html.includes(`>v${version}</span>`));
});

test('the Unraid Settings gear opens the registered native page, including before setup', async () => {
  for (const configured of [true, false]) {
    const plugin = await loadPlugin({ responses: { health: { configured } } });
    const dashboard = plugin.mountDashboard().render();
    activate(dashboard, 'Unraid Settings');
    assert.deepEqual(plugin.navigations, ['/settings?tab=plugins&plugin=unraid']);
    assert.equal(plugin.settingsPages.length, 1);
    assert.equal(plugin.settingsPages[0].title, 'Unraid');
    assert.equal(plugin.settingsPages[0].children?.length ?? 0, 0);
    assert.deepEqual(plugin.forbiddenCalls, []);
  }
});

test('native Settings is read-only and hands navigation back to Hermes', async () => {
  const accesses = [];
  const plugin = await loadPlugin({ storage: {
    get(key) { accesses.push(['get', key]); return undefined; },
    set(key) { accesses.push(['set', key]); },
  } });
  accesses.length = 0;
  assert.equal(plugin.settingsPages.length, 1);
  const settings = plugin.mountSettings();
  const { html, controls, elements } = settings.render();
  const version = /^version: ([^\r\n]+)$/m.exec(readFileSync(join(ROOT, 'plugin.yaml'), 'utf8'))[1];
  assert.ok(html.includes(`v${version}`));
  assert.match(html, /<h1[^>]*>Settings<\/h1>/);
  assert.match(html, /<h2[^>]*>Connections<\/h2>/);
  assert.match(html, /<h2[^>]*>Appearance<\/h2>/);
  for (const guidance of ['/graphql', 'read-only Viewer API key', 'HTTPS by default', 'off by default', 'trusted', 'selected profile']) {
    assert.ok(html.includes(guidance), `Missing guidance: ${guidance}`);
  }
  assert.doesNotMatch(html, /<(form|textarea)\b|href="https?:/i);
  assert.ok(elements.filter(({ type }) => type === 'input').every(({ props }) => /^(Light|Dark) .+ (hex|swatch)$/.test(props['aria-label'])));
  activate({ controls }, 'Open Agent settings');
  activate({ controls }, 'Back to Unraid dashboard');
  assert.deepEqual(plugin.navigations, ['/settings?tab=plugins&agent=unraid', '/unraid']);
  assert.equal(plugin.registrations.find(({ id }) => id === 'page').data.path, '/unraid');
  assert.deepEqual(accesses, [['get', 'unraid.appearance']]);
  assert.deepEqual(plugin.forbiddenCalls, []);
  settings.unmount();
});

test('a host without the native Settings registrar retains dashboard controls without a dead gear', async () => {
  const plugin = await loadPlugin({ legacyHost: true });
  const { controls } = plugin.mountDashboard().render();
  assert.ok(controls.has('Match Desktop'));
  assert.ok(controls.has('Refresh'));
  assert.ok(!controls.has('Unraid Settings'));
});

test('all four Settings modes update only unraid.appearance and carry over to the dashboard', async () => {
  const values = new Map([['unraid.appearance', 'dark']]);
  const writes = [];
  const reads = [];
  const plugin = await loadPlugin({ systemDark: true, storage: {
    get(key) { reads.push(key); return values.get(key); },
    set(key, value) { writes.push([key, value]); values.set(key, value); },
  } });
  const settings = plugin.mountSettings();
  assert.equal(settings.render().controls.get('Dark')['aria-pressed'], true, 'honors the saved dashboard choice');
  for (const [label, choice, resolved] of [['Match Desktop', 'match', 'match'], ['System', 'system', 'dark'], ['Light', 'light', 'light'], ['Dark', 'dark', 'dark']]) {
    activate(settings.render(), label);
    const { html, controls } = settings.render();
    assert.ok(html.includes(`data-appearance="${resolved}"`));
    assert.equal(controls.get(label)['aria-pressed'], true);
    assert.equal(['Match Desktop', 'System', 'Light', 'Dark'].filter((name) => controls.get(name)['aria-pressed']).length, 1);
    assert.deepEqual(writes.at(-1), ['unraid.appearance', choice]);
    assert.ok(plugin.mountDashboard().render().html.includes(`data-appearance="${resolved}"`));
  }
  const dashboard = plugin.mountDashboard().render();
  activate(dashboard, 'Light');
  settings.unmount();
  const remount = plugin.mountSettings();
  assert.equal(remount.render().controls.get('Light')['aria-pressed'], true);
  assert.deepEqual(writes, ['match', 'system', 'light', 'dark', 'light'].map((choice) => ['unraid.appearance', choice]));
  assert.deepEqual([...new Set(reads)].sort(), ['unraid.appearance', 'unraid.palette.v1.default.dark', 'unraid.palette.v1.default.light']);
  assert.deepEqual(plugin.forbiddenCalls, []);
  remount.unmount();
});

test('System responds to an OS appearance change without changing the saved choice', async () => {
  const plugin = await loadPlugin({ storage: { get: () => 'system', set() { assert.fail('OS changes must not write storage'); } } });
  const settings = plugin.mountSettings();
  assert.match(settings.render().html, /data-appearance="light"/);
  plugin.setSystemDark(true);
  assert.match(settings.render().html, /data-appearance="dark"/);
  assert.equal(settings.render().controls.get('System')['aria-pressed'], true);
  plugin.setSystemDark(false);
  assert.match(settings.render().html, /data-appearance="light"/);
  settings.unmount();
  assert.equal(plugin.systemListeners(), 0);
  assert.deepEqual(plugin.forbiddenCalls, []);
});

test('an invalid saved appearance resolves to Match Desktop without a write', async () => {
  const plugin = await loadPlugin({ storage: { get: () => 'invalid', set() { assert.fail('Invalid storage must not trigger a write'); } } });
  const settings = plugin.mountSettings();
  const { controls, html } = settings.render();
  assert.match(html, /data-appearance="match"/);
  assert.equal(controls.get('Match Desktop')['aria-pressed'], true);
  settings.unmount();
});
