import assert from 'node:assert/strict';
import test from 'node:test';
import type { PhotoFrame } from '../../core/types';
import { buildDngCopyFile, dngCopyOffered } from './rawDngCopy';

const nef = (patch: Partial<PhotoFrame> = {}) => ({ id: 'f', stableKey: 'k', filename: 'DSC_0001.NEF', isDemo: false, ...patch }) as PhotoFrame;

test('a DNG copy is offered only for a Nikon HE/HE* NEF, in the desktop app', () => {
  assert.equal(dngCopyOffered(nef({ rawCodec: 'nikon-he' }), true), true);
  assert.equal(dngCopyOffered(nef({ rawCodec: 'nikon-he-star' }), true), true);
  assert.equal(dngCopyOffered(nef({ rawCodec: 'nikon-he' }), false), false, 'needs the native decoder');
  assert.equal(dngCopyOffered(nef({ rawCodec: 'other' }), true), false, 'other NEFs open everywhere');
  assert.equal(dngCopyOffered(nef(), true), false, 'unknown codec: not offered on a guess');
  assert.equal(dngCopyOffered(nef({ rawCodec: 'nikon-he', filename: 'x.dng' }), true), false);
});

test('the copy is named after the original and the original is only read', async () => {
  const original = new Blob(['NEF']);
  let seen: Blob | null = null;
  const file = await buildDngCopyFile(nef({ rawCodec: 'nikon-he' }), { ensureOriginal: async () => original }, new AbortController().signal,
    async (blob) => { seen = blob; return new Blob(['DNG']); });
  assert.equal(seen, original);
  assert.equal(file.name, 'DSC_0001.dng');
  assert.equal(file.type, 'image/x-adobe-dng');
  assert.equal(await file.text(), 'DNG');
});

test('a disconnected original or an empty result saves nothing', async () => {
  const signal = new AbortController().signal;
  await assert.rejects(buildDngCopyFile(nef(), { ensureOriginal: async () => undefined }, signal, async () => new Blob(['DNG'])), /Reconnect/);
  await assert.rejects(buildDngCopyFile(nef(), { ensureOriginal: async () => new Blob(['NEF']) }, signal, async () => new Blob([])), /empty/);
});
