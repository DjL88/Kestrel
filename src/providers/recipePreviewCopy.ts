import { CLOUD_RECIPE_PREVIEW_EDGE } from '../core/cloudRecipe';

/**
 * A JPEG copy of the photo's preview, at most 2,560 px on its long edge, for cloud edit settings when this device has
 * no 2,560 px smart preview (the web app, phones, and JPEG or HEIC photos on the desktop). The copy is made in memory
 * for one upload and never stored; the original and its previews are not changed.
 *
 * For a RAW photo the preview is usually the camera's built-in JPEG, not InFlight's own develop, and the card says so.
 * Returns null when the picture cannot be decoded here.
 */
export async function previewCopyForCloud(source: Blob, quality = 0.9): Promise<Blob | null> {
  if (typeof createImageBitmap !== 'function') return null;
  let bitmap: ImageBitmap;
  try { bitmap = await createImageBitmap(source); } catch { return null; }
  try {
    const scale = Math.min(1, CLOUD_RECIPE_PREVIEW_EDGE / Math.max(bitmap.width, bitmap.height));
    const width = Math.max(1, Math.round(bitmap.width * scale));
    const height = Math.max(1, Math.round(bitmap.height * scale));
    if (typeof OffscreenCanvas === 'function') {
      const canvas = new OffscreenCanvas(width, height);
      const ctx = canvas.getContext('2d');
      if (!ctx) return null;
      ctx.drawImage(bitmap, 0, 0, width, height);
      return await canvas.convertToBlob({ type: 'image/jpeg', quality });
    }
    if (typeof document === 'undefined') return null;
    const canvas = document.createElement('canvas');
    canvas.width = width; canvas.height = height;
    const ctx = canvas.getContext('2d');
    if (!ctx) return null;
    ctx.drawImage(bitmap, 0, 0, width, height);
    return await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, 'image/jpeg', quality));
  } catch { return null; } finally { bitmap.close(); }
}

/** Reads the picture behind a preview URL (a blob: or data: URL from the preview provider). */
export async function previewBlobFromUrl(url: string): Promise<Blob | null> {
  if (!url) return null;
  try {
    const response = await fetch(url);
    return response.ok ? await response.blob() : null;
  } catch { return null; }
}
