/**
 * Release acceptance, first scripted pass (docs/PRODUCT-SPEC.md §7): RAW + JPEG pairs on an external drive, the drive
 * unplugged and relinked safely, and a second device restoring the project from a backup. Every file is synthetic and
 * made here; real folders on disk stand in for the removable volume, so the same relink code that the desktop app runs
 * against Tauri's file system runs here against node:fs.
 *
 * What this does NOT prove: Tauri's dialog and plugin-fs on a real Windows drive letter, real Nikon NEF decoding, 500
 * photos, or the cloud backup transport (see docs/RELEASE-TEST-WINDOWS.md for the hands-on Windows confirmation).
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, readdir, rename, rm, stat, utimes, writeFile, lstat, readFile } from 'node:fs/promises';
import { createHash, randomBytes } from 'node:crypto';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createDemoShootState, applyDecisionWithHistory } from '../../core/cullingEngine';
import { originalSourceKey } from '../../core/originalSourceKey';
import { hashOriginalBytes } from '../../core/originalFileIdentity';
import { rawJpegPairs } from '../../core/rawJpegPairs';
import { encodeProjectBackup, restoreProjectBackup } from '../../core/projectBackup';
import { verifyDesktopRelinkFiles } from '../../core/originalRelinkNode';
import { checkOriginalPaths } from '../../providers/originalPathStatus';
import type { CullingState, PhotoFrame } from '../../core/types';
import { applyDesktopRelink, framesNeedingRelink, planDesktopRelink, type RelinkFs } from './desktopRelink';

const SHOTS = 6;
const CAPTURED = Date.UTC(2026, 4, 17, 6, 30, 0);
const MTIME = new Date(CAPTURED);

/** node:fs in the shape the desktop adapter gives Tauri's plugin-fs. */
const nodeFs: RelinkFs = {
  async readDir(path) {
    const entries = await readdir(path, { withFileTypes: true });
    return entries.map((entry) => ({ name: entry.name, isFile: entry.isFile(), isDirectory: entry.isDirectory(), isSymlink: entry.isSymbolicLink() }));
  },
  async stat(path) {
    const info = await lstat(path);
    return { isFile: info.isFile(), isSymlink: info.isSymbolicLink(), size: info.size, mtime: info.mtime };
  },
  async openRange(path) {
    const bytes = await readFile(path);
    return { blob: new Blob([bytes]), close: async () => undefined };
  },
};

/** A synthetic NEF-shaped file (TIFF little-endian header + random sensor-like bytes) and a JPEG-shaped file. */
const fakeNef = () => Buffer.concat([Buffer.from([0x49, 0x49, 0x2a, 0x00]), randomBytes(40_000)]);
const fakeJpeg = () => Buffer.concat([Buffer.from([0xff, 0xd8, 0xff, 0xe1]), randomBytes(9_000), Buffer.from([0xff, 0xd9])]);

async function put(path: string, bytes: Buffer) {
  await writeFile(path, bytes);
  await utimes(path, MTIME, MTIME);
}

/** Import exactly as the desktop loader does: linked by path, keyed by path + name + size + time, fingerprinted by SHA-256. */
async function importLinked(path: string, index: number, captured: number): Promise<PhotoFrame> {
  const info = await stat(path);
  const name = path.split(/[\\/]/).at(-1)!;
  const bytes = await readFile(path);
  const base = createDemoShootState(1).frames[0];
  return {
    ...base,
    id: `file-${index}-${name}`,
    stableKey: originalSourceKey({ name, size: info.size, lastModified: info.mtime.getTime(), path }),
    filename: name,
    sequenceIndex: index,
    decision: 'unreviewed',
    burstGroupId: null, burstIndex: 1, burstCount: 1,
    exif: { ...base.exif, capturedAtMs: captured },
    isDemo: false,
    demoVariant: undefined,
    sourceKind: 'file',
    sourcePath: path,
    originalSha256: await hashOriginalBytes(new Blob([bytes])),
  };
}

interface Volume { root: string; dcim: string }

/** The camera card copied to an external drive: DCIM/100NIKON with DSC_0001.NEF + DSC_0001.JPG, and so on. */
async function makeVolume(base: string, label: string): Promise<Volume> {
  const root = join(base, label);
  const dcim = join(root, 'DCIM', '100NIKON');
  await mkdir(dcim, { recursive: true });
  for (let shot = 1; shot <= SHOTS; shot++) {
    const stem = `DSC_${String(shot).padStart(4, '0')}`;
    await put(join(dcim, `${stem}.NEF`), fakeNef());
    await put(join(dcim, `${stem}.JPG`), fakeJpeg());
  }
  return { root, dcim };
}

