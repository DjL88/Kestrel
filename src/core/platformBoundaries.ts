import type {
  CullingState,
  ExifMetadata,
  PhotoFrame,
  ShootDescriptor,
} from './types';

/**
 * Explicit boundary error thrown by the browser RawDecoder implementation.
 * Embedded JPEG previews inside NEF containers are never treated as evidence
 * of full RAW demosaicing support.
 */
export class NativeRawUnsupportedError extends Error {
  readonly code = 'NATIVE_RAW_UNSUPPORTED';
  constructor(filename: string) {
    super(
      `Full RAW decoding for "${filename}" requires the native desktop RawDecoder (libraw / Nikon NEF pipeline).`
    );
    this.name = 'NativeRawUnsupportedError';
  }
}

export interface ProgressiveFrameBatch {
  frames: PhotoFrame[];
  loadedCount: number;
  totalCount: number;
  done: boolean;
}

/**
 * Boundary 1: Shoot Source Discovery
 * - Browser implementation: Demo generator, <input type="file">, or FileSystemDirectoryHandle.
 * - Desktop (Tauri) implementation: Native std::fs directory scanner + NAS/SMB bookmark resolver.
 */
export interface ShootSource {
  readonly kind: 'demo' | 'browser-files' | 'browser-folder' | 'native-folder';
  openShoot(
    onBatch: (batch: ProgressiveFrameBatch) => void,
    signal?: AbortSignal
  ): Promise<ShootDescriptor>;
  relinkFolder?(): Promise<boolean>;
}

/**
 * Boundary 2: Metadata & Embedded Preview Extraction
 * - Browser implementation: exifr for JPEGs + minimal IFD/SOI-EOI scanner for NEF embedded JPEGs.
 * - Desktop (Tauri) implementation: Rust exiv2 / kamadak-exif + direct NEF PreviewImage IFD extraction.
 */
export interface MetadataExtractor {
  extractMetadata(file: File | Blob, filename: string): Promise<ExifMetadata>;
  extractEmbeddedPreview?(
    buffer: ArrayBuffer,
    filename: string
  ): Promise<{ blob: Blob; isEmbeddedPreviewOnly: boolean } | null>;
}

/**
 * Boundary 3: Cached Preview Delivery (Separated from Read-Only Originals)
 * - Browser implementation: In-memory LRU + Canvas/ObjectURL cache.
 * - Desktop (Tauri) implementation: Sidecar WebP/JPEG preview cache in app_cache_dir keyed by stableKey.
 */
export interface PreviewProvider {
  getThumbnailUrl(frame: PhotoFrame): Promise<string>;
  getFullPreviewUrl(frame: PhotoFrame): Promise<string>;
  releaseFrame(frameId: string): void;
  clear(): void;
}

/**
 * Boundary 4: Full Native RAW Decoding & Export (Native Desktop Only)
 * - Intentionally unimplemented in browser prototype; throws NativeRawUnsupportedError.
 * - Desktop (Tauri) implementation: libraw + Nikon High-Efficiency/Lossless NEF validation + LCMS2 color pipeline.
 */
export interface RawDecoder {
  readonly isNativeAvailable: boolean;
  supportsExtension(filename: string): boolean;
  decodeFullRaw(
    stableKey: string,
    filename: string
  ): Promise<{ width: number; height: number; rgbaBuffer: Uint8Array }>;
}

/**
 * Boundary 5: Offline Catalogue Persistence
 * - Browser implementation: IndexedDB (decisions, shoot metadata, local file blobs/handles) + localStorage preferences.
 * - Desktop (Tauri) implementation: Local SQLite database with stable volume + relative-path IDs for NAS relinking.
 */
export interface CatalogueStore {
  loadActiveState(): Promise<Partial<CullingState> | null>;
  saveCullingState(state: CullingState): Promise<void>;
  clearAll(): Promise<void>;
}
