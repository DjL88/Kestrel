import { test } from 'node:test';
import assert from 'node:assert/strict';
import { findEye, panToCentre } from './eyeFinder';

const W = 240, H = 160;

/** A synthetic bird: soft grey body on a pale sky, as luma plus a subject mask. Spots are dark disks with optional catchlights. */
function bird(spots: { x: number; y: number; r: number; catchlight?: boolean; insideMask?: boolean }[] = []) {
  const luma = new Float32Array(W * H).fill(0.85);
  const subject = new Float32Array(W * H);
  for (let y = 0; y < H; y += 1) {
    for (let x = 0; x < W; x += 1) {
      const inBody = ((x - 120) / 90) ** 2 + ((y - 85) / 50) ** 2 <= 1;
      if (inBody) {
        // Gentle feather texture so the ring is not perfectly flat.
        luma[y * W + x] = 0.55 + 0.03 * Math.sin(x * 0.7) * Math.cos(y * 0.5);
        subject[y * W + x] = 1;
      }
    }
  }
  for (const spot of spots) {
    for (let y = 0; y < H; y += 1) {
      for (let x = 0; x < W; x += 1) {
        const d = Math.hypot(x - spot.x, y - spot.y);
        if (d <= spot.r) luma[y * W + x] = 0.08;
        if (spot.catchlight && Math.hypot(x - (spot.x - spot.r * 0.3), y - (spot.y - spot.r * 0.3)) <= Math.max(1, spot.r * 0.25)) {
          luma[y * W + x] = 0.95;
        }
      }
    }
  }
  return { luma, subject };
}

test('finds a dark round eye with a catchlight inside the subject', () => {
  const { luma, subject } = bird([{ x: 170, y: 70, r: 4, catchlight: true }]);
  const eye = findEye({ luma, subject, width: W, height: H });
  assert.ok(eye, 'an eye should be found');
  assert.ok(Math.abs(eye.x * W - 170) <= 4 && Math.abs(eye.y * H - 70) <= 4, `${eye.x * W}, ${eye.y * H}`);
  assert.equal(eye.confidence, 'likely');
});

test('abstains when there is no eye-like spot', () => {
  const { luma, subject } = bird();
  assert.equal(findEye({ luma, subject, width: W, height: H }), null);
});

test('abstains when patterned plumage gives several equally eye-like spots', () => {
  const { luma, subject } = bird([
    { x: 80, y: 70, r: 4 }, { x: 120, y: 95, r: 4 }, { x: 160, y: 70, r: 4 },
  ]);
  assert.equal(findEye({ luma, subject, width: W, height: H }), null);
});

test('a dark spot outside the subject is never taken for its eye', () => {
  const { luma, subject } = bird([{ x: 15, y: 15, r: 4, catchlight: true }]);
  assert.equal(findEye({ luma, subject, width: W, height: H }), null);
});

test('damaged or mismatched input is refused, not guessed from', () => {
  const { luma, subject } = bird([{ x: 170, y: 70, r: 4, catchlight: true }]);
  assert.equal(findEye({ luma, subject: subject.subarray(1), width: W, height: H }), null);
  const broken = Float32Array.from(luma); broken[5] = Number.NaN;
  assert.equal(findEye({ luma: broken, subject, width: W, height: H }), null);
  assert.equal(findEye({ luma: new Float32Array(8 * 8), subject: null, width: 8, height: 8 }), null);
});

test('the pan puts the chosen point in the middle of the view', () => {
  assert.deepEqual(panToCentre({ x: 0.5, y: 0.5 }, { width: 800, height: 600 }, 4), { x: -0, y: -0 });
  assert.deepEqual(panToCentre({ x: 0.75, y: 0.25 }, { width: 800, height: 600 }, 2), { x: -400, y: 300 });
});
