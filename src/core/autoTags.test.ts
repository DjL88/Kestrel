import test from 'node:test';
import assert from 'node:assert/strict';
import { AUTO_MINIMUM, applyAutoTag, keepAuto, mayAutoTag, reconcileAuto, shouldAutoTag } from './autoTags';
import { confidenceWord } from './speciesMatch';

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
