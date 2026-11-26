import assert from 'node:assert/strict';
import test from 'node:test';
import { checkSftpSettings, sftpConnector, SFTP_TEXT, type SftpSettings } from './sftpConnector.ts';

const place: SftpSettings = { host: 'files.example.com', port: 22, user: 'ana', password: 'pw', root: '/srv/photos', pinned: 'SHA256:abc' };

function fake(answers: Record<string, (args: unknown, options?: { headers: Record<string, string> }) => unknown>) {
  const calls: Array<{ command: string; args: unknown; options?: { headers: Record<string, string> } }> = [];
  const invoke = async <T,>(command: string, args?: unknown, options?: { headers: Record<string, string> }): Promise<T> => {
    calls.push({ command, args, options });
    const answer = answers[command];
    if (!answer) throw new Error(`unexpected ${command}`);
    return await answer(args, options) as T;
  };
  return { calls, invoke };
}

test('settings are checked in plain words before anything is sent', () => {
  assert.deepEqual(checkSftpSettings(place), []);
  assert.match(checkSftpSettings({ ...place, host: 'files.example.com/photos' })[0], /server address/);
  assert.match(checkSftpSettings({ ...place, port: 0 })[0], /port/);
  assert.match(checkSftpSettings({ ...place, password: '', privateKey: '' })[0], /password, or paste a private key/);
  assert.deepEqual(checkSftpSettings({ ...place, password: undefined, privateKey: '-----BEGIN OPENSSH PRIVATE KEY-----' }), []);
});

test('a place is healthy only when the server still shows the identity the person trusted', async () => {
  const same = fake({ sftp_test: () => 'SHA256:abc' });
  assert.deepEqual(await sftpConnector(place, { invoke: same.invoke }).test(), { ok: true });
  assert.deepEqual(same.calls[0].args, { target: place });

  const changed = fake({ sftp_test: () => { throw 'host-key-changed:SHA256:new'; } });
  const result = await sftpConnector(place, { invoke: changed.invoke }).test();
  assert.equal(result.ok, false);
  assert.equal(!result.ok && result.reason, SFTP_TEXT.changedKey);

  const unpinned = await sftpConnector({ ...place, pinned: undefined }, { invoke: same.invoke }).test();
  assert.equal(!unpinned.ok && unpinned.health, 'needs-signin');

  const refused = fake({ sftp_test: () => { throw 'The server did not accept that user name and password or key.'; } });
  const signIn = await sftpConnector(place, { invoke: refused.invoke }).test();
  assert.equal(!signIn.ok && signIn.health, 'needs-signin');
});

test('files go to the desktop side with the place, and a missing file reads as null', async () => {
  const { calls, invoke } = fake({
    sftp_put: () => undefined,
    sftp_get: (args) => { if ((args as { path: string }).path.endsWith('gone.json')) throw 'missing'; return new Uint8Array([1, 2]).buffer; },
    sftp_list: () => ['kestrel/v1/a.json'],
    sftp_remove: () => undefined,
  });
  const connector = sftpConnector(place, { invoke });
  await connector.put('kestrel/v1/a.json', new Uint8Array([7]), '');
  assert.deepEqual(calls[0].args, new Uint8Array([7]));
  assert.equal(decodeURIComponent(calls[0].options!.headers['x-sftp-path']), 'kestrel/v1/a.json');
  assert.deepEqual(JSON.parse(decodeURIComponent(calls[0].options!.headers['x-sftp-target'])), place);
  assert.deepEqual(await connector.get('kestrel/v1/a.json'), new Uint8Array([1, 2]));
  assert.equal(await connector.get('kestrel/v1/gone.json'), null);
  assert.deepEqual(await connector.list('kestrel/v1/project-backups/'), ['kestrel/v1/a.json']);
  assert.deepEqual(calls.at(-1)!.args, { target: place, prefix: 'kestrel/v1/project-backups' });
  await connector.remove('kestrel/v1/a.json');
  await connector.put('export/shoot/a.jpg', new Uint8Array([1]), '');
});

test('nothing outside InFlight’s folder is touched, and exports are never read back', async () => {
  const { calls, invoke } = fake({});
  const connector = sftpConnector(place, { invoke });
  await assert.rejects(connector.put('../etc/passwd', new Uint8Array(), ''));
  await assert.rejects(connector.get('export/shoot/a.jpg'));
  await assert.rejects(connector.remove('kestrel/v1/../../x'));
  await assert.rejects(connector.list('other'));
  assert.equal(calls.length, 0);
});
