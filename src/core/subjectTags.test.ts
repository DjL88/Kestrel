import test from 'node:test';
import assert from 'node:assert/strict';
import { MAX_TAGS, MAX_TAG_LENGTH, addTags, cleanTag, isSubjectKind, parseTagInput, removeTag, searchWords } from './subjectTags';

test('tags are tidied, split on commas and new lines, and never repeated', () => {
  assert.equal(cleanTag('  Red   Kite \n'), 'Red Kite');
  assert.equal(cleanTag('a\u0000b'), 'a b');
  assert.equal(cleanTag('x'.repeat(100)).length, MAX_TAG_LENGTH);
  assert.deepEqual(parseTagInput('Red Kite, bird of prey,\n  ,Moorland'), ['Red Kite', 'bird of prey', 'Moorland']);
  assert.deepEqual(addTags(['Red Kite'], ['red kite', 'Bird of prey', '']), ['Red Kite', 'Bird of prey'], 'first spelling wins');
  assert.deepEqual(removeTag(['Red Kite', 'Bird'], 'red kite'), ['Bird']);
});

test('there is a limit on how many tags one photo holds', () => {
  const many = Array.from({ length: 40 }, (_, index) => `tag ${index}`);
  assert.equal(addTags([], many).length, MAX_TAGS);
  assert.deepEqual(addTags(['keep'], many).slice(0, 2), ['keep', 'tag 0']);
});

test('a photo is found by its kind, tags and older subject names', () => {
  assert.deepEqual(searchWords({ subjectKind: 'wildlife', tags: ['Red Kite'], subjectNames: ['Coco', 'red kite'] }), ['Wildlife', 'Coco', 'red kite']);
  assert.deepEqual(searchWords({}), []);
  assert.equal(isSubjectKind('people'), true);
  assert.equal(isSubjectKind('person'), false);
});

test('the in-project search finds photos by tag, kind and older subject names', async () => {
  const { filterFrames, generateDemoShootFrames } = await import('./cullingEngine');
  const [a, b, c] = generateDemoShootFrames(3);
  const frames = [{ ...a, tags: ['Zebra Finch'], subjectKind: 'wildlife' as const }, { ...b, subjectNames: ['Quokka'] }, { ...c, subjectKind: 'landscape' as const }];
  const ids = (query: string) => filterFrames(frames, 'all', query).map((frame) => frame.id);
  assert.deepEqual(ids('zebra finch'), [a.id]);
  assert.deepEqual(ids('wildlife'), [a.id]);
  assert.deepEqual(ids('quokka'), [b.id]);
  assert.deepEqual(ids('landscape'), [c.id]);
});
