import assert from 'node:assert/strict';
import test from 'node:test';
import { recordEdit } from '../../core/editHistory';
import { DEFAULT_EDIT, type PhotoEdit } from '../../core/photoEdits';
import { createEmptyProject } from '../../core/projects';
import type { PhotoFrame } from '../../core/types';
import { v2Text } from '../../i18n/areas/v2';
import type { AutoUnavailable } from './autoUnavailable';
import type { DenoiseOutcome } from './runDenoise';
import type { AutoRun } from './runAuto';
import { createEngineScheduler } from '../../core/engineScheduler';
import { planFinish } from '../../core/finishPlan';
import { createTaskStore } from '../../core/taskStore';
import { canUndoFinish, commitFinishEdit, finishOne, LOW_ISO_NO_DENOISE, planFinishForCatalogue, submitFinishBatch, undoFinish, type FinishDeps, type FinishResult } from './runFinishBatch';

const frame = (id: string, patch: Partial<PhotoFrame> = {}): PhotoFrame => ({
  id, stableKey: `${id}.jpg`, filename: `${id}.jpg`, sequenceIndex: 1, decision: 'unreviewed', burstGroupId: null,
  burstIndex: 0, burstCount: 1, exif: {}, isDemo: false, sourceKind: 'file', ...patch,
});
const proposal: PhotoEdit = { ...DEFAULT_EDIT, exposure: 0.3 };
const improved = (): AutoRun => ({
  plan: { proposal, base: DEFAULT_EDIT }, headline: 'ready', detail: ['Exposure up.'], improved: true, before: '',
  candidates: [{ id: 'natural', edit: proposal, summary: 'Exposure up.', after: '' }], source: { stableKey: 'a.jpg', originalSha256: undefined, framing: undefined },
} as unknown as AutoRun);
const notImproved = (): AutoRun => ({ ...improved(), improved: false, headline: 'Looks good as it is.', candidates: [], plan: { proposal: DEFAULT_EDIT, base: DEFAULT_EDIT } } as unknown as AutoRun);
const noise = (patch: Partial<DenoiseOutcome> = {}): DenoiseOutcome =>
  ({ runner: 'device', strength: 0.8, luminance: 0.4, masks: [], verified: true, notes: ['Denoised on this device.'], ...patch });

interface Calls { auto: number; holds: number; denoise: number; commits: { edit: PhotoEdit; at: number; why: unknown }[] }
function deps(photo: PhotoFrame, over: Partial<FinishDeps> = {}): { deps: FinishDeps; calls: Calls } {
  const calls: Calls = { auto: 0, holds: 0, denoise: 0, commits: [] };
  return {
    calls,
    deps: {
      frame: () => photo,
      auto: async () => { calls.auto += 1; return improved(); },
      denoise: async () => { calls.denoise += 1; return null; },
      commit: async (_examined, edit, why, at) => { calls.commits.push({ edit, at, why }); return true; },
      now: () => 5000,
      ...over,
    },
  };
}
const signal = () => new AbortController().signal;

test('an Auto edit that passes is applied as one step, with what changed and why', async () => {
  const { deps: d, calls } = deps(frame('a'));
  const result = await finishOne('a', 'a.jpg', d, signal());
  assert.equal(result.state, 'applied');
  assert.equal(result.applied, 'Exposure up.');
  assert.equal(result.at, 5000);
  assert.equal(result.review, 'pending');
  assert.match(result.why, /quality checks passed/);
  assert.equal(calls.commits.length, 1);
  assert.equal(calls.commits[0].edit, proposal);
  assert.deepEqual((calls.commits[0].why as { by: string }).by, 'auto');
});

test('a clear no from the vision guardian holds the photo: nothing is applied, not even noise reduction', async () => {
  const { deps: d, calls } = deps(frame('a'), { holds: async () => true });
  const result = await finishOne('a', 'a.jpg', d, signal());
  assert.equal(result.state, 'held');
  assert.ok(result.heldReason);
  assert.equal(calls.commits.length, 0);
  assert.equal(calls.denoise, 0);
});

