import assert from 'node:assert/strict';
import test from 'node:test';
import { kindCandidates, scanCandidates } from './autoTags';

const photo = (id: string, extra: Record<string, unknown> = {}) => ({ id, ...extra });

test('without a species model, the kind check looks at photos with no kind yet, once, and nothing of the person\'s', () => {
  const frames = [
    photo('new'), photo('kinded', { subjectKind: 'wildlife' }), photo('looked', { kindChecked: true }),
    photo('named', { speciesChecked: true }), photo('mine', { tags: ['Puffin'] }), photo('theirs', { subjectNames: ['Atlantic puffin'] }),
    photo('gone', { removedAt: 1 }),
  ];
  assert.deepEqual(kindCandidates(frames).map((f) => f.id), ['new']);
});

test('a photo the kind check called Wildlife is still waiting for a species name when a species model arrives', () => {
  const kindOnly = photo('p', { subjectKind: 'wildlife', kindChecked: true });
  assert.deepEqual(scanCandidates([kindOnly]).map((f) => f.id), ['p'], 'speciesChecked was never set by the kind check');
});
