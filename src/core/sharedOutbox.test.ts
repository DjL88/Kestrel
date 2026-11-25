import assert from 'node:assert/strict';
import test from 'node:test';
import { backgroundStep, dueEntries, flushOutbox, markConflict, markRetry, MAX_OUTBOX_ENTRIES, outboxSummary, queueEdit, readOutbox, retryDelayMs, settleEdit, type OutboxEntry } from './sharedOutbox';
import { recipeFingerprint } from './sharedSync';

const A = { project: 'p1', key: 'o_a', photoId: 'photo-a', accountId: 'acc-1' };
const B = { project: 'p1', key: 'o_b', photoId: 'photo-b', accountId: 'acc-1' };

test('an edit is queued once, keeps its place, and is settled when shared', () => {
  let box = queueEdit([], A, 1_000);
  box = queueEdit(box, B, 2_000);
  box = queueEdit(box, A, 3_000);
  assert.equal(box.length, 2);
  assert.equal(box[0].queuedAtMs, 1_000, 'a further edit does not move the photo to the back of the queue');
  assert.deepEqual(dueEntries(box, 'p1', 'acc-1', 3_000).map((e) => e.key), ['o_a', 'o_b']);
  box = settleEdit(box, 'p1', 'o_a');
  assert.deepEqual(box.map((e) => e.key), ['o_b']);
});

test('a failed attempt backs off and keeps the edit; coming back online tries straight away', () => {
  let box = queueEdit([], A, 0);
  box = markRetry(box, 'p1', 'o_a', 10_000);
  assert.equal(box.length, 1, 'never dropped');
  assert.equal(box[0].attempts, 1);
  assert.deepEqual(dueEntries(box, 'p1', 'acc-1', 10_000), []);
  assert.equal(dueEntries(box, 'p1', 'acc-1', 10_000 + retryDelayMs(1)).length, 1);
  assert.equal(dueEntries(box, 'p1', 'acc-1', 10_001, { force: true }).length, 1);
  assert.equal(retryDelayMs(1), 15_000);
  assert.equal(retryDelayMs(2), 30_000);
  assert.equal(retryDelayMs(40), 15 * 60_000, 'capped at 15 minutes');
  box = queueEdit(box, A, 20_000);
  assert.equal(box[0].attempts, 0, 'a new edit resets the back-off');
});

test('a conflict waits for the person: not retried, not reset by another edit, counted separately', () => {
  let box = queueEdit(queueEdit([], A, 0), B, 0);
  box = markConflict(box, 'p1', 'o_a', 'rev-9');
  box = queueEdit(box, A, 5_000);
  assert.equal(box.find((e) => e.key === 'o_a')?.state, 'conflict');
  assert.equal(box.find((e) => e.key === 'o_a')?.headId, 'rev-9');
  box = markRetry(box, 'p1', 'o_a', 5_000);
  assert.equal(box.find((e) => e.key === 'o_a')?.attempts, 0);
  assert.deepEqual(dueEntries(box, 'p1', 'acc-1', 9e12, { force: true }).map((e) => e.key), ['o_b']);
  assert.deepEqual(outboxSummary(box, 'p1'), { waiting: 1, conflicts: 1, conflictPhotoIds: ['photo-a'] });
  assert.deepEqual(outboxSummary(box, 'other'), { waiting: 0, conflicts: 0, conflictPhotoIds: [] });
  assert.deepEqual(outboxSummary(box, null), { waiting: 0, conflicts: 0, conflictPhotoIds: [] });
  assert.deepEqual(outboxSummary(box, 'p1', 'o_a'), { waiting: 1, conflicts: 0, conflictPhotoIds: [] }, 'the photo on screen is not counted twice');
});

