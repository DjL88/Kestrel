import assert from 'node:assert/strict';
import test from 'node:test';
import { adviceFocus } from './adviceFocus.ts';

const landscape = { width: 300, height: 200 };
const area = { x: 0.4, y: 0.3, width: 0.2, height: 0.2 };

test('the camera’s own focus point comes first', () => {
  const focus = adviceFocus(area, landscape, { kind: 'eye', x: 0.9, y: 0.9, sure: true });
  assert.equal(focus?.kind, 'camera');
  assert.ok(focus && Math.abs(focus.x - 0.5) < 1e-9 && Math.abs(focus.y - 0.4) < 1e-9);
});

test('without the camera point, a clear eye, then an unsure eye said as such, then the subject', () => {
  assert.deepEqual(adviceFocus(undefined, landscape, { kind: 'eye', x: 0.2, y: 0.3, sure: true }), { kind: 'eye', x: 0.2, y: 0.3 });
  assert.deepEqual(adviceFocus(undefined, landscape, { kind: 'eye', x: 0.2, y: 0.3, sure: false }), { kind: 'eyeMaybe', x: 0.2, y: 0.3 });
  assert.deepEqual(adviceFocus(undefined, landscape, { kind: 'subject', box: { x: 0.2, y: 0.2, width: 0.4, height: 0.4 } }), { kind: 'subject', x: 0.4, y: 0.4 });
});

test('a portrait picture gets no camera point (the turn is not known), and the centre fallback is never ringed', () => {
  assert.equal(adviceFocus(area, { width: 200, height: 300 }, null), null);
  assert.equal(adviceFocus(undefined, landscape, { kind: 'centre' }), null);
  assert.equal(adviceFocus(undefined, landscape, null), null);
});

test('with a crop, turn, straighten or size set, the eye and subject are not ringed (they were found on the whole picture); the camera point is unchanged', () => {
  assert.equal(adviceFocus(undefined, landscape, { kind: 'eye', x: 0.2, y: 0.3, sure: true }, false), null);
  assert.equal(adviceFocus(undefined, landscape, { kind: 'subject', box: { x: 0.2, y: 0.2, width: 0.4, height: 0.4 } }, false), null);
  assert.equal(adviceFocus(area, landscape, null, false)?.kind, 'camera');
});
