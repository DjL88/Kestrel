import {
  loadOfflinePreview,
  loadOfflinePreviewPair,
  previewCacheKey,
  saveOfflinePreview,
  saveOfflinePreviewPair,
  type OfflinePreviewPair,
} from './offlinePreviewCache';
import { extractNefPreview } from '../core/nefPreview';
import { PriorityReadQueue, type ReadPriority } from '../core/priorityReadQueue';
import { isRawPreviewFile } from '../core/rawFormats';
import {
  NativeRawUnsupportedError,
  type PreviewProvider,
  type RawDecoder,
} from '../core/platformBoundaries';
import type { PhotoFrame } from '../core/types';
import { materialize, type RangeBlob } from './rangeBlob';

const MAX_FULL_PREVIEW_CACHE = 24;
const MAX_OFFLINE_PREVIEW_MEMORY = 24;
const THUMB_MAX_WIDTH = 400;
const REVIEW_MAX_WIDTH = 2200;
const MAX_CACHED_PREVIEW_BYTES = 1024 * 1024;

export type { OfflinePreviewPair } from './offlinePreviewCache';

export interface OfflinePreviewCache {
  savePreviewPair(stableKey: string, previews: OfflinePreviewPair): Promise<boolean>;
  loadPreviewPair(stableKey: string): Promise<OfflinePreviewPair | null>;
}

const persistentPreviewCache: OfflinePreviewCache = {
  savePreviewPair: saveOfflinePreviewPair,
  loadPreviewPair: loadOfflinePreviewPair,
};

export class BrowserRawDecoder implements RawDecoder {
  readonly isNativeAvailable = false;

  supportsExtension(filename: string): boolean {
    const lower = filename.toLowerCase();
    return isRawPreviewFile(filename);
  }

  async decodeFullRaw(_stableKey: string, filename: string): Promise<never> {
    throw new NativeRawUnsupportedError(filename);
  }
}

export class BrowserPreviewProvider implements PreviewProvider {
  constructor(private readonly offlinePreviewCache: OfflinePreviewCache = persistentPreviewCache) {}

  private localBlobs = new Map<string, Blob>();
  private thumbUrlCache = new Map<string, string>();
  private fullUrlCache = new Map<string, string>();
  private fullFrameKeys = new Map<string, string>();
  private fullUrlOrder: string[] = [];
  private offlineFullKeys = new Set<string>();
  private pendingThumbs = new Map<string, Promise<string>>();
  private offlinePreviews = new Map<string, OfflinePreviewPair>();
  private offlinePreviewOrder: string[] = [];
  private pendingOfflinePreviews = new Map<string, Promise<OfflinePreviewPair | null>>();
  private offlinePreviewEpoch = 0;

  registerBlob(stableKey: string, blob: Blob): void {
    const previous = this.localBlobs.get(stableKey);
    if (previous !== blob) {
      this.invalidateDevelopment(stableKey);
      this.invalidateFullPreview(stableKey);
    }
    this.localBlobs.set(stableKey, blob);
    if (this.offlineFullKeys.has(stableKey)) this.invalidateFullPreview(stableKey);
  }

  /** Photos that stay on the disk: how to read each one, and what it was like when added. Read only when needed. */
  private linked = new Map<string, { read: () => Promise<Blob>; size: number; lastModified: number }>();
  private linkedLoading = new Map<string, Promise<Blob | undefined>>();
  private linkedGeneration = new Map<string, number>();
  private linkedOrder: string[] = [];
  private readonly reads = new PriorityReadQueue(3);

  /** A selected photo must not wait behind thumbnails from a previous scroll location. */
  prioritizeOriginalRead(stableKey: string, priority: ReadPriority = 'selected'): void {
    this.reads.promote(stableKey, priority);
  }

  registerLinked(stableKey: string, info: { read: () => Promise<Blob>; size: number; lastModified: number }): void {
    const previous = this.linked.get(stableKey);
    if (previous && (previous.size !== info.size || previous.lastModified !== info.lastModified)) {
      this.linkedGeneration.set(stableKey, (this.linkedGeneration.get(stableKey) ?? 0) + 1);
      this.linkedLoading.delete(stableKey);
      this.localBlobs.delete(stableKey);
      this.invalidateDevelopment(stableKey);
      this.invalidateFullPreview(stableKey);
    }
    this.linked.set(stableKey, info);
    // A newly accessible original must replace a low-resolution offline fallback.
    if (this.offlineFullKeys.has(stableKey)) this.invalidateFullPreview(stableKey);
  }

