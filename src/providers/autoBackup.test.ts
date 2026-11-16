import assert from 'node:assert/strict';
import test from 'node:test';
import { createDemoShootState } from '../core/cullingEngine';
import { restoreProjectBackup } from '../core/projectBackup';
import { addConnection, removeConnection } from './connectionStore';
import { setLocations } from './projectLocations';
import { backUpProjectNow, maybeBackUp } from './autoBackup';

function deferred() {
  let resolve!: () => void;
  const promise = new Promise<void>((done) => { resolve = done; });
  return { promise, resolve };
}

test('edits made during a slow folder backup remain due and restore from the next backup', async (t) => {
  const values = new Map<string, string>();
  const previous = Object.getOwnPropertyDescriptor(globalThis, 'localStorage');
  Object.defineProperty(globalThis, 'localStorage', { configurable: true, value: {
    getItem: (key: string) => values.get(key) ?? null,
    setItem: (key: string, value: string) => values.set(key, value),
    removeItem: (key: string) => values.delete(key),
  } });
  t.after(() => { if (previous) Object.defineProperty(globalThis, 'localStorage', previous); else Reflect.deleteProperty(globalThis, 'localStorage'); });
  const started = deferred();
  const release = deferred();
  const written: string[] = [];
  const folder = {
    async getDirectoryHandle() { return folder; },
    async getFileHandle() { return { async createWritable() { return {
      async write(bytes: Uint8Array) { written.push(new TextDecoder().decode(bytes)); if (written.length === 1) { started.resolve(); await release.promise; } },
      async close() {},
    }; } }; },
    async *entries() {},
  } as unknown as FileSystemDirectoryHandle;
  const connection = addConnection('folder', 'Synthetic folder', 'Synthetic folder', { handle: folder });
  t.after(() => removeConnection(connection.id));
  t.after(() => release.resolve());
  const state = createDemoShootState(2);
  state.shoot = { ...state.shoot, id: 'slow-backup-test', lastUpdatedAt: 1000 };
  setLocations(state.shoot.id, { backUpTo: connection.id });
  const saving = backUpProjectNow(state);
  await started.promise;
  const newer = { ...state, shoot: { ...state.shoot, lastUpdatedAt: 2000 },
    frames: state.frames.map((frame) => ({ ...frame, decision: 'keep' as const })) };
  // A second trigger must observe the change without launching a competing write.
  await maybeBackUp(newer);
  assert.equal(written.length, 1);
  const leaving = maybeBackUp(newer, true);
  release.resolve();
  assert.equal((await saving).state, 'ok');
  await leaving;
  assert.equal(written.length, 2, 'leaving must back up the edits made during the first write');
  const restored = restoreProjectBackup(written[1], 'restored');
  assert.ok(restored.frames.every((frame) => frame.decision === 'keep'));
  assert.ok(state.frames.every((frame) => frame.decision === 'unreviewed'), 'the source snapshot was not mutated');
  await maybeBackUp(newer, true);
  assert.equal(written.length, 2, 'the saved revision must not be written again');
  const remembered = JSON.parse(values.get('kestrel.backupclock.v1')!)[state.shoot.id];
  assert.equal(remembered.backedUpChangeAt, 2000, 'persist the saved revision, not the completion time');
});

test('a folder permission failure becomes a recoverable backup result', async (t) => {
  const folder = { async queryPermission() { throw new Error('The mounted folder is unavailable.'); } } as unknown as FileSystemDirectoryHandle;
  const connection = addConnection('folder', 'Disconnected folder', 'Synthetic folder', { handle: folder });
  t.after(() => removeConnection(connection.id));
  const { backUpNow } = await import('./autoBackup');
  const result = await backUpNow(createDemoShootState(1), connection.id);
  assert.equal(result.state, 'failed');
  assert.match(result.message!, /unavailable/);
});
