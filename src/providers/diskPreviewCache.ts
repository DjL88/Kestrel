import { hasNativeRaw } from './desktopShell';
import { deviceMemoryBudget } from './deviceBudget';
import { diskPreviewLimitBytes, diskPreviewThreads } from '../core/diskPreviewLimit';

/**
 * The desktop app's preview cache on disk (x-std-disk-previews; src-tauri/src/preview_cache.rs). The page names each
 * photo by its path and the app reads, develops and stores it itself, so a RAW's bytes never cross into the page.
 * Three pictures per photo: a 400 px thumbnail, a 2,200 px review copy and a 2,560 px smart preview the editor works on
 * while the original's drive is unplugged. The web and phone apps keep their IndexedDB cache (offlinePreviewCache.ts).
 * Originals are only ever read.
 */
export type DiskPreviewLevel = 'thumb' | 'review' | 'smart';

export interface DiskBuildRequest {
  key: string;
  path: string;
  size?: number;
  /** The SHA-256 of the bytes added. Required: a file with the same name and size is not the same photo. */
  sha256: string;
}

export interface DiskBuildResult {
  key: string;
  status: 'built' | 'cached' | 'failed';
  madeFrom?: 'raw' | 'picture';
  codec?: 'nikon-he' | 'nikon-he-star' | 'other';
  error?: string;
}

export interface DiskPreviewUsage { bytes: number; entries: number }

export interface DiskPreviewStore {
  build(requests: DiskBuildRequest[]): Promise<DiskBuildResult[]>;
  read(key: string, level: DiskPreviewLevel): Promise<Blob | null>;
  rotate(key: string, degrees: 90 | 180 | 270): Promise<void>;
  usage(limitBytes?: number): Promise<DiskPreviewUsage>;
  clear(): Promise<DiskPreviewUsage>;
}

const LIMIT_SETTING = 'kestrel.diskPreviewLimitGB';

/** The person's chosen limit in GB as stored, or null. Storage may be unavailable; then the tier's default applies. */
export function storedDiskPreviewLimit(): string | null {
  try { return globalThis.localStorage?.getItem(LIMIT_SETTING) ?? null; } catch { return null; }
}

export function saveDiskPreviewLimit(gb: number | null): void {
  try {
    if (gb === null) globalThis.localStorage?.removeItem(LIMIT_SETTING);
    else globalThis.localStorage?.setItem(LIMIT_SETTING, String(gb));
  } catch { /* the default limit still applies */ }
}

export const currentDiskPreviewLimitBytes = () => diskPreviewLimitBytes(storedDiskPreviewLimit(), deviceMemoryBudget());

async function invoke<T>(command: string, args?: Record<string, unknown>): Promise<T> {
  const { invoke: call } = await import('@tauri-apps/api/core');
  return call<T>(command, args);
}

const desktopStore: DiskPreviewStore = {
  build: (requests) => invoke<DiskBuildResult[]>('preview_cache_build', {
    requests, threads: diskPreviewThreads(deviceMemoryBudget()), limitBytes: currentDiskPreviewLimitBytes(),
  }),
  async read(key, level) {
    try {
      const bytes = await invoke<ArrayBuffer>('preview_cache_read', { key, level });
      return bytes && bytes.byteLength > 0 ? new Blob([bytes], { type: 'image/jpeg' }) : null;
    } catch { return null; }
  },
  rotate: (key, degrees) => invoke<void>('preview_cache_rotate', { key, degrees }),
  usage: (limitBytes) => invoke<DiskPreviewUsage>('preview_cache_usage', { limitBytes: limitBytes ?? null }),
  clear: () => invoke<DiskPreviewUsage>('preview_cache_clear'),
};

/** The desktop app's disk cache, or null in a browser or on a phone. */
export function diskPreviewStore(): DiskPreviewStore | null {
  return hasNativeRaw() ? desktopStore : null;
}