/** Copy a volume's files byte for byte to another location (a second device's copy of the drive, or a backup disk). */
async function copyTree(from: string, to: string) {
  await mkdir(to, { recursive: true });
  for (const entry of await readdir(from, { withFileTypes: true })) {
    if (entry.isDirectory()) await copyTree(join(from, entry.name), join(to, entry.name));
    else await put(join(to, entry.name), await readFile(join(from, entry.name)));
  }
}

async function importVolume(volume: Volume): Promise<CullingState> {
  const names = (await readdir(volume.dcim)).sort();
  const frames: PhotoFrame[] = [];
  for (const [index, name] of names.entries()) {
    const shot = Number(name.slice(4, 8));
    frames.push(await importLinked(join(volume.dcim, name), index + 1, CAPTURED + shot * 1000));
  }
  const state = createDemoShootState(1);
  return {
    ...state,
    shoot: { ...state.shoot, id: 'release-acceptance', title: 'External drive shoot', sourceKind: 'local-folder', folderName: '100NIKON', totalFrames: frames.length },
    frames, selectedFrameId: frames[0].id, compareRightFrameId: null, undoStack: [], redoStack: [],
  };
}

/** Cull and develop: keep two shots, reject one, rate one, and give one an edit recipe. Pairs are decided together. */
function cullAndEdit(state: CullingState): CullingState {
  const pairs = rawJpegPairs(state.frames);
  const id = (name: string) => state.frames.find((frame) => frame.filename === name)!.id;
  let next = state;
  for (const [name, decision] of [['DSC_0001.NEF', 'keep'], ['DSC_0002.NEF', 'keep'], ['DSC_0003.NEF', 'reject']] as const) {
    const raw = id(name);
    for (const frameId of [raw, pairs.jpegOf.get(raw)!]) next = applyDecisionWithHistory(next, frameId, decision, { allowAdvance: false });
  }
  return {
    ...next,
    frames: next.frames.map((frame) => frame.filename === 'DSC_0001.NEF'
      ? { ...frame, rating: 5, edit: { exposure: 0.4, warmth: 0.1, colour: 0, highlights: -0.3 }, framing: { ratio: 1.5, turns: 0, straighten: 1.2, x: 0.5, y: 0.5 } }
      : frame),
  };
}

/** What must survive every step: every decision, rating, recipe and framing, keyed by stableKey. */
const decisionsOf = (frames: readonly PhotoFrame[]) => frames
  .map((frame) => [frame.stableKey, frame.filename, frame.decision, frame.rating ?? null, JSON.stringify(frame.edit ?? null), JSON.stringify(frame.framing ?? null), frame.originalSha256])
  .sort((a, b) => String(a[0]).localeCompare(String(b[0])));

const connectedNone = () => false;

