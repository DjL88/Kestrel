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
}
export interface CollagePage {
  id: string;
  template: CollageTemplate;
  slots: CollageSlot[];
  background: string;
  gap: number;
  caption: string;
  captionColour: string;
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
type SlotShape = Omit<CollageSlot, 'id' | 'photoId'>;
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
let sequence = 0;
const nextId = () => `collage-${++sequence}-${Date.now().toString(36)}`;
export const COLLAGE_TEMPLATES = (Object.keys(shapes) as CollageTemplate[]).map((id) => ({
  id, label: ({ triptych: 'Three panels', grid: 'Four-up', editorial: 'Editorial', diagonal: 'Angled split', scattered: 'Scattered prints', hero: 'Hero + details', panorama: 'Story strips' } as Record<CollageTemplate,string>)[id],
  slots: shapes[id].length,
}));
export function newCollagePage(template: CollageTemplate = 'triptych', photoIds: readonly string[] = []): CollagePage {
  return { id: nextId(), template, background: '#ffffff', gap: 1.5, caption: '', captionColour: '#202020',
    slots: shapes[template].map((shape, i) => ({ ...shape, id: nextId(), photoId: photoIds[i] ?? null })) };
}
export function createCollage(photoIds: readonly string[] = [], format: CollageFormat = 'square'): CollageDocument {
  // A selection of 5+ photographs becomes multiple editable pages rather than silently losing
  // the photos that do not fit the first template. Every photo remains available in the project library.
  const template: CollageTemplate = photoIds.length === 2 ? 'diagonal' :
    photoIds.length === 4 || photoIds.length > 4 ? 'grid' : 'triptych';
  const capacity = shapes[template].length;
  const pages = photoIds.length
    ? Array.from({ length: Math.ceil(photoIds.length / capacity) }, (_, index) =>
      newCollagePage(template, photoIds.slice(index * capacity, (index + 1) * capacity)))
    : [newCollagePage(template)];
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
export function changeCollageTemplate(doc: CollageDocument, template: CollageTemplate): CollageDocument {
  const old = collagePage(doc);
  const next = newCollagePage(template, old.slots.map((s) => s.photoId).filter((id): id is string => id !== null));
  return { ...doc, pages: doc.pages.map((p) => p.id === old.id ? { ...next, id: old.id, background: old.background, gap: old.gap,
    caption: old.caption, captionColour: old.captionColour } : p) };
}
export function addCollagePage(doc: CollageDocument, template: CollageTemplate = 'triptych'): CollageDocument {
  const page = newCollagePage(template);
  return { ...doc, pages: [...doc.pages, page], activePageId: page.id };
}
export function duplicateCollagePage(doc: CollageDocument): CollageDocument {
  const old = collagePage(doc);
  const copy = { ...old, id: nextId(), slots: old.slots.map((s) => ({ ...s, id: nextId() })) };
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
  if (doc.version !== 1 || !doc.format || !(doc.format in COLLAGE_FORMATS) || !Array.isArray(doc.pages) ||
      doc.pages.length === 0 || doc.pages.length > 200) return null;
  if (!doc.pages.every((page) => page && typeof page.id === 'string' && page.template in shapes &&
    typeof page.background === 'string' && /^#[0-9a-fA-F]{6}$/.test(page.background) &&
    typeof page.gap === 'number' && Number.isFinite(page.gap) && page.gap >= 0 && page.gap <= 12 &&
    typeof page.caption === 'string' && page.caption.length <= 1000 &&
    typeof page.captionColour === 'string' && /^#[0-9a-fA-F]{6}$/.test(page.captionColour) &&
    Array.isArray(page.slots) && page.slots.length <= 12 && page.slots.every((s) => s && typeof s.id === 'string' &&
      (s.photoId === null || typeof s.photoId === 'string') && [s.x,s.y,s.width,s.height,s.angle].every(Number.isFinite)))) return null;
  if (!doc.activePageId || !doc.pages.some((p) => p.id === doc.activePageId)) return null;
  return doc as CollageDocument;
}
