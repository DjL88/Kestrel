import assert from 'node:assert/strict';
import test from 'node:test';
import { judgePreview, measurePreview, scorePreview, scoreWithSubjects, type CullEvidence, type CullSuggestion, type SubjectFinding } from './autoCull';
import { finaliseCullEvidence } from './cullEvidenceFinal';
import { currentCullObservation, readCullObservation, recordCullObservations, rescoreFromObservations, withoutEvidence } from './cullObservationStore';
import { createEmptyProject } from './projects';
import type { PhotoFrame } from './types';

const MODEL = 'a'.repeat(64);
const frame = (id: string, patch?: Partial<PhotoFrame>): PhotoFrame => ({
  id, filename: `${id}.jpg`, stableKey: `key-${id}`, exif: {}, sequenceIndex: 0, decision: 'unreviewed',
  burstGroupId: null, burstIndex: 0, burstCount: 1, isDemo: false, sourceKind: 'file', ...patch,
});
const project = (...frames: PhotoFrame[]) => ({ ...createEmptyProject('p', 'Shoot'), frames, keeperTarget: 10 });

/** A synthetic opaque picture: a checkerboard of `contrast`, with `clip` of the rows pure black. */
function picture(contrast: number, clip = 0, size = 96): Uint8ClampedArray {
  const pixels = new Uint8ClampedArray(size * size * 4);
  for (let y = 0; y < size; y += 1) for (let x = 0; x < size; x += 1) {
    const j = (y * size + x) * 4;
    const value = y < clip * size ? 0 : 128 + ((x + y) % 2 ? contrast : -contrast);
    pixels[j] = pixels[j + 1] = pixels[j + 2] = value; pixels[j + 3] = 255;
  }
  return pixels;
}

const sharpBird: SubjectFinding = { label: 'bird', score: 0.9, size: 400, sharpness: 20 };
const softBird: SubjectFinding = { label: 'bird', score: 0.9, size: 400, sharpness: 5 };
const scene: [string, Uint8ClampedArray, SubjectFinding[]][] = [
  ['a', picture(40), [sharpBird]], ['b', picture(3), [softBird]], ['c', picture(20, 0.3), [sharpBird, softBird]],
  ['d', picture(60), []], ['e', picture(25), [{ label: 'unknown', score: 0.2, size: 30, sharpness: 2 }]],
];

/** What a scan does with these numbers, the same steps as browserAutoCull.ts. */
function scan(duplicates: ReadonlySet<string>) {
  const outcome = new Map<string, CullSuggestion>();
  const bases = new Map<string, CullSuggestion>();
  for (const [id, pixels, found] of scene) {
    const base = scorePreview(id, pixels, 96, 96);
    bases.set(id, base);
    outcome.set(id, scoreWithSubjects(base, found));
  }
  const evidence = new Map<string, CullEvidence>();
  for (const [id, result] of outcome) if (result.evidence) evidence.set(id, result.evidence);
  return { results: finaliseCullEvidence(scene.map(([id]) => id), outcome, duplicates, bases, true), evidence };
}

test('scorePreview is measurePreview then judgePreview, and carries its numbers', () => {
  for (const [id, pixels] of scene) {
    const measured = measurePreview(pixels, 96, 96)!;
    const scored = scorePreview(id, pixels, 96, 96);
    assert.deepEqual(scored.evidence, { preview: measured });
    assert.deepEqual(withoutEvidence([scored])[0], judgePreview(id, measured));
  }
  assert.equal(measurePreview(new Uint8ClampedArray(10), 2, 2), null);
  assert.equal(scorePreview('x', new Uint8ClampedArray(10), 2, 2).evidence, undefined);
});

test('judging stored observations again gives exactly what the scan gave, with no new scan', () => {
  const duplicates = new Set(['e']);
  const first = scan(duplicates);
  const frames = scene.map(([id]) => frame(id));
  const stored = recordCullObservations(project(...frames), frames, { evidence: first.evidence, duplicates }, MODEL, true, 1000);
  assert.ok(stored.frames.every((f) => f.cullObservation));
  assert.deepEqual(stored.frames.map((f) => f.decision), frames.map((f) => f.decision), 'recording never decides');
  const again = rescoreFromObservations(stored.frames, MODEL, true);
  assert.deepEqual(again.missing, []);
  assert.deepEqual(again.results, withoutEvidence(first.results));
  // Survives a save and reload as plain JSON.
  const reloaded = JSON.parse(JSON.stringify(stored.frames)) as PhotoFrame[];
  assert.deepEqual(rescoreFromObservations(reloaded, MODEL, true).results, again.results);
});

