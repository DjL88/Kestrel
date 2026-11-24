import {maskAlpha, fullContext} from './masks';
import type {Mask, LocalEdit} from './maskTypes';
import type {PhotoEdit} from './photoEdits';
import {renderRecipePreview, assessNaturalAuto} from './naturalAuto';
type Subject = Extract<Mask,{kind:'subject'}>;
function regions(subjects: readonly Subject[], width:number,height:number) {
  if(subjects.length<2 || subjects.length>12 || !Number.isSafeInteger(width) || !Number.isSafeInteger(height) || width<16 || height<16 || width*height>409600) return null;
  if(subjects.some(s=>s.confidence!=='high' || s.invert || s.strokes.length)) return null;
  const alpha=subjects.map(s=>maskAlpha(s,width,height,fullContext(width,height)));
  for(let i=0;i<width*height;i++){
    let count=0;
    for(const a of alpha) {if(!Number.isFinite(a[i])) return null; if(a[i]>.01) count++;}
    if(count>1) return null; // no overlapping automatic local edits
  }
  if(alpha.some(a=>a.reduce((n,v)=>n+(v>=.8?1:0),0)<Math.max(32,width*height*.005))) return null;
  return alpha;
}
function measure(pixels:Uint8ClampedArray,alpha:Float32Array){
  let count=0, sum=0, bright=0, clipped=0, black=0;
  for(let i=0;i<alpha.length;i++){
    if(alpha[i]<.8 || pixels[4*i+3]!==255) continue;
    const r=pixels[4*i],g=pixels[4*i+1],b=pixels[4*i+2];
    const y=.2126*r+.7152*g+.0722*b;
    count++;sum+=y; if(y>=225)bright++;if(Math.max(r,g,b)>=251)clipped++;if(y<=5)black++;
  }
  return {count,mean:sum/Math.max(1,count)/255,bright:bright/Math.max(1,count),clipped:clipped/Math.max(1,count),black:black/Math.max(1,count)};
}
/** Conservative tone-only proposal. Existing user masks are not altered or stacked over. */
export function proposeGroupSubjectAuto(source:Uint8ClampedArray,width:number,height:number,global:PhotoEdit,subjects:readonly Subject[],ids:readonly string[],highIso:boolean):PhotoEdit {
  if(source.length!==width*height*4 || global.masks?.length || ids.length!==subjects.length || new Set(ids).size!==ids.length) return global;
  const alpha=regions(subjects,width,height);if(!alpha)return global;
  const preview=renderRecipePreview(source,width,height,global);
  const masks:Subject[]=[];
  for(let i=0;i<subjects.length;i++){
    const m=measure(preview,alpha[i]);if(m.count<32)return global;
    const edit:LocalEdit={};
    if(m.bright>.1 && m.clipped>.01)edit.highlights=-.25;
    else if(!highIso && m.mean>.10 && m.mean<.30 && m.clipped<.005 && m.bright<.01 && m.black<.15)edit.exposure=.2;
    if(Object.keys(edit).length)masks.push({...subjects[i],id:ids[i],edit});
  }
  return masks.length?{...global,masks}:global;
}
/** A group candidate must pass global checks AND each detected subject's clipping/detail checks. */
export function groupSubjectSafe(source:Uint8ClampedArray,width:number,height:number,base:PhotoEdit,candidate:PhotoEdit,subjects:readonly Subject[]):boolean {
  if(source.length!==width*height*4)return false;
  const before=renderRecipePreview(source,width,height,base),after=renderRecipePreview(source,width,height,candidate);
  return subjects.every(s=>{
    const a=maskAlpha(s,width,height,fullContext(width,height));
    const b=measure(before,a), c=measure(after,a);
    return b.count>=32 && c.count===b.count && c.clipped<=b.clipped+.005 && c.black<=b.black+.005 &&
      assessNaturalAuto(before,after,width,height,{grid:s.grid,confidence:s.confidence}).safe;
  });
}
