import type { CullSuggestion } from './autoCull';
import type { PhotoFrame } from './types';

export interface CullPreviewEvidence {
  result: CullSuggestion;
  base?: CullSuggestion;
}

export interface OriginalVersion {
  size: number;
  lastModified?: number;
}

interface CacheEntry {
  id: string;
  stableKey: string;
  size: number;
  modified: number;
  evidence: CullPreviewEvidence;
}

/**
 * Transient, numeric evidence only; never store pixels, image objects, models,
 * paths, EXIF secrets or automatic decisions. One cache belongs to one import
 * within one project and one checked detector build.
 */
export class ImportCullCache {
  readonly projectId: string;
  readonly importId: string;
  readonly modelHash: string;
  private readonly records = new Map<string, CacheEntry>();
  private healthy = true;

  constructor(projectId: string, importId: string, modelHash: string, private readonly capacity = 512) {
    this.projectId = projectId;
    this.importId = importId;
    this.modelHash = modelHash;
  }

  private validVersion(info: OriginalVersion | undefined): info is OriginalVersion & { lastModified: number } {
    return !!info && Number.isSafeInteger(info.size) && info.size > 0 &&
      typeof info.lastModified === 'number' && Number.isFinite(info.lastModified) && info.lastModified >= 0;
  }

  put(frame: Pick<PhotoFrame, 'id' | 'stableKey'>, info: OriginalVersion | undefined, evidence: CullPreviewEvidence): void {
    if (!this.healthy || !this.validVersion(info) || this.capacity < 1 ||
        !frame.id.startsWith(`${this.importId}-`) || !frame.stableKey ||
        evidence.result.frameId !== frame.id ||
        (evidence.base && evidence.base.frameId !== frame.id)) return;
    // A source that could not be decoded is retried by the final cull, not
    // treated as a permanently missing photograph.
    if (evidence.result.reason === 'unavailable' || evidence.base?.reason === 'unavailable') return;
    if (!this.records.has(frame.id) && this.records.size >= this.capacity) {
      this.records.delete(this.records.keys().next().value as string);
    }
    this.records.set(frame.id, {
      id: frame.id, stableKey: frame.stableKey, size: info.size,
      modified: info.lastModified, evidence,
    });
  }

  get(
    projectId: string,
    frame: Pick<PhotoFrame, 'id' | 'stableKey'>,
    info: OriginalVersion | undefined,
    modelHash: string,
  ): CullPreviewEvidence | undefined {
    if (!this.healthy || projectId !== this.projectId || modelHash !== this.modelHash ||
        !this.validVersion(info)) return undefined;
    const entry = this.records.get(frame.id);
    if (!entry || entry.stableKey !== frame.stableKey ||
        entry.size !== info.size || entry.modified !== info.lastModified) return undefined;
    return entry.evidence;
  }

  /** Any failed inference invalidates all early model evidence for this import. */
  failDetector(): void { this.healthy = false; this.records.clear(); }
  clear(): void { this.records.clear(); }
  get usable(): boolean { return this.healthy; }
  get size(): number { return this.records.size; }
}
