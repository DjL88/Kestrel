import assert from 'node:assert/strict';
import test from 'node:test';
import type { OnImageAdvice } from '../../core/onImageAdvice.ts';
import { getAdvice, setAdvice, subscribeAdvice } from './adviceStore.ts';

const sample: OnImageAdvice = { clipping: null, colour: { verdict: 'unknown', reason: 'noSubject' } };

test('advice is kept per photo, announced once per change, and cleared when the edit changes', () => {
  let calls = 0;
  const stop = subscribeAdvice(() => { calls += 1; });
  assert.equal(getAdvice('a'), null);
  setAdvice('a', sample);
  assert.equal(getAdvice('a'), sample);
  assert.equal(getAdvice('b'), null);
  setAdvice('a', null);
  assert.equal(getAdvice('a'), null);
  setAdvice('a', null); // already clear: no announcement
  assert.equal(calls, 2);
  stop();
  setAdvice('a', sample);
  assert.equal(calls, 2);
  setAdvice('a', null);
  assert.equal(getAdvice(undefined), null);
});
