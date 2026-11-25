/// <reference lib="webworker" />
import { frameAndEditRgb16 } from '../core/master16';
import type { PhotoEdit } from '../core/photoEdits';
import type { PhotoFraming } from '../core/photoFraming';

/**
 * Frames and edits a full-size 16-bit RAW picture off the main thread (a 45 MP frame is about 270 MB and takes seconds),
 * so the app stays responsive while an export is made. The picture's buffer is handed over, worked on in place and
 * handed back. One job per worker; the page ends the worker when the job is done or cancelled.
 */
self.onmessage = (event: MessageEvent<{ width: number; height: number; data: ArrayBuffer; offset: number; length: number; turn: number; edit: PhotoEdit; framing?: PhotoFraming }>) => {
  const { width, height, data, offset, length, turn, edit, framing } = event.data;
  try {
    const result = frameAndEditRgb16({ width, height, data: new Uint16Array(data, offset, length) }, turn, edit, framing);
    const buffer = result.data.buffer as ArrayBuffer;
    // The result may be a view part-way into its buffer (the decoder writes a small header first): say where.
    self.postMessage({ width: result.width, height: result.height, data: buffer, offset: result.data.byteOffset, length: result.data.length }, [buffer]);
  } catch (error) {
    self.postMessage({ error: error instanceof Error ? error.message : 'The 16-bit picture could not be made.' });
  }
};
