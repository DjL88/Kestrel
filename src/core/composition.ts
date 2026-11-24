/** Shared, non-destructive page composition geometry. All positions are page fractions. */
export type PageSize = { unit: 'px'; width: number; height: number } | { unit: 'mm'; width: number; height: number; dpi: number; bleed: number };
export interface CompositionSlot { id: string; photoId: string | null; x: number; y: number; width: number; height: number; angle: number; zoom: number; panX: number; panY: number }
export interface CompositionText { id: string; text: string; x: number; y: number; size: number; colour: string }
export interface CompositionPage { id: string; background: string; spacing: number; slots: CompositionSlot[]; text: CompositionText[] }
export interface Composition { version: 1; size: PageSize; pages: CompositionPage[] }
export type Layout = 'single' | 'diptych' | 'triptych' | 'hero' | 'grid' | 'angled';
type Rect = [number, number, number, number, number?];
const layouts: Record<Layout, Rect[]> = {
  single: [[0,0,1,1]],
  diptych: [[0,0,.5,1],[.5,0,.5,1]],
  triptych: [[0,0,1/3,1],[1/3,0,1/3,1],[2/3,0,1/3,1]],
  hero: [[0,0,.65,1],[.65,0,.35,.5],[.65,.5,.35,.5]],
  grid: [[0,0,.5,.5],[.5,0,.5,.5],[0,.5,.5,.5],[.5,.5,.5,.5]],
  angled: [[.06,.08,.52,.64,-7],[.44,.26,.5,.66,7],[.08,.67,.38,.27,-3]],
};
const clamp = (n: number, min: number, max: number) => Math.min(max, Math.max(min,n));
export function makePage(id: string, layout: Layout, photos: readonly string[] = []): CompositionPage {
  return { id, background: '#ffffff', spacing: .02, text: [], slots: layouts[layout].map(([x,y,width,height,angle],i)=>({
    id: id+'-slot-'+i, photoId: photos[i] ?? null, x,y,width,height,angle:angle??0,zoom:1,panX:0,panY:0,
  })) };
}
export function pagePixels(size: PageSize): { width: number; height: number; trimWidth: number; trimHeight: number; bleedPx: number } {
  if (![size.width,size.height].every(n=>Number.isFinite(n)&&n>0)) throw new Error('Invalid page dimensions');
  if (size.unit==='mm' && (!Number.isFinite(size.dpi)||size.dpi<72||size.dpi>1200||!Number.isFinite(size.bleed)||size.bleed<0||size.bleed>25)) throw new Error('Invalid print settings');
  const scale=size.unit==='mm'?size.dpi/25.4:1;
  const trimWidth=Math.round(size.width*scale),trimHeight=Math.round(size.height*scale);
  const bleedPx=size.unit==='mm'?Math.round(size.bleed*scale):0;
  const width=trimWidth+2*bleedPx,height=trimHeight+2*bleedPx;
  if(trimWidth<1||trimHeight<1||width>16384||height>16384||width*height>64_000_000) throw new Error('Page exceeds safe rendering dimensions');
  return {width,height,trimWidth,trimHeight,bleedPx};
}
export function addPage(doc: Composition, page: CompositionPage): Composition {
  if(doc.pages.some(p=>p.id===page.id)) throw new Error('Duplicate page identifier');
  return {...doc,pages:[...doc.pages,page]};
}
export function assignPhoto(page: CompositionPage, slotId: string, photoId: string|null): CompositionPage {
  if(!page.slots.some(s=>s.id===slotId)) throw new Error('Unknown frame');
  return {...page,slots:page.slots.map(s=>s.id===slotId?{...s,photoId,zoom:1,panX:0,panY:0}:s)};
}
/** Aspect-preserving cover crop shared by preview and export. Pan is -1..1 of available travel. */
export function coverCrop(sourceWidth:number,sourceHeight:number,width:number,height:number,zoom=1,panX=0,panY=0) {
  if(![sourceWidth,sourceHeight,width,height,zoom,panX,panY].every(Number.isFinite)||Math.min(sourceWidth,sourceHeight,width,height)<=0) throw new Error('Invalid image geometry');
  const scale=Math.max(width/sourceWidth,height/sourceHeight)*clamp(zoom,1,8);
  const w=sourceWidth*scale,h=sourceHeight*scale;
  const offset = (travel: number, pan: number) => pan <= -1 ? 0 : travel * (1 + clamp(pan, -1, 1)) / 2;
  return { x: offset(width - w, panX), y: offset(height - h, panY), width: w, height: h };
}
