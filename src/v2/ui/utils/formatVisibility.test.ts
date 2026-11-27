import test from 'node:test';
import assert from 'node:assert/strict';
import { canHideFormat, readHiddenFormats, saveHiddenFormats, shownFormats } from './formatVisibility.ts';

const size = (id: string, platform: string, enabled = false) => ({ id, platform, enabled }) as never as { id: string; platform: 'instagram'; enabled: boolean };

test('hidden ready-made formats leave the list; the Original, your own and formats in use stay', () => {
  const sizes = [size('orig-3x2', 'print', true), size('ig-story', 'instagram'), size('ig-square', 'instagram', true), size('yt-wide', 'youtube'), size('custom-1', 'custom')];
  const shown = shownFormats(sizes, new Set(['ig-story', 'ig-square', 'yt-wide', 'orig-3x2', 'custom-1'])).map((s) => s.id);
  assert.deepEqual(shown, ['orig-3x2', 'ig-square', 'custom-1']);
  assert.equal(canHideFormat({ id: 'orig-3x2', platform: 'print' } as never), false);
  assert.equal(canHideFormat({ id: 'custom-1', platform: 'custom' } as never), false);
  assert.equal(canHideFormat({ id: 'ig-story', platform: 'instagram' } as never), true);
});

test('the choice is kept on this device, reversible, and damaged entries are ignored', () => {
  const data = new Map<string, string>();
  const store = { getItem: (k: string) => data.get(k) ?? null, setItem: (k: string, v: string) => { data.set(k, v); } };
  saveHiddenFormats(new Set(['ig-story', 'orig-3x2']), store);
  assert.deepEqual([...readHiddenFormats(store)], ['ig-story'], 'the Original is never stored as hidden');
  saveHiddenFormats(new Set(), store);
  assert.equal(readHiddenFormats(store).size, 0);
  data.set('inflight.v2.hiddenFormats', '{bad');
  assert.equal(readHiddenFormats(store).size, 0);
  data.set('inflight.v2.hiddenFormats', '["yt-wide", 4]');
  assert.deepEqual([...readHiddenFormats(store)], ['yt-wide']);
});
