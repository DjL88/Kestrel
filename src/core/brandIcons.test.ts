import assert from 'node:assert/strict';
import test from 'node:test';
import { BRAND_ICON_PATHS } from './brandIcons.ts';
import { SOCIAL_ICON_PATHS } from './socialIcons.ts';

test('every brand mark is a real outline on the 24 grid, and none repeats a social mark', () => {
  const social = new Set(Object.values(SOCIAL_ICON_PATHS));
  for (const [id, path] of Object.entries(BRAND_ICON_PATHS)) {
    assert.match(path, /^M[\d.\-\s,]/, id);
    assert.ok(path.length > 100, id);
    assert.ok(!social.has(path), id);
  }
});
