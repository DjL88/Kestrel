import { decodeUpload, encodeResult } from '../../../src/providers/cloudJobCodec.ts';
import { applyNoiseReduction } from '../../../src/core/noiseReduction.ts';
import { applyMasks, fullContext } from '../../../src/core/masks.ts';
import { DEFAULT_EDIT } from '../../../src/core/photoEdits.ts';
import { splitDenoiseBySubject } from '../../../src/engine/denoiseAction.ts';
import type { Pixels } from '../../../src/core/colourCheck.ts';

/**
 * Turns one job's uploaded bytes into its result bytes using the same CPU pixel code the app runs on the device
 * (`applyNoiseReduction`, `applyMasks`). This is NOT a neural model: it is the same maths, run on a server, in the
 * agreed framing (docs/CLOUD-ENGINE-CONTRACT.md). The client still re-verifies every result before trusting it.
 * Nothing here logs pixels, masks or sizes of the person's photo.
 */
export function processJob(input: Uint8Array, expectedKind: string): Uint8Array {
  const { header, original, subjectAlpha } = decodeUpload(input);
  if (header.capability !== expectedKind) throw new Error('Job kind does not match its upload.');
  const { width, height } = original;
  let out: Uint8ClampedArray;
  if (header.capability === 'denoise') {
    const strength = Math.max(0, Math.min(2, header.backgroundDenoise ?? 0));
    const subjectStrength = header.subjectDenoise ?? splitDenoiseBySubject(strength).subject;
    const run = (denoise: number) =>
      new Uint8ClampedArray(applyNoiseReduction(new Uint8ClampedArray(original.data), width, height, { ...DEFAULT_EDIT, denoise }));
    const background = run(strength);
    if (subjectAlpha) {
      const subject = run(Math.max(0, Math.min(2, subjectStrength)));
      out = new Uint8ClampedArray(background.length);
      for (let p = 0; p < width * height; p += 1) {
        const a = Math.max(0, Math.min(1, subjectAlpha[p]));
        for (let c = 0; c < 4; c += 1) out[p * 4 + c] = background[p * 4 + c] * (1 - a) + subject[p * 4 + c] * a;
      }
    } else out = background;
  } else {
    out = new Uint8ClampedArray(original.data);
    applyMasks(out, width, height, header.masks, fullContext(width, height));
  }
  const picture: Pixels = { data: out, width, height };
  return encodeResult(header.capability, picture);
}
