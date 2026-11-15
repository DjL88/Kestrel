import assert from 'node:assert/strict';
import test from 'node:test';
import { EXPORT_FORMATS, LEGACY_FORMAT_IDS, PLATFORMS, customFormat, formatById, framingFor, shapeLabel, sizeLabel, toProfile } from './exportFormats';
import { SOCIAL_ICON_PATHS } from './socialIcons';
import { exportFilename } from './exportProfiles';

test('every format has a unique id and a usable size', () => {
  assert.equal(new Set(EXPORT_FORMATS.map((f) => f.id)).size, EXPORT_FORMATS.length);
  for (const f of EXPORT_FORMATS) {
    if (f.id === 'master') { assert.equal(f.width, 0); continue; }
    assert.ok(f.width >= 400 && f.width <= 4096 && f.height >= 400 && f.height <= 4096, f.id);
    assert.ok(f.quality > 0.5 && f.quality <= 1, f.id);
  }
});

test('stories are 9:16 and posts have the shape their name says', () => {
  for (const id of ['ig-story', 'fb-story', 'tt-story']) assert.equal(shapeLabel(formatById(id)!.width, formatById(id)!.height), '9:16', id);
  assert.equal(shapeLabel(1080, 1350), '4:5');
  assert.equal(shapeLabel(1080, 1080), '1:1');
  assert.equal(shapeLabel(1200, 630), '1.91:1');
  assert.equal(shapeLabel(1000, 1500), '2:3');
  assert.equal(shapeLabel(0, 0), 'Original shape');
  assert.equal(shapeLabel(1234, 777), '1.59:1');
});

test('every platform has an icon, formats that point at real icons, and at least one format', () => {
  for (const platform of PLATFORMS) {
    assert.ok(SOCIAL_ICON_PATHS[platform.id].length > 50, platform.id);
    assert.ok(EXPORT_FORMATS.some((f) => f.platform === platform.id), platform.id);
  }
  for (const f of EXPORT_FORMATS) if (f.platform) assert.ok(SOCIAL_ICON_PATHS[f.platform], f.id);
});

test('fit choices map onto the engine, and a format becomes a profile with the same size and limits', () => {
  assert.equal(framingFor('fill'), 'focus');
  assert.equal(framingFor('bars'), 'border');
  assert.equal(framingFor('keep'), 'fit');
  const x = toProfile(formatById('x-wide')!);
  assert.equal(x.maxBytes, 5_000_000);
  assert.equal(x.width, 1600);
  assert.equal(x.format, 'jpeg');
  assert.equal(exportFilename('bird.jpg', toProfile(formatById('ig-45')!), false), 'ig_bird_4x5.jpg');
  assert.equal(exportFilename('bird.NEF', toProfile(formatById('master')!), true), 'bird-preview-kestrel.png');
});

test('different formats of one photo never get the same file name', () => {
  const names = EXPORT_FORMATS.map((format) => exportFilename('bird.jpg', toProfile(format), false));
  assert.equal(new Set(names).size, names.length);
  assert.equal(exportFilename('bird.jpg', toProfile(formatById('ig-story')!), false), 'ig_bird_9x16.jpg');
  assert.equal(exportFilename('bird.jpg', toProfile(formatById('x-keep')!), false), 'x_bird_max2048.jpg');
  const custom = customFormat({ width: 1600, height: 900, fit: 'fill', format: 'jpeg', quality: 90, prefix: 'web_' });
  if ('format' in custom) assert.equal(exportFilename('bird.jpg', toProfile(custom.format), false), 'web_bird_1600x900.jpg');
});

test('saved choices from before formats map to formats that exist', () => {
  for (const next of Object.values(LEGACY_FORMAT_IDS)) assert.ok(formatById(next), next);
  assert.equal(sizeLabel(formatById('ig-34')!), '1080 × 1440 px');
  assert.equal(sizeLabel(formatById('master')!), 'Original size');
});

test('custom sizes are checked and explained', () => {
  const ok = customFormat({ width: 1600, height: 900, fit: 'fill', format: 'jpeg', quality: 90, prefix: 'web_' });
  assert.ok('format' in ok);
  if ('format' in ok) { assert.equal(ok.format.id, 'custom'); assert.equal(ok.format.quality, 0.9); assert.equal(ok.format.label, 'Custom · 1600 × 900'); }
  const png = customFormat({ width: 800, height: 800, fit: 'keep', format: 'png', quality: 60, prefix: '' });
  if ('format' in png) assert.equal(png.format.quality, 1);
  for (const bad of [{ width: 0, height: 10 }, { width: 10.5, height: 10 }, { width: NaN, height: 10 }, { width: 13000, height: 10 }, { width: 11000, height: 11000 }]) {
    const result = customFormat({ ...bad, fit: 'fill', format: 'jpeg', quality: 90, prefix: '' });
    assert.ok('error' in result, JSON.stringify(bad));
  }
  assert.ok('error' in customFormat({ width: 100, height: 100, fit: 'fill', format: 'jpeg', quality: 20, prefix: '' }));
  const unsafe = customFormat({ width: 100, height: 100, fit: 'fill', format: 'jpeg', quality: 90, prefix: 'a/b:c' });
  if ('format' in unsafe) assert.equal(unsafe.format.prefix, 'a_b_c');
});

test('a fixed shape can be turned on its side, and squares, full size and keep-shape cannot', async () => {
  const { canTurn, turnFormat, formatById, shapeLabel } = await import('./exportFormats');
  const post = formatById('ig-45')!;
  assert.equal(canTurn(post), true);
  const turned = turnFormat(post);
  assert.deepEqual([turned.width, turned.height], [1350, 1080]);
  assert.equal(shapeLabel(turned.width, turned.height), '5:4');
  assert.equal(turned.label, 'Post · 5:4', 'the name follows the shape');
  assert.deepEqual([turnFormat(turned).width, turnFormat(turned).height], [1080, 1350], 'turning twice returns to the start');
  assert.equal(canTurn(formatById('ig-11')!), false);
  assert.equal(canTurn(formatById('master')!), false);
  assert.equal(canTurn(formatById('fb-keep')!), false);
  assert.equal(turnFormat(formatById('ig-11')!), formatById('ig-11'));
});
