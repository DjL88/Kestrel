import assert from 'node:assert/strict';
import test from 'node:test';
import { addHealSpot, healToSpots, nextHealSource, radiusToSize, removeHealSpot, sizeToRadius, updateHealSpot } from './healOps';
import { MAX_HEAL_RADIUS, MAX_HEAL_SPOTS, MIN_HEAL_RADIUS, validHeal } from '../../core/heal';
import { describeHistory } from './historySteps';
import { recordEdit } from '../../core/editHistory';
import type { PhotoFrame } from '../../core/types';

test('the Size slider covers the whole allowed radius and reads back what it set', () => {
  assert.equal(sizeToRadius(1), MIN_HEAL_RADIUS);
  assert.equal(sizeToRadius(100), MAX_HEAL_RADIUS);
  for (const size of [1, 10, 30, 64, 100]) assert.equal(radiusToSize(sizeToRadius(size)), size);
});

test('spots are added, changed, hidden and removed as valid recipe entries', () => {
  let heal = addHealSpot(undefined, 'a', { x: 0.5, y: 0.5 }, 0.02, { sx: 0.5, sy: 0.4 });
  assert.equal(heal.length, 1);
  assert.equal(heal[0].mode, 'heal');
  heal = updateHealSpot(heal, 'a', { size: 50, feather: 20, mode: 'clone' });
  assert.equal(heal[0].r, sizeToRadius(50));
  assert.equal(heal[0].feather, 0.2);
  assert.equal(heal[0].mode, 'clone');
  // Moving the spot keeps the source at the same offset.
  heal = updateHealSpot(heal, 'a', { at: { x: 0.6, y: 0.5 } });
  assert.deepEqual([heal[0].x, heal[0].sx, heal[0].sy], [0.6, 0.6, 0.4]);
  heal = updateHealSpot(heal, 'a', { visible: false });
  assert.equal(heal[0].hidden, true);
  assert.equal(healToSpots(heal)[0].visible, false);
  heal = updateHealSpot(heal, 'a', { visible: true, size: Number.NaN });
  assert.equal(heal[0].hidden, undefined);
  assert.equal(heal[0].r, sizeToRadius(50), 'an invalid number leaves the spot as it was');
  assert.ok(validHeal(heal));
  assert.deepEqual(removeHealSpot(heal, 'a'), []);
});

test('no spot is added past the limit or twice with one id', () => {
  let heal = addHealSpot(undefined, 'a', { x: 0.5, y: 0.5 }, 0.02, { sx: 0.5, sy: 0.4 });
  heal = addHealSpot(heal, 'a', { x: 0.2, y: 0.2 }, 0.02, { sx: 0.2, sy: 0.3 });
  assert.equal(heal.length, 1);
  const full = Array.from({ length: MAX_HEAL_SPOTS }, (_, i) => ({ id: `s${i}`, x: 0.5, y: 0.5, sx: 0.5, sy: 0.4, r: 0.02, mode: 'heal' as const }));
  assert.equal(addHealSpot(full, 'new', { x: 0.1, y: 0.1 }, 0.02, { sx: 0.1, sy: 0.2 }).length, MAX_HEAL_SPOTS);
});

test('Copy from somewhere else steps through the other sources and wraps round', () => {
  const sources = [{ sx: 0.5, sy: 0.4, score: 1 }, { sx: 0.6, sy: 0.5, score: 2 }, { sx: 0.4, sy: 0.5, score: 3 }];
  assert.deepEqual(nextHealSource({ sx: 0.5, sy: 0.4 }, sources, 0.02), sources[1]);
  assert.deepEqual(nextHealSource({ sx: 0.4, sy: 0.5 }, sources, 0.02), sources[0]);
  assert.deepEqual(nextHealSource({ sx: 0.9, sy: 0.9 }, sources, 0.02), sources[0], 'a hand-placed source starts from the best');
  assert.equal(nextHealSource({ sx: 0.5, sy: 0.4 }, [sources[0]], 0.02), null);
  assert.equal(nextHealSource({ sx: 0.5, sy: 0.4 }, [], 0.02), null);
});

test('History names a healing step in words', () => {
  const frame = { id: 'f', edit: undefined } as unknown as PhotoFrame;
  const edit = { exposure: 0, warmth: 0, colour: 0, heal: addHealSpot(undefined, 'a', { x: 0.5, y: 0.5 }, 0.02, { sx: 0.5, sy: 0.4 }) };
  const healed = recordEdit(frame, { edit }, 1000);
  assert.equal(describeHistory(healed.editHistory)?.steps[0].label, 'Spot healing');
});
