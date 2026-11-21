import { test, expect } from '@playwright/test';

test('verified offline cache survives reopen, retains previous, and rejects stale CAS', async ({ page }) => {
  await page.goto('/');
  const outcome = await page.evaluate(async () => {
    // @ts-ignore browser URL, resolved by the dev server
    const { indexedDbAssetSlots } = await import('/src/providers/verifiedAssetIndexedDb.ts');
    const slots = indexedDbAssetSlots();
    const id = 'playwright-verified-asset-' + Date.now();
    const a = new Uint8Array([1, 2, 3]);
    const b = new Uint8Array([4, 5, 6]);
    const hash = async (bytes: Uint8Array) =>
      Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', bytes as BufferSource)),
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

test('bounded cache refuses over-budget writes without losing the active verified asset', async ({ page }) => {
  await page.goto('/');
  const outcome = await page.evaluate(async () => {
    // @ts-ignore browser URL, resolved by the dev server
    const { indexedDbAssetSlots } = await import('/src/providers/verifiedAssetIndexedDb.ts');
    const slots = indexedDbAssetSlots(5);
    const bytes = new Uint8Array([1, 2, 3]);
    const other = new Uint8Array([4, 5, 6]);
    const hash = async (data: Uint8Array) =>
      Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', data as BufferSource)),
        x => x.toString(16).padStart(2, '0')).join('');
    const firstHash = await hash(bytes), secondHash = await hash(other);
    const first = { id: 'budget-asset', version: '1.0.0', sha256: firstHash, slot: 'sha256-' + firstHash };
    await slots.writeImmutable(first.slot, bytes);
    await slots.compareAndSwapActive(first.id, undefined, first);
    let rejected = false;
    try { await slots.writeImmutable('sha256-' + secondHash, other); }
    catch { rejected = true; }
    const reopened = indexedDbAssetSlots(5);
    const active = await reopened.active(first.id);
    const retained = await reopened.read(first.slot);
    const absent = await reopened.read('sha256-' + secondHash);
    return { rejected, active, retained: Array.from(retained ?? []), absent: absent === undefined };
  });
  expect(outcome.rejected).toBe(true);
  expect(outcome.active?.version).toBe('1.0.0');
  expect(outcome.retained).toEqual([1, 2, 3]);
  expect(outcome.absent).toBe(true);
});

test('invalid cache budgets fail closed before any write', async ({ page }) => {
  await page.goto('/');
  const rejected = await page.evaluate(async () => {
    // @ts-ignore browser URL, resolved by the dev server
    const { indexedDbAssetSlots } = await import('/src/providers/verifiedAssetIndexedDb.ts');
    return [0, -1, 1.5, Number.NaN].every(budget => {
      try { indexedDbAssetSlots(budget); return false; } catch { return true; }
    });
  });
  expect(rejected).toBe(true);
});


test('large verified asset is stored as atomic bounded records and survives offline reopen', async ({ page }) => {
  test.setTimeout(90_000);
  await page.goto('/');
  const proof = await page.evaluate(async () => {
    // @ts-ignore browser URL, resolved by the dev server
    const { indexedDbAssetSlots } = await import('/src/providers/verifiedAssetIndexedDb.ts');
    // @ts-ignore browser URL, resolved by the dev server
    const { readVerifiedActive } = await import('/src/core/verifiedAssetActivation.ts');
    const store = indexedDbAssetSlots();
    // Larger than one chunk; avoids putting 137 MiB in a single browser record.
    const bytes = new Uint8Array(34 * 1024 * 1024 + 17);
    for (let i = 0; i < bytes.length; i += 1) bytes[i] = (i * 17 + (i >>> 11)) & 255;
    const sha256 = Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', bytes as BufferSource)),
      b => b.toString(16).padStart(2, '0')).join('');
    const slot = 'sha256-' + sha256;
    const id = 'large-photo-model';
    const next = { id, version: '1.0.0', sha256, slot };
    await store.writeImmutable(slot, bytes);
    const promoted = await store.compareAndSwapActive(id, undefined, next);
    const reopened = indexedDbAssetSlots();
    const value = await readVerifiedActive(reopened, id);
    const intact = !!value && value.byteLength === bytes.byteLength &&
      value[0] === bytes[0] && value[16 * 1024 * 1024] === bytes[16 * 1024 * 1024] &&
      value[32 * 1024 * 1024] === bytes[32 * 1024 * 1024] &&
      value[bytes.length - 1] === bytes[bytes.length - 1];
    await reopened.writeImmutable(slot, bytes); // exact retries are safe
    let collisionRejected = false;
    const changed = bytes.slice();
    changed[32 * 1024 * 1024] ^= 1;
    try { await reopened.writeImmutable(slot, changed); } catch { collisionRejected = true; }

    // Missing one part must be refused; it must never look like installed bytes.
    const db = await new Promise<IDBDatabase>((resolve, reject) => {
      const r = indexedDB.open('kestrel-verified-assets', 1);
      r.onsuccess = () => resolve(r.result);
      r.onerror = () => reject(r.error);
    });
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction('immutable-by-sha256', 'readwrite');
      tx.objectStore('immutable-by-sha256').delete(slot + ':part:2');
      tx.oncomplete = () => resolve();
      tx.onabort = tx.onerror = () => reject(tx.error);
    });
    db.close();
    const refused = (await readVerifiedActive(reopened, id)) === undefined;
    const pointerPreserved = (await reopened.active(id))?.sha256 === sha256;
    return { promoted, intact, collisionRejected, refused, pointerPreserved };
  });
  expect(proof).toEqual({
    promoted: true, intact: true, collisionRejected: true, refused: true, pointerPreserved: true,
  });
});
