import assert from 'node:assert/strict';
import test from 'node:test';
import { cloudEditsAllowance, cloudEditsPhotos, parseCloudEditsChoice } from './cloudEditsChoice';

const frames = Array.from({ length: 60 }, (_, i) => ({ id: `p${i}`, cullScore: i }));

test('Nothing is the default, and anything unknown is Nothing', () => {
  assert.equal(parseCloudEditsChoice(undefined), 'none');
  assert.equal(parseCloudEditsChoice('everything'), 'none');
  assert.equal(parseCloudEditsChoice('top50'), 'top50');
  assert.deepEqual(cloudEditsPhotos('none', frames), []);
});

test('Best and Top 50 follow Auto pick\'s ranking, best first; All is every photo still in the project', () => {
  const top = cloudEditsPhotos('top50', frames);
  assert.equal(top.length, 50);
  assert.equal(top[0], 'p59');
  assert.equal(top[49], 'p10');
  const best = cloudEditsPhotos('best', frames);
  assert.deepEqual(best, ['p59', 'p58', 'p57', 'p56', 'p55', 'p54'], 'the top tenth, as the Info panel ranks them');
  assert.equal(cloudEditsPhotos('all', [...frames, { id: 'gone', cullScore: 99, removedAt: 1 }]).length, 60);
});

test('a photo Auto pick has not scored is never guessed into Best or Top 50, and a removed one is never sent', () => {
  const mixed = [{ id: 'a', cullScore: 5 }, { id: 'b' }, { id: 'c', cullScore: 9, removedAt: 3 }, { id: 'd', cullScore: 7 }, { id: 'e', cullScore: 1 }];
  assert.deepEqual(cloudEditsPhotos('top50', mixed), ['d', 'a', 'e']);
  assert.deepEqual(cloudEditsPhotos('best', mixed), ['d']);
  assert.deepEqual(cloudEditsPhotos('best', [{ id: 'a', cullScore: 5 }, { id: 'b' }]), [], 'too few scored photos to rank');
  assert.deepEqual(cloudEditsPhotos('all', mixed), ['a', 'b', 'd', 'e']);
});

test('the allowance line uses the account\'s own numbers, and says nothing it does not know', () => {
  assert.deepEqual(cloudEditsAllowance(50, { used: 100, monthly: 5000 }), { count: 50, monthly: 5000, left: 4900, over: 0 });
  assert.deepEqual(cloudEditsAllowance(50, { used: 4980, monthly: 5000 }), { count: 50, monthly: 5000, left: 20, over: 30 });
  assert.deepEqual(cloudEditsAllowance(50, null), { count: 50, over: 0 });
});
