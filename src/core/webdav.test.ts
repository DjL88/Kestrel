import assert from 'node:assert/strict';
import test from 'node:test';
import { checkWebDavSettings, isInsideExportRoot, isWritablePath } from './storageConnectors.ts';
import { parsePropfind } from '../providers/webdavConnector.ts';

test('a server answer is read into files and folders, whatever XML prefix it uses', () => {
  const synology = '<?xml version="1.0"?><D:multistatus xmlns:D="DAV:"><D:response><D:href>/photos/kestrel/v1/recipes/</D:href><D:propstat><D:prop><D:resourcetype><D:collection/></D:resourcetype></D:prop></D:propstat></D:response><D:response><D:href>/photos/kestrel/v1/recipes/kite%20day/</D:href><D:propstat><D:prop><D:resourcetype><D:collection/></D:resourcetype></D:prop></D:propstat></D:response></D:multistatus>';
  assert.deepEqual(parsePropfind(synology), [
    { href: '/photos/kestrel/v1/recipes/', isFolder: true },
    { href: '/photos/kestrel/v1/recipes/kite day/', isFolder: true },
  ]);
  const nextcloud = '<d:multistatus xmlns:d="DAV:"><d:response><d:href>/remote.php/dav/files/me/a.json</d:href><d:propstat><d:prop><d:resourcetype/></d:prop></d:propstat></d:response></d:multistatus>';
  assert.deepEqual(parsePropfind(nextcloud), [{ href: '/remote.php/dav/files/me/a.json', isFolder: false }]);
  assert.deepEqual(parsePropfind('not xml'), []);
});

test('NAS settings are checked with plain messages, and plain http is for the local network and Tailscale only', () => {
  const good = { url: 'https://nas.example.com/photos', username: 'me', password: 'secret' };
  assert.deepEqual(checkWebDavSettings(good), []);
  for (const local of ['http://192.168.1.20:5005/photos', 'http://10.0.0.5/dav', 'http://172.20.1.1/dav', 'http://nas.local:5005/dav',
    'http://100.101.102.103:5005/dav', 'http://nas.tail1234.ts.net:5005/dav', 'http://localhost:8080/dav']) {
    assert.deepEqual(checkWebDavSettings({ ...good, url: local }), [], local);
  }
  for (const internet of ['http://nas.example.com/photos', 'http://100.200.1.1/dav', 'http://172.32.0.1/dav', 'http://10.evil.com/dav', 'http://ts.net.evil.com/dav']) {
    assert.equal(checkWebDavSettings({ ...good, url: internet }).length, 1, internet);
  }
  assert.equal(checkWebDavSettings({ ...good, url: 'nas' }).length, 1);
  assert.equal(checkWebDavSettings({ ...good, username: ' ' }).length, 1);
  assert.equal(checkWebDavSettings({ ...good, password: '' }).length, 1);
});

test('exports may go to an export folder, and nowhere else outside InFlight’s own folder', () => {
  for (const ok of ['export/2026-11-16 10-00/kite.jpg', 'kestrel/v1/backups/a/b.kestrel.json']) assert.equal(isWritablePath(ok), true, ok);
  for (const bad of ['export/../secret', 'export//x', 'export', 'Export/x.jpg', 'originals/x.nef', '../export/x.jpg', '/export/x.jpg', 'kestrel/../x']) assert.equal(isWritablePath(bad), false, bad);
  assert.equal(isInsideExportRoot('export/a.jpg'), true);
});
