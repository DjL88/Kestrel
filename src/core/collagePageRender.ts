import { COLLAGE_FORMATS, type CollageDocument, type CollagePage } from './collage';
import { coverCrop } from './composition';
import { planCollagePrint, printSlotResolution, printResolutionMessage } from './collagePrint';
import { maxCanvasPixels } from './exportLimits';

export interface CollageImage { image: CanvasImageSource; width: number; height: number; release?: () => void }
export async function renderCollagePage(doc: CollageDocument, page: CollagePage, load: (id:string)=>Promise<CollageImage>, print=false, signal?: AbortSignal):Promise<HTMLCanvasElement>{
 const format=COLLAGE_FORMATS[doc.format];
 const plan=format.unit==='mm'?planCollagePrint(doc.format,300,print?3:0):null;
 if(print&&!plan) throw new Error('Choose a physical paper size for PDF.');
 const width=plan?.targetPixels.width??format.width, height=plan?.targetPixels.height??format.height;
 const limit=maxCanvasPixels({userAgent:navigator.userAgent,platform:navigator.platform,maxTouchPoints:navigator.maxTouchPoints});
 if(width*height>limit)throw new Error('Page is too large for this device. Try desktop or a smaller page.');
 const canvas=document.createElement('canvas');canvas.width=width;canvas.height=height;
 const ctx=canvas.getContext('2d');if(!ctx)throw new Error('Canvas unavailable');
 const bx=plan?width*plan.bleedMm/plan.mediaWidthMm:0,by=plan?height*plan.bleedMm/plan.mediaHeightMm:0;
 const tw=width-2*bx,th=height-2*by;
 ctx.fillStyle=page.background;ctx.fillRect(0,0,width,height);
 try{
 for(const slot of page.slots){
  signal?.throwIfAborted();
  if(!slot.photoId)continue;
  const source=await load(slot.photoId);
  try{
   signal?.throwIfAborted();
   const w=tw*Math.max(1,slot.width-page.gap)/100,h=th*Math.max(1,slot.height-page.gap)/100;
   if(print&&plan){
    const ppi=printSlotResolution(source,{width:w/tw*plan.trimWidthMm,height:h/th*plan.trimHeightMm});
    const warning=printResolutionMessage(ppi,300);if(warning)throw new Error(warning);
   }
   const x=bx+tw*(slot.x+page.gap/2)/100,y=by+th*(slot.y+page.gap/2)/100;
   const crop=coverCrop(source.width,source.height,w,h);
   ctx.save();
   try{
    ctx.translate(x+w/2,y+h/2);ctx.rotate(slot.angle*Math.PI/180);ctx.translate(-w/2,-h/2);
    ctx.beginPath();
    if(slot.clip){
     const points=slot.clip.slice(8,-1).split(',').map(pair=>pair.trim().split(/\s+/).map(value=>parseFloat(value)));
     points.forEach(([px,py],i)=>i?ctx.lineTo(px*w/100,py*h/100):ctx.moveTo(px*w/100,py*h/100));ctx.closePath();
    }else ctx.rect(0,0,w,h);
    ctx.clip();ctx.imageSmoothingQuality='high';ctx.drawImage(source.image,crop.x,crop.y,crop.width,crop.height);
   }finally{ctx.restore();}
  }finally{source.release?.();}
 }
 if(page.caption){
  signal?.throwIfAborted();
  await document.fonts?.ready;
  signal?.throwIfAborted();
  const px=tw*.025;ctx.font='600 '+px+'px sans-serif';ctx.textAlign='center';ctx.textBaseline='bottom';ctx.fillStyle=page.captionColour;
  const lines=page.caption.split(/\r?\n/).flatMap(line=>{
   const out:string[]=[];let part='';for(const ch of line){if(part&&ctx.measureText(part+ch).width>tw*.9){out.push(part);part='';}part+=ch;}out.push(part);return out;
  });
  if(lines.length*px*1.2>th*.8)throw new Error('Page caption is too long for this layout.');
  ctx.shadowColor='rgba(0,0,0,.5)';ctx.shadowBlur=Math.max(2,width*.003);
  lines.forEach((line,i)=>ctx.fillText(line,bx+tw/2,by+th*.97-(lines.length-1-i)*px*1.2));
  ctx.shadowBlur=0;
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
