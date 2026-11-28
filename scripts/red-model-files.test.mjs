import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, existsSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { RED_MODEL_FILES, removeRedModels } from './red-model-files.mjs';

test('RED model files are removed from a built models folder and nothing else is', () => {
  const dist = mkdtempSync(join(tmpdir(), 'kestrel-dist-'));
  mkdirSync(join(dist, 'models'));
  for (const file of [...RED_MODEL_FILES, 'nafnet-sidd-w32-w16.onnx', 'dinov2-small-fp16.onnx']) writeFileSync(join(dist, 'models', file), 'x');
  const removed = removeRedModels(dist);
  assert.deepEqual(removed.sort(), [...RED_MODEL_FILES].sort());
  assert.ok(existsSync(join(dist, 'models', 'nafnet-sidd-w32-w16.onnx')) && existsSync(join(dist, 'models', 'dinov2-small-fp16.onnx')));
});

test('the installer lists carry no RED file', () => {
  for (const list of ['bundled-models.json', 'desktop-packs.json']) {
    const files = JSON.parse(readFileSync(new URL(`../models/${list}`, import.meta.url), 'utf8')).files.map((f) => f.file);
    assert.deepEqual(files.filter((f) => RED_MODEL_FILES.includes(f)), [], list);
  }
});
