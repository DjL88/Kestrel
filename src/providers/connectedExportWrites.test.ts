import assert from 'node:assert/strict';
import test from 'node:test';
import { s3Connector } from './s3Connector.ts';
import { webdavConnector } from './webdavConnector.ts';

const bytes = new Uint8Array([1, 2, 3]);
const exportPath = 'export/run/photo.jpg';
const backupPath = 'kestrel/v1/backups/project/backup.json';

for (const kind of ['s3', 'webdav'] as const) {
  test(`${kind} uses create-only semantics for exports and leaves backup writes replaceable`, async () => {
    const puts: Headers[] = [];
    const fetchImpl = async (_input: string, init?: RequestInit) => {
      if (init?.method === 'MKCOL') return new Response(null, { status: 201 });
      assert.equal(init?.method, 'PUT');
      const headers = new Headers(init?.headers);
      puts.push(headers);
      return new Response(null, { status: puts.length === 2 ? 412 : 201 });
    };
    const connector = kind === 's3'
      ? s3Connector({
          endpoint: 'https://s3.example.test', region: 'eu-west-2', bucket: 'kestrel',
          accessKeyId: 'test-id', secretAccessKey: 'test-key',
        }, { fetchImpl })
      : webdavConnector({
          url: 'https://nas.example.test/photos', username: 'test-user', password: 'test-password',
        }, { fetchImpl });
    await connector.put(exportPath, bytes, '');
    await assert.rejects(connector.put(exportPath, bytes, ''), /already exists/);
    await connector.put(backupPath, bytes, '');
    assert.deepEqual(puts.map(headers => headers.get('If-None-Match')), ['*', '*', null]);
    if (kind === 's3') assert.match(puts[0].get('Authorization') ?? '', /SignedHeaders=[^,]*if-none-match/);
  });
}
