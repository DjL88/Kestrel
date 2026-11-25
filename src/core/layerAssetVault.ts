/**
 * Images used as layers: the person's own files, or a copy of another photo in the project as it looked when added.
 * Kept on this device (IndexedDB, by SHA-256 id), like watermark artwork; nothing is uploaded and no original is changed.
 */
import { browserAssetStorage, createWatermarkAssetRepository } from './watermarkAssetVault';
import { composeLayers } from './layerCompose';
import { frameLayers, visibleLayers } from './layers';

/** The largest layer image kept. A copied photo is saved as a high-quality JPEG of up to LAYER_COPY_EDGE pixels. */
export const MAX_LAYER_BYTES = 40_000_000;
export const LAYER_COPY_EDGE = 6000;

const vault = createWatermarkAssetRepository(browserAssetStorage('kestrel-local-layers-v1'), {
  maxBytes: MAX_LAYER_BYTES,
  refusal: 'Choose a PNG, JPEG or WebP image under 40 MB to use as a layer.',
  changed: 'A layer image saved on this device has changed. Add the image again.',
});

export const saveLayerAsset = (blob: Blob) => vault.save(blob);
export const loadLayerAsset = (id: string) => vault.load(id);

const decoded = new Map<string, Promise<ImageBitmap | null>>();
/** Decode a layer image once per session. Resolves to null when this device does not have it. */
export function layerImage(id: string): Promise<ImageBitmap | null> {
  let pending = decoded.get(id);
  if (!pending) {
    pending = loadLayerAsset(id).then((blob) => (blob ? createImageBitmap(blob) : null)).catch(() => null);
    decoded.set(id, pending);
    // A miss is not remembered, so an image added later (or restored) is found.
    void pending.then((image) => { if (!image) decoded.delete(id); });
  }
  return pending;
}

/** Decoded images for these layers' asset ids (those this device has). */
export async function layerImages(ids: readonly string[]): Promise<Map<string, ImageBitmap>> {
  const entries = await Promise.all([...new Set(ids)].map(async (id) => [id, await layerImage(id)] as const));
  return new Map(entries.filter((entry): entry is readonly [string, ImageBitmap] => entry[1] !== null));
}

/**
 * Compose a photo's layers onto the canvas holding its whole framed, edited picture. With `strict` (every export), a
 * layer whose image this device does not have stops the export with its name, rather than leaving it out silently.
 */
export async function applyFrameLayers(canvas: HTMLCanvasElement, overlay: unknown, strict: boolean): Promise<string[]> {
  const layers = visibleLayers(frameLayers(overlay));
  if (!layers.length) return [];
  const images = await layerImages(layers.map((layer) => layer.assetId));
  const missing = layers.filter((layer) => !images.has(layer.assetId)).map((layer) => layer.label);
  if (strict && missing.length) {
    throw new Error(`This device does not have the image for the layer "${missing[0]}". Add it again in Overlays → Layers, or hide that layer, then export. Nothing was exported.`);
  }
  composeLayers(canvas, layers, images);
  return missing;
}
