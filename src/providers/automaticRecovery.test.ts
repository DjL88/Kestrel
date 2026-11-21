import assert from 'node:assert/strict';
import test from 'node:test';
import { sharedOriginalFolder } from './automaticRecovery';

test('uses the parent folder only for a homogeneous set of linked originals', () => {
  assert.equal(sharedOriginalFolder(['C:\\Photos\\DSC_1.NEF', 'C:\\Photos\\DSC_2.NEF']), 'C:\\Photos');
  assert.equal(sharedOriginalFolder(['/photos/day/one.nef', '/photos/day/two.nef']), '/photos/day');
  assert.equal(sharedOriginalFolder(['/photos/a.nef', '/other/b.nef']), null);
  assert.equal(sharedOriginalFolder(['/photos/a.nef', undefined]), null);
  assert.equal(sharedOriginalFolder([]), null);
});
