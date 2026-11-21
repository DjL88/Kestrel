import assert from 'node:assert/strict';
import test from 'node:test';
import { corroborateSubject, detectorWitness, modelWitness } from './subjectCorroboration';

// Descriptions the pinned on-device model actually produced (tools/vision-lab, 21 Nov 2026).
const REAL = {
  seagull: 'A seagull is seen flying over the ocean, with its wings spread wide and its beak open.',
  goose: 'A goose standing on grass with its head down and wings spread out.',
  puffin: 'A puffin is standing on a rock with its head turned to the side, and its beak is open.',
  penguin: 'The photo depicts a penguin standing on a rocky surface, with its head and beak open wide.',
  owl: 'An owl with a white and brown plumage is perched on a branch.',
  duck: 'A duck with a red beak and a black eye is swimming in the water.',
  vague: 'An animal with a light brown and white striped body and a black beak is standing on a sandy ground.',
  astronaut: 'In the image, a woman is standing in front of an American flag, wearing an orange space suit with a helmet.',
  cup: 'The main subject of this photo is a cup of coffee on a saucer.',
};

test('the scene reading names a bird for the birds the older word list missed', () => {
  for (const key of ['seagull', 'goose', 'puffin', 'penguin', 'owl', 'duck'] as const) assert.equal(modelWitness(REAL[key]), 'bird', key);
});

test('aircraft words name an aircraft, and a reading that names two different kinds is not clear', () => {
  assert.equal(modelWitness('A helicopter is flying over a field.'), 'aircraft');
  assert.equal(modelWitness('A red and white airplane flying in the sky.'), 'aircraft');
  assert.equal(modelWitness('A bird flying next to a helicopter.'), null, 'two kinds: abstain');
  assert.equal(modelWitness('A woman with a dog on a lead.'), null);
  assert.equal(modelWitness(REAL.astronaut), 'person');
  assert.equal(modelWitness(REAL.cup), null, 'a cup is not a subject kind here');
});

test('words are whole words only, and odd input is never a witness', () => {
  assert.equal(modelWitness('A birdhouse on a wall.'), null);
  assert.equal(modelWitness('Cartridge and carpet.'), null);
  for (const odd of [undefined, null, 42, {}, '', '   ']) assert.equal(modelWitness(odd), null);
  assert.equal(modelWitness('bird '.repeat(500)), 'bird', 'long text is bounded and still read');
});

test('the detector counts only when it is reasonably sure, and maps its classes to the same kinds', () => {
  assert.equal(detectorWitness({ label: 'bird', score: 0.9 }), 'bird');
  assert.equal(detectorWitness({ label: 'airplane', score: 0.5 }), 'aircraft');
  assert.equal(detectorWitness({ label: 'cat', score: 0.8 }), 'animal');
  assert.equal(detectorWitness({ label: 'bird', score: 0.49 }), null, 'a weak box is no witness');
  assert.equal(detectorWitness({ label: 'kite', score: 0.95 }), null, 'a kite is as often a bird as a toy');
  assert.equal(detectorWitness({ label: 'bird', score: Number.NaN }), null);
  assert.equal(detectorWitness(null), null);
  assert.equal(detectorWitness(undefined), null);
});

test('agreement shows the subject; one witness alone shows nothing', () => {
  assert.deepEqual(corroborateSubject('bird', 'bird'), { state: 'agreed', subject: 'bird' });
  assert.deepEqual(corroborateSubject('bird', null), { state: 'unverified' });
  assert.deepEqual(corroborateSubject(null, 'bird'), { state: 'unverified' });
  assert.deepEqual(corroborateSubject(null, null), { state: 'unverified' });
});

test('a bird against an aircraft is a conflict whichever witness says which', () => {
  assert.deepEqual(corroborateSubject('bird', 'aircraft'), { state: 'conflict', reading: 'bird', detector: 'aircraft' });
  assert.deepEqual(corroborateSubject('aircraft', 'bird'), { state: 'conflict', reading: 'aircraft', detector: 'bird' });
  assert.equal(corroborateSubject('person', 'animal').state, 'conflict');
});
