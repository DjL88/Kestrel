import assert from 'node:assert/strict';
import test from 'node:test';
import { formatBytes, formatDuration, inferenceMs, parseModelMetrics, shortDigest } from './modelMetrics';

const DIGEST = '7d0a356562c7e474012c5e383de58d44d487a517c04190d26e5891db86cb2b1f';

test('an unmeasured model shows no numbers at all', () => {
  const metrics = parseModelMetrics({
    installed: true, revision: 'abc', files: [{ name: 'decoder.onnx', bytes: 365039224, sha256: DIGEST }],
    loaded: false, digestsVerified: false, loadMs: null, loadRamBytes: null, processRamBytes: null,
    visionMs: null, generateMs: null, newTokens: null, runs: 0,
  });
  assert.ok(metrics);
  assert.equal(metrics.loadMs, null);
  assert.equal(metrics.loadRamBytes, null);
  assert.equal(inferenceMs(metrics), null);
  assert.equal(metrics.files.length, 1);
});

test('measured values pass through unchanged and inference adds both stages', () => {
  const metrics = parseModelMetrics({
    installed: true, revision: 'abc', files: [], loaded: true, digestsVerified: true,
    loadMs: 2140, loadRamBytes: 734003200, processRamBytes: 1288490188, visionMs: 410, generateMs: 3190, newTokens: 31, runs: 2,
  })!;
  assert.equal(metrics.loadMs, 2140);
  assert.equal(inferenceMs(metrics), 3600);
  assert.equal(metrics.runs, 2);
  assert.equal(metrics.digestsVerified, true);
});

test('malformed or hostile values become "not measured", never a number', () => {
  assert.equal(parseModelMetrics(null), null);
  assert.equal(parseModelMetrics({ revision: 1 }), null);
  const metrics = parseModelMetrics({
    revision: 'abc', files: [{ name: 'x', bytes: 1, sha256: 'not-a-digest' }, 'junk'],
    loadMs: -5, visionMs: Number.NaN, generateMs: '100', loadRamBytes: Infinity,
  })!;
  assert.deepEqual(metrics.files, []);
  assert.equal(metrics.loadMs, null);
  assert.equal(metrics.visionMs, null);
  assert.equal(metrics.generateMs, null);
  assert.equal(metrics.loadRamBytes, null);
  assert.equal(metrics.installed, false);
  assert.equal(metrics.digestsVerified, false);
});

test('formatting is plain and honest about units', () => {
  assert.equal(formatDuration(850), '850 ms');
  assert.equal(formatDuration(2140), '2.14 s');
  assert.equal(formatDuration(31_250), '31.3 s');
  assert.equal(formatBytes(734003200), '700 MB');
  assert.equal(formatBytes(1288490188), '1.2 GB');
  assert.equal(formatBytes(2048), '2 KB');
  assert.equal(shortDigest(DIGEST), '7d0a3565…86cb2b1f');
});
