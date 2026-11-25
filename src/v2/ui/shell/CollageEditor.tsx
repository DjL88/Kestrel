import { STRINGS } from '../strings';
import React from 'react';
import type { Photo, PhotoSurfaceProps, Project } from '../contract';
import type { CollageDocument, CollageFormat, CollagePage, CollageSlot, CollageTemplate } from '../../../core/collage';
import {
  addCollagePage, canChangeCollageTemplate, MAX_COLLAGE_PAGES, MAX_COLLAGE_ZOOM, changeCollageFormat, changeCollageTemplate,
  collageCaptionGeometry, collageCaptionStyle, COLLAGE_CAPTION_FONTS, collagePage, collageShapes, collageSlotPlacement, COLLAGE_FORMATS, COLLAGE_TEMPLATES, deleteCollagePage, duplicateCollagePage,
  deleteCollagePageById, fillEmptyCollageSlots, modifyCollagePage, moveCollagePage, placeCollagePhoto, setCollageSlotFraming,
  addCollageWindow, addCollageWindowsAt, removeCollageWindow, setCollageWindowGeometry, MAX_COLLAGE_WINDOWS,
} from '../../../core/collage';

import { PHOTO_DRAG_TYPE, readPhotoDrag } from '../utils/photoDrag';
import BrandIcon, { type BrandIconName } from '../icons/BrandIcon';

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
  /** Whether the From project picker is open (the filmstrip can open it too). */
  sourcePickerOpen?: boolean;
  onSourcePickerChange?: (open: boolean) => void;
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

type CollageTool = 'size' | 'layout' | 'background' | 'text' | 'window' | 'photos';
const PAGE_DRAG_TYPE = 'application/x-inflight-collage-page';

