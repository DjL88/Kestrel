/**
 * The app's licence client (src/providers/licenceSync.ts) against a real control plane: activation stores a grant that
 * the app verifies with its pinned key, renewal reuses the slot, the device list and freeing work, a revoked key is
 * heard, and when the server is gone, or answers with a grant signed by another key, the stored grant stays in force
 * and nothing throws.
 */
import test, { after, before } from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import { LicenceSync, type KeyValueStorage } from '../../../src/providers/licenceSync.ts';
import { decideAccess } from '../../../src/core/licenceOnline.ts';
import { startHarness, type Harness } from './helpers.ts';

let h: Harness;
before(async () => { h = await startHarness(); });
after(async () => { await h.close(); });

const memory = (): KeyValueStorage & { data: Map<string, string> } => {
  const data = new Map<string, string>();
  return { data, getItem: (k) => data.get(k) ?? null, setItem: (k, v) => { data.set(k, v); }, removeItem: (k) => { data.delete(k); } };
};
const pinned = () => ({ [h.app.config.signingKey.keyId]: h.app.config.signingKey.publicKeyBase64 });
const client = (storage = memory(), overrides: Partial<ConstructorParameters<typeof LicenceSync>[0]> = {}) => new LicenceSync({
  baseUrl: h.url, grantKeys: pinned(), storage, fetch: (...a) => fetch(...a), now: () => h.clock.now, platform: 'windows', appVersion: '26.11.2', ...overrides,
});
const issue = async (body: Record<string, unknown> = {}) => (await h.call('POST', '/v1/admin/licences/issue', { token: h.adminToken, body: { plan: 'paid', ...body } })).body;

test('without a server address or a pinned key the online part is off and says so', async () => {
  for (const sync of [client(memory(), { baseUrl: null }), client(memory(), { grantKeys: {} })]) {
    assert.equal(sync.configured, false);
    assert.deepEqual(await sync.activate('KESTREL1.x.y'), { kind: 'not_set_up' });
    assert.deepEqual(await sync.storedStanding('KESTREL1.x.y'), { kind: 'not_set_up' });
    assert.equal(await sync.status('KESTREL1.x.y'), null);
  }
});

test('activation stores a verified grant; renewal keeps the same slot; the grant survives the server going away', async () => {
  const { licenceKey } = await issue({ managedAi: true, accountId: h.user.accountId });
  const storage = memory();
  const sync = client(storage);
  assert.deepEqual(await sync.storedStanding(licenceKey), { kind: 'not_checked' });
  const first = await sync.activate(licenceKey);
  assert.equal(first.kind, 'active');
  if (first.kind !== 'active') return;
  assert.equal(first.grant.plan, 'paid');
  assert.deepEqual(decideAccess(true, first, h.clock.now), { pro: true, managedAi: true, basis: 'grant' });
  const again = await sync.activate(licenceKey);
  assert.equal(again.kind === 'active' && again.activationId, first.activationId, 'renewal reuses this device\'s slot');

  // Server unreachable: the stored grant is still checked and honoured. Nothing throws.
  const offline = client(storage, { fetch: async () => { throw new TypeError('network down'); } });
  const standing = await offline.activate(licenceKey);
  assert.equal(standing.kind, 'unreachable');
  assert.equal(standing.kind === 'unreachable' && standing.grant?.grantId, again.kind === 'active' ? again.grant.grantId : '');
  assert.equal(decideAccess(true, standing, h.clock.now).pro, true);
  assert.equal((await offline.storedStanding(licenceKey)).kind, 'unreachable');

  // Past the offline window, the key still unlocks Pro on its own (no account or connection needed), without the AI flag.
  assert.deepEqual(decideAccess(true, standing, h.clock.now + 31 * 86_400_000), { pro: true, managedAi: false, basis: 'key' });
});

test('a grant signed by a key the app does not pin is never trusted', async () => {
  const { licenceKey } = await issue();
  const other = crypto.generateKeyPairSync('ed25519');
  const wrongKeys = { [h.app.config.signingKey.keyId]: Buffer.from((other.publicKey.export({ format: 'jwk' }) as { x: string }).x, 'base64url').toString('base64') };
  const sync = client(memory(), { grantKeys: wrongKeys });
  assert.deepEqual(await sync.activate(licenceKey), { kind: 'unreachable', grant: null, activationId: null });
});

test('devices can be listed and freed from the app; the device limit and a revoked key are reported', async () => {
  const { licenceKey, licenceId } = await issue({ maxDevices: 1 });
  const mine = client();
  const theirs = client();
  const active = await mine.activate(licenceKey);
  assert.equal(active.kind, 'active');
  const blocked = await theirs.activate(licenceKey);
  assert.equal(blocked.kind, 'device_limit');

  const status = await theirs.status(licenceKey);
  assert.equal(status?.devices.length, 1);
  assert.equal(status?.devices[0].thisDevice, false);
  assert.equal(await theirs.deactivate(licenceKey, status!.devices[0].activationId), true);
  assert.equal((await theirs.activate(licenceKey)).kind, 'active', 'the freed slot is now this device\'s');

  assert.equal((await h.call('POST', `/v1/admin/licences/${licenceId}/revoke`, { token: h.adminToken })).status, 200);
  const revoked = await theirs.activate(licenceKey);
  assert.equal(revoked.kind, 'revoked');
  assert.deepEqual(decideAccess(true, revoked, h.clock.now), { pro: false, managedAi: false, basis: 'revoked' });
  assert.equal((await theirs.storedStanding(licenceKey)).kind, 'revoked', 'remembered across restarts');
  theirs.forget();
  assert.equal((await theirs.storedStanding(licenceKey)).kind, 'not_checked');
});

test('the device id is random and kept, not derived from the machine', async () => {
  const storage = memory();
  const a = await client(storage).deviceHash();
  assert.equal(a, await client(storage).deviceHash());
  assert.notEqual(a, await client(memory()).deviceHash());
  assert.match(a, /^[0-9a-f]{64}$/);
});
