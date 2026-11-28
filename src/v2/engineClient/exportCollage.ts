import { COLLAGE_FORMATS, collageExportPages, readCollage } from '../../core/collage';
import { renderCollagePage, encodeCollagePage, type CollageWindowDrawn } from '../../core/collagePageRender';
import { collageSocialSize, type CollageOutput } from '../../core/collageOutput';
import { collagePdf, type PdfRasterPage } from '../../core/collagePdf';
import { planCollagePrint } from '../../core/collagePrint';
import { applyCanvasExportEdit } from '../../core/canvasEdit';
import { applyFrameLayers } from '../../core/layerAssetVault';
import { DEFAULT_EDIT } from '../../core/photoEdits';
import { DEFAULT_FRAMING, drawFramedPhoto, framedSize, lensCentre } from '../../core/photoFraming';
import { fitScale, maxCanvasPixels } from '../../core/exportLimits';
import type { CullingState } from '../../core/types';
import type { BrowserPreviewProvider } from '../../providers/browserPreviewProvider';
import { archiveExports } from '../../providers/browserExport';
import { loadCollagePicture } from './collageSource';

export interface CollageExportRequest {
 format: 'jpeg' | 'png' | 'pdf'; allPages: boolean; range?: { first: number; last: number };
 /**
  * Collage export choices (a preview): the social scale or the print resolution. Present only with the preview on; it
  * also lets RAW photos be developed for their windows. Absent keeps the format's own size, 300 DPI and JPEG/PNG only.
  */
 output?: CollageOutput;
 /** The person saw which windows are enlarged or below the print resolution and chose to export anyway. */
 acceptLowResolution?: boolean;
}
/** A window as drawn in the exported file, with its 1-based page number. */
export type CollageExportedWindow = CollageWindowDrawn & { page: number };
export async function exportCollage(state:CullingState, provider:BrowserPreviewProvider, request:CollageExportRequest, signal?:AbortSignal, progress?:(done:number,total:number)=>void):Promise<{blob:Blob;name:string;windows:CollageExportedWindow[]}>{
 const doc=readCollage(state.shoot.collage);
 if(!doc)throw new Error('No valid collage is open.');
 const print=request.format==='pdf';
 const output=request.output&&(request.output.kind==='print')===print?request.output:undefined;
 const plan=print?planCollagePrint(doc.format,output?.kind==='print'?output.dpi:300):null;
 const windows:CollageExportedWindow[]=[];
 // A social format is measured in pixels, not physical print dimensions.
 // A print PDF must have a real paper size for its trim/bleed geometry.
 const paper=COLLAGE_FORMATS[doc.format].unit==='mm';
 if(print&&!paper)throw new Error('Choose an album paper size before exporting a print PDF.');
 if(!print&&paper)throw new Error('Choose a social canvas size for JPEG/PNG, or choose PDF for a printed album.');
 const pages = collageExportPages(doc, request.allPages, request.range);
 const files:File[]=[];const rasters:PdfRasterPage[]=[];
 const stem=state.shoot.title.replace(/[^a-zA-Z0-9_-]+/g,'-').replace(/^-+|-+$/g,'')||'collage';
 const limit=maxCanvasPixels({userAgent:navigator.userAgent,platform:navigator.platform,maxTouchPoints:navigator.maxTouchPoints});
 for(const page of pages){
  signal?.throwIfAborted();
  const canvas=await renderCollagePage(doc,page,async id=>{
   signal?.throwIfAborted();
   const frame=state.frames.find(f=>f.id===id&&f.removedAt==null);
   if(!frame)throw new Error('Reconnect or replace the missing photograph on this page.');
   // JPEG and PNG originals are verified against their fingerprint. With the collage export preview on, a RAW is developed
   // from its sensor data exactly as a single-photo export does; an embedded camera preview is never used (collageSource.ts).
   const image=await loadCollagePicture(frame,provider,signal,Boolean(output));
   const framing=frame.framing??DEFAULT_FRAMING;
   const size=framedSize(image.naturalWidth,image.naturalHeight,framing);
   // A 45 MP source is allowed on a device with a smaller canvas limit:
   // it is genuinely decoded, then downsampled for the required composition.
   // The print renderer subsequently checks the *actual* developed pixel count.
   const scaledForDevice=fitScale(size.width,size.height,limit);
   const social=!print&&output?.kind==='social'?collageSocialSize(doc.format,output.scale):COLLAGE_FORMATS[doc.format];
   const longestEdge=print?Infinity:Math.max(social.width,social.height);
   const scale=Math.min(scaledForDevice,print?1:Math.min(1,longestEdge*1.5/Math.max(size.width,size.height)));
   const picture=document.createElement('canvas');
   try{
    drawFramedPhoto(image,picture,framing,{scale,colourSpace:'srgb'});
    await applyCanvasExportEdit(picture,frame.edit??DEFAULT_EDIT,signal,
      Math.max(size.width,size.height)*scale,{aspect:size.height/size.width,view:{x:0,y:0,w:1,h:1},lensCentre:lensCentre(image.naturalWidth,image.naturalHeight,framing)});
    await applyFrameLayers(picture,frame.overlay,true,frame.edit?.masks);
    return {image:picture,width:picture.width,height:picture.height,release:()=>{picture.width=0;picture.height=0;}};
   }catch(error){picture.width=0;picture.height=0;throw error;}
  },print,output?{output,acceptLowResolution:request.acceptLowResolution,onWindow:drawn=>windows.push({...drawn,page:doc.pages.indexOf(page)+1})}:{});
  try{
   const blob=await encodeCollagePage(canvas,request.format==='png'?'png':'jpeg');
   signal?.throwIfAborted();
   if(print)rasters.push({jpeg:blob,width:canvas.width,height:canvas.height});
   else files.push(new File([blob],stem+'-page-'+String(doc.pages.indexOf(page)+1).padStart(3,'0')+'.'+(request.format==='png'?'png':'jpg'),{type:blob.type}));
  }finally{canvas.width=0;canvas.height=0;}
  progress?.(print?rasters.length:files.length,pages.length);
 }
 const selectionName = request.range ? stem + '-pages-' + request.range.first + '-' + request.range.last : stem;
 if(plan)return {blob:collagePdf(rasters,plan),name:selectionName+'.pdf',windows};
 if(files.length===1)return {blob:files[0],name:files[0].name,windows};
 return {blob:await archiveExports(files),name:request.range ? selectionName+'.zip' : stem+'-pages.zip',windows};
}