  /** Retry a reconnected disk without changing catalogue decisions or edits. */
  retryLinkedOriginal(stableKey: string): void {
    if (!this.linked.has(stableKey)) return;
    this.linkedGeneration.set(stableKey, (this.linkedGeneration.get(stableKey) ?? 0) + 1);
    this.linkedLoading.delete(stableKey);
    this.localBlobs.delete(stableKey);
    this.invalidateDevelopment(stableKey);
    this.invalidateFullPreview(stableKey);
  }

  getOriginal(stableKey: string): Blob | undefined {
    return this.localBlobs.get(stableKey);
  }

  /** The original, reading it from the disk first if it is a linked one. Only a few linked photos are held at once. */
  async ensureOriginal(stableKey: string, priority: ReadPriority = 'background'): Promise<Blob | undefined> {
    const held = this.localBlobs.get(stableKey);
    if (held) return held;
    const link = this.linked.get(stableKey);
    if (!link) return undefined;
    const pending = this.linkedLoading.get(stableKey);
    if (pending) {
      this.prioritizeOriginalRead(stableKey, priority);
      return pending;
    }
    const generation = this.linkedGeneration.get(stableKey) ?? 0;
    const task = this.reads.run(link.read, priority, stableKey).then((blob) => {
      // A previous drive read must not resurrect an old original after relinking.
      if ((this.linkedGeneration.get(stableKey) ?? 0) !== generation || this.linked.get(stableKey) !== link) return undefined;
      this.localBlobs.set(stableKey, blob);
      this.linkedOrder = this.linkedOrder.filter((key) => key !== stableKey);
      this.linkedOrder.push(stableKey);
      while (this.linkedOrder.length > 6) {
        const oldest = this.linkedOrder.shift()!;
        if (oldest !== stableKey) this.localBlobs.delete(oldest);
      }
      return blob;
    }).catch(() => undefined).finally(() => {
      if (this.linkedLoading.get(stableKey) === task) this.linkedLoading.delete(stableKey);
    });
    this.linkedLoading.set(stableKey, task);
    return task;
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

  private offlineCacheKey(frame: PhotoFrame): string {
    const info = this.originalInfo(frame.stableKey);
    const parts = frame.stableKey.split('::');
    const storedSize = Number(parts.at(-2));
    const storedModified = Number(parts.at(-1));
    return previewCacheKey({
      stableKey: frame.stableKey,
      filename: frame.filename,
      fileSize: info?.size ?? (Number.isFinite(storedSize) && storedSize > 0 ? storedSize : undefined),
      lastModified: info?.lastModified ?? (Number.isFinite(storedModified) && storedModified >= 0 ? storedModified : undefined),
    });
  }

  /** Save small, nondestructive source previews for linked originals; never persist the original itself. */
  async cacheOfflinePreviews(stableKey: string, filename: string, original: Blob | RangeBlob): Promise<boolean> {
    // A RAW is never decoded by the browser: without an embedded preview there is nothing to cache (the photo stays
    // usable from its original). Reading the whole RAW just to fail in createImageBitmap was the slowest import path.
    const source = isRawPreviewFile(filename) ? await extractNefPreview(original as Blob) : original;
    if (!source) return false;
    // Ranged originals hand back only the preview's bytes; turn just those into a real Blob for decoding.
    const bitmap = await createImageBitmap(await materialize(source, 'image/jpeg'));
    try {
      const thumbnail = await encodePreview(bitmap, THUMB_MAX_WIDTH);
      const previews = {
        thumbnail,
        review: await encodePreview(bitmap, REVIEW_MAX_WIDTH, MAX_CACHED_PREVIEW_BYTES - thumbnail.size),
      };
      const info = this.originalInfo(stableKey);
      const cacheKey = previewCacheKey({
        stableKey,
        filename,
        fileSize: info?.size ?? original.size,
        lastModified: info?.lastModified ?? (typeof File !== 'undefined' && original instanceof File ? original.lastModified : undefined),
      });
      const saved = await this.offlinePreviewCache.savePreviewPair(cacheKey, previews);
      if (!saved) this.rememberOfflinePreview(cacheKey, previews);
      return saved;
    } finally {
      bitmap.close();
    }
  }

  async getThumbnailUrl(frame: PhotoFrame, priority: ReadPriority = 'visible'): Promise<string> {
    if (frame.isDemo && frame.demoVariant) {
      const { DEMO_ASSET_URLS } = await import('./demoAssets');
      return DEMO_ASSET_URLS[frame.demoVariant.assetKey];
    }

    const cached = this.thumbUrlCache.get(frame.id);
    if (cached) return cached;

    const existingPromise = this.pendingThumbs.get(frame.id);
    if (existingPromise) {
      this.prioritizeOriginalRead(frame.stableKey, priority);
      return existingPromise;
    }

    const task = this.buildLocalThumbnailUrl(frame, priority).finally(() => {
      this.pendingThumbs.delete(frame.id);
    });
    this.pendingThumbs.set(frame.id, task);
    return task;
  }

  /** Pictures developed from the RAW sensor data, kept for this session. They stand in for the embedded preview. */
  private developed = new Map<string, Blob>();
  private developing = new Map<string, symbol>();

  isDeveloped(stableKey: string): boolean { return this.developed.has(stableKey); }

  private invalidateDevelopment(stableKey: string): void {
    this.developed.delete(stableKey);
    this.developing.delete(stableKey);
  }

  /** Install only a result that still belongs to the current original and decode request. */
  async developFromOriginal(
    stableKey: string,
    develop: (original: Blob) => Promise<Blob>,
  ): Promise<'ready' | 'missing' | 'superseded'> {
    const request = Symbol();
    this.developing.set(stableKey, request);
    try {
      const original = await this.ensureOriginal(stableKey, 'selected');
      if (this.developing.get(stableKey) !== request) return 'superseded';
      if (!original) return 'missing';
      const picture = await develop(original);
      if (this.developing.get(stableKey) !== request) return 'superseded';
      this.developed.set(stableKey, picture);
      this.invalidateFullPreview(stableKey);
      return 'ready';
    } catch (error) {
      if (this.developing.get(stableKey) !== request) return 'superseded';
      throw error;
    } finally {
      if (this.developing.get(stableKey) === request) this.developing.delete(stableKey);
    }
  }

  private invalidateFullPreview(key: string): void {
    const stale = this.fullUrlCache.get(key);
    if (stale) URL.revokeObjectURL(stale);
    this.fullUrlCache.delete(key);
    this.offlineFullKeys.delete(key);
    this.fullUrlOrder = this.fullUrlOrder.filter((item) => item !== key);
  }

  async getFullPreviewUrl(frame: PhotoFrame, priority: ReadPriority = 'visible'): Promise<string> {
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

    const blob = await this.ensureOriginal(key, priority);
    const cacheKey = this.offlineCacheKey(frame);
    const cachedPreviews = await this.loadOfflinePreviews(cacheKey);
    if (!blob) {
      // The original drive may be disconnected. Show a cached preview,
      // never imply this is suitable for full-resolution export or RAW editing.
      const offline = this.developed.get(key) ?? cachedPreviews?.review ?? await loadOfflinePreview(cacheKey);
      if (!offline) return '';
      const fallbackUrl = URL.createObjectURL(offline);
      this.fullUrlCache.set(key, fallbackUrl);
      if (offline !== this.developed.get(key)) this.offlineFullKeys.add(key);
      this.fullUrlOrder.push(key);
      while (this.fullUrlOrder.length > MAX_FULL_PREVIEW_CACHE) {
        const oldest = this.fullUrlOrder.shift();
        if (!oldest) continue;
        const stale = this.fullUrlCache.get(oldest);
        if (stale) URL.revokeObjectURL(stale);
        this.fullUrlCache.delete(oldest);
        this.offlineFullKeys.delete(oldest);
      }
      return fallbackUrl;
    }

    const developed = this.developed.get(key);
    let previewBlob: Blob | null = developed ?? blob;
    if (blob && !developed && isRawPreviewFile(frame.filename)) {
      previewBlob = await extractNefPreview(blob);
      // Development, relinking or a project switch may finish while extraction is in flight.
      if (this.localBlobs.get(key) !== blob || this.developed.get(key) !== developed) {
        return this.hasBlob(key) ? this.getFullPreviewUrl(frame) : '';
      }
      if (!previewBlob) previewBlob = cachedPreviews?.review ?? null;
    }
    if (!previewBlob) return '';
    // A concurrent request for a virtual copy may already have cached this source.
    const ready = this.fullUrlCache.get(key);
    if (ready) return ready;

    const objectUrl = URL.createObjectURL(previewBlob);
    this.fullUrlCache.set(key, objectUrl);
    this.offlineFullKeys.delete(key);
    this.fullUrlOrder.push(key);

    while (this.fullUrlOrder.length > MAX_FULL_PREVIEW_CACHE) {
      const oldestKey = this.fullUrlOrder.shift();
      if (oldestKey) {
        const oldUrl = this.fullUrlCache.get(oldestKey);
        if (oldUrl) URL.revokeObjectURL(oldUrl);
        this.fullUrlCache.delete(oldestKey);
        this.offlineFullKeys.delete(oldestKey);
      }
    }

    return objectUrl;
  }

  /** A cached review image is safe for viewing, never for exporting as an original. */
  isOfflineFallback(stableKey: string): boolean {
    return this.offlineFullKeys.has(stableKey);
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
    this.offlineFullKeys.clear();
    this.localBlobs.clear();
    this.linked.clear();
    this.linkedLoading.clear();
    this.linkedGeneration.clear();
    this.linkedOrder = [];
    this.developed.clear();
    this.developing.clear();
    this.pendingThumbs.clear();
    this.offlinePreviews.clear();
    this.offlinePreviewOrder = [];
    this.pendingOfflinePreviews.clear();
  }

  private async buildLocalThumbnailUrl(frame: PhotoFrame, priority: ReadPriority): Promise<string> {
    const cacheKey = this.offlineCacheKey(frame);
    const offline = await loadOfflinePreview(cacheKey);
    if (offline) {
      const url = URL.createObjectURL(offline);
      this.thumbUrlCache.set(frame.id, url);
      return url;
    }
    const blob = await this.ensureOriginal(frame.stableKey, priority);
    if (!blob) {
      const cached = await this.loadOfflinePreviews(cacheKey);
      if (!cached) return '';
      const url = URL.createObjectURL(cached.thumbnail);
      this.thumbUrlCache.set(frame.id, url);
      return url;
    }

    let sourceBlob: Blob = blob;
    if (isRawPreviewFile(frame.filename)) {
      const extracted = await extractNefPreview(blob);
      if (!extracted) {
        const cached = await this.loadOfflinePreviews(cacheKey);
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
      if (thumbBlob) void saveOfflinePreview(cacheKey, thumbBlob);
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
    let task: Promise<OfflinePreviewPair | null>;
    task = this.offlinePreviewCache.loadPreviewPair(stableKey).then((previews) => {
      if (epoch !== this.offlinePreviewEpoch) return null;
      if (previews) this.rememberOfflinePreview(stableKey, previews);
      return previews;
    }).finally(() => {
      if (this.pendingOfflinePreviews.get(stableKey) === task) this.pendingOfflinePreviews.delete(stableKey);
    });
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

async function encodePreview(bitmap: ImageBitmap, maxDimension: number, maxBytes = MAX_CACHED_PREVIEW_BYTES): Promise<Blob> {
  const minimum = maxDimension === REVIEW_MAX_WIDTH ? 800 : THUMB_MAX_WIDTH;
  for (let dimension = maxDimension; ; dimension = Math.max(minimum, Math.round(dimension * 0.8))) {
    const scale = Math.min(1, dimension / Math.max(bitmap.width, bitmap.height));
    const canvas = document.createElement('canvas');
    canvas.width = Math.max(1, Math.round(bitmap.width * scale));
    canvas.height = Math.max(1, Math.round(bitmap.height * scale));
    const context = canvas.getContext('2d');
    if (!context) throw new Error('Could not prepare an offline photo preview.');
    context.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
    for (const quality of [0.82, 0.68, 0.54]) {
      const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, 'image/jpeg', quality));
      if (!blob) throw new Error('Could not save an offline photo preview.');
      if (blob.size <= maxBytes) return blob;
    }
    if (dimension === minimum) break;
  }
  throw new Error('The offline review preview exceeds the local cache size limit.');
}
