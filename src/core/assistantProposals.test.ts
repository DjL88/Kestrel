import assert from 'node:assert/strict';
import test from 'node:test';
import { backupFolder } from './autoBackup';
import { isProposalFile, matchProposal, parseProposal, projectIdentity, proposalFileName, proposalFolder, withProposalMarks } from './assistantProposals';
import type { PhotoFrame } from './types';

const frame = (id: string, extra: Partial<PhotoFrame> = {}) => ({ id, stableKey: `key-${id}`, filename: `${id}.jpg`, decision: 'unreviewed', tags: ['Bird'], ...extra }) as PhotoFrame;
const file = (items: unknown[]) => JSON.stringify({ format: 'kestrel-proposal', version: 1, source: 'assistant', createdAt: '2026-11-26T10:00:00.000Z', items });

test('proposals sit beside the same project folder the backups use', () => {
  const identity = projectIdentity('p1');
  assert.equal(backupFolder('p1'), `InFlight/v1/project-backups/${identity}`);
  const folder = proposalFolder(identity);
  assert.equal(folder, `InFlight/v1/proposals/${identity}`);
  assert.ok(isProposalFile(folder, `${folder}/${proposalFileName(new Date('2026-11-26T10:00:00Z'))}`));
  assert.equal(isProposalFile(folder, `${folder}/../x.json`), false);
  assert.throws(() => proposalFolder('../escape'));
});

test('a proposal is read only when every suggestion is well formed', () => {
  const good = parseProposal('a.json', file([{ photo: 'key-a', decision: 'keep', rating: 4, addTags: ['  Red   Kite '], reason: ' Sharpest. ' }]));
  assert.deepEqual(good?.items, [{ photo: 'key-a', decision: 'keep', rating: 4, addTags: ['Red Kite'], reason: 'Sharpest.' }]);
  for (const bad of [
    'not json', JSON.stringify({ format: 'other', version: 1, createdAt: 'x', items: [] }), file([]),
    file([{ photo: 'key-a', reason: 'no change' }]), file([{ photo: 'key-a', rating: 9, reason: 'x' }]),
    file([{ photo: 'key-a', decision: 'delete', reason: 'x' }]), file([{ photo: 'key-a', decision: 'keep', reason: '' }]),
  ]) assert.equal(parseProposal('b.json', bad), null, bad);
});

test('only photos still in the project are matched, and marks add to what is there', () => {
  const frames = [frame('a'), frame('b', { removedAt: 1 })];
  const proposal = parseProposal('a.json', file([
    { photo: 'key-a', rating: 5, addTags: ['Red Kite'], reason: 'Best.' },
    { photo: 'key-b', decision: 'keep', reason: 'Removed already.' },
    { photo: 'key-z', decision: 'keep', reason: 'Unknown.' },
  ]))!;
  const matched = matchProposal(frames, proposal);
  assert.deepEqual(matched.map((item) => item.frameId), ['a']);
  const marked = withProposalMarks(frames, matched);
  assert.equal(marked[0].rating, 5);
  assert.deepEqual(marked[0].tags, ['Bird', 'Red Kite']);
  assert.equal(marked[0].decision, 'unreviewed', 'decisions go through the cull history, not here');
  assert.equal(marked[1], frames[1]);
});
