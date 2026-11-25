import test from 'node:test';
import assert from 'node:assert/strict';
import { createSaveGuard, type SaveStatus } from './saveGuard.ts';

/** A storage double: records committed values per project, and fails while `failing` is set. */
function fakeStore() {
  const committed = new Map<string, number>();
  let failing: Error | null = null;
  let crashMidWrite = false;
  const store = {
    committed,
    fail(error: Error | null) { failing = error; },
    crashNextWrite() { crashMidWrite = true; },
    async save(state: { id: string; n: number }) {
      await Promise.resolve();
      if (crashMidWrite) { crashMidWrite = false; throw new Error('Catalogue write was interrupted'); } // transaction aborted: nothing committed
      if (failing) throw failing;
      committed.set(state.id, state.n);
    },
  };
  return store;
}

function manualTimers() {
  const pending: Array<{ run: () => void; ms: number; live: boolean }> = [];
  return {
    pending,
    setTimer: (run: () => void, ms: number) => { const t = { run, ms, live: true }; pending.push(t); return t; },
    clearTimer: (t: unknown) => { (t as { live: boolean }).live = false; },
    fireAll() { const due = pending.splice(0).filter((t) => t.live); due.forEach((t) => t.run()); return due.map((t) => t.ms); },
  };
}

const flush = () => new Promise((resolve) => setImmediate(resolve));

test('a full disk does not lose the change: it is retried with backoff until it is stored', async () => {
  const store = fakeStore();
  const timers = manualTimers();
  const statuses: SaveStatus[] = [];
  const guard = createSaveGuard({ save: store.save, retryDelaysMs: [10, 20], setTimer: timers.setTimer, clearTimer: timers.clearTimer, onStatus: (s) => statuses.push(s) });
  store.fail(Object.assign(new Error('QuotaExceededError'), { name: 'QuotaExceededError' }));
  guard.submit('p1', { id: 'p1', n: 1 });
  await flush();
  assert.equal(guard.hasUnsaved(), true);
  assert.equal(guard.hasFailedUnsaved(), true, 'closing InFlight now would lose the change, so it warns');
  assert.equal(store.committed.has('p1'), false);
  assert.deepEqual(timers.fireAll(), [10]);
  await flush();
  assert.deepEqual(timers.fireAll(), [20]);
  await flush();
  assert.deepEqual(timers.fireAll(), [20], 'the last delay repeats; it never gives up');
  await flush();
  assert.equal(store.committed.has('p1'), false);
  store.fail(null);
  await flush();
  assert.deepEqual(timers.fireAll(), [20]);
  await flush();
  assert.equal(store.committed.get('p1'), 1);
  assert.equal(guard.hasUnsaved(), false);
  assert.equal(guard.hasFailedUnsaved(), false);
  assert.equal(statuses.at(-1), 'saved');
});

test('a crash mid-write keeps the change pending, and the next attempt stores the latest state', async () => {
  const store = fakeStore();
  const timers = manualTimers();
  const guard = createSaveGuard({ save: store.save, setTimer: timers.setTimer, clearTimer: timers.clearTimer });
  guard.submit('p1', { id: 'p1', n: 1 });
  await guard.idle();
  store.crashNextWrite();
  guard.submit('p1', { id: 'p1', n: 2 });
  await flush();
  assert.equal(store.committed.get('p1'), 1, 'the interrupted write committed nothing; the earlier record is intact');
  assert.equal(guard.hasUnsaved(), true);
  guard.submit('p1', { id: 'p1', n: 3 }); // the user carries on while the retry waits
  await guard.idle();
  assert.equal(store.committed.get('p1'), 3);
  assert.equal(guard.hasUnsaved(), false);
});

test('switching project while a save is failing never replaces the first project\'s pending change', async () => {
  const store = fakeStore();
  const timers = manualTimers();
  const guard = createSaveGuard({ save: store.save, setTimer: timers.setTimer, clearTimer: timers.clearTimer });
  store.fail(new Error('write refused'));
  guard.submit('a', { id: 'a', n: 7 });
  await flush();
  guard.submit('b', { id: 'b', n: 1 });
  await flush();
  store.fail(null);
  guard.retryNow();
  await guard.idle();
  assert.equal(store.committed.get('a'), 7);
  assert.equal(store.committed.get('b'), 1);
  assert.equal(guard.hasUnsaved(), false);
});

test('rapid changes save in order and the stored state is always the newest', async () => {
  const store = fakeStore();
  const writes: number[] = [];
  const guard = createSaveGuard({ save: async (s: { id: string; n: number }) => { writes.push(s.n); await store.save(s); } });
  for (let n = 1; n <= 5; n += 1) guard.submit('p', { id: 'p', n });
  assert.equal(guard.hasFailedUnsaved(), false, 'an ordinary save in flight does not trigger the close warning');
  await guard.idle();
  assert.equal(store.committed.get('p'), 5);
  assert.ok(writes.length <= 2, `coalesced while a write was in flight (wrote ${writes.join(', ')})`);
  assert.equal(writes.at(-1), 5);
});

test('an unchanged state is not written again', async () => {
  let writes = 0;
  const guard = createSaveGuard({ save: async () => { writes += 1; } });
  const state = { id: 'p', n: 1 };
  guard.submit('p', state);
  await guard.idle();
  guard.submit('p', state);
  await guard.idle();
  assert.equal(writes, 1);
});
