import test from 'node:test';
import assert from 'node:assert/strict';
import { chooseZoomFocus, focusPoint, focusZoom, pictureToScreen, subjectBox } from './eyeZoom';

const rect = { left: 100, top: 50, width: 400, height: 400 };

test('pictureToScreen maps a fill picture straight across its element', () => {
  assert.deepEqual(pictureToScreen({ x: 0.25, y: 0.5 }, { width: 800, height: 400 }, rect, 'fill'), { x: 200, y: 250 });
});

test('pictureToScreen allows for the bars of a contained picture', () => {
  // 800×400 in a 400×400 box: drawn 400×200, 100 px bar above and below.
  assert.deepEqual(pictureToScreen({ x: 0.5, y: 0 }, { width: 800, height: 400 }, rect, 'contain'), { x: 300, y: 150 });
});

test('pictureToScreen allows for the cropped edges of a covering picture, and refuses a point that is cropped away', () => {
  // 800×400 covering a 400×400 box: drawn 800×400, 200 px cut off each side.
  assert.deepEqual(pictureToScreen({ x: 0.5, y: 0.5 }, { width: 800, height: 400 }, rect, 'cover'), { x: 300, y: 250 });
  assert.equal(pictureToScreen({ x: 0.1, y: 0.5 }, { width: 800, height: 400 }, rect, 'cover'), null);
});

test('pictureToScreen refuses nonsense input rather than guessing', () => {
  assert.equal(pictureToScreen({ x: 1.5, y: 0.5 }, { width: 800, height: 400 }, rect, 'fill'), null);
  assert.equal(pictureToScreen({ x: 0.5, y: 0.5 }, { width: 0, height: 400 }, rect, 'fill'), null);
  assert.equal(pictureToScreen({ x: Number.NaN, y: 0.5 }, { width: 800, height: 400 }, rect, 'fill'), null);
});

const gridOf = (w: number, h: number, on: (x: number, y: number) => boolean) => {
  let raw = '';
  for (let y = 0; y < h; y += 1) for (let x = 0; x < w; x += 1) raw += String.fromCharCode(on(x, y) ? 255 : 0);
  return { w, h, data: btoa(raw) };
};

test('subjectBox reads the sure cells of a subject grid as a box across the picture', () => {
  const box = subjectBox(gridOf(10, 8, (x, y) => x >= 6 && x <= 8 && y >= 2 && y <= 5));
  assert.deepEqual(box, { x: 0.6, y: 0.25, width: 0.3, height: 0.5 });
  assert.equal(subjectBox(gridOf(10, 8, () => false)), null);
  assert.equal(subjectBox({ w: 4, h: 4, data: btoa('short') }), null);
});

test('Zoom to eye goes to a confident eye, else the subject, else the centre', () => {
  const subject = { x: 0.6, y: 0.2, width: 0.3, height: 0.4 };
  assert.deepEqual(chooseZoomFocus({ x: 0.8, y: 0.3, radius: 0.01, confidence: 'likely' }, subject), { kind: 'eye', x: 0.8, y: 0.3 });
  // A merely possible eye is not certain enough: the subject is used instead.
  assert.deepEqual(chooseZoomFocus({ x: 0.8, y: 0.3, radius: 0.01, confidence: 'possible' }, subject), { kind: 'subject', box: subject });
  assert.deepEqual(chooseZoomFocus(null, subject), { kind: 'subject', box: subject });
  assert.deepEqual(chooseZoomFocus(null, null), { kind: 'centre' });
  assert.deepEqual(focusPoint({ kind: 'subject', box: subject }), { x: 0.75, y: 0.4 });
  assert.deepEqual(focusPoint({ kind: 'centre' }), { x: 0.5, y: 0.5 });
});

test('focusZoom: eye and centre go to 100%; the subject fills about two thirds of the view, between Fit and 100%', () => {
  const base = { current: 1, actual: 4, pictureOnScreen: { width: 600, height: 400 }, view: { width: 900, height: 600 } };
  assert.equal(focusZoom({ kind: 'eye', x: 0.5, y: 0.5 }, base), 4);
  assert.equal(focusZoom({ kind: 'centre' }, base), 4);
  // A subject 0.3 of the picture each way is 180 × 120 px at Fit, so 3.3× makes it fill two thirds of the view.
  const small = focusZoom({ kind: 'subject', box: { x: 0.4, y: 0.4, width: 0.3, height: 0.3 } }, base);
  assert.ok(Math.abs(small - 3.3) < 1e-9);
  // A subject that already fills the picture stays at Fit; a tiny one stops at 100%.
  assert.equal(focusZoom({ kind: 'subject', box: { x: 0, y: 0, width: 1, height: 1 } }, base), 1);
  assert.equal(focusZoom({ kind: 'subject', box: { x: 0.5, y: 0.5, width: 0.01, height: 0.01 } }, base), 4);
  // Measured while already zoomed in: the same subject gives the same target.
  const zoomed = focusZoom({ kind: 'subject', box: { x: 0.4, y: 0.4, width: 0.3, height: 0.3 } }, { ...base, current: 2, pictureOnScreen: { width: 1200, height: 800 } });
  assert.ok(Math.abs(zoomed - small) < 1e-9);
});