test('verified noise reduction is folded into the same single step as Auto', async () => {
  const { deps: d, calls } = deps(frame('a', { exif: { iso: 6400 } }), { denoise: async (photo) => {
    assert.equal(photo.edit, proposal, 'noise is judged on the photo as Auto left it');
    return noise();
  } });
  const result = await finishOne('a', 'a.jpg', d, signal());
  assert.equal(result.state, 'applied');
  assert.equal(result.denoised, true);
  assert.equal(calls.commits.length, 1, 'one commit, so one Undo');
  assert.equal(calls.commits[0].edit.denoise, 0.8);
  assert.equal(calls.commits[0].edit.exposure, 0.3);
  assert.match(result.applied ?? '', /Noise reduced/);
});

test('noise reduction is not tried at a low ISO, and the result says so', async () => {
  const { deps: d, calls } = deps(frame('a', { exif: { iso: LOW_ISO_NO_DENOISE } }));
  const result = await finishOne('a', 'a.jpg', d, signal());
  assert.equal(calls.denoise, 0);
  assert.match(result.why, /ISO 400 is low/);
});

test('no visible noise leaves the Auto edit alone and says what denoise found', async () => {
  const { deps: d } = deps(frame('a'), { denoise: async () => noise({ verified: false, strength: 0, notes: ['No visible noise.'] }) });
  const result = await finishOne('a', 'a.jpg', d, signal());
  assert.equal(result.state, 'applied');
  assert.equal(result.denoised, false);
  assert.match(result.why, /No visible noise/);
});

test('a photo Auto cannot improve and with no visible noise is unchanged, with Auto\'s own reason', async () => {
  const { deps: d, calls } = deps(frame('a'), { auto: async () => notImproved() });
  const result = await finishOne('a', 'a.jpg', d, signal());
  assert.equal(result.state, 'unchanged');
  assert.match(result.why, /Looks good as it is/);
  assert.equal(calls.commits.length, 0);
});

test('noise reduction alone can finish a photo Auto leaves alone', async () => {
  const { deps: d, calls } = deps(frame('a'), { auto: async () => notImproved(), denoise: async () => noise() });
  const result = await finishOne('a', 'a.jpg', d, signal());
  assert.equal(result.state, 'applied');
  assert.equal(calls.commits.length, 1);
});

test('a photo Auto cannot read says why, and is not guessed', async () => {
  const unavailable: AutoUnavailable = { unavailable: 'raw-not-developed', source: { stableKey: 'a.jpg', originalSha256: undefined, framing: undefined } };
  const { deps: d, calls } = deps(frame('a'), { auto: async () => unavailable });
  const result = await finishOne('a', 'a.jpg', d, signal());
  assert.equal(result.state, 'unavailable');
  assert.ok(result.why.includes('a.jpg'));
  assert.equal(calls.commits.length, 0);
});

test('a photo edited, removed or gone since the plan is left alone', async () => {
  for (const photo of [frame('a', { edit: proposal }), frame('a', { removedAt: 1 }), frame('a', { editHistory: { cursor: 0, steps: [{ kind: 'tone', before: {}, after: {}, at: 1 }] } })]) {
    const { deps: d, calls } = deps(photo);
    const result = await finishOne('a', 'a.jpg', d, signal());
    assert.equal(result.state, 'skipped');
    assert.equal(calls.auto, 0);
  }
  const { deps: gone } = deps(frame('a'), { frame: () => undefined });
  assert.equal((await finishOne('a', 'a.jpg', gone, signal())).state, 'skipped');
});

test('a save the catalogue refuses is reported, never claimed as applied', async () => {
  const { deps: d } = deps(frame('a'), { commit: async () => false });
  const result = await finishOne('a', 'a.jpg', d, signal());
  assert.equal(result.state, 'skipped');
  assert.equal(result.why, v2Text.finishBest.notSaved);
});

