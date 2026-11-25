import assert from 'node:assert/strict';
import test from 'node:test';
import { dbipCountryLookup } from '../src/networkCountry.ts';

// The pinned offline database is installed with the control plane's own dependencies; skip cleanly elsewhere.
test('the pinned DB-IP database answers offline for public IPv4 and IPv6 addresses', async (t) => {
  let lookup;
  try { lookup = await dbipCountryLookup(); } catch { t.skip('control-plane dependencies not installed'); return; }
  assert.equal(lookup('81.2.69.142'), 'GB');
  assert.equal(lookup('8.8.8.8'), 'US');
  assert.equal(lookup('2a00:1450:4009:81f::200e'), 'GB');
  assert.equal(lookup('10.0.0.1'), null);
});
