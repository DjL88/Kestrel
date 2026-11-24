import { maskAlpha, effectiveAlpha } from './masks';
import type { Mask } from './maskTypes';
import { denoiseChromaRgb16 } from './chromaDenoise16';
import { decodeSrgb16, encodeSrgb16, blendSrgb16 } from './linearRgb16';
import type { Rgb16Image } from './master16';
import { noiseStrength } from './noiseReduction';

export function isDenoisePair(background: Mask, subject: Mask | undefined): subject is Extract<Mask, {kind: 'subject'}> {
  return background.kind === 'subject' && subject?.kind === 'subject' &&
    background.id === subject.id + '-background' && background.invert && !subject.invert &&
    !background.hidden && !subject.hidden && !background.limit && !subject.limit &&
    background.feather === subject.feather && background.framingKey === subject.framingKey &&
    JSON.stringify(background.grid) === JSON.stringify(subject.grid) &&
    JSON.stringify(background.detail) === JSON.stringify(subject.detail) &&
    JSON.stringify(background.strokes) === JSON.stringify(subject.strokes) &&
    Object.keys(background.edit).every(key => key === 'denoise') &&
    Object.keys(subject.edit).every(key => key === 'denoise');
}

export function denoiseMembers(group: Extract<Mask, {kind: 'subject'}>, masks: readonly Mask[]): Mask[] {
  return masks.filter(m => m.kind === 'subject' && !m.invert && !m.hidden &&
    m.framingKey === group.framingKey && m.id.startsWith(group.id + '-instance-') &&
    m.edit.denoise !== undefined).sort((a,b) => a.id.localeCompare(b.id));
}

/** Every strength uses the same pre-pair RGB16 samples. Only bounded strips
 * and original two-row halos are retained. No 8-bit intermediate. */
export function applySubjectDenoise16(image: Rgb16Image, background: Mask, subject: Mask,
  members: readonly Mask[], masks: readonly Mask[], budget: number): void {
  const {width,height,data} = image;
  const stride = width * 3;
  const rows = Math.max(1, Math.floor(budget / width));
  let retained = new Uint16Array(0);
  for (let from = 0; from < height; from += rows) {
    const to = Math.min(height, from + rows), first = Math.max(0, from - 2), last = Math.min(height, to + 2);
    const source = data.slice(first * stride, last * stride);
    if (first < from) source.set(retained, 0);
    retained = source.slice((Math.max(0,to-2)-first)*stride,(to-first)*stride);
    const filter = (strength: number | undefined): Uint16Array => {
      if (!noiseStrength(strength)) return source;
      const candidate = source.slice();
      denoiseChromaRgb16(candidate,width,last-first,noiseStrength(strength),(strength ?? 0)>1?2:1);
      return candidate;
    };
    const bg = filter(background.edit.denoise), fg = filter(subject.edit.denoise);
    const context = {aspect: height/width, view: {x:0,y:from/height,w:1,h:(to-from)/height}};
    const alpha = maskAlpha(subject,width,to-from,context);
    const offset = (from-first)*stride;
    const count = alpha.length;
    const total = new Float32Array(count), coverage = new Float32Array(count), rgb = new Float32Array(count*3);
    for (const member of members) {
      const a = effectiveAlpha(member,masks,width,to-from,context);
      const candidate = filter(member.edit.denoise);
      for(let p=0;p<count;p++) {
        const weight = a[p]*alpha[p];
        total[p]+=weight; coverage[p]=Math.max(coverage[p],weight);
        for(let c=0;c<3;c++) rgb[p*3+c]+=decodeSrgb16(candidate[offset+p*3+c])*weight;
      }
    }
    for(let p=0;p<count;p++) for(let c=0;c<3;c++) {
      const j=offset+p*3+c, dest=from*stride+p*3+c;
      if (!total[p]) { data[dest]=blendSrgb16(bg[j],fg[j],alpha[p]); continue; }
      const b=decodeSrgb16(bg[j]), f=decodeSrgb16(fg[j]);
      data[dest]=encodeSrgb16(b*(1-alpha[p])+f*alpha[p]+coverage[p]*(rgb[p*3+c]/total[p]-f));
    }
  }
}
