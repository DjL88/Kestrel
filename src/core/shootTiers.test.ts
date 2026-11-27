import assert from 'node:assert/strict';
import test from 'node:test';
import { shootTiers } from './shootTiers';

const shot = (id: string, cullScore?: number, removedAt?: number) => ({ id, cullScore, removedAt });

test('Auto pick scores become ranks within the shoot: about a tenth best, a quarter better, the rest good', () => {
  const frames = Array.from({ length: 20 }, (_, i) => shot(`p${i}`, 100 - i * 3));
  const tiers = shootTiers(frames);
  assert.deepEqual([...tiers.values()].filter((t) => t === 'best').length, 2);
  assert.deepEqual([...tiers.values()].filter((t) => t === 'better').length, 5);
  assert.equal(tiers.get('p0'), 'best');
  assert.equal(tiers.get('p19'), 'good');
});

test('eight photos, as in the owner\'s test project: one best, two better, five good', () => {
  const tiers = shootTiers([88, 91, 40, 75, 60, 52, 70, 33].map((s, i) => shot(`p${i}`, s)));
  assert.equal(tiers.get('p1'), 'best');
  assert.deepEqual(['p0', 'p3'].map((id) => tiers.get(id)), ['better', 'better']);
  assert.equal([...tiers.values()].filter((t) => t === 'good').length, 5);
});

test('nothing is guessed: unscored and removed photos stay unranked, and so does a shoot with under three scores', () => {
  const tiers = shootTiers([shot('a', 80), shot('b'), shot('c', 60), shot('d', 90, 123), shot('e', 50)]);
  assert.equal(tiers.has('b'), false, 'not scored by Auto pick');
  assert.equal(tiers.has('d'), false, 'removed');
  assert.equal(tiers.get('a'), 'best');
  assert.equal(shootTiers([shot('a', 80), shot('b', 60)]).size, 0);
  assert.equal(shootTiers([shot('a', Number.NaN), shot('b', 1), shot('c', 2)]).size, 0);
});

test('a tie is never split across ranks', () => {
  const tiers = shootTiers([shot('a', 90), shot('b', 90), shot('c', 50), shot('d', 40), shot('e', 30), shot('f', 20), shot('g', 10), shot('h', 5), shot('i', 4), shot('j', 3)]);
  assert.equal(tiers.get('a'), 'best');
  assert.equal(tiers.get('b'), 'best');
});
