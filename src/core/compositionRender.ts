import { pagePixels, coverCrop, type CompositionPage, type PageSize } from './composition';

/** The caller supplies fully developed source pixels, never an unlabelled thumbnail. */
export interface DevelopedImage { image: CanvasImageSource; width: number; height: number }
export async function renderCompositionPage(page: CompositionPage, size: PageSize, load: (photoId: string)=>Promise<DevelopedImage>): Promise<HTMLCanvasElement> {
  const dims=pagePixels(size);
  const canvas=document.createElement('canvas'); canvas.width=dims.width; canvas.height=dims.height;
  const ctx=canvas.getContext('2d'); if(!ctx) throw new Error('Canvas unavailable');
  ctx.fillStyle=page.background;ctx.fillRect(0,0,canvas.width,canvas.height);
  const cache=new Map<string,DevelopedImage>();
  for(const slot of page.slots) {
    if(!slot.photoId) continue;
    let source=cache.get(slot.photoId);
    if(!source){source=await load(slot.photoId);cache.set(slot.photoId,source);}
    const gap=Math.max(0,Math.min(.1,page.spacing))*Math.min(dims.trimWidth,dims.trimHeight);
    const w=slot.width*dims.trimWidth-gap,h=slot.height*dims.trimHeight-gap;
    if(w<=0||h<=0) throw new Error('Spacing leaves no room for a photograph');
    const x=dims.bleedPx+slot.x*dims.trimWidth+gap/2,y=dims.bleedPx+slot.y*dims.trimHeight+gap/2;
    const crop=coverCrop(source.width,source.height,w,h,slot.zoom,slot.panX,slot.panY);
    ctx.save();
    try{
      ctx.translate(x+w/2,y+h/2);ctx.rotate(slot.angle*Math.PI/180);ctx.translate(-w/2,-h/2);
      ctx.beginPath();ctx.rect(0,0,w,h);ctx.clip();
      ctx.drawImage(source.image,crop.x,crop.y,crop.width,crop.height);
    }finally{ctx.restore();}
  }
  for(const label of page.text){
    ctx.fillStyle=label.colour;
    ctx.font=Math.max(1,label.size*dims.trimWidth)+'px sans-serif';
    ctx.textBaseline='top';
    const x=dims.bleedPx+label.x*dims.trimWidth,y=dims.bleedPx+label.y*dims.trimHeight;
    label.text.split('\n').forEach((line,i)=>ctx.fillText(line,x,y+i*label.size*dims.trimWidth*1.2));
  }
  return canvas;
}
export function encodeCompositionPage(canvas:HTMLCanvasElement,format:'png'|'jpeg',quality=.95):Promise<Blob>{
  return new Promise((resolve,reject)=>canvas.toBlob(blob=>blob?resolve(blob):reject(new Error('Could not encode page')),'image/'+format,quality));
}
