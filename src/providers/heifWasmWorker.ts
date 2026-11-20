/**
 * Decodes HEIF photos (HEIC, HEIF, HIF) with the bundled libheif (WebAssembly) off the interface thread. One file at a
 * time. Messages:
 *   in  { id, bytes }   out { type: 'png', id, png, width, height }        when OffscreenCanvas can encode here
 *                       out { type: 'pixels', id, width, height, data }    otherwise (the page encodes it)
 *                       out { type: 'error', id, message, undecodable }
 */
import factory from 'libheif-js/libheif-wasm/libheif-bundle.mjs';
import { decodeHeifPixels, HeifUndecodableError } from './heifWasmCore';

const scope = self as unknown as {
  onmessage: ((event: MessageEvent) => void) | null;
  postMessage(message: unknown, transfer?: Transferable[]): void;
};

scope.onmessage = async (event: MessageEvent<{ id: number; bytes: ArrayBuffer }>) => {
  const { id, bytes } = event.data;
  try {
    const picture = await decodeHeifPixels(factory, new Uint8Array(bytes));
    const { width, height } = picture;
    if (typeof OffscreenCanvas !== 'undefined') {
      const canvas = new OffscreenCanvas(width, height);
      const context = canvas.getContext('2d');
      if (context) {
        context.putImageData(new ImageData(picture.data, width, height), 0, 0);
        // Lossless, so the editor starts from exactly what the file holds.
        const png = await canvas.convertToBlob({ type: 'image/png' });
        scope.postMessage({ type: 'png', id, png, width, height });
        return;
      }
    }
    const data = picture.data.buffer as ArrayBuffer;
    scope.postMessage({ type: 'pixels', id, width, height, data }, [data]);
  } catch (problem) {
    scope.postMessage({
      type: 'error', id,
      message: problem instanceof Error ? problem.message : 'This HEIF photo could not be decoded.',
      undecodable: problem instanceof HeifUndecodableError,
    });
  }
};
