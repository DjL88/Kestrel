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
test('one candidate is never assigned to two catalogue records', () => {
  const candidate = { path: 'E:/_DSC0001.NEF', size: 10000, lastModified: 1234 };
  const result = planOriginalRelink([original, { ...original, id: 'z5ii' }], [candidate]);
  assert.equal(result.matches.length, 1);
  assert.deepEqual(result.unresolved, ['z5ii']);
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
