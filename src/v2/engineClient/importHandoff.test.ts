import test from 'node:test';
import assert from 'node:assert/strict';
import { generateDemoShootFrames } from '../../core/cullingEngine';
import { createEmptyProject } from '../../core/projects';
import type { CullingState, PhotoFrame } from '../../core/types';
import { applyImportBatch, createImportHandoff, readPendingImport, writePendingImport, type ImportBatch } from './importHandoff.ts';

/** G07: photos that finish importing after their project was left are never dropped or handed over without a home. */

const photos = (count: number, from = 0): PhotoFrame[] => generateDemoShootFrames(from + count).slice(from)
  .map((frame, i) => ({ ...frame, isDemo: false, sourceKind: 'file', stableKey: `local-file://DSC_${from + i}.NEF::30000000::${from + i}` }));
const batch = (frames: PhotoFrame[]): ImportBatch => ({ importId: 'imp', sequenceBase: 0, frames });
const keys = (project: CullingState | null | undefined) => (project?.frames ?? []).filter((f) => !f.removedAt).map((f) => f.stableKey);

function harness() {
  let open: CullingState | null = null;
  let leaving = false;
  const stored = new Map<string, CullingState>([['p', createEmptyProject('p', 'Card')]]);
  let failSaves = 0;
  const timers: Array<() => void> = [];
  const handoff = createImportHandoff({
    isOpen: (key) => !leaving && open?.shoot.id === key,
    applyOpen: (_, batches) => { open = batches.reduce(applyImportBatch, open!); },
    load: async (key) => structuredClone(stored.get(key) ?? null),
    save: async (key, project) => { if (failSaves > 0) { failSaves -= 1; throw new Error('QuotaExceededError'); } stored.set(key, structuredClone(project)); },
    setTimer: (run) => { timers.push(run); return run; },
    clearTimer: (run) => { const at = timers.indexOf(run as () => void); if (at >= 0) timers.splice(at, 1); },
  });
  const tick = async () => { for (const run of timers.splice(0)) run(); await handoff.idle(); };
  return {
    handoff, stored, tick,
    open: (project: CullingState | null) => { open = project; },
    current: () => open,
    leave: () => { leaving = true; open = null; leaving = false; },
    failNextSaves: (n: number) => { failSaves = n; },
  };
}

test('photos go straight into the open project', () => {
  const h = harness();
  h.open(createEmptyProject('p', 'Card'));
  h.handoff.add('p', batch(photos(2)));
  assert.equal(keys(h.current()).length, 2);
  assert.equal(h.handoff.pending('p'), false);
});

test('photos that finish after the project was left are written to its saved catalogue, in order, none twice', async () => {
  const h = harness();
  h.leave();
  const all = photos(5);
  h.handoff.add('p', batch(all.slice(0, 2)));
  h.handoff.add('p', batch(all.slice(1, 4))); // a repeat must not add a photo twice
  await h.tick();
  h.handoff.add('p', batch(all.slice(4)));
  await h.tick();
  assert.deepEqual(keys(h.stored.get('p')), all.map((f) => f.stableKey));
  assert.equal(h.handoff.pending('p'), false);
});

test('a failed write keeps the photos and writes them again; a reopen meanwhile still gets them', async () => {
  const h = harness();
  h.leave();
  h.failNextSaves(1);
  h.handoff.add('p', batch(photos(3)));
  await h.tick();
  assert.equal(keys(h.stored.get('p')).length, 0, 'the refused write stored nothing');
  assert.equal(h.handoff.pending('p'), true, 'and the photos are still held');
  // Reopened before the retry: the newest state comes from the handoff, not the older catalogue copy.
  const newest = await h.handoff.beginOpen('p');
  assert.equal(keys(newest).length, 3);
  h.open(newest);
  const held = h.handoff.finishOpen('p');
  h.open(held.reduce(applyImportBatch, h.current()!));
  assert.equal(keys(h.current()).length, 3, 'all three photos are in the reopened project, none twice');
});

