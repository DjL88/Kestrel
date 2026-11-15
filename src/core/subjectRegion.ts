import type { SubjectGrid } from './maskTypes';

/** A rectangle on the framed (cropped) photo, as fractions of its width and height. */
export interface Region { x: number; y: number; w: number; h: number }

/** Smallest area worth detecting in, as a fraction of each side. Anything smaller is treated as a tap, not an area. */
export const MIN_REGION = 0.04;

/** Turn two dragged corners into a region clamped to the photo, or null if it is too small. */
export function regionFromCorners(a: { x: number; y: number }, b: { x: number; y: number }): Region | null {
  const clamp = (v: number) => Math.min(1, Math.max(0, v));
  const x0 = clamp(Math.min(a.x, b.x)), x1 = clamp(Math.max(a.x, b.x));
  const y0 = clamp(Math.min(a.y, b.y)), y1 = clamp(Math.max(a.y, b.y));
  return x1 - x0 < MIN_REGION || y1 - y0 < MIN_REGION ? null : { x: x0, y: y0, w: x1 - x0, h: y1 - y0 };
}

function decode(grid: SubjectGrid): Uint8Array {
  const binary = atob(grid.data);
  const bytes = new Uint8Array(grid.w * grid.h);
  for (let i = 0; i < bytes.length; i += 1) bytes[i] = binary.charCodeAt(i);
  return bytes;
}

function encode(bytes: Uint8Array, w: number, h: number): SubjectGrid {
  let binary = '';
  for (let i = 0; i < bytes.length; i += 1) binary += String.fromCharCode(bytes[i]);
  return { w, h, data: btoa(binary) };
}

/**
 * Place a grid found inside a region back onto a grid covering the whole framed photo. Cells outside the region are
 * empty, and cells inside sample the local grid at the matching position, so the mask keeps its true size and place.
 */
export function placeInRegion(local: SubjectGrid, region: Region, fullW: number, fullH: number): SubjectGrid {
  const source = decode(local);
  const out = new Uint8Array(fullW * fullH);
  for (let y = 0; y < fullH; y += 1) {
    const ny = (y + 0.5) / fullH;
    if (ny < region.y || ny >= region.y + region.h) continue;
    const ly = Math.min(local.h - 1, Math.floor(((ny - region.y) / region.h) * local.h));
    for (let x = 0; x < fullW; x += 1) {
      const nx = (x + 0.5) / fullW;
      if (nx < region.x || nx >= region.x + region.w) continue;
      const lx = Math.min(local.w - 1, Math.floor(((nx - region.x) / region.w) * local.w));
      out[y * fullW + x] = source[ly * local.w + lx];
    }
  }
  return encode(out, fullW, fullH);
}

/** Pixel rectangle of a region on a canvas of the given size, for cutting out the area to detect in. */
export function regionPixels(region: Region, width: number, height: number) {
  const x = Math.round(region.x * width), y = Math.round(region.y * height);
  return { x, y, w: Math.max(1, Math.min(width - x, Math.round(region.w * width))), h: Math.max(1, Math.min(height - y, Math.round(region.h * height))) };
}