test('release acceptance: external-drive RAW+JPEG import, unplug, safe relink, second-device restore', async (t) => {
  const base = await mkdtemp(join(tmpdir(), 'kestrel-release-'));
  t.after(() => rm(base, { recursive: true, force: true }));

  // 1. Import RAW + JPEG pairs from the removable volume. Originals are linked, never copied.
  const drive = await makeVolume(base, 'E_drive');
  const beforeBytes = new Map<string, string>();
  for (const name of await readdir(drive.dcim)) beforeBytes.set(name, createHash('sha256').update(await readFile(join(drive.dcim, name))).digest('hex'));
  let project = await importVolume(drive);
  assert.equal(project.frames.length, SHOTS * 2, 'every RAW and every JPEG is imported');
  const pairs = rawJpegPairs(project.frames);
  assert.equal(pairs.jpegOf.size, SHOTS, 'each NEF is paired with its JPEG as one shot');
  assert.ok(project.frames.every((frame) => frame.sourcePath?.startsWith(drive.dcim) && /^[a-f0-9]{64}$/.test(frame.originalSha256 ?? '')));

  project = cullAndEdit(project);
  const decided = decisionsOf(project.frames);
  assert.equal(project.frames.filter((frame) => frame.decision === 'keep').length, 4, 'two shots kept, both files of each');
  assert.equal(project.frames.filter((frame) => frame.decision === 'reject').length, 2);

  // 2. A portable backup holds decisions and recipes only: no image bytes, no previews.
  const backup = encodeProjectBackup(project);
  const envelope = JSON.parse(backup);
  assert.equal(envelope.cache.imagesIncluded, false);
  assert.ok(backup.length < 64_000, `backup is metadata only (${backup.length} bytes for ${SHOTS * 2} originals of ~40 KB)`);
  const sample = (await readFile(join(drive.dcim, 'DSC_0001.NEF'))).subarray(4, 64);
  assert.ok(!backup.includes(sample.toString('base64').slice(0, 40)) && !backup.includes(sample.toString('hex').slice(0, 40)), 'no original bytes inside the backup');

  // 3. Unplug the drive. Every linked path reports missing; the catalogue keeps everything.
  const unplugged = join(base, 'drive-in-a-drawer');
  await rename(drive.root, unplugged);
  const status = await checkOriginalPaths(project.frames.map((frame) => frame.sourcePath!), async (path) => ({ isFile: (await stat(path)).isFile() }));
  assert.ok([...status.values()].every((value) => value === 'missing'), 'unplugged originals are reported missing, not deleted');
  assert.deepEqual(decisionsOf(project.frames), decided, 'decisions and recipes are untouched while the drive is away');
  const missing = framesNeedingRelink(project.frames, connectedNone);
  assert.equal(missing.length, SHOTS * 2);

  // 4. The person points Reconnect at the wrong card: same folder layout, same names, same sizes, same times, other bytes.
  const impostor = join(base, 'other-card');
  const otherDcim = join(impostor, 'DCIM', '100NIKON');
  await mkdir(otherDcim, { recursive: true });
  for (const frame of missing) {
    const size = (await stat(join(unplugged, 'DCIM', '100NIKON', frame.filename))).size;
    const bytes = frame.filename.endsWith('.NEF') ? Buffer.concat([Buffer.from([0x49, 0x49, 0x2a, 0x00]), randomBytes(size - 4)]) : Buffer.concat([Buffer.from([0xff, 0xd8]), randomBytes(size - 2)]);
    await put(join(otherDcim, frame.filename), bytes);
  }
  const wrong = await planDesktopRelink(missing, [], impostor, nodeFs);
  assert.equal(wrong.replacements.size, 0, 'a same-named, same-size, same-time file is never linked');
  assert.equal(wrong.notFound, SHOTS * 2);
  assert.deepEqual(applyDesktopRelink(project.frames, missing, wrong.replacements), project.frames, 'nothing in the catalogue changed');

  // 5. Plug the real drive back in under a different letter, next to an impostor and an identical duplicate.
  const replugged = join(base, 'F_drive');
  await rename(unplugged, replugged);
  await mkdir(join(replugged, 'Edited'), { recursive: true });
  // A same-named impostor elsewhere on the drive.
  await put(join(replugged, 'Edited', 'DSC_0002.NEF'), Buffer.concat([Buffer.from([0x49, 0x49, 0x2a, 0x00]), randomBytes((await stat(join(replugged, 'DCIM', '100NIKON', 'DSC_0002.NEF'))).size - 4)]));
  // A byte-identical second copy of DSC_0006.JPG: two genuine candidates, so it must be left for the person.
  await mkdir(join(replugged, 'Copy'), { recursive: true });
  await put(join(replugged, 'Copy', 'DSC_0006.JPG'), await readFile(join(replugged, 'DCIM', '100NIKON', 'DSC_0006.JPG')));
  const plan = await planDesktopRelink(missing, [], replugged, nodeFs);
  assert.equal(plan.replacements.size, SHOTS * 2 - 1, 'every genuine original reconnects except the one with two identical copies');
  assert.equal(plan.ambiguous, 1);
  // Compare with one separator: the relink planner joins with '/', which Windows accepts, while join() uses '\' there.
  const slash = (path: string) => path.replace(/\\/g, '/');
  assert.ok([...plan.replacements.values()].every((path) => slash(path).startsWith(slash(join(replugged, 'DCIM', '100NIKON')))), 'the impostor in Edited/ was never chosen');
  const relinked = applyDesktopRelink(project.frames, missing, plan.replacements);
  assert.deepEqual(decisionsOf(relinked), decided, 'relinking moves only the saved path');
  assert.equal(rawJpegPairs(relinked).jpegOf.size, SHOTS - 1, 'pairs whose two files moved together stay paired');
  // Independent proof with the streaming Node verifier: each new path holds the imported bytes.
  const proof = await verifyDesktopRelinkFiles(
    relinked.filter((frame) => plan.replacements.has(frame.stableKey)).map((frame) => ({ photoId: frame.id, byteLength: Number(frame.stableKey.split('::').at(-2)), sha256: frame.originalSha256! })),
    relinked.filter((frame) => plan.replacements.has(frame.stableKey)).map((frame) => ({ photoId: frame.id, path: frame.sourcePath! })),
  );
  assert.equal(proof.ok, true, JSON.stringify(proof));
  // The narrower folder resolves the duplicate.
  const rest = framesNeedingRelink(relinked, (key) => plan.replacements.has(key));
  const narrow = await planDesktopRelink(rest, [...plan.replacements.values()], join(replugged, 'DCIM'), nodeFs);
  assert.equal(narrow.replacements.size, 1);
  project = { ...project, frames: applyDesktopRelink(relinked, rest, narrow.replacements) };
  assert.equal(rawJpegPairs(project.frames).jpegOf.size, SHOTS);

  // 6. A second device restores the backup. Same decisions and recipes, a new project id, originals not yet connected.
  const restored = restoreProjectBackup(backup, 'project-second-device');
  assert.equal(restored.shoot.id, 'project-second-device');
  assert.equal(restored.shoot.needsFileReselect, true, 'the second device is told to reconnect originals');
  assert.deepEqual(decisionsOf(restored.frames), decided, 'every decision, rating, recipe and framing survives the restore');
  assert.equal(rawJpegPairs(restored.frames).jpegOf.size, SHOTS);
  // The second device has its own copy of the drive at another place; the first device's paths do not exist there.
  const secondDevice = join(base, 'second-device', 'Photos', 'Shoot');
  await copyTree(join(replugged, 'DCIM'), secondDevice);
  const needed = framesNeedingRelink(restored.frames, connectedNone);
  const recovered = await planDesktopRelink(needed, [], join(base, 'second-device'), nodeFs);
  assert.equal(recovered.replacements.size, SHOTS * 2, 'the second device reconnects every original by its contents');
  const onSecond = applyDesktopRelink(restored.frames, needed, recovered.replacements);
  assert.ok(onSecond.every((frame) => slash(frame.sourcePath!).startsWith(slash(secondDevice))));
  assert.deepEqual(decisionsOf(onSecond), decided);
  assert.equal(rawJpegPairs(onSecond).jpegOf.size, SHOTS);

  // 7. Originals were never written, moved inside, or replaced.
  for (const [name, digest] of beforeBytes) {
    assert.equal(createHash('sha256').update(await readFile(join(replugged, 'DCIM', '100NIKON', name))).digest('hex'), digest, `${name} is unchanged`);
  }
});

