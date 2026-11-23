import assert from 'node:assert/strict';
import test from 'node:test';
import { checkColour, type Pixels } from './colourCheck';

const photo = (width = 2, height = 2): Pixels => ({
  width, height, data: new Uint8ClampedArray(width * height * 4).fill(120),
});

test('truncated and invalid preview dimensions produce no colour assertions', () => {
  const truncated = { ...photo(), data: new Uint8ClampedArray(12) };
  for (const after of [truncated, { ...photo(), width: 0 }, { ...photo(), width: 1.5 }]) {
    assert.deepEqual(checkColour({ after }), { palette: [], findings: [], monochrome: false });
  }
});

test('mismatched before and subject data cannot produce edit or subject findings', () => {
  const report = checkColour({ after: photo(), before: photo(1, 4), subject: new Float32Array(3) });
  assert.ok(report.palette.length > 0);
  assert.equal(report.findings.some(f => f.id === 'editChange' || f.id === 'subjectColour'), false);
});

test('non-finite subject confidence never produces subject colour advice', () => {
  const subject = new Float32Array([1, Number.NaN, 0, Number.POSITIVE_INFINITY]);
  const report = checkColour({ after: photo(), subject });
  assert.ok(report.palette.length > 0);
  assert.equal(report.findings.some(f => f.id === 'subjectColour'), false);
});
