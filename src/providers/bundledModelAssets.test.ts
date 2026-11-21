import assert from 'node:assert/strict';
import { test } from 'node:test';
import { bundledModelUrl } from './bundledModelAssets';

test('optional subject and mask model loaders import in plain Node without Vite glob', () => {
  // Node's import.meta has no .glob. Neither a failed unit test import nor an
  // unavailable model should trigger a remote fetch or invented fallback.
  assert.equal(bundledModelUrl('yolox_tiny.onnx'), null);
  assert.equal(bundledModelUrl('u2netp.onnx'), null);
});
