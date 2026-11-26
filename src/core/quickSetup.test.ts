import assert from 'node:assert/strict';
import test from 'node:test';
import {
  accountCopy, extraKey, nextStep, parseSetupAnswers, previousStep, reconcileSetup, SETUP_STEPS, setupFinished,
  suggestedExtras, suggestedFlightMode, tailoredSettings,
} from './quickSetup';

test('setup follows the owner\'s order, with the quick questions straight after the language', () => {
  assert.deepEqual(SETUP_STEPS, ['language', 'about', 'pro', 'cloud', 'flight', 'extras']);
  assert.equal(nextStep('language'), 'about');
  assert.equal(nextStep('extras'), null);
  assert.equal(previousStep('language'), null);
  assert.equal(previousStep('flight'), 'cloud');
});

test('a damaged or unknown record is read safely and keeps only what it knows', () => {
  assert.equal(parseSetupAnswers(null), null);
  assert.equal(parseSetupAnswers({ status: 'maybe' }), null);
  assert.equal(parseSetupAnswers([]), null);
  const parsed = parseSetupAnswers({ status: 'done', language: 'de', genres: ['wildlife', 'knitting'], experience: 'pro', cloud: 'account', flightMode: 'solo', step: 'nowhere', updatedAt: 'not a date', photo: 'x' });
  assert.deepEqual(parsed, { status: 'done', language: 'de', genres: ['wildlife'], experience: 'pro', cloud: 'account', flightMode: 'solo' });
  assert.equal(parseSetupAnswers({ status: 'done', language: 'xx' })?.language, undefined);
});

test('finished means done or skipped, so setup is never offered again by itself', () => {
  assert.equal(setupFinished(null), false);
  assert.equal(setupFinished({ status: 'in-progress' }), false);
  assert.equal(setupFinished({ status: 'done' }), true);
  assert.equal(setupFinished({ status: 'skipped' }), true);
});

test('the suggested Flight mode and settings follow experience and what they shoot', () => {
  assert.equal(suggestedFlightMode({}), 'copilot');
  assert.equal(suggestedFlightMode({ experience: 'new', genres: ['weddings'] }), 'copilot');
  assert.equal(suggestedFlightMode({ experience: 'some', genres: ['weddings'] }), 'autopilot');
  assert.equal(suggestedFlightMode({ experience: 'pro', genres: ['sport'] }), 'solo');
  assert.deepEqual(tailoredSettings({ experience: 'new' }), { advancedControls: false, calmHints: false });
  assert.deepEqual(tailoredSettings({ experience: 'pro' }), { advancedControls: true });
  assert.deepEqual(tailoredSettings({}), {});
});

test('AI extras are ticked by genre, and nothing is ticked without an answer', () => {
  assert.deepEqual(suggestedExtras(undefined), []);
  assert.ok(suggestedExtras(['wildlife']).includes('speciesCheck'));
  assert.ok(suggestedExtras(['weddings']).includes('fineEdges'));
  assert.ok(!suggestedExtras(['landscape']).includes('speciesCheck'));
  assert.equal(extraKey('species'), 'speciesCheck');
  assert.equal(extraKey('mask'), 'fineEdges');
  assert.equal(extraKey('tapSelect'), 'tapSelect');
});

test('the account copy wins when only it is finished, and the newer of two finished copies wins', () => {
  const old = { status: 'done' as const, updatedAt: '2026-11-01T00:00:00Z' };
  const recent = { status: 'done' as const, updatedAt: '2026-11-20T00:00:00Z' };
  assert.equal(reconcileSetup(null, recent), 'account');
  assert.equal(reconcileSetup({ status: 'in-progress' }, recent), 'account');
  assert.equal(reconcileSetup(recent, null), 'device');
  assert.equal(reconcileSetup(null, null), 'same');
  assert.equal(reconcileSetup(old, recent), 'account');
  assert.equal(reconcileSetup(recent, old), 'device');
  assert.equal(reconcileSetup(recent, recent), 'same');
});

test('the account copy never carries where the person got to', () => {
  assert.deepEqual(accountCopy({ status: 'done', step: 'pro', flightMode: 'solo' }), { status: 'done', flightMode: 'solo' });
});