test('relink: an older photo without a fingerprint is never guessed, and a project change stops the plan', async (t) => {
  const base = await mkdtemp(join(tmpdir(), 'kestrel-relink-'));
  t.after(() => rm(base, { recursive: true, force: true }));
  const drive = await makeVolume(base, 'drive');
  const project = await importVolume(drive);
  const legacy = project.frames.map((frame, index) => index === 0 ? { ...frame, originalSha256: undefined } : frame);
  const plan = await planDesktopRelink(framesNeedingRelink(legacy, connectedNone), [], drive.root, nodeFs);
  assert.equal(plan.unverifiable, 1);
  assert.equal(plan.replacements.has(legacy[0].stableKey), false);
  assert.equal(plan.replacements.size, SHOTS * 2 - 1);

  let live = true;
  const stopped = await planDesktopRelink(framesNeedingRelink(project.frames, connectedNone), [], drive.root, {
    ...nodeFs, async openRange(path, size) { live = false; return nodeFs.openRange(path, size); },
  }, () => live);
  assert.equal(stopped.replacements.size, 0, 'nothing is applied after the person switches project');
});

test('relink: a path another connected photo already uses is never handed to a second photo', async (t) => {
  const base = await mkdtemp(join(tmpdir(), 'kestrel-relink-'));
  t.after(() => rm(base, { recursive: true, force: true }));
  const drive = await makeVolume(base, 'drive');
  const project = await importVolume(drive);
  const [first] = project.frames;
  // A duplicate catalogue record of the same original, imported from a path that has since gone.
  const twin: PhotoFrame = { ...first, id: 'twin', stableKey: originalSourceKey({ name: first.filename, size: Number(first.stableKey.split('::').at(-2)), lastModified: MTIME.getTime(), path: join(base, 'gone', first.filename) }), sourcePath: join(base, 'gone', first.filename) };
  const plan = await planDesktopRelink([twin], [first.sourcePath!], drive.root, nodeFs);
  assert.equal(plan.replacements.size, 0);
  // Edits made meanwhile win: a frame whose path changed after planning is left alone.
  const moved = applyDesktopRelink([{ ...first, sourcePath: '/elsewhere' }], [first], new Map([[first.stableKey, '/new']]));
  assert.equal(moved[0].sourcePath, '/elsewhere');
});
