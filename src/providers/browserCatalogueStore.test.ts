import { strict as assert } from 'node:assert';
import { test } from 'node:test';
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
