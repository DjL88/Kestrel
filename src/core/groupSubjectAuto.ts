import {maskAlpha, fullContext} from './masks';
import type {Mask, LocalEdit} from './maskTypes';
import type {PhotoEdit} from './photoEdits';
import {renderRecipePreview, assessNaturalAuto, naturalAuto} from './naturalAuto';
import type {PhotographyObservation} from './photographyKnowledge';
type Subject = Extract<Mask,{kind:'subject'}>;
function validDimensions(width:number,height:number){return Number.isSafeInteger(width) && Number.isSafeInteger(height) && width>=16 && height>=16 && width*height<=409600;}
function validGrid(g:Subject['grid']){
  if(!g || !Number.isInteger(g.w)||!Number.isInteger(g.h)||g.w<8||g.h<8||g.w>512||g.h>512||typeof g.data!=='string'||g.data.length!==Math.ceil(g.w*g.h/3)*4)return false;
  try{return atob(g.data).length===g.w*g.h;}catch{return false;}
}
function validSubject(s:Subject){return validGrid(s.grid) && (!s.detail || (validGrid(s.detail.grid) && Object.values(s.detail.region).every(Number.isFinite))) && !s.hidden && !s.invert && !s.limit && !s.strokes.length && Number.isFinite(s.feather) && s.feather>=0 && s.feather<=1;}
function regions(subjects: readonly Subject[], width:number,height:number) {
  if(subjects.length<2 || subjects.length>12 || !Number.isSafeInteger(width) || !Number.isSafeInteger(height) || width<16 || height<16 || width*height>409600) return null;
  if(subjects.some(s=>s.confidence!=='high' || !validSubject(s))) return null;
  const alpha=subjects.map(s=>maskAlpha(s,width,height,fullContext(width,height)));
  for(let i=0;i<width*height;i++){
    let count=0;
    for(const a of alpha) {if(!Number.isFinite(a[i])) return null; if(a[i]>.01) count++;}
    if(count>1) return null; // no overlapping automatic local edits
  }
  if(alpha.some(a=>a.reduce((n,v)=>n+(v>=.8?1:0),0)<Math.max(32,width*height*.005))) return null;
  return alpha;
}
function measure(pixels:Uint8ClampedArray,alpha:Float32Array,width:number){
  let count=0, sum=0, bright=0, clipped=0, black=0, energy=0, pairs=0;
  for(let i=0;i<alpha.length;i++){
    if(alpha[i]<.8 || pixels[4*i+3]!==255) continue;
    const r=pixels[4*i],g=pixels[4*i+1],b=pixels[4*i+2];
    const y=.2126*r+.7152*g+.0722*b;
    count++;sum+=y; if(y>=225)bright++;if(Math.max(r,g,b)>=251)clipped++;if(y<=5)black++;
    for(const j of [i%width!==width-1?i+1:-1,i+width]){
      if(j<0||j>=alpha.length||alpha[j]<.8||pixels[4*j+3]!==255)continue;
      const other=.2126*pixels[4*j]+.7152*pixels[4*j+1]+.0722*pixels[4*j+2];
      energy+=Math.abs(y-other);pairs++;
    }
  }
  return {count,texture:energy/Math.max(1,pairs),pairs,mean:sum/Math.max(1,count)/255,bright:bright/Math.max(1,count),clipped:clipped/Math.max(1,count),black:black/Math.max(1,count)};
}
/** Conservative individual tone and detail proposals, using the existing Natural Auto measurements.
 * Existing user masks are not altered or stacked over. Unknown capture ISO is not evidence of clean detail. */
export function proposeGroupSubjectAuto(source:Uint8ClampedArray,width:number,height:number,global:PhotoEdit,subjects:readonly Subject[],ids:readonly string[],highIso:boolean, observations?:readonly PhotographyObservation[], captureIso?:number):PhotoEdit {
  if(source.length!==width*height*4 || global.masks?.length || ids.length!==subjects.length || new Set(ids).size!==ids.length) return global;
  const alpha=regions(subjects,width,height);if(!alpha)return global;
  const preview=renderRecipePreview(source,width,height,global);
  const masks:Subject[]=[];
  for(let i=0;i<subjects.length;i++){
    const m=measure(preview,alpha[i],width);if(m.count<32)return global;
    const edit:LocalEdit={};
    if(m.bright>.1 && m.clipped>.01)edit.highlights=-.25;
    else if(!highIso && m.mean>.10 && m.mean<.30 && m.clipped<.005 && m.bright<.01 && m.black<.15)edit.exposure=.2;
    // Measure the actual prospective global look, not a separately invented sharpening score.
    // Natural Auto already distinguishes textured, smooth and noise-dominated blocks.
    // Do not sharpen if global detail settings are active or the subject is clipping.
    if(observations !== undefined && typeof captureIso==='number' && Number.isFinite(captureIso) && captureIso>0 && captureIso<1600 && !highIso && !global.sharpen && !global.texture && !global.clarity && !global.denoise &&
        m.pairs>=64 && m.texture>=2 && m.clipped<.005 && m.black<.05 && m.mean>=.25 && m.mean<=.8) {
      const assessment=naturalAuto({pixels:preview,width,height,segmentation:{grid:subjects[i].grid,confidence:'high'},
        photographyObservations:observations,iso:captureIso});
      if(assessment.scene.reference==='subject' && assessment.subjectEdit?.sharpen===.2) edit.sharpen=.1;
    }
    if(Object.keys(edit).length)masks.push({...subjects[i],id:ids[i],edit});
  }
  return masks.length?{...global,masks}:global;
}
/** A group candidate must pass global checks AND each detected subject's clipping/detail checks. */
export function groupSubjectSafe(source:Uint8ClampedArray,width:number,height:number,base:PhotoEdit,candidate:PhotoEdit,subjects:readonly Subject[]):boolean {
  if(!validDimensions(width,height)||source.length!==width*height*4||subjects.length<2||subjects.length>12||subjects.some(s=>!validSubject(s)||s.confidence==='low'))return false;
  const before=renderRecipePreview(source,width,height,base),after=renderRecipePreview(source,width,height,candidate);
  return subjects.every(s=>{
    const a=maskAlpha(s,width,height,fullContext(width,height));
    const b=measure(before,a,width), c=measure(after,a,width);
    return b.count>=32 && c.count===b.count && c.clipped<=b.clipped+.005 && c.black<=b.black+.005 &&
      (b.pairs<32||b.texture<2||c.texture>=b.texture*.85) &&
      (b.pairs<32||c.texture<=Math.max(b.texture*1.2,b.texture+1)) &&
      assessNaturalAuto(before,after,width,height,{grid:s.grid,confidence:s.confidence}).safe;
  });
}
