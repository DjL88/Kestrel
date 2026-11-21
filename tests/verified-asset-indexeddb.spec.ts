import { test, expect } from '@playwright/test';

test('verified offline cache survives reopen, retains previous, and rejects stale CAS', async ({ page }) => {
  await page.goto('/');
  const outcome = await page.evaluate(async () => {
    const { indexedDbAssetSlots } = await import('/src/providers/verifiedAssetIndexedDb.ts');
    const slots = indexedDbAssetSlots();
    const id = 'playwright-verified-asset-' + Date.now();
    const a = new Uint8Array([1, 2, 3]);
    const b = new Uint8Array([4, 5, 6]);
    const hash = async (bytes: Uint8Array) =>
      Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', bytes)),
        x => x.toString(16).padStart(2, '0')).join('');
    const firstHash = await hash(a), secondHash = await hash(b);
    const first = { id, version: '1.0.0', sha256: firstHash, slot: 'sha256-' + firstHash };
    const second = { id, version: '1.1.0', sha256: secondHash, slot: 'sha256-' + secondHash };
    await slots.writeImmutable(first.slot, a);
    const initial = await slots.compareAndSwapActive(id, undefined, first);
    await slots.writeImmutable(second.slot, b);
    const upgraded = await slots.compareAndSwapActive(id, first, second);
    const stale = await slots.compareAndSwapActive(id, first, first);
    const reopened = indexedDbAssetSlots();
    const active = await reopened.active(id), previous = await reopened.previous(id);
    const read = await reopened.read(second.slot);
    let immutableRejected = false;
    try { await reopened.writeImmutable(second.slot, new Uint8Array([9])); }
    catch { immutableRejected = true; }
    return { initial, upgraded, stale, active, previous, read: Array.from(read ?? []), immutableRejected };
  });
  expect(outcome.initial).toBe(true);
  expect(outcome.upgraded).toBe(true);
  expect(outcome.stale).toBe(false);
  expect(outcome.active?.version).toBe('1.1.0');
  expect(outcome.previous?.version).toBe('1.0.0');
  expect(outcome.read).toEqual([4, 5, 6]);
  expect(outcome.immutableRejected).toBe(true);
});
