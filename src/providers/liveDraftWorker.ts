/// <reference lib="webworker" />
/**
 * The quick picture drawn while a slider is dragged, off the interface thread. It runs the same edit maths as the editor
 * (src/core/canvasEdit.ts: noise reduction, dehaze, the other early stages, tone, masks and finishing) on an
 * OffscreenCanvas at the size the picture is shown, and returns an ImageBitmap. The full-quality picture is still drawn on
 * the page once the drag ends, so this never decides what the photo looks like when the hand is still, or what exports.
 *
 * Started by liveDraft.ts.
 */
import { applyCanvasPhotoEdit } from '../core/canvasEdit';
import { fullContext } from '../core/masks';
import { drawFramedPhoto, lensCentre, type PhotoFraming } from '../core/photoFraming';
import { createStageCache } from '../core/stageCache';
import type { PhotoEdit } from '../core/photoEdits';
import type { LensCentre, LiveDraftReply, LiveDraftRequest } from './liveDraft';

/** One picture on screen (Before and After are two slots): the full-size framed picture, and the last screen-size copy. */
interface Slot {
  key: string;
  base: ImageBitmap;
  lens: LensCentre;
  sized?: { edge: number; pixels: ImageData };
}

const slots = new Map<string, Slot>();
// A base still being decoded from the file: a draw for that slot waits for it rather than coming back empty.
const decoding = new Map<string, Promise<void>>();
let stageCache = createStageCache(96 * 1024 * 1024);

const scope = self as unknown as {
  onmessage: ((event: MessageEvent<LiveDraftRequest>) => void) | null;
  postMessage(message: LiveDraftReply, transfer?: Transferable[]): void;
};

function setBase(slot: string, key: string, base: ImageBitmap, lens: LensCentre): void {
  const known = slots.get(slot);
  if (known && known.base !== base) known.base.close();
  slots.set(slot, { key, base, lens });
}

/** A framed picture from the photo file itself, decoded here (an ImageBitmap from a Blob is decoded off the page). */
async function framedFromBlob(blob: Blob, framing: PhotoFraming, longEdge: number): Promise<{ base: ImageBitmap; lens: LensCentre }> {
  const decoded = await createImageBitmap(blob);
  try {
    const source = Object.assign(decoded, { naturalWidth: decoded.width, naturalHeight: decoded.height });
    const rotated = framing.turns % 2 !== 0;
    const width = rotated ? decoded.height : decoded.width, height = rotated ? decoded.width : decoded.height;
    const scale = Math.min(1, longEdge / Math.max(width, height));
    const canvas = new OffscreenCanvas(1, 1);
    drawFramedPhoto(source as unknown as HTMLImageElement, canvas as unknown as HTMLCanvasElement, framing, { scale });
    return { base: canvas.transferToImageBitmap(), lens: lensCentre(decoded.width, decoded.height, framing) };
  } finally {
    decoded.close();
  }
}

/** The base at the size asked for, made once per size and kept for the rest of the drag. */
function sizedPixels(slot: Slot, edge: number): ImageData {
  if (slot.sized?.edge === edge) return slot.sized.pixels;
  const { base } = slot;
  const scale = Math.min(1, edge / Math.max(base.width, base.height));
  const width = Math.max(1, Math.round(base.width * scale)), height = Math.max(1, Math.round(base.height * scale));
  const canvas = new OffscreenCanvas(width, height);
  const context = canvas.getContext('2d', { willReadFrequently: true })!;
  context.imageSmoothingEnabled = true;
  context.imageSmoothingQuality = 'high';
  context.drawImage(base, 0, 0, width, height);
  const pixels = context.getImageData(0, 0, width, height);
  slot.sized = { edge, pixels };
  return pixels;
}

function draw(slot: Slot, edge: number, edit: PhotoEdit): ImageBitmap {
  const pixels = sizedPixels(slot, edge);
  const canvas = new OffscreenCanvas(pixels.width, pixels.height);
  canvas.getContext('2d', { willReadFrequently: true })!.putImageData(pixels, 0, 0);
  const sourceKey = JSON.stringify([slot.key, edge]);
  applyCanvasPhotoEdit(canvas as unknown as HTMLCanvasElement, edit, undefined, { ...fullContext(canvas.width, canvas.height), lensCentre: slot.lens },
    { cache: stageCache, sourceKey });
  return canvas.transferToImageBitmap();
}

scope.onmessage = (event) => {
  const request = event.data;
  void (async () => {
    try {
      if (request.type === 'base') {
        decoding.delete(request.slot);
        setBase(request.slot, request.key, request.base, request.lensCentre);
        return;
      }
      if (request.type === 'base-file') {
        const done = framedFromBlob(request.blob, request.framing, request.longEdge)
          .then(({ base, lens }) => { if (decoding.get(request.slot) === done) setBase(request.slot, request.key, base, lens); else base.close(); })
          .finally(() => { if (decoding.get(request.slot) === done) decoding.delete(request.slot); });
        decoding.set(request.slot, done);
        await done;
        return;
      }
      if (request.type === 'release') {
        slots.get(request.slot)?.base.close();
        slots.delete(request.slot);
        if (!slots.size) stageCache = createStageCache(96 * 1024 * 1024);
        return;
      }
      await decoding.get(request.slot)?.catch(() => undefined);
      const slot = slots.get(request.slot);
      if (!slot || slot.key !== request.key) {
        scope.postMessage({ id: request.id, missing: true });
        return;
      }
      const started = performance.now();
      const bitmap = draw(slot, request.edge, request.edit);
      scope.postMessage({ id: request.id, bitmap, ms: performance.now() - started }, [bitmap]);
    } catch {
      if (request.type === 'draw') scope.postMessage({ id: request.id, missing: true });
    }
  })();
};
