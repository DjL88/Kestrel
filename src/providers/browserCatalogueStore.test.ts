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


test('a catalogue read waits for transaction completion and returns null only for an actual missing key', async (t) => {
  const original = Object.getOwnPropertyDescriptor(globalThis, 'indexedDB');
  t.after(() => {
    if (original) Object.defineProperty(globalThis, 'indexedDB', original);
    else Reflect.deleteProperty(globalThis, 'indexedDB');
  });

  for (const exists of [true, false]) {
    let started!: () => void;
    const awaitingRead = new Promise<void>((resolve) => { started = resolve; });
    const readRequest: { result?: CullingState; onsuccess?: () => void; onerror?: () => void } = {};
    const tx = {
      oncomplete: () => {},
      onabort: () => {},
      onerror: () => {},
      error: null,
      objectStore: () => ({
        get: () => { started(); return readRequest; },
      }),
    };
    let closed = false;
    const db = { transaction: () => tx, close: () => { closed = true; } };
    Object.defineProperty(globalThis, 'indexedDB', {
      configurable: true,
      value: { open() {
        const request = { result: db, onsuccess: () => {} };
        queueMicrotask(() => request.onsuccess());
        return request;
      } },
    });

    const result = new BrowserCatalogueStore().loadProject('important-shoot');
    let settled = false;
    void result.then(() => { settled = true; }, () => { settled = true; });
    await awaitingRead;
    readRequest.result = exists ? createDemoShootState(2) : undefined;
    readRequest.onsuccess?.();
    await new Promise<void>((resolve) => setImmediate(resolve));
    assert.equal(settled, false, 'request success must not count as a committed read');
    assert.equal(closed, false, 'database connection must remain open until transaction settles');
    tx.oncomplete();
    const loaded = await result;
    assert.equal(exists ? loaded?.frames.length : loaded, exists ? 2 : null);
    assert.equal(closed, true);
  }
});

test('an aborted read rejects instead of pretending an existing shoot was deleted', async (t) => {
  const original = Object.getOwnPropertyDescriptor(globalThis, 'indexedDB');
  t.after(() => {
    if (original) Object.defineProperty(globalThis, 'indexedDB', original);
    else Reflect.deleteProperty(globalThis, 'indexedDB');
  });

  let started!: () => void;
  const awaitingRead = new Promise<void>((resolve) => { started = resolve; });
  const readRequest: { result?: CullingState; onsuccess?: () => void } = {};
  const tx = {
    oncomplete: () => {},
    onabort: () => {},
    onerror: () => {},
    error: new Error('Drive disconnected during catalogue read'),
    objectStore: () => ({ get: () => { started(); return readRequest; } }),
  };
  let closed = false;
  const db = { transaction: () => tx, close: () => { closed = true; } };
  Object.defineProperty(globalThis, 'indexedDB', {
    configurable: true,
    value: { open() {
      const request = { result: db, onsuccess: () => {} };
      queueMicrotask(() => request.onsuccess());
      return request;
    } },
  });

  const result = new BrowserCatalogueStore().loadProject('important-shoot');
  const rejected = assert.rejects(result, /Drive disconnected during catalogue read/);
  await awaitingRead;
  readRequest.result = createDemoShootState(10);
  readRequest.onsuccess?.();
  // Even after get() said success, a subsequent abort must propagate rather than return missing.
  tx.onabort();
  await rejected;
  assert.equal(closed, true);
});

test('a failed catalogue lookup is not mistaken for an empty Quick edits project', async (t) => {
  const original = Object.getOwnPropertyDescriptor(globalThis, 'indexedDB');
  t.after(() => {
    if (original) Object.defineProperty(globalThis, 'indexedDB', original);
    else Reflect.deleteProperty(globalThis, 'indexedDB');
  });
  const readError = new Error('IndexedDB was unavailable');
  Object.defineProperty(globalThis, 'indexedDB', {
    configurable: true,
    value: { open() {
      const request = { result: undefined, onerror: () => {}, error: readError };
      queueMicrotask(() => request.onerror());
      return request;
    } },
  });
  const store = new BrowserCatalogueStore();
  await assert.rejects(store.loadProject('quick-edits'), /IndexedDB was unavailable/);
  // Optional source bytes and folder permissions may fail independently of
  // catalogue metadata; the editor must still allow relinking originals.
  assert.equal(await store.loadLocalFileBlob('missing-photo'), null);
  assert.equal(await store.loadDirectoryHandle('missing-folder'), null);
});


