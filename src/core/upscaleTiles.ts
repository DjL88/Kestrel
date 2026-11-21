/**
 * Layer 2 plumbing for Upscale: run any tile-based super-resolution model over a whole photo with bounded memory.
 * Pure and model-agnostic: the model is a callback, so this is tested with stand-ins and the same code drives the
 * ONNX runtime in `src/providers/upscaleRuntime.ts`.
 *
 * Tiles overlap and are blended with a linear feather across the overlap, so no seam shows. Only the
 * output (8-bit RGB) plus one tile at a time is held. Cancelling stops between tiles and leaves nothing half-written
 * for the caller to keep.
 */
import type { PixelBuffer } from './upscaleResample';

export interface TileRect { x: number; y: number; width: number; height: number }

export interface TilePlan { tile: number; overlap: number; scale: 2 | 4; tiles: TileRect[]; columns: number; rows: number }

export const DEFAULT_TILE = 128;
export const DEFAULT_OVERLAP = 16;

/** Input rectangles in row-major order; neighbours share exactly `overlap` pixels, and the last one is pulled back to stay full size. */
export function planTiles(width: number, height: number, scale: 2 | 4, tile = DEFAULT_TILE, overlap = DEFAULT_OVERLAP): TilePlan {
  if (!Number.isSafeInteger(width) || !Number.isSafeInteger(height) || width < 1 || height < 1) throw new RangeError('Invalid image size.');
  if (!Number.isSafeInteger(tile) || tile < 8 || !Number.isSafeInteger(overlap) || overlap < 0 || overlap * 2 >= tile) throw new RangeError('Invalid tile or overlap size.');
  const starts = (size: number): number[] => {
    if (size <= tile) return [0];
    const step = tile - overlap;
    const out: number[] = [];
    for (let s = 0; s + tile < size; s += step) out.push(s);
    out.push(size - tile);
    return out;
  };
  const xs = starts(width), ys = starts(height);
  const tiles: TileRect[] = [];
  for (const y of ys) for (const x of xs) tiles.push({ x, y, width: Math.min(tile, width), height: Math.min(tile, height) });
  return { tile, overlap, scale, tiles, columns: xs.length, rows: ys.length };
}

export type TileModel = (tile: PixelBuffer<Uint8ClampedArray>) => Promise<PixelBuffer<Uint8ClampedArray>>;

export interface TiledUpscaleOptions {
  tile?: number;
  overlap?: number;
  signal?: AbortSignal;
  onProgress?: (fraction: number) => void;
}

function cropTile(src: PixelBuffer<Uint8ClampedArray>, r: TileRect): PixelBuffer<Uint8ClampedArray> {
  const data = new Uint8ClampedArray(r.width * r.height * 3);
  for (let y = 0; y < r.height; y++) {
    const from = ((r.y + y) * src.width + r.x) * 3;
    data.set(src.data.subarray(from, from + r.width * 3), y * r.width * 3);
  }
  return { data, width: r.width, height: r.height, channels: 3 };
}

/**
 * Enlarge an 8-bit RGB photo by 2 or 4 with a tile model. Throws if the model returns a tile of the wrong size
 * (it never guesses), and rejects on cancel.
 */
export async function upscaleTiled(src: PixelBuffer<Uint8ClampedArray>, scale: 2 | 4, model: TileModel, options: TiledUpscaleOptions = {}): Promise<PixelBuffer<Uint8ClampedArray>> {
  if (src.channels !== 3) throw new RangeError('The learned enlarger takes RGB photos.');
  const plan = planTiles(src.width, src.height, scale, options.tile, options.overlap);
  const outW = src.width * scale, outH = src.height * scale;
  const out = new Uint8ClampedArray(outW * outH * 3);
  const ramp = plan.overlap * scale;
  let done = 0;
  for (const r of plan.tiles) {
    options.signal?.throwIfAborted();
    const result = await model(cropTile(src, r));
    options.signal?.throwIfAborted();
    if (result.width !== r.width * scale || result.height !== r.height * scale || result.channels !== 3 || result.data.length !== result.width * result.height * 3) {
      throw new Error('The enlarger returned a tile of an unexpected size, so nothing was kept.');
    }
    const ox = r.x * scale, oy = r.y * scale;
    const fadeLeft = r.x > 0, fadeTop = r.y > 0;
    for (let y = 0; y < result.height; y++) {
      const ay = fadeTop && y < ramp ? (y + 0.5) / ramp : 1;
      for (let x = 0; x < result.width; x++) {
        const ax = fadeLeft && x < ramp ? (x + 0.5) / ramp : 1;
        const a = ax * ay;
        const i = ((oy + y) * outW + ox + x) * 3, j = (y * result.width + x) * 3;
        if (a >= 1) { out[i] = result.data[j]; out[i + 1] = result.data[j + 1]; out[i + 2] = result.data[j + 2]; }
        else for (let c = 0; c < 3; c++) out[i + c] = out[i + c] * (1 - a) + result.data[j + c] * a;
      }
    }
    options.onProgress?.(++done / plan.tiles.length);
  }
  return { data: out, width: outW, height: outH, channels: 3 };
}
