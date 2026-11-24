/** Collage/album documents share the normal local photo catalogue. Only recipes and references are saved. */
export type CollageFormat = 'square' | 'portrait' | 'story' | 'landscape' | 'a4-portrait' | 'a4-landscape' | 'a5-portrait' | '12x12-album';
export type CollageTemplate = 'triptych' | 'grid' | 'editorial' | 'diagonal' | 'scattered' | 'hero' | 'panorama';
export interface CollageSlot {
  id: string;
  photoId: string | null;
  /** Percentages of page width and height; rotation is in degrees. */
  x: number; y: number; width: number; height: number; angle: number;
  /** Polygon vertices, in percentages of the slot. */
  clip?: string;
  /** How the photograph sits in its window. Zoom 1 fills the window; pan -1..1 moves
   * from one edge of the picture to the other (0 is centred). Omitted means centred and filled. */
  zoom?: number; panX?: number; panY?: number;
}
export const COLLAGE_CAPTION_FONTS = ['sans-serif', 'serif', 'monospace'] as const;
export type CollageCaptionFont = typeof COLLAGE_CAPTION_FONTS[number];
export interface CollageCaptionStyle {
  font: CollageCaptionFont;
  /** Font size as a percentage of the page width. */
  size: number;
  /** Vertical position in the available safe area: 0 top, 50 middle, 100 bottom. */
  position: number;
}
export const DEFAULT_COLLAGE_CAPTION_STYLE: CollageCaptionStyle = { font: 'sans-serif', size: 2.5, position: 100 };
export function collageCaptionStyle(raw: unknown): CollageCaptionStyle {
  const style = raw && typeof raw === 'object' ? raw as Partial<CollageCaptionStyle> : {};
  const bounded = (value: unknown, fallback: number, min: number, max: number) =>
    typeof value === 'number' && Number.isFinite(value) ? Math.max(min, Math.min(max, value)) : fallback;
  return {
    font: COLLAGE_CAPTION_FONTS.includes(style.font as CollageCaptionFont) ? style.font! : 'sans-serif',
    size: bounded(style.size, 2.5, 1, 6),
    position: bounded(style.position, 100, 0, 100),
  };
}
/** Shared safe area and line height for canvas and editor, in output page pixels. */
export function collageCaptionGeometry(width: number, height: number, raw: unknown) {
  const style = collageCaptionStyle(raw);
  return { ...style, x: width * .05, y: height * .03, width: width * .9, height: height * .94,
    fontPx: width * style.size / 100, lineHeight: 1.2 };
}
export interface CollagePage {
  id: string;
  template: CollageTemplate;
  /** Custom page-relative windows are preserved across page sizes. */
  customLayout?: true;
  slots: CollageSlot[];
  background: string;
  gap: number;
  caption: string;
  captionColour: string;
  captionStyle?: CollageCaptionStyle;
}
export interface CollageDocument {
  version: 1;
  format: CollageFormat;
  pages: CollagePage[];
  activePageId: string;
}
export const COLLAGE_FORMATS: Record<CollageFormat, { label: string; width: number; height: number; unit: 'px' | 'mm' }> = {
  square: { label: 'Square · 1080 × 1080', width: 1080, height: 1080, unit: 'px' },
  portrait: { label: 'Social portrait · 1080 × 1350', width: 1080, height: 1350, unit: 'px' },
  story: { label: 'Story · 1080 × 1920', width: 1080, height: 1920, unit: 'px' },
  landscape: { label: 'Landscape · 1920 × 1080', width: 1920, height: 1080, unit: 'px' },
  'a4-portrait': { label: 'A4 portrait · 210 × 297 mm', width: 210, height: 297, unit: 'mm' },
  'a4-landscape': { label: 'A4 landscape · 297 × 210 mm', width: 297, height: 210, unit: 'mm' },
  'a5-portrait': { label: 'A5 portrait · 148 × 210 mm', width: 148, height: 210, unit: 'mm' },
  '12x12-album': { label: 'Album · 12 × 12 in', width: 304.8, height: 304.8, unit: 'mm' },
};
const polygonA = 'polygon(0 0, 100% 0, 89% 100%, 0 100%)';
const polygonB = 'polygon(12% 0, 100% 0, 100% 100%, 0 100%)';
// The same angled cut turned on its side, for tall pages.
const polygonAT = 'polygon(0 0, 100% 0, 100% 89%, 0 100%)';
const polygonBT = 'polygon(0 12%, 100% 0, 100% 100%, 0 100%)';
const CLIPS = [polygonA, polygonB, polygonAT, polygonBT];
const TRANSPOSED_CLIP: Record<string, string> = { [polygonA]: polygonAT, [polygonB]: polygonBT };
type SlotShape = Omit<CollageSlot, 'id' | 'photoId' | 'zoom' | 'panX' | 'panY'>;
export const MAX_COLLAGE_ZOOM = 8;
const shapes: Record<CollageTemplate, SlotShape[]> = {
  triptych: [
    { x: 4, y: 6, width: 29, height: 88, angle: 0 },
    { x: 35, y: 6, width: 30, height: 88, angle: 0 },
    { x: 67, y: 6, width: 29, height: 88, angle: 0 },
  ],
  grid: [
    { x: 4, y: 4, width: 44, height: 44, angle: 0 },
    { x: 52, y: 4, width: 44, height: 44, angle: 0 },
    { x: 4, y: 52, width: 44, height: 44, angle: 0 },
    { x: 52, y: 52, width: 44, height: 44, angle: 0 },
  ],
  editorial: [
    { x: 4, y: 5, width: 58, height: 90, angle: 0 },
    { x: 65, y: 5, width: 31, height: 43, angle: 0 },
    { x: 65, y: 52, width: 31, height: 43, angle: 0 },
  ],
  diagonal: [
    { x: 4, y: 7, width: 49, height: 86, angle: 0, clip: polygonA },
    { x: 47, y: 7, width: 49, height: 86, angle: 0, clip: polygonB },
  ],
  scattered: [
    { x: 7, y: 11, width: 46, height: 55, angle: -8 },
    { x: 47, y: 18, width: 45, height: 61, angle: 7 },
    { x: 27, y: 57, width: 44, height: 33, angle: -3 },
  ],
  hero: [
    { x: 3, y: 4, width: 94, height: 62, angle: 0 },
    { x: 3, y: 69, width: 45, height: 27, angle: 0 },
    { x: 52, y: 69, width: 45, height: 27, angle: 0 },
  ],
  panorama: [
    { x: 4, y: 4, width: 92, height: 29, angle: 0 },
    { x: 4, y: 36, width: 92, height: 29, angle: 0 },
    { x: 4, y: 68, width: 92, height: 28, angle: 0 },
  ],
};
/** Which way round a layout suits a page. Templates are drawn for a square page;
 * on a tall or wide page the ones with a clear direction turn on their side, so
 * columns become rows instead of being stretched into slivers. */
