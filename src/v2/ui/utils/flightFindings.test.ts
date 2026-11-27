import assert from 'node:assert/strict';
import test from 'node:test';
import { firstSentence, flightFindings } from './flightFindings';

test('a finding is the note\'s own first sentence, never reworded', () => {
  assert.equal(firstSentence('The subject is sharp at f/2.8. The background is busy.'), 'The subject is sharp at f/2.8.');
  assert.equal(firstSentence('  One line only  '), 'One line only');
  assert.equal(firstSentence('Is the eye sharp? Probably.'), 'Is the eye sharp?');
  assert.equal(firstSentence(''), '');
  assert.equal(firstSentence(undefined), '');
});

test('a very long sentence is cut at a word, with an ellipsis', () => {
  const long = `${'word '.repeat(40).trim()}.`;
  const point = firstSentence(long);
  assert.ok(point.length <= 111);
  assert.ok(point.endsWith('…'));
  assert.ok(!point.endsWith(' …'));
});

test('empty notes give no point, and the same point is not listed twice', () => {
  assert.deepEqual(flightFindings(['Sharp subject. More.', '', undefined, 'Sharp subject.', 'Colours look natural.']), ['Sharp subject.', 'Colours look natural.']);
  assert.deepEqual(flightFindings([null, '']), []);
});