test('queues are isolated: another project, another account and the photo on screen are left alone', () => {
  let box = queueEdit([], A, 0);
  box = queueEdit(box, { project: 'p2', key: 'o_c', photoId: 'photo-c', accountId: 'acc-1' }, 0);
  box = queueEdit(box, { ...B, accountId: 'acc-2' }, 0);
  assert.deepEqual(dueEntries(box, 'p1', 'acc-1', 1).map((e) => e.key), ['o_a']);
  assert.deepEqual(dueEntries(box, 'p1', 'acc-2', 1).map((e) => e.key), ['o_b']);
  assert.deepEqual(dueEntries(box, 'p1', 'acc-1', 1, { skipKey: 'o_a' }), []);
});

test('the stored list is read defensively and survives a restart round-trip', () => {
  const box = markConflict(queueEdit(queueEdit([], A, 1), B, 2), 'p1', 'o_b', 'rev-2');
  assert.deepEqual(readOutbox(JSON.parse(JSON.stringify(box))), box);
  assert.deepEqual(readOutbox(null), []);
  assert.deepEqual(readOutbox({}), []);
  const junk = [null, 7, { project: 'p' }, { ...box[0], state: 'done' }, { ...box[0], attempts: -1 }, { ...box[0], queuedAtMs: Infinity }, box[0], { ...box[0] }];
  assert.deepEqual(readOutbox(junk), [box[0]], 'bad and duplicate entries are ignored');
  const noAccount = readOutbox([{ ...box[0], accountId: 5 }]);
  assert.equal(noAccount[0].accountId, null);
});

test('the queue is bounded without dropping anything already queued', () => {
  const many: OutboxEntry[] = Array.from({ length: MAX_OUTBOX_ENTRIES }, (_, i) => ({ project: 'p', key: `k${i}`, photoId: `f${i}`, accountId: null, queuedAtMs: i, attempts: 0, nextTryMs: 0, state: 'pending' }));
  const after = queueEdit(many, { project: 'p', key: 'new', photoId: 'x', accountId: null }, 1);
  assert.equal(after.length, MAX_OUTBOX_ENTRIES);
  assert.equal(after[0].key, 'k0');
});

test('background steps follow the same rule as an open photo and never overwrite a moved shared copy', () => {
  const mine = recipeFingerprint({ exposure: 0.5 });
  const before = recipeFingerprint({ exposure: 0 });
  // Only this device moved since rev-1: share on top of rev-1.
  assert.deepEqual(backgroundStep({ revisionId: 'rev-1', recipeHash: before }, mine, 'rev-1', false), { step: 'publish', baseRevisionId: 'rev-1' });
  // Both moved: conflict, never a publish.
  assert.deepEqual(backgroundStep({ revisionId: 'rev-1', recipeHash: before }, mine, 'rev-2', false), { step: 'conflict', headId: 'rev-2' });
  // Never synced, and someone already shared an edit: conflict.
  assert.deepEqual(backgroundStep(null, mine, 'rev-2', false), { step: 'conflict', headId: 'rev-2' });
  // Never synced, nothing shared yet: share it as the first revision.
  assert.deepEqual(backgroundStep(null, mine, null, false), { step: 'publish', baseRevisionId: null });
  // Already shared (this device matches), or only the shared copy moved: nothing left to send.
  assert.deepEqual(backgroundStep({ revisionId: 'rev-1', recipeHash: mine }, mine, 'rev-1', false), { step: 'settle' });
  assert.deepEqual(backgroundStep({ revisionId: 'rev-1', recipeHash: mine }, mine, 'rev-3', false), { step: 'settle' });
});

/**
 * Two devices against a fake shared project that enforces the server's two rules: one checkout per photo, and a save
 * must start from the current head (revision compare-and-set). Device 1 edits three photos offline and restarts;
 * meanwhile device 2 changes one of them. Back online, the other two are shared and the third waits as a conflict.
 */
