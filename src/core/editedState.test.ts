import assert from 'node:assert/strict';
import test from 'node:test';
import { isEdited } from './editedState';
import { DEFAULT_EDIT } from './photoEdits';
import { DEFAULT_FRAMING } from './photoFraming';
import { createMask } from './maskTypes';
import { formatProjectDate } from './formatDate';

test('untouched, neutral and default-framed photos are not marked as edited', () => {
  assert.equal(isEdited({}), false);
  assert.equal(isEdited({ edit: DEFAULT_EDIT, framing: DEFAULT_FRAMING }), false);
});

test('any adjustment, crop or rotation marks a photo as edited', () => {
  assert.equal(isEdited({ edit: { ...DEFAULT_EDIT, shadows: 0.5 } }), true);
  assert.equal(isEdited({ edit: { ...DEFAULT_EDIT, sharpen: 1 } }), true);
  assert.equal(isEdited({ framing: { ...DEFAULT_FRAMING, ratio: 1.25 } }), true);
  assert.equal(isEdited({ framing: { ...DEFAULT_FRAMING, turns: 1 } }), true);
  assert.equal(isEdited({ framing: { ...DEFAULT_FRAMING, straighten: 1.5 } }), true);
  const mask = { ...createMask('radial', 'a'), edit: { exposure: 1 } };
  assert.equal(isEdited({ edit: { ...DEFAULT_EDIT, masks: [mask] } }), true);
  assert.equal(isEdited({ edit: { ...DEFAULT_EDIT, masks: [createMask('radial', 'b')] } }), false);
});

test('project dates are British and tolerate missing values', () => {
  assert.equal(formatProjectDate(Date.UTC(2026, 10, 15, 12)), '15 Nov 2026');
  assert.equal(formatProjectDate(undefined), 'unknown');
  assert.equal(formatProjectDate(0), 'unknown');
  assert.match(formatProjectDate(Date.UTC(2026, 10, 15, 14, 5), true), /^15 Nov 2026, \d{2}:\d{2}$/);
});
