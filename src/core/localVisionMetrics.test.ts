import assert from 'node:assert/strict';
import test from 'node:test';
import { inferenceMs, parseLocalVisionMetrics } from './localVisionMetrics';

test('an unmeasured desktop model has no numbers at all', () => {
  const metrics = parseLocalVisionMetrics({ installed: true, revision: 'abc', digestsVerified: false, loadMs: null, loadRamBytes: null, visionMs: null, generateMs: null, runs: 0 })!;
  assert.equal(metrics.loadMs, null);
  assert.equal(metrics.loadRamBytes, null);
  assert.equal(inferenceMs(metrics), null);
});

test('measured values pass through and one inference adds both stages', () => {
  const metrics = parseLocalVisionMetrics({ installed: true, revision: 'abc', digestsVerified: true, loadMs: 2140, loadRamBytes: 734003200, processRamBytes: 1288490188, visionMs: 410, generateMs: 3190, runs: 2 })!;
  assert.equal(metrics.loadMs, 2140);
  assert.equal(metrics.loadRamBytes, 734003200);
  assert.equal(inferenceMs(metrics), 3600);
  assert.equal(metrics.digestsVerified, true);
});

test('malformed or hostile values become "not measured", never a number', () => {
  assert.equal(parseLocalVisionMetrics(null), null);
  assert.equal(parseLocalVisionMetrics({ revision: 1 }), null);
  const metrics = parseLocalVisionMetrics({ revision: 'abc', loadMs: -5, visionMs: Number.NaN, generateMs: '100', loadRamBytes: Infinity })!;
  assert.equal(metrics.loadMs, null);
  assert.equal(metrics.visionMs, null);
  assert.equal(metrics.generateMs, null);
  assert.equal(metrics.loadRamBytes, null);
  assert.equal(metrics.installed, false);
  assert.equal(metrics.digestsVerified, false);
  assert.equal(metrics.runs, 0);
});