test('a failure on one photo is recorded for the review and does not stop the batch', async () => {
  const { deps: d } = deps(frame('a'), { auto: async () => { throw new Error('decode'); } });
  const result = await finishOne('a', 'a.jpg', d, signal());
  assert.equal(result.state, 'failed');
  assert.equal(result.why, v2Text.finishBest.failed);
});

test('a denoise error does not lose the Auto edit, and is said', async () => {
  const { deps: d, calls } = deps(frame('a'), { denoise: async () => { throw new Error('worker lost'); } });
  const result = await finishOne('a', 'a.jpg', d, signal());
  assert.equal(result.state, 'applied');
  assert.match(result.why, /worker lost/);
  assert.equal(calls.commits.length, 1);
});

test('Cancel stops the batch at once instead of being recorded as a failed photo', async () => {
  const abort = new AbortController();
  const { deps: d, calls } = deps(frame('a'), { auto: async () => { abort.abort(); return improved(); } });
  await assert.rejects(finishOne('a', 'a.jpg', d, abort.signal));
  assert.equal(calls.commits.length, 0, 'nothing is applied after Cancel');
});

const project = (...frames: PhotoFrame[]) => ({ ...createEmptyProject('project', 'Test'), frames, selectedFrameId: frames[0]?.id });

test('the commit works for a photo that is not the one open, as one undoable step that leaves the rating alone', () => {
  const a = frame('a', { rating: 4 }), b = frame('b');
  const state = { ...project(a, b), selectedFrameId: 'b' };
  const next = commitFinishEdit(state, 'project', a, proposal, 3000, { by: 'auto', notes: ['x'] });
  assert.equal(next.frames[0].edit, proposal);
  assert.equal(next.frames[0].rating, 4);
  assert.equal(next.frames[0].editHistory?.steps.length, 1);
  assert.equal(next.frames[1], b);
});

test('the commit is refused when the photo was edited, reframed or removed meanwhile, or the project changed', () => {
  const a = frame('a');
  const edited = recordEdit(a, { edit: { ...DEFAULT_EDIT, exposure: -0.4 } }, 1500);
  for (const current of [edited, { ...a, removedAt: 0 }, { ...a, stableKey: 'other.jpg' }]) {
    const state = project(current);
    assert.equal(commitFinishEdit(state, 'project', a, proposal, 3000), state);
  }
  const state = project(a);
  assert.equal(commitFinishEdit(state, 'previous', a, proposal, 3000), state);
});

test('review Undo takes back exactly the batch\'s step, once, and only while it is still the last step', () => {
  const a = frame('a');
  const done = commitFinishEdit(project(a), 'project', a, proposal, 3000, { by: 'auto' });
  assert.equal(canUndoFinish(done.frames[0], 3000), true);
  assert.equal(canUndoFinish(done.frames[0], 2999), false);
  const undone = undoFinish(done, 'a', 3000);
  assert.equal(undone.frames[0].edit, undefined);
  assert.equal(undone.frames[0].editHistory?.cursor, 0);
  assert.equal(undone.frames[0].editHistory?.steps.length, 1, 'redo stays available');
  assert.equal(undoFinish(undone, 'a', 3000), undone, 'a second Undo changes nothing');
  const touched = { ...done, frames: [recordEdit(done.frames[0], { edit: { ...proposal, contrast: 0.2 } }, 9000)] };
  assert.equal(canUndoFinish(touched.frames[0], 3000), false);
  assert.equal(undoFinish(touched, 'a', 3000), touched, 'a later edit by the person is never undone from the review');
});

