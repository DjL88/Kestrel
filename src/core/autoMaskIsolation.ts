import type { Pixels } from './colourCheck';

export interface MaskIsolationReview { safe: boolean; reason: string }
const blocked = (reason:string):MaskIsolationReview => ({safe:false,reason});
/** Compare identical global and existing manual edits, with versus without
 * the new automatic subject masks. This isolates local effects from global
 * exposure/colour changes. The expected envelope comes from detected subjects,
 * not the candidate's own masks. This cannot prove segmentation correctness.
 */
export function assessAutoMaskIsolation(reference:Pixels, candidate:Pixels, subjects:readonly Float32Array[]):MaskIsolationReview {
  const {width,height}=reference, n=width*height;
  if(!Number.isSafeInteger(width)||!Number.isSafeInteger(height)||width<1||height<1||n>409600||
     candidate.width!==width||candidate.height!==height||reference.data.length!==n*4||candidate.data.length!==n*4||
     !subjects.length||subjects.length>12||subjects.some(a=>a.length!==n||!a.every(v=>Number.isFinite(v)&&v>=0&&v<=1)))
    return blocked('Automatic mask coverage could not be verified');
  const envelope=new Float32Array(n), delta=new Float32Array(n);
  for(const a of subjects) for(let p=0;p<n;p++) envelope[p]=Math.max(envelope[p],a[p]);
  let inside=0,outside=0,leaked=0,localEnergy=0,leakEnergy=0,transitions=0,abrupt=0;
  for(let p=0;p<n;p++){
    const i=p*4;
    delta[p]=Math.max(...[0,1,2].map(c=>Math.abs(candidate.data[i+c]-reference.data[i+c])));
    if(envelope[p]>=.8){inside++;localEnergy+=delta[p];}
    if(envelope[p]<=.02){outside++;if(delta[p]>3)leaked++;leakEnergy+=delta[p];}
  }
  if(inside<16)return blocked('Automatic subject mask has insufficient reliable coverage');
  if(outside>=16 && leaked>=4 && (leaked/outside>.005 || leakEnergy>Math.max(12,localEnergy*.05)))
    return blocked('Automatic subject adjustment leaked into the background');
  // At a soft model boundary, a new large one-pixel discontinuity on an
  // originally smooth patch is evidence of a visible adjustment seam.
  for(let y=0;y<height;y++)for(let x=0;x<width;x++){
    const p=y*width+x;
    for(const q of [x+1<width?p+1:-1,y+1<height?p+width:-1]){
      if(q<0||Math.abs(envelope[p]-envelope[q])<.02||Math.abs(envelope[p]-envelope[q])>.65||
         Math.max(envelope[p],envelope[q])<.05||Math.min(envelope[p],envelope[q])>.95)continue;
      const a=p*4,b=q*4;
      const old=Math.max(...[0,1,2].map(c=>Math.abs(reference.data[a+c]-reference.data[b+c])));
      if(old>8)continue;
      transitions++;
      const jump=Math.max(...[0,1,2].map(c=>Math.abs((candidate.data[a+c]-reference.data[a+c])-(candidate.data[b+c]-reference.data[b+c]))));
      if(jump>18)abrupt++;
    }
  }
  if(transitions>=16&&abrupt>=4&&abrupt/transitions>.08)return blocked('Automatic mask introduced a visible boundary seam');
  return {safe:true,reason:'Automatic local adjustment stayed within checked subject coverage'};
}