export default function CollageEditor({ document: doc, photos, projects, onBrowseProject, onAddFromProject, PhotoSurface, onChange, onEditPhoto, onImport, sourcePickerOpen = false, onSourcePickerChange }: Props) {
  const page = collagePage(doc);
  const format = COLLAGE_FORMATS[doc.format];
  const aspect = format.width / format.height;
  const [activeSlot, setActiveSlot] = React.useState<string | null>(null);
  const [localSourceProject, setLocalSourceProject] = React.useState('');
  // The filmstrip's From project button opens the same picker, so the parent may own whether it is open.
  const sourceProject = sourcePickerOpen ? (localSourceProject || projects[0]?.id || '') : localSourceProject;
  const setSourceProject = setLocalSourceProject;
  const openSourcePicker = () => { if (projects[0]) { setLocalSourceProject(projects[0].id); onSourcePickerChange?.(true); } };
  const closeSourcePicker = () => { setLocalSourceProject(''); onSourcePickerChange?.(false); };
  const [tool, setTool] = React.useState<CollageTool>('size');
  const [panelOpen, setPanelOpen] = React.useState(true);
  const [draggingPage, setDraggingPage] = React.useState<string | null>(null);
  const [pageDropIndex, setPageDropIndex] = React.useState<number | null>(null);
  const pageCards = React.useRef<Record<string, HTMLDivElement | null>>({});
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
  // Pages sit side by side at the stage's height (less each page's header), never wider than the stage.
  const pageWidth = Math.max(120, Math.min(stage.width - 48, (stage.height - 48) * aspect, 960));
  // Bring the page being edited into view when it changes.
  React.useEffect(() => {
    const card = pageCards.current[page.id];
    const reduce = typeof window !== 'undefined' && window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
    card?.scrollIntoView?.({ inline: 'center', block: 'nearest', behavior: reduce ? 'auto' : 'smooth' });
  }, [page.id]);
  const background = photos.find((p) => p.id === page.backgroundPhotoId);
  const selectSlot = (id: string) => { setActiveSlot(id); setTool('window'); setPanelOpen(true); };
  // The sidebar works on the selected window, or the first one until another is chosen.
  const slot = page.slots.find((item) => item.id === activeSlot) ?? page.slots[0] ?? null;
  const photo = photos.find((item) => item.id === slot?.photoId);
  const aspectOf = usePhotoAspects(photos, doc.pages.flatMap((p) => p.slots.map((s) => s.photoId)));
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
      label: `${STRINGS.collage.layoutHeading}: ${template.label}`, checked: !page.customLayout && page.template === template.id,
      disabled: !canChangeCollageTemplate(doc, template.id),
      run: () => { onChange(changeCollageTemplate(doc, template.id)); setActiveSlot(null); },
    })),
  ];
  const slotItems = (item: CollageSlot): MenuItem[] => {
    const framed = (item.zoom ?? 1) !== 1 || (item.panX ?? 0) !== 0 || (item.panY ?? 0) !== 0;
    return [
      { label: STRINGS.collage.chooseAPhotograph, run: () => { selectSlot(item.id); window.setTimeout(() => photoSelect.current?.focus(), 0); } },
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
    selectSlot(item.id);
    setStatus(STRINGS.collage.placedCount(placed, ids.length));
  };
  const dropOnPage = (event: React.DragEvent) => {
    const ids = readDroppedPhotos(event);
    setDropTarget(null);
    if (!ids.length) return;
    event.preventDefault();
    const { doc: filled, placed } = fillEmptyCollageSlots(doc, ids);
    // Build your own layout: what doesn't fit an empty window gets a new window where it was dropped.
    const box = event.currentTarget.getBoundingClientRect();
    const at = { x: ((event.clientX - box.left) / Math.max(1, box.width)) * 100, y: ((event.clientY - box.top) / Math.max(1, box.height)) * 100 };
    const { doc: next, added } = addCollageWindowsAt(filled, ids.slice(placed), at.x, at.y);
    if (!placed && !added) { setStatus(STRINGS.collage.windowLimitReached(MAX_COLLAGE_WINDOWS)); return; }
    onChange(next);
    if (added) setActiveSlot(collagePage(next).slots.at(-1)!.id);
    const left = ids.length - placed - added;
    setStatus([placed ? STRINGS.collage.placedCount(placed, placed) : '', added ? STRINGS.collage.windowsAdded(added) : '',
      left ? STRINGS.collage.windowLimitReached(MAX_COLLAGE_WINDOWS) : ''].filter(Boolean).join(' '));
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
    if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); selectSlot(item.id); return; }
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

  const tools: Array<{ id: CollageTool; label: string; icon: BrandIconName }> = [
    { id: 'size', label: STRINGS.collage.pageSize, icon: 'all-sizes' },
    { id: 'layout', label: STRINGS.collage.layoutHeading, icon: 'grid' },
    { id: 'background', label: STRINGS.collage.backgroundHeading, icon: 'palette' },
    { id: 'text', label: STRINGS.collage.textHeading, icon: 'text' },
    { id: 'window', label: STRINGS.collage.windowHeading, icon: 'image' },
    { id: 'photos', label: STRINGS.collage.addPhotosHeading, icon: 'image-plus' },
  ];
  const toolTitle = tools.find((t) => t.id === tool)?.label ?? '';

  const pageCard = (item: CollagePage, index: number) => {
    const active = item.id === page.id;
    const near = Math.abs(index - pageNumber + 1) <= 3;
    return (
      <div key={item.id} ref={(el) => { pageCards.current[item.id] = el; }} data-testid={`collage-page-card-${index}`}
        className={`flex shrink-0 flex-col gap-1.5 ${draggingPage && draggingPage !== item.id ? 'transition-opacity' : ''}`}
        onDragOver={(e) => { if (!e.dataTransfer.types.includes(PAGE_DRAG_TYPE)) return; e.preventDefault(); e.dataTransfer.dropEffect = 'move'; setPageDropIndex(index); }}
        onDragLeave={() => setPageDropIndex((current) => current === index ? null : current)}
        onDrop={(e) => {
          const id = e.dataTransfer.getData(PAGE_DRAG_TYPE);
          setPageDropIndex(null); setDraggingPage(null);
          if (!id) return;
          e.preventDefault();
          onChange(moveCollagePage(doc, id, index));
        }}>
        <div className={`flex h-8 items-center gap-1 rounded px-1 ${pageDropIndex === index ? 'outline outline-2 outline-[var(--brand-accent)]' : ''}`}>
          <span draggable onDragStart={(e) => { e.dataTransfer.effectAllowed = 'move'; e.dataTransfer.setData(PAGE_DRAG_TYPE, item.id); setDraggingPage(item.id); }}
            onDragEnd={() => { setDraggingPage(null); setPageDropIndex(null); }}
            title={STRINGS.collage.dragToReorder} className="flex cursor-grab items-center gap-1 text-xs font-semibold text-[var(--text-secondary)] active:cursor-grabbing">
            <BrandIcon name="grip" size={12} />
            {STRINGS.collage.pageOf(index + 1, doc.pages.length)}
          </span>
          <span className="flex-1" />
          {([
            ['chevron-left', STRINGS.collage.movePageEarlier(index + 1), index === 0, () => onChange(moveCollagePage(doc, item.id, index - 1))],
            ['chevron-right', STRINGS.collage.movePageLater(index + 1), index === doc.pages.length - 1, () => onChange(moveCollagePage(doc, item.id, index + 1))],
            ['copy', STRINGS.collage.duplicatePageN(index + 1), doc.pages.length >= MAX_COLLAGE_PAGES, () => { onChange(duplicateCollagePage({ ...doc, activePageId: item.id })); setActiveSlot(null); }],
            ['trash', STRINGS.collage.deletePageN(index + 1), doc.pages.length === 1, () => { onChange(deleteCollagePageById(doc, item.id)); setActiveSlot(null); }],
          ] as Array<[BrandIconName, string, boolean, () => void]>).map(([icon, label, disabled, run]) => (
            <button key={icon} type="button" aria-label={label} title={label} disabled={disabled} onClick={run}
              className="inline-flex h-7 w-7 items-center justify-center rounded text-[var(--text-secondary)] hover:bg-[var(--bg-surface-hover)] hover:text-[var(--text-primary)] disabled:opacity-30">
              <BrandIcon name={icon} size={14} />
            </button>
          ))}
        </div>
        {active ? renderActivePage() : (
          <button type="button" data-testid={`collage-page-preview-${index}`} aria-label={STRINGS.collage.openPage(index + 1)}
            onClick={() => goToPage(item.id)}
            className="relative overflow-hidden opacity-80 shadow-lg outline-offset-2 transition-opacity hover:opacity-100 focus-visible:outline-2 focus-visible:outline-[var(--brand-accent)]"
            style={{ width: pageWidth, height: pageWidth / aspect, background: item.background }}>
            {near && <PagePreview page={item} photos={photos} width={pageWidth} aspect={aspect} aspectOf={aspectOf} PhotoSurface={PhotoSurface} />}
          </button>
        )}
      </div>
    );
  };

  const renderActivePage = () => (
    <div data-testid="collage-page"
      className={`relative shrink-0 overflow-hidden shadow-xl ring-2 ring-[var(--brand-accent)] ring-offset-2 ring-offset-[var(--bg-app)] ${dropTarget === 'page' ? 'outline outline-2 outline-offset-4 outline-[var(--brand-accent)]' : ''}`}
      style={{ width: pageWidth, height: pageWidth / aspect, background: page.background }}
      aria-label={`Page ${pageNumber} of ${doc.pages.length}`}
      onPointerDown={(e) => { if (e.target === e.currentTarget) setActiveSlot(null); }}
      onContextMenu={(e) => { if (e.target !== e.currentTarget) return; e.preventDefault(); openMenu(e.clientX, e.clientY, STRINGS.collage.pageMenu, pageItems(), null); }}
      onDragOver={(e) => { if (!acceptsPhotos(e)) return; e.preventDefault(); e.dataTransfer.dropEffect = 'copy'; if (e.target === e.currentTarget) setDropTarget('page'); }}
      onDragLeave={(e) => { if (e.target === e.currentTarget) setDropTarget(null); }}
      onDrop={dropOnPage}>
      {background && <BackgroundPhoto photo={background} PhotoSurface={PhotoSurface} />}
      {page.slots.map((item, index) => {
        const source = photos.find((candidate) => candidate.id === item.photoId);
        const gap = page.gap / 2;
        const selected = activeSlot === item.id;
        const place = source ? collageSlotPlacement(aspectOf(source.id), windowAspect(item), item) : null;
        return (
          <div key={item.id} role="button" tabIndex={0} data-testid={`collage-window-${index}`}
            aria-label={source ? STRINGS.collage.windowLabel(index + 1, source.filename) : STRINGS.collage.emptyWindowLabel(index + 1)}
            aria-pressed={selected}
            onPointerDown={(e) => { selectSlot(item.id); if (selected) startSlotDrag(e, item, 'pan', e.currentTarget); }}
            onPointerMove={(e) => moveSlotDrag(e, item)}
            onPointerUp={endSlotDrag}
            onPointerCancel={endSlotDrag}
            onDoubleClick={() => source && onEditPhoto(source.id)}
            onKeyDown={(e) => slotKeys(e, item)}
            onContextMenu={(e) => { e.preventDefault(); e.stopPropagation(); selectSlot(item.id); openMenu(e.clientX, e.clientY, STRINGS.collage.windowMenu, slotItems(item), e.currentTarget); }}
            onDragOver={(e) => { if (!acceptsPhotos(e)) return; e.preventDefault(); e.stopPropagation(); e.dataTransfer.dropEffect = 'copy'; setDropTarget(item.id); }}
            onDragLeave={() => setDropTarget((current) => current === item.id ? null : current)}
            onDrop={(e) => dropOnSlot(e, item)}
            className={`absolute overflow-hidden bg-black/10 outline-offset-2 focus-visible:outline-2 focus-visible:outline-[var(--brand-accent)] ${selected && source ? 'cursor-move' : 'cursor-pointer'} ${selected || dropTarget === item.id ? 'ring-2 ring-[var(--brand-accent)]' : ''}`}
            style={{ left: `${item.x + gap}%`, top: `${item.y + gap}%`, width: `${Math.max(1, item.width - gap * 2)}%`,
              height: `${Math.max(1, item.height - gap * 2)}%`, transform: `rotate(${item.angle}deg)`,
              clipPath: item.clip, zIndex: index + 1, touchAction: selected && source ? 'none' : 'auto' }}>
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
      {page.caption && <div data-artwork className="pointer-events-none absolute inset-[3%_5%] z-20 overflow-hidden">
        <div className="absolute w-full whitespace-pre-wrap break-words text-center font-semibold"
          style={{ color: page.captionColour, fontFamily: captionGeometry.font, fontSize: captionGeometry.fontPx,
            lineHeight: captionGeometry.lineHeight, top: `${captionStyle.position}%`, transform: `translateY(-${captionStyle.position}%)` }}>{page.caption}</div>
      </div>}
    </div>
  );

  const toolBody = () => {
    switch (tool) {
      case 'size': return (
        <div className="space-y-3">
          <label className="block text-xs font-medium">{STRINGS.collage.pageSize}
            <select className={`mt-1 w-full ${field}`} value={doc.format} onChange={(e) => onChange(changeCollageFormat(doc, e.target.value as CollageFormat))}>
              {Object.entries(COLLAGE_FORMATS).map(([key, opt]) => <option key={key} value={key}>{opt.label}</option>)}
            </select>
          </label>
          <p className="text-[0.6875rem] text-[var(--text-muted)]">{STRINGS.collage.relayoutNote}</p>
          <p className="text-xs text-[var(--text-secondary)]">
            {printing ? 'Print layout selected. Export a 300 DPI RGB PDF with 3 mm bleed using verified JPEG or PNG originals. Not certified PDF/X.' :
              'Social layout selected. Use Export for full-size JPEG or PNG pages from verified originals.'}
          </p>
        </div>
      );
      case 'layout': return (
        <div className="grid grid-cols-3 gap-2" role="group" aria-label={STRINGS.collage.collageLayoutTemplates}>
          {COLLAGE_TEMPLATES.map((template) => (
            <button type="button" key={template.id} disabled={!canChangeCollageTemplate(doc, template.id)}
              onClick={() => { onChange(changeCollageTemplate(doc, template.id)); setActiveSlot(null); }}
              aria-pressed={!page.customLayout && page.template === template.id} title={`${template.label} · ${template.slots}`}
              className={`flex min-h-[76px] flex-col items-center justify-center gap-1 rounded border p-1 text-[0.625rem] leading-tight text-[var(--text-secondary)] disabled:opacity-40 ${!page.customLayout && page.template === template.id ? 'border-[var(--brand-accent)] bg-[var(--brand-accent-soft)] text-[var(--brand-accent)]' : 'border-[var(--border-default)]'}`}>
              <LayoutThumb template={template.id} aspect={aspect} />
              <span>{template.label}</span>
            </button>
          ))}
        </div>
      );
      case 'background': return (
        <div className="space-y-3">
          <label className="flex items-center justify-between gap-3 text-xs font-medium">{STRINGS.collage.backgroundColour}
            <input type="color" aria-label={STRINGS.collage.pageBackgroundColour} value={page.background} onChange={(e) => setPage({ background: e.target.value })} className="h-10 w-14 cursor-pointer" />
          </label>
          <label className="block text-xs font-medium">{STRINGS.collage.backgroundPhoto}
            <select className={`mt-1 w-full ${field}`} value={page.backgroundPhotoId ?? ''}
              onChange={(e) => setPage({ backgroundPhotoId: e.target.value || null })}>
              <option value="">{STRINGS.collage.noBackgroundPhoto}</option>
              {photos.map((p) => <option key={p.id} value={p.id}>{p.filename}</option>)}
            </select>
          </label>
          <p className="text-[0.6875rem] text-[var(--text-muted)]">{STRINGS.collage.backgroundPhotoHelp}</p>
          <label className="block text-xs font-medium">{STRINGS.collage.spacing} · {page.gap.toFixed(1)}%
            <input type="range" min="0" max="12" step="0.5" value={page.gap} onChange={(e) => setPage({ gap: Number(e.target.value) })}
              className="mt-1 w-full" aria-label={STRINGS.collage.collagePhotoSpacing} />
          </label>
        </div>
      );
      case 'text': return (
        <div className="space-y-3">
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
        </div>
      );
      case 'window': return slot ? (
        <section className="space-y-2" aria-label={STRINGS.collage.selectedWindow}>
          <button type="button" data-testid="collage-add-window" className={`w-full ${field}`} disabled={page.slots.length >= MAX_COLLAGE_WINDOWS}
            onClick={() => { const next = addCollageWindow(doc); if (next !== doc) { selectSlot(collagePage(next).slots.at(-1)!.id); onChange(next); } }}>+ {STRINGS.collage.emptyWindow}</button>
          <label className="block text-xs">{STRINGS.collage.photograph}
            <select ref={photoSelect} className={`mt-1 w-full ${field}`} value={slot.photoId ?? ''} onChange={(e) => onChange(placeCollagePhoto(doc, slot.id, e.target.value || null))}>
              <option value="">{STRINGS.collage.emptyWindow}</option>
              {photos.map((p) => <option key={p.id} value={p.id}>{p.filename}</option>)}
            </select>
          </label>
          <div className="space-y-2" data-testid="collage-window-geometry">
            {([
              { key: 'x', label: STRINGS.panelWords.startLeftRight, value: slot.x, min: 0, max: 100 - slot.width },
              { key: 'y', label: STRINGS.panelWords.startUpDown, value: slot.y, min: 0, max: 100 - slot.height },
              { key: 'width', label: 'W (%)', value: slot.width, min: 5, max: 100 },
              { key: 'height', label: 'H (%)', value: slot.height, min: 5, max: 100 },
              { key: 'angle', label: STRINGS.panelWords.rotateDegrees, value: slot.angle, min: -180, max: 180 },
            ] as const).map(row => (
              <label key={row.key} className="block text-xs font-medium">{row.label} · {Math.round(row.value)}
                <input type="range" min={row.min} max={row.max} step={1} value={row.value} className="mt-1 w-full"
                  aria-label={row.label} onChange={e => onChange(setCollageWindowGeometry(doc, slot.id, { [row.key]: Number(e.target.value) }))} />
              </label>
            ))}
            {!slot.photoId && <button type="button" className={field} data-testid="collage-delete-window"
              onClick={() => { onChange(removeCollageWindow(doc, slot.id)); setActiveSlot(null); }}>{STRINGS.collage.remove} · {STRINGS.collage.emptyWindow}</button>}
          </div>
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
      ) : <div className="space-y-2">
        <button type="button" data-testid="collage-add-window" className={`w-full ${field}`} disabled={page.slots.length >= MAX_COLLAGE_WINDOWS}
            onClick={() => { const next = addCollageWindow(doc); if (next !== doc) { selectSlot(collagePage(next).slots.at(-1)!.id); onChange(next); } }}>+ {STRINGS.collage.emptyWindow}</button>
        <p className="text-xs text-[var(--text-secondary)]">{STRINGS.collage.selectAWindow}</p>
      </div>;
      case 'photos': return (
        <div className="space-y-2">
          <p className="text-xs text-[var(--text-secondary)]">{STRINGS.collage.dragHelp}</p>
          <button type="button" className={`w-full ${field}`} onClick={onImport}>{STRINGS.collage.importMorePhotos}</button>
          {onBrowseProject && onAddFromProject && projects.length > 0 && <button type="button" className={`w-full ${field}`}
            onClick={() => openSourcePicker()}>{STRINGS.collage.chooseFromAnotherProject}</button>}
          <p className="text-xs text-[var(--text-muted)]">{STRINGS.collage.sharedPhotoHelp}</p>
        </div>
      );
    }
  };

  return (
    <section className="flex min-h-0 flex-1 flex-col overflow-hidden bg-[var(--bg-app)] lg:flex-row" aria-label={STRINGS.collage.collagePageEditor}>
      {/* Tools: a rail and a docked panel, like the editor's. Page size comes first. */}
      <nav aria-label={STRINGS.collage.collageTools}
        className="order-2 flex shrink-0 gap-1 overflow-x-auto border-t border-[var(--border-subtle)] bg-[var(--bg-surface)] px-1.5 py-1 lg:order-none lg:w-[72px] lg:flex-col lg:overflow-y-auto lg:border-r lg:border-t-0 lg:py-2">
        {tools.map((item) => (
          <button key={item.id} type="button" aria-pressed={tool === item.id && panelOpen} data-testid={`collage-tool-${item.id}`}
            onClick={() => { if (tool === item.id) setPanelOpen(!panelOpen); else { setTool(item.id); setPanelOpen(true); } }}
            className={`flex min-w-[64px] shrink-0 flex-col items-center justify-center gap-1 rounded-[var(--radius-md)] px-1 py-2 text-[0.625rem] font-medium leading-tight transition-colors ${
              tool === item.id && panelOpen ? 'bg-[var(--brand-accent-soft)] text-[var(--brand-accent)]' : 'text-[var(--text-secondary)] hover:bg-[var(--bg-surface-hover)] hover:text-[var(--text-primary)]'}`}>
            <BrandIcon name={item.icon} size={18} />
            <span className="max-w-full text-center">{item.label}</span>
          </button>
        ))}
      </nav>
      {panelOpen && (
        <aside aria-label={toolTitle} data-testid="collage-tool-panel"
          className="order-3 max-h-[38dvh] w-full shrink-0 overflow-y-auto border-t border-[var(--border-subtle)] bg-[var(--bg-surface)] lg:order-none lg:max-h-none lg:w-[300px] lg:border-r lg:border-t-0">
          <div className="flex items-center justify-between border-b border-[var(--border-subtle)] px-3 py-2">
            <h2 className="text-xs font-semibold text-[var(--text-primary)]">{toolTitle}</h2>
            <button type="button" onClick={() => setPanelOpen(false)} aria-label={STRINGS.collage.closePanel} title={STRINGS.collage.closePanel}
              className="inline-flex h-8 w-8 items-center justify-center rounded text-[var(--text-muted)] hover:bg-[var(--bg-surface-hover)] hover:text-[var(--text-primary)]">
              <BrandIcon name="close" size={14} />
            </button>
          </div>
          <div className="space-y-3 p-3">
            <p role="status" aria-live="polite" className={status ? 'rounded bg-[var(--bg-input)] p-2 text-xs' : 'sr-only'}>{status}</p>
            {toolBody()}
          </div>
        </aside>
      )}
      {/* Every page side by side; the selected page is the one being edited. */}
      <div ref={stageRef} role="region" aria-label={STRINGS.collage.collagePages} data-testid="collage-stage"
        className="order-1 flex min-h-[220px] min-w-0 flex-1 items-center gap-6 overflow-x-auto overflow-y-hidden px-6 py-3 lg:order-none"
        onPointerDown={(e) => { if (e.target === e.currentTarget) setActiveSlot(null); }}>
        {doc.pages.map(pageCard)}
        <button type="button" data-testid="collage-add-page" disabled={doc.pages.length >= MAX_COLLAGE_PAGES}
          onClick={() => { onChange(addCollagePage(doc, page.template)); setActiveSlot(null); }}
          className="mt-9 flex shrink-0 flex-col items-center justify-center gap-2 rounded-[var(--radius-md)] border-2 border-dashed border-[var(--border-default)] text-xs font-medium text-[var(--text-secondary)] hover:border-[var(--brand-accent)] hover:text-[var(--brand-accent)] disabled:opacity-40"
          style={{ width: Math.max(96, pageWidth * 0.35), height: pageWidth / aspect }}>
          <BrandIcon name="plus" size={20} />
          {STRINGS.collage.addPage}
        </button>
        {doc.pages.length >= MAX_COLLAGE_PAGES && <span role="status">{STRINGS.collage.pageLimit(MAX_COLLAGE_PAGES)}</span>}
      </div>
      {menu && <ContextMenu menu={menu} onClose={closeMenu} />}
      {sourceProject && onBrowseProject && onAddFromProject && (
        <SourcePicker projects={projects} sourceProject={sourceProject} onProject={setSourceProject}
          onBrowseProject={onBrowseProject} onAddFromProject={onAddFromProject} onClose={closeSourcePicker} />
      )}
    </section>
  );
}

/** A read-only page beside the one being edited: background, photographs in their windows, caption. */
function PagePreview({ page, photos, width, aspect, aspectOf, PhotoSurface }: { page: CollagePage; photos: Photo[]; width: number; aspect: number;
  aspectOf: (id: string) => number; PhotoSurface?: React.ComponentType<PhotoSurfaceProps> }) {
  const background = photos.find((p) => p.id === page.backgroundPhotoId);
  const caption = collageCaptionGeometry(width, width / aspect, page.captionStyle);
  return (
    <>
      {background && <BackgroundPhoto photo={background} PhotoSurface={PhotoSurface} />}
      {page.slots.map((item) => {
        const source = photos.find((p) => p.id === item.photoId);
        const gap = page.gap / 2;
        const windowAspect = (Math.max(1, item.width - page.gap) * aspect) / Math.max(1, item.height - page.gap);
        const place = source ? collageSlotPlacement(aspectOf(source.id), windowAspect, item) : null;
        return (
          <span key={item.id} className="pointer-events-none absolute overflow-hidden bg-black/10"
            style={{ left: `${item.x + gap}%`, top: `${item.y + gap}%`, width: `${Math.max(1, item.width - gap * 2)}%`,
              height: `${Math.max(1, item.height - gap * 2)}%`, transform: `rotate(${item.angle}deg)`, clipPath: item.clip }}>
            {source && place && (
              <span className="absolute block" style={{ left: `${place.left * 100}%`, top: `${place.top * 100}%`, width: `${place.width * 100}%`, height: `${place.height * 100}%` }}>
                {PhotoSurface
                  ? <PhotoSurface photoId={source.id} variant="edited" alt="" className="h-full w-full" />
                  : <img src={source.previewUrl} alt="" draggable={false} className="h-full w-full object-cover" />}
              </span>
            )}
          </span>
        );
      })}
      {page.caption && <span className="pointer-events-none absolute inset-[3%_5%] z-20 block overflow-hidden">
        <span className="absolute block w-full whitespace-pre-wrap break-words text-center font-semibold"
          style={{ color: page.captionColour, fontFamily: caption.font, fontSize: caption.fontPx, lineHeight: caption.lineHeight,
            top: `${caption.position}%`, transform: `translateY(-${caption.position}%)` }}>{page.caption}</span>
      </span>}
    </>
  );
}

/** A background photograph filling the page, as the export draws it (cover, centred). */
function BackgroundPhoto({ photo, PhotoSurface }: { photo: Photo; PhotoSurface?: React.ComponentType<PhotoSurfaceProps> }) {
  return (
    <span className="pointer-events-none absolute inset-0 block" data-testid="collage-background-photo">
      {PhotoSurface
        ? <PhotoSurface photoId={photo.id} variant="edited" alt="" className="h-full w-full" />
        : <img src={photo.previewUrl} alt="" draggable={false} className="h-full w-full object-cover" />}
    </span>
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
