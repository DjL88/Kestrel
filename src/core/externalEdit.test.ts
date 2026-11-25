import assert from 'node:assert/strict';
import test from 'node:test';
import {
  afterFailedRead, appFromPath, externalEditRecord, MAX_FAILED_READS, nextWatchStep, placeBeside, readApps, readExternalEdit,
  rememberApp, returnedExif, returnedFileName, SETTLE_MS, startWatch, stepsInEdit, WATCH_LIMIT_MS, workingFileName,
  type ExternalEditWatch, type FileStamp,
} from './externalEdit';
import type { PhotoFrame } from './types';

const T0 = 1_800_000_000_000;
const written: FileStamp = { size: 1000, modifiedMs: T0 };
const watch = (): ExternalEditWatch => startWatch({
  frameId: 'f1', sourceFilename: 'DSC_0001.NEF', app: { name: 'Photoshop', path: '/Applications/Photoshop.app' },
  tiffPath: '/data/External edits/DSC_0001 InFlight edit.tif', sentAt: T0, sentBits: 16, stepsSent: 4, stamp: written,
});

/** Feed the watcher a series of (time, stamp) checks and collect the steps. */
function run(start: ExternalEditWatch, checks: [number, FileStamp | null][]) {
  let current = start;
  return checks.map(([at, stamp]) => {
    const next = nextWatchStep(current, stamp, T0 + at);
    current = next.watch;
    return next.step.kind;
  }).concat([]).map((kind, i, all) => (i === all.length - 1 ? `${kind}:${current.returned}` : kind));
}

test('nothing happens until the other app saves', () => {
  assert.deepEqual(run(watch(), [[1500, written], [3000, written], [60_000, written]]), ['waiting', 'waiting', 'waiting:0']);
});

test('a save is brought back only after it has settled, never while it is still being written', () => {
  const growing = (size: number, at: number): FileStamp => ({ size, modifiedMs: T0 + at });
  const steps = run(watch(), [
    [1500, growing(0, 1400)], // the app truncated the file to start writing
    [3000, growing(40_000_000, 2900)],
    [4500, growing(90_000_000, 4400)],
    [6000, growing(90_000_000, 4400)], // unchanged, but not for long enough yet
    [6000 + SETTLE_MS, growing(90_000_000, 4400)],
  ]);
  assert.deepEqual(steps, ['saving', 'saving', 'saving', 'saving', 'bring-back:1']);
});

test('an empty file never counts as a finished save', () => {
  const empty: FileStamp = { size: 0, modifiedMs: T0 + 10 };
  assert.deepEqual(run(watch(), [[1000, empty], [1000 + SETTLE_MS, empty], [1000 + 3 * SETTLE_MS, empty]]), ['saving', 'saving', 'saving:0']);
});

test('every later save comes back as another version; the same save is never brought back twice', () => {
  const first: FileStamp = { size: 2000, modifiedMs: T0 + 5000 };
  const second: FileStamp = { size: 2100, modifiedMs: T0 + 90_000 };
  const steps = run(watch(), [
    [5000, first], [5000 + SETTLE_MS, first], [20_000, first], [40_000, first],
    [90_000, second], [90_000 + SETTLE_MS, second], [120_000, second],
  ]);
  assert.deepEqual(steps, ['saving', 'bring-back', 'waiting', 'waiting', 'saving', 'bring-back', 'waiting:2']);
});

test('a file that has gone, or a watch left for too long, stops', () => {
  assert.equal(nextWatchStep(watch(), null, T0 + 10).step.kind, 'gone');
  assert.equal(nextWatchStep(watch(), written, T0 + WATCH_LIMIT_MS + 1).step.kind, 'expired');
});

test('a save that cannot be read waits again, and gives up after a few tries', () => {
  const saved: FileStamp = { size: 5000, modifiedMs: T0 + 100 };
  let current = nextWatchStep(watch(), saved, T0 + 100).watch;
  const before = current;
  const settled = nextWatchStep(current, saved, T0 + 100 + SETTLE_MS);
  assert.equal(settled.step.kind, 'bring-back');
  let retry = afterFailedRead(before, saved, T0 + 100 + SETTLE_MS);
  assert.ok(retry);
  assert.equal(nextWatchStep(retry, saved, T0 + 101 + SETTLE_MS).step.kind, 'saving', 'waits a full settle period again');
  assert.equal(nextWatchStep(retry, saved, T0 + 100 + 2 * SETTLE_MS).step.kind, 'bring-back');
  current = retry;
  for (let i = 1; i < MAX_FAILED_READS - 1; i += 1) { retry = afterFailedRead(current, saved, T0); assert.ok(retry); current = retry; }
  assert.equal(afterFailedRead(current, saved, T0), null);
});

