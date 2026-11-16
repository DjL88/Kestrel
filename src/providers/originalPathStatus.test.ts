import assert from 'node:assert/strict';
import test from 'node:test';
import { checkOriginalPath, checkOriginalPaths, classifyOriginalPathError } from './originalPathStatus';

test('saved original is available only when native stat confirms a file', async () => {
  assert.equal(await checkOriginalPath('C:\\photos\\Z8.NEF', async () => ({ isFile: true })), 'available');
  assert.equal(await checkOriginalPath('C:\\photos', async () => ({ isFile: false })), 'missing');
  assert.equal(await checkOriginalPath('', async () => { throw Error('should not call stat'); }), 'missing');
});

test('missing, denied and disconnected volumes are distinct recoverable states', async () => {
  assert.equal(classifyOriginalPathError({ code: 'ENOENT' }), 'missing');
  assert.equal(classifyOriginalPathError({ code: 'EACCES' }), 'permission-denied');
  assert.equal(classifyOriginalPathError(new Error('Access is denied')), 'permission-denied');
  assert.equal(classifyOriginalPathError(new Error('network drive offline')), 'unavailable');
  assert.equal(await checkOriginalPath('\\\\nas\\shoot\\Z5II.NEF', async () => { throw Error('network drive offline'); }), 'unavailable');
});

test('624-photo project checks metadata with bounded concurrency and deduplicated paths', async () => {
  const paths = Array.from({ length: 624 }, (_, i) => `D:/shoot/_DJL${i}.NEF`);
  paths.push(paths[0], paths[10]);
  let active = 0, peak = 0, calls = 0;
  const result = await checkOriginalPaths(paths, async () => {
    calls++; active++; peak = Math.max(peak, active);
    await Promise.resolve();
    active--;
    return { isFile: true };
  }, 8);
  assert.equal(result.size, 624);
  assert.equal(calls, 624);
  assert.ok(peak <= 8);
  assert.equal(result.get(paths[0]), 'available');
});

test('one disconnected NAS photo does not prevent unrelated originals being checked', async () => {
  const result = await checkOriginalPaths(['C:/one.NEF', '//nas/two.NEF', 'C:/three.NEF'], async (path) => {
    if (path.startsWith('//nas')) throw new Error('offline');
    return { isFile: true };
  });
  assert.deepEqual([...result.values()], ['available', 'unavailable', 'available']);
});
