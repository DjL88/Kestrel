/**
 * The part of HEIF decoding that only needs libheif: bytes in, full-size RGBA pixels out, the right way up. It runs in
 * the decoding worker (heifWasmWorker.ts) and in the unit tests under Node, so both use the same code.
 *
 * libheif applies the file's own rotation and mirroring (the HEIF `irot`/`imir` boxes) while decoding, which is how
 * iPhones and cameras record orientation in HEIF; the EXIF orientation tag inside a HEIF file must not be applied again.
 */

/** The few libheif-js calls Kestrel uses (libheif-js 1.23.5, libheif-wasm/libheif-bundle.mjs). */
interface HeifImageHandle {
  get_width(): number;
  get_height(): number;
  is_primary(): boolean;
  display(target: { data: Uint8ClampedArray; width: number; height: number }, done: (result: unknown) => void): void;
  free(): void;
}
interface HeifModule {
  HeifDecoder: new () => { decoder: unknown; decode(bytes: Uint8Array): HeifImageHandle[] };
  heif_context_free?(context: unknown): void;
}
export type HeifModuleFactory = (options?: Record<string, unknown>) => Promise<HeifModule> | HeifModule;

export interface HeifPixels { width: number; height: number; data: Uint8ClampedArray<ArrayBuffer> }

/** Larger than any HEIF camera or phone makes today (a 200-megapixel phone frame is 16,320 × 12,240). */
const MAX_SIDE = 32_768;
const MAX_PIXELS = 250_000_000;

export class HeifUndecodableError extends Error {
  constructor(message = 'This HEIF photo could not be decoded.') {
    super(message);
    this.name = 'HeifUndecodableError';
  }
}

let loaded: Promise<HeifModule> | null = null;
let loadedFrom: HeifModuleFactory | null = null;

function moduleFrom(factory: HeifModuleFactory): Promise<HeifModule> {
  if (loaded && loadedFrom === factory) return loaded;
  loadedFrom = factory;
  loaded = Promise.resolve(factory()).catch((error) => { loaded = null; throw error; });
  return loaded;
}

/** Decode the primary picture of a HEIF file (HEIC, HEIF or HIF). Rejects with HeifUndecodableError. */
export async function decodeHeifPixels(factory: HeifModuleFactory, bytes: Uint8Array): Promise<HeifPixels> {
  const lib = await moduleFrom(factory);
  const decoder = new lib.HeifDecoder();
  let images: HeifImageHandle[] = [];
  try {
    try {
      images = decoder.decode(bytes);
    } catch {
      throw new HeifUndecodableError();
    }
    const image = images.find((candidate) => candidate.is_primary()) ?? images[0];
    if (!image) throw new HeifUndecodableError();
    const width = image.get_width();
    const height = image.get_height();
    if (!Number.isSafeInteger(width) || !Number.isSafeInteger(height) || width <= 0 || height <= 0
        || width > MAX_SIDE || height > MAX_SIDE || width * height > MAX_PIXELS) {
      throw new HeifUndecodableError('This HEIF photo has a picture size Kestrel cannot open.');
    }
    const target = { data: new Uint8ClampedArray(width * height * 4), width, height };
    const result = await new Promise<unknown>((resolve) => image.display(target, resolve));
    if (!result) throw new HeifUndecodableError();
    return target;
  } finally {
    for (const image of images) image.free();
    if (decoder.decoder && lib.heif_context_free) lib.heif_context_free(decoder.decoder);
  }
}
