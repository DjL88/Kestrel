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
