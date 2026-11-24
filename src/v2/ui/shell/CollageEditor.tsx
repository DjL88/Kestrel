import { STRINGS } from '../strings';
import React from 'react';
import type { Photo, PhotoSurfaceProps, Project } from '../contract';
import type { CollageDocument, CollageFormat, CollageSlot, CollageTemplate } from '../../../core/collage';
import {
  addCollagePage, canChangeCollageTemplate, MAX_COLLAGE_PAGES, MAX_COLLAGE_ZOOM, changeCollageFormat, changeCollageTemplate,
  collageCaptionGeometry, collageCaptionStyle, COLLAGE_CAPTION_FONTS, collagePage, collageShapes, collageSlotPlacement, COLLAGE_FORMATS, COLLAGE_TEMPLATES, deleteCollagePage, duplicateCollagePage,
  fillEmptyCollageSlots, modifyCollagePage, placeCollagePhoto, setCollageSlotFraming,
} from '../../../core/collage';

import { PHOTO_DRAG_TYPE, readPhotoDrag } from '../utils/photoDrag';

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
const heading = 'text-xs font-semibold uppercase tracking-wide text-[var(--text-secondary)]';

type MenuItem = { label: string; run: () => void; disabled?: boolean; checked?: boolean } | 'divider';
type MenuState = { x: number; y: number; title: string; items: MenuItem[]; returnFocus: HTMLElement | null };
type SlotDrag = { slotId: string; kind: 'pan' | 'tl' | 'tr' | 'bl' | 'br'; x: number; y: number; w: number; h: number;
  zoom: number; panX: number; panY: number; placeW: number; placeH: number };

/** Aspect ratio (width ÷ height) of each photograph, from its recorded size or, failing that, its preview. */
function usePhotoAspects(photos: Photo[], ids: Array<string | null>) {
  const [measured, setMeasured] = React.useState<Record<string, number>>({});
  const wanted = ids.filter((id): id is string => id !== null);
  const key = wanted.join('|');
  React.useEffect(() => {
    let live = true;
    for (const id of new Set(wanted)) {
      const photo = photos.find((p) => p.id === id);
      if (!photo || photo.pixelSize || measured[id] || !photo.previewUrl) continue;
      const img = new Image();
      img.onload = () => { if (live && img.naturalWidth && img.naturalHeight) setMeasured((m) => ({ ...m, [id]: img.naturalWidth / img.naturalHeight })); };
      img.src = photo.previewUrl;
    }
    return () => { live = false; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key, photos]);
  return (id: string) => {
    const size = photos.find((p) => p.id === id)?.pixelSize;
    return size && size.width > 0 && size.height > 0 ? size.width / size.height : measured[id] ?? 1.5;
  };
}

const readDroppedPhotos = (event: React.DragEvent) => readPhotoDrag(event.dataTransfer.getData(PHOTO_DRAG_TYPE));

function ContextMenu({ menu, onClose }: { menu: MenuState; onClose: () => void }) {
  const ref = React.useRef<HTMLDivElement>(null);
  React.useEffect(() => {
    ref.current?.querySelector<HTMLButtonElement>('[role^="menuitem"]:not([disabled])')?.focus();
    const away = (event: PointerEvent) => { if (!ref.current?.contains(event.target as Node)) onClose(); };
    window.addEventListener('pointerdown', away, true);
    return () => window.removeEventListener('pointerdown', away, true);
  }, [menu, onClose]);
  const move = (event: React.KeyboardEvent) => {
    const items = [...(ref.current?.querySelectorAll<HTMLButtonElement>('[role^="menuitem"]:not([disabled])') ?? [])];
    const at = items.indexOf(document.activeElement as HTMLButtonElement);
    if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
      event.preventDefault();
      items[(at + (event.key === 'ArrowDown' ? 1 : items.length - 1)) % items.length]?.focus();
    } else if (event.key === 'Home' || event.key === 'End') {
      event.preventDefault();
      items[event.key === 'Home' ? 0 : items.length - 1]?.focus();
    } else if (event.key === 'Escape' || event.key === 'Tab') {
      event.preventDefault();
      onClose();
    }
  };
  const x = Math.max(8, Math.min(menu.x, window.innerWidth - 248));
  const y = Math.max(8, Math.min(menu.y, window.innerHeight - 40 - menu.items.length * 36));
  return (
    <div ref={ref} role="menu" aria-label={menu.title} onKeyDown={move} data-testid="collage-context-menu"
      className="fixed z-[95] w-60 rounded-[var(--radius-md)] border border-[var(--border-default)] bg-[var(--bg-surface-raised,var(--bg-surface))] p-1 text-sm text-[var(--text-primary)] shadow-[var(--shadow-panel)]"
      style={{ left: x, top: y }}>
      {menu.items.map((item, i) => item === 'divider'
        ? <div key={`d${i}`} role="separator" className="my-1 border-t border-[var(--border-subtle)]" />
        : <button key={item.label} type="button" role={item.checked === undefined ? 'menuitem' : 'menuitemradio'}
            aria-checked={item.checked} disabled={item.disabled}
            onClick={() => { onClose(); item.run(); }}
            className="flex min-h-9 w-full items-center gap-2 rounded px-2 text-left hover:bg-[var(--bg-surface-active,var(--bg-input))] focus-visible:bg-[var(--bg-surface-active,var(--bg-input))] focus-visible:outline-none disabled:opacity-40">
            {item.checked !== undefined && <span aria-hidden="true" className="w-3">{item.checked ? '•' : ''}</span>}
            {item.label}
          </button>)}
    </div>
  );
}

