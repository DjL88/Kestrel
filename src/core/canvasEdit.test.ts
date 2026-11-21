import assert from 'node:assert/strict';
import test from 'node:test';
import { applyCanvasExportEdit, applyCanvasPhotoEdit } from './canvasEdit';
import { DEFAULT_EDIT } from './photoEdits';
import { createMask } from './maskTypes';

// Minimal pixel-preserving canvas double: the same input is fed to synchronous
// preview and asynchronous export, without relying on a browser or GPU.
function canvasDouble(width: number, height: number, onWrite?: () => void) {
  const data = new Uint8ClampedArray(width * height * 4);
  for (let i = 0; i < data.length; i += 4) {
    data[i] = (i / 4) % 253;
    data[i + 1] = 90;
    data[i + 2] = 140;
    data[i + 3] = 255;
  }
  const context = {
    getImageData(_x: number, y: number, w: number, h: number) {
      const pixels = new Uint8ClampedArray(w * h * 4);
      for (let row = 0; row < h; row++) pixels.set(data.subarray(((y + row) * width) * 4, ((y + row) * width + w) * 4), row * w * 4);
      return { data: pixels, width: w, height: h };
    },
    putImageData(image: { data: Uint8ClampedArray; width: number; height: number }, _x: number, y: number) {
      for (let row = 0; row < image.height; row++) data.set(image.data.subarray(row * image.width * 4, (row + 1) * image.width * 4), ((y + row) * width) * 4);
      onWrite?.();
    },
  };
  return { width, height, data, getContext: () => context } as unknown as HTMLCanvasElement & { data: Uint8ClampedArray };
}

const maskEdit = { ...DEFAULT_EDIT, masks: [{ ...createMask('radial', 'subject'), edit: { exposure: 0.5 } }] };

test('mask-only export matches synchronous preview across multiple bands', async () => {
  const preview = canvasDouble(100, 11000);
  const exportCanvas = canvasDouble(100, 11000);
  applyCanvasPhotoEdit(preview, maskEdit);
  await applyCanvasExportEdit(exportCanvas, maskEdit);
  assert.deepEqual(exportCanvas.data, preview.data);
});

test('export cancellation is observed during mask bands, not only before masks', async () => {
  const controller = new AbortController();
  let writes = 0;
  const canvas = canvasDouble(100, 11000, () => { if (++writes === 1) controller.abort(); });
  await assert.rejects(applyCanvasExportEdit(canvas, maskEdit, controller.signal), { name: 'AbortError' });
  assert.equal(writes, 1, 'no further bands written after cancellation');
});
