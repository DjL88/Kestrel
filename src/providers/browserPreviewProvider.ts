import { extractNefPreview } from '../core/nefPreview';
import { isRawPreviewFile as isNikonEmbeddedPreviewFile } from '../core/rawFormats';
import {
  NativeRawUnsupportedError,
  type PreviewProvider,
  type RawDecoder,
} from '../core/platformBoundaries';
import type { PhotoFrame } from '../core/types';

const MAX_FULL_PREVIEW_CACHE = 24;
const MAX_OFFLINE_PREVIEW_MEMORY = 24;
const THUMB_MAX_WIDTH = 400;
const REVIEW_MAX_WIDTH = 2200;

export interface OfflinePreviewPair {
  thumbnail: Blob;
  review: Blob;
}

export interface OfflinePreviewCache {
  savePreviewPair(stableKey: string, previews: OfflinePreviewPair): Promise<boolean>;
  loadPreviewPair(stableKey: string): Promise<OfflinePreviewPair | null>;
}

export class BrowserRawDecoder implements RawDecoder {
  readonly isNativeAvailable = false;

  supportsExtension(filename: string): boolean {
    const lower = filename.toLowerCase();
    return isNikonEmbeddedPreviewFile(filename);
  }

  async decodeFullRaw(_stableKey: string, filename: string): Promise<never> {
    throw new NativeRawUnsupportedError(filename);
  }
}

export class BrowserPreviewProvider implements PreviewProvider {
  constructor(private readonly offlinePreviewCache?: OfflinePreviewCache) {}

  private localBlobs = new Map<string, Blob>();
  private thumbUrlCache = new Map<string, string>();
  private fullUrlCache = new Map<string, string>();
  private fullFrameKeys = new Map<string, string>();
  private fullUrlOrder: string[] = [];
  private pendingThumbs = new Map<string, Promise<string>>();
  private offlinePreviews = new Map<string, OfflinePreviewPair>();
  private offlinePreviewOrder: string[] = [];
  private pendingOfflinePreviews = new Map<string, Promise<OfflinePreviewPair | null>>();
  private offlinePreviewEpoch = 0;

  registerBlob(stableKey: string, blob: Blob): void {
    const previous = this.localBlobs.get(stableKey);
    if (previous && previous !== blob) {
      this.developed.delete(stableKey);
      this.invalidateFullPreview(stableKey);
    }
    this.localBlobs.set(stableKey, blob);
  }

  /** Photos that stay on the disk: how to read each one, and what it was like when added. Read only when needed. */
  private linked = new Map<string, { read: () => Promise<Blob>; size: number; lastModified: number }>();
  private linkedLoading = new Map<string, Promise<Blob | undefined>>();
  private linkedOrder: string[] = [];

  registerLinked(stableKey: string, info: { read: () => Promise<Blob>; size: number; lastModified: number }): void {
    this.linked.set(stableKey, info);
  }

  getOriginal(stableKey: string): Blob | undefined {
    return this.localBlobs.get(stableKey);
  }

  /** The original, reading it from the disk first if it is a linked one. Only a few linked photos are held at once. */
  async ensureOriginal(stableKey: string): Promise<Blob | undefined> {
    const held = this.localBlobs.get(stableKey);
    if (held) return held;
    const link = this.linked.get(stableKey);
    if (!link) return undefined;
    const pending = this.linkedLoading.get(stableKey);
    if (pending) return pending;
    const task = this.limitReads(link.read).then((blob) => {
      this.localBlobs.set(stableKey, blob);
      this.linkedOrder = this.linkedOrder.filter((key) => key !== stableKey);
      this.linkedOrder.push(stableKey);
      while (this.linkedOrder.length > 6) {
        const oldest = this.linkedOrder.shift()!;
        if (oldest !== stableKey) this.localBlobs.delete(oldest);
      }
      return blob;
    }).catch(() => undefined).finally(() => this.linkedLoading.delete(stableKey));
    this.linkedLoading.set(stableKey, task);
    return task;
  }

  private reading = 0;
  private readQueue: Array<() => void> = [];
  /** At most three files are read from the disk at once, so a grid of big RAWs does not fill the memory. */
  private async limitReads(read: () => Promise<Blob>): Promise<Blob> {
    if (this.reading >= 3) await new Promise<void>((resolve) => this.readQueue.push(resolve));
    this.reading += 1;
    try { return await read(); }
    finally { this.reading -= 1; this.readQueue.shift()?.(); }
  }

