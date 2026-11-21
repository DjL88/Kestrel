import test from 'node:test';
import assert from 'node:assert/strict';
import { assignBurstGroups, generateDemoShootFrames } from './cullingEngine';
import { sameCaptureCamera, safeBurstGapMs } from './burstIdentity';

const frames = () => generateDemoShootFrames(4).map((frame, index) => ({
  ...frame,
  exif: { ...frame.exif, camera: 'NIKON Z 8', capturedAtMs: 1000 + index * 100 },
}));

test('same-camera frames within a time window remain one burst', () => {
  const grouped = assignBurstGroups(frames());
  assert.equal(grouped[0].burstCount, 4);
  assert.equal(grouped[3].burstGroupId, grouped[0].burstGroupId);
});

test('mixed Z8 and Z5II frames are not joined by nearby timestamps', () => {
  const input = frames();
  input[2].exif.camera = 'NIKON Z 5II';
  input[3].exif.camera = 'NIKON Z 5II';
  const grouped = assignBurstGroups(input);
  assert.equal(grouped[0].burstCount, 2);
  assert.equal(grouped[2].burstCount, 2);
  assert.notEqual(grouped[0].burstGroupId, grouped[2].burstGroupId);
});

test('missing camera metadata cannot bridge two independent bursts', () => {
  const input = frames();
  input[1].exif.camera = ''; // Missing camera identity must not bridge independent bursts.
  const grouped = assignBurstGroups(input);
  assert.equal(grouped[0].burstGroupId, null);
  assert.equal(grouped[1].burstGroupId, null);
  assert.equal(grouped[2].burstCount, 2);
});

test('whitespace camera identity is not trusted and known tags are trimmed', () => {
  assert.equal(sameCaptureCamera(' ', ['NIKON Z 8']), false);
  assert.equal(sameCaptureCamera('NIKON Z 8', [undefined]), false);
  assert.equal(sameCaptureCamera(' NIKON Z 8 ', ['NIKON Z 8']), true);
});

test('invalid or excessive burst gap settings cannot group distant photos', () => {
  assert.equal(safeBurstGapMs(Number.POSITIVE_INFINITY), 0);
  assert.equal(safeBurstGapMs(-1), 0);
  assert.equal(safeBurstGapMs(Number.NaN), 0);
  assert.equal(safeBurstGapMs(999999), 0);
  const input = frames();
  assert.equal(assignBurstGroups(input, Number.POSITIVE_INFINITY)[0].burstGroupId, null);
});

test('burst grouping preserves original metadata and culling decisions', () => {
  const input = frames();
  const snapshot = JSON.stringify(input);
  const grouped = assignBurstGroups(input);
  assert.equal(JSON.stringify(input), snapshot);
  assert.equal(grouped[0].decision, input[0].decision);
  assert.equal(grouped[0].stableKey, input[0].stableKey);
});

test('the same camera and timestamp in different folders never creates one burst', () => {
  const input = frames().map((frame, index) => ({
    ...frame,
    sourceKind: 'file' as const,
    sourcePath: `/shoots/${index % 2 ? 'second' : 'first'}/DSC_${index}.NEF`,
  }));
  const before = JSON.stringify(input);
  const grouped = assignBurstGroups(input);
  assert.ok(grouped.every(frame => frame.burstGroupId === null));
  assert.equal(JSON.stringify(input), before, 'the original source identities must be immutable');
});

test('frames within one known source directory still group normally', () => {
  const input = frames().map((frame, index) => ({
    ...frame, sourceKind: 'file' as const,
    sourcePath: `/shoots/first/DSC_${index}.NEF`,
  }));
  assert.equal(assignBurstGroups(input)[0].burstCount, 4);
});

test('linked source identity survives relinking and is compared to a path identity', () => {
  const linked = (folder: string, name: string) =>
    `local-linked://${encodeURIComponent('posix:' + folder + '/' + name)}::${name}::200::1000`;
  const input = frames().slice(0, 2).map((frame, index) => ({
    ...frame,
    sourceKind: 'file' as const,
    sourcePath: index ? undefined : '/shoots/first/DSC_0.NEF',
    stableKey: index ? linked('/shoots/second', 'DSC_1.NEF') : linked('/shoots/first', 'DSC_0.NEF'),
  }));
  assert.equal(assignBurstGroups(input)[0].burstGroupId, null);
  input[1].stableKey = linked('/shoots/first', 'DSC_1.NEF');
  assert.equal(assignBurstGroups(input)[0].burstCount, 2);
});

test('one unknown folder must not silently bridge a known folder; legacy unlinked sources remain compatible', () => {
  const input = frames().slice(0, 2).map((frame, index) => ({
    ...frame,
    sourceKind: 'file' as const,
    stableKey: `local-file://DSC_${index}.NEF::200::1000`,
    sourcePath: index ? undefined : '/shoots/first/DSC_0.NEF',
  }));
  assert.equal(assignBurstGroups(input)[0].burstGroupId, null);
  input[0].sourcePath = undefined;
  assert.equal(assignBurstGroups(input)[0].burstCount, 2);
});
