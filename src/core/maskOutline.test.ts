import assert from 'node:assert/strict';
import test from 'node:test';
import { createMask, type Mask } from './maskTypes.ts';
import { maskAlpha } from './masks.ts';
import { dragOutlineHandle, maskOutline, nudgeOutlineHandle } from './maskOutline.ts';

const W = 600;
const H = 400;

/** The renderer's weight at one picture pixel. */
function weightAt(mask: Mask, x: number, y: number): number {
  const nx = x / W;
  const ny = y / H;
  return maskAlpha(mask, 1, 1, { aspect: H / W, view: { x: nx - 1e-6, y: ny - 1e-6, w: 2e-6, h: 2e-6 } })[0];
}

test('the oval outline sits exactly on the renderer edge, rotated and in photo-width units', () => {
  for (const angle of [0, 30, -75]) {
    const mask = { ...createMask('radial', 'o'), cx: 0.4, cy: 0.55, rx: 0.2, ry: 0.1, angle, feather: 0.5 } as Mask & { kind: 'radial' };
    const outline = maskOutline({ kind: 'radial', cx: mask.cx, cy: mask.cy, rx: mask.rx, ry: mask.ry, angle }, mask.feather, W, H)!;
    assert.equal(outline.kind, 'radial');
    if (outline.kind !== 'radial') return;
    // Radii are measured against the width for both axes, like the renderer.
    assert.equal(outline.rx, 0.2 * W);
    assert.equal(outline.ry, 0.1 * W);
    const centre = outline.handles.find(h => h.id === 'centre')!;
    assert.deepEqual([centre.x, centre.y], [0.4 * W, 0.55 * H]);
    for (const id of ['width', 'height'] as const) {
      const edge: { x: number; y: number } = outline.handles.find(h => h.id === id)!;
      const inside = { x: centre.x + (edge.x - centre.x) * 0.98, y: centre.y + (edge.y - centre.y) * 0.98 };
      const outside: { x: number; y: number } = { x: centre.x + (edge.x - centre.x) * 1.02, y: centre.y + (edge.y - centre.y) * 1.02 };
      assert.ok(weightAt(mask, inside.x, inside.y) > 0, `${id} handle at ${angle}°: just inside has weight`);
      assert.equal(weightAt(mask, outside.x, outside.y), 0, `${id} handle at ${angle}°: just outside has none`);
      const innerScale = outline.innerRx / outline.rx * 0.98;
      assert.ok(weightAt(mask, centre.x + (edge.x - centre.x) * innerScale, centre.y + (edge.y - centre.y) * innerScale) > 0.999);
    }
  }
});

test('the gradient lines mark full, half and no effect exactly where the renderer does', () => {
  for (const feather of [0, 0.4, 1]) {
    const mask = { ...createMask('linear', 'g'), x1: 0.2, y1: 0.1, x2: 0.7, y2: 0.8, feather } as Mask & { kind: 'linear' };
    const outline = maskOutline({ kind: 'linear', x1: mask.x1, y1: mask.y1, x2: mask.x2, y2: mask.y2 }, feather, W, H)!;
    assert.equal(outline.kind, 'linear');
    if (outline.kind !== 'linear') return;
    assert.deepEqual(outline.lines.map(l => l.role), ['full', 'half', 'none']);
    const mid = (line: { x1: number; y1: number; x2: number; y2: number }) => ({ x: (line.x1 + line.x2) / 2, y: (line.y1 + line.y2) / 2 });
    const [full, half, none] = outline.lines.map(mid);
    assert.ok(Math.abs(weightAt(mask, half.x, half.y) - 0.5) < 0.01);
    assert.ok(weightAt(mask, full.x, full.y) > 0.99);
    assert.ok(weightAt(mask, none.x, none.y) < 0.01);
    // Every point of a line has the same weight: the lines run across the gradient direction.
    const half2 = outline.lines[1];
    const along = { x: half2.x1 + (half2.x2 - half2.x1) * 0.45, y: half2.y1 + (half2.y2 - half2.y1) * 0.45 };
    assert.ok(Math.abs(weightAt(mask, along.x, along.y) - 0.5) < 0.01);
  }
  assert.equal(maskOutline({ kind: 'linear', x1: 0.5, y1: 0.5, x2: 0.5, y2: 0.5 }, 0.5, W, H), null);
  assert.equal(maskOutline({ kind: 'radial', cx: 0.5, cy: 0.5, rx: 0.2, ry: 0.1, angle: 0 }, 0.5, 0, H), null);
  assert.equal(maskOutline({ kind: 'radial', cx: Number.NaN, cy: 0.5, rx: 0.2, ry: 0.1, angle: 0 }, 0.5, W, H), null);
});

