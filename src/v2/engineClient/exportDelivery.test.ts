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
    async (blob, name) => { assert.equal(blob, zip); downloads.push(name); return true; });
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
    async () => assert.fail('Unexpected archive'), async (blob, name) => {
      assert.equal(blob, files[names.length]);
      names.push(name);
      return true;
    });
  assert.deepEqual(names, ['a.jpg', 'b.jpg']);
});

test('reports delivered count and names missing originals, including an empty result', () => {
  assert.equal(describeExport(2, []), 'Exported 2 files.');
  assert.match(describeExport(1, ['bird.nef']), /^Exported 1 file\. Reconnect.*bird\.nef/);
  assert.match(describeExport(0, ['a', 'b', 'c', 'd']), /^No files exported\. Reconnect.*a, b, c and 1 more/);
});
test('a cancelled native dialog stops the batch after the last completed save', async () => {
  const names: string[] = [];
  const count = await deliverExport([...files, files[0]], 'local-individual', started, new AbortController().signal,
    async () => assert.fail('Unexpected archive'), async (_, name) => {
      await Promise.resolve();
      names.push(name);
      return names.length === 1;
    });
  assert.deepEqual(names, ['a.jpg', 'b.jpg']);
  assert.equal(count, 1);
});

test('a failed individual write reports the completed count and the failed file', async () => {
  await assert.rejects(deliverExport(files, 'local-individual', started, new AbortController().signal,
    async () => assert.fail('Unexpected archive'), async (_, name) => {
      if (name === 'b.jpg') throw new Error('Disk full');
      return true;
    }), /Saved 1 of 2 files.*b.jpg.*Disk full/);
});

test('cancelling the archive save delivers no files', async () => {
  assert.equal(await deliverExport(files, 'local-zip', started, new AbortController().signal,
    async () => new Blob(), async () => false), 0);
});

test('a desktop batch chooses one folder and awaits each exclusive write in order', async () => {
  let dialogs = 0;
  const written: string[] = [];
  const count = await deliverExport(files, 'local-folder', started, new AbortController().signal,
    async () => assert.fail(), async () => assert.fail(), async () => {
      dialogs++;
      return { folder: 'output', save: async (file, subfolder, signal) => {
        signal.throwIfAborted();
        assert.equal(subfolder, '');
        await Promise.resolve();
        written.push(file.name);
      } };
    });
  assert.equal(count, 2);
  assert.equal(dialogs, 1);
  assert.deepEqual(written, ['a.jpg', 'b.jpg']);
});

test('cancelling the folder picker writes nothing', async () => {
  assert.equal(await deliverExport(files, 'local-folder', started, new AbortController().signal,
    async () => assert.fail(), async () => assert.fail(), async () => null), 0);
});
