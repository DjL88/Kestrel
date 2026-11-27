import assert from 'node:assert/strict';
import test from 'node:test';
import { DETAIL_MAX_EDGE, DETAIL_MAX_PIXELS, detailPlan } from './detailRegion.ts';

// A 45 MP Nikon Z 8 frame, drawn by the editor at 2,200 px on its long edge.
const full = { width: 8256, height: 5504 };
const rendered = 2200;
const screen = { left: 0, top: 0, width: 1600, height: 1000 };

test('at Fit there is nothing to add: the drawn picture already has every pixel the screen shows', () => {
  const box = { left: 50, top: 0, width: 1500, height: 1000 };
  assert.equal(detailPlan({ box, visible: screen, devicePixelRatio: 1.25, renderedLongEdge: rendered, full }), null);
});

test('at 100% the part on screen is drawn from the photo’s own pixels, exactly where it lies', () => {
  // The picture's box is the whole photo at 1:1 device pixels (DPR 1.25), scrolled so its middle is on screen.
  const dpr = 1.25;
  const box = { left: -3000, top: -1700, width: full.width / dpr, height: full.height / dpr };
  const plan = detailPlan({ box, visible: screen, devicePixelRatio: dpr, renderedLongEdge: rendered, full })!;
  assert.ok(plan, 'detail is drawn');
  assert.equal(plan.scale, 1, '1:1: the photo’s own pixels, not a smaller picture enlarged');
  // The region covers what is visible, with a little room round it, and is placed over exactly that part of the box.
  const visX0 = (0 - box.left) / box.width, visX1 = (1600 - box.left) / box.width;
  assert.ok(plan.view.x <= visX0 && plan.view.x + plan.view.w >= visX1);
  assert.ok(Math.abs(plan.place.left - plan.view.x * 100) < 1e-9 && Math.abs(plan.place.width - plan.view.w * 100) < 1e-9);
  assert.ok(plan.region.width * plan.region.height * plan.scale ** 2 <= DETAIL_MAX_PIXELS);
});

test('zoomed further than the photo has pixels, it never makes more than the photo has', () => {
  const box = { left: -20000, top: -12000, width: full.width * 4, height: full.height * 4 }; // 400%
  const plan = detailPlan({ box, visible: screen, devicePixelRatio: 1, renderedLongEdge: rendered, full })!;
  assert.equal(plan.scale, 1);
});

test('a very large screen is bounded in pixels and edge, so memory and time stay bounded', () => {
  const box = { left: 0, top: 0, width: full.width * 0.9, height: full.height * 0.9 };
  const plan = detailPlan({ box, visible: { left: 0, top: 0, width: 7000, height: 5000 }, devicePixelRatio: 1, renderedLongEdge: rendered, full })!;
  assert.ok(plan.region.width * plan.region.height * plan.scale ** 2 <= DETAIL_MAX_PIXELS + 1);
  assert.ok(Math.max(plan.region.width, plan.region.height) * plan.scale <= DETAIL_MAX_EDGE + 1);
});

test('no detail from a picture no larger than the one drawn (a screen-size develop): the view never claims detail it lacks', () => {
  const box = { left: -3000, top: -1700, width: 6600, height: 4400 };
  assert.equal(detailPlan({ box, visible: screen, devicePixelRatio: 1.25, renderedLongEdge: rendered, full: { width: 2560, height: 1707 } }), null);
});

test('a picture shown contained in a wider box is placed over the picture, not the box', () => {
  const box = { left: -2000, top: -1000, width: 12000, height: 4000 }; // wider than 3:2
  const plan = detailPlan({ box, visible: screen, devicePixelRatio: 1, renderedLongEdge: rendered, full, fit: 'contain' })!;
  const pictureW = full.width * (4000 / full.height);
  const pictureLeft = (12000 - pictureW) / 2;
  assert.ok(Math.abs(plan.place.left - ((pictureLeft + plan.view.x * pictureW) / 12000) * 100) < 1e-9);
});