/** A small drawing of a layout on this page's shape, so the choice is visual rather than a list of names. */
function LayoutThumb({ template, aspect }: { template: CollageTemplate; aspect: number }) {
  const w = aspect >= 1 ? 40 : 40 * aspect;
  const h = aspect >= 1 ? 40 / aspect : 40;
  return (
    <svg aria-hidden="true" viewBox="0 0 100 100" preserveAspectRatio="none" width={w} height={h}
      className="rounded-sm border border-[var(--border-default)] bg-[var(--bg-surface)]">
      {collageShapes(template, aspect).map((shape, i) => (
        <rect key={i} x={shape.x} y={shape.y} width={shape.width} height={shape.height} fill="currentColor" opacity={0.55}
          transform={shape.angle ? `rotate(${shape.angle} ${shape.x + shape.width / 2} ${shape.y + shape.height / 2})` : undefined} />
      ))}
    </svg>
  );
}

export default function CollageEditor({ document: doc, photos, projects, onBrowseProject, onAddFromProject, PhotoSurface, onChange, onEditPhoto, onImport }: Props) {
  const page = collagePage(doc);
  const format = COLLAGE_FORMATS[doc.format];
  const aspect = format.width / format.height;
  const [activeSlot, setActiveSlot] = React.useState<string | null>(null);
  const [sourceProject, setSourceProject] = React.useState('');
  const [menu, setMenu] = React.useState<MenuState | null>(null);
  const [dropTarget, setDropTarget] = React.useState<string | null>(null);
  const [status, setStatus] = React.useState('');
  const photoSelect = React.useRef<HTMLSelectElement>(null);
  const drag = React.useRef<SlotDrag | null>(null);
  // Fit the page inside the stage at its true shape: a stretched preview would misplace every window.
  const stageRef = React.useRef<HTMLDivElement>(null);
  const [stage, setStage] = React.useState({ width: 720, height: 520 });
  React.useEffect(() => {
    const el = stageRef.current;
    if (!el || typeof ResizeObserver === 'undefined') return;
    const observer = new ResizeObserver(([entry]) => {
      if (entry) setStage({ width: entry.contentRect.width, height: entry.contentRect.height });
    });
    observer.observe(el);
    return () => observer.disconnect();
  }, []);
  const pageWidth = Math.max(120, Math.min(stage.width - 8, (stage.height - 8) * aspect, 960));
  // The sidebar works on the selected window, or the first one until another is chosen.
  const slot = page.slots.find((item) => item.id === activeSlot) ?? page.slots[0] ?? null;
  const photo = photos.find((item) => item.id === slot?.photoId);
  const aspectOf = usePhotoAspects(photos, page.slots.map((s) => s.photoId));
  const setPage = (patch: Parameters<typeof modifyCollagePage>[1]) => onChange(modifyCollagePage(doc, patch));
  const printing = format.unit === 'mm';
  const pageNumber = doc.pages.indexOf(page) + 1;
  const captionStyle = collageCaptionStyle(page.captionStyle);
  const captionGeometry = collageCaptionGeometry(pageWidth, pageWidth / aspect, captionStyle);
  const setCaptionStyle = (patch: Partial<typeof captionStyle>) =>
    setPage({ captionStyle: collageCaptionStyle({ ...captionStyle, ...patch }) });
  // A shape's window, less the spacing, as a share of the page: also its width ÷ height on screen and in export.
  const windowAspect = (item: CollageSlot) => (Math.max(1, item.width - page.gap) * aspect) / Math.max(1, item.height - page.gap);
  const frame = (item: CollageSlot, patch: { zoom?: number; panX?: number; panY?: number }) => onChange(setCollageSlotFraming(doc, item.id, patch));
  const goToPage = (id: string) => { onChange({ ...doc, activePageId: id }); setActiveSlot(null); };

  const pageItems = (): MenuItem[] => [
    { label: STRINGS.collage.addPage, run: () => { onChange(addCollagePage(doc, page.template)); setActiveSlot(null); }, disabled: doc.pages.length >= MAX_COLLAGE_PAGES },
    { label: STRINGS.collage.duplicatePage, run: () => onChange(duplicateCollagePage(doc)), disabled: doc.pages.length >= MAX_COLLAGE_PAGES },
    { label: STRINGS.collage.deletePage, run: () => { onChange(deleteCollagePage(doc)); setActiveSlot(null); }, disabled: doc.pages.length === 1 },
    { label: STRINGS.collage.clearPage, run: () => onChange(page.slots.reduce((next, item) => placeCollagePhoto(next, item.id, null), doc)), disabled: page.slots.every((item) => item.photoId === null) },
    'divider',
    ...COLLAGE_TEMPLATES.map((template): MenuItem => ({
      label: `${STRINGS.collage.layoutHeading}: ${template.label}`, checked: page.template === template.id,
      disabled: !canChangeCollageTemplate(doc, template.id),
      run: () => { onChange(changeCollageTemplate(doc, template.id)); setActiveSlot(null); },
    })),
  ];
  const slotItems = (item: CollageSlot): MenuItem[] => {
    const framed = (item.zoom ?? 1) !== 1 || (item.panX ?? 0) !== 0 || (item.panY ?? 0) !== 0;
    return [
      { label: STRINGS.collage.chooseAPhotograph, run: () => { setActiveSlot(item.id); window.setTimeout(() => photoSelect.current?.focus(), 0); } },
      ...(item.photoId ? [
        { label: STRINGS.collage.editThisPhotograph, run: () => onEditPhoto(item.photoId!) },
        { label: STRINGS.collage.fitToWindow, run: () => frame(item, { zoom: 1, panX: 0, panY: 0 }), disabled: !framed },
        { label: STRINGS.collage.removeFromWindow, run: () => onChange(placeCollagePhoto(doc, item.id, null)) },
      ] : []),
      'divider',
      ...pageItems(),
    ];
  };
  const openMenu = (x: number, y: number, title: string, items: MenuItem[], from: HTMLElement | null) =>
    setMenu({ x, y, title, items, returnFocus: from });
  const closeMenu = React.useCallback(() => {
    setMenu((current) => { current?.returnFocus?.focus(); return null; });
  }, []);

  const dropOnSlot = (event: React.DragEvent, item: CollageSlot) => {
    const ids = readDroppedPhotos(event);
    setDropTarget(null);
    if (!ids.length) return;
    event.preventDefault();
    event.stopPropagation();
    let next = placeCollagePhoto(doc, item.id, ids[0]);
    let placed = 1;
    if (ids.length > 1) { const rest = fillEmptyCollageSlots(next, ids.slice(1)); next = rest.doc; placed += rest.placed; }
    onChange(next);
    setActiveSlot(item.id);
    setStatus(STRINGS.collage.placedCount(placed, ids.length));
  };
  const dropOnPage = (event: React.DragEvent) => {
    const ids = readDroppedPhotos(event);
    setDropTarget(null);
    if (!ids.length) return;
    event.preventDefault();
    const { doc: next, placed } = fillEmptyCollageSlots(doc, ids);
    if (!placed) { setStatus(STRINGS.collage.noEmptyWindows); return; }
    onChange(next);
    setStatus(STRINGS.collage.placedCount(placed, ids.length));
  };
  const acceptsPhotos = (event: React.DragEvent) => event.dataTransfer.types.includes(PHOTO_DRAG_TYPE);

  const startSlotDrag = (event: React.PointerEvent<HTMLElement>, item: CollageSlot, kind: SlotDrag['kind'], el: HTMLElement) => {
    if (event.button !== 0 || !item.photoId) return;
    event.stopPropagation();
    el.setPointerCapture(event.pointerId);
    const place = collageSlotPlacement(aspectOf(item.photoId), windowAspect(item), item);
    drag.current = { slotId: item.id, kind, x: event.clientX, y: event.clientY, w: el.offsetWidth || 1, h: el.offsetHeight || 1,
      zoom: item.zoom ?? 1, panX: item.panX ?? 0, panY: item.panY ?? 0, placeW: place.width, placeH: place.height };
  };
  const moveSlotDrag = (event: React.PointerEvent<HTMLElement>, item: CollageSlot) => {
    const d = drag.current;
    if (!d || d.slotId !== item.id) return;
    const dx = event.clientX - d.x;
    const dy = event.clientY - d.y;
    if (d.kind === 'pan') {
      // Moving the pointer right moves the picture right in its window (showing more of its left side).
      const travelX = (1 - d.placeW) / 2;
      const travelY = (1 - d.placeH) / 2;
      frame(item, {
        panX: travelX < -1e-6 ? d.panX + dx / d.w / travelX : 0,
        panY: travelY < -1e-6 ? d.panY + dy / d.h / travelY : 0,
      });
    } else {
      // Pulling a corner away from the window enlarges the picture; pushing it in shrinks it (never below filling the window).
      const sx = d.kind === 'tr' || d.kind === 'br' ? 1 : -1;
      const sy = d.kind === 'bl' || d.kind === 'br' ? 1 : -1;
      const outward = (sx * dx + sy * dy) / (d.w + d.h);
      frame(item, { zoom: Number(Math.min(MAX_COLLAGE_ZOOM, Math.max(1, d.zoom * (1 + 2 * outward))).toFixed(3)) });
    }
  };
  const endSlotDrag = () => { drag.current = null; };

  const slotKeys = (event: React.KeyboardEvent<HTMLElement>, item: CollageSlot) => {
    if (event.key === 'ContextMenu' || (event.shiftKey && event.key === 'F10')) {
      event.preventDefault();
      const box = event.currentTarget.getBoundingClientRect();
      openMenu(box.left + box.width / 2, box.top + box.height / 2, STRINGS.collage.windowMenu, slotItems(item), event.currentTarget);
      return;
    }
    if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); setActiveSlot(item.id); return; }
    if (!item.photoId || activeSlot !== item.id) return;
    const step = event.shiftKey ? 0.25 : 0.05;
    const moves: Record<string, [number, number]> = { ArrowLeft: [step, 0], ArrowRight: [-step, 0], ArrowUp: [0, step], ArrowDown: [0, -step] };
    if (moves[event.key]) {
      event.preventDefault();
      frame(item, { panX: (item.panX ?? 0) + moves[event.key][0], panY: (item.panY ?? 0) + moves[event.key][1] });
    } else if (event.key === '+' || event.key === '=' || event.key === '-') {
      event.preventDefault();
      frame(item, { zoom: (item.zoom ?? 1) * (event.key === '-' ? 1 / 1.1 : 1.1) });
    } else if (event.key === 'Delete' || event.key === 'Backspace') {
      event.preventDefault();
      onChange(placeCollagePhoto(doc, item.id, null));
    }
  };

  return (
    <section className="flex min-h-0 flex-1 flex-col overflow-hidden bg-[var(--bg-app)]" aria-label={STRINGS.collage.collagePageEditor}>
      <div className="flex shrink-0 flex-wrap items-center gap-2 border-b border-[var(--border-subtle)] bg-[var(--bg-surface)] p-2 sm:px-4">
        <span className="mr-2 text-sm font-semibold text-[var(--text-primary)]">{STRINGS.collage.pages}</span>
        <div role="tablist" aria-label={STRINGS.collage.collagePages} className="flex max-w-full gap-1 overflow-x-auto">
          {doc.pages.map((item, i) => (
            <button key={item.id} type="button" role="tab" aria-selected={item.id === page.id}
              onClick={() => goToPage(item.id)}
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
        <div ref={stageRef} className="flex min-h-[200px] min-w-0 flex-1 items-center justify-center overflow-hidden p-3 sm:p-8" data-testid="collage-stage"
          onPointerDown={(e) => { if (e.target === e.currentTarget) setActiveSlot(null); }}>
          <div data-testid="collage-page"
            className={`relative shrink-0 overflow-hidden shadow-xl ${dropTarget === 'page' ? 'outline outline-2 outline-offset-4 outline-[var(--brand-accent)]' : ''}`}
            style={{ width: pageWidth, height: pageWidth / aspect, background: page.background }}
            aria-label={`Page ${pageNumber} of ${doc.pages.length}`}
            onPointerDown={(e) => { if (e.target === e.currentTarget) setActiveSlot(null); }}
            onContextMenu={(e) => { if (e.target !== e.currentTarget) return; e.preventDefault(); openMenu(e.clientX, e.clientY, STRINGS.collage.pageMenu, pageItems(), null); }}
            onDragOver={(e) => { if (!acceptsPhotos(e)) return; e.preventDefault(); e.dataTransfer.dropEffect = 'copy'; if (e.target === e.currentTarget) setDropTarget('page'); }}
            onDragLeave={(e) => { if (e.target === e.currentTarget) setDropTarget(null); }}
            onDrop={dropOnPage}>
            {page.slots.map((item, index) => {
              const source = photos.find((candidate) => candidate.id === item.photoId);
              const gap = page.gap / 2;
              const selected = activeSlot === item.id;
              const place = source ? collageSlotPlacement(aspectOf(source.id), windowAspect(item), item) : null;
              return (
                <div key={item.id} role="button" tabIndex={0} data-testid={`collage-window-${index}`}
                  aria-label={source ? STRINGS.collage.windowLabel(index + 1, source.filename) : STRINGS.collage.emptyWindowLabel(index + 1)}
                  aria-pressed={selected}
                  onPointerDown={(e) => { setActiveSlot(item.id); if (selected) startSlotDrag(e, item, 'pan', e.currentTarget); }}
                  onPointerMove={(e) => moveSlotDrag(e, item)}
                  onPointerUp={endSlotDrag}
                  onPointerCancel={endSlotDrag}
                  onDoubleClick={() => source && onEditPhoto(source.id)}
                  onKeyDown={(e) => slotKeys(e, item)}
                  onContextMenu={(e) => { e.preventDefault(); e.stopPropagation(); setActiveSlot(item.id); openMenu(e.clientX, e.clientY, STRINGS.collage.windowMenu, slotItems(item), e.currentTarget); }}
                  onDragOver={(e) => { if (!acceptsPhotos(e)) return; e.preventDefault(); e.stopPropagation(); e.dataTransfer.dropEffect = 'copy'; setDropTarget(item.id); }}
                  onDragLeave={() => setDropTarget((current) => current === item.id ? null : current)}
                  onDrop={(e) => dropOnSlot(e, item)}
                  className={`absolute overflow-hidden bg-black/10 outline-offset-2 focus-visible:outline-2 focus-visible:outline-[var(--brand-accent)] ${selected && source ? 'cursor-move' : 'cursor-pointer'} ${selected || dropTarget === item.id ? 'ring-2 ring-[var(--brand-accent)]' : ''}`}
                  style={{ left: `${item.x + gap}%`, top: `${item.y + gap}%`, width: `${Math.max(1, item.width - gap * 2)}%`,
                    height: `${Math.max(1, item.height - gap * 2)}%`, transform: `rotate(${item.angle}deg)`,
                    clipPath: item.clip, zIndex: selected ? 2 : 1, touchAction: selected && source ? 'none' : 'auto' }}>
                  {source && place ? (
                    <div className="pointer-events-none absolute" data-testid="collage-window-photo"
                      style={{ left: `${place.left * 100}%`, top: `${place.top * 100}%`, width: `${place.width * 100}%`, height: `${place.height * 100}%` }}>
                      {PhotoSurface
                        ? <PhotoSurface photoId={source.id} variant="edited" alt={source.filename} className="h-full w-full" />
                        : <img src={source.previewUrl} alt={source.filename} draggable={false} className="h-full w-full object-cover" />}
                    </div>
                  ) : <span className="pointer-events-none flex h-full items-center justify-center text-2xl text-[var(--text-secondary)]">+</span>}
                  {selected && source && !item.clip && (['tl', 'tr', 'bl', 'br'] as const).map((corner) => (
                    <span key={corner} aria-hidden="true" title={STRINGS.collage.resizeHandle} data-testid={`collage-resize-${corner}`}
                      onPointerDown={(e) => startSlotDrag(e, item, corner, e.currentTarget.parentElement as HTMLElement)}
                      className={`absolute z-10 h-4 w-4 rounded-sm border-2 border-white bg-[var(--bg-scrim)] shadow hover:bg-[var(--brand-accent)] ${
                        corner === 'tl' ? 'left-1 top-1 cursor-nwse-resize' : corner === 'tr' ? 'right-1 top-1 cursor-nesw-resize' : corner === 'bl' ? 'bottom-1 left-1 cursor-nesw-resize' : 'bottom-1 right-1 cursor-nwse-resize'}`} />
                  ))}
                </div>
              );
            })}
            {page.caption && <div className="pointer-events-none absolute inset-[3%_5%] z-10 overflow-hidden">
              <div className="absolute w-full whitespace-pre-wrap break-words text-center font-semibold"
                style={{ color: page.captionColour, fontFamily: captionGeometry.font, fontSize: captionGeometry.fontPx,
                  lineHeight: captionGeometry.lineHeight, top: `${captionStyle.position}%`, transform: `translateY(-${captionStyle.position}%)` }}>{page.caption}</div>
            </div>}
          </div>
        </div>
        <aside className="max-h-[40dvh] w-full shrink-0 space-y-5 overflow-y-auto border-t border-[var(--border-subtle)] bg-[var(--bg-surface)] p-3 lg:max-h-none lg:w-[280px] lg:border-l lg:border-t-0" aria-label={STRINGS.collage.collageTools}>
          <p role="status" aria-live="polite" className={status ? 'rounded bg-[var(--bg-input)] p-2 text-xs' : 'sr-only'}>{status}</p>

          <section className="space-y-3">
            <h3 className={heading}>{STRINGS.collage.pageHeading}</h3>
            <label className="block text-xs font-medium">{STRINGS.collage.pageSize}
              <select className={`mt-1 w-full ${field}`} value={doc.format} onChange={(e) => onChange(changeCollageFormat(doc, e.target.value as CollageFormat))}>
                {Object.entries(COLLAGE_FORMATS).map(([key, opt]) => <option key={key} value={key}>{opt.label}</option>)}
              </select>
            </label>
            <p className="text-[11px] text-[var(--text-muted)]">{STRINGS.collage.relayoutNote}</p>
            <label className="flex items-center justify-between gap-3 text-xs font-medium">{STRINGS.collage.backgroundColour}
              <input type="color" aria-label={STRINGS.collage.pageBackgroundColour} value={page.background} onChange={(e) => setPage({ background: e.target.value })} className="h-10 w-14 cursor-pointer" />
            </label>
            <label className="block text-xs font-medium">{STRINGS.collage.spacing} · {page.gap.toFixed(1)}%
              <input type="range" min="0" max="12" step="0.5" value={page.gap} onChange={(e) => setPage({ gap: Number(e.target.value) })}
                className="mt-1 w-full" aria-label={STRINGS.collage.collagePhotoSpacing} />
            </label>
          </section>

          <section className="space-y-2 border-t border-[var(--border-default)] pt-3" aria-label={STRINGS.collage.collageLayoutTemplates}>
            <h3 className={heading}>{STRINGS.collage.layoutHeading}</h3>
            <div className="grid grid-cols-3 gap-2">
              {COLLAGE_TEMPLATES.map((template) => (
                <button type="button" key={template.id} disabled={!canChangeCollageTemplate(doc, template.id)}
                  onClick={() => { onChange(changeCollageTemplate(doc, template.id)); setActiveSlot(null); }}
                  aria-pressed={page.template === template.id} title={`${template.label} · ${template.slots}`}
                  className={`flex min-h-[76px] flex-col items-center justify-center gap-1 rounded border p-1 text-[10px] leading-tight text-[var(--text-secondary)] disabled:opacity-40 ${page.template === template.id ? 'border-[var(--brand-accent)] bg-[var(--brand-accent-soft)] text-[var(--brand-accent)]' : 'border-[var(--border-default)]'}`}>
                  <LayoutThumb template={template.id} aspect={aspect} />
                  <span>{template.label}</span>
                </button>
              ))}
            </div>
          </section>

          <section className="space-y-3 border-t border-[var(--border-default)] pt-3">
            <h3 className={heading}>{STRINGS.collage.textHeading}</h3>
            <label className="block text-xs font-medium">{STRINGS.collage.pageText}
              <textarea className={`mt-1 min-h-16 w-full resize-y ${field}`} value={page.caption}
                maxLength={1000} placeholder={STRINGS.collage.addYourOwnHeadingOrCaption} onChange={(e) => setPage({ caption: e.target.value })}/>
            </label>
            <label className="block text-xs font-medium">{STRINGS.overlays.fontListLabel}
              <select className={`mt-1 w-full ${field}`} value={captionStyle.font} onChange={(e) => setCaptionStyle({ font: e.target.value as typeof captionStyle.font })}>
                {COLLAGE_CAPTION_FONTS.map(font => <option key={font} value={font}>{font}</option>)}
              </select>
            </label>
            <label className="block text-xs font-medium">{STRINGS.canvas.resizeText} · {captionStyle.size}%
              <input type="range" min="1" max="6" step="0.25" value={captionStyle.size}
                className="mt-1 w-full" onChange={(e) => setCaptionStyle({ size: Number(e.target.value) })} />
            </label>
            <label className="block text-xs font-medium">{STRINGS.panelWords.centreUpDown} · {captionStyle.position}%
              <input type="range" min="0" max="100" step="5" value={captionStyle.position}
                className="mt-1 w-full" onChange={(e) => setCaptionStyle({ position: Number(e.target.value) })} />
            </label>
            <label className="flex items-center justify-between text-xs font-medium">{STRINGS.collage.textColour}
              <input type="color" value={page.captionColour} onChange={(e) => setPage({ captionColour: e.target.value })} className="h-10 w-14" />
            </label>
          </section>

          {slot && (
            <section className="space-y-2 border-t border-[var(--border-default)] pt-3" aria-label={STRINGS.collage.selectedWindow}>
              <h3 className={heading}>{STRINGS.collage.selectedWindow}</h3>
              <label className="block text-xs">{STRINGS.collage.photograph}
                <select ref={photoSelect} className={`mt-1 w-full ${field}`} value={slot.photoId ?? ''} onChange={(e) => onChange(placeCollagePhoto(doc, slot.id, e.target.value || null))}>
                  <option value="">{STRINGS.collage.emptyWindow}</option>
                  {photos.map((p) => <option key={p.id} value={p.id}>{p.filename}</option>)}
                </select>
              </label>
              {photo && <>
                <label className="block text-xs font-medium">{STRINGS.collage.windowSize} · {Math.round((slot.zoom ?? 1) * 100)}%
                  <input type="range" min="1" max={MAX_COLLAGE_ZOOM} step="0.05" value={slot.zoom ?? 1} className="mt-1 w-full"
                    aria-label={STRINGS.collage.windowSize} onChange={(e) => frame(slot, { zoom: Number(e.target.value) })} />
                </label>
                <div className="grid grid-cols-2 gap-2">
                  <button type="button" className={field} disabled={(slot.zoom ?? 1) === 1 && !slot.panX && !slot.panY}
                    onClick={() => frame(slot, { zoom: 1, panX: 0, panY: 0 })}>{STRINGS.collage.fitToWindow}</button>
                  <button type="button" className={field} onClick={() => onChange(placeCollagePhoto(doc, slot.id, null))}
                    aria-label={STRINGS.collage.removeFromWindow}>{STRINGS.collage.remove}</button>
                </div>
                <button type="button" className={`w-full ${field}`} onClick={() => onEditPhoto(photo.id)}>{STRINGS.collage.editThisPhotograph}</button>
              </>}
            </section>
          )}

          <section className="space-y-2 border-t border-[var(--border-default)] pt-3">
            <h3 className={heading}>{STRINGS.collage.addPhotosHeading}</h3>
            <p className="text-xs text-[var(--text-secondary)]">{STRINGS.collage.dragHelp}</p>
            <button type="button" className={`w-full ${field}`} onClick={onImport}>{STRINGS.collage.importMorePhotos}</button>
            {onBrowseProject && onAddFromProject && projects.length > 0 && <button type="button" className={`w-full ${field}`}
              onClick={() => setSourceProject(projects[0].id)}>{STRINGS.collage.chooseFromAnotherProject}</button>}
            <p className="text-xs text-[var(--text-muted)]">{STRINGS.collage.sharedPhotoHelp}</p>
          </section>
          <p className="border-t border-[var(--border-default)] pt-3 text-xs text-[var(--text-secondary)]">
            {printing ? 'Print layout selected. Export a 300 DPI RGB PDF with 3 mm bleed using verified JPEG or PNG originals. Not certified PDF/X.' :
              'Social layout selected. Use Export for full-size JPEG or PNG pages from verified originals.'}
          </p>
        </aside>
      </div>
      {menu && <ContextMenu menu={menu} onClose={closeMenu} />}
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
