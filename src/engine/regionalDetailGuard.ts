import type { Pixels } from '../core/colourCheck';

/** Offline deterministic evidence, not a trained vision model. Compare
 * coherent edge contrast at several offsets, rather than red-channel noise.
 * Evaluate each spatial region independently so a large sharp subject cannot
 * hide damage to a smaller subject. Thresholds require photographic calibration.
 */
export interface DetailEvidence { ratio: number; regions: number; worstRegion: number }
const luma = (data: Uint8ClampedArray, p: number) => {
  const i=p*4;
  return 0.2126*data[i]+0.7152*data[i+1]+0.0722*data[i+2];
};

export function regionalDetailEvidence(before: Pixels, after: Pixels, mask?: Float32Array): DetailEvidence {
  const {width,height}=before;
  const block=32;
  let baseline=0, retained=0, regions=0, worstRegion=1;
  const eligible=(p:number)=>!mask||mask[p]>=0.5;
  for(let by=0;by<height;by+=block) for(let bx=0;bx<width;bx+=block) {
    let old=0, next=0, edges=0;
    for(let y=by;y<Math.min(height,by+block);y++) for(let x=bx;x<Math.min(width,bx+block);x++) {
      const p=y*width+x;
      if(!eligible(p)) continue;
      for(const distance of [1,3]) {
        for(const q of [x+distance<width?p+distance:-1,y+distance<height?p+distance*width:-1]) {
          if(q<0||!eligible(q)) continue;
          const a=Math.abs(luma(before.data,p)-luma(before.data,q));
          // Ignore very weak fluctuations; this is evidence of structure,
          // not a claim that every high-frequency feature is real detail.
          if(a<8) continue;
          old+=a;
          next+=Math.min(a,Math.abs(luma(after.data,p)-luma(after.data,q)));
          edges++;
        }
      }
    }
    if(edges<4||old<48) continue;
    baseline+=old;retained+=next;regions++;
    worstRegion=Math.min(worstRegion,next/old);
  }
  return {ratio:baseline?retained/baseline:1,regions,worstRegion};
}
