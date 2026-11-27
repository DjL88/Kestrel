/**
 * Camera RAW files InFlight can open. Import and the grid use the JPEG preview the camera stored inside them; opening a
 * photo in the editor then develops the sensor data where it can (desktop app, and the WebAssembly pipeline in the web
 * app) and says so, otherwise it keeps the embedded preview and says that instead. A file whose preview cannot be found
 * is reported as such, never faked. Support for each maker is only claimed after real files from the camera are tested.
 */
export interface RawFormat { ext: string; brand: string }

export const RAW_FORMATS: RawFormat[] = [
  { ext: 'nef', brand: 'Nikon' }, { ext: 'nrw', brand: 'Nikon' },
  { ext: 'arw', brand: 'Sony' }, { ext: 'srf', brand: 'Sony' }, { ext: 'sr2', brand: 'Sony' },
  { ext: 'cr2', brand: 'Canon' }, { ext: 'cr3', brand: 'Canon' },
  { ext: 'raf', brand: 'Fujifilm' },
  { ext: 'rw2', brand: 'Panasonic' },
  { ext: 'orf', brand: 'OM System' },
  { ext: 'pef', brand: 'Pentax' },
  { ext: 'dng', brand: 'Adobe DNG' },
  { ext: 'srw', brand: 'Samsung' },
  { ext: '3fr', brand: 'Hasselblad' }, { ext: 'fff', brand: 'Hasselblad' },
  { ext: 'iiq', brand: 'Phase One' },
  { ext: 'rwl', brand: 'Leica' },
  { ext: 'mos', brand: 'Leaf' },
];

/**
 * The RAW types InFlight's own decoder (rawler in crates/kestrel-raw, ticoraw for Nikon HE/HE*) is asked to develop, on
 * the desktop and in WebAssembly. One list for every caller, so the import list and the decoder cannot drift apart. Sony
 * SRF and SR2 are imported for their embedded preview only. Being on this list is not a claim that every camera works:
 * the cameras proven on real files are listed in scripts/fetch-raw-samples.mjs.
 */
export const DEVELOP_RAW_EXTENSIONS: readonly string[] = [
  'nef', 'nrw', 'cr2', 'cr3', 'arw', 'raf', 'rw2', 'orf', 'pef', 'dng', 'srw', '3fr', 'fff', 'iiq', 'rwl', 'mos',
];
const extensionOf = (filename: string) => /\.([a-z0-9]+)$/i.exec(filename)?.[1].toLowerCase() ?? '';
const DEVELOP_SET = new Set(DEVELOP_RAW_EXTENSIONS);
/** Whether InFlight's decoder is asked to develop this file type (lower-case extension, no dot). */
export const isDevelopRawExtension = (extension: string) => DEVELOP_SET.has(extension);
/** Whether this file name ends in a RAW type InFlight's decoder develops. */
export const isDevelopRawFile = (filename: string) => DEVELOP_SET.has(extensionOf(filename));

const BY_EXT = new Map(RAW_FORMATS.map((format) => [format.ext, format]));

export const rawFormatOf = (filename: string): RawFormat | undefined => BY_EXT.get(extensionOf(filename));
export const isRawPreviewFile = (filename: string) => BY_EXT.has(extensionOf(filename));

/** Browser image formats eligible for verified, full-size Original export. */
export function fullResolutionRasterFormat(filename: string): 'jpeg' | 'png' | null {
  const extension = extensionOf(filename);
  if (extension === 'jpg' || extension === 'jpeg') return 'jpeg';
  return extension === 'png' ? 'png' : null;
}

/**
 * "NEF RAW", for the info panel's Format: the file's own format. It used to say "NEF Embedded Preview", which describes a
 * picture, not the file, and contradicted "Picture shown: Developed from RAW" once the sensor develop was on screen.
 */
export const rawPreviewLabel = (filename: string) => `${extensionOf(filename).toUpperCase()} RAW`;

/** The Format to show for a photo: a RAW always by its own format, also when an older catalogue stored the old label. */
export const shownFileFormat = (filename: string, stored: string | undefined): string | undefined =>
  isRawPreviewFile(filename) && (!stored || /embedded preview/i.test(stored)) ? rawPreviewLabel(filename) : stored;

/** HEIF types detected by the catalogue and metadata reader. Pixel decoding depends on the platform. */
export const HEIF_EXTENSIONS = ['heic', 'heif', 'hif'];
/** What browsers and operating systems call HEIF files. Some report none at all, so the extension decides. */
export const HEIF_MIME_TYPES = ['image/heic', 'image/heif', 'image/heic-sequence', 'image/heif-sequence'];
const HEIF_EXT = new Set(HEIF_EXTENSIONS);

export const isHeifFile = (filename: string) => HEIF_EXT.has(extensionOf(filename));

/** "HEIC", "HEIF" or "HIF", for the info panel. */
export const heifFormatLabel = (filename: string) => extensionOf(filename).toUpperCase();

const HEIF_BRANDS = new Set(['heic', 'heix', 'heim', 'heis', 'hevc', 'hevx', 'hevm', 'hevs', 'mif1', 'msf1']);

/**
 * Whether the first bytes are a HEIF file (an ISO media file whose brands name a HEIF still picture), whatever the file
 * is called. A Canon CR3 is also an ISO media file but its brands say "crx ", so it is not mistaken for one.
 */
export function looksLikeHeif(head: Uint8Array): boolean {
  if (head.length < 16) return false;
  const text = (at: number) => String.fromCharCode(head[at], head[at + 1], head[at + 2], head[at + 3]);
  if (text(4) !== 'ftyp') return false;
  const size = Math.min(head.length, ((head[0] << 24) | (head[1] << 16) | (head[2] << 8) | head[3]) >>> 0);
  const brands = [text(8)];
  for (let at = 16; at + 4 <= size; at += 4) brands.push(text(at));
  return brands.some((brand) => HEIF_BRANDS.has(brand));
}

export const PHOTO_EXTENSIONS = [
  '.jpg', '.jpeg', '.png', '.webp',
  ...HEIF_EXTENSIONS.map((ext) => `.${ext}`),
  ...RAW_FORMATS.map((format) => `.${format.ext}`),
];
/** For file pickers. */
export const PHOTO_ACCEPT = [...PHOTO_EXTENSIONS, 'image/jpeg', 'image/png', 'image/webp', ...HEIF_MIME_TYPES].join(',');
export const RAW_ACCEPT = RAW_FORMATS.map((format) => `.${format.ext}`).join(',');
