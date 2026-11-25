/**
 * Draws image layers onto a canvas holding the whole framed photo. The one routine used by the editor's picture, the
 * filmstrip, and every export, so what you see is what you get. Blends follow the canvas compositing standard (the same
 * Darken and Lighten as CSS).
 */
import { softEdgeAlpha, visibleLayers, type PhotoLayer } from './layers';

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
 * Compose the layers (bottom first) onto `canvas`, which holds the whole framed photo. `images` maps asset ids to
 * decoded images; a layer whose image is missing is reported, never silently left out.
 */
export function composeLayers(canvas: HTMLCanvasElement, layers: readonly PhotoLayer[], images: ReadonlyMap<string, CanvasImageSource & { width: number; height: number }>): { missing: string[] } {
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
    context.save();
    context.globalAlpha = layer.opacity;
    context.globalCompositeOperation = OPERATION[layer.blend];
    context.translate(layer.x * canvas.width, layer.y * canvas.height);
    context.rotate((layer.rotation * Math.PI) / 180);
    context.drawImage(raster, -width / 2, -height / 2, width, height);
    context.restore();
  }
  return { missing };
}
