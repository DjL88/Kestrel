import { STRINGS } from '../strings';
import React from 'react';
import type { Photo, PhotoSurfaceProps, Project } from '../contract';
import type { CollageDocument, CollageFormat, CollageTemplate } from '../../../core/collage';
import { addCollagePage, canChangeCollageTemplate, MAX_COLLAGE_PAGES, changeCollageTemplate, collagePage, COLLAGE_FORMATS, COLLAGE_TEMPLATES, deleteCollagePage, duplicateCollagePage, modifyCollagePage, replaceCollagePhoto } from '../../../core/collage';

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
}
const field = 'rounded border border-[var(--border-default)] bg-[var(--bg-surface)] px-2 py-2 text-sm text-[var(--text-primary)]';
export default function CollageEditor({ document: doc, photos, projects, onBrowseProject, onAddFromProject, PhotoSurface, onChange, onEditPhoto, onImport }: Props) {
  const page = collagePage(doc);
  const format = COLLAGE_FORMATS[doc.format];
  const aspect = format.width / format.height;
  const [activeSlot, setActiveSlot] = React.useState<string | null>(null);
  const [showLayouts, setShowLayouts] = React.useState(false);
  const [sourceProject, setSourceProject] = React.useState('');
  const slot = page.slots.find((item) => item.id === activeSlot) ?? page.slots[0];
  const photo = photos.find((item) => item.id === slot?.photoId);
  const setPage = (patch: Parameters<typeof modifyCollagePage>[1]) => onChange(modifyCollagePage(doc, patch));
  const printing = format.unit === 'mm';
  return (
    <section className="flex min-h-0 flex-1 flex-col overflow-hidden bg-[var(--bg-app)]" aria-label={STRINGS.collage.collagePageEditor}>
      <div className="flex shrink-0 flex-wrap items-center gap-2 border-b border-[var(--border-subtle)] bg-[var(--bg-surface)] p-2 sm:px-4">
        <span className="mr-2 text-sm font-semibold text-[var(--text-primary)]">{STRINGS.collage.pages}</span>
        <div role="tablist" aria-label={STRINGS.collage.collagePages} className="flex max-w-full gap-1 overflow-x-auto">
          {doc.pages.map((item, i) => (
            <button key={item.id} type="button" role="tab" aria-selected={item.id === page.id}
              onClick={() => { onChange({ ...doc, activePageId: item.id }); setActiveSlot(null); }}
              className={`min-h-10 shrink-0 rounded px-3 text-sm ${item.id === page.id ? 'bg-[var(--brand-accent)] text-[var(--text-on-accent)]' : 'border border-[var(--border-default)] text-[var(--text-primary)]'}`}>
              {i + 1}
            </button>
          ))}
        </div>
        <button type="button" className={field} disabled={doc.pages.length >= MAX_COLLAGE_PAGES} onClick={() => { onChange(addCollagePage(doc, page.template)); setActiveSlot(null); }}>{STRINGS.collage.page}</button>
        <button type="button" className={field} disabled={doc.pages.length >= MAX_COLLAGE_PAGES} onClick={() => onChange(duplicateCollagePage(doc))}>{STRINGS.collage.duplicatePage}</button>
        <button type="button" className={field} disabled={doc.pages.length === 1} onClick={() => { onChange(deleteCollagePage(doc)); setActiveSlot(null); }}
          aria-label={STRINGS.collage.deleteCurrentPage}>{STRINGS.collage.deletePage}</button>
        {doc.pages.length >= MAX_COLLAGE_PAGES && <span role="status">{STRINGS.collage.pageLimit(MAX_COLLAGE_PAGES)}</span>}
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
        <aside className="max-h-[40dvh] w-full shrink-0 space-y-4 overflow-y-auto border-t border-[var(--border-subtle)] bg-[var(--bg-surface)] p-3 lg:max-h-none lg:w-[270px] lg:border-l lg:border-t-0" aria-label={STRINGS.collage.collageTools}>
          <div className="flex items-center justify-between"><strong className="text-sm">{STRINGS.collage.pageDesign}</strong>
            <button type="button" className={field} onClick={() => setShowLayouts(!showLayouts)} aria-expanded={showLayouts}>{STRINGS.collage.layouts}</button>
          </div>
          {showLayouts && <div className="grid grid-cols-2 gap-2" aria-label={STRINGS.collage.collageLayoutTemplates}>
            {COLLAGE_TEMPLATES.map((template) => <button type="button" key={template.id} disabled={!canChangeCollageTemplate(doc, template.id)} onClick={() => { onChange(changeCollageTemplate(doc, template.id as CollageTemplate)); setActiveSlot(null); }}
              aria-pressed={page.template === template.id}
              className={`min-h-11 rounded border px-2 text-left text-xs ${page.template === template.id ? 'border-[var(--brand-accent)]' : 'border-[var(--border-default)]'}`}>{template.label} · {template.slots}</button>)}
          </div>}
          <label className="block text-xs font-medium">{STRINGS.collage.outputSize}
            <select className={`mt-1 w-full ${field}`} value={doc.format} onChange={(e) => onChange({ ...doc, format: e.target.value as CollageFormat })}>
              {Object.entries(COLLAGE_FORMATS).map(([key, opt]) => <option key={key} value={key}>{opt.label}</option>)}
            </select>
          </label>
          <label className="flex items-center justify-between gap-3 text-xs font-medium">{STRINGS.collage.backgroundColour}
            <input type="color" aria-label={STRINGS.collage.pageBackgroundColour} value={page.background} onChange={(e) => setPage({ background: e.target.value })} className="h-10 w-14 cursor-pointer" />
          </label>
          <label className="block text-xs font-medium">{STRINGS.collage.spacing} · {page.gap.toFixed(1)}%
            <input type="range" min="0" max="12" step="0.5" value={page.gap} onChange={(e) => setPage({ gap: Number(e.target.value) })}
              className="mt-1 w-full" aria-label={STRINGS.collage.collagePhotoSpacing} />
          </label>
          <label className="block text-xs font-medium">{STRINGS.collage.pageText}
            <textarea className={`mt-1 min-h-16 w-full resize-y ${field}`} value={page.caption}
              maxLength={1000} placeholder={STRINGS.collage.addYourOwnHeadingOrCaption} onChange={(e) => setPage({ caption: e.target.value })}/>
          </label>
          <label className="flex items-center justify-between text-xs font-medium">{STRINGS.collage.textColour}
            <input type="color" value={page.captionColour} onChange={(e) => setPage({ captionColour: e.target.value })} className="h-10 w-14" />
          </label>
          <div className="space-y-2 border-t border-[var(--border-default)] pt-3">
            <strong className="text-sm">{STRINGS.collage.selectedWindow}</strong>
            <label className="block text-xs">{STRINGS.collage.photograph}
              <select className={`mt-1 w-full ${field}`} value={slot?.photoId ?? ''} onChange={(e) => slot && onChange(replaceCollagePhoto(doc, slot.id, e.target.value || null))}>
                <option value="">{STRINGS.collage.emptyWindow}</option>
                {photos.map((p) => <option key={p.id} value={p.id}>{p.filename}</option>)}
              </select>
            </label>
            {photo && <button type="button" className={`w-full ${field}`} onClick={() => onEditPhoto(photo.id)}>{STRINGS.collage.editThisPhotograph}</button>}
            <button type="button" className={`w-full ${field}`} onClick={onImport}>{STRINGS.collage.importMorePhotos}</button>
            {onBrowseProject && onAddFromProject && projects.length > 0 && <button type="button" className={`w-full ${field}`}
              onClick={() => setSourceProject(projects[0].id)}>{STRINGS.collage.chooseFromAnotherProject}</button>}
            <p className="text-xs text-[var(--text-muted)]">{STRINGS.collage.sharedPhotoHelp}</p>
          </div>
          <p className="border-t border-[var(--border-default)] pt-3 text-xs text-[var(--text-secondary)]">
            {printing ? 'Print layout selected. Export a 300 DPI RGB PDF with 3 mm bleed using verified JPEG or PNG originals. Not certified PDF/X.' :
              'Social layout selected. Use Export for full-size JPEG or PNG pages from verified originals.'}
          </p>
        </aside>
      </div>
      {sourceProject && onBrowseProject && onAddFromProject && (
        <SourcePicker projects={projects} sourceProject={sourceProject} onProject={setSourceProject}
          onBrowseProject={onBrowseProject} onAddFromProject={onAddFromProject} onClose={() => setSourceProject('')} />
      )}
    </section>
  );
}

