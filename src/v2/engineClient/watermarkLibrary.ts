import { loadLocalWatermarkAsset, saveLocalWatermarkAsset } from '../../core/watermarkAssetVault';
import type { WatermarkPreset, WatermarkUsage } from '../ui/contract';
import { cutOutBackground, markBrightness, recolour, type Rgba } from './watermarkImage';

/** One watermark in the person's library. The artwork stays on this device (IndexedDB, by SHA-256 id); the list is a small
 * record in local storage. `forDark` is the artwork used on dark photos (a light mark), `forLight` the one for light photos. */
export interface StoredWatermark { id: string; label: string; forDark?: string; forLight?: string; /** A text watermark's line(s). No artwork. */ text?: string; subtext?: string }
export type Slot = 'dark' | 'light';

const KEY = 'inflight.v2.watermarks';
const MAX_TEXT = 60;
const ID = /^[a-f0-9]{64}$/;

export function parseStored(raw: string | null): StoredWatermark[] {
  try {
    const value: unknown = JSON.parse(raw ?? '[]');
    if (!Array.isArray(value)) return [];
    const seen = new Set<string>();
    return value.flatMap((entry): StoredWatermark[] => {
      if (!entry || typeof entry !== 'object') return [];
      const { id, label, forDark, forLight, text, subtext } = entry as Record<string, unknown>;
      if (typeof id !== 'string' || !id.trim() || typeof label !== 'string' || seen.has(id)) return [];
      seen.add(id);
      const asset = (candidate: unknown) => (typeof candidate === 'string' && ID.test(candidate) ? candidate : undefined);
      const line = (candidate: unknown) => (typeof candidate === 'string' && candidate.trim() ? candidate.trim().slice(0, MAX_TEXT) : undefined);
      const words = line(text);
      if (words) return [{ id, label: label.slice(0, 60), text: words, ...(line(subtext) ? { subtext: line(subtext) } : {}) }];
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
  return Promise.all(stored.map(async (entry): Promise<WatermarkPreset> => (entry.text
    ? { id: entry.id, label: entry.label, text: entry.text, ...(entry.subtext ? { subtext: entry.subtext } : {}), kind: 'text' }
    : {
      id: entry.id, label: entry.label, text: entry.label, kind: 'image',
      forDarkUrl: await assetUrl(entry.forDark), forLightUrl: await assetUrl(entry.forLight),
    })));
}

/** "Both" uses the supplied artwork unchanged on both backgrounds. */
export function watermarkSlots(assetId: string, usage: WatermarkUsage, brightness: number | null): Pick<StoredWatermark, 'forDark' | 'forLight'> {
  if (usage === 'both') return { forDark: assetId, forLight: assetId };
  if (usage === 'dark') return { forDark: assetId };
  if (usage === 'light') return { forLight: assetId };
  return brightness === null || brightness >= 0.5 ? { forDark: assetId } : { forLight: assetId };
}

export async function importWatermark(file: Blob, label: string, id: string, usage: WatermarkUsage = 'auto'): Promise<StoredWatermark> {
  const pixels = await toPixels(file);
  const assetId = await saveLocalWatermarkAsset(file);
  return { id, label: label.slice(0, 60) || 'Watermark', ...watermarkSlots(assetId, usage, markBrightness(pixels)) };
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

/** A text watermark: the person's own words, drawn light on dark photos and dark on light ones. Null when there are no words. */
export function textWatermark(id: string, text: string, subtext: string): StoredWatermark | null {
  const words = text.replace(/\s+/g, ' ').trim().slice(0, MAX_TEXT);
  if (!words) return null;
  const second = subtext.replace(/\s+/g, ' ').trim().slice(0, MAX_TEXT);
  return { id, label: words, text: words, ...(second ? { subtext: second } : {}) };
}

/** The person says the artwork is for the other kind of photo: its only version moves to that slot. Unchanged when it
 * already has that version, or has both. */
export function moveToSlot(entry: StoredWatermark, slot: Slot): StoredWatermark {
  if (entry.text) return entry;
  const only = entry.forDark && !entry.forLight ? entry.forDark : entry.forLight && !entry.forDark ? entry.forLight : undefined;
  if (!only) return entry;
  return { id: entry.id, label: entry.label, ...(slot === 'dark' ? { forDark: only } : { forLight: only }) };
}

/** Put a second piece of artwork (the person's own other version) into one slot. */
export async function addVersion(entry: StoredWatermark, slot: Slot, file: Blob): Promise<StoredWatermark> {
  await toPixels(file); // refuse a file that is not a readable picture before keeping it
  const assetId = await saveLocalWatermarkAsset(file);
  return { ...entry, ...(slot === 'dark' ? { forDark: assetId } : { forLight: assetId }) };
}
