import assert from 'node:assert/strict';
import test from 'node:test';
import { mkdtemp, mkdir, readdir, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createDemoShootState } from '../core/cullingEngine';
import { encodeProjectBackup, restoreProjectBackup } from '../core/projectBackup';
import { backupFolder, KEEP_BACKUPS } from '../core/autoBackup';
import { addConnection, removeConnection } from './connectionStore';
import { setLocations } from './projectLocations';
import { backUpNow, backUpProjectNow, maybeBackUp } from './autoBackup';

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

/** Real temporary files behind the browser folder API. Only synthetic catalogue data is written. */
function folderAt(path: string): FileSystemDirectoryHandle {
  return {
    kind: 'directory',
    async getDirectoryHandle(name: string, options?: { create?: boolean }) {
      const child = join(path, name);
      if (options?.create) await mkdir(child, { recursive: true });
      return folderAt(child);
    },
    async getFileHandle(name: string) {
      return { async createWritable() {
        let pending: Uint8Array;
        return {
          async write(bytes: Uint8Array) { pending = bytes; },
          async close() { await writeFile(join(path, name), pending); },
          async abort() {},
        };
      } };
    },
    async removeEntry(name: string) { await rm(join(path, name)); },
    async *entries() {
      for (const entry of await readdir(path, { withFileTypes: true })) {
        yield [entry.name, entry.isDirectory() ? folderAt(join(path, entry.name)) : { kind: 'file' }];
      }
    },
  } as unknown as FileSystemDirectoryHandle;
}

test('same-title projects keep independent, restorable backups through renames and retention cleanup', async (t) => {
  const root = await mkdtemp(join(tmpdir(), 'kestrel-backup-test-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  const connection = addConnection('folder', 'Synthetic mounted drive', 'Temporary test folder', { handle: folderAt(root) });
  t.after(() => removeConnection(connection.id));
  const state = createDemoShootState(2);
  const first = { ...state, shoot: { ...state.shoot, id: 'project-A', title: 'Kite day' } };
  const second = { ...state, shoot: { ...state.shoot, id: 'project-a', title: 'Kite day' } };
  const at = new Date('2026-11-16T09:00:00Z');
  for (const project of [first, second, first]) assert.equal((await backUpNow(project, connection.id, at)).state, 'ok');
  const folderA = join(root, backupFolder(first.shoot.id));
  const folderB = join(root, backupFolder(second.shoot.id));
  assert.equal((await readdir(folderA)).length, 2, 'same-millisecond snapshots remain separate');
  const otherName = (await readdir(folderB))[0];
  const otherBytes = await readFile(join(folderB, otherName));
  const legacyFolder = join(root, 'kestrel/v1/backups/kite-day');
  await mkdir(legacyFolder, { recursive: true });
  const legacy = join(legacyFolder, '2026-11-15T09-00-00-000Z.kestrel.json');
  await writeFile(legacy, encodeProjectBackup(second));
  const pinned = join(folderA, 'manually-kept.kestrel.json');
  await writeFile(pinned, encodeProjectBackup(first));
  const renamed = { ...first, shoot: { ...first.shoot, title: 'Kites at dusk' },
    frames: first.frames.map((frame) => ({ ...frame, decision: 'keep' as const, edit: { exposure: 0.5, warmth: 0, colour: 0 } })) };
  for (let minute = 1; minute <= 12; minute += 1) {
    assert.equal((await backUpNow(renamed, connection.id, new Date(at.getTime() + minute * 60_000))).state, 'ok');
  }
  const names = (await readdir(folderA)).filter((name) => name !== 'manually-kept.kestrel.json').sort();
  assert.equal(names.length, KEEP_BACKUPS);
  const restored = restoreProjectBackup(await readFile(join(folderA, names.at(-1)!), 'utf8'), 'restore-A');
  assert.equal(restored.shoot.title, 'Kites at dusk (restored)');
  assert.ok(restored.frames.every((frame) => frame.decision === 'keep' && frame.edit?.exposure === 0.5));
  assert.deepEqual(await readFile(join(folderB, otherName)), otherBytes);
  assert.equal((await readdir(folderB)).length, 1);
  assert.equal(restoreProjectBackup(await readFile(legacy, 'utf8'), 'restore-old').frames.length, 2);
  assert.equal(await readFile(pinned, 'utf8'), encodeProjectBackup(first));
});

test('a failing optional backup does not interrupt local recovery or lose retry state', async (t) => {
  const localRoot = await mkdtemp(join(tmpdir(), 'kestrel-local-recovery-'));
  t.after(() => rm(localRoot, { recursive: true, force: true }));
  const local = folderAt(localRoot);
  const failing = {
    async queryPermission() { return 'granted'; },
    async getDirectoryHandle() { throw new Error('Network drive disconnected'); },
  } as unknown as FileSystemDirectoryHandle;
  const previous = Object.getOwnPropertyDescriptor(globalThis, 'navigator');
  Object.defineProperty(globalThis, 'navigator', { configurable: true, value: {
    storage: { getDirectory: async () => local },
    userAgent: 'iPhone',
  } });
  const connection = addConnection('folder', 'Offline NAS', 'NAS', { handle: failing });
  t.after(async () => {
    removeConnection(connection.id);
    if (previous) Object.defineProperty(globalThis, 'navigator', previous);
    else Reflect.deleteProperty(globalThis, 'navigator');
  });
  const state = createDemoShootState(2);
  const result = await backUpNow(state, connection.id);
  assert.equal(result.state, 'partial');
  assert.match(result.message ?? '', /Saved locally/);
  const names = await readdir(join(localRoot, backupFolder(state.shoot.id)));
  assert.equal(names.length, 1, 'recovery remains on device after the NAS write failed');
  const saved = await readFile(join(localRoot, backupFolder(state.shoot.id), names[0]), 'utf8');
  assert.equal(restoreProjectBackup(saved, 'reopened').frames.length, state.frames.length);
});

test('mobile with a writable NAS source backs up to the app and the source', async (t) => {
  const localRoot = await mkdtemp(join(tmpdir(), 'kestrel-phone-recovery-'));
  const nasRoot = await mkdtemp(join(tmpdir(), 'kestrel-nas-recovery-'));
  t.after(() => rm(localRoot, { recursive: true, force: true }));
  t.after(() => rm(nasRoot, { recursive: true, force: true }));
  const previous = Object.getOwnPropertyDescriptor(globalThis, 'navigator');
  Object.defineProperty(globalThis, 'navigator', { configurable: true, value: {
    storage: { getDirectory: async () => folderAt(localRoot) },
    userAgent: 'iPhone',
  } });
  t.after(() => {
    if (previous) Object.defineProperty(globalThis, 'navigator', previous);
    else Reflect.deleteProperty(globalThis, 'navigator');
  });
  const source = addConnection('folder', 'NAS photographs', 'Network drive', { handle: folderAt(nasRoot) });
  t.after(() => removeConnection(source.id));
  const state = createDemoShootState(1);
  const { demoVariant: _demo, ...original } = state.frames[0];
  state.frames[0] = { ...original, sourceKind: 'file', isDemo: false, stableKey: 'remote-raw-1' };
  setLocations(state.shoot.id, { loadFrom: source.id });
  const result = await backUpNow(state, '@kestrel-device-or-photo-folder');
  assert.equal(result.state, 'ok');
  const relative = backupFolder(state.shoot.id);
  assert.equal((await readdir(join(localRoot, relative))).length, 1);
  assert.equal((await readdir(join(nasRoot, relative))).length, 1);
});
