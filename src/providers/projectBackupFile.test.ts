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
  const chunks: Uint8Array[] = [];
  const commands: string[] = [];
  let openOptions: { createNew?: boolean } | undefined;
  desktopWindow(t, async (command, args) => {
    commands.push(command);
    if (command === 'plugin:dialog|save') {
      assert.equal((args as { options: { defaultPath: string } }).options.defaultPath, 'A_B_ edited project.kestrel.json');
      return path;
    }
    if (command === 'plugin:fs|open') {
      // Desktop saves must never replace an existing file.
      openOptions = (args as { options: { createNew?: boolean } }).options;
      assert.equal((args as { path: string }).path, path);
      return 7;
    }
    if (command === 'plugin:fs|write') {
      const data = (args as { data: Uint8Array }).data;
      chunks.push(new Uint8Array(data));
      writeStarted();
      await pendingWrite;
      return data.byteLength;
    }
    if (command === 'plugin:fs|close' || command === 'plugin:resources|close') return;
    assert.equal(command, 'plugin:opener|reveal_item_in_dir');
  });
  let settled = false;
  const saving = saveProjectBackupFile(state).then((result) => { settled = true; return result; });
  await started;
  assert.equal(settled, false, 'must not report success while the filesystem write is pending');
  completeWrite();
  assert.equal(await saving, 'saved');
  assert.equal(openOptions?.createNew, true, 'an existing file is never overwritten');
  assert.ok(commands.lastIndexOf('plugin:resources|close') > commands.indexOf('plugin:fs|write'), 'the file is closed after writing');
  const bytes = new Uint8Array(chunks.reduce((n, c) => n + c.length, 0));
  let offset = 0;
  for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.length; }
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

for (const failingCommand of ['plugin:dialog|save', 'plugin:fs|write']) {
  test(`desktop backup propagates ${failingCommand} failure without a browser fallback`, async (t) => {
    const failure = new Error('Destination is unavailable');
    const commands: string[] = [];
    desktopWindow(t, async (command) => {
      commands.push(command);
      if (command === failingCommand) throw failure;
      if (command === 'plugin:dialog|save') return '/mounted/test-volume/project.kestrel.json';
      if (command === 'plugin:fs|open') return 7;
      assert.ok(['plugin:fs|close', 'plugin:resources|close', 'plugin:fs|remove'].includes(command), `unexpected ${command}`);
    });
    await assert.rejects(saveProjectBackupFile(fixture()), (reason) => reason === failure);
    assert.equal(commands.includes('plugin:opener|reveal_item_in_dir'), false);
    if (failingCommand === 'plugin:dialog|save') assert.deepEqual(commands, ['plugin:dialog|save']);
    else assert.ok(commands.includes('plugin:fs|remove'), 'the incomplete file is removed after a failed write');
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
