import { test, expect } from '@playwright/test';

test('signed asset activation persists offline and refuses catalogue rollback after restart', async ({ page }) => {
  await page.goto('/');
  const result = await page.evaluate(async () => {
    const { createVerifiedBrowserAssetRuntime } = await import('/src/core/verifiedAssetBootstrap.ts');
    const { indexedDbSequenceFence } = await import('/src/providers/verifiedAssetSequenceFence.ts');
    const audience = 'kestrel-test-' + crypto.randomUUID().replaceAll('-', '');
    const id = 'asset-' + crypto.randomUUID().replaceAll('-', '');
    const keys = await crypto.subtle.generateKey('Ed25519', true, ['sign', 'verify']);
    const pinnedPublicKeys = new Map([['release', keys.publicKey]]);
    const data = new TextEncoder().encode('rights-approved inert model fixture');
    const sha256 = Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', data)),
      x => x.toString(16).padStart(2, '0')).join('');
    const makeEnvelope = async (sequence: number) => {
      const payload = new TextEncoder().encode(JSON.stringify({
        schema: 1, audience, sequence, expiresAt: '2099-01-01T00:00:00Z',
        assets: [{ id, version: '1.0.0', kind: 'knowledge', sha256, bytes: data.length,
          licence: 'test-only', provenance: 'locally authored fixture', approved: true }],
      }));
      return { keyId: 'release', payload,
        signature: new Uint8Array(await crypto.subtle.sign('Ed25519', keys.privateKey, payload)) };
    };
    const options = { pinnedPublicKeys, audience };
    const runtime = createVerifiedBrowserAssetRuntime(options);
    const envelope = await makeEnvelope(10);
    await runtime.install(envelope, id, data, {
      currentAppVersion: '1.0.0', maxDeviceRamBytes: 1024 * 1024,
      budgetBytes: 1024 * 1024, smokeTest: async () => {},
    });
    const reopened = createVerifiedBrowserAssetRuntime(options);
    const local = await reopened.open(id, async () => undefined);
    const persisted = await indexedDbSequenceFence(audience).read();
    let rollbackRejected = false;
    try {
      await reopened.install(await makeEnvelope(9), id, data, {
        currentAppVersion: '1.0.0', maxDeviceRamBytes: 1024 * 1024,
        budgetBytes: 1024 * 1024, smokeTest: async () => {},
      });
    } catch { rollbackRejected = true; }
    const offline = await reopened.open(id, async () => undefined);
    return { localSource: local.source, localBytes: Array.from(local.bytes ?? []),
      persistedSequence: persisted?.sequence, rollbackRejected, offlineSource: offline.source };
  });
  expect(result.localSource).toBe('active');
  expect(result.localBytes.length).toBeGreaterThan(0);
  expect(result.persistedSequence).toBe(10);
  expect(result.rollbackRejected).toBe(true);
  expect(result.offlineSource).toBe('active');
});

test('asset sequence CAS refuses stale and conflicting concurrent writers', async ({ page }) => {
  await page.goto('/');
  const result = await page.evaluate(async () => {
    const { indexedDbSequenceFence } = await import('/src/providers/verifiedAssetSequenceFence.ts');
    const fence = indexedDbSequenceFence('fence-' + crypto.randomUUID().replaceAll('-', ''));
    const a = { sequence: 1, digest: 'a'.repeat(64) };
    const b = { sequence: 2, digest: 'b'.repeat(64) };
    const c = { sequence: 2, digest: 'c'.repeat(64) };
    const initial = await fence.compareAndSwap(undefined, a);
    const outcomes = await Promise.all([fence.compareAndSwap(a, b), fence.compareAndSwap(a, c)]);
    const stored = await fence.read();
    let rollbackRejected = false;
    try { await fence.compareAndSwap(stored, a); } catch { rollbackRejected = true; }
    return { initial, outcomes, stored, rollbackRejected };
  });
  expect(result.initial).toBe(true);
  expect(result.outcomes.filter(Boolean)).toHaveLength(1);
  expect(result.stored?.sequence).toBe(2);
  expect(result.rollbackRejected).toBe(true);
});