export function collageOrientation(aspect: number): 'tall' | 'square' | 'wide' {
  return aspect < 0.8 ? 'tall' : aspect > 1.25 ? 'wide' : 'square';
}
const TURN_WHEN: Partial<Record<CollageTemplate, 'tall' | 'wide'>> = {
  triptych: 'tall', editorial: 'tall', diagonal: 'tall', panorama: 'wide', hero: 'wide',
};
export function collageFormatAspect(format: CollageFormat): number {
  return COLLAGE_FORMATS[format].width / COLLAGE_FORMATS[format].height;
}
/** The window shapes of a template on a page of this shape (width ÷ height). */
export function collageShapes(template: CollageTemplate, aspect = 1): SlotShape[] {
  const turn = TURN_WHEN[template] !== undefined && TURN_WHEN[template] === collageOrientation(aspect);
  return shapes[template].map((shape) => !turn ? { ...shape } : {
    x: shape.y, y: shape.x, width: shape.height, height: shape.width, angle: shape.angle,
    ...(shape.clip ? { clip: TRANSPOSED_CLIP[shape.clip] } : {}),
  });
}
export const MAX_COLLAGE_PAGES = 200;
export const MAX_COLLAGE_WINDOWS = 12;
export const MAX_COLLAGE_SELECTION = MAX_COLLAGE_PAGES * shapes.grid.length;
export const MAX_COLLAGE_EXPORT_PAGES = 40;

