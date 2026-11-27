import test from 'node:test';
import assert from 'node:assert/strict';
import { guessRegion } from './regionGuess';

test('a UK computer with a US display language shows UK prices', () => {
  assert.equal(guessRegion('Europe/London', ['en-US']), 'GB');
});

test('an unknown or shared time zone falls back to the language region, then to unknown', () => {
  assert.equal(guessRegion('Etc/UTC', ['en-GB']), 'GB');
  assert.equal(guessRegion(null, ['de-DE', 'en-US']), 'DE');
  assert.equal(guessRegion(undefined, ['en']), null);
  assert.equal(guessRegion('Europe/Berlin', ['en-US']), 'DE');
});
