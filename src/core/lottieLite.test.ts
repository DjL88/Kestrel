import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { parseLottie } from './lottieLite';

const real = JSON.parse(readFileSync(new URL('../assets/splash/kestrel-k-splash.json', import.meta.url), 'utf8'));

test('the Kestrel splash file is read into six filled layers over 2.0 seconds', () => {
  const animation = parseLottie(real)!;
  assert.ok(animation);
  assert.deepEqual([animation.width, animation.height, animation.durationMs], [256, 256, 2000]);
  assert.equal(animation.layers.length, 6);
  // The background is drawn first, the top layer last.
  assert.equal(animation.layers[0].name, 'Charcoal background');
  // Centred on the layer's own origin, which the layer's position of 128, 128 then moves into place.
  assert.deepEqual(animation.layers[0].rect, { x: -128, y: -128, width: 256, height: 256, radius: 45 });
  assert.deepEqual(animation.layers[0].position, { still: [128, 128, 0] });
  assert.equal(animation.layers[0].fill, '#1c2027');
  assert.equal(animation.layers.at(-1)!.name, 'Wine kestrel underside');
});

test('shapes become SVG path data, closed, with the colour from the file', () => {
  const blue = parseLottie(real)!.layers.find((layer) => layer.name === 'Dusk-blue upper stroke')!;
  assert.match(blue.path, /^M143\.52 103\.08C/);
  assert.ok(blue.path.endsWith('Z'));
  assert.equal(blue.fill, '#4a88b2');
  assert.equal(blue.fillOpacity, 1);
});

test('keyframes become offsets from 0 to 1 with the file’s easing, holding before and after', () => {
  const blue = parseLottie(real)!.layers.find((layer) => layer.name === 'Dusk-blue upper stroke')!;
  assert.ok('keyframes' in blue.opacity);
  const frames = (blue.opacity as { keyframes: { offset: number; value: number[]; easing: string }[] }).keyframes;
  assert.deepEqual(frames.map((frame) => Number(frame.offset.toFixed(3))), [0, 0.283, 0.417, 1]);
  assert.deepEqual(frames.map((frame) => frame.value[0]), [0, 0, 1, 1], 'opacity is a share, not a percentage, and waits at 0 before it starts');
  assert.equal(frames[1].easing, 'cubic-bezier(0.35, 0, 0.2, 1)');
  const scale = (blue.scale as { keyframes: { value: number[] }[] }).keyframes;
  assert.deepEqual(scale[1].value.slice(0, 2), [0.8, 0.8]);
});

test('every layer keeps its anchor, and every keyframe list is in order', () => {
  for (const layer of parseLottie(real)!.layers.filter((entry) => entry.rect === null)) {
    assert.deepEqual(layer.anchor, [128, 128]);
    for (const property of [layer.opacity, layer.position, layer.scale]) {
      if ('keyframes' in property) property.keyframes.forEach((frame, index, all) => assert.ok(index === 0 || frame.offset >= all[index - 1].offset));
    }
  }
});

test('anything beyond filled shapes is refused, so the still logo is used instead', () => {
  const copy = () => JSON.parse(JSON.stringify(real));
  assert.equal(parseLottie(null), null);
  assert.equal(parseLottie({}), null);
  const withImage = copy(); withImage.assets = [{ id: 'image_0' }];
  assert.equal(parseLottie(withImage), null);
  const withStroke = copy(); withStroke.layers[0].shapes.push({ ty: 'st' });
  assert.equal(parseLottie(withStroke), null);
  const withMatte = copy(); withMatte.layers[0].tt = 1;
  assert.equal(parseLottie(withMatte), null);
  const rotated = copy(); rotated.layers[0].ks.r = { a: 0, k: 45 };
  assert.equal(parseLottie(rotated), null);
  // The position track's third keyframe (t:15) moved earlier than its second (t:9) breaks the ordering.
  const outOfOrder = copy(); outOfOrder.layers[0].ks.p.k[2].t = 1;
  assert.equal(parseLottie(outOfOrder), null);
});

test('the splash shows once per session on launch, never for automation, and always when asked for', async () => {
  const { shouldShowSplash } = await import('./splashRules');
  assert.equal(shouldShowSplash({ automated: false, alreadyShown: false, forced: false }), true);
  assert.equal(shouldShowSplash({ automated: false, alreadyShown: true, forced: false }), false);
  assert.equal(shouldShowSplash({ automated: true, alreadyShown: false, forced: false }), false);
  assert.equal(shouldShowSplash({ automated: true, alreadyShown: true, forced: true }), true);
});