let sequence = 0;
const nextId = () => `collage-${++sequence}-${Date.now().toString(36)}`;
export const COLLAGE_TEMPLATES = (Object.keys(shapes) as CollageTemplate[]).map((id) => ({
  id, label: ({ triptych: 'Three panels', grid: 'Four-up', editorial: 'Editorial', diagonal: 'Angled split', scattered: 'Scattered prints', hero: 'Hero + details', panorama: 'Story strips' } as Record<CollageTemplate,string>)[id],
  slots: shapes[id].length,
}));
export function newCollagePage(template: CollageTemplate = 'triptych', photoIds: readonly string[] = [], aspect = 1): CollagePage {
  return { id: nextId(), template, background: '#ffffff', gap: 1.5, caption: '', captionColour: '#202020',
    slots: collageShapes(template, aspect).map((shape, i) => ({ ...shape, id: nextId(), photoId: photoIds[i] ?? null })) };
}
export function createCollage(photoIds: readonly string[] = [], format: CollageFormat = 'square'): CollageDocument {
  if (photoIds.length > MAX_COLLAGE_SELECTION) throw new Error(`Choose up to ${MAX_COLLAGE_SELECTION} photographs per collage.`);
  // Populate as many pages as necessary. The photos do not disappear from the
  // composition just because the chosen template has fewer windows.
  const template: CollageTemplate = photoIds.length === 2 ? 'diagonal' : photoIds.length >= 4 ? 'grid' : 'triptych';
  const pageSize = shapes[template].length;
  const pages = photoIds.length
    ? Array.from({ length: Math.ceil(photoIds.length / pageSize) }, (_, index) =>
      newCollagePage(template, photoIds.slice(index * pageSize, (index + 1) * pageSize), collageFormatAspect(format)))
    : [newCollagePage(template, [], collageFormatAspect(format))];
  return { version: 1, format, pages, activePageId: pages[0].id };
}
export function collagePage(doc: CollageDocument): CollagePage {
  return doc.pages.find((p) => p.id === doc.activePageId) ?? doc.pages[0];
}
export function modifyCollagePage(doc: CollageDocument, patch: Partial<Omit<CollagePage,'id' | 'slots' | 'template'>>): CollageDocument {
  return { ...doc, pages: doc.pages.map((p) => p.id === doc.activePageId ? { ...p, ...patch } : p) };
}
export function replaceCollagePhoto(doc: CollageDocument, slotId: string, photoId: string | null): CollageDocument {
  return { ...doc, pages: doc.pages.map((p) => p.id === doc.activePageId
    ? { ...p, slots: p.slots.map((s) => s.id === slotId ? { ...s, photoId } : s) } : p) };
}
export function canChangeCollageTemplate(doc: CollageDocument, template: CollageTemplate): boolean {
  const assigned = collagePage(doc).slots.filter(slot => slot.photoId !== null).length;
  const pagesNeeded = Math.max(1, Math.ceil(assigned / shapes[template].length));
  return doc.pages.length - 1 + pagesNeeded <= MAX_COLLAGE_PAGES;
}
export function changeCollageTemplate(doc: CollageDocument, template: CollageTemplate): CollageDocument {
  if (!canChangeCollageTemplate(doc, template)) return doc;
  const old = collagePage(doc);
  if (old.template === template && !old.customLayout) return doc;
  const assigned = old.slots.filter((slot): slot is CollageSlot & { photoId: string } => slot.photoId !== null);
  const capacity = shapes[template].length;
  const aspect = collageFormatAspect(doc.format);
  const pageWithFraming = (entries: typeof assigned) => {
    const page = newCollagePage(template, entries.map(slot => slot.photoId), aspect);
    return { ...page, slots: page.slots.map((slot, index) => {
      const source = entries[index];
      if (!source) return slot;
      return { ...slot, ...(source.zoom !== undefined ? { zoom: source.zoom } : {}),
        ...(source.panX !== undefined ? { panX: source.panX } : {}), ...(source.panY !== undefined ? { panY: source.panY } : {}) };
    }) };
  };
  const redesigned = pageWithFraming(assigned.slice(0, capacity));
  const overflow = assigned.slice(capacity);
  // Smaller layouts create following pages for extra photographs, without
  // overwriting the layout, assignments or captions on other existing pages.
  const extraPages = Array.from({ length: Math.ceil(overflow.length / capacity) }, (_, index) => {
    const page = pageWithFraming(overflow.slice(index * capacity, (index + 1) * capacity));
    return { ...page, background: old.background, gap: old.gap, captionColour: old.captionColour, ...(old.captionStyle ? { captionStyle: { ...old.captionStyle } } : {}) };
  });
  const pages = doc.pages.flatMap((p) => p.id === old.id
    ? [{ ...redesigned, id: old.id, background: old.background, gap: old.gap,
      caption: old.caption, captionColour: old.captionColour, ...(old.captionStyle ? { captionStyle: { ...old.captionStyle } } : {}) }, ...extraPages] : [p]);
  return { ...doc, pages };
}
export function addCollagePage(doc: CollageDocument, template: CollageTemplate = 'triptych'): CollageDocument {
  if (doc.pages.length >= MAX_COLLAGE_PAGES) return doc;
  const page = newCollagePage(template, [], collageFormatAspect(doc.format));
  return { ...doc, pages: [...doc.pages, page], activePageId: page.id };
}
/** A new page size re-lays every page for its shape. Photographs, their framing,
 * window ids, captions and colours stay; only the window geometry changes. */