test('a held photo says it was not changed and to press Auto, never that a suggestion is waiting in Co-pilot', async () => {
  const { deps: d } = deps(frame('a'), { holds: async () => true });
  const result = await finishOne('a', 'a.jpg', d, signal());
  assert.equal(result.heldReason, v2Text.finishBest.heldReason);
  assert.match(result.why, /press Auto/);
  assert.doesNotMatch(result.why, /Co-pilot/);
  assert.doesNotMatch(v2Text.finishBest.review.heldIntro, /Co-pilot/);
});

test('a photo edited since the plan says so without blaming the person alone, since another batch can be the cause', async () => {
  const { deps: d } = deps(frame('a', { edit: proposal }));
  const result = await finishOne('a', 'a.jpg', d, signal());
  assert.equal(result.state, 'skipped');
  assert.match(result.why, /another batch/);
});

test('the catalogue plan counts a RAW and its kept JPEG as one photo, and the RAW is the one finished', () => {
  const frames = [
    frame('r1', { filename: 'IMG_1.NEF', stableKey: 'card/IMG_1.NEF', sequenceIndex: 1, rating: 5 }),
    frame('j1', { filename: 'IMG_1.JPG', stableKey: 'card/IMG_1.JPG', sequenceIndex: 2, rating: 5 }),
    frame('j2', { filename: 'IMG_2.JPG', stableKey: 'card/IMG_2.JPG', sequenceIndex: 3, rating: 4 }),
  ];
  const plan = planFinishForCatalogue(frames, { kind: 'all' });
  assert.deepEqual(plan.items.map((item) => item.id), ['r1', 'j2']);
  assert.equal(plan.summary.of, 2);
  assert.equal(planFinish(frames, { kind: 'all' }).items.length, 3, 'without the pairing the companion would be edited as its own photo');
});

function fakeScheduler() {
  const store = createTaskStore();
  return { store, scheduler: createEngineScheduler({ taskStore: store, limits: { cpu: 1, gpu: 1, io: 1 }, watchdogMs: 0 }) };
}

test('the batch runs on the scheduler one photo at a time and reports each result in plan order', async () => {
  const { scheduler, store } = fakeScheduler();
  const photos = ['a', 'b', 'c'].map((id, i) => frame(id, { sequenceIndex: i, rating: 5 - i }));
  const seen: string[] = [];
  const { deps: d } = deps(photos[0], { frame: (id) => photos.find((p) => p.id === id) });
  const ticket = await submitFinishBatch({ plan: planFinish(photos, { kind: 'all' }), deps: d, onResult: (r) => seen.push(`${r.photoId}:${r.state}`), scheduler });
  assert.equal(await ticket.finished, 'done');
  assert.deepEqual(seen, ['a:applied', 'b:applied', 'c:applied']);
  assert.equal(store.list().find((task) => task.id === ticket.taskId)?.title, v2Text.finishBest.taskTitle(3));
});

test('Cancel mid-batch stops after the photo in hand: that result is kept, the rest never start', async () => {
  const { scheduler } = fakeScheduler();
  const photos = ['a', 'b', 'c'].map((id, i) => frame(id, { sequenceIndex: i, rating: 5 - i }));
  const seen: FinishResult[] = [];
  let started = 0;
  let cancel: () => boolean = () => false;
  const { deps: d, calls } = deps(photos[0], {
    frame: (id) => photos.find((p) => p.id === id),
    auto: async () => { started += 1; if (started === 2) cancel(); return improved(); },
  });
  const ticket = await submitFinishBatch({ plan: planFinish(photos, { kind: 'all' }), deps: d, onResult: (r) => seen.push(r), scheduler });
  cancel = () => ticket.cancel();
  assert.equal(await ticket.finished, 'cancelled');
  assert.equal(started, 2, 'the third photo never starts');
  assert.deepEqual(seen.map((r) => r.photoId), ['a'], 'the photo finished before Cancel is kept; the one in hand is not recorded');
  assert.equal(calls.commits.length, 1, 'only the first photo was saved: a photo cancelled mid-way commits nothing');
});
