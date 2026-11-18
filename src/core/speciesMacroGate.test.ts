import test from 'node:test';
import assert from 'node:assert/strict';
import { permitsUnclassifiedBirdSpecies } from './speciesMacroGate';

test('positive high-confidence bird detection can open the kingfisher species stage', () => {
  assert.equal(permitsUnclassifiedBirdSpecies({ detection: { label: 'bird', score: 0.84 }, coverage: 0.025 }), true);
  assert.equal(permitsUnclassifiedBirdSpecies({ detection: { label: 'bird', score: 0.91 }, coverage: 0.004 }), true);
});

test('never names an aircraft or non-bird from a bird-only species model', () => {
  for (const label of ['aeroplane', 'helicopter', 'person', 'truck', 'dog', 'other']) {
    assert.equal(permitsUnclassifiedBirdSpecies({ detection: { label, score: 0.99 }, coverage: 0.5 }), false);
  }
  assert.equal(permitsUnclassifiedBirdSpecies(null), false);
});

test('refuses weak, tiny and malformed bird detections', () => {
  for (const [score, coverage] of [[0.4, 0.5], [0.8, 0.001], [0.99, 0.001], [NaN, 0.5], [0.9, Infinity], [Infinity, 0.5], [1.1, 0.1], [0.9, -0.1]]) {
    assert.equal(permitsUnclassifiedBirdSpecies({ detection: { label: 'bird', score }, coverage }), false);
  }
});