test('photos that finish while the project is opening are held, then handed to it once it is on screen', async () => {
  const h = harness();
  h.leave();
  const all = photos(6);
  h.handoff.add('p', batch(all.slice(0, 2)));
  await h.tick();
  const newest = await h.handoff.beginOpen('p');
  assert.equal(newest, null, 'already stored: the caller loads it');
  const loaded = structuredClone(h.stored.get('p')!);
  // Finished between loading and showing: neither written over the project being opened nor lost.
  h.handoff.add('p', batch(all.slice(2, 4)));
  await h.tick();
  assert.equal(keys(h.stored.get('p')).length, 2, 'nothing is written to a project that is opening');
  h.open(loaded);
  const late = h.handoff.finishOpen('p');
  assert.equal(late.flatMap((b) => b.frames).length, 2);
  h.open(late.reduce(applyImportBatch, h.current()!));
  // And photos after that go straight in.
  h.handoff.add('p', batch(all.slice(4)));
  assert.deepEqual(keys(h.current()), all.map((f) => f.stableKey));
});

test('a failed open writes the held photos to the catalogue instead', async () => {
  const h = harness();
  h.leave();
  await h.handoff.beginOpen('p');
  h.handoff.add('p', batch(photos(2)));
  h.handoff.abortOpen('p');
  await h.tick();
  assert.equal(keys(h.stored.get('p')).length, 2);
});

test('the end-of-import burst grouping reaches a closed project too', async () => {
  const h = harness();
  h.leave();
  const shot = photos(3).map((frame, i) => ({ ...frame, exif: { ...frame.exif, capturedAtMs: 1_700_000_000_000 + i * 200 } }));
  h.handoff.add('p', batch(shot));
  h.handoff.add('p', { importId: 'imp', sequenceBase: 0, frames: [], bursts: shot });
  await h.tick();
  const frames = h.stored.get('p')!.frames;
  assert.equal(frames.length, 3);
  assert.ok(frames.every((frame) => frame.burstCount === 3 && frame.burstGroupId), 'three frames 0.2 s apart are one burst');
});

test('an unfinished import is remembered by name until an import into the project finishes', () => {
  const data = new Map<string, string>();
  const storage = { getItem: (k: string) => data.get(k) ?? null, setItem: (k: string, v: string) => { data.set(k, v); }, removeItem: (k: string) => { data.delete(k); } };
  assert.equal(readPendingImport(storage, 'p'), null);
  writePendingImport(storage, 'p', ['DSC_0003.NEF', 'DSC_0004.NEF']);
  assert.deepEqual(readPendingImport(storage, 'p'), { count: 2, names: ['DSC_0003.NEF', 'DSC_0004.NEF'] });
  assert.equal(readPendingImport(storage, 'other'), null, 'per project');
  writePendingImport(storage, 'p', []);
  assert.equal(readPendingImport(storage, 'p'), null);
  data.set('inflight.v2.importPending.p', '{"names":[1],"count":1}');
  assert.equal(readPendingImport(storage, 'p'), null, 'a damaged record is ignored, not trusted');
  const full = { ...storage, setItem: () => { throw new Error('QuotaExceededError'); } };
  assert.doesNotThrow(() => writePendingImport(full, 'p', ['a']));
});

test('a group of photos added as one batch is one update to the open project, in capture order despite a rated-first read order', () => {
  let updates = 0;
  let open: CullingState = createEmptyProject('p', 'Card');
  const handoff = createImportHandoff({
    isOpen: () => true,
    applyOpen: (_, batches) => { updates += 1; open = batches.reduce(applyImportBatch, open); },
    load: async () => null, save: async () => undefined,
  });
  const frames = photos(6).map((frame, i) => ({ ...frame, sequenceIndex: i + 1 }));
  // Read order: 4th and 6th photos first (rated), then the rest.
  const readOrder = [3, 5, 0, 1, 2, 4].map((i) => frames[i]);
  handoff.add('p', { importId: 'imp', sequenceBase: 0, frames: readOrder.slice(0, 3) });
  handoff.add('p', { importId: 'imp', sequenceBase: 0, frames: readOrder.slice(3) });
  assert.equal(updates, 2, 'one update per group, not per photo');
  assert.deepEqual(open.frames.map((f) => f.sequenceIndex), [1, 2, 3, 4, 5, 6]);
});