  /** Size and time of the original without reading it. */
  originalInfo(stableKey: string): { size: number; lastModified?: number } | undefined {
    const blob = this.localBlobs.get(stableKey);
    if (blob) return { size: blob.size, lastModified: (blob as File).lastModified };
    return this.linked.get(stableKey);
  }

  hasBlob(stableKey: string): boolean {
    return this.localBlobs.has(stableKey) || this.linked.has(stableKey);
  }

  /** Save small, nondestructive source previews for linked originals; never persist the original itself. */
  async cacheOfflinePreviews(stableKey: string, filename: string, original: Blob): Promise<boolean> {
    if (!this.offlinePreviewCache) return false;
    const source = isNikonEmbeddedPreviewFile(filename)
      ? (await extractNefPreview(original)) ?? original
      : original;
    const bitmap = await createImageBitmap(source);
    try {
      const previews = {
        thumbnail: await encodePreview(bitmap, THUMB_MAX_WIDTH),
        review: await encodePreview(bitmap, REVIEW_MAX_WIDTH),
      };
      const saved = await this.offlinePreviewCache.savePreviewPair(stableKey, previews);
      if (!saved) this.rememberOfflinePreview(stableKey, previews);
      return saved;
    } finally {
      bitmap.close();
    }
  }

  async getThumbnailUrl(frame: PhotoFrame): Promise<string> {
    if (frame.isDemo && frame.demoVariant) {
      const { DEMO_ASSET_URLS } = await import('./demoAssets');
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

  /** Pictures developed from the RAW sensor data, kept for this session. They stand in for the embedded preview. */
  private developed = new Map<string, Blob>();

  isDeveloped(stableKey: string): boolean { return this.developed.has(stableKey); }

  /** Use a developed picture from now on for this photo, in the editor and in exports. */
  setDeveloped(frame: PhotoFrame, picture: Blob): void {
    this.developed.set(frame.stableKey, picture);
    this.invalidateFullPreview(frame.stableKey);
  }

  private invalidateFullPreview(key: string): void {
    const stale = this.fullUrlCache.get(key);
    if (stale) URL.revokeObjectURL(stale);
    this.fullUrlCache.delete(key);
    this.fullUrlOrder = this.fullUrlOrder.filter((item) => item !== key);
  }

  async getFullPreviewUrl(frame: PhotoFrame): Promise<string> {
    if (frame.isDemo && frame.demoVariant) {
      const { DEMO_ASSET_URLS } = await import('./demoAssets');
      return DEMO_ASSET_URLS[frame.demoVariant.assetKey];
    }

    // Virtual copies have different edit recipes but share the same unedited source.
    const key = frame.stableKey;
    this.fullFrameKeys.set(frame.id, key);
    const cached = this.fullUrlCache.get(key);
    if (cached) {
      // Refresh LRU position
      this.fullUrlOrder = this.fullUrlOrder.filter((item) => item !== key);
      this.fullUrlOrder.push(key);
      return cached;
    }

    const blob = await this.ensureOriginal(key);
    const cachedPreviews = blob ? null : await this.loadOfflinePreviews(key);
    if (!blob && !cachedPreviews) return '';

    const developed = this.developed.get(key);
    let previewBlob: Blob | null = cachedPreviews?.review ?? developed ?? blob ?? null;
    if (blob && !developed && isNikonEmbeddedPreviewFile(frame.filename)) {
      previewBlob = await extractNefPreview(blob);
      // Development, relinking or a project switch may finish while extraction is in flight.
      if (this.localBlobs.get(key) !== blob || this.developed.get(key) !== developed) {
        return this.hasBlob(key) ? this.getFullPreviewUrl(frame) : '';
      }
      if (!previewBlob) previewBlob = (await this.loadOfflinePreviews(key))?.review ?? null;
    }
    if (!previewBlob) return '';
    // A concurrent request for a virtual copy may already have cached this source.
    const ready = this.fullUrlCache.get(key);
    if (ready) return ready;

    const objectUrl = URL.createObjectURL(previewBlob);
    this.fullUrlCache.set(key, objectUrl);
    this.fullUrlOrder.push(key);

    while (this.fullUrlOrder.length > MAX_FULL_PREVIEW_CACHE) {
      const oldestKey = this.fullUrlOrder.shift();
      if (oldestKey) {
        const oldUrl = this.fullUrlCache.get(oldestKey);
        if (oldUrl) URL.revokeObjectURL(oldUrl);
        this.fullUrlCache.delete(oldestKey);
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

    const key = this.fullFrameKeys.get(frameId);
    this.fullFrameKeys.delete(frameId);
    // A virtual copy may still be using this source URL.
    if (key && ![...this.fullFrameKeys.values()].includes(key)) this.invalidateFullPreview(key);
  }

  clear(): void {
    this.offlinePreviewEpoch += 1;
    for (const url of this.thumbUrlCache.values()) {
      if (url.startsWith('blob:')) URL.revokeObjectURL(url);
    }
    for (const url of this.fullUrlCache.values()) {
      if (url.startsWith('blob:')) URL.revokeObjectURL(url);
    }
    this.thumbUrlCache.clear();
    this.fullUrlCache.clear();
    this.fullFrameKeys.clear();
    this.fullUrlOrder = [];
    this.localBlobs.clear();
    this.linked.clear();
    this.linkedLoading.clear();
    this.linkedOrder = [];
    this.developed.clear();
    this.pendingThumbs.clear();
    this.offlinePreviews.clear();
    this.offlinePreviewOrder = [];
    this.pendingOfflinePreviews.clear();
  }

  private async buildLocalThumbnailUrl(frame: PhotoFrame): Promise<string> {
    const blob = await this.ensureOriginal(frame.stableKey);
    if (!blob) {
      const cached = await this.loadOfflinePreviews(frame.stableKey);
      if (!cached) return '';
      const url = URL.createObjectURL(cached.thumbnail);
      this.thumbUrlCache.set(frame.id, url);
      return url;
    }

    let sourceBlob: Blob = blob;
    if (isNikonEmbeddedPreviewFile(frame.filename)) {
      const extracted = await extractNefPreview(blob);
      if (!extracted) {
        const cached = await this.loadOfflinePreviews(frame.stableKey);
        if (!cached) return '';
        const url = URL.createObjectURL(cached.thumbnail);
        this.thumbUrlCache.set(frame.id, url);
        return url;
      }
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

  private async loadOfflinePreviews(stableKey: string): Promise<OfflinePreviewPair | null> {
    const cached = this.offlinePreviews.get(stableKey);
    if (cached) {
      this.rememberOfflinePreview(stableKey, cached);
      return cached;
    }
    if (!this.offlinePreviewCache) return null;
    const pending = this.pendingOfflinePreviews.get(stableKey);
    if (pending) return pending;
    const epoch = this.offlinePreviewEpoch;
    const task = this.offlinePreviewCache.loadPreviewPair(stableKey).then((previews) => {
      if (epoch !== this.offlinePreviewEpoch) return null;
      if (previews) this.rememberOfflinePreview(stableKey, previews);
      return previews;
    }).finally(() => this.pendingOfflinePreviews.delete(stableKey));
    this.pendingOfflinePreviews.set(stableKey, task);
    return task;
  }

  private rememberOfflinePreview(stableKey: string, previews: OfflinePreviewPair): void {
    this.offlinePreviews.set(stableKey, previews);
    this.offlinePreviewOrder = this.offlinePreviewOrder.filter((key) => key !== stableKey);
    this.offlinePreviewOrder.push(stableKey);
    while (this.offlinePreviewOrder.length > MAX_OFFLINE_PREVIEW_MEMORY) {
      const oldest = this.offlinePreviewOrder.shift();
      if (oldest) this.offlinePreviews.delete(oldest);
    }
  }
}

async function encodePreview(bitmap: ImageBitmap, maxDimension: number): Promise<Blob> {
  const scale = Math.min(1, maxDimension / Math.max(bitmap.width, bitmap.height));
  const canvas = document.createElement('canvas');
  canvas.width = Math.max(1, Math.round(bitmap.width * scale));
  canvas.height = Math.max(1, Math.round(bitmap.height * scale));
  const context = canvas.getContext('2d');
  if (!context) throw new Error('Could not prepare an offline photo preview.');
  context.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
  const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, 'image/jpeg', 0.82));
  if (!blob) throw new Error('Could not save an offline photo preview.');
  return blob;
}
