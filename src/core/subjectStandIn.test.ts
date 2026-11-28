import test from 'node:test';
import assert from 'node:assert/strict';
import { standInSubjectMap } from './subjectStandIn.ts';

const picture = (size: number, inside: (x: number, y: number) => boolean) => {
  const rgba = new Uint8ClampedArray(size * size * 4);
  for (let y = 0; y < size; y += 1) for (let x = 0; x < size; x += 1) {
    const i = (y * size + x) * 4; const on = inside(x, y);
    rgba[i] = on ? 240 : 40; rgba[i + 1] = on ? 215 : 50; rgba[i + 2] = on ? 160 : 64; rgba[i + 3] = 255;
  }
  return rgba;
};

test('the stand-in marks a bright subject on a dark background and leaves the background low', () => {
  const size = 64;
  const map = standInSubjectMap(picture(size, (x, y) => Math.hypot(x - 32, y - 32) < 14), size);
  assert.ok(map[32 * size + 32] > 0.9);
  assert.ok(map[4 * size + 4] < 0.05);
});

test('the stand-in is deterministic and gives an empty map for a plain picture', () => {
  const size = 32;
  const subject = picture(size, (x, y) => x > 10 && x < 22 && y > 10 && y < 22);
  assert.deepEqual(standInSubjectMap(subject, size), standInSubjectMap(subject, size));
  assert.equal(Math.max(...standInSubjectMap(picture(size, () => false), size)), 0);
});
