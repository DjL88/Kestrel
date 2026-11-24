import { assessAutoQuality, type AutoQualityAssessment } from './autoQualityGate';
import type { Pixels } from './colourCheck';
import { regionalDetailEvidence } from '../engine/regionalDetailGuard';

export interface AutoRenderReview { safe: boolean; reason: string }
const fail = (reason: string): AutoRenderReview => ({safe:false,reason});
const luma = (d: Uint8ClampedArray,p:number) => .2126*d[4*p]+.7152*d[4*p+1]+.0722*d[4*p+2];

/** Compare actual rendered pixels, not proposed slider values. This is a
 * conservative unattended-edit gate, not an aesthetic score or neural model.
 * The caller supplies trusted subject masks at this exact render resolution.
 */
export function superviseAutoRender(before: Pixels, after: Pixels, subjects: readonly Float32Array[] = []): AutoRenderReview {
  const {width,height}=before, count=width*height;
  if (!Number.isSafeInteger(width)||!Number.isSafeInteger(height)||width<1||height<1||
      count>409600||after.width!==width||after.height!==height||before.data.length!==count*4||after.data.length!==count*4)
    return fail('The rendered comparison is incomplete');
  const global: AutoQualityAssessment=assessAutoQuality(before.data,after.data);
  if(!global.safe)return global;
  const structure=regionalDetailEvidence(before,after);
  if(structure.regions && (structure.ratio<.55 || structure.worstRegion<.4))
    return fail('The combined edit removed too much local detail');
  // Look for new overshoot beyond the original neighbourhood on both sides
  // of a strong edge. This is a halo indicator, not proof of every halo.
  let edgeCount=0, overshoot=0;
  for(let y=1;y<height-1;y++)for(let x=1;x<width-1;x++){
    const p=y*width+x;
    for(const step of [1,width]){
      const a=luma(before.data,p-step), b=luma(before.data,p), c=luma(before.data,p+step);
      if(Math.abs(a-c)<24||b<Math.min(a,c)-2||b>Math.max(a,c)+2)continue;
      edgeCount++;
      const na=luma(after.data,p-step),nb=luma(after.data,p),nc=luma(after.data,p+step);
      if(nb<Math.min(na,nc)-10||nb>Math.max(na,nc)+10)overshoot++;
    }
  }
  if(edgeCount>=32&&overshoot/edgeCount>.08)return fail('The combined edit introduced excessive edge overshoot');
  for(const alpha of subjects){
    if(alpha.length!==count||!alpha.every(a=>Number.isFinite(a)&&a>=0&&a<=1))return fail('Subject comparison is incomplete');
    let covered=0,newWhite=0,newBlack=0;
    for(let p=0;p<count;p++){
      if(alpha[p]<.8)continue;
      covered++;
      const i=p*4;
      if(Math.max(before.data[i],before.data[i+1],before.data[i+2])<254&&Math.max(after.data[i],after.data[i+1],after.data[i+2])>=254)newWhite++;
      if(luma(before.data,p)>5&&luma(after.data,p)<=5)newBlack++;
    }
    if(covered<16)return fail('A detected subject is too small to verify');
    if(newWhite/covered>.01||newBlack/covered>.01)return fail('A detected subject lost highlight or shadow detail');
    const evidence=regionalDetailEvidence(before,after,alpha);
    if(evidence.regions&&(evidence.ratio<.75||evidence.worstRegion<.6))return fail('A detected subject lost too much texture');
  }
  return {safe:true,reason:'Rendered clipping, colour and regional detail checks passed'};
}
