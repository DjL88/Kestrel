import test from 'node:test';
import assert from 'node:assert/strict';
import { parentFolder, planOriginalRelink } from './originalRelinkPlan';
import { classifyOriginalPathError } from './originalPathStatus';

const original = { id: 'z8', path: 'D:\\Birds\\_DSC0001.NEF', size: 10000, lastModified: 1234 };

test('relink a moved Nikon original using metadata, preserving its catalogue identity', () => {
  assert.deepEqual(planOriginalRelink([original], [{ path: '\\\\NAS\\Photos\\_DSC0001.NEF', size: 10000, lastModified: 1234 }]), {
    matches: [{ id: 'z8', path: '\\\\NAS\\Photos\\_DSC0001.NEF' }], unresolved: [], ambiguous: [],
  });
});
test('never relink different bytes just because Nikon filename matches', () => {
  assert.deepEqual(planOriginalRelink([original], [{ path: 'E:/_DSC0001.NEF', size: 9999, lastModified: 1234 }]).unresolved, ['z8']);
});
test('duplicate candidates remain unresolved for user confirmation', () => {
  const candidate = { path: 'E:/_DSC0001.NEF', size: 10000, lastModified: 1234 };
  const result = planOriginalRelink([original], [candidate, { ...candidate, path: 'F:/_DSC0001.NEF' }]);
  assert.deepEqual(result.ambiguous, ['z8']);
  assert.equal(result.matches.length, 0);
});
test('one candidate is never assigned to two catalogue records, regardless of input order', () => {
  const candidate = { path: 'E:/_DSC0001.NEF', size: 10000, lastModified: 1234 };
  const result = planOriginalRelink([original, { ...original, id: 'z5ii' }], [candidate]);
  assert.deepEqual(result.matches, []);
  assert.deepEqual(result.ambiguous, ['z8', 'z5ii']);
  const reversed = planOriginalRelink([{ ...original, id: 'z5ii' }, original], [candidate]);
  assert.deepEqual(reversed.matches, []);
  assert.deepEqual(reversed.ambiguous, ['z5ii', 'z8']);
});
test('folder suggestion supports Windows, UNC NAS and POSIX paths', () => {
  assert.equal(parentFolder('D:\\Birds\\_DSC0001.NEF'), 'D:/Birds');
  assert.equal(parentFolder('\\\\nas\\share\\Z8.NEF'), '//nas/share');
  assert.equal(parentFolder('/mnt/photos/Z5II.NEF'), '/mnt/photos');
});
test('native OS errors are classified without treating offline drives as deleted originals', () => {
  assert.equal(classifyOriginalPathError(new Error('os error 2')), 'missing');
  assert.equal(classifyOriginalPathError(new Error('os error 5')), 'permission-denied');
  assert.equal(classifyOriginalPathError(new Error('network path was not found, os error 53')), 'unavailable');
  assert.equal(classifyOriginalPathError(new Error('drive disconnected')), 'unavailable');
});

test('incomplete original identity never silently relinks a blank path', () => {
  const empty = { id: 'missing-path', path: '', size: 0, lastModified: 0 };
  const candidate = { path: '', size: 0, lastModified: 0 };
  assert.deepEqual(planOriginalRelink([empty], [candidate]), {
    matches: [], unresolved: ['missing-path'], ambiguous: [],
  });
});

test('non-finite or negative RAW metadata cannot match a replacement file', () => {
  for (const value of [NaN, Infinity, -1]) {
    const broken = { ...original, size: value };
    const result = planOriginalRelink([broken], [{ path: 'E:/_DSC0001.NEF', size: value, lastModified: 1234 }]);
    assert.deepEqual(result.matches, []);
    assert.deepEqual(result.unresolved, ['z8']);
  }
  const badTimestamp = { ...original, lastModified: Infinity };
  assert.deepEqual(planOriginalRelink([badTimestamp], [{ path: 'E:/_DSC0001.NEF', size: 10000, lastModified: Infinity }]).unresolved, ['z8']);
});

test('invalid candidates do not block a distinct valid Nikon original match', () => {
  const candidates = [
    { path: '', size: 10000, lastModified: 1234 },
    { path: 'E:/_DSC0001.NEF', size: NaN, lastModified: 1234 },
    { path: 'F:/_DSC0001.NEF', size: 10000, lastModified: 1234 },
  ];
  assert.deepEqual(planOriginalRelink([original], candidates).matches, [{ id: 'z8', path: 'F:/_DSC0001.NEF' }]);
});

test('duplicate catalogue IDs cannot silently overwrite a relink', () => {
  const result = planOriginalRelink([original, { ...original, path: 'D:/Other.NEF' }], [
    { path: 'E:/_DSC0001.NEF', size: 10000, lastModified: 1234 },
    { path: 'E:/Other.NEF', size: 10000, lastModified: 1234 },
  ]);
  assert.deepEqual(result.matches, []);
  assert.deepEqual(result.ambiguous, ['z8', 'z8']);
});

