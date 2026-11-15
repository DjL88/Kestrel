import { strict as assert } from 'node:assert';
import { test } from 'node:test';
import { createDemoShootState } from '../core/cullingEngine';
import type { CullingState } from '../core/types';
import { BrowserCatalogueStore } from './browserCatalogueStore';

test('local file storage reports success only after the transaction commits', async (t) => {
  const original = Object.getOwnPropertyDescriptor(globalThis, 'indexedDB');
  t.after(() => {
    if (original) Object.defineProperty(globalThis, 'indexedDB', original);
    else Reflect.deleteProperty(globalThis, 'indexedDB');
  });

  for (const aborted of [true, false]) {
    let closed = false;
    const request: { onsuccess?: () => void } = {};
    const tx = {
      oncomplete: () => {},
      onabort: () => {},
      error: null,
      objectStore: () => ({
        put: () => {
          putStarted();
          return request;
        },
      }),
    };
    let putStarted!: () => void;
    const started = new Promise<void>((resolve) => { putStarted = resolve; });
    const db = {
      transaction: () => tx,
      close: () => { closed = true; },
    };
    Object.defineProperty(globalThis, 'indexedDB', {
      configurable: true,
      value: {
        open() {
          const openRequest = { result: db, onsuccess: () => {} };
          queueMicrotask(() => openRequest.onsuccess());
          return openRequest;
        },
      },
    });

    const saved = new BrowserCatalogueStore().saveLocalFileBlob('synthetic', new Blob(['test']));
    await started;
    request.onsuccess?.();
    await new Promise<void>((resolve) => setImmediate(resolve));
    assert.equal(closed, false, 'the request succeeded but the transaction is still unsettled');

    if (aborted) tx.onabort();
    else tx.oncomplete();
    assert.equal(await saved, !aborted);
    assert.equal(closed, true);
  }
});

test('a multi-project save queues both records in one transaction and rejects on abort', async (t) => {
  const original = Object.getOwnPropertyDescriptor(globalThis, 'indexedDB');
  t.after(() => {
    if (original) Object.defineProperty(globalThis, 'indexedDB', original);
    else Reflect.deleteProperty(globalThis, 'indexedDB');
  });

  const keys: string[] = [];
  let transactions = 0;
  const tx = {
    onabort: () => {},
    error: null,
    objectStore: () => ({ put: (_state: CullingState, key: string) => keys.push(key) }),
  };
  const db = {
    transaction() { transactions += 1; return tx; },
    close() {},
  };
  Object.defineProperty(globalThis, 'indexedDB', {
    configurable: true,
    value: {
      open() {
        const request = { result: db, onsuccess: () => {} };
        queueMicrotask(() => request.onsuccess());
        return request;
      },
    },
  });

  const source = createDemoShootState(0);
  const target = { ...source, shoot: { ...source.shoot, id: 'target' } };
  const write = new BrowserCatalogueStore().saveProjects([source, target]);
  const rejected = assert.rejects(write, /Catalogue write was interrupted/);
  await new Promise<void>((resolve) => setImmediate(resolve));
  assert.equal(transactions, 1);
  assert.deepEqual(keys, [`project:${source.shoot.id}`, 'project:target']);
  tx.onabort();
  await rejected;
});