test('clearing stored photo copies waits for commit, propagates abort and closes the database', async (t) => {
  const original = Object.getOwnPropertyDescriptor(globalThis, 'indexedDB');
  t.after(() => {
    if (original) Object.defineProperty(globalThis, 'indexedDB', original);
    else Reflect.deleteProperty(globalThis, 'indexedDB');
  });
  for (const aborted of [true, false]) {
    let closed = false;
    const request = { onsuccess: () => {} };
    let started!: () => void;
    const begun = new Promise<void>(resolve => { started = resolve; });
    const tx = {
      oncomplete: () => {}, onabort: () => {}, error: null,
      objectStore: () => ({ clear: () => { started(); return request; } }),
    };
    const db = { transaction: () => tx, close: () => { closed = true; } };
    Object.defineProperty(globalThis, 'indexedDB', {
      configurable: true, value: { open() {
        const req = { result: db, onsuccess: () => {} };
        queueMicrotask(() => req.onsuccess());
        return req;
      } },
    });
    const clear = new BrowserCatalogueStore().clearLocalFileBlobs();
    let settled = false;
    void clear.then(() => { settled = true; }, () => { settled = true; });
    await begun;
    request.onsuccess();
    await new Promise<void>(resolve => setImmediate(resolve));
    assert.equal(settled, false);
    assert.equal(closed, false);
    if (aborted) {
      const rejected = assert.rejects(clear, /storage was interrupted/);
      tx.onabort();
      await rejected;
    } else {
      tx.oncomplete();
      await clear;
    }
    assert.equal(closed, true);
  }
});

test('full reset clears all catalogue stores in one transaction and does not hide a rollback', async (t) => {
  const original = Object.getOwnPropertyDescriptor(globalThis, 'indexedDB');
  t.after(() => {
    if (original) Object.defineProperty(globalThis, 'indexedDB', original);
    else Reflect.deleteProperty(globalThis, 'indexedDB');
  });
  const cleared: string[] = [];
  const markers: string[] = [];
  const transactions: string[][] = [];
  let closed = false;
  const tx = {
    oncomplete: () => {}, onabort: () => {}, error: null,
    objectStore: (name: string) => ({
      clear: () => cleared.push(name),
      put: (_value: unknown, key: string) => markers.push(key),
    }),
  };
  const db = { transaction: (names: string[]) => { transactions.push(names); return tx; }, close: () => { closed = true; } };
  Object.defineProperty(globalThis, 'indexedDB', {
    configurable: true, value: { open() {
      const request = { result: db, onsuccess: () => {} };
      queueMicrotask(() => request.onsuccess());
      return request;
    } },
  });
  const reset = new BrowserCatalogueStore().clearAll();
  const rejected = assert.rejects(reset, /storage was interrupted/);
  await new Promise<void>(resolve => setImmediate(resolve));
  assert.deepEqual(transactions, [['catalogue', 'localFiles', 'directoryHandles']]);
  assert.deepEqual(cleared, ['catalogue', 'localFiles', 'directoryHandles']);
  assert.deepEqual(markers, ['legacy-migration-blocked-after-delete']);
  assert.equal(closed, false);
  tx.onabort();
  await rejected;
  assert.equal(closed, true);
});

test('project listing cannot publish an empty catalogue before its cursor transaction commits', async (t) => {
  const originals = ['indexedDB', 'IDBKeyRange'].map(key => [key, Object.getOwnPropertyDescriptor(globalThis, key)] as const);
  t.after(() => {
    for (const [key, descriptor] of originals) {
      if (descriptor) Object.defineProperty(globalThis, key, descriptor);
      else Reflect.deleteProperty(globalThis, key);
    }
  });
  const cursor = { result: null, onsuccess: () => {}, onerror: () => {} };
  let closed = false;
  const tx = {
    oncomplete: () => {}, onabort: () => {}, onerror: () => {}, error: null,
    objectStore: () => ({ openCursor: () => cursor }),
  };
  const db = { transaction: () => tx, close: () => { closed = true; } };
  Object.defineProperty(globalThis, 'IDBKeyRange', { configurable: true, value: { bound: () => ({}) } });
  Object.defineProperty(globalThis, 'indexedDB', {
    configurable: true, value: { open() {
      const request = { result: db, onsuccess: () => {} };
      queueMicrotask(() => request.onsuccess());
      return request;
    } },
  });
  const listed = new BrowserCatalogueStore().listProjects();
  const rejected = assert.rejects(listed, /project list was interrupted/);
  await new Promise<void>(resolve => setImmediate(resolve));
  cursor.onsuccess();
  await new Promise<void>(resolve => setImmediate(resolve));
  assert.equal(closed, false);
  tx.onabort();
  await rejected;
  assert.equal(closed, true);
});
