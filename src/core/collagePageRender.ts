import { collageCaptionGeometry, COLLAGE_FORMATS, type CollageDocument, type CollagePage } from './collage';
import { coverCrop } from './composition';
import { planCollagePrint, printSlotResolution, printResolutionMessage } from './collagePrint';
import { maxCanvasPixels } from './exportLimits';
import { collageSocialSize, measureWindow, type CollageOutput } from './collageOutput';

export interface CollageImage { image: CanvasImageSource; width: number; height: number; release?: () => void }
/** One window as it was actually drawn: its genuine pixels per inch (album) or how much it was enlarged (social). */
export interface CollageWindowDrawn { window: number; photoId: string; sourcePx: { width: number; height: number }; enlargement: number | null; ppi: number | null; low: boolean }
export interface CollageRenderOptions {
 /** Export size: a social scale, or a print resolution. Absent keeps the format's own size and 300 DPI. */
 output?: CollageOutput;
 /** The person saw the low-resolution windows and chose to export anyway: a print window below the DPI no longer stops the page. */
 acceptLowResolution?: boolean;
 /** Told about every window drawn, so the export can say which were enlarged or below the print resolution. */
 onWindow?: (drawn: CollageWindowDrawn) => void;
}
export async function renderCollagePage(doc: CollageDocument, page: CollagePage, load: (id:string)=>Promise<CollageImage>, print=false, options:CollageRenderOptions={}):Promise<HTMLCanvasElement>{
 const format=COLLAGE_FORMATS[doc.format];
 const dpi=options.output?.kind==='print'?options.output.dpi:300;
 const plan=format.unit==='mm'?planCollagePrint(doc.format,dpi,print?3:0):null;
 if(print&&!plan) throw new Error('Choose a physical paper size for PDF.');
 const social=!plan&&options.output?.kind==='social'?collageSocialSize(doc.format,options.output.scale):null;
 const width=plan?.targetPixels.width??social?.width??format.width, height=plan?.targetPixels.height??social?.height??format.height;
 const limit=maxCanvasPixels({userAgent:navigator.userAgent,platform:navigator.platform,maxTouchPoints:navigator.maxTouchPoints});
 if(width*height>limit)throw new Error('Page is too large for this device. Try desktop or a smaller page.');
 const canvas=document.createElement('canvas');canvas.width=width;canvas.height=height;
 const ctx=canvas.getContext('2d');if(!ctx)throw new Error('Canvas unavailable');
 const bx=plan?width*plan.bleedMm/plan.mediaWidthMm:0,by=plan?height*plan.bleedMm/plan.mediaHeightMm:0;
 const tw=width-2*bx,th=height-2*by;
 const output=options.output;
 const report=(window:number,photoId:string,source:CollageImage,windowPx:{width:number;height:number},zoom:number)=>{
  if(!output)return;
  const sourcePx={width:source.width,height:source.height};
  const measured=measureWindow(sourcePx,windowPx,zoom,output,plan?{width:plan.trimWidthMm,height:plan.trimHeightMm}:undefined,{width:tw,height:th});
  options.onWindow?.({window,photoId,sourcePx,...measured});
 };
 ctx.fillStyle=page.background;ctx.fillRect(0,0,width,height);
 try{
 if(page.backgroundPhotoId){
  // A background photograph covers the whole page, bleed included, behind the windows.
  const source=await load(page.backgroundPhotoId);
  try{
   if(options.output)report(0,page.backgroundPhotoId,source,{width,height},1);
   const cover=coverCrop(source.width,source.height,width,height);
   ctx.save();ctx.imageSmoothingQuality='high';ctx.drawImage(source.image,cover.x,cover.y,cover.width,cover.height);ctx.restore();
  }finally{source.release?.();}
 }
 for(const slot of page.slots){
  if(!slot.photoId)continue;
  const source=await load(slot.photoId);
  try{
   const w=tw*Math.max(1,slot.width-page.gap)/100,h=th*Math.max(1,slot.height-page.gap)/100;
   if(print&&plan){
    const ppi=printSlotResolution(source,{width:w/tw*plan.trimWidthMm,height:h/th*plan.trimHeightMm})/(options.output?Math.max(1,slot.zoom??1):1);
    const warning=printResolutionMessage(ppi,dpi);if(warning&&!options.acceptLowResolution)throw new Error(warning);
   }
   if(options.output)report(page.slots.indexOf(slot)+1,slot.photoId,source,{width:w,height:h},slot.zoom??1);
   const x=bx+tw*(slot.x+page.gap/2)/100,y=by+th*(slot.y+page.gap/2)/100;
   // The window's framing (zoom and position); the editor previews the same geometry (collageSlotPlacement).
   const crop=coverCrop(source.width,source.height,w,h,slot.zoom??1,slot.panX??0,slot.panY??0);
   ctx.save();
   try{
    ctx.translate(x+w/2,y+h/2);ctx.rotate(slot.angle*Math.PI/180);ctx.translate(-w/2,-h/2);
    ctx.beginPath();
    if(slot.clip){
     const points=slot.clip.slice(8,-1).split(',').map(pair=>pair.trim().split(/\s+/).map(parseFloat));
     points.forEach(([px,py],i)=>i?ctx.lineTo(px*w/100,py*h/100):ctx.moveTo(px*w/100,py*h/100));ctx.closePath();
    }else ctx.rect(0,0,w,h);
    ctx.clip();ctx.imageSmoothingQuality='high';ctx.drawImage(source.image,crop.x,crop.y,crop.width,crop.height);
   }finally{ctx.restore();}
  }finally{source.release?.();}
 }
 if(page.caption){
  const g=collageCaptionGeometry(tw,th,page.captionStyle);const px=g.fontPx;ctx.font='600 '+px+'px '+g.font;ctx.textAlign='center';ctx.textBaseline='bottom';ctx.fillStyle=page.captionColour;
  const lines=page.caption.split('\n').flatMap(line=>{
   const out:string[]=[];let part='';for(const ch of line){if(part&&ctx.measureText(part+ch).width>g.width){out.push(part);part='';}part+=ch;}out.push(part);return out;
  });
  const lineHeight=px*g.lineHeight, blockHeight=lines.length*lineHeight;
  if(blockHeight>g.height)throw new Error('Page caption is too long for this layout.');
  const top=by+g.y+(g.height-blockHeight)*g.position/100;
  lines.forEach((line,i)=>ctx.fillText(line,bx+g.x+g.width/2,top+(i+1)*lineHeight));
 }
 return canvas;
 }catch(error){canvas.width=0;canvas.height=0;throw error;}
}
export async function encodeCollagePage(canvas:HTMLCanvasElement,format:'jpeg'|'png'):Promise<Blob>{
 const mime='image/'+format;
 const blob=await new Promise<Blob|null>(resolve=>canvas.toBlob(resolve,mime,.96));
 if(!blob||blob.type!==mime||!blob.size)throw new Error('Page encoding failed.');
 return blob;
}
