import test from 'node:test';
import assert from 'node:assert/strict';
import { parseCustomExportDate } from './exportDateInput';

test('valid local date and time are accepted', () => {
  const date = parseCustomExportDate('2026-11-15T12:30');
  assert.ok(date instanceof Date);
  assert.equal(date.getFullYear(), 2026);
  assert.equal(date.getMonth(), 10);
  assert.equal(date.getDate(), 15);
});

test('empty and malformed custom dates cannot start export', () => {
  assert.equal(parseCustomExportDate(''), null);
  assert.equal(parseCustomExportDate('  '), null);
  assert.equal(parseCustomExportDate('not a date'), null);
  assert.equal(parseCustomExportDate('2026-13-15T12:30'), null);
});
