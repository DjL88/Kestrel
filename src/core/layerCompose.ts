/**
 * Draws image layers onto a canvas holding the whole framed photo. The one routine used by the editor's picture, the
 * filmstrip, and every export, so what you see is what you get. Blends follow the canvas compositing standard (the same
 * Darken and Lighten as CSS).
 */
import { layerMask, softEdgeAlpha, visibleLayers, type PhotoLayer } from './layers';
import { effectiveAlpha, fullContext } from './masks';
import type { Mask } from './maskTypes';

/** Canvas operation for each blend. */
const OPERATION: Record<PhotoLayer['blend'], GlobalCompositeOperation> = { normal: 'source-over', darken: 'darken', lighten: 'lighten' };

/** Draw the image at the layer's size on screen, with the soft edge baked into its alpha. */
export function layerRaster(image: CanvasImageSource & { width: number; height: number }, layer: PhotoLayer, pixelWidth: number): HTMLCanvasElement {
  const w = Math.max(1, Math.round(pixelWidth));
  const h = Math.max(1, Math.round(pixelWidth * layer.aspect));
  const canvas = document.createElement('canvas');
  canvas.width = w;
  canvas.height = h;
  const context = canvas.getContext('2d', { willReadFrequently: true })!;
  context.imageSmoothingQuality = 'high';
  context.drawImage(image, 0, 0, w, h);
  if (layer.softEdge > 0 || layer.shape === 'oval') {
    const pixels = context.getImageData(0, 0, w, h);
    const data = pixels.data;
    for (let y = 0; y < h; y += 1) {
      const v = (y + 0.5) / h;
      for (let x = 0; x < w; x += 1) {
        const alpha = softEdgeAlpha((x + 0.5) / w, v, layer.shape, layer.softEdge, layer.aspect);
        if (alpha < 1) data[(y * w + x) * 4 + 3] = Math.round(data[(y * w + x) * 4 + 3] * alpha);
      }
    }
    context.putImageData(pixels, 0, 0);
  }
  return canvas;
}

/**
 * Multiply RGBA alpha by a mask's alpha (0 to 1 per pixel), or by its opposite. Pure, so the masked layer is the same
 * on screen and in every export.
 */
export function maskLayerAlpha(rgba: Uint8ClampedArray, alpha: Float32Array, invert: boolean): void {
  for (let p = 0; p < alpha.length; p += 1) {
    const a = invert ? 1 - alpha[p] : alpha[p];
    if (a < 1) rgba[p * 4 + 3] = Math.round(rgba[p * 4 + 3] * Math.max(0, a));
  }
}

/**
 * Compose the layers (bottom first) onto `canvas`, which holds the whole framed photo. `images` maps asset ids to
 * decoded images; a layer whose image is missing is reported, never silently left out. `masks` are the photo's own
 * masks, in the same framed-photo coordinates, for layers that show only inside (or outside) one of them.
 */
export function composeLayers(
  canvas: HTMLCanvasElement, layers: readonly PhotoLayer[], images: ReadonlyMap<string, CanvasImageSource & { width: number; height: number }>,
  masks?: readonly Mask[],
): { missing: string[] } {
  const shown = visibleLayers(layers);
  const missing = shown.filter((layer) => !images.has(layer.assetId)).map((layer) => layer.label);
  if (!shown.length) return { missing };
  const context = canvas.getContext('2d');
  if (!context) throw new Error('Canvas unavailable');
  for (const layer of shown) {
    const image = images.get(layer.assetId);
    if (!image) continue;
    const width = layer.width * canvas.width;
    const height = width * layer.aspect;
    // Never rasterise above the image's own resolution: enlarging is done once, by the final draw.
    const raster = layerRaster(image, layer, Math.min(width, image.width));
    const mask = layerMask(layer, masks);
    // Placed on its own transparent sheet first when a mask cuts it, so the mask is in the photo's coordinates.
    const sheet = mask ? document.createElement('canvas') : null;
    const target = sheet ? (sheet.width = canvas.width, sheet.height = canvas.height, sheet.getContext('2d', { willReadFrequently: true })!) : context;
    target.save();
    if (!sheet) {
      target.globalAlpha = layer.opacity;
      target.globalCompositeOperation = OPERATION[layer.blend];
    }
    target.translate(layer.x * canvas.width, layer.y * canvas.height);
    target.rotate((layer.rotation * Math.PI) / 180);
    target.drawImage(raster, -width / 2, -height / 2, width, height);
    target.restore();
    if (sheet && mask) {
      const pixels = target.getImageData(0, 0, sheet.width, sheet.height);
      maskLayerAlpha(pixels.data, effectiveAlpha(mask, masks!, sheet.width, sheet.height, fullContext(sheet.width, sheet.height)), !!layer.maskInvert);
      target.putImageData(pixels, 0, 0);
      context.save();
      context.globalAlpha = layer.opacity;
      context.globalCompositeOperation = OPERATION[layer.blend];
      context.drawImage(sheet, 0, 0);
      context.restore();
    }
  }
  return { missing };
}
