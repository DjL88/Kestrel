/// <reference lib="webworker" />
/**
 * Picture work for the background checks, off the interface thread (started by pixelAnalysis.ts): measured style tags
 * (pure maths from src/core, exactly what the page would work out) and small JPEG thumbnails (decoded, shrunk and
 * encoded here).
 */
import { pixelStyleTags } from '../core/sceneTags';
import { applyCanvasPhotoEdit } from '../core/canvasEdit';
import { toPhotoHistogram } from '../v2/engineClient/histogram';
import type { PixelRequest } from './pixelAnalysis';

async function thumbnail(blob: Blob, maxWidth: number, quality: number, size: { width: number; height: number } | null): Promise<Blob> {
  const bitmap = size && size.width > maxWidth
    ? await createImageBitmap(blob, { resizeWidth: maxWidth, resizeHeight: Math.max(1, Math.round(size.height * maxWidth / size.width)), resizeQuality: 'high' })
    : await createImageBitmap(blob);
  try {
    const scale = Math.min(1, maxWidth / Math.max(1, bitmap.width));
    const width = Math.max(1, Math.round(bitmap.width * scale)), height = Math.max(1, Math.round(bitmap.height * scale));
    const canvas = new OffscreenCanvas(width, height);
    canvas.getContext('2d')!.drawImage(bitmap, 0, 0, width, height);
    return await canvas.convertToBlob({ type: 'image/jpeg', quality });
  } finally {
    bitmap.close();
  }
}

self.onmessage = (event: MessageEvent<PixelRequest>) => {
  const request = event.data;
  void (async () => {
    try {
      if (request.type === 'style') self.postMessage({ id: request.id, tags: pixelStyleTags(request.rgba) });
      else if (request.type === 'histogram') {
        const canvas = new OffscreenCanvas(request.width, request.height);
        const context = canvas.getContext('2d', { willReadFrequently: true })!;
        context.putImageData(new ImageData(request.data as Uint8ClampedArray<ArrayBuffer>, request.width, request.height), 0, 0);
        applyCanvasPhotoEdit(canvas as unknown as HTMLCanvasElement, request.edit);
        self.postMessage({ id: request.id, histogram: toPhotoHistogram(context.getImageData(0, 0, request.width, request.height).data) });
      }
      else self.postMessage({ id: request.id, blob: await thumbnail(request.blob, request.maxWidth, request.quality, request.size) });
    } catch {
      self.postMessage({ id: request.id, failed: true });
    }
  })();
};
