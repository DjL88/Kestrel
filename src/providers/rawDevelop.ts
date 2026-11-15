import { THUMB, bestTurn } from '../core/orientMatch';
import { isDesktopApp } from './desktopShell';

/** Developing a RAW file's sensor data needs the desktop app's native decoder. */
export const canDevelopRaw = () => isDesktopApp();

/**
 * Send a RAW file to the desktop app's decoder and get back the full-size developed picture as a JPEG. The original file
 * is not changed. Rejects with a plain message when the camera or compression mode cannot be read.
 */
export async function developRaw(file: Blob, extension = 'nef'): Promise<Blob> {
  const { invoke } = await import('@tauri-apps/api/core');
  const bytes = new Uint8Array(await file.arrayBuffer());
  try {
    const result = await invoke<ArrayBuffer>('develop_raw', bytes, { headers: { 'x-file-extension': extension.replace(/[^a-z0-9]/gi, '').slice(0, 5) || 'nef' } });
    return new Blob([result], { type: 'image/jpeg' });
  } catch (error) {
    throw new Error(typeof error === 'string' ? error : 'This RAW file could not be developed.');
  }
}

async function thumbOf(bitmap: ImageBitmap): Promise<Float32Array> {
  const canvas = document.createElement('canvas');
  canvas.width = THUMB; canvas.height = THUMB;
  const context = canvas.getContext('2d', { willReadFrequently: true })!;
  context.drawImage(bitmap, 0, 0, THUMB, THUMB);
  const { data } = context.getImageData(0, 0, THUMB, THUMB);
  const out = new Float32Array(THUMB * THUMB);
  for (let i = 0; i < out.length; i += 1) out[i] = 0.299 * data[i * 4] + 0.587 * data[i * 4 + 1] + 0.114 * data[i * 4 + 2];
  return out;
}

/**
 * Turn a developed picture to match the camera's own preview. The sensor data is stored sideways-on and some cameras'
 * rotation flags say "normal" for an upright-portrait photo, so the preview, which the camera rotated, is the guide.
 * Returns the picture untouched when it already matches or there is no preview to compare with.
 */
export async function matchPreviewOrientation(developed: Blob, preview: Blob | null): Promise<Blob> {
  if (!preview) return developed;
  const [a, b] = await Promise.all([createImageBitmap(preview), createImageBitmap(developed)]);
  try {
    const turn = bestTurn(
      { thumb: await thumbOf(a), portrait: a.height > a.width },
      { thumb: await thumbOf(b), portrait: b.height > b.width },
    );
    if (turn === 0) return developed;
    const canvas = document.createElement('canvas');
    const sideways = turn === 90 || turn === 270;
    canvas.width = sideways ? b.height : b.width;
    canvas.height = sideways ? b.width : b.height;
    const context = canvas.getContext('2d')!;
    context.translate(canvas.width / 2, canvas.height / 2);
    context.rotate((turn * Math.PI) / 180);
    context.drawImage(b, -b.width / 2, -b.height / 2);
    return await new Promise<Blob>((resolve, reject) => canvas.toBlob((blob) => (blob ? resolve(blob) : reject(new Error('Could not turn the picture.'))), 'image/jpeg', 0.95));
  } finally {
    a.close(); b.close();
  }
}
