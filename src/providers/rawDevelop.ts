import { isDesktopApp } from './desktopShell';

/** Developing a RAW file's sensor data needs the desktop app's native decoder. */
export const canDevelopRaw = () => isDesktopApp();

/**
 * Send a RAW file to the desktop app's decoder and get back the full-size developed picture as a JPEG. The original file
 * is not changed. Rejects with a plain message when the camera or compression mode cannot be read.
 */
export async function developRaw(file: Blob): Promise<Blob> {
  const { invoke } = await import('@tauri-apps/api/core');
  const bytes = new Uint8Array(await file.arrayBuffer());
  try {
    const result = await invoke<ArrayBuffer>('develop_raw', bytes);
    return new Blob([result], { type: 'image/jpeg' });
  } catch (error) {
    throw new Error(typeof error === 'string' ? error : 'This RAW file could not be developed.');
  }
}
