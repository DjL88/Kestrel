import React from 'react';
import type { Photo, PhotoSurfaceProps, Project } from '../contract';
import type { CollageDocument, CollageFormat, CollageTemplate } from '../../../core/collage';
import { addCollagePage, changeCollageTemplate, collagePage, COLLAGE_FORMATS, COLLAGE_TEMPLATES, deleteCollagePage, duplicateCollagePage, modifyCollagePage, replaceCollagePhoto } from '../../../core/collage';

interface Props {
  document: CollageDocument;
  photos: Photo[];
  projects: Project[];
  onBrowseProject?: (projectId: string) => Promise<Array<{ id: string; filename: string }>>;
  onAddFromProject?: (projectId: string, photoIds: string[]) => Promise<void>;
  PhotoSurface?: React.ComponentType<PhotoSurfaceProps>;
  onChange: (document: CollageDocument) => void;
  onEditPhoto: (photoId: string) => void;
  onImport: () => void;
  onExportPages?: (output: 'jpeg' | 'png' | 'pdf') => void;
}
const field = 'rounded border border-[var(--border-default)] bg-[var(--bg-surface)] px-2 py-2 text-sm text-[var(--text-primary)]';
export default function CollageEditor({ document: doc, photos, projects, onBrowseProject, onAddFromProject, PhotoSurface, onChange, onEditPhoto, onImport, onExportPages }: Props) {
  const page = collagePage(doc);
  const format = COLLAGE_FORMATS[doc.format];
  const aspect = format.width / format.height;
  const [activeSlot, setActiveSlot] = React.useState<string | null>(null);
  const [showLayouts, setShowLayouts] = React.useState(false);
  const [sourceProject, setSourceProject] = React.useState('');
  const [sourcePhotos, setSourcePhotos] = React.useState<Array<{ id: string; filename: string }>>([]);
  const [sourceSelection, setSourceSelection] = React.useState<string[]>([]);
  const [sourceSearch, setSourceSearch] = React.useState('');
  const [sourceLoading, setSourceLoading] = React.useState(false);
  const [showExport, setShowExport] = React.useState(false);
  const [socialFormat, setSocialFormat] = React.useState<'jpeg' | 'png'>('jpeg');
  const slot = page.slots.find((item) => item.id === activeSlot) ?? page.slots[0];
  const photo = photos.find((item) => item.id === slot?.photoId);
  const setPage = (patch: Parameters<typeof modifyCollagePage>[1]) => onChange(modifyCollagePage(doc, patch));
  const printing = format.unit === 'mm';
  return (
    <section className="flex min-h-0 flex-1 flex-col overflow-hidden bg-[var(--bg-app)]" aria-label="Collage page editor">
      <div className="flex shrink-0 flex-wrap items-center gap-2 border-b border-[var(--border-subtle)] bg-[var(--bg-surface)] p-2 sm:px-4">
        <span className="mr-2 text-sm font-semibold text-[var(--text-primary)]">Pages</span>
        <div role="tablist" aria-label="Collage pages" className="flex max-w-full gap-1 overflow-x-auto">
          {doc.pages.map((item, i) => (
            <button key={item.id} type="button" role="tab" aria-selected={item.id === page.id}
              onClick={() => { onChange({ ...doc, activePageId: item.id }); setActiveSlot(null); }}
              className={`min-h-10 shrink-0 rounded px-3 text-sm ${item.id === page.id ? 'bg-[var(--brand-accent)] text-[var(--text-on-accent)]' : 'border border-[var(--border-default)] text-[var(--text-primary)]'}`}>
              {i + 1}
            </button>
          ))}
        </div>
        <button type="button" className={field} onClick={() => { onChange(addCollagePage(doc, page.template)); setActiveSlot(null); }}>+ Page</button>
        <button type="button" className={field} onClick={() => onChange(duplicateCollagePage(doc))}>Duplicate page</button>
        {onExportPages && <button type="button" className="min-h-10 rounded bg-[var(--brand-accent)] px-3 text-sm font-semibold text-[var(--text-on-accent)]" onClick={() => setShowExport((wasOpen) => !wasOpen)} aria-expanded={showExport}>Export pages</button>}
        <button type="button" className={field} disabled={doc.pages.length === 1} onClick={() => { onChange(deleteCollagePage(doc)); setActiveSlot(null); }}
          aria-label="Delete current page">Delete page</button>
      </div>
      <div className="flex min-h-0 flex-1 flex-col overflow-hidden lg:flex-row">
        <div className="flex min-h-[200px] min-w-0 flex-1 items-center justify-center overflow-auto p-3 sm:p-8" data-testid="collage-stage">
          <div className="relative shrink-0 overflow-hidden shadow-xl" style={{ width: aspect > 1 ? 'min(80vw, 720px)' : 'min(65vw, 500px)',
            maxHeight: '100%', aspectRatio: String(aspect), background: page.background }} aria-label={`Page ${doc.pages.indexOf(page) + 1} of ${doc.pages.length}`}>
            {page.slots.map((item) => {
              const source = photos.find((candidate) => candidate.id === item.photoId);
              const gap = page.gap / 2;
              return (
                <button type="button" key={item.id} aria-label={source ? `Choose photo for ${source.filename}` : 'Choose a photo for this collage slot'}
                  aria-pressed={item.id === activeSlot} onClick={() => setActiveSlot(item.id)}
                  className={`absolute overflow-hidden bg-black/10 outline-offset-2 focus-visible:outline-2 focus-visible:outline-[var(--brand-accent)] ${activeSlot === item.id ? 'ring-2 ring-[var(--brand-accent)]' : ''}`}
                  style={{ left: `${item.x + gap}%`, top: `${item.y + gap}%`, width: `${Math.max(1,item.width - gap * 2)}%`,
                    height: `${Math.max(1,item.height - gap * 2)}%`, transform: `rotate(${item.angle}deg)`,
                    clipPath: item.clip, zIndex: activeSlot === item.id ? 2 : 1 }}>
                  {source ? (PhotoSurface
                    ? <PhotoSurface photoId={source.id} variant="edited" alt={source.filename} className="h-full w-full" />
                    : <img src={source.previewUrl} alt={source.filename} className="h-full w-full object-cover" />)
                    : <span className="flex h-full items-center justify-center text-2xl text-[var(--text-secondary)]">+</span>}
                </button>
              );
            })}
            {page.caption && <div className="pointer-events-none absolute inset-x-[5%] bottom-[3%] z-10 whitespace-pre-wrap break-words text-center font-semibold"
              style={{ color: page.captionColour, fontSize: 'clamp(9px, 2cqw, 22px)', textShadow: '0 1px 4px #0008' }}>{page.caption}</div>}
          </div>
        </div>
        <aside className="max-h-[40dvh] w-full shrink-0 space-y-4 overflow-y-auto border-t border-[var(--border-subtle)] bg-[var(--bg-surface)] p-3 lg:max-h-none lg:w-[270px] lg:border-l lg:border-t-0" aria-label="Collage tools">
          <div className="flex items-center justify-between"><strong className="text-sm">Page design</strong>
            <button type="button" className={field} onClick={() => setShowLayouts(!showLayouts)} aria-expanded={showLayouts}>Layouts</button>
          </div>
          {showLayouts && <div className="grid grid-cols-2 gap-2" aria-label="Collage layout templates">
            {COLLAGE_TEMPLATES.map((template) => <button type="button" key={template.id} onClick={() => { onChange(changeCollageTemplate(doc, template.id as CollageTemplate)); setActiveSlot(null); }}
              aria-pressed={page.template === template.id}
              className={`min-h-11 rounded border px-2 text-left text-xs ${page.template === template.id ? 'border-[var(--brand-accent)]' : 'border-[var(--border-default)]'}`}>{template.label} · {template.slots}</button>)}
          </div>}
          <label className="block text-xs font-medium">Output size
            <select className={`mt-1 w-full ${field}`} value={doc.format} onChange={(e) => onChange({ ...doc, format: e.target.value as CollageFormat })}>
              {Object.entries(COLLAGE_FORMATS).map(([key, opt]) => <option key={key} value={key}>{opt.label}</option>)}
            </select>
          </label>
          <label className="flex items-center justify-between gap-3 text-xs font-medium">Background colour
            <input type="color" aria-label="Page background colour" value={page.background} onChange={(e) => setPage({ background: e.target.value })} className="h-10 w-14 cursor-pointer" />
          </label>
          <label className="block text-xs font-medium">Space between photographs · {page.gap.toFixed(1)}%
            <input type="range" min="0" max="12" step="0.5" value={page.gap} onChange={(e) => setPage({ gap: Number(e.target.value) })}
              className="mt-1 w-full" aria-label="Collage photo spacing" />
          </label>
          <label className="block text-xs font-medium">Page text
            <textarea className={`mt-1 min-h-16 w-full resize-y ${field}`} value={page.caption}
              maxLength={1000} placeholder="Add your own heading or caption" onChange={(e) => setPage({ caption: e.target.value })}/>
          </label>
          <label className="flex items-center justify-between text-xs font-medium">Text colour
            <input type="color" value={page.captionColour} onChange={(e) => setPage({ captionColour: e.target.value })} className="h-10 w-14" />
          </label>
          <div className="space-y-2 border-t border-[var(--border-default)] pt-3">
            <strong className="text-sm">Selected window</strong>
            <label className="block text-xs">Photograph
              <select className={`mt-1 w-full ${field}`} value={slot?.photoId ?? ''} onChange={(e) => slot && onChange(replaceCollagePhoto(doc, slot.id, e.target.value || null))}>
                <option value="">Empty window</option>
                {photos.map((p) => <option key={p.id} value={p.id}>{p.filename}</option>)}
              </select>
            </label>
            {photo && <button type="button" className={`w-full ${field}`} onClick={() => onEditPhoto(photo.id)}>Edit this photograph</button>}
            <button type="button" className={`w-full ${field}`} onClick={onImport}>Import more photos</button>
            {onBrowseProject && onAddFromProject && projects.length > 0 && <button type="button" className={`w-full ${field}`}
              onClick={() => setSourceProject(projects[0].id)}>Choose from another project</button>}
            <p className="text-xs text-[var(--text-muted)]">A photograph can be used in several windows and on different pages. Edits update every appearance without changing the original.</p>
          </div>
          {showExport && onExportPages && <div className="space-y-3 rounded border border-[var(--border-default)] p-3" aria-label="Page export settings">
            <strong className="text-sm">{printing ? 'Print album' : 'Social pages'}</strong>
            {!printing && <label className="block text-xs">Image format
              <select value={socialFormat} onChange={(e) => setSocialFormat(e.target.value as 'jpeg' | 'png')}
                className={`mt-1 w-full ${field}`}><option value="jpeg">JPEG · high quality</option><option value="png">PNG · lossless</option></select>
            </label>}
            <p className="text-xs text-[var(--text-secondary)]">
              {printing ? '300 PPI RGB photo-lab PDF with 3 mm bleed and exact trim boxes. Export stops if any source cannot supply genuine print resolution. Not PDF/X or CMYK.' :
                `${doc.pages.length} page${doc.pages.length === 1 ? '' : 's'} at ${format.width} × ${format.height} pixels. Multiple pages download together as a ZIP.`}
            </p>
            <button type="button" onClick={() => onExportPages(printing ? 'pdf' : socialFormat)}
              className="min-h-11 w-full rounded bg-[var(--brand-accent)] px-3 text-sm font-semibold text-[var(--text-on-accent)]">
              {printing ? 'Export print PDF' : `Export ${doc.pages.length} ${socialFormat.toUpperCase()} page${doc.pages.length === 1 ? '' : 's'}`}
            </button>
          </div>}
          <p className="border-t border-[var(--border-default)] pt-3 text-xs text-[var(--text-secondary)]">
            {printing ? 'Original files are never changed. Print output includes page bleed; confirm your lab’s PDF colour requirements.' :
              'Exports use the actual edited photograph data rather than a screenshot of the preview.'}
          </p>
        </aside>
      </div>
      {sourceProject && onBrowseProject && onAddFromProject && <div role="dialog" aria-modal="true" aria-label="Choose photographs from another project"
        className="fixed inset-0 z-[80] flex items-center justify-center bg-black/60 p-3">
        <div className="flex max-h-[85dvh] w-full max-w-xl flex-col gap-3 rounded-xl bg-[var(--bg-surface)] p-4 text-[var(--text-primary)]">
          <div className="flex items-center justify-between"><strong>Choose existing photographs</strong>
            <button type="button" onClick={() => {setSourceProject(''); setSourcePhotos([]); setSourceSelection([]);}} className={field}>Close</button>
          </div>
          <label className="text-sm">Source project
            <select className={`mt-1 w-full ${field}`} value={sourceProject} onChange={(e) => {
              setSourceProject(e.target.value); setSourcePhotos([]); setSourceSelection([]);
            }}>{projects.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}</select>
          </label>
          <button type="button" className={field} disabled={sourceLoading} onClick={async () => {
            setSourceLoading(true);
            try { setSourcePhotos(await onBrowseProject(sourceProject)); setSourceSelection([]); }
            catch { setSourcePhotos([]); }
            finally { setSourceLoading(false); }
          }}>{sourceLoading ? 'Reading photographs…' : 'Browse photographs'}</button>
          {sourcePhotos.length > 0 && <>
            <input className={field} type="search" placeholder="Search filenames" aria-label="Search source photographs"
              value={sourceSearch} onChange={(e) => setSourceSearch(e.target.value)}/>
            <div className="min-h-0 flex-1 space-y-1 overflow-auto" role="group" aria-label="Available photographs">
              {sourcePhotos.filter((p) => p.filename.toLowerCase().includes(sourceSearch.toLowerCase())).map((item) => (
                <label key={item.id} className="flex min-h-10 items-center gap-3 border-b border-[var(--border-subtle)] py-1 text-sm">
                  <input type="checkbox" checked={sourceSelection.includes(item.id)} onChange={(e) => setSourceSelection((prev) =>
                    e.target.checked ? [...prev, item.id] : prev.filter((id) => id !== item.id))}/>
                  <span className="truncate">{item.filename}</span>
                </label>
              ))}
            </div>
          </>}
          <button type="button" className="min-h-11 rounded bg-[var(--brand-accent)] px-4 font-semibold text-[var(--text-on-accent)]"
            disabled={!sourceSelection.length || sourceLoading} onClick={async () => {
              setSourceLoading(true);
              try { await onAddFromProject(sourceProject, sourceSelection); setSourceProject(''); setSourcePhotos([]); setSourceSelection([]); }
              finally { setSourceLoading(false); }
            }}>Add {sourceSelection.length} to collage library</button>
          <p className="text-xs text-[var(--text-secondary)]">These photographs are referenced in this collage; the original project is not moved or changed.</p>
        </div>
      </div>}
    </section>
  );
}
