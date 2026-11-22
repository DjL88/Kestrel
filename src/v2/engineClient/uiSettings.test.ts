import assert from 'node:assert/strict';
import test from 'node:test';
import { parseSavedUi } from './uiSettings.ts';

test('saved interface choices are read, and anything unknown is ignored', () => {
  assert.deepEqual(parseSavedUi(null), { assistMode: undefined, settings: {} });
  assert.deepEqual(parseSavedUi('not json'), { settings: {} });
  const ui = parseSavedUi(JSON.stringify({ assistMode: 'autopilot', settings: { theme: 'light', hand: 'left', calmView: true, touchDensity: 'wide', language: 'xx', cvdGuidance: 'yes', defaultAssistMode: 'solo' } }));
  assert.equal(ui.assistMode, 'autopilot');
  assert.deepEqual(ui.settings, { theme: 'light', hand: 'left', calmView: true, defaultAssistMode: 'solo' });
});

test('a bad mode is dropped rather than trusted', () => {
  assert.equal(parseSavedUi(JSON.stringify({ assistMode: 'turbo' })).assistMode, undefined);
});
