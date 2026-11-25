/** Long edge of a gallery filmstrip picture: a few tens of kilobytes, so opening a gallery costs little to serve. */
export const GALLERY_THUMB_EDGE = 360;

/** A small filmstrip picture made from a published preview, or null when the browser cannot decode it. */
export async function galleryThumbnail(preview: Blob): Promise<Blob | null> {
  try {
    const bitmap = await createImageBitmap(preview);
    const scale = Math.min(1, GALLERY_THUMB_EDGE / Math.max(bitmap.width, bitmap.height));
    const canvas = document.createElement('canvas');
    canvas.width = Math.max(1, Math.round(bitmap.width * scale)); canvas.height = Math.max(1, Math.round(bitmap.height * scale));
    canvas.getContext('2d')?.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
    bitmap.close();
    return await new Promise((resolve) => canvas.toBlob((blob) => resolve(blob), 'image/jpeg', 0.8));
  } catch { return null; }
}
