import assert from 'node:assert/strict';
import test from 'node:test';
import { checkS3Settings, isInsideSyncRoot, memoryConnector, syncPath } from './storageConnectors.ts';

test('every connector uses one layout, by level', () => {
  assert.equal(syncPath('recipes', 'p1', 'img-9'), 'kestrel/v1/recipes/p1/img-9.json');
  assert.equal(syncPath('previews', 'p1', 'img-9'), 'kestrel/v1/previews/p1/img-9.jpg');
  assert.equal(syncPath('originals', 'p1', 'img-9'), 'kestrel/v1/originals/p1/img-9.orig');
});

test('an unsafe id cannot build a path that escapes the InFlight folder', () => {
  for (const bad of ['..', '../x', 'a/b', '', '.hidden', 'a b']) assert.throws(() => syncPath('recipes', bad, 'ok'), /Unsafe/);
  assert.equal(isInsideSyncRoot('kestrel/v1/recipes/p/x.json'), true);
  assert.equal(isInsideSyncRoot('kestrel/v1/../secret'), false);
  assert.equal(isInsideSyncRoot('other/x'), false);
});

test('a connector stores, lists, reads and removes inside the root, and refuses outside it', async () => {
  const connector = memoryConnector();
  const path = syncPath('recipes', 'p1', 'a');
  await connector.put(path, new Uint8Array([1, 2]), 'sha');
  assert.deepEqual(await connector.list('kestrel/v1/recipes'), [path]);
  assert.deepEqual([...(await connector.get(path))!], [1, 2]);
  await connector.remove(path);
  assert.equal(await connector.get(path), null);
  await assert.rejects(connector.put('../escape', new Uint8Array(), 'x'), /outside/);
});

test('S3 settings are checked with plain messages', () => {
  const good = { endpoint: 'https://s3.eu-west-2.amazonaws.com', region: 'eu-west-2', bucket: 'my-photos', accessKeyId: 'AK', secretAccessKey: 'SK' };
  assert.deepEqual(checkS3Settings(good), []);
  assert.equal(checkS3Settings({ ...good, endpoint: 'http://insecure.example' }).length, 1);
  for (const local of ['http://127.0.0.1:9000', 'http://192.168.1.20:9000', 'http://nas.local:9000', 'http://10.0.0.5', 'http://localhost:9000']) assert.deepEqual(checkS3Settings({ ...good, endpoint: local }), [], local);
  assert.equal(checkS3Settings({ ...good, endpoint: 'http://172.32.0.1' }).length, 1, 'not a private range');
  assert.equal(checkS3Settings({ ...good, endpoint: 'not a url' }).length, 1);
  assert.equal(checkS3Settings({ ...good, bucket: 'Bad Bucket!' }).length, 1);
  assert.equal(checkS3Settings({ ...good, secretAccessKey: ' ' }).length, 1);
});
