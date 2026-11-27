import assert from 'node:assert/strict';
import test from 'node:test';
import { createTaskStore, type Task } from '../../core/taskStore';
import { feedTaskList } from './taskListFeed';

function fakeTimers() {
  let time = 0;
  const queue: { at: number; run: () => void; id: number }[] = [];
  let next = 1;
  return {
    timers: {
      set: (run: () => void, ms: number) => { const id = next++; queue.push({ at: time + ms, run, id }); return id; },
      clear: (id: unknown) => { const i = queue.findIndex((item) => item.id === id); if (i >= 0) queue.splice(i, 1); },
      now: () => time,
    },
    advance(ms: number) {
      time += ms;
      for (const item of [...queue].sort((a, b) => a.at - b.at)) if (item.at <= time) { queue.splice(queue.indexOf(item), 1); item.run(); }
    },
  };
}

test('a busy job’s progress reaches the workspace at most four times a second, the newest each time', () => {
  const store = createTaskStore();
  const clock = fakeTimers();
  const seen: (readonly Task[])[] = [];
  const stop = feedTaskList(store, (list) => seen.push(list), 250, clock.timers);
  const task = store.start('Preparing 40 thumbnails', { total: 40 });
  assert.equal(seen.length, 1, 'the first change after a quiet spell goes at once');
  for (let i = 1; i <= 40; i += 1) { task.progress(i); clock.advance(10); }
  // 40 reports over 400 ms: about two more deliveries, not forty.
  assert.ok(seen.length <= 3, `${seen.length} deliveries`);
  clock.advance(300);
  assert.equal(seen.at(-1)!.find((t) => t.id === task.id)!.done, 40, 'the last report is never dropped');
  task.finish();
  clock.advance(300);
  assert.equal(seen.at(-1)!.find((t) => t.id === task.id)!.state, 'done');
  stop();
  task.progress(1);
  const count = seen.length;
  clock.advance(1000);
  assert.equal(seen.length, count, 'nothing after stopping');
});
