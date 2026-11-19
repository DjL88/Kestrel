import test from 'node:test';
import assert from 'node:assert/strict';
import { AUTO_MINIMUM, applyAutoTag, keepAuto, mayAutoTag, reconcileAuto, qualifiesForAutoTag, shouldAutoTag } from './autoTags';
import { confidenceWord, rankSpecies, type SpeciesLabel } from './speciesMatch';

test('only a clearly sure result is tagged automatically, and that is exactly what "likely" means', () => {
  assert.equal(shouldAutoTag(0.95), true);
  assert.equal(shouldAutoTag(0.8), true);
  assert.equal(shouldAutoTag(0.79), false);
  assert.equal(confidenceWord(AUTO_MINIMUM), 'likely');
  assert.notEqual(confidenceWord(AUTO_MINIMUM - 0.01), 'likely');
});

test('a photo is tagged automatically only when it has no tags, and never with a name removed from it before', () => {
  assert.equal(mayAutoTag({}, 'Red kite'), true);
  assert.equal(mayAutoTag({ tags: ['Moorland'] }, 'Red kite'), false, 'your own tags are never added to');
  assert.equal(mayAutoTag({ subjectNames: ['Coco'] }, 'Red kite'), false);
  assert.equal(mayAutoTag({ declinedTags: ['red KITE'] }, 'Red kite'), false);
  assert.equal(mayAutoTag({ declinedTags: ['Barn owl'] }, 'Red kite'), true);
});

test('an automatic tag is marked, kept, or removed and remembered', () => {
  const applied = applyAutoTag({}, 'Red kite');
  assert.deepEqual(applied, { tags: ['Red kite'], autoTags: ['Red kite'] });
  // The user adds their own tag: the automatic one stays marked.
  assert.deepEqual(reconcileAuto({ autoTags: ['Red kite'] }, ['Red kite', 'Moorland']), { autoTags: ['Red kite'], declinedTags: [] });
  // The user removes it: it is no longer marked, and it is remembered as declined.
  assert.deepEqual(reconcileAuto({ autoTags: ['Red kite'] }, ['Moorland']), { autoTags: [], declinedTags: ['Red kite'] });
  assert.deepEqual(reconcileAuto({ autoTags: ['Red kite'], declinedTags: ['Barn owl'] }, []), { autoTags: [], declinedTags: ['Barn owl', 'Red kite'] });
  // Keeping it makes it an ordinary tag, not a declined one.
  assert.deepEqual(keepAuto({ autoTags: ['Red kite', 'Moorland'] }, 'red kite'), ['Moorland']);
});

test('personal preferences cannot turn a close species match into an automatic tag', () => {
  const labels: SpeciesLabel[] = [
    { common: 'Red kite', scientific: 'Milvus milvus', group: 'bird', vector: '', scale: 1 },
    { common: 'Black kite', scientific: 'Milvus migrans', group: 'bird', vector: '', scale: 1 },
  ];
  const vectors = [Float32Array.of(1, 0), Float32Array.of(0, 1)];
  const nearTie = Float32Array.of(1, 0.995);
  const boosted = rankSpecies(nearTie, labels, vectors, [1.5, 0])[0];
  assert.ok(shouldAutoTag(boosted.probability), 'the personalised score appears strong');
  assert.equal(qualifiesForAutoTag(boosted, nearTie, labels, vectors), false);

  const clear = Float32Array.of(1, 0);
  const winner = rankSpecies(clear, labels, vectors, [0, 1.5])[0];
  assert.equal(qualifiesForAutoTag(winner, clear, labels, vectors), true);
  assert.equal(shouldAutoTag(Infinity), false);
});

test('only photos nobody has looked at, and with no tags of their own, are scanned', async () => {
  const { scanCandidates } = await import('./autoTags');
  const frames = [{ id: 'a', subjectKind: 'wildlife' }, { id: 'b', subjectKind: 'wildlife', speciesChecked: true }, { id: 'c', subjectKind: 'wildlife', tags: ['Moorland'] }, { id: 'd', subjectKind: 'wildlife', removedAt: 1 }, { id: 'removed-at-zero', subjectKind: 'wildlife', removedAt: 0 }, { id: 'e', subjectKind: 'wildlife', subjectNames: ['Coco'] }, { id: 'f', subjectKind: 'wildlife' }, { id: 'helicopter', subjectKind: 'other' }, { id: 'unclassified' }];
  assert.deepEqual(scanCandidates(frames).map((frame) => frame.id), ['a', 'f']);
});