class FakeProject {
  heads = new Map<string, { id: string; recipe: Record<string, unknown> }[]>();
  leases = new Map<string, { token: string; account: string }>();
  online = true;
  calls: string[] = [];
  private n = 0;
  head(key: string) { const list = this.heads.get(key) ?? []; return list[list.length - 1] ?? null; }
  api(account: string) {
    const check = () => { if (!this.online) throw new Error('offline'); };
    return {
      acquire: async (_p: string, key: string) => {
        check();
        const held = this.leases.get(key);
        if (held && held.account !== account) throw Object.assign(new Error('checked out'), { code: 'out' });
        const token = `t${++this.n}`; this.leases.set(key, { token, account }); this.calls.push(`acquire ${key}`); return { token };
      },
      history: async (_p: string, key: string) => { check(); return { headId: this.head(key)?.id ?? null }; },
      publish: async (_p: string, key: string, request: { token: string; baseRevisionId: string | null; recipe: Record<string, unknown> }) => {
        check();
        if (this.leases.get(key)?.token !== request.token) throw Object.assign(new Error('lease'), { code: 'lease' });
        const head = this.head(key);
        if ((head?.id ?? null) !== request.baseRevisionId) throw Object.assign(new Error('stale'), { code: 'stale', headId: head?.id });
        const revision = { id: `r${++this.n}`, recipe: request.recipe };
        this.heads.set(key, [...(this.heads.get(key) ?? []), revision]); this.calls.push(`publish ${key}`); return revision;
      },
      release: async (_p: string, key: string, token: string) => { if (this.leases.get(key)?.token === token) this.leases.delete(key); },
    };
  }
}

function device(server: FakeProject, account: string, start: { edits?: Record<string, Record<string, unknown> | null>; stored?: string; points?: Record<string, { revisionId: string | null; recipeHash: string }> } = {}) {
  const edits = new Map(Object.entries(start.edits ?? {}));
  const points = new Map(Object.entries(start.points ?? {}));
  let stored = start.stored ?? '[]';
  let clock = 1_000;
  const deps = {
    ...server.api(account),
    classify: (error: unknown) => {
      const e = error as { code?: string; headId?: string };
      return e.code === 'stale' && e.headId ? { kind: 'stale' as const, headId: e.headId } : e.code === 'out' ? { kind: 'checked-out' as const } : { kind: 'other' as const };
    },
    editOf: (id: string) => edits.get(id) ?? null,
    exists: (id: string) => edits.has(id),
    pointOf: (_p: string, key: string) => points.get(key) ?? null,
    setPoint: (_p: string, key: string, point: { revisionId: string | null; recipeHash: string }) => { points.set(key, point); },
    fingerprint: recipeFingerprint,
    read: () => readOutbox(JSON.parse(stored)),
    change: (update: (entries: OutboxEntry[]) => OutboxEntry[]) => { stored = JSON.stringify(update(readOutbox(JSON.parse(stored)))); },
    now: () => clock,
  };
  return {
    deps, edits, points,
    edit(photoId: string, key: string, edit: Record<string, unknown>) { edits.set(photoId, edit); deps.change((entries) => queueEdit(entries, { project: 'p', key, photoId, accountId: account }, clock)); },
    stored: () => stored,
    tick(ms: number) { clock += ms; },
  };
}

