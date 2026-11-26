import test from 'node:test';
import assert from 'node:assert/strict';
import { HDR_PREVIEW_KEY, hdrDoneNotice, hdrFilename, hdrPreviewOn, hdrRefusalText, hdrSelection, stopsLabel } from './hdrMergeOps';
import type { PhotoFrame } from '../../core/types';

const frame = (id: string, filename: string, sequenceIndex: number, extra: Partial<PhotoFrame> = {}) =>
  ({ id, stableKey: id, filename, sequenceIndex, decision: 'undecided', ...extra }) as PhotoFrame;

test('the preview switch is off unless this device turned it on', () => {
  assert.equal(hdrPreviewOn(null), false);
  assert.equal(hdrPreviewOn({ getItem: () => null }), false);
  assert.equal(hdrPreviewOn({ getItem: (k) => (k === HDR_PREVIEW_KEY ? '1' : null) }), true);
  assert.equal(hdrPreviewOn({ getItem: () => { throw new Error('blocked'); } }), false);
});

test('the chosen photos come back in shooting order; removed, demo and unreadable ones are refused or left out', () => {
  const frames = [frame('c', 'c.jpg', 3), frame('a', 'a.jpg', 1), frame('b', 'b.NEF', 2), frame('d', 'd.jpg', 4, { removedAt: 1 } as Partial<PhotoFrame>)];
  const picked = hdrSelection(frames, ['c', 'a', 'b', 'd']);
  assert.ok(picked.ok);
  assert.deepEqual(picked.ok && picked.frames.map((f) => f.id), ['a', 'b', 'c']);
  assert.equal(hdrSelection(frames, ['a']).ok, false);
  const heif = hdrSelection([frame('a', 'a.jpg', 1), frame('h', 'h.heic', 2)], ['a', 'h']);
  assert.equal(heif.ok, false);
  assert.match(!heif.ok ? heif.message : '', /h\.heic/);
});

test('the new file never takes a source name or an existing name', () => {
  assert.equal(hdrFilename('dawn_0031.jpg', 3), 'dawn_0031-hdr3.png');
  assert.equal(hdrFilename('dawn_0031.jpg', 3, new Set(['dawn_0031-hdr3.png'])), 'dawn_0031-hdr3-2.png');
});

test('refusals and notices are plain words, each warning said once', () => {
  assert.match(hdrRefusalText({ ok: false, reason: 'same-exposure' }), /same exposure/);
  assert.match(hdrRefusalText({ ok: false, reason: 'unrelated', frameNumber: 2 }), /Photo 2/);
  const notice = hdrDoneNotice('x-hdr3.png', { warnings: [{ code: 'ghosts-removed', frameIndex: 0 }, { code: 'ghosts-removed', frameIndex: 2 }] }, 3);
  assert.equal(notice.split('Something moved').length, 2);
  assert.match(notice, /untouched/);
  assert.equal(stopsLabel(-2.04), '−2');
  assert.equal(stopsLabel(1.26), '+1.3');
  assert.equal(stopsLabel(0.01), '0');
});