function SourcePicker({ projects, sourceProject, onProject, onClose, onBrowseProject, onAddFromProject }: {
  projects: Project[];
  sourceProject: string;
  onProject: (id: string) => void;
  onClose: () => void;
  onBrowseProject: NonNullable<Props['onBrowseProject']>;
  onAddFromProject: NonNullable<Props['onAddFromProject']>;
}) {
  const [sourcePhotos, setSourcePhotos] = React.useState<Array<{ id: string; filename: string }>>([]);
  const [sourceSelection, setSourceSelection] = React.useState<string[]>([]);
  const [sourceSearch, setSourceSearch] = React.useState('');

  const [loading, setLoading] = React.useState(true);
  const [adding, setAdding] = React.useState(false);
  const [message, setMessage] = React.useState('');
  const [attempt, setAttempt] = React.useState(0);
  const dialog = React.useRef<HTMLDialogElement>(null);
  const browse = React.useRef(onBrowseProject);
  React.useEffect(() => { browse.current = onBrowseProject; }, [onBrowseProject]);
  React.useEffect(() => {
    const element = dialog.current!;
    element.showModal();
    return () => element.close();
  }, []);
  React.useEffect(() => {
    let active = true;
    setLoading(true);
    setMessage('');
    setSourcePhotos([]);
    setSourceSelection([]);
    setSourceSearch('');
    void browse.current(sourceProject).then((photos) => {
      if (!active) return;
      setSourcePhotos(photos);
      if (!photos.length) setMessage(STRINGS.collage.noPhotos);
    }).catch(() => { if (active) setMessage(STRINGS.collage.readFailed); })
      .finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, [sourceProject, attempt]);
  return (
    <dialog ref={dialog} aria-label={STRINGS.collage.choosePhotographsFromAnotherProject}
      onCancel={(event) => { event.preventDefault(); if (!adding) onClose(); }}
      className="fixed inset-0 m-auto w-full max-w-xl rounded-xl bg-transparent p-3 backdrop:bg-black/60">
        <div className="flex max-h-[85dvh] w-full max-w-xl flex-col gap-3 rounded-xl bg-[var(--bg-surface)] p-4 text-[var(--text-primary)]">
          <div className="flex items-center justify-between"><strong>{STRINGS.collage.chooseExistingPhotographs}</strong>
            <button type="button" disabled={adding} onClick={onClose} className={field}>{STRINGS.collage.close}</button>
          </div>
          <label className="text-sm">{STRINGS.collage.sourceProject}
            <select className={`mt-1 w-full ${field}`} value={sourceProject} disabled={adding} onChange={(e) => onProject(e.target.value)}>{projects.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}</select>
          </label>
          {loading && <p role="status">{STRINGS.collage.reading}</p>}
          {message && <p role="status">{message}</p>}
          {message === STRINGS.collage.readFailed && <button type="button" className={field}
            onClick={() => setAttempt(value => value + 1)}>{STRINGS.collage.tryAgain}</button>}
          {sourcePhotos.length > 0 && <>
            <input className={field} type="search" placeholder={STRINGS.collage.searchFilenames} aria-label={STRINGS.collage.searchSourcePhotographs}
              value={sourceSearch} onChange={(e) => setSourceSearch(e.target.value)}/>
            <div className="min-h-0 flex-1 space-y-1 overflow-auto" role="group" aria-label={STRINGS.collage.availablePhotographs}>
              {sourcePhotos.filter((p) => p.filename.toLowerCase().includes(sourceSearch.toLowerCase())).map((item) => (
                <label key={item.id} className="flex min-h-10 items-center gap-3 border-b border-[var(--border-subtle)] py-1 text-sm">
                  <input type="checkbox" disabled={adding} checked={sourceSelection.includes(item.id)} onChange={(e) => setSourceSelection((prev) =>
                    e.target.checked ? [...prev, item.id] : prev.filter((id) => id !== item.id))}/>
                  <span className="truncate">{item.filename}</span>
                </label>
              ))}
            </div>
          </>}
          <button type="button" className="min-h-11 rounded bg-[var(--brand-accent)] px-4 font-semibold text-[var(--text-on-accent)]"
            disabled={!sourceSelection.length || loading || adding} onClick={async () => {
              setAdding(true);
              try { await onAddFromProject(sourceProject, sourceSelection); onClose(); }
              catch (reason) { setMessage(reason instanceof Error ? reason.message : STRINGS.collage.addFailed); }
              finally { setAdding(false); }
            }}>{STRINGS.collage.addSelected(sourceSelection.length)}</button>
          <p className="text-xs text-[var(--text-secondary)]">{STRINGS.collage.sourceProjectHelp}</p>
        </div>
    </dialog>
  );
}
