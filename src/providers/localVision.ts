import { sanitiseObservation, type VisionObservation } from '../core/localVisionObservation';
import { isDesktopApp } from './desktopShell';

export interface LocalVisionStatus { installed: boolean; revision: string; model: string; licence: string }
export interface LocalVisionResult extends VisionObservation {
  /** Honest measurements, shown in Settings so the numbers are never invented. */
  timings: { loadMs: number; visionMs: number; generateMs: number };
  revision: string;
}

/** Only the desktop app has the on-device model (Rust, ONNX Runtime). Everywhere else this says so, plainly. */
export const hasLocalVision = () => isDesktopApp();

export async function localVisionStatus(): Promise<LocalVisionStatus | null> {
  if (!hasLocalVision()) return null;
  const { invoke } = await import('@tauri-apps/api/core');
  try { return await invoke<LocalVisionStatus>('local_vision_status'); } catch { return null; }
}

/**
 * Ask the on-device model about one photo (a bounded preview, JPEG or PNG), with no network. The answer is sanitised here and
 * is only an observation to show; it is never applied as an edit without the person accepting a normal, reversible control.
 */
export async function describePhoto(preview: Blob, question?: string): Promise<LocalVisionResult> {
  if (!hasLocalVision()) throw new Error('The on-device photo check is available in the desktop app.');
  const { invoke } = await import('@tauri-apps/api/core');
  const headers: Record<string, string> = {};
  if (question && /^[\x20-\x7e]{1,400}$/.test(question)) headers['x-question'] = question;
  try {
    const raw = await invoke<{ text: string; loadMs: number; visionMs: number; generateMs: number; revision: string }>(
      'local_vision_describe', new Uint8Array(await preview.arrayBuffer()), { headers });
    return { ...sanitiseObservation(raw.text), timings: { loadMs: raw.loadMs, visionMs: raw.visionMs, generateMs: raw.generateMs }, revision: raw.revision };
  } catch (error) {
    throw new Error(typeof error === 'string' ? error : 'The photo could not be checked on this device.');
  }
}
