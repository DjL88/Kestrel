import { collagePage, readCollage } from '../../core/collage';
import { renderCollagePage, encodeCollagePage } from '../../core/collagePageRender';
import { collagePdf, type PdfRasterPage } from '../../core/collagePdf';
import { planCollagePrint } from '../../core/collagePrint';
import { applyCanvasExportEdit } from '../../core/canvasEdit';
import { DEFAULT_EDIT } from '../../core/photoEdits';
import { DEFAULT_FRAMING, drawFramedPhoto, framedSize } from '../../core/photoFraming';
import { maxCanvasPixels } from '../../core/exportLimits';
import type { CullingState } from '../../core/types';
import type { BrowserPreviewProvider } from '../../providers/browserPreviewProvider';
import { archiveExports, loadVerifiedRasterOriginalForExport } from '../../providers/browserExport';

export interface CollageExportRequest { format: 'jpeg' | 'png' | 'pdf'; allPages: boolean }
export async function exportCollage(state:CullingState, provider:BrowserPreviewProvider, request:CollageExportRequest, signal?:AbortSignal, progress?:(done:number,total:number)=>void):Promise<{blob:Blob;name:string}>{
 const doc=readCollage(state.shoot.collage);
 if(!doc)throw new Error('No valid collage is open.');
 const print=request.format==='pdf';
 const plan=print?planCollagePrint(doc.format):null;
 const pages=request.allPages?doc.pages:[collagePage(doc)];
 const files:File[]=[];const rasters:PdfRasterPage[]=[];
 const stem=state.shoot.title.replace(/[^a-zA-Z0-9_-]+/g,'-').replace(/^-+|-+$/g,'')||'collage';
 const limit=maxCanvasPixels({userAgent:navigator.userAgent,platform:navigator.platform,maxTouchPoints:navigator.maxTouchPoints});
 for(const page of pages){
  signal?.throwIfAborted();
  const canvas=await renderCollagePage(doc,page,async id=>{
   signal?.throwIfAborted();
   const frame=state.frames.find(f=>f.id===id&&f.removedAt==null);
   if(!frame)throw new Error('Reconnect or replace the missing photograph on this page.');
   // Deliberately refuse unverified RAW/HEIF previews until the full-resolution decoder contract is available.
   const image=await loadVerifiedRasterOriginalForExport(frame,provider,signal);
   const framing=frame.framing??DEFAULT_FRAMING;
   const size=framedSize(image.naturalWidth,image.naturalHeight,framing);
   if(size.width*size.height>limit)throw new Error('This original is too large to develop safely on this device. Use desktop.');
   const picture=document.createElement('canvas');
   try{
    drawFramedPhoto(image,picture,framing);
    await applyCanvasExportEdit(picture,frame.edit??DEFAULT_EDIT,signal);
    return {image:picture,width:picture.width,height:picture.height,release:()=>{picture.width=0;picture.height=0;}};
   }catch(error){picture.width=0;picture.height=0;throw error;}
  },print);
  try{
   const blob=await encodeCollagePage(canvas,request.format==='png'?'png':'jpeg');
   signal?.throwIfAborted();
   if(print)rasters.push({jpeg:blob,width:canvas.width,height:canvas.height});
   else files.push(new File([blob],stem+'-page-'+String(doc.pages.indexOf(page)+1).padStart(3,'0')+'.'+(request.format==='png'?'png':'jpg'),{type:blob.type}));
  }finally{canvas.width=0;canvas.height=0;}
  progress?.(print?rasters.length:files.length,pages.length);
 }
 if(plan)return {blob:collagePdf(rasters,plan),name:stem+'.pdf'};
 if(files.length===1)return {blob:files[0],name:files[0].name};
 return {blob:await archiveExports(files),name:stem+'-pages.zip'};
}
