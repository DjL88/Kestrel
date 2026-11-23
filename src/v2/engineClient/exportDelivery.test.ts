import assert from 'node:assert/strict';
import test from 'node:test';
import { deliverExport, describeExport } from './exportDelivery';

const files = [new File(['a'], 'a.jpg'), new File(['b'], 'b.jpg')];
const started = new Date('2026-11-23T00:00:00Z');

test('one photo still downloads as the requested archive', async () => {
  const zip = new Blob(['zip']);
  const downloads: string[] = [];
  await deliverExport(files.slice(0, 1), 'local-zip', started, new AbortController().signal,
    async (entries) => { assert.deepEqual(entries, [files[0]]); return zip; },
    (blob, name) => { assert.equal(blob, zip); downloads.push(name); });
  assert.deepEqual(downloads, ['inflight-export-2026-11-23.zip']);
});

test('stopping while packaging prevents publication', async () => {
  const controller = new AbortController();
  await assert.rejects(deliverExport(files, 'local-zip', started, controller.signal,
    async () => { controller.abort(); return new Blob(); }, () => assert.fail('Unexpected download')),
    { name: 'AbortError' });
});

test('individual downloads keep each file and its name', async () => {
  const names: string[] = [];
  await deliverExport(files, 'local-individual', started, new AbortController().signal,
    async () => assert.fail('Unexpected archive'), (blob, name) => {
      assert.equal(blob, files[names.length]);
      names.push(name);
    });
  assert.deepEqual(names, ['a.jpg', 'b.jpg']);
});

test('reports delivered count and names missing originals, including an empty result', () => {
  assert.equal(describeExport(2, []), 'Exported 2 files.');
  assert.match(describeExport(1, ['bird.nef']), /^Exported 1 file\. Reconnect.*bird\.nef/);
  assert.match(describeExport(0, ['a', 'b', 'c', 'd']), /^No files exported\. Reconnect.*a, b, c and 1 more/);
});