test('offline edits survive a restart and are shared on reconnect; a photo changed elsewhere waits as a conflict', async () => {
  const server = new FakeProject();
  const zero = recipeFingerprint({ exposure: 0 });
  // Both devices start in step: every photo is at r0 with no edit.
  for (const key of ['o_a', 'o_b', 'o_c']) server.heads.set(key, [{ id: `${key}-r0`, recipe: { edit: { exposure: 0 } } }]);
  const points = { o_a: { revisionId: 'o_a-r0', recipeHash: zero }, o_b: { revisionId: 'o_b-r0', recipeHash: zero }, o_c: { revisionId: 'o_c-r0', recipeHash: zero } };
  const laptop = device(server, 'acc-1', { edits: { a: { exposure: 0 }, b: { exposure: 0 }, c: { exposure: 0 } }, points });

  server.online = false;
  laptop.edit('a', 'o_a', { exposure: 0.4 });
  laptop.edit('b', 'o_b', { exposure: -0.3 });
  laptop.edit('c', 'o_c', { exposure: 1 });
  let run = await flushOutbox('p', 'acc-1', laptop.deps);
  assert.deepEqual(run, { shared: 0, conflicts: 0, stopped: true }, 'offline: stops at once');
  assert.equal(readOutbox(JSON.parse(laptop.stored())).length, 3, 'nothing is lost while offline');

  // Restart: a new device object reads the same stored queue and the same catalogue.
  const restarted = device(server, 'acc-1', { edits: Object.fromEntries(laptop.edits), points: Object.fromEntries(laptop.points), stored: laptop.stored() });

  // Meanwhile someone else saved photo C.
  server.online = true;
  const phone = server.api('acc-2');
  const lease = await phone.acquire('p', 'o_c');
  await phone.publish('p', 'o_c', { token: lease.token, baseRevisionId: 'o_c-r0', recipe: { edit: { exposure: -1 } } });
  await phone.release('p', 'o_c', lease.token);

  run = await flushOutbox('p', 'acc-1', restarted.deps, { force: true });
  assert.deepEqual(run, { shared: 2, conflicts: 1, stopped: false });
  assert.deepEqual(server.head('o_a')?.recipe, { edit: { exposure: 0.4 } });
  assert.deepEqual(server.head('o_b')?.recipe, { edit: { exposure: -0.3 } });
  assert.deepEqual(server.head('o_c')?.recipe, { edit: { exposure: -1 } }, 'the other person’s edit is not overwritten');
  assert.deepEqual(restarted.edits.get('c'), { exposure: 1 }, 'and this device’s edit is still here to choose from');
  const left = readOutbox(JSON.parse(restarted.stored()));
  assert.deepEqual(left.map((e) => [e.key, e.state]), [['o_c', 'conflict']]);
  assert.equal(server.leases.size, 0, 'every checkout is checked back in');

  // Running again sends nothing twice.
  const before = server.calls.length;
  run = await flushOutbox('p', 'acc-1', restarted.deps, { force: true });
  assert.deepEqual(run, { shared: 0, conflicts: 0, stopped: false });
  assert.equal(server.calls.length, before, 'no duplicate retry');
});

test('a photo someone has out is retried later without blocking the rest; another account never sends the queue', async () => {
  const server = new FakeProject();
  const laptop = device(server, 'acc-1', { edits: { a: null, b: null } });
  laptop.edit('a', 'o_a', { exposure: 0.2 });
  laptop.edit('b', 'o_b', { exposure: 0.1 });
  await server.api('acc-2').acquire('p', 'o_a');

  let run = await flushOutbox('p', 'acc-1', laptop.deps);
  assert.deepEqual(run, { shared: 1, conflicts: 0, stopped: false });
  const waiting = readOutbox(JSON.parse(laptop.stored()));
  assert.deepEqual(waiting.map((e) => [e.key, e.state, e.attempts]), [['o_a', 'pending', 1]]);

  // Signed in as someone else on this device: nothing is due, nothing is sent.
  run = await flushOutbox('p', 'acc-2', laptop.deps, { force: true });
  assert.deepEqual(run, { shared: 0, conflicts: 0, stopped: false });

  // Released: the next due try shares it.
  server.leases.clear();
  laptop.tick(retryDelayMs(1));
  run = await flushOutbox('p', 'acc-1', laptop.deps);
  assert.deepEqual(run, { shared: 1, conflicts: 0, stopped: false });
  assert.deepEqual(server.head('o_a')?.recipe, { edit: { exposure: 0.2 } });
});

test('a removed photo’s queued edit waits instead of sharing "no edit"', async () => {
  const server = new FakeProject();
  const laptop = device(server, 'acc-1');
  laptop.edit('a', 'o_a', { exposure: 0.2 });
  laptop.edits.delete('a');
  const run = await flushOutbox('p', 'acc-1', laptop.deps, { force: true });
  assert.deepEqual(run, { shared: 0, conflicts: 0, stopped: false });
  assert.equal(server.calls.length, 0);
  assert.equal(readOutbox(JSON.parse(laptop.stored())).length, 1);
});