test('apps are named the way people know them, and remembered without repeats', () => {
  assert.deepEqual(appFromPath('/Applications/Affinity Photo 2.app'), { name: 'Affinity Photo 2', path: '/Applications/Affinity Photo 2.app' });
  assert.equal(appFromPath('C:\\Program Files\\Adobe\\Adobe Photoshop 2025\\Photoshop.exe')?.name, 'Photoshop');
  assert.equal(appFromPath('   '), null);
  const ps = { name: 'Photoshop', path: 'C:\\PS\\Photoshop.exe' };
  const af = { name: 'Affinity Photo 2', path: 'C:\\Affinity\\Photo.exe' };
  assert.deepEqual(rememberApp(rememberApp([ps], af), { ...ps, path: 'c:\\ps\\photoshop.exe' }).map((app) => app.name), ['Photoshop', 'Affinity Photo 2']);
  assert.equal(rememberApp(Array.from({ length: 9 }, (_, i) => ({ name: `A${i}`, path: `/a${i}` })), ps).length, 5);
  assert.deepEqual(readApps([ps, { name: '', path: '/x' }, { name: 'X' }, null, 'Photoshop']), [ps]);
  assert.deepEqual(readApps('nope'), []);
});

test('file names are readable, never clash, and never carry folder separators', () => {
  assert.equal(workingFileName('DSC_0001.NEF', new Date(2026, 10, 25, 23, 4, 9)), 'DSC_0001 InFlight edit 2026-11-25 230409');
  assert.equal(returnedFileName('DSC_0001.NEF', 'Photoshop', 1), 'DSC_0001 edited in Photoshop.png');
  assert.equal(returnedFileName('DSC_0001.NEF', 'Photoshop', 3), 'DSC_0001 edited in Photoshop (3).png');
  assert.equal(returnedFileName('a/b.jpg', 'Edit:or', 1), 'a_b edited in Edit_or.png');
});

test('the returned photo records where it came from, and a damaged record is ignored', () => {
  const brought = nextWatchStep(nextWatchStep(watch(), { size: 9, modifiedMs: 1 }, T0).watch, { size: 9, modifiedMs: 1 }, T0 + SETTLE_MS).watch;
  const record = externalEditRecord(brought, T0 + 60_000, 8);
  assert.deepEqual(record, { fromFrameId: 'f1', fromFilename: 'DSC_0001.NEF', appName: 'Photoshop', sentAt: T0, returnedAt: T0 + 60_000, round: 1, sentBits: 16, savedBits: 8, stepsSent: 4 });
  assert.deepEqual(readExternalEdit(JSON.parse(JSON.stringify(record))), record);
  assert.equal(readExternalEdit({ ...record, savedBits: 12 }), undefined);
  assert.equal(readExternalEdit({ ...record, round: 0 }), undefined);
  assert.equal(readExternalEdit({ ...record, appName: ' ' }), undefined);
  assert.equal(readExternalEdit('Photoshop'), undefined);
});

const frame = (id: string, extra: Partial<PhotoFrame> = {}) => ({ id, ...extra }) as PhotoFrame;

test('returned photos sit straight after their original and any earlier returns from it', () => {
  const record = (round: number) => ({ fromFrameId: 'b', fromFilename: 'b.nef', appName: 'PS', sentAt: 1, returnedAt: 2, round, sentBits: 16 as const, savedBits: 16 as const, stepsSent: 0 });
  const frames = [frame('a'), frame('b'), frame('b-ps1', { externalEdit: record(1) }), frame('c'), frame('new')];
  assert.deepEqual(placeBeside(frames, ['new'], 'b').map((f) => f.id), ['a', 'b', 'b-ps1', 'new', 'c']);
  assert.deepEqual(placeBeside(frames, ['new'], 'missing').map((f) => f.id), frames.map((f) => f.id));
  assert.deepEqual(placeBeside([frame('x'), frame('n')], ['n'], 'x').map((f) => f.id), ['x', 'n']);
});

test('the sent step count leaves out undone steps', () => {
  assert.equal(stepsInEdit({}), 0);
  const steps = Array.from({ length: 5 }, () => ({})) as NonNullable<PhotoFrame['editHistory']>['steps'];
  assert.equal(stepsInEdit({ editHistory: { cursor: 3, steps } }), 3);
  assert.equal(stepsInEdit({ editHistory: { cursor: 9, steps, discarded: 2 } }), 7);
});

test('capture details carry over, but not the original file\'s size or format', () => {
  const exif = { camera: 'Nikon Z 8', lens: '600mm', capturedAtMs: 5, width: 8256, height: 5504, formatLabel: 'NEF', isEmbeddedPreviewOnly: true, rating: 3 };
  assert.deepEqual(returnedExif(exif), { camera: 'Nikon Z 8', lens: '600mm', capturedAtMs: 5 });
});
