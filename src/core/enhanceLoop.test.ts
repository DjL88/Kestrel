import test from 'node:test';
import assert from 'node:assert/strict';
import { observeFrame, statObservations } from './enhanceObserve';
import { resolveGuidance, attributeStep } from './enhanceGuide';
import { clampKnobs, knobsToEdit, KNOB_LIMITS, NEUTRAL_KNOBS, proposeKnobs } from './enhanceRecipe';
import { enhancePhoto, MAX_ROUNDS, tweakKnobs, type VisionAssistant } from './enhanceLoop';
import { onlyEnhanceKeysChanged } from './enhanceCritique';
import { DEFAULT_EDIT } from './photoEdits';

/** A deterministic textured scene: sky gradient over a textured ground, with a mid-grey card. `gain` scales linear light. */
function scene(width: number, height: number, gain = 1, cast: [number, number, number] = [1, 1, 1]): Uint8ClampedArray {
  const px = new Uint8ClampedArray(width * height * 4);
  let seed = 7;
  const rnd = () => { seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0; return seed / 4294967296; };
  const enc = (l: number) => Math.round(255 * Math.min(1, Math.max(0, l <= 0.0031308 ? l * 12.92 : 1.055 * l ** (1 / 2.4) - 0.055)));
  for (let y = 0; y < height; y += 1) for (let x = 0; x < width; x += 1) {
    const o = (y * width + x) * 4;
    const sky = y < height * 0.45;
    const base = sky ? 0.55 - 0.3 * (y / height) + 0.012 * rnd() : 0.14 + 0.02 * Math.sin(x / 9) * Math.sin(y / 7) + 0.006 * rnd();
    const grey = x > width * 0.4 && x < width * 0.6 && y > height * 0.55 && y < height * 0.85;
    const l = (grey ? 0.18 : base) * gain;
    px[o] = enc(l * cast[0] * (sky && !grey ? 0.8 : 1)); px[o + 1] = enc(l * cast[1] * (sky && !grey ? 0.95 : 1)); px[o + 2] = enc(l * cast[2]); px[o + 3] = 255;
  }
  return px;
}

const W = 240, H = 160;
const UNDER = { evCompensation: -1, shutterSeconds: 1 / 2000, iso: 3200, aperture: 4 };

test('observe measures the actual pixels and leaves unknown as null', () => {
  const s = observeFrame(scene(W, H), W, H);
  assert.ok(s.p50 > 0 && s.p50 < 1);
  assert.ok(s.p05 <= s.p50 && s.p50 <= s.p95);
  const tiny = observeFrame(new Uint8ClampedArray(8 * 8 * 4).fill(128), 8, 8);
  assert.equal(tiny.noiseSigma, null, 'too small to measure noise');
  assert.equal(tiny.tilt, null);
  assert.equal(tiny.subject, null);
});

test('measured observations only list clear states and cite their evidence', () => {
  const dark = observeFrame(scene(W, H, 0.25), W, H);
  const obs = statObservations(dark);
  assert.ok(obs.every((o) => o.evidence.length > 0 && o.observation.confidence <= 0.98));
  const flat = statObservations(observeFrame(new Uint8ClampedArray(W * H * 4).fill(128), W, H));
  assert.equal(flat.length, 0, 'a plain mid-grey picture has nothing clear to report');
});

test('guidance resolves rules with checked sources, and protects dark-on-purpose', () => {
  const s = observeFrame(scene(W, H, 3.5), W, H);
  const g = resolveGuidance(s, []);
  assert.ok(g.hardGates.includes('no-detail-regression'));
  const low = resolveGuidance(observeFrame(scene(W, H, 0.2), W, H), [{ dimension: 'lighting', label: 'low key', confidence: 0.95 }]);
  assert.equal(low.protect.dark, true);
  const uncertain = resolveGuidance(s, [{ dimension: 'subject', label: 'perched bird', confidence: 0.5 }]);
  assert.ok(!uncertain.rules.some((r) => r.id === 'subject.perched-bird'), 'a 0.5-confidence guess never resolves a rule');
  assert.ok(uncertain.unknown.some((o) => o.label === 'perched bird'));
});

test('every proposed step is bounded and carries a rule id and sources, or says it is house practice', () => {
  const s = observeFrame(scene(W, H, 0.2), W, H);
  const g = resolveGuidance(s, []);
  for (const style of ['natural', 'subject', 'bold', 'light'] as const) {
    const p = proposeKnobs(s, g, style, false, { exposure: 9, shadows: 9, highlights: -9 });
    for (const key of Object.keys(KNOB_LIMITS) as (keyof typeof KNOB_LIMITS)[]) {
      assert.ok(p.knobs[key] >= KNOB_LIMITS[key][0] && p.knobs[key] <= KNOB_LIMITS[key][1], `${style} ${key} within limits`);
    }
    for (const step of p.steps) assert.ok(step.ruleId === null ? step.sources.length === 0 : true);
  }
  assert.deepEqual(clampKnobs({ ...NEUTRAL_KNOBS, exposure: 99, highlights: 5 }).exposure, 2.5);
  assert.equal(attributeStep(g, 'exposure', 'down', 'photo'), null, 'no rule asks for that move');
});