test('duplicate NAS candidate entries cannot masquerade as a unique file', () => {
  const candidate = { path: '//NAS/Photos/_DSC0001.NEF', size: 10000, lastModified: 1234 };
  const result = planOriginalRelink([original], [candidate, { ...candidate, path: '//nas/photos/_dsc0001.nef' }]);
  assert.deepEqual(result.matches, []);
  assert.deepEqual(result.ambiguous, ['z8']);
});

test('500 distinct originals relink without loss or cross-photo links, independent of ordering', () => {
  const saved = Array.from({ length: 500 }, (_, i) => ({
    id: `photo-${i}`, path: `D:/Z8/DSC_${String(i).padStart(5, '0')}.NEF`,
    size: 100000 + i, lastModified: 1700000000000 + i,
  }));
  const candidates = saved.map(photo => ({
    path: photo.path.replace('D:/Z8/', '//NAS/archive/'),
    size: photo.size, lastModified: photo.lastModified,
  })).reverse();
  const result = planOriginalRelink(saved, candidates);
  assert.equal(result.matches.length, 500);
  assert.deepEqual(result.unresolved, []);
  assert.deepEqual(result.ambiguous, []);
  for (let i = 0; i < 500; i++) {
    assert.equal(result.matches[i].id, saved[i].id);
    assert.equal(result.matches[i].path, saved[i].path.replace('D:/Z8/', '//NAS/archive/'));
  }
});

test('same filename and metadata from two cameras requires manual confirmation', () => {
  const twins = [original, { ...original, id: 'second-camera', path: 'D:/Z5II/_DSC0001.NEF' }];
  const result = planOriginalRelink(twins, [{ path: 'E:/_DSC0001.NEF', size: 10000, lastModified: 1234 }]);
  assert.deepEqual(result.matches, []);
  assert.deepEqual(result.ambiguous, ['z8', 'second-camera']);
});

const shaA = 'a'.repeat(64);
const shaB = 'b'.repeat(64);

test('verified digest reconnects a renamed and re-timestamped original', () => {
  const saved = { ...original, sha256: shaA };
  const candidate = { path: '//NAS/new-name.nef', size: 10000, lastModified: 9999, sha256: shaA.toUpperCase() };
  assert.deepEqual(planOriginalRelink([saved], [candidate]).matches, [{ id: 'z8', path: candidate.path }]);
});

test('a saved digest fails closed against metadata collision and missing candidate digest', () => {
  const saved = { ...original, sha256: shaA };
  const candidate = { path: 'E:/_DSC0001.NEF', size: 10000, lastModified: 1234 };
  assert.deepEqual(planOriginalRelink([saved], [candidate]).unresolved, ['z8']);
  assert.deepEqual(planOriginalRelink([saved], [{ ...candidate, sha256: shaB }]).unresolved, ['z8']);
  assert.deepEqual(planOriginalRelink([saved], [{ ...candidate, sha256: 'not-a-hash' }]).unresolved, ['z8']);
  assert.deepEqual(planOriginalRelink([{ ...saved, sha256: 'invalid' }], [{ ...candidate, sha256: shaA }]).unresolved, ['z8']);
});

test('identical digest copies and catalogue digest collisions cannot silently relink', () => {
  const saved = { ...original, sha256: shaA };
  const candidate = { path: 'E:/renamed.NEF', size: 10000, lastModified: 1234, sha256: shaA };
  assert.deepEqual(planOriginalRelink([saved], [candidate, { ...candidate, path: 'F:/copy.NEF' }]).ambiguous, ['z8']);
  assert.deepEqual(planOriginalRelink([saved, { ...saved, id: 'z5ii' }], [candidate]).ambiguous, ['z8', 'z5ii']);
});

test('500 SHA-256 verified synthetic relinks tolerate changed names and timestamps', () => {
  const saved = Array.from({ length: 500 }, (_, i) => ({
    id: 'frame-' + i, path: 'D:/RAW/' + i + '.NEF', size: 10000 + i,
    lastModified: 1234, sha256: i.toString(16).padStart(64, '0'),
  }));
  const candidates = saved.map((s, i) => ({
    path: '//NAS/renamed/' + (499 - i) + '.NEF', size: s.size,
    lastModified: 9999, sha256: s.sha256,
  })).reverse();
  const result = planOriginalRelink(saved, candidates);
  assert.equal(result.matches.length, 500);
  assert.deepEqual(result.ambiguous, []);
  assert.deepEqual(result.unresolved, []);
  for (let i = 0; i < 500; i++) assert.equal(result.matches[i].id, saved[i].id);
});
