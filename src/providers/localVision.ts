import { sanitiseObservation, type VisionObservation } from '../core/localVisionObservation';
import { isDesktopApp } from './desktopShell';
import { LOCAL_VISION_ID, inferenceMs, parseLocalVisionMetrics, type LocalVisionMetrics } from '../core/localVisionMetrics';
import { recordModelLoad, recordModelMemory, recordModelRun } from '../core/modelStats';

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
    // Settings → Models shows what real checks cost here (#703), straight from the runtime's own clocks.
    recordModelLoad(LOCAL_VISION_ID, raw.loadMs);
    recordModelRun(LOCAL_VISION_ID, raw.visionMs + raw.generateMs);
    void localVisionMetrics().then((metrics) => {
      if (metrics?.loadRamBytes != null) recordModelMemory(LOCAL_VISION_ID, metrics.loadRamBytes);
    });
    return { ...sanitiseObservation(raw.text), timings: { loadMs: raw.loadMs, visionMs: raw.visionMs, generateMs: raw.generateMs }, revision: raw.revision };
  } catch (error) {
    throw new Error(typeof error === 'string' ? error : 'The photo could not be checked on this device.');
  }
}

/** What the desktop runtime has measured for the on-device model in this session. Null off the desktop app. */
export async function localVisionMetrics(): Promise<LocalVisionMetrics | null> {
  if (!hasLocalVision()) return null;
  const { invoke } = await import('@tauri-apps/api/core');
  try { return parseLocalVisionMetrics(await invoke('local_vision_metrics')); } catch { return null; }
}

/**
 * Settings → Models → Measure now: verify the pack, load it (the first time) and run it once on the runtime's built-in
 * synthetic test card, never a photo. Records the measured load time, memory and inference time for Settings.
 */
export async function measureLocalVision(): Promise<void> {
  if (!hasLocalVision()) throw new Error('The on-device photo check is available in the desktop app.');
  const { invoke } = await import('@tauri-apps/api/core');
  let raw: unknown;
  try { raw = await invoke('local_vision_measure'); } catch (error) {
    throw new Error(typeof error === 'string' ? error : 'The model could not be measured on this device.');
  }
  const metrics = parseLocalVisionMetrics(raw);
  if (!metrics) throw new Error('The model gave no measurements.');
  if (metrics.loadMs !== null) recordModelLoad(LOCAL_VISION_ID, metrics.loadMs, 'measure');
  const run = inferenceMs(metrics);
  if (run !== null) recordModelRun(LOCAL_VISION_ID, run, 'measure');
  if (metrics.loadRamBytes !== null) recordModelMemory(LOCAL_VISION_ID, metrics.loadRamBytes, 'measure');
}
