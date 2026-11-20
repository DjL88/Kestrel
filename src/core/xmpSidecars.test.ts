import assert from 'node:assert/strict';
import test from 'node:test';
import { unzipSync } from 'fflate';
import { makeXmpDownload } from './xmpSidecars';
import type { PhotoFrame } from './types';

const sample = (filename: string, patch: Record<string, unknown> = {}): PhotoFrame => ({
  id: filename, stableKey: filename, filename, isDemo: false,
  decision: 'keep', rating: 4,
  subjectNames: ['Dipper'], tags: ['Dipper', 'River', 'Osprey'], autoTags: ['Osprey'],
  exif: {},
  ...patch,
}) as unknown as PhotoFrame;

test('File-menu sidecar saves ratings, picks and confirmed tags without modifying original pixels', async () => {
  const frame = sample('bird.NEF');
  const before = JSON.stringify(frame);
  const output = makeXmpDownload([frame]);
  assert.ok(output);
  assert.equal(output.name, 'bird.xmp');
  const text = await output.blob.text();
  assert.match(text, /Dipper/);
  assert.match(text, /River/);
  assert.match(text, /Rating/);
  assert.match(text, /pick/);
  assert.doesNotMatch(text, /Osprey/, 'unconfirmed automatic tags must be omitted');
  assert.equal(JSON.stringify(frame), before, 'saving XMP must never mutate the original frame');
});

test('multiple distinct sidecars become a ZIP; demo and virtual-copy photos are skipped', async () => {
  const output = makeXmpDownload([
    sample('one.NEF'),
    sample('two.CR3', { decision: 'reject' }),
    sample('demo.NEF', { isDemo: true }),
    sample('copy.NEF', { virtualCopy: { number: 1 } }),
  ]);
  assert.ok(output);
  assert.equal(output.name, 'kestrel-xmp-sidecars.zip');
  const entries = unzipSync(new Uint8Array(await output.blob.arrayBuffer()));
  assert.deepEqual(Object.keys(entries).sort(), ['one.xmp', 'two.xmp']);
});

test('clashing output filenames cannot silently overwrite a sidecar', () => {
  assert.equal(makeXmpDownload([sample('bird.NEF'), sample('bird.JPG')]), null);
  assert.equal(makeXmpDownload([sample('CON.NEF')]), null);
  assert.equal(makeXmpDownload([sample('demo.NEF', { isDemo: true })]), null);
});
