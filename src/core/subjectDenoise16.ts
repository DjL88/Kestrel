import { maskAlpha, effectiveAlpha } from './masks';
import type { Mask } from './maskTypes';
import { denoiseChromaRgb16 } from './chromaDenoise16';
import { decodeSrgb16, encodeSrgb16, blendSrgb16 } from './linearRgb16';
import type { Rgb16Image } from './master16';
import { noiseStrength } from './noiseReduction';
import { denoiseLuminance } from './luminanceDenoise';
import { regionNoise } from './denoiseRegions';

export { isDenoisePair, denoiseMembers, denoiseEyes } from './denoiseRegions';

/** Colour (radius 2) then grain (radius 2) filtering reads up to four original rows either side of a strip. */
const HALO = 4;

/** Every strength uses the same pre-pair RGB16 samples. Only bounded strips
 * and original four-row halos are retained. No 8-bit intermediate. */
export function applySubjectDenoise16(image: Rgb16Image, background: Mask, subject: Mask,
  members: readonly Mask[], masks: readonly Mask[], budget: number, eyes: readonly Mask[] = []): void {
  const {width,height,data} = image;
  const stride = width * 3;
  const rows = Math.max(1, Math.floor(budget / width));
  let retained = new Uint16Array(0);
  for (let from = 0; from < height; from += rows) {
    const to = Math.min(height, from + rows), first = Math.max(0, from - HALO), last = Math.min(height, to + HALO);
    const source = data.slice(first * stride, last * stride);
    if (first < from) source.set(retained, 0);
    retained = source.slice((Math.max(first,to-HALO)-first)*stride,(to-first)*stride);
    // Same order as the 8-bit preview's applyNoiseReduction: colour, then grain. Both kernels reach at most two rows,
    // which the original halo rows cover.
    const filter = (region: Mask): Uint16Array => {
      const { denoise, denoiseLuminance: grain } = regionNoise(region);
      if (!noiseStrength(denoise) && !noiseStrength(grain)) return source;
      const candidate = source.slice();
      if (noiseStrength(denoise)) denoiseChromaRgb16(candidate,width,last-first,noiseStrength(denoise),(denoise ?? 0)>1?2:1);
      if (noiseStrength(grain)) denoiseLuminance(candidate,width,last-first,noiseStrength(grain));
      return candidate;
    };
    const bg = filter(background), fg = filter(subject);
    const context = {aspect: height/width, view: {x:0,y:from/height,w:1,h:(to-from)/height}};
    const alpha = maskAlpha(subject,width,to-from,context);
    const offset = (from-first)*stride;
    const count = alpha.length;
    const total = new Float32Array(count), coverage = new Float32Array(count), rgb = new Float32Array(count*3);
    for (const member of members) {
      const a = effectiveAlpha(member,masks,width,to-from,context);
      const candidate = filter(member);
      for(let p=0;p<count;p++) {
        const weight = a[p]*alpha[p];
        total[p]+=weight; coverage[p]=Math.max(coverage[p],weight);
        for(let c=0;c<3;c++) rgb[p*3+c]+=decodeSrgb16(candidate[offset+p*3+c])*weight;
      }
    }
    // Eyes override every subject strength where they cover the subject (the gentlest region wins).
    const eyeCover = new Float32Array(eyes.length ? count : 0), eyePick = new Int32Array(eyes.length ? count : 0).fill(-1);
    const eyeCandidates = eyes.map(eye => filter(eye));
    eyes.forEach((eye, e) => {
      const a = effectiveAlpha(eye,masks,width,to-from,context);
      for(let p=0;p<count;p++) { const w=a[p]*alpha[p]; if (w>eyeCover[p]) { eyeCover[p]=w; eyePick[p]=e; } }
    });
    for(let p=0;p<count;p++) for(let c=0;c<3;c++) {
      const j=offset+p*3+c, dest=from*stride+p*3+c;
      const eye = eyes.length && eyeCover[p] > 0;
      if (!total[p] && !eye) { data[dest]=blendSrgb16(bg[j],fg[j],alpha[p]); continue; }
      const b=decodeSrgb16(bg[j]), f=decodeSrgb16(fg[j]);
      let value = b*(1-alpha[p])+f*alpha[p]+(total[p] ? coverage[p]*(rgb[p*3+c]/total[p]-f) : 0);
      if (eye) value += eyeCover[p]*(decodeSrgb16(eyeCandidates[eyePick[p]][j])-value);
      data[dest]=encodeSrgb16(value);
    }
  }
}
