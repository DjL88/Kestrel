import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { classifyText, judgeReadings, MAX_READS, nextStep, normaliseText, planZoom, type TextRead } from './textReading';

const reads = (...texts: Array<[string, TextRead['source']?]>): TextRead[] => texts.map(([text, source]) => ({ text, source: source ?? 'zoom' }));
const many = (text: string, n: number): TextRead[] => Array.from({ length: n }, () => ({ text, source: 'zoom-alt' as const }));

test('registrations and rings are recognised in their real formats, and ordinary words are not', () => {
  assert.deepEqual(classifyText('G-OKES'), { kind: 'uk-registration', display: 'G-OKES' });
  assert.equal(classifyText('gokes')?.display, 'G-OKES');
  for (const ok of ['N738PA', 'N12345', 'N1', 'N98Z', 'N7AB']) assert.equal(classifyText(ok)?.kind, 'us-registration', ok);
  for (const bad of ['N738PPA', 'N73RPA', 'N0123', 'N7IO', 'N123456']) assert.equal(classifyText(bad), null, bad);
  assert.equal(classifyText('D-ABCD')?.kind, 'civil-registration');
  assert.deepEqual(classifyText('EB 74918'), { kind: 'ring-like', display: 'EB 74918' });
  for (const word of ['hello', '@ www.pixshark.com', '0', 'C', '@ 2015 Google Pixel', '']) assert.equal(classifyText(word), null, word);
  assert.equal(normaliseText(' g-ok.es '), 'GOKES');
});

test('one reading is only a candidate, never agreed', () => {
  const verdict = judgeReadings(reads(['G-OKES', 'subject']));
  assert.deepEqual([verdict.state, verdict.confidence, verdict.text], ['candidate', 'low', 'GOKES']);
  assert.equal(judgeReadings(reads(['@ www.pixshark.com'])).state, 'rejected');
  assert.equal(judgeReadings([]).state, 'rejected');
});

test('two matching zoomed readings agree with high confidence', () => {
  const verdict = judgeReadings(reads(['G-OKES', 'subject'], ['G-OKES']));
  assert.deepEqual([verdict.state, verdict.confidence, verdict.display], ['agreed', 'high', 'G-OKES']);
});

test('real Florence-2 output: the passes disagree, so nothing is chosen and both are kept for the person', () => {
  const { cases } = JSON.parse(readFileSync(new URL('../../tools/vision-lab/fixtures/two-pass-real.json', import.meta.url), 'utf8')) as {
    cases: Array<{ label: string; truth: string; readings: Array<{ pass1: string; pass2: string }> }>;
  };
  const byLabel = Object.fromEntries(cases.map((c) => [c.label, c]));
  const verdictOf = (label: string) => {
    const r = byLabel[label].readings[0];
    return judgeReadings(reads([r.pass1, 'subject'], [r.pass2]));
  };
  // The reader got these right both times.
  assert.equal(verdictOf('UK registration').state, 'agreed');
  assert.equal(verdictOf('UK registration').display, 'G-OKES');
  // The zoomed pass broke a correct first reading (N738PA became N73RPA). It is not valid as a US number, so only the
  // first survives as a candidate, but with one vote it is not agreed.
  const us = verdictOf('US tail number');
  assert.equal(us.state, 'needs-review');
  assert.equal(us.text, null, 'a disagreement never picks a winner');
  assert.deepEqual(us.candidates.map((c) => c.text), ['N738PA']);
  // Both readings of the ring were wrong, and different. A single read would have stored a wrong ring silently.
  const ring = verdictOf('bird ring');
  assert.equal(ring.state, 'needs-review');
  assert.equal(ring.candidates.length, 2);
  assert.ok(!ring.candidates.some((c) => c.text === 'EB74918'), 'the true value was never read, and is not invented');
  // Blank sky: the reader found no text region, so there is nothing to judge.
  assert.deepEqual(byLabel['blank sky'].readings, []);
});