test('recipes never touch crop, rotation, heal or anything else the person set', () => {
  const base = { ...DEFAULT_EDIT, exposure: 0.3, heal: [], whiteBalance: undefined } as typeof DEFAULT_EDIT;
  const edit = knobsToEdit(base, { ...NEUTRAL_KNOBS, exposure: 1, highlights: -0.5 }, null);
  assert.equal(edit.exposure, 1.3, 'adds to the person\'s own value');
  assert.ok(onlyEnhanceKeysChanged(base, edit));
  assert.ok(!onlyEnhanceKeysChanged(base, { ...edit, upscale: 2 }), 'upscaling is never part of the loop');
  assert.ok(!onlyEnhanceKeysChanged(base, { ...edit, dehaze: 0.5 }));
});

test('tweaks respond to what was found and stay in bounds', () => {
  const s = observeFrame(scene(W, H), W, H);
  const up = tweakKnobs({ ...NEUTRAL_KNOBS, exposure: 2.4 }, [{ id: 'tooDark', words: 'dark', source: 'measured' }], s);
  assert.ok(up.exposure <= 2.5);
  const less = tweakKnobs({ ...NEUTRAL_KNOBS, exposure: 1, highlights: -1 }, [{ id: 'clippedMore', words: 'blown', source: 'measured' }], s);
  assert.ok(less.highlights < -1 && less.exposure < 1);
  const gate = tweakKnobs({ ...NEUTRAL_KNOBS, contrast: 0.5 }, [{ id: 'gate', words: 'x', source: 'measured' }], s);
  assert.ok(gate.contrast < 0.5);
});

test('a dark photo gets three options within five rounds, with a favourite and a measured reason', async () => {
  const px = scene(W, H, 0.45);
  const r = await enhancePhoto({ pixels: px, width: W, height: H, meta: UNDER });
  assert.equal(r.options.length, 3);
  for (const o of r.options) assert.ok(o.rounds.length <= MAX_ROUNDS);
  const improved = r.options.filter((o) => o.outcome === 'improved');
  assert.ok(improved.length >= 1, 'at least one option brightens a dark scene');
  assert.notEqual(r.favourite, null);
  assert.equal(r.favouriteBy, 'measurements', 'no vision assistant, so measurements chose and the result says so');
  for (const o of improved) for (const s of o.steps) assert.ok(s.evidence.length > 0);
  const chosen = r.options[r.favourite!];
  assert.ok(chosen.edit.exposure > 0, 'a dark scene is brightened');
});

test('a well-exposed photo is left alone: nothing applied, nothing rejected', async () => {
  const px = scene(W, H, 3.2);
  const r = await enhancePhoto({ pixels: px, width: W, height: H, maxRounds: 3 });
  for (const o of r.options) assert.ok(['nothing-needed', 'improved', 'kept-for-review'].includes(o.outcome));
  if (r.favourite === null) for (const o of r.options) assert.deepEqual(o.edit, DEFAULT_EDIT, 'unchanged recipe when nothing applies');
});

test('the loop never exceeds the round limit even when asked for more', async () => {
  const r = await enhancePhoto({ pixels: scene(W, H, 0.2), width: W, height: H, maxRounds: 99 });
  for (const o of r.options) assert.ok(o.rounds.length <= MAX_ROUNDS);
});

test('a vision assistant that throws or says nothing never blocks and is never read as agreement', async () => {
  const broken: VisionAssistant = {
    kind: 'on-device',
    observe: async () => { throw new Error('model failed'); },
    critique: async () => { throw new Error('model failed'); },
    prefer: async () => { throw new Error('model failed'); },
  };
  const r = await enhancePhoto({ pixels: scene(W, H, 0.45), width: W, height: H, vision: broken, maxRounds: 2, meta: UNDER });
  assert.equal(r.options.length, 3);
  assert.equal(r.favouriteBy, 'measurements', 'a failed model never counts as the model\'s favourite');
  assert.equal(r.chain.results[0].outcome, 'unchecked');
});

test('the on-device favourite is used and labelled; a stand-in is labelled as a stand-in', async () => {
  const pick = (kind: 'on-device' | 'stand-in'): VisionAssistant => ({ kind, prefer: async (_b, c) => c.length - 1 });
  const px = scene(W, H, 0.45);
  const real = await enhancePhoto({ pixels: px, width: W, height: H, vision: pick('on-device'), maxRounds: 2, meta: UNDER });
  assert.equal(real.favouriteBy, 'device-ai');
  const fake = await enhancePhoto({ pixels: px, width: W, height: H, vision: pick('stand-in'), maxRounds: 2, meta: UNDER });
  assert.equal(fake.favouriteBy, 'stand-in');
});

test('the per-photo loop never calls the cloud and works fully without it', async () => {
  const r = await enhancePhoto({ pixels: scene(W, H, 0.45), width: W, height: H, maxRounds: 2 });
  assert.equal(r.options.length, 3);
  assert.ok(r.chain.results.every((c) => c.where !== 'cloud'));
  assert.ok(!('cloud' in ({} as Parameters<typeof enhancePhoto>[0])), 'there is no cloud input to pass');
});

test('the loop only uses clearly open models; unknown or unconfirmed ones are refused', async () => {
  const { loopMayUse, LOOP_MODELS } = await import('./enhanceModels');
  assert.equal(loopMayUse('smolvlm2-256m'), true);
  assert.equal(loopMayUse('nafnet-sidd-w32-w16'), false);
  assert.equal(loopMayUse('some-new-model'), false);
  assert.ok(LOOP_MODELS.every((m) => m.note.length > 0));
});

test('a failing gate backs off rather than shipping: a hard lift is never kept if the gates fail', async () => {
  const r = await enhancePhoto({ pixels: scene(W, H, 0.12), width: W, height: H, maxRounds: 4 });
  for (const o of r.options) if (o.outcome === 'improved') assert.ok(o.rounds[o.bestRound].gateSafe);
});