test('the closed-list local model sees only wildlife; the opted-in helper may also classify unlabelled photos', async () => {
  const { scanCandidates } = await import('./autoTags');
  const frames = [{ id: 'bird', subjectKind: 'wildlife' }, { id: 'unlabelled' }, { id: 'aircraft', subjectKind: 'other' },
    { id: 'portrait', subjectKind: 'people' }, { id: 'hills', subjectKind: 'landscape' }];
  assert.deepEqual(scanCandidates(frames).map((frame) => frame.id), ['bird']);
  assert.deepEqual(scanCandidates(frames, { includeUnclassified: true }).map((frame) => frame.id), ['bird', 'unlabelled']);
});

test('after a look the photo is always marked checked, and tagged only when the model was sure', async () => {
  const { scanPatch } = await import('./autoTags');
  assert.deepEqual(scanPatch({ subjectKind: 'wildlife' }, { name: 'Red kite', probability: 0.95, kind: 'wildlife' }), { speciesChecked: true, tags: ['Red kite'], autoTags: ['Red kite'] });
  assert.deepEqual(scanPatch({}, { name: 'Red kite', probability: 0.6, kind: 'wildlife' }), { speciesChecked: true }, 'not sure enough');
  assert.deepEqual(scanPatch({}, undefined), { speciesChecked: true }, 'nothing stood out');
  assert.deepEqual(scanPatch({ declinedTags: ['Red kite'] }, { name: 'Red kite', probability: 0.99 }), { speciesChecked: true }, 'removed before');
  assert.deepEqual(scanPatch({ subjectKind: 'other' }, { name: 'Osprey', probability: 0.99, kind: 'wildlife' }), { speciesChecked: true }, 'a helicopter must not become an osprey');
  assert.deepEqual(scanPatch({ subjectKind: 'wildlife', removedAt: 0 }, { name: 'Osprey', probability: 0.999, kind: 'wildlife' }), { speciesChecked: true }, 'epoch-zero removed photos must not get a late species tag');
  assert.deepEqual(scanPatch({ subjectKind: 'wildlife', removedAt: 123 }, { name: 'Osprey', probability: 0.999, kind: 'wildlife' }), { speciesChecked: true }, 'other removed photos must not get a late species tag');
  assert.deepEqual(scanPatch({ subjectKind: 'wildlife', tags: ['My bird'] }, { name: 'Osprey', probability: 0.999, kind: 'wildlife' }), { speciesChecked: true }, 'manual tags always win');

  assert.deepEqual(scanPatch({}, { name: 'Osprey', probability: 0.999, kind: 'wildlife' }), { speciesChecked: true }, 'an unknown subject cannot be classified by a species-only model');
  assert.deepEqual(scanPatch({ subjectKind: 'wildlife' }, { name: 'Human', probability: 0.99, kind: 'people' }), { speciesChecked: true }, 'a conflicting species cannot overwrite the user category');
});

test('a card shows an automatic species, or the first tag of a wildlife photo, and nothing for others', async () => {
  const { speciesShown } = await import('./autoTags');
  assert.deepEqual(speciesShown({ subjectKind: 'wildlife', autoTags: ['Red kite'], tags: ['Red kite'] }), { name: 'Red kite', auto: true });
  assert.equal(speciesShown({ subjectKind: 'other', autoTags: ['Osprey'], tags: ['Osprey'] }), null,
    'a legacy helicopter wrong-tag must not be shown as a bird');
  assert.equal(speciesShown({ autoTags: ['Osprey'] }), null,
    'unclassified images must not inherit closed-world bird certainty');
  assert.deepEqual(speciesShown({ subjectKind: 'wildlife', tags: ['Barn owl', 'Perched'] }), { name: 'Barn owl', auto: false });
  assert.equal(speciesShown({ subjectKind: 'people', tags: ['Sam'] }), null);
  assert.equal(speciesShown({}), null);
});
