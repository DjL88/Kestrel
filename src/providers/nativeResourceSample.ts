import { engineScheduler } from '../core/engineScheduler';
import type { ResourceSample } from '../core/resourcePolicy';
import { hasNativeRaw } from './desktopShell';

/**
 * Feed the task scheduler a real measurement of the machine, from the desktop app (src-tauri/src/resource_sample.rs):
 * the whole-machine CPU load and the free memory, every few seconds. Without one the scheduler runs a single heavy job
 * at a time ("do not invent capacity"), so one slow or stuck job held up every other task. With one it admits another
 * heavy job only while the CPU has headroom and memory is free. A browser, a phone or an older desktop build has no
 * measurement, and nothing changes there. Returns a function that stops sampling.
 */
export function startNativeResourceSampling(
  update: (sample: ResourceSample | null) => void = (sample) => engineScheduler.updateResourceSample(sample),
  everyMs = 3_000,
  read: () => Promise<{ cpu?: number | null; availableMemoryBytes: number }> = async () => {
    const { invoke } = await import('@tauri-apps/api/core');
    return invoke('resource_sample');
  },
  available: () => boolean = hasNativeRaw,
): () => void {
  if (!available()) return () => undefined;
  let stopped = false;
  let timer: ReturnType<typeof setTimeout> | null = null;
  const tick = async () => {
    try {
      const raw = await read();
      if (stopped) return;
      const valid = Number.isFinite(raw.availableMemoryBytes) && raw.availableMemoryBytes >= 0;
      update(valid ? {
        availableMemoryBytes: raw.availableMemoryBytes,
        ...(typeof raw.cpu === 'number' && raw.cpu >= 0 && raw.cpu <= 1 ? { cpu: raw.cpu } : {}),
      } : null);
    } catch {
      // No measurement (an older build): back to one heavy job at a time, and stop asking.
      if (!stopped) update(null);
      return;
    }
    if (!stopped) timer = setTimeout(() => { void tick(); }, everyMs);
  };
  void tick();
  return () => { stopped = true; if (timer) clearTimeout(timer); update(null); };
}

/** The machine's free memory now, from the desktop app; null where there is no measurement (a browser, an older build). */
export async function freeMemoryBytes(
  read: () => Promise<{ availableMemoryBytes: number }> = async () => (await import('@tauri-apps/api/core')).invoke('resource_sample'),
  available: () => boolean = hasNativeRaw,
): Promise<number | null> {
  if (!available()) return null;
  try {
    const { availableMemoryBytes } = await read();
    return Number.isFinite(availableMemoryBytes) && availableMemoryBytes >= 0 ? availableMemoryBytes : null;
  } catch {
    return null;
  }
}
