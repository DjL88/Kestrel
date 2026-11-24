import assert from 'node:assert/strict';
import { test } from 'node:test';
import { assertSubjectActive, boundedSubjectGuide } from './subjectCancellation';

test('already cancelled work never starts waiting', async () => {
  const controller = new AbortController();
  controller.abort();
  assert.throws(() => assertSubjectActive(controller.signal), { name: 'AbortError' });
  await assert.rejects(boundedSubjectGuide(Promise.resolve('stale'), 100, controller.signal),
    { name: 'AbortError' });
});

test('cancelling while detector is pending rejects rather than falling back', async () => {
  const controller = new AbortController();
  let resolve!: (value: string) => void;
  const work = new Promise<string>(r => { resolve = r; });
  const result = boundedSubjectGuide(work, 5000, controller.signal);
  controller.abort();
  await assert.rejects(result, { name: 'AbortError' });
  resolve('late result');
  await Promise.resolve();
});

test('guide timeout yields null without blocking a late detector completion', async () => {
  let resolve!: (value: string) => void;
  const work = new Promise<string>(r => { resolve = r; });
  assert.equal(await boundedSubjectGuide(work, 5), null);
  resolve('late result');
  await Promise.resolve();
});

test('fast local detection returns its result and rejection is propagated', async () => {
  assert.equal(await boundedSubjectGuide(Promise.resolve('subject'), 100), 'subject');
  await assert.rejects(boundedSubjectGuide(Promise.reject(new Error('model unavailable')), 100),
    /model unavailable/);
});

test('invalid budgets are refused and abort immediately after listener registration is safe', () => {
  assert.throws(() => boundedSubjectGuide(Promise.resolve('x'), 0), RangeError);
  assert.throws(() => boundedSubjectGuide(Promise.resolve('x'), Number.NaN), RangeError);
});


test('already stopped or invalid requests still consume a late detector failure', async () => {
  const controller = new AbortController();
  controller.abort();
  let reject!: (reason: Error) => void;
  const late = new Promise<string>((_resolve, fail) => { reject = fail; });
  await assert.rejects(boundedSubjectGuide(late, 100, controller.signal), { name: 'AbortError' });
  reject(new Error('late model failure'));
  const invalid = Promise.reject(new Error('model rejected before invalid budget check'));
  assert.throws(() => boundedSubjectGuide(invalid, 0), RangeError);
  // Node's test runner treats an unhandled rejection as a failed test.
  await new Promise(resolve => setImmediate(resolve));
});
