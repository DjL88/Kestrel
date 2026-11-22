import { decodeUpload, encodeResult } from '../../../src/providers/cloudJobCodec.ts';
import { applyNoiseReduction } from '../../../src/core/noiseReduction.ts';
import { applyMasks, fullContext } from '../../../src/core/masks.ts';
import { DEFAULT_EDIT } from '../../../src/core/photoEdits.ts';
import { splitDenoiseBySubject } from '../../../src/engine/denoiseAction.ts';
import { resampleLanczos3 } from '../../../src/core/upscaleResample.ts';
import type { Pixels } from '../../../src/core/colourCheck.ts';

/**
 * Turns one job's uploaded bytes into its result bytes using the same CPU pixel code the app runs on the device
 * (`applyNoiseReduction`, `applyMasks`, and for `upscale` the deterministic Lanczos-3 resampler - see below). This
 * is NOT a neural model for any capability: it is the same maths, run on a server, in the agreed framing
 * (docs/CLOUD-ENGINE-CONTRACT.md). The client still re-verifies every result before trusting it. Nothing here
 * logs pixels, masks or sizes of the person's photo.
 */
export function processJob(input: Uint8Array, expectedKind: string): Uint8Array {
  const { header, original, subjectAlpha } = decodeUpload(input);
  if (header.capability !== expectedKind) throw new Error('Job kind does not match its upload.');
  const { width, height } = original;
  if (header.capability === 'denoise') {
    const strength = Math.max(0, Math.min(2, header.backgroundDenoise ?? 0));
    const subjectStrength = header.subjectDenoise ?? splitDenoiseBySubject(strength).subject;
    const run = (denoise: number) =>
      new Uint8ClampedArray(applyNoiseReduction(new Uint8ClampedArray(original.data), width, height, { ...DEFAULT_EDIT, denoise }));
    const background = run(strength);
    let out = background;
    if (subjectAlpha) {
      const subject = run(Math.max(0, Math.min(2, subjectStrength)));
      out = new Uint8ClampedArray(background.length);
      for (let p = 0; p < width * height; p += 1) {
        const a = Math.max(0, Math.min(1, subjectAlpha[p]));
        for (let c = 0; c < 4; c += 1) out[p * 4 + c] = background[p * 4 + c] * (1 - a) + subject[p * 4 + c] * a;
      }
    }
    return encodeResult('denoise', { data: out, width, height });
  }
  if (header.capability === 'upscale') {
    // No server-side learned enlarger exists (same as the device's own fallback path when it has none) - this is
    // the deterministic resampler only, so usedModel is honestly always false, never guessed as true.
    const scale = header.scale ?? 2;
    const resized = resampleLanczos3({ data: original.data, width, height, channels: 4 }, width * scale, height * scale);
    return encodeResult('upscale', { data: resized.data, width: resized.width, height: resized.height }, { usedModel: false });
  }
  const out = new Uint8ClampedArray(original.data);
  applyMasks(out, width, height, header.masks, fullContext(width, height));
  return encodeResult('mask', { data: out, width, height });
}
