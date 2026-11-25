import assert from 'node:assert/strict';
import test from 'node:test';
import { anchorFlexStyle, freeTransform, layoutOverlays, STACK_GAP_PX } from './overlayLayout.ts';

const frame = { width: 1000, height: 600 };
const base = { textPlacement: 'anchor', watermarkPlacement: 'anchor', textPosition: 'bottom-left', watermarkPosition: 'bottom-right', textX: 8, textY: 90, watermarkX: 92, watermarkY: 90, edgeMargin: 4 } as const;

test('an anchored box sits exactly one margin in from each edge it is anchored to', () => {
  const { text, mark } = layoutOverlays(frame, base, { text: { width: 300, height: 80 }, mark: { width: 200, height: 50 } }, 1);
  assert.deepEqual(text, { x: 40, y: 600 - 40 - 80, width: 300, height: 80 }, 'bottom of the text is one margin above the bottom');
  assert.deepEqual(mark, { x: 1000 - 40 - 200, y: 600 - 40 - 50, width: 200, height: 50 }, 'right edge of the mark is one margin from the right');
  const top = layoutOverlays(frame, { ...base, textPosition: 'top-center' }, { text: { width: 300, height: 80 } }, 1).text!;
  assert.equal(top.y, 40, 'a top box never goes above the top');
  assert.equal(top.x, 350);
});

test('the margin is the same distance on every side (a share of the width)', () => {
  const box = { width: 100, height: 40 };
  const left = layoutOverlays(frame, { ...base, textPosition: 'top-left' }, { text: box }, 1).text!;
  assert.equal(left.x, left.y);
  const none = layoutOverlays(frame, { ...base, edgeMargin: 0, textPosition: 'bottom-right' }, { text: box }, 1).text!;
  assert.deepEqual([none.x + none.width, none.y + none.height], [1000, 600]);
});

test('text and watermark at the same place stack instead of overlapping, lined up on that side', () => {
  const both = { ...base, textPosition: 'bottom-right', watermarkPosition: 'bottom-right' } as const;
  const { text, mark } = layoutOverlays(frame, both, { text: { width: 300, height: 80 }, mark: { width: 200, height: 50 } }, 2);
  assert.equal(text!.y + text!.height, 600 - 40, 'the text is at the bottom');
  assert.equal(mark!.y + mark!.height + STACK_GAP_PX * 2, text!.y, 'the watermark is just above it');
  assert.equal(text!.x + text!.width, 960);
  assert.equal(mark!.x + mark!.width, 960, 'right edges line up');
});

test('a dragged box keeps its centre but never crosses the edge margin', () => {
  const free = { ...base, textPlacement: 'free', textX: 50, textY: 50 } as const;
  assert.deepEqual(layoutOverlays(frame, free, { text: { width: 200, height: 100 } }, 1).text, { x: 400, y: 250, width: 200, height: 100 });
  const edge = layoutOverlays(frame, { ...free, textX: 4, textY: 96 }, { text: { width: 200, height: 100 } }, 1).text!;
  assert.deepEqual([edge.x, edge.y + edge.height], [40, 560]);
});

test('the canvas holds a dragged box inside the same margin with CSS clamp', () => {
  assert.equal(freeTransform(50, 90, 4), 'translate(clamp(calc(-46cqw), -50%, calc(46cqw - 100%)), clamp(calc(4cqw - 90cqh), -50%, calc(100cqh - 4cqw - 90cqh - 100%)))');
});

test('the canvas lines an anchored stack up with flexbox at the same place', () => {
  assert.deepEqual(anchorFlexStyle('bottom-left', '4cqw'), { padding: '4cqw', justifyContent: 'flex-end', alignItems: 'flex-start' });
  assert.deepEqual(anchorFlexStyle('top-center', '0cqw'), { padding: '0cqw', justifyContent: 'flex-start', alignItems: 'center' });
});
