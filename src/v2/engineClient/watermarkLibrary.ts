import { loadLocalWatermarkAsset, saveLocalWatermarkAsset } from '../../core/watermarkAssetVault';
import type { WatermarkPreset } from '../ui/contract';
import { cutOutBackground, markBrightness, recolour, type Rgba } from './watermarkImage';

/** One watermark in the person's library. The artwork stays on this device (IndexedDB, by SHA-256 id); the list is a small
 * record in local storage. `forDark` is the artwork used on dark photos (a light mark), `forLight` the one for light photos. */
export interface StoredWatermark { id: string; label: string; forDark?: string; forLight?: string }
export type Slot = 'dark' | 'light';

const KEY = 'inflight.v2.watermarks';
const ID = /^[a-f0-9]{64}$/;

export function parseStored(raw: string | null): StoredWatermark[] {
  try {
    const value: unknown = JSON.parse(raw ?? '[]');
    if (!Array.isArray(value)) return [];
    return value.flatMap((entry): StoredWatermark[] => {
      if (!entry || typeof entry !== 'object') return [];
      const { id, label, forDark, forLight } = entry as Record<string, unknown>;
      if (typeof id !== 'string' || !id || typeof label !== 'string') return [];
      const asset = (candidate: unknown) => (typeof candidate === 'string' && ID.test(candidate) ? candidate : undefined);
      return [{ id, label: label.slice(0, 60), forDark: asset(forDark), forLight: asset(forLight) }];
    });
  } catch { return []; }
}

export const loadStored = (): StoredWatermark[] => { try { return parseStored(window.localStorage.getItem(KEY)); } catch { return []; } };
export const saveStored = (list: readonly StoredWatermark[]): void => { try { window.localStorage.setItem(KEY, JSON.stringify(list)); } catch { /* the library is kept in memory this session */ } };

async function toPixels(blob: Blob): Promise<Rgba> {
  const bitmap = await createImageBitmap(blob);
  const edge = Math.max(bitmap.width, bitmap.height);
  const scale = Math.min(1, 1600 / edge); // watermark artwork never needs more than this; keeps the work bounded
  const canvas = document.createElement('canvas');
  canvas.width = Math.max(1, Math.round(bitmap.width * scale)); canvas.height = Math.max(1, Math.round(bitmap.height * scale));
  const context = canvas.getContext('2d', { willReadFrequently: true })!;
  context.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
  bitmap.close();
  const data = context.getImageData(0, 0, canvas.width, canvas.height);
  return { data: data.data, width: data.width, height: data.height };
}

async function toPng(image: Rgba): Promise<Blob> {
  const canvas = document.createElement('canvas');
  canvas.width = image.width; canvas.height = image.height;
  canvas.getContext('2d')!.putImageData(new ImageData(new Uint8ClampedArray(image.data), image.width, image.height), 0, 0);
  return new Promise((resolve, reject) => canvas.toBlob((blob) => (blob ? resolve(blob) : reject(new Error('The image could not be saved.'))), 'image/png'));
}

const urls = new Map<string, string>();
export async function assetUrl(id: string | undefined): Promise<string | undefined> {
  if (!id) return undefined;
  const known = urls.get(id);
  if (known) return known;
  const blob = await loadLocalWatermarkAsset(id).catch(() => null);
  if (!blob) return undefined;
  const url = URL.createObjectURL(blob);
  urls.set(id, url);
  return url;
}

export async function toPresets(stored: readonly StoredWatermark[]): Promise<WatermarkPreset[]> {
  return Promise.all(stored.map(async (entry) => ({
    id: entry.id, label: entry.label, text: entry.label, kind: 'image' as const,
    forDarkUrl: await assetUrl(entry.forDark), forLightUrl: await assetUrl(entry.forLight),
  })));
}

/** Add an image to the library. A light mark goes in the dark-photo slot, a dark mark in the light-photo slot. */
export async function importWatermark(file: Blob, label: string, id: string): Promise<StoredWatermark> {
  const assetId = await saveLocalWatermarkAsset(file);
  const brightness = markBrightness(await toPixels(file));
  const light = brightness === null ? true : brightness >= 0.5;
  return { id, label: label.slice(0, 60) || 'Watermark', ...(light ? { forDark: assetId } : { forLight: assetId }) };
}

/** Remove the flat background from one slot's artwork. With `commit` false it only returns a preview picture. */
export async function cutOut(entry: StoredWatermark, slot: Slot, tolerance: number, commit: boolean): Promise<{ entry: StoredWatermark; url: string; tooMuch: boolean } | null> {
  const assetId = slot === 'dark' ? entry.forDark : entry.forLight;
  const blob = assetId ? await loadLocalWatermarkAsset(assetId).catch(() => null) : null;
  if (!blob) return null;
  const result = cutOutBackground(await toPixels(blob), tolerance);
  const png = await toPng(result.image);
  if (!commit || result.tooMuch) return { entry, url: URL.createObjectURL(png), tooMuch: result.tooMuch };
  const savedId = await saveLocalWatermarkAsset(png);
  return { entry: { ...entry, ...(slot === 'dark' ? { forDark: savedId } : { forLight: savedId }) }, url: (await assetUrl(savedId)) ?? '', tooMuch: false };
}

/** Make the other version from the one that exists: the same shape in white (for dark photos) or black (for light photos). */
export async function makeVariant(entry: StoredWatermark, target: Slot): Promise<StoredWatermark | null> {
  const sourceId = target === 'dark' ? entry.forLight ?? entry.forDark : entry.forDark ?? entry.forLight;
  const blob = sourceId ? await loadLocalWatermarkAsset(sourceId).catch(() => null) : null;
  if (!blob) return null;
  const savedId = await saveLocalWatermarkAsset(await toPng(recolour(await toPixels(blob), target === 'dark' ? 'white' : 'black')));
  return { ...entry, ...(target === 'dark' ? { forDark: savedId } : { forLight: savedId }) };
}
