'use strict';
const assert = require('node:assert/strict');
const test = require('node:test');
const { loadPlugin } = require('./harness.cjs');

async function fixture(options = {}) {
  const values = options.values || new Map([['unraid.appearance', 'dark']]);
  const writes = [];
  const plugin = await loadPlugin({ profile: 'sample-a', ...options, storage: {
    get(key) { return values.get(key); },
    set(key, value) { writes.push([key, value]); if (!options.blockWrites) values.set(key, value); },
  } });
  const settings = plugin.mountSettings();
  const render = () => settings.render();
  const button = (name) => {
    const control = render().controls.get(name);
    assert.ok(control, `Missing button: ${name}`);
    return control;
  };
  const input = (name) => {
    const element = render().elements.find(({ props }) => props['aria-label'] === name);
    assert.ok(element, `Missing input: ${name}`);
    return element.props;
  };
  const change = (name, value) => input(name).onChange({ target: { value } });
  return { plugin, values, writes, render, button, press: (name) => button(name).onClick(), input, change };
}

test('Theme Maker is collapsed initially and previews the approved presets without saving', async () => {
  const f = await fixture();
  assert.match(f.render().html, /<details class="us-maker">/);
  assert.match(f.render().html, /<summary[^>]*>Theme Maker/);
  for (const name of ['Daybook', 'Dusk', 'Coast']) assert.ok(f.button(name));
  f.press('Dusk');
  assert.equal(f.input('Dark Background hex').value, '#1B1725');
  assert.match(f.render().html, /Storage preview[\s\S]*Sample data[\s\S]*38 of 80 TB/);
  assert.match(f.render().html, /Preview text passes contrast checks/);
  assert.deepEqual(f.writes, []);
});

test('drafts, reset, and applied palettes are independent in Light and Dark', async () => {
  const f = await fixture();
  f.press('Dusk');
  f.change('Dark Background hex', '#181320');
  f.change('Edit palette', 'light');
  f.press('Coast');
  f.press('Apply to Light');
  assert.equal(f.writes.length, 1);
  assert.match(f.writes[0][0], /sample-a\.light$/);
  assert.equal(f.writes[0][1].background, '#F2FAFB');
  assert.equal(f.values.get('unraid.appearance'), 'dark');
  assert.doesNotMatch(f.plugin.mountDashboard().render().html, /data-custom-palette="true"/);
  f.change('Edit palette', 'dark');
  assert.equal(f.input('Dark Background hex').value, '#181320');
  f.press('Reset to preset');
  assert.equal(f.input('Dark Background hex').value, '#1B1725');
  assert.equal(f.writes.length, 1);
  f.press('Apply to Dark');
  assert.match(f.writes[1][0], /sample-a\.dark$/);
  assert.match(f.plugin.mountDashboard().render().html, /data-custom-palette="true"[^>]*--ud-canvas:#1B1725/);
  assert.equal(f.plugin.mountSettings().render().elements.find(({ props }) => props['aria-label'] === 'Dark Background hex').props.value, '#1B1725');
  f.change('Edit palette', 'light');
  assert.equal(f.input('Light Background hex').value, '#F2FAFB');
  assert.deepEqual(f.plugin.forbiddenCalls, []);
});

test('invalid hex and unreadable text or accent never write or take over the preview', async () => {
  const f = await fixture();
  for (const [field, value, feedback] of [
    ['Background', '#ABC', /Background: enter #RRGGBB/],
    ['Text', '#111A19', /Text needs 4\.5:1 against Background/],
    ['Accent', '#111A19', /Accent needs 4\.5:1 against Background/],
    ['Selected row', '#F3F8F5', /Text needs 4\.5:1 against Selected row/],
  ]) {
    f.press('Daybook');
    f.change(`Dark ${field} hex`, value);
    assert.equal(f.button('Apply to Dark').disabled, true);
    assert.match(f.render().html, feedback);
    assert.match(f.render().html, /Preview uses the saved palette or Daybook/);
    f.press('Apply to Dark'); // invoke the handler even though the UI disables the button
    assert.deepEqual(f.writes, []);
  }
});

test('Apply reports a silent storage failure without publishing the draft', async () => {
  const f = await fixture({ blockWrites: true });
  f.press('Dusk');
  f.press('Apply to Dark');
  assert.match(f.render().html, /Palette was not saved/);
  assert.equal(f.writes.length, 1);
  assert.doesNotMatch(f.plugin.mountDashboard().render().html, /data-custom-palette="true"/);
});

test('Match Desktop ignores saved palettes and System resolves the appropriate saved palette', async () => {
  const f = await fixture();
  f.press('Dusk');
  f.press('Apply to Dark');
  f.change('Edit palette', 'light');
  f.press('Coast');
  f.press('Apply to Light');
  f.press('Match Desktop');
  assert.doesNotMatch(f.render().html, /data-custom-palette="true"/);
  f.press('System');
  assert.match(f.render().html, /data-custom-palette="true"[^>]*--ud-canvas:#F2FAFB/);
  f.plugin.setSystemDark(true);
  assert.match(f.render().html, /data-custom-palette="true"[^>]*--ud-canvas:#1B1725/);
});

test('a stale Apply handler cannot write a palette after the active profile changes', async () => {
  const f = await fixture();
  f.press('Dusk');
  const stale = f.button('Apply to Dark').onClick;
  f.plugin.setProfile('sample-b');
  stale();
  assert.deepEqual(f.writes, []);
  assert.doesNotMatch(f.plugin.mountDashboard().render().html, /data-custom-palette="true"/);
});

test('all ten built-in palettes pass contrast and malformed saved values fall back without a write', async () => {
  const f = await fixture({ values: new Map([
    ['unraid.appearance', 'dark'], ['unraid.palette.v1.sample-a.dark', { background: 'url(https://invalid.invalid)' }],
  ]) });
  assert.doesNotMatch(f.plugin.mountDashboard().render().html, /data-custom-palette="true"/);
  for (const mode of ['Dark', 'Light']) {
    f.change('Edit palette', mode.toLowerCase());
    for (const preset of ['Daybook', 'Dusk', 'Coast', 'Marigold', 'Cobalt']) {
      f.press(preset);
      assert.equal(f.button(`Apply to ${mode}`).disabled, false, `${preset} ${mode}`);
    }
  }
  assert.deepEqual(f.writes, []);
});

test('Marigold and Cobalt apply the exact five Kalends colors in both modes', async () => {
  const f = await fixture();
  for (const [preset, mode, colors] of [
    ['Marigold', 'light', '#FFF9E4 #F6E7AE #352600 #725000 #F9DF82'],
    ['Marigold', 'dark', '#211900 #342800 #FFF0BE #FFCD4E #523D00'],
    ['Cobalt', 'light', '#F1F5FF #E1E9FF #12234D #234AC5 #CFDDFF'],
    ['Cobalt', 'dark', '#10182F #1B2850 #E8F0FF #9FB4FF #304787'],
  ]) {
    const label = mode === 'light' ? 'Light' : 'Dark';
    f.change('Edit palette', mode);
    f.press(preset);
    assert.equal(f.button(`Apply to ${label}`).disabled, false);
    f.press(`Apply to ${label}`);
    assert.deepEqual(Object.values(f.writes.at(-1)[1]), colors.split(' '));
  }
});
