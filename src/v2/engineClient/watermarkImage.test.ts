import assert from 'node:assert/strict';
import test from 'node:test';
import { artworkBrightness, borderColour, markBrightness, cutOutBackground, recolour, type Rgba } from './watermarkImage.ts';

/** A white picture with a black square, and optionally a white hole in the square. */
function logo(size = 20, hole = false): Rgba {
  const data = new Uint8ClampedArray(size * size * 4).fill(255);
  for (let y = 5; y < 15; y += 1) for (let x = 5; x < 15; x += 1) {
    const i = (y * size + x) * 4;
    const inHole = hole && x >= 9 && x < 11 && y >= 9 && y < 11;
    data[i] = data[i + 1] = data[i + 2] = inHole ? 255 : 0;
  }
  return { data, width: size, height: size };
}
const alphaAt = (img: Rgba, x: number, y: number) => img.data[(y * img.width + x) * 4 + 3];

test('the background colour is the most common colour round the border', () => {
  assert.deepEqual(borderColour(logo()).map(Math.round), [255, 255, 255]);
});

test('a white background is removed and the logo is kept', () => {
  const result = cutOutBackground(logo(), 20, 0);
  assert.equal(result.tooMuch, false);
  assert.equal(alphaAt(result.image, 0, 0), 0);
  assert.equal(alphaAt(result.image, 19, 19), 0);
  assert.equal(alphaAt(result.image, 10, 10), 255);
  assert.ok(result.removed > 0.7 && result.removed < 0.8);
});

test('white INSIDE the logo is kept: only the background that reaches the edge is removed', () => {
  const result = cutOutBackground(logo(20, true), 20, 0);
  assert.equal(alphaAt(result.image, 0, 0), 0);
  assert.equal(alphaAt(result.image, 9, 9), 255, 'the white hole inside the square stays');
});

test('a tolerance of 0 removes only the exact background colour', () => {
  const near = logo();
  for (let i = 0; i < near.data.length; i += 4) if (near.data[i] === 255) { near.data[i] = 250; near.data[i + 1] = 250; near.data[i + 2] = 250; } // off-white (JPEG noise)
  near.data[0] = near.data[1] = near.data[2] = 255; // one pure white pixel
  const strict = cutOutBackground(near, 0, 0);
  assert.equal(alphaAt(strict.image, 1, 0), 0, 'the common off-white is the background colour here');
  const loose = cutOutBackground(near, 40, 0);
  assert.equal(alphaAt(loose.image, 10, 10), 255, 'the black logo is far from the background and stays');
});

test('a picture that is nearly all one colour is left alone, with the reason', () => {
  const flat: Rgba = { data: new Uint8ClampedArray(10 * 10 * 4).fill(255), width: 10, height: 10 };
  const result = cutOutBackground(flat, 30, 0);
  assert.equal(result.tooMuch, true);
  assert.equal(result.image, flat);
});

test('softening fades only the kept pixels at the new edge', () => {
  const hard = cutOutBackground(logo(), 20, 0).image;
  const soft = cutOutBackground(logo(), 20, 1).image;
  assert.equal(alphaAt(hard, 5, 10), 255);
  assert.ok(alphaAt(soft, 5, 10) <= 255);
  assert.equal(alphaAt(soft, 10, 10), 255, 'the middle of the logo is untouched');
});

test('recolouring keeps the shape and transparency, and brightness tells a light mark from a dark one', () => {
  const cut = cutOutBackground(logo(), 20, 0).image;
  assert.ok((artworkBrightness(cut) ?? 1) < 0.1, 'a black logo is dark');
  const white = recolour(cut, 'white');
  assert.equal(alphaAt(white, 0, 0), 0);
  assert.equal(alphaAt(white, 10, 10), 255);
  assert.ok((artworkBrightness(white) ?? 0) > 0.95);
  assert.equal(artworkBrightness({ data: new Uint8ClampedArray(16), width: 2, height: 2 }), null, 'fully transparent has no brightness');
});

test('a black logo on a white background is a dark mark, and a white logo on black is a light one', () => {
  assert.ok((markBrightness(logo()) ?? 1) < 0.1);
  const inverse = logo();
  for (let i = 0; i < inverse.data.length; i += 4) { const v = 255 - inverse.data[i]; inverse.data[i] = inverse.data[i + 1] = inverse.data[i + 2] = v; }
  assert.ok((markBrightness(inverse) ?? 0) > 0.9);
  assert.ok((artworkBrightness(logo()) ?? 0) > 0.5, 'the plain average is fooled by the white background');
});
