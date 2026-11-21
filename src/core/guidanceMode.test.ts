import assert from 'node:assert/strict';
import test from 'node:test';
import { DEFAULT_GUIDANCE_MODE, GUIDANCE_CHOICES, mayApplyGuidance, observeGuidance, parseGuidanceMode } from './guidanceMode';

test('Glide is the safe default for absent and invalid old preferences', () => {
  assert.equal(DEFAULT_GUIDANCE_MODE, 'glide');
  assert.equal(parseGuidanceMode(undefined), 'glide');
  assert.equal(parseGuidanceMode('back-seat-driver'), 'glide');
  assert.equal(parseGuidanceMode('auto'), 'glide');
  assert.deepEqual(GUIDANCE_CHOICES.map((mode) => mode.label), ['Soar', 'Glide', 'Fly Solo']);
});
test('Fly Solo never starts an unsolicited analysis even when finishing or exporting', () => {
  assert.equal(observeGuidance('solo', 'idle'), false);
  assert.equal(observeGuidance('solo', 'finish'), false);
  assert.equal(observeGuidance('solo', 'export'), false);
  assert.equal(observeGuidance('solo', 'manual'), true);
  assert.equal(observeGuidance('glide', 'idle'), true);
});
test('only an explicitly selected Soar mode may auto-apply a reliable unrefined proposal', () => {
  assert.equal(mayApplyGuidance('soar', 'high', false), true);
  assert.equal(mayApplyGuidance('soar', 'low', false), false);
  assert.equal(mayApplyGuidance('soar', 'high', true), false);
  assert.equal(mayApplyGuidance('glide', 'high', false), false);
  assert.equal(mayApplyGuidance('solo', 'high', false), false);
});
