import assert from 'node:assert/strict';
import test from 'node:test';
import {
  FTP_CREDENTIALS_KEY, LIVE_SHOOT_CHOICE_KEY, ftpCredentials, readLiveShootChoice, renewFtpPassword, saveLiveShootChoice, validFtpCredentials,
} from './liveShootSettings.ts';

function memory(initial: Record<string, string> = {}) {
  const values = new Map(Object.entries(initial));
  return { getItem: (key: string) => values.get(key) ?? null, setItem: (key: string, value: string) => { values.set(key, value); }, values };
}
let n = 0;
const maker = () => () => ['abcdefghjk', 'mnpqrstuvw', 'xyz2345678'][n++ % 3];

test('the FTP user, password and port stay the same between shoots on one device', () => {
  const store = memory();
  const make = maker();
  const first = ftpCredentials(store, make);
  assert.deepEqual(first, { user: 'inflight', password: first.password, port: 2121 });
  assert.ok(validFtpCredentials(first));
  assert.deepEqual(ftpCredentials(store, make), first, 'read back, not made again');
  assert.deepEqual(JSON.parse(store.values.get(FTP_CREDENTIALS_KEY)!), first);
});

test('a new password keeps the user and port, and is kept for next time', () => {
  const store = memory();
  const make = maker();
  const first = ftpCredentials(store, make);
  const renewed = renewFtpPassword(store, make);
  assert.notEqual(renewed.password, first.password);
  assert.equal(renewed.port, first.port);
  assert.deepEqual(ftpCredentials(store, make), renewed);
});

test('saved values that are not usable are replaced, and blocked storage still gives working credentials', () => {
  for (const bad of ['not json', JSON.stringify({ user: 'inflight', password: 'short', port: 2121 }),
    JSON.stringify({ user: 'someone', password: 'abcdefghjk', port: 2121 }), JSON.stringify({ user: 'inflight', password: 'abcdefghjk', port: 80 })]) {
    const store = memory({ [FTP_CREDENTIALS_KEY]: bad });
    assert.ok(validFtpCredentials(ftpCredentials(store, maker())));
  }
  const blocked = { getItem: () => { throw new Error('blocked'); }, setItem: () => { throw new Error('blocked'); } };
  assert.ok(validFtpCredentials(ftpCredentials(blocked, maker())));
  assert.ok(validFtpCredentials(ftpCredentials(null, maker())));
});

test('the last live shoot choices are remembered, and anything unknown falls back to the defaults', () => {
  const store = memory();
  assert.deepEqual(readLiveShootChoice(store), { source: 'ftp', lookId: null, room: false });
  saveLiveShootChoice(store, { source: 'folder', lookId: 'user-look-1', room: true });
  assert.deepEqual(readLiveShootChoice(store), { source: 'folder', lookId: 'user-look-1', room: true });
  const odd = memory({ [LIVE_SHOOT_CHOICE_KEY]: JSON.stringify({ source: 'bluetooth', lookId: 7, room: 'yes' }) });
  assert.deepEqual(readLiveShootChoice(odd), { source: 'ftp', lookId: null, room: false });
});
