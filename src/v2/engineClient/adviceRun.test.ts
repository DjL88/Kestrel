import assert from 'node:assert/strict';
import test from 'node:test';
import type { OnImageAdvice, SubjectBox } from '../../core/onImageAdvice.ts';
import { forgetNoSubject, startAdviceRun, type AdviceRunDeps } from './adviceRun.ts';

const advice = (): OnImageAdvice => ({ clipping: null, colour: { verdict: 'unknown', reason: 'noSubject' }, framingWhole: true });
const tick = () => new Promise((resolve) => setImmediate(resolve));
const BOX: SubjectBox = { x: 0.1, y: 0.1, width: 0.5, height: 0.5 };

function harness(over: Partial<AdviceRunDeps<string>> = {}) {
  const published: Array<OnImageAdvice | null> = [];
  const measured: Array<SubjectBox | null> = [];
  const timers: Array<() => void> = [];
  let gesture = false;
  const gestureEnd = new Set<() => void>();
  const deps: AdviceRunDeps<string> = {
    photoId: 'p1',
    getUrl: async () => 'blob:one',
    loadPicture: async (url) => url,
    findSubject: async () => BOX,
    measure: (_picture, subject) => { measured.push(subject); return advice(); },
    publish: (value) => { published.push(value); },
    gestureActive: () => gesture,
    onGestureEnd: (listener) => { gestureEnd.add(listener); return () => { gestureEnd.delete(listener); }; },
    setTimer: (run) => { timers.push(run); return timers.length - 1; },
    clearTimer: (handle) => { timers[handle as number] = () => undefined; },
    ...over,
  };
  return {
    deps, published, measured, timers,
    setGesture: (on: boolean) => { gesture = on; if (!on) for (const listener of [...gestureEnd]) listener(); },
  };
}

test('the old advice is cleared at once, and nothing is measured until the pause has passed', async () => {
  forgetNoSubject();
  const h = harness();
  startAdviceRun(h.deps);
  assert.deepEqual(h.published, [null]);
  assert.equal(h.measured.length, 0);
  h.timers[0]();
  await tick();
  assert.equal(h.measured.length >= 1, true);
});

test('the clipping is published first with no subject, then again once the subject is found', async () => {
  forgetNoSubject();
  const h = harness();
  startAdviceRun(h.deps);
  h.timers[0]();
  await tick(); await tick();
  assert.deepEqual(h.measured, [null, BOX]);
  assert.equal(h.published.length, 3, 'cleared, then two measurements');
});

test('a slider held down delays the measuring until the hand is still', async () => {
  forgetNoSubject();
  const h = harness();
  h.setGesture(true);
  startAdviceRun(h.deps);
  h.timers[0]();
  await tick();
  assert.equal(h.measured.length, 0);
  h.setGesture(false);
  await tick(); await tick();
  assert.equal(h.measured.length, 2);
});

test('an empty preview address measures nothing (the engine starts a new run when the preview arrives)', async () => {
  forgetNoSubject();
  const h = harness({ getUrl: async () => '' });
  startAdviceRun(h.deps);
  h.timers[0]();
  await tick();
  assert.equal(h.measured.length, 0);
  assert.deepEqual(h.published, [null]);
});

test('stopping the run publishes nothing more, even from a search still in flight', async () => {
  forgetNoSubject();
  let release: (box: SubjectBox | null) => void = () => undefined;
  const h = harness({ findSubject: () => new Promise((resolve) => { release = resolve; }) });
  const stop = startAdviceRun(h.deps);
  h.timers[0]();
  await tick(); await tick();
  assert.equal(h.published.length, 2, 'cleared, then the clipping');
  stop();
  release(BOX);
  await tick();
  assert.equal(h.published.length, 2);
});

test('a search that finds nothing or fails is not repeated for the same picture this session, and the clipping still shows', async () => {
  forgetNoSubject();
  const first = harness({ findSubject: async () => { throw new Error('model unavailable'); } });
  startAdviceRun(first.deps);
  first.timers[0]();
  await tick(); await tick();
  assert.equal(first.published.length, 2, 'cleared, then the clipping without a colour judgement');
  let again = 0;
  const second = harness({ findSubject: async () => { again += 1; return null; } });
  startAdviceRun(second.deps);
  second.timers[0]();
  await tick(); await tick();
  assert.equal(again, 0);
  assert.equal(second.published.length, 2);
});
