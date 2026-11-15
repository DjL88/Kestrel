import assert from 'node:assert/strict';
import test from 'node:test';
import { computeHistogram } from './histogram';
import { interpretHistogram } from './histogramNotes';

const picture = (fill: (i: number) => [number, number, number], count = 4000) => {
  const data = new Uint8ClampedArray(count * 4);
  for (let i = 0; i < count; i += 1) data.set([...fill(i), 255], i * 4);
  return computeHistogram(data);
};
const spread = (i: number): [number, number, number] => { const v = 20 + ((i * 37) % 215); return [v, v, v]; };

test('a well spread picture is described as good, with nothing to fix', () => {
  const notes = interpretHistogram(picture(spread));
  assert.equal(notes.length, 1);
  assert.equal(notes[0].tone, 'good');
});

test('a dark picture is called dark, and the note says that can be on purpose', () => {
  const notes = interpretHistogram(picture((i) => { const v = 8 + (i % 50); return [v, v, v]; }));
  const dark = notes.find((note) => /dark/i.test(note.headline));
  assert.ok(dark);
  assert.match(dark!.meaning, /low-key|moody/i);
  assert.match(dark!.tryThis, /Light|Shadows/);
});

test('a bright picture is called bright, and a narrow one is called flat', () => {
  assert.ok(interpretHistogram(picture((i) => { const v = 200 + (i % 50); return [v, v, v]; })).some((n) => /bright/i.test(n.headline)));
  assert.ok(interpretHistogram(picture((i) => { const v = 118 + (i % 20); return [v, v, v]; })).some((n) => /bunched/i.test(n.headline)));
});

test('clipping is reported with its share, and listed first', () => {
  const notes = interpretHistogram(picture((i) => (i % 10 === 0 ? [255, 255, 255] : spread(i))));
  assert.equal(notes[0].tone, 'watch');
  assert.match(notes[0].headline, /pure white/);
  assert.match(notes[0].headline, /10%/);
  const blacks = interpretHistogram(picture((i) => (i % 20 === 0 ? [0, 0, 0] : spread(i))));
  assert.ok(blacks.some((n) => /pure black/.test(n.headline)));
});

test('a red tilt and a blue tilt are noted, as possible warm or cool light and not as mistakes', () => {
  const warm = interpretHistogram(picture((i) => { const v = 40 + ((i * 37) % 160); return [Math.min(255, v + 40), v, Math.max(0, v - 40)]; }));
  const cool = interpretHistogram(picture((i) => { const v = 40 + ((i * 37) % 160); return [Math.max(0, v - 40), v, Math.min(255, v + 40)]; }));
  assert.ok(warm.some((n) => /more red/.test(n.headline) && /golden hour|sunrise/i.test(n.meaning)));
  assert.ok(cool.some((n) => /more blue/.test(n.headline) && /shade|overcast/i.test(n.meaning)));
});

test('there are never more than three notes, and a tiny picture gets none', () => {
  const lots = interpretHistogram(picture((i) => (i % 3 === 0 ? [255, 255, 255] : i % 3 === 1 ? [0, 0, 0] : [250, 40, 10])));
  assert.ok(lots.length <= 3);
  assert.deepEqual(interpretHistogram(computeHistogram(new Uint8ClampedArray(40))), []);
});
