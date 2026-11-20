import assert from 'node:assert/strict';
import test from 'node:test';
import { canUseWideWorkspace, WIDE_WORKSPACE_QUERY } from './workspaceLayout';

test('landscape tablet and wide foldable use the desktop workspace when room allows', () => {
  for (const [width, height] of [[800, 550], [820, 600], [1024, 768], [1280, 800], [840, 440]]) {
    assert.equal(canUseWideWorkspace(width, height), true, `${width}×${height}`);
  }
});

test('phones, narrow book folds and short landscape windows stay compact', () => {
  for (const [width, height] of [[320, 600], [375, 812], [768, 520], [799, 900], [839, 439], [932, 430], [Number.NaN, 600]]) {
    assert.equal(canUseWideWorkspace(width, height), false, `${width}×${height}`);
  }
  assert.match(WIDE_WORKSPACE_QUERY, /800px/);
});
