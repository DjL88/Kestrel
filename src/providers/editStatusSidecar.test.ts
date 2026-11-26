import assert from 'node:assert/strict';
import test from 'node:test';
import { findSidecar, sidecarIndex } from './editStatusSidecar';

test('a photo finds its sidecar among the chosen files by either naming style, ignoring case', async () => {
  const lightroom = { name: 'DSC_0001.XMP', read: async () => new Blob(['lr']) };
  const darktable = { name: 'DSC_0002.NEF.xmp', read: async () => new Blob(['dt']) };
  const index = sidecarIndex([lightroom, darktable, { name: 'DSC_0003.NEF', read: async () => new Blob(['raw']) }]);
  assert.equal(index.size, 2);
  assert.equal(await (await findSidecar('DSC_0001.NEF', undefined, index))?.text(), 'lr');
  assert.equal(await (await findSidecar('DSC_0002.NEF', undefined, index))?.text(), 'dt');
  // No sidecar and no desktop path: nothing is read.
  assert.equal(await findSidecar('DSC_0003.NEF', undefined, index), null);
});
