import assert from 'node:assert/strict';
import test from 'node:test';
import { pixelStyleTags, sceneTags } from '../core/sceneTags';
import { pixelStyleTagsOffThread } from './pixelAnalysis';
import type { ExifMetadata } from '../core/types';

function picture(kind: 'grey' | 'dark' | 'colour'): Uint8ClampedArray {
  const rgba = new Uint8ClampedArray(160 * 120 * 4);
  for (let i = 0; i < rgba.length; i += 4) {
    const v = kind === 'dark' ? ((i / 4) % 160 < 8 ? 230 : 14) : 40 + ((i / 4) % 160);
    rgba[i] = v; rgba[i + 1] = kind === 'colour' ? 255 - v : v; rgba[i + 2] = kind === 'colour' ? v / 2 : v; rgba[i + 3] = 255;
  }
  return rgba;
}

test('the measured style tags are the same whether worked out in a worker or here', async () => {
  for (const kind of ['grey', 'dark', 'colour'] as const) {
    const rgba = picture(kind);
    assert.deepEqual(await pixelStyleTagsOffThread(rgba), pixelStyleTags(rgba), kind);
    const exif = {} as ExifMetadata;
    assert.deepEqual(sceneTags({ exif, pixelTags: pixelStyleTags(rgba) }), sceneTags({ exif, rgba }), `${kind}: the same scene tags either way`);
  }
});
