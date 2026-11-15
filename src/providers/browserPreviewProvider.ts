import { extractNefPreview } from '../core/nefPreview';
import {
  NativeRawUnsupportedError,
  type PreviewProvider,
  type RawDecoder,
} from '../core/platformBoundaries';
import type { PhotoFrame } from '../core/types';
import { DEMO_ASSET_URLS } from './demoAssets';

const MAX_FULL_PREVIEW_CACHE = 24;
const THUMB_MAX_WIDTH = 400;

export class BrowserRawDecoder implements RawDecoder {
  readonly isNativeAvailable = false;

  supportsExtension(filename: string): boolean {
    const lower = filename.toLowerCase();
    return lower.endsWith('.nef') || lower.endsWith('.nrw');
  }

  async decodeFullRaw(_stableKey: string, filename: string): Promise<never> {
    throw new NativeRawUnsupportedError(filename);
  }
}

export class BrowserPreviewProvider implements PreviewProvider {
  private localBlobs = new Map<string, Blob>();
  private thumbUrlCache = new Map<string, string>();
  private fullUrlCache = new Map<string, string>();
  private fullUrlOrder: string[] = [];
  private pendingThumbs = new Map<string, Promise<string>>();

  registerBlob(stableKey: string, blob: Blob): void {
    this.localBlobs.set(stableKey, blob);
  }

  getOriginal(stableKey: string): Blob | undefined {
    return this.localBlobs.get(stableKey);
  }

  hasBlob(stableKey: string): boolean {
    return this.localBlobs.has(stableKey);
  }

  async getThumbnailUrl(frame: PhotoFrame): Promise<string> {
    if (frame.isDemo && frame.demoVariant) {
      return DEMO_ASSET_URLS[frame.demoVariant.assetKey];
    }

    const cached = this.thumbUrlCache.get(frame.id);
    if (cached) return cached;

    const existingPromise = this.pendingThumbs.get(frame.id);
    if (existingPromise) return existingPromise;

    const task = this.buildLocalThumbnailUrl(frame).finally(() => {
      this.pendingThumbs.delete(frame.id);
    });
    this.pendingThumbs.set(frame.id, task);
    return task;
  }

  async getFullPreviewUrl(frame: PhotoFrame): Promise<string> {
    if (frame.isDemo && frame.demoVariant) {
      return DEMO_ASSET_URLS[frame.demoVariant.assetKey];
    }

    const cached = this.fullUrlCache.get(frame.id);
    if (cached) {
      // Refresh LRU position
      this.fullUrlOrder = this.fullUrlOrder.filter((id) => id !== frame.id);
      this.fullUrlOrder.push(frame.id);
      return cached;
    }

    const blob = this.localBlobs.get(frame.stableKey);
    if (!blob) {
      return '';
    }

    let previewBlob: Blob = blob;
    if (frame.filename.toLowerCase().endsWith('.nef')) {
      const extracted = await extractNefPreview(blob);
      if (!extracted) return '';
      previewBlob = extracted;
    }

    const objectUrl = URL.createObjectURL(previewBlob);
    this.fullUrlCache.set(frame.id, objectUrl);
    this.fullUrlOrder.push(frame.id);

    while (this.fullUrlOrder.length > MAX_FULL_PREVIEW_CACHE) {
      const oldestId = this.fullUrlOrder.shift();
      if (oldestId) {
        const oldUrl = this.fullUrlCache.get(oldestId);
        if (oldUrl) URL.revokeObjectURL(oldUrl);
        this.fullUrlCache.delete(oldestId);
      }
    }

    return objectUrl;
  }

  releaseFrame(frameId: string): void {
    const thumb = this.thumbUrlCache.get(frameId);
    if (thumb && thumb.startsWith('blob:')) {
      URL.revokeObjectURL(thumb);
    }
    this.thumbUrlCache.delete(frameId);

    const full = this.fullUrlCache.get(frameId);
    if (full && full.startsWith('blob:')) {
      URL.revokeObjectURL(full);
    }
    this.fullUrlCache.delete(frameId);
    this.fullUrlOrder = this.fullUrlOrder.filter((id) => id !== frameId);
  }

  clear(): void {
    for (const url of this.thumbUrlCache.values()) {
      if (url.startsWith('blob:')) URL.revokeObjectURL(url);
    }
    for (const url of this.fullUrlCache.values()) {
      if (url.startsWith('blob:')) URL.revokeObjectURL(url);
    }
    this.thumbUrlCache.clear();
    this.fullUrlCache.clear();
    this.fullUrlOrder = [];
    this.localBlobs.clear();
    this.pendingThumbs.clear();
  }

  private async buildLocalThumbnailUrl(frame: PhotoFrame): Promise<string> {
    const blob = this.localBlobs.get(frame.stableKey);
    if (!blob) return '';

    let sourceBlob: Blob = blob;
    if (frame.filename.toLowerCase().endsWith('.nef')) {
      const extracted = await extractNefPreview(blob);
      if (!extracted) return '';
      sourceBlob = extracted;
    }

    try {
      const bitmap = await createImageBitmap(sourceBlob);
      const scale = Math.min(1, THUMB_MAX_WIDTH / Math.max(1, bitmap.width));
      const targetW = Math.max(1, Math.round(bitmap.width * scale));
      const targetH = Math.max(1, Math.round(bitmap.height * scale));

      const canvas = document.createElement('canvas');
      canvas.width = targetW;
      canvas.height = targetH;
      const ctx = canvas.getContext('2d');
      if (!ctx) {
        bitmap.close();
        const fallbackUrl = URL.createObjectURL(sourceBlob);
        this.thumbUrlCache.set(frame.id, fallbackUrl);
        return fallbackUrl;
      }

      ctx.drawImage(bitmap, 0, 0, targetW, targetH);
      bitmap.close();

      const thumbBlob = await new Promise<Blob | null>((resolve) =>
        canvas.toBlob(resolve, 'image/jpeg', 0.82)
      );
      const url = URL.createObjectURL(thumbBlob ?? sourceBlob);
      this.thumbUrlCache.set(frame.id, url);
      return url;
    } catch {
      const url = URL.createObjectURL(sourceBlob);
      this.thumbUrlCache.set(frame.id, url);
      return url;
    }
  }
}
