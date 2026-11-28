import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { createDoubleTapDetector, DOUBLE_TAP_GAP_MS, isTap, TAP_MAX_MS, TAP_MAX_TRAVEL_PX } from './touchGestures';

const at = (x: number, y: number, t: number) => ({ x, y, t });
const tap = (x: number, y: number, t: number) => [at(x, y, t), at(x, y, t + 60)] as const;

describe('isTap', () => {
  it('is a quick touch that stays put', () => {
    assert.equal(isTap(at(10, 10, 0), at(12, 11, 90)), true);
  });
  it('is not a tap when it was held, even without moving (that is the hold-to-see-original)', () => {
    assert.equal(isTap(at(10, 10, 0), at(10, 10, TAP_MAX_MS + 1)), false);
  });
  it('is not a tap when the finger travelled (a drag or a flick)', () => {
    assert.equal(isTap(at(10, 10, 0), at(10 + TAP_MAX_TRAVEL_PX + 1, 10, 80)), false);
  });
  it('treats a clock that ran backwards as not a tap', () => {
    assert.equal(isTap(at(0, 0, 100), at(0, 0, 50)), false);
  });
});

describe('double-tap detector', () => {
  it('fires on the second quick tap at about the same place', () => {
    const d = createDoubleTapDetector();
    assert.equal(d.lift(...tap(100, 100, 0)), false);
    assert.equal(d.lift(...tap(108, 96, 200)), true);
  });
  it('does not fire when the taps are too far apart in time', () => {
    const d = createDoubleTapDetector();
    d.lift(...tap(100, 100, 0));
    assert.equal(d.lift(...tap(100, 100, 60 + DOUBLE_TAP_GAP_MS + 50)), false);
  });
  it('does not fire when the taps are in different places', () => {
    const d = createDoubleTapDetector();
    d.lift(...tap(100, 100, 0));
    assert.equal(d.lift(...tap(220, 100, 200)), false);
  });
  it('is broken by a drag between the taps', () => {
    const d = createDoubleTapDetector();
    d.lift(...tap(100, 100, 0));
    assert.equal(d.lift(at(100, 100, 150), at(160, 100, 220)), false);
    // The drag ended the pair, so the next tap starts a new one rather than completing the old.
    assert.equal(d.lift(...tap(100, 100, 300)), false);
  });
  it('is broken by a reset (pinch, hold or cancelled touch)', () => {
    const d = createDoubleTapDetector();
    d.lift(...tap(100, 100, 0));
    d.reset();
    assert.equal(d.lift(...tap(100, 100, 200)), false);
  });
  it('a third tap starts a new pair instead of firing again', () => {
    const d = createDoubleTapDetector();
    d.lift(...tap(100, 100, 0));
    assert.equal(d.lift(...tap(100, 100, 150)), true);
    assert.equal(d.lift(...tap(100, 100, 300)), false);
    assert.equal(d.lift(...tap(100, 100, 450)), true);
  });
});