export function changeCollageFormat(doc: CollageDocument, format: CollageFormat): CollageDocument {
  if (!Object.hasOwn(COLLAGE_FORMATS, format) || format === doc.format) return doc;
  const aspect = collageFormatAspect(format);
  return { ...doc, format, pages: doc.pages.map((page) => {
    if (page.customLayout) return page;
    const layout = collageShapes(page.template, aspect);
    if (layout.length !== page.slots.length) return page;
    return { ...page, slots: page.slots.map((slot, i) => {
      const { clip: _old, ...kept } = slot;
      return { ...kept, ...layout[i] };
    }) };
  }) };
}
/** Add an empty, independently editable frame without modifying any photo references. */
export function addCollageWindow(doc: CollageDocument): CollageDocument {
  const page = collagePage(doc);
  if (page.slots.length >= MAX_COLLAGE_WINDOWS) return doc;
  const n = page.slots.length;
  const offset = (n * 7) % 36;
  const slot: CollageSlot = { id: nextId(), photoId: null, x: 12 + offset, y: 12 + offset, width: 40, height: 40, angle: 0 };
  return { ...doc, pages: doc.pages.map(p => p.id === page.id ? { ...p, customLayout: true, slots: [...p.slots, slot] } : p) };
}
/** Only empty frames can be deleted: removing a frame must never silently discard a photograph placement. */
export function removeCollageWindow(doc: CollageDocument, id: string): CollageDocument {
  const page = collagePage(doc);
  if (!page.slots.some(s => s.id === id && s.photoId === null)) return doc;
  return { ...doc, pages: doc.pages.map(p => p.id === page.id ? { ...p, customLayout: true, slots: p.slots.filter(s => s.id !== id) } : p) };
}
/** Geometry is expressed in page percentages, not source image pixels. The centre stays stable when resizing. */
export function setCollageWindowGeometry(doc: CollageDocument, id: string, patch: Partial<Pick<CollageSlot, 'x' | 'y' | 'width' | 'height' | 'angle'>>): CollageDocument {
  const page = collagePage(doc);
  if (!page.slots.some(s => s.id === id)) return doc;
  const clamp = (value: number | undefined, fallback: number, min: number, max: number) =>
    Math.min(max, Math.max(min, typeof value === 'number' && Number.isFinite(value) ? value : fallback));
  return { ...doc, pages: doc.pages.map(p => p.id !== page.id ? p : {
    ...p, customLayout: true, slots: p.slots.map(s => {
      if (s.id !== id) return s;
      const width = clamp(patch.width, s.width, 5, 100);
      const height = clamp(patch.height, s.height, 5, 100);
      const x = clamp(patch.x, s.x + (s.width - width) / 2, 0, 100 - width);
      const y = clamp(patch.y, s.y + (s.height - height) / 2, 0, 100 - height);
      return { ...s, x, y, width, height, angle: clamp(patch.angle, s.angle, -180, 180) };
    }),
  }) };
}
/** Zoom and position the photograph inside one window of the active page. */
export function setCollageSlotFraming(doc: CollageDocument, slotId: string, framing: { zoom?: number; panX?: number; panY?: number }): CollageDocument {
  const clamp = (value: number, min: number, max: number) => Math.min(max, Math.max(min, value));
  return { ...doc, pages: doc.pages.map((p) => p.id !== doc.activePageId ? p : { ...p, slots: p.slots.map((s) => {
    if (s.id !== slotId) return s;
    const zoom = clamp(Number.isFinite(framing.zoom) ? framing.zoom! : s.zoom ?? 1, 1, MAX_COLLAGE_ZOOM);
    const panX = clamp(Number.isFinite(framing.panX) ? framing.panX! : s.panX ?? 0, -1, 1);
    const panY = clamp(Number.isFinite(framing.panY) ? framing.panY! : s.panY ?? 0, -1, 1);
    const { zoom: _z, panX: _x, panY: _y, ...rest } = s;
    return zoom === 1 && panX === 0 && panY === 0 ? rest : { ...rest, zoom, panX, panY };
  }) }) };
}
/** Put a photograph in a window. A new photograph starts centred and filled. */
export function placeCollagePhoto(doc: CollageDocument, slotId: string, photoId: string | null): CollageDocument {
  return setCollageSlotFraming(replaceCollagePhoto(doc, slotId, photoId), slotId, { zoom: 1, panX: 0, panY: 0 });
}
/** Several photographs dropped on the page fill its empty windows in order. Extra photographs are not placed. */
export function fillEmptyCollageSlots(doc: CollageDocument, photoIds: readonly string[]): { doc: CollageDocument; placed: number } {
  let next = doc;
  let placed = 0;
  for (const slot of collagePage(doc).slots) {
    if (placed >= photoIds.length) break;
    if (slot.photoId !== null) continue;
    next = placeCollagePhoto(next, slot.id, photoIds[placed]);
    placed += 1;
  }
  return { doc: next, placed };
}
/** Where a photograph sits in its window, as the share of the picture that shows.
 * Width and height are the picture's size relative to the window (always 1 or more),
 * left and top its offset (0 or less), all in window units. Preview and export both use this. */
