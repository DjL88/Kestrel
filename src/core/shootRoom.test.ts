import assert from 'node:assert/strict';
import test from 'node:test';
import { combineRoomMark, readRoomMark, roomKey, roomLinks } from './shootRoom';

const unmarked = { rating: 0, decision: 'unreviewed' as const };

test('a client star or pick is taken when the photographer has not changed that photo', () => {
  const mark = readRoomMark(JSON.stringify({ id: 'f1', base: unmarked, marks: { rating: 4, decision: 'keep' } }))!;
  assert.deepEqual(combineRoomMark(unmarked, mark), { kind: 'apply', marks: { rating: 4, decision: 'keep' } });
});

test('different things combine; the same thing changed by the photographer stays theirs', () => {
  const clientRated = readRoomMark(JSON.stringify({ id: 'f1', base: unmarked, marks: { rating: 3, decision: 'unreviewed' } }))!;
  // Photographer picked it meanwhile: both stay.
  assert.deepEqual(combineRoomMark({ rating: 0, decision: 'keep' }, clientRated), { kind: 'apply', marks: { rating: 3, decision: 'keep' } });
  // Photographer rated it 5 meanwhile: theirs stays.
  assert.deepEqual(combineRoomMark({ rating: 5, decision: 'unreviewed' }, clientRated), { kind: 'kept-photographer' });
  assert.deepEqual(combineRoomMark({ rating: 3, decision: 'unreviewed' }, clientRated), { kind: 'same' });
});

test('anything that is not exactly a room mark is ignored', () => {
  for (const text of ['', 'nope', '[]', '{"id":"f1"}', JSON.stringify({ id: '../x', base: unmarked, marks: unmarked }),
    JSON.stringify({ id: 'f1', base: unmarked, marks: { rating: 9, decision: 'keep' } }), JSON.stringify({ id: 'f1', base: unmarked, marks: { rating: 1, decision: 'delete' } })]) {
    assert.equal(readRoomMark(text), null, text);
  }
});

test('room keys are long and links name each address', () => {
  const key = roomKey();
  assert.match(key, /^[A-Za-z0-9]{24}$/);
  assert.notEqual(key, roomKey());
  assert.deepEqual(roomLinks(['192.168.1.20'], 8765, 'abc'), [{ address: '192.168.1.20', url: 'http://192.168.1.20:8765/?k=abc' }]);
});
