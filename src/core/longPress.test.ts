import assert from 'node:assert/strict';
import test from 'node:test';
import { createLongPress, type LongPressTimers } from './longPress';

function fakeTimers() {
  let next = 1;
  const pending = new Map<number, () => void>();
  const timers: LongPressTimers = {
    set: (callback) => { pending.set(next, callback); return next++; },
    clear: (handle) => { pending.delete(handle as number); },
  };
  return { timers, pending, fire: () => { for (const [id, run] of [...pending]) { pending.delete(id); run(); } } };
}
const touch = (x = 10, y = 10) => ({ x, y, pointerType: 'touch' });

test('a held touch opens once, and the click that follows is to be ignored', () => {
  const t = fakeTimers(); const seen: Array<{ x: number; y: number }> = [];
  const press = createLongPress((p) => seen.push(p), { timers: t.timers });
  press.down(touch(20, 30)); t.fire();
  assert.deepEqual(seen, [{ x: 20, y: 30 }]);
  assert.equal(press.up(), true);
  assert.equal(press.up(), false, 'only the first release reports it');
});

test('a quick tap does nothing and its click goes through', () => {
  const t = fakeTimers(); let opened = 0;
  const press = createLongPress(() => { opened++; }, { timers: t.timers });
  press.down(touch());
  assert.equal(press.up(), false);
  t.fire();
  assert.equal(opened, 0);
});

test('dragging or scrolling cancels it; a tiny wobble does not', () => {
  const t = fakeTimers(); let opened = 0;
  const press = createLongPress(() => { opened++; }, { timers: t.timers });
  press.down(touch(0, 0)); press.move({ x: 4, y: 3 }); t.fire();
  assert.equal(opened, 1);
  press.up();
  press.down(touch(0, 0)); press.move({ x: 40, y: 0 }); t.fire();
  assert.equal(opened, 1);
  assert.equal(press.up(), false);
});

test('pen counts, a mouse does not (it has right-click)', () => {
  const t = fakeTimers(); let opened = 0;
  const press = createLongPress(() => { opened++; }, { timers: t.timers });
  press.down({ x: 0, y: 0, pointerType: 'mouse' }); t.fire();
  assert.equal(opened, 0);
  press.down({ x: 0, y: 0, pointerType: 'pen' }); t.fire();
  assert.equal(opened, 1);
});

test('cancel (pointer cancelled by the browser) clears a pending press', () => {
  const t = fakeTimers(); let opened = 0;
  const press = createLongPress(() => { opened++; }, { timers: t.timers });
  press.down(touch()); press.cancel(); t.fire();
  assert.equal(opened, 0);
  assert.equal(t.pending.size, 0);
});