export function collageSlotPlacement(imageAspect: number, windowAspect: number, slot: Pick<CollageSlot, 'zoom' | 'panX' | 'panY'>) {
  const zoom = Math.min(MAX_COLLAGE_ZOOM, Math.max(1, slot.zoom ?? 1));
  const safeImage = imageAspect > 0 && Number.isFinite(imageAspect) ? imageAspect : 1;
  const safeWindow = windowAspect > 0 && Number.isFinite(windowAspect) ? windowAspect : 1;
  const width = (safeImage > safeWindow ? safeImage / safeWindow : 1) * zoom;
  const height = (safeImage > safeWindow ? 1 : safeWindow / safeImage) * zoom;
  const pan = (value: number | undefined) => Math.min(1, Math.max(-1, value ?? 0));
  return { width, height, left: ((1 - width) / 2) * (1 + pan(slot.panX)), top: ((1 - height) / 2) * (1 + pan(slot.panY)) };
}
export function duplicateCollagePage(doc: CollageDocument): CollageDocument {
  if (doc.pages.length >= MAX_COLLAGE_PAGES) return doc;
  const old = collagePage(doc);
  const copy = { ...old, ...(old.captionStyle ? { captionStyle: { ...old.captionStyle } } : {}), id: nextId(), slots: old.slots.map((s) => ({ ...s, id: nextId() })) };
  const index = doc.pages.findIndex((p) => p.id === old.id);
  const pages = doc.pages.slice();
  pages.splice(index + 1, 0, copy);
  return { ...doc, pages, activePageId: copy.id };
}
export function deleteCollagePage(doc: CollageDocument): CollageDocument {
  if (doc.pages.length <= 1) return doc;
  const pages = doc.pages.filter((p) => p.id !== doc.activePageId);
  return { ...doc, pages, activePageId: pages[Math.min(pages.length - 1, Math.max(0, doc.pages.findIndex((p) => p.id === doc.activePageId) - 1))].id };
}
/** Ignore malformed saved collage content, preserving access to the underlying photo library. */
export function readCollage(value: unknown): CollageDocument | null {
  if (!value || typeof value !== 'object') return null;
  const doc = value as Partial<CollageDocument>;
  if (doc.version !== 1 || !doc.format || !Object.hasOwn(COLLAGE_FORMATS, doc.format) || !Array.isArray(doc.pages) ||
      doc.pages.length === 0 || doc.pages.length > MAX_COLLAGE_PAGES) return null;
  if (!doc.pages.every((page) => page && typeof page.id === 'string' && Object.hasOwn(shapes, page.template) &&
    typeof page.background === 'string' && /^#[0-9a-fA-F]{6}$/.test(page.background) &&
    typeof page.gap === 'number' && Number.isFinite(page.gap) && page.gap >= 0 && page.gap <= 12 &&
    typeof page.caption === 'string' && page.caption.length <= 1000 &&
    typeof page.captionColour === 'string' && /^#[0-9a-fA-F]{6}$/.test(page.captionColour) &&
    (page.customLayout === undefined || page.customLayout === true) &&
    Array.isArray(page.slots) && page.slots.length <= MAX_COLLAGE_WINDOWS && page.slots.every((s) => s && typeof s.id === 'string' &&
      (s.photoId === null || typeof s.photoId === 'string') && [s.x,s.y,s.width,s.height,s.angle].every(Number.isFinite) && s.x >= 0 && s.y >= 0 && s.width > 0 && s.height > 0 && s.x+s.width <= 100 && s.y+s.height <= 100 && Math.abs(s.angle) <= 180 && (s.clip === undefined || CLIPS.includes(s.clip)) &&
      (s.zoom === undefined || (Number.isFinite(s.zoom) && s.zoom >= 1 && s.zoom <= MAX_COLLAGE_ZOOM)) &&
      [s.panX, s.panY].every((v) => v === undefined || (Number.isFinite(v) && v >= -1 && v <= 1))))) return null;
  if (new Set(doc.pages.map(p => p.id)).size !== doc.pages.length || doc.pages.some(p => new Set(p.slots.map(s => s.id)).size !== p.slots.length)) return null;
  if (!doc.activePageId || !doc.pages.some((p) => p.id === doc.activePageId)) return null;
  // Old pages deliberately retain their original serialised shape.
  return { ...doc, pages: doc.pages.map(page => page.captionStyle === undefined ? page :
    { ...page, captionStyle: collageCaptionStyle(page.captionStyle) }) } as CollageDocument;
}

/** One-based page numbers, including both ends, as displayed in the editor. */
export function collageExportPages(doc: CollageDocument, allPages: boolean, range?: { first: number; last: number }) {
  if (!range && !allPages) return [collagePage(doc)];
  const { first, last } = range ?? { first: 1, last: doc.pages.length };
  if (!Number.isInteger(first) || !Number.isInteger(last) || first < 1 || first > last || last > doc.pages.length) {
    throw new Error(`Choose a page range between 1 and ${doc.pages.length}.`);
  }
  if (last - first + 1 > MAX_COLLAGE_EXPORT_PAGES) throw new Error(`Choose up to ${MAX_COLLAGE_EXPORT_PAGES} pages per export.`);
  return doc.pages.slice(first - 1, last);
}
