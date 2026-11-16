import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import { BrowserPreviewProvider } from '../providers/browserPreviewProvider';
import type { PhotoFrame } from './types';

const jpeg = new Uint8Array(await readFile(new URL('../assets/images/demo_red_kite_flight_1794721996053.jpg', import.meta.url)));
// A synthetic container exercises embedded-preview extraction without a personal RAW file.
const raw = () => new Blob([new Uint8Array(64), jpeg]);
function frame(id: string, stableKey = 'synthetic-z8'): PhotoFrame {
  return {
    id, stableKey, filename: 'Z8.NEF', sequenceIndex: 1, decision: 'keep',
    burstGroupId: null, burstIndex: 1, burstCount: 1, exif: {}, isDemo: false, sourceKind: 'file',
  };
}

test('developing a RAW switches every cached virtual copy to the same full-size source', async (t) => {
  const provider = new BrowserPreviewProvider();
  t.after(() => provider.clear());
  const original = raw();
  const first = frame('original');
  const copy = { ...frame('copy'), virtualCopy: { originalFrameId: first.id, number: 1 } };
  provider.registerBlob(first.stableKey, original);
  const [beforeA, beforeB] = await Promise.all([provider.getFullPreviewUrl(first), provider.getFullPreviewUrl(copy)]);
  assert.equal(beforeA, beforeB, 'virtual copies share a single unedited source URL');
  assert.deepEqual(new Uint8Array(await (await fetch(beforeA)).arrayBuffer()), jpeg);
  provider.setDeveloped(first, new Blob(['full-size developed result'], { type: 'image/jpeg' }));
  const [afterA, afterB] = await Promise.all([provider.getFullPreviewUrl(first), provider.getFullPreviewUrl(copy)]);
  assert.notEqual(afterA, beforeA);
  assert.equal(afterA, afterB);
  assert.equal(await (await fetch(afterB)).text(), 'full-size developed result');
  assert.equal(provider.getOriginal(first.stableKey), original, 'RAW original is retained separately');
  assert.equal(copy.virtualCopy.originalFrameId, first.id);
});

test('clearing a project releases developed sources and relinking cannot reuse an obsolete render', async (t) => {
  const provider = new BrowserPreviewProvider();
  t.after(() => provider.clear());
  const photo = frame('original');
  provider.registerBlob(photo.stableKey, raw());
  provider.setDeveloped(photo, new Blob(['old development']));
  await provider.getFullPreviewUrl(photo);
  provider.registerBlob(photo.stableKey, raw());
  assert.equal(provider.isDeveloped(photo.stableKey), false);
  assert.deepEqual(new Uint8Array(await (await fetch(await provider.getFullPreviewUrl(photo))).arrayBuffer()), jpeg);
  provider.setDeveloped(photo, new Blob(['new development']));
  provider.clear();
  assert.equal(provider.isDeveloped(photo.stableKey), false);
  assert.equal(provider.getOriginal(photo.stableKey), undefined);
  assert.equal(await provider.getFullPreviewUrl(photo), '');
});

test('releasing one virtual copy keeps the source usable by another copy', async (t) => {
  const provider = new BrowserPreviewProvider();
  t.after(() => provider.clear());
  const photo = frame('original');
  provider.registerBlob(photo.stableKey, raw());
  provider.setDeveloped(photo, new Blob(['shared development']));
  const url = await provider.getFullPreviewUrl(photo);
  assert.equal(await provider.getFullPreviewUrl(frame('copy')), url);
  provider.releaseFrame(photo.id);
  assert.equal(await (await fetch(url)).text(), 'shared development');
  assert.equal(await provider.getFullPreviewUrl(frame('copy')), url);
  provider.releaseFrame('copy');
  await assert.rejects(fetch(url), 'the final release revokes the source URL');
});

function delayedRaw() {
  const blob = raw();
  const slice = blob.slice.bind(blob);
  let started!: () => void;
  let resume!: () => void;
  const waiting = new Promise<void>((resolve) => { started = resolve; });
  const released = new Promise<void>((resolve) => { resume = resolve; });
  blob.slice = (...args) => {
    const part = slice(...args);
    const bytes = part.arrayBuffer.bind(part);
    part.arrayBuffer = async () => { started(); await released; return bytes(); };
    return part;
  };
  return { blob, waiting, resume };
}

test('a late embedded-preview read cannot replace a successful RAW development', async (t) => {
  const provider = new BrowserPreviewProvider();
  t.after(() => provider.clear());
  const photo = frame('original');
  const slow = delayedRaw();
  provider.registerBlob(photo.stableKey, slow.blob);
  const pending = provider.getFullPreviewUrl(photo);
  await slow.waiting;
  provider.setDeveloped(photo, new Blob(['developed while reading']));
  slow.resume();
  const url = await pending;
  assert.equal(await (await fetch(url)).text(), 'developed while reading');
  assert.equal(await provider.getFullPreviewUrl(frame('copy')), url);
});

test('a late preview read cannot refill a cleared project cache', async () => {
  const provider = new BrowserPreviewProvider();
  const photo = frame('original');
  const slow = delayedRaw();
  provider.registerBlob(photo.stableKey, slow.blob);
  const pending = provider.getFullPreviewUrl(photo);
  await slow.waiting;
  provider.clear();
  slow.resume();
  assert.equal(await pending, '');
  assert.equal(await provider.getFullPreviewUrl(photo), '');
});
