import React from 'react';
import { COLLAGE_FORMATS, type CollageDocument } from '../../../core/collage';
import type { CollageExportRequest } from '../../engineClient/exportCollage';
interface Props { document: CollageDocument; onClose:()=>void; onExport?: (request:CollageExportRequest)=>Promise<void> }
export default function CollageExportDialog({document:doc,onClose,onExport}:Props){
 const paper=COLLAGE_FORMATS[doc.format].unit==='mm';
 const [format,setFormat]=React.useState<CollageExportRequest['format']>('jpeg');
 const [allPages,setAllPages]=React.useState(doc.pages.length>1);
 const [busy,setBusy]=React.useState(false);
 const [error,setError]=React.useState('');
 const closeRef=React.useRef<HTMLButtonElement>(null);
 React.useEffect(()=>{closeRef.current?.focus();},[]);
 return <div className="fixed inset-0 z-[90] flex items-center justify-center bg-black/60 p-4" onKeyDown={e=>{if(e.key==='Escape'&&!busy)onClose();}}>
  <section role="dialog" aria-modal="true" aria-labelledby="collage-export-title" className="w-full max-w-md max-h-[90dvh] overflow-y-auto rounded-xl bg-[var(--bg-surface)] p-5 text-[var(--text-primary)] space-y-4">
   <div className="flex justify-between items-center"><h2 id="collage-export-title" className="text-lg font-semibold">Export collage</h2><button ref={closeRef} type="button" disabled={busy} onClick={onClose}>Close</button></div>
   <p className="text-sm">{COLLAGE_FORMATS[doc.format].label}</p>
   <fieldset className="space-y-2" disabled={busy}><legend className="font-medium">Pages</legend>
    <label className="flex items-center gap-2 min-h-10"><input type="radio" name="collage-pages" checked={!allPages} onChange={()=>setAllPages(false)}/>Current page</label>
    <label className="flex items-center gap-2 min-h-10"><input type="radio" name="collage-pages" checked={allPages} onChange={()=>setAllPages(true)}/>All {doc.pages.length} pages</label>
   </fieldset>
   <label className="block font-medium">File format<select disabled={busy} className="block mt-2 w-full rounded border bg-[var(--bg-surface)] p-2" value={format} onChange={e=>setFormat(e.target.value as CollageExportRequest['format'])}><option value="jpeg">JPEG</option><option value="png">PNG</option>{paper&&<option value="pdf">Photo album PDF</option>}</select></label>
   <p className="text-sm text-[var(--text-secondary)]">{format==='pdf'?'RGB PDF, 300 DPI, 3 mm bleed. Not certified PDF/X.':allPages&&doc.pages.length>1?'Pages are numbered and delivered together in one ZIP file.':'One full-size image file.'} Connected, verified JPEG and PNG originals are currently supported. RAW and HEIF originals are not yet supported for collage export.</p>
   {error&&<p role="alert" className="text-sm">{error}</p>}
   {!onExport&&<p role="status">Export is unavailable in this workspace.</p>}
   <button type="button" className="w-full min-h-11 rounded bg-[var(--brand-accent)] font-semibold text-[var(--text-on-accent)] disabled:opacity-50" disabled={busy||!onExport||(format==='pdf'&&!paper)} onClick={async()=>{if(!onExport)return;setBusy(true);setError('');try{await onExport({format,allPages});onClose();}catch(reason){setError(reason instanceof Error?reason.message:'Export failed.');}finally{setBusy(false);}}}>{busy?'Preparing export…':'Export'}</button>
  </section>
 </div>;
}
