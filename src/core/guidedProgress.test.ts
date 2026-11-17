import assert from 'node:assert/strict';
import { test } from 'node:test';
import { guidedStep } from './guidedProgress';

test('an empty project has nothing to guide towards', () => {
  assert.equal(guidedStep({ all: 0, unreviewed: 0, keep: 0 }, 0), 'empty');
});

test('any unreviewed photo means reviewing, whatever else is true', () => {
  assert.equal(guidedStep({ all: 10, unreviewed: 1, keep: 9 }, 0), 'reviewing');
  assert.equal(guidedStep({ all: 10, unreviewed: 10, keep: 0 }, 0), 'reviewing');
});

test('everything decided but nothing kept has nothing constructive to suggest', () => {
  assert.equal(guidedStep({ all: 10, unreviewed: 0, keep: 0 }, 0), 'none');
});

test('decided, with keepers, and some unedited: improving', () => {
  assert.equal(guidedStep({ all: 10, unreviewed: 0, keep: 5 }, 3), 'improving');
  // Even one unedited keeper out of many is still "improving", not "ready".
  assert.equal(guidedStep({ all: 10, unreviewed: 0, keep: 5 }, 1), 'improving');
});

test('decided, with keepers, all already edited: ready', () => {
  assert.equal(guidedStep({ all: 10, unreviewed: 0, keep: 5 }, 0), 'ready');
});
