import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createDemoShootState } from '../core/cullingEngine';
import { recordEdit } from '../core/editHistory';
import { DEFAULT_EDIT } from '../core/photoEdits';
import { restoreProjectBackup } from '../core/projectBackup';
import { saveProjectBackupFile } from './projectBackupFile';

function fixture() {
  const state = createDemoShootState(1);
  state.shoot.title = 'A/B: edited project';
  state.frames[0] = recordEdit(state.frames[0], { edit: { ...DEFAULT_EDIT, exposure: 0.5 } }, 1000);
  state.frames[0].decision = 'keep';
  return state;
}

type Invoke = (command: string, args: unknown, options?: { headers?: Record<string, string> }) => Promise<unknown>;

function installWindow(t: { after(fn: () => void): void }, value: unknown) {
  const previous = Object.getOwnPropertyDescriptor(globalThis, 'window');
  Object.defineProperty(globalThis, 'window', { configurable: true, value });
  t.after(() => {
    if (previous) Object.defineProperty(globalThis, 'window', previous);
    else Reflect.deleteProperty(globalThis, 'window');
  });
}

function desktopWindow(t: { after(fn: () => void): void }, invoke: Invoke) {
  installWindow(t, {
    __TAURI_INTERNALS__: { invoke },
    showSaveFilePicker: () => { throw new Error('The browser picker must not run inside the desktop app.'); },
  });
}

test('desktop backup waits for the native write and saves a restorable edit recipe', async (t) => {
  const state = fixture();
  const before = structuredClone(state);
  const path = '/mounted/test-volume/A_B_ edited project.kestrel.json';
  let completeWrite!: () => void;
  let writeStarted!: () => void;
  const started = new Promise<void>((resolve) => { writeStarted = resolve; });
  const pendingWrite = new Promise<void>((resolve) => { completeWrite = resolve; });
  let bytes: Uint8Array | undefined;
  desktopWindow(t, async (command, args, options) => {
    if (command === 'plugin:dialog|save') {
      assert.equal((args as { options: { defaultPath: string } }).options.defaultPath, 'A_B_ edited project.kestrel.json');
      return path;
    }
    if (command === 'plugin:fs|write_file') {
      assert.equal(decodeURIComponent(options!.headers!.path), path);
      bytes = args as Uint8Array;
      writeStarted();
      await pendingWrite;
      return;
    }
    assert.equal(command, 'plugin:opener|reveal_item_in_dir');
  });
  let settled = false;
  const saving = saveProjectBackupFile(state).then((result) => { settled = true; return result; });
  await started;
  assert.equal(settled, false, 'must not report success while the filesystem write is pending');
  completeWrite();
  assert.equal(await saving, 'saved');
  const restored = restoreProjectBackup(new TextDecoder().decode(bytes), 'restored');
  assert.deepEqual(restored.frames, JSON.parse(JSON.stringify(state.frames)));
  assert.deepEqual(state, before, 'saving must not mutate catalogue decisions or edit history');
});

test('cancelling the native picker returns cancelled without writing or downloading', async (t) => {
  const commands: string[] = [];
  desktopWindow(t, async (command) => { commands.push(command); return null; });
  assert.equal(await saveProjectBackupFile(fixture()), 'cancelled');
  assert.deepEqual(commands, ['plugin:dialog|save']);
});

for (const failingCommand of ['plugin:dialog|save', 'plugin:fs|write_file']) {
  test(`desktop backup propagates ${failingCommand} failure without a browser fallback`, async (t) => {
    const failure = new Error('Destination is unavailable');
    const commands: string[] = [];
    desktopWindow(t, async (command) => {
      commands.push(command);
      if (command === failingCommand) throw failure;
      assert.equal(command, 'plugin:dialog|save');
      return '/mounted/test-volume/project.kestrel.json';
    });
    await assert.rejects(saveProjectBackupFile(fixture()), (reason) => reason === failure);
    assert.deepEqual(commands, failingCommand === 'plugin:dialog|save'
      ? ['plugin:dialog|save'] : ['plugin:dialog|save', 'plugin:fs|write_file']);
  });
}

test('browser picker backup still waits for the stream to close', async (t) => {
  let closeStarted!: () => void;
  let finishClose!: () => void;
  const closing = new Promise<void>((resolve) => { closeStarted = resolve; });
  const pendingClose = new Promise<void>((resolve) => { finishClose = resolve; });
  let written: Blob | undefined;
  installWindow(t, { showSaveFilePicker: async () => ({ createWritable: async () => ({
    write: async (blob: Blob) => { written = blob; },
    close: async () => { closeStarted(); await pendingClose; },
    abort: async () => assert.fail('successful stream must not be aborted'),
  }) }) });
  let settled = false;
  const saving = saveProjectBackupFile(fixture()).then((result) => { settled = true; return result; });
  await closing;
  assert.equal(settled, false);
  finishClose();
  assert.equal(await saving, 'saved');
  assert.equal(restoreProjectBackup(await written!.text(), 'restored').frames[0].edit?.exposure, 0.5);
});

test('cancelling the browser picker leaves the backup unsaved', async (t) => {
  installWindow(t, { showSaveFilePicker: async () => { throw new DOMException('Cancelled', 'AbortError'); } });
  assert.equal(await saveProjectBackupFile(fixture()), 'cancelled');
});
