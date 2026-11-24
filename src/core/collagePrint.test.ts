import { test } from 'node:test';
import assert from 'node:assert/strict';
import { planCollagePrint, printSlotResolution, printResolutionMessage } from './collagePrint';
test('physical page sizes calculate 300ppi including 3mm print bleed', () => {
  const page = planCollagePrint('a4-portrait');
  assert.equal(page.mediaWidthMm, 216);
  assert.equal(page.mediaHeightMm, 303);
  assert.equal(page.targetPixels.width, 2552);
  assert.ok(page.trimBoxPt[0] > 0);
  assert.throws(() => planCollagePrint('square'));
});
test('refuse to pretend a low-resolution source has print resolution', () => {
  assert.equal(Math.round(printSlotResolution({width:300,height:300}, {width:100,height:100})),76);
  assert.match(printResolutionMessage(76) || '', /76 genuine pixels/);
  assert.equal(printResolutionMessage(310),null);
});