test('real zoom experiment: a tie-break at other zooms settles it by vote, and format breaks a tie', () => {
  // Counts recorded from nine reads at three paddings and three zoom sizes (tools/vision-lab, 21 Nov 2026).
  const ring = judgeReadings([...many('EB 74918', 8), ...many('EB 74919', 1)]);
  assert.deepEqual([ring.state, ring.confidence, ring.display], ['agreed', 'high', 'EB 74918']);
  const uk = judgeReadings([...many('G-OKES', 8), ...many('G-OKEES', 1)]);
  assert.deepEqual([uk.state, uk.display], ['agreed', 'G-OKES']);
  // N738PA split 4 to 5 against N738PAA, which is not a valid US number, so it cannot win. Medium, not high.
  const us = judgeReadings([...many('N738PA', 4), ...many('N738PAA', 5)]);
  assert.deepEqual([us.state, us.confidence, us.display], ['agreed', 'medium', 'N738PA']);
  // Real sequence for the ring: two wrong passes, then three tie-break reads that agree.
  const sequence = judgeReadings(reads(['EB 74018', 'subject'], ['E874918'], ['EB 74918', 'zoom-alt'], ['EB 74918', 'zoom-alt'], ['EB 74918', 'zoom-alt']));
  assert.deepEqual([sequence.state, sequence.confidence, sequence.display], ['agreed', 'medium', 'EB 74918']);
});

test('two valid readings that differ are never merged or guessed between', () => {
  const verdict = judgeReadings(reads(['G-ABCD', 'subject'], ['G-ABCO']));
  assert.equal(verdict.state, 'needs-review');
  assert.equal(verdict.text, null);
  // A tie of equal votes stays unresolved however many reads there are.
  assert.equal(judgeReadings([...many('G-ABCD', 3), ...many('G-ABCO', 3)]).state, 'needs-review');
});

test('the first reading runs once; the zoomed re-read waits for the person to interact with the photo', () => {
  assert.equal(nextStep([], { interacted: false }), 'first-pass');
  const first = reads(['G-OKES', 'subject']);
  assert.equal(nextStep(first, { interacted: false }), 'wait');
  assert.equal(nextStep(first, { interacted: true }), 'zoom');
  // Junk costs nothing more.
  assert.equal(nextStep(reads(['@ www.pixshark.com', 'subject']), { interacted: true }), 'done');
  assert.equal(nextStep(reads(['0', 'subject']), { interacted: true }), 'done');
  // Unless the reader itself doubted a text-like first reading: then one zoomed look is worth it.
  assert.equal(nextStep(reads(['EB 7491', 'subject']), { interacted: true, lowConfidence: true }), 'zoom');
});

test('agreement ends it; disagreement or doubt asks for a bounded tie-break; the budget is a hard stop', () => {
  assert.equal(nextStep(reads(['G-OKES', 'subject'], ['G-OKES']), { interacted: true }), 'done');
  assert.equal(nextStep(reads(['G-OKES', 'subject'], ['G-OKES']), { interacted: true, lowConfidence: true }), 'tie-break', 'low confidence is re-checked even when two reads agree');
  const split = reads(['EB 74018', 'subject'], ['E874918']);
  assert.equal(nextStep(split, { interacted: false }), 'wait');
  assert.equal(nextStep(split, { interacted: true }), 'tie-break');
  assert.equal(nextStep(many('EB 74018', MAX_READS - 1).concat(many('E874918', 1)), { interacted: true }), 'done', 'never more than the read budget');
  assert.equal(nextStep(split, { interacted: true, maxReads: 2 }), 'done');
});

test('zoom crops stay inside the photo, enlarge small text, and never exceed the reader input', () => {
  const image = { width: 4000, height: 2667 };
  const small = planZoom({ x1: 1620, y1: 1305, x2: 1770, y2: 1351 }, image);
  assert.ok(small.scale > 1 && small.output.width >= 256 - 1);
  assert.ok(Math.max(small.output.width, small.output.height) <= 768);
  assert.ok(small.crop.x1 < 1620 && small.crop.x2 > 1770, 'padded so edge letters are whole');
  const corner = planZoom({ x1: 0, y1: 0, x2: 80, y2: 30 }, image);
  assert.deepEqual([corner.crop.x1, corner.crop.y1], [0, 0], 'never outside the image');
  const edge = planZoom({ x1: 3950, y1: 2640, x2: 4000, y2: 2667 }, image);
  assert.ok(edge.crop.x2 <= image.width && edge.crop.y2 <= image.height);
  const huge = planZoom({ x1: 100, y1: 100, x2: 3500, y2: 2000 }, image);
  assert.equal(huge.scale, 1, 'large text is not enlarged');
  assert.notDeepEqual(planZoom({ x1: 1620, y1: 1305, x2: 1770, y2: 1351 }, image, 1).crop, small.crop, 'a tie-break uses a different crop');
});