test('dragging handles produces the bounded shape the renderer will use', () => {
  const oval = { kind: 'radial' as const, cx: 0.5, cy: 0.5, rx: 0.25, ry: 0.18, angle: 0 };
  assert.deepEqual(dragOutlineHandle(oval, 'centre', { x: 450, y: 100 }, W, H), { cx: 0.75, cy: 0.25 });
  assert.deepEqual(dragOutlineHandle(oval, 'centre', { x: -50, y: 900 }, W, H), { cx: 0, cy: 1 });
  // Width handle straight down: width becomes the distance in photo widths and the oval turns 90° clockwise.
  assert.deepEqual(dragOutlineHandle(oval, 'width', { x: 300, y: 320 }, W, H), { rx: 0.2, angle: 90 });
  // Height handle: only the across-axis part counts, so a sideways wobble does not change it.
  assert.deepEqual(dragOutlineHandle(oval, 'height', { x: 350, y: 140 }, W, H), { ry: 0.1 });
  assert.deepEqual(dragOutlineHandle(oval, 'height', { x: 300, y: 200 }, W, H), { ry: 0.01 });
  // The dragged result round-trips: the new handle sits where the pointer was.
  const turned = { ...oval, ...dragOutlineHandle(oval, 'width', { x: 400, y: 300 }, W, H) } as typeof oval;
  const handle = maskOutline(turned, 0, W, H)!.handles.find(h => h.id === 'width')!;
  assert.ok(Math.abs(handle.x - 400) < 1 && Math.abs(handle.y - 300) < 1);

  const gradient = { kind: 'linear' as const, x1: 0.5, y1: 0.12, x2: 0.5, y2: 0.55 };
  assert.deepEqual(dragOutlineHandle(gradient, 'end', { x: 300, y: 320 }, W, H), { x2: 0.5, y2: 0.8 });
  assert.deepEqual(dragOutlineHandle(gradient, 'start', { x: 60, y: 0 }, W, H), { x1: 0.1, y1: 0 });
  // Dropping one end on the other would collapse the gradient (G04, #1396): no change.
  assert.deepEqual(dragOutlineHandle(gradient, 'start', { x: 300, y: 220 }, W, H), {});
  assert.deepEqual(dragOutlineHandle(gradient, 'centre', { x: 1, y: 1 }, W, H), {});
  assert.deepEqual(dragOutlineHandle(oval, 'centre', { x: Number.NaN, y: 1 }, W, H), {});
});

test('arrow-key nudges move a handle by 1% (5% with Shift) of the picture', () => {
  const oval = { kind: 'radial' as const, cx: 0.5, cy: 0.5, rx: 0.25, ry: 0.18, angle: 0 };
  assert.deepEqual(nudgeOutlineHandle(oval, 'centre', { x: -1, y: 0 }, false, W, H), { cx: 0.49, cy: 0.5 });
  assert.deepEqual(nudgeOutlineHandle(oval, 'centre', { x: 0, y: 1 }, true, W, H), { cx: 0.5, cy: 0.55 });
  const gradient = { kind: 'linear' as const, x1: 0.5, y1: 0.12, x2: 0.5, y2: 0.55 };
  assert.deepEqual(nudgeOutlineHandle(gradient, 'end', { x: 0, y: 1 }, false, W, H), { x2: 0.5, y2: 0.56 });
});