test('a threshold or scorer change re-ranks from storage: the numbers, not the old score, are kept', () => {
  const frames = [frame('a')];
  const { evidence } = scan(new Set());
  const stored = recordCullObservations(project(...frames), frames, { evidence, duplicates: new Set() }, MODEL, true, 1).frames;
  const observation = stored[0].cullObservation!;
  assert.equal(typeof observation.preview!.detail, 'number');
  assert.deepEqual(observation.subjects, [sharpBird]);
  assert.equal(JSON.stringify(observation).includes('score":9'), false, 'no stored verdict');
  // Softer subject numbers on the same photo judge differently without looking at it again.
  const softer = [{ ...stored[0], cullObservation: { ...observation, subjects: [softBird] } }];
  assert.equal(rescoreFromObservations(softer, MODEL, true).results[0].reason, 'subjectSoft');
  assert.equal(rescoreFromObservations(softer, MODEL, true).results[0].decision, null, 'soft stays for review, never rejected');
});

test('old projects, changed files, a new detector and damaged numbers are scanned once more, never judged', () => {
  const { evidence } = scan(new Set());
  const frames = [frame('a'), frame('b')];
  const stored = recordCullObservations(project(...frames), frames, { evidence, duplicates: new Set() }, MODEL, true, 1).frames;
  const [a, b] = stored;
  const cases: PhotoFrame[] = [
    frame('old'),
    { ...a, stableKey: 'replaced' },
    { ...a, originalSha256: 'f'.repeat(64) },
    { ...b, cullObservation: { ...b.cullObservation!, preview: { detail: Number.NaN, dark: 0, bright: 0 } } },
    { ...b, cullObservation: { ...b.cullObservation!, subjects: [{ label: 'bird', score: 7, size: 400, sharpness: 20 }] } },
    { ...b, cullObservation: { ...b.cullObservation!, v: 2 as 1 } },
  ];
  const outcome = rescoreFromObservations(cases, MODEL, true);
  assert.deepEqual(outcome.results, []);
  assert.equal(outcome.missing.length, cases.length);
  assert.equal(currentCullObservation(a, 'b'.repeat(64), true), null, 'another detector build');
  assert.equal(readCullObservation({ v: 1, model: MODEL, stableKey: 'k', at: 1, subjects: null }), null, 'no numbers');
});

test('without the detector, a scan and a re-judge both fall back to review-only suggestions', () => {
  const frames = scene.map(([id]) => frame(id));
  const outcome = new Map<string, CullSuggestion>();
  const evidence = new Map<string, CullEvidence>();
  for (const [id, pixels] of scene) {
    const base = scorePreview(id, pixels, 96, 96);
    outcome.set(id, base);
    evidence.set(id, base.evidence!);
  }
  const scanned = finaliseCullEvidence(frames.map((f) => f.id), outcome, new Set(), outcome, false);
  const stored = recordCullObservations(project(...frames), frames, { evidence, duplicates: new Set() }, MODEL, false, 1).frames;
  assert.ok(stored.every((f) => f.cullObservation?.subjects === null && f.cullObservation.model === 'none'));
  const again = rescoreFromObservations(stored, MODEL, false);
  assert.deepEqual(again.results, withoutEvidence(scanned));
  assert.ok(again.results.every((r) => r.confidence !== 'high' && r.decision === null));
  // Once the detector is back, those photos are looked at again rather than judged without subjects.
  assert.equal(rescoreFromObservations(stored, MODEL, true).missing.length, stored.length);
});

test('a photo replaced while the scan ran, or one the scan could not read, keeps what it had', () => {
  const { evidence } = scan(new Set());
  const examined = [frame('a'), frame('b')];
  const live = project(frame('a', { stableKey: 'moved' }), frame('b'), frame('z'));
  const stored = recordCullObservations(live, examined, { evidence: new Map([['b', evidence.get('b')!]]), duplicates: new Set() }, MODEL, true, 1);
  assert.equal(stored.frames[0].cullObservation, undefined);
  assert.ok(stored.frames[1].cullObservation);
  assert.equal(stored.frames[2].cullObservation, undefined);
  assert.equal(recordCullObservations(live, examined, { evidence: new Map(), duplicates: new Set() }, MODEL, true, 1), live);
});
