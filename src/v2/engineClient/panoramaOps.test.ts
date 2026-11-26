import assert from 'node:assert/strict';
import test from 'node:test';
import type { PhotoFrame } from '../../core/types.ts';
import { PANORAMA_PREVIEW_KEY, panoDoneNotice, panoFilename, panoRefusalText, panoSelection, panoramaPreviewOn } from './panoramaOps.ts';

const frame = (id: string, filename: string, sequenceIndex: number, extra: Partial<PhotoFrame> = {}) =>
  ({ id, filename, sequenceIndex, stableKey: `key-${id}`, decision: 'unreviewed', ...extra }) as unknown as PhotoFrame;

test('the preview switch is off unless this device turned it on', () => {
  assert.equal(panoramaPreviewOn(null), false);
  assert.equal(panoramaPreviewOn({ getItem: () => null }), false);
  assert.equal(panoramaPreviewOn({ getItem: (k) => (k === PANORAMA_PREVIEW_KEY ? '1' : null) }), true);
  assert.equal(panoramaPreviewOn({ getItem: () => { throw new Error('blocked'); } }), false);
});

test('a selection is stitched in shooting order and needs two to twelve readable photos', () => {
  const frames = [frame('c', 'c.jpg', 3), frame('a', 'a.jpg', 1), frame('b', 'b.png', 2), frame('x', 'x.heic', 4), frame('gone', 'g.jpg', 5, { removedAt: 1 })];
  const ok = panoSelection(frames, ['c', 'a', 'b']);
  assert.ok(ok.ok);
  if (ok.ok) assert.deepEqual(ok.frames.map((f) => f.id), ['a', 'b', 'c']);
  const one = panoSelection(frames, ['a', 'gone']);
  assert.ok(!one.ok && /at least two/.test(one.message) && /untouched/.test(one.message));
  const heif = panoSelection(frames, ['a', 'x']);
  assert.ok(!heif.ok && /x\.heic/.test(heif.message) && /No smaller picture/.test(heif.message));
  const many = panoSelection(Array.from({ length: 13 }, (_, i) => frame(`f${i}`, `f${i}.jpg`, i)), Array.from({ length: 13 }, (_, i) => `f${i}`));
  assert.ok(!many.ok && /12/.test(many.message));
});

test('the new photo never takes a source name', () => {
  assert.equal(panoFilename('coast_0012.jpg', 4), 'coast_0012-pano4.png');
  assert.equal(panoFilename('coast_0012.jpg', 4, new Set(['coast_0012-pano4.png'])), 'coast_0012-pano4-2.png');
  assert.equal(panoFilename('.jpg', 2), 'photo-pano2.png');
});

test('every refusal has calm words that say the originals are untouched', () => {
  for (const reason of ['too-few', 'too-many', 'size-mismatch', 'too-flat', 'unrelated', 'ambiguous', 'vertical', 'too-large', 'no-coverage'] as const) {
    const text = panoRefusalText({ ok: false, reason, frameNumber: 3 });
    assert.ok(/untouched/.test(text), `${reason}: ${text}`);
  }
  assert.match(panoRefusalText({ ok: false, reason: 'unrelated', frameNumber: 3 }), /Photo 3/);
  assert.match(panoRefusalText({ ok: false, reason: 'too-large' }), /not made smaller/);
});

test('the finished notice says what was added and how much the honest crop kept, with at most two warnings', () => {
  const crop = { x: 0, y: 0, width: 800, height: 200, fullWidth: 1000, fullHeight: 250 };
  const text = panoDoneNotice('coast-pano3.png', {
    crop, warnings: [{ code: 'exposure-differs', frameIndex: 0 }, { code: 'exposure-differs', frameIndex: 2 }, { code: 'seams-visible' }, { code: 'focal-estimated' }, { code: 'large-crop' }],
  }, 3);
  assert.match(text, /^Added coast-pano3\.png, stitched from 3 photos\. Your original photos are untouched\./);
  assert.match(text, /Cropped to the 64% of the stitched area .* Nothing was filled in\./);
  assert.equal(text.match(/evened out/g)?.length, 1);
  assert.match(text, /seams may show/);
  assert.doesNotMatch(text, /focal length/);
});
