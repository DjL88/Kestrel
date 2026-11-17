import test from 'node:test';
import assert from 'node:assert/strict';
import { QUICK_CONTROLS, changedKeys, controlFor, nudge, valueText } from './quickControls';
import { DEFAULT_EDIT } from './photoEdits';

test('every adjustment is offered once, light first and detail last', () => {
  const keys = QUICK_CONTROLS.map((entry) => entry.key);
  assert.equal(new Set(keys).size, keys.length);
  assert.deepEqual(keys.slice(0, 3), ['exposure', 'warmth', 'colour']);
  assert.equal(keys.at(-1), 'sharpen');
  assert.equal(controlFor('sharpen').min, 0, 'sharpening only goes up');
});

test('values read the way the sliders show them', () => {
  assert.equal(valueText('exposure', 1), '0.40 EV');
  assert.equal(valueText('warmth', 1), '8%');
  assert.equal(valueText('colour', -1), '-20%');
  assert.equal(valueText('contrast', 0.5), '25');
});

test('nudging steps cleanly, stays in range and avoids floating point drift', () => {
  const light = controlFor('exposure');
  assert.equal(nudge(light, 0, 1), 0.1);
  assert.equal(nudge(light, 0.3, 1), 0.4);
  let value = 0;
  for (let i = 0; i < 10; i += 1) value = nudge(light, value, 1);
  assert.equal(value, 1, 'ten steps of 0.1 is exactly 1');
  assert.equal(nudge(light, 12.5, 1), 12.5, 'Exposure reaches +5 EV');
  assert.equal(nudge(light, -12.5, -1), -12.5);
  assert.equal(nudge(light, 2, 1), 2.1, 'and is no longer stopped at the old limit of 2');
  assert.equal(nudge(controlFor('sharpen'), 0, -1), 0);
  assert.equal(nudge(controlFor('contrast'), 0, -1), -0.05);
});

test('changed controls are listed so they can be found again', () => {
  assert.deepEqual(changedKeys(DEFAULT_EDIT), []);
  assert.deepEqual(changedKeys({ ...DEFAULT_EDIT, exposure: 0.3, shadows: 0.5 }), ['exposure', 'shadows']);
});
