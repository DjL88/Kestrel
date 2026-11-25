import assert from 'node:assert/strict';
import test from 'node:test';
import { maskSubjectWord, subjectMaskShapeKey } from './maskVerify.ts';
import { createSubjectMask } from '../../core/maskTypes.ts';
import type { PhotoFrame } from '../../core/types.ts';

const frame = (extra: Partial<PhotoFrame>) => ({ id: 'f', filename: 'a.jpg', ...extra }) as unknown as PhotoFrame;

test('the mask questions name the subject as plainly as the photo allows', () => {
  assert.equal(maskSubjectWord(frame({ subjectNames: ['Red Kite'] })), 'Red Kite');
  assert.equal(maskSubjectWord(frame({ subjectKind: 'wildlife' })), 'animal');
  assert.equal(maskSubjectWord(frame({ subjectKind: 'people' })), 'person');
  assert.equal(maskSubjectWord(frame({})), 'main subject');
  assert.equal(maskSubjectWord(frame({ subjectKind: 'landscape' })), null, 'a landscape has no subject to cover');
});

test('the guardian is asked again only when the mask shape changes, not its edit', () => {
  const mask = createSubjectMask('m', { w: 2, h: 2, data: 'AAAA' }, 'k', 'high');
  const key = subjectMaskShapeKey(frame({}), mask);
  assert.equal(subjectMaskShapeKey(frame({}), { ...mask, edit: { exposure: 1 } }), key);
  assert.notEqual(subjectMaskShapeKey(frame({}), { ...mask, strokes: [{ mode: 'add', size: 0.1, points: [{ x: 0.5, y: 0.5 }] }] as never }), key);
  assert.notEqual(subjectMaskShapeKey(frame({}), { ...mask, grid: { w: 2, h: 2, data: '////' } }), key);
});
