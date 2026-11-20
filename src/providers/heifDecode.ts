import { HeifUndecodableError } from './heifWasmCore';
import { loadImage } from './loadImage';

export { HeifUndecodableError };

/** Prefer the native colour-managed original, including photos named .jpg by a transfer tool. */
export async function decodeHeifForDisplay(original: Blob): Promise<Blob> {
  const source = original.type === 'image/heic' || original.type === 'image/heif' ? original : original.slice(0, original.size, 'image/heic');
  const url = URL.createObjectURL(source);
  try {
    await loadImage(url);
    return source;
  } catch {
    // The opt-in test decoder outputs 8-bit SDR and needs separate distribution review.
    if (import.meta.env.VITE_EXPERIMENTAL_HEIF_WASM === 'true') {
      const { decodeHeifToPng } = await import('./heifExperimental');
      return decodeHeifToPng(original);
    }
    throw new HeifUndecodableError('This device could not decode the original HEIF photo.');
  } finally {
    URL.revokeObjectURL(url);
  }
}
