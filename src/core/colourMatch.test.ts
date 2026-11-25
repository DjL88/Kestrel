import test from 'node:test';
import assert from 'node:assert/strict';
import { coloursForHueRange, expectationForSpecies, matchSubjectColours, subjectPalette, type SubjectExpectation } from './colourMatch.ts';
import type { Pixels } from './colourCheck.ts';

const W = 20, H = 10;
/** The subject is the left half; `paint` colours it by column so it can hold two colours. */
const picture = (paint: (x: number) => [number, number, number]): Pixels => {
  const data = new Uint8ClampedArray(W * H * 4);
  for (let p = 0; p < W * H; p += 1) {
    const x = p % W;
    const [r, g, b] = x < W / 2 ? paint(x) : [60, 120, 60];
    data.set([r, g, b, 255], p * 4);
  }
  return { data, width: W, height: H };
};
const subject = () => Float32Array.from({ length: W * H }, (_, p) => (p % W < W / 2 ? 1 : 0));
const robin: SubjectExpectation = { subject: 'robin', source: 'vision', parts: [{ part: 'breast', colours: ['orange'] }, { part: 'back', colours: ['brown'] }] };

test('a robin with an orange breast and brown back matches what a robin should look like', () => {
  const result = matchSubjectColours(robin, picture((x) => (x < 4 ? [225, 120, 50] : [110, 85, 60])), subject());
  assert.equal(result?.verdict, 'matches');
  assert.deepEqual(result?.parts.map((part) => part.verdict), ['matches', 'matches']);
});

test('the background is never counted as the subject', () => {
  // A grey subject on a green background: no orange or brown on the subject itself.
  const result = matchSubjectColours(robin, picture(() => [128, 128, 128]), subject());
  assert.equal(result?.verdict, 'differs');
  assert.deepEqual(result?.measured.map((entry) => entry.family), ['grey']);
});

test('an orange breast in shade, which is named brown, still counts as orange', () => {
  const result = matchSubjectColours({ ...robin, parts: [robin.parts[0]] }, picture(() => [120, 70, 35]), subject());
  assert.equal(result?.verdict, 'matches');
});

test('a colour covering only a sliver of the subject does not count', () => {
  // Half of one column orange (5% of the subject), the rest blue: below the 8% minimum, so orange is not there.
  const sliver = picture(() => [40, 80, 200]);
  for (let y = 0; y < H / 2; y += 1) sliver.data.set([225, 120, 50, 255], (y * W) * 4);
  const palette = subjectPalette(sliver, subject())!;
  assert.equal(palette[0].family, 'blue');
  assert.equal(palette.find((entry) => entry.family === 'orange')?.share, 0.05);
  const result = matchSubjectColours({ ...robin, parts: [{ part: 'breast', colours: ['orange'] }] }, sliver, subject());
  assert.equal(result?.verdict, 'differs');
  assert.deepEqual(result?.measured.map((entry) => entry.family), ['blue']);
});

test('no subject, a tiny subject or no expected colours makes no claim', () => {
  assert.equal(matchSubjectColours(robin, picture(() => [225, 120, 50]), new Float32Array(W * H)), null);
  assert.equal(matchSubjectColours({ ...robin, parts: [] }, picture(() => [225, 120, 50]), subject()), null);
  assert.equal(matchSubjectColours(robin, { data: new Uint8ClampedArray(4), width: 1, height: 1 }, subject()), null);
});

test('species signatures become an expectation only for a confidently named species', () => {
  const sure = expectationForSpecies({ common: 'European robin', probability: 0.95, runnerUp: 0.02 });
  assert.equal(sure?.source, 'speciesSignature');
  assert.equal(sure?.parts[0].part, 'breast');
  // Named by the colour at full strength: a robin's breast is orange, not brown.
  assert.equal(sure?.parts[0].colours[0], 'orange');
  assert.equal(expectationForSpecies({ common: 'European robin', probability: 0.6, runnerUp: 0.3 }), null);
  assert.equal(expectationForSpecies({ common: 'Grey heron', probability: 0.99, runnerUp: 0 }), null);
  assert.equal(expectationForSpecies(null), null);
  assert.equal(expectationForSpecies({ common: 'Goldfinch', probability: 0.95, runnerUp: 0.01 })?.parts[0].part, 'face');
  assert.equal(expectationForSpecies({ common: 'Yellowhammer', probability: 0.95, runnerUp: 0.01 })?.parts[0].part, 'head');
});

test('the colour names for a signature hue range come from the same colour wheel the app names colours with', () => {
  assert.ok(coloursForHueRange([92, 108], 0.09).includes('yellow'));
  assert.ok(!coloursForHueRange([92, 108], 0.09).includes('blue'));
});
