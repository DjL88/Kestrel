/**
 * Image layers (owner-approved, 25 Nov 2026): a logo or another picture placed over the photo, for a simple composite.
 * Pure shape and validation; drawing is in layerCompose.ts. A layer stores only a link to its image (a SHA-256 id in
 * this device's layer store) and how it sits on the framed photo, so it is reversible and never changes an original.
 */
export type LayerBlend = 'normal' | 'darken' | 'lighten';
export type LayerShape = 'rectangle' | 'oval';

export interface PhotoLayer {
  id: string;
  /** SHA-256 id of the image in this device's layer store. */
  assetId: string;
  /** What the person called it (the file name, or the photo it was copied from). */
  label: string;
  /** Height divided by width of the image, so the layer keeps its shape. */
  aspect: number;
  /** Centre, 0 to 1 across the framed photo's width and height. */
  x: number;
  y: number;
  /** Width as a share of the framed photo's width, 0.02 to 3. */
  width: number;
  /** Turn in degrees, -180 to 180. */
  rotation: number;
  /** 0 to 1. */
  opacity: number;
  blend: LayerBlend;
  /** How far the edge fades, as a share of the layer's shorter side, 0 to 0.5. */
  softEdge: number;
  shape: LayerShape;
  hidden: boolean;
}

export const MAX_LAYERS = 8;
export const LAYER_BLENDS: readonly LayerBlend[] = ['normal', 'darken', 'lighten'];
export const LAYER_SHAPES: readonly LayerShape[] = ['rectangle', 'oval'];

const finite = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v);
const within = (v: unknown, low: number, high: number): v is number => finite(v) && v >= low && v <= high;

export function validLayer(value: unknown): value is PhotoLayer {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return false;
  const l = value as Record<string, unknown>;
  return typeof l.id === 'string' && l.id.length > 0 && l.id.length <= 64
    && typeof l.assetId === 'string' && /^[a-f0-9]{64}$/.test(l.assetId)
    && typeof l.label === 'string' && l.label.length <= 120
    && within(l.aspect, 0.01, 100) && within(l.x, -1, 2) && within(l.y, -1, 2) && within(l.width, 0.02, 3)
    && within(l.rotation, -180, 180) && within(l.opacity, 0, 1) && within(l.softEdge, 0, 0.5)
    && (LAYER_BLENDS as readonly unknown[]).includes(l.blend) && (LAYER_SHAPES as readonly unknown[]).includes(l.shape)
    && typeof l.hidden === 'boolean';
}

/** The valid layers kept with a photo, bottom first. Anything malformed is left out rather than guessed at. */
export function readLayers(raw: unknown): PhotoLayer[] {
  if (!Array.isArray(raw)) return [];
  const seen = new Set<string>();
  return raw.filter((layer): layer is PhotoLayer => {
    if (!validLayer(layer) || seen.has(layer.id)) return false;
    seen.add(layer.id);
    return true;
  }).slice(0, MAX_LAYERS);
}

/** Layers kept inside the photo's V2 overlay record (so they share its saving, backup and undo). */
export function frameLayers(overlay: unknown): PhotoLayer[] {
  return overlay && typeof overlay === 'object' ? readLayers((overlay as { layers?: unknown }).layers) : [];
}

export const visibleLayers = (layers: readonly PhotoLayer[]) => layers.filter((layer) => !layer.hidden && layer.opacity > 0);

/**
 * Alpha (0 to 1) of the soft edge at a point of the layer, u and v from 0 to 1 across it. `aspect` is the layer's
 * height over width, so the fade has the same width on every side.
 */
export function softEdgeAlpha(u: number, v: number, shape: LayerShape, softEdge: number, aspect: number): number {
  if (softEdge <= 0 && shape === 'rectangle') return 1;
  if (shape === 'oval') {
    const dx = (u - 0.5) * 2, dy = (v - 0.5) * 2;
    const r = Math.sqrt(dx * dx + dy * dy); // 1 on the ellipse
    // softEdge 0.5 fades all the way from the centre; 0 is a crisp oval edge (a one-percent fade avoids a jagged rim).
    const inner = 1 - Math.max(0.01, Math.min(1, softEdge * 2));
    if (r >= 1) return 0;
    if (r <= inner) return 1;
    const t = (1 - r) / (1 - inner);
    return t * t * (3 - 2 * t);
  }
  const fade = softEdge * Math.min(1, aspect); // in units of the layer's width
  const distance = Math.min(u, 1 - u, (v * aspect), (1 - v) * aspect); // in units of width
  if (distance >= fade) return 1;
  const t = Math.max(0, distance / fade);
  return t * t * (3 - 2 * t);
}
