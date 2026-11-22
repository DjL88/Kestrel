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
];

const BY_EXT = new Map(RAW_FORMATS.map((format) => [format.ext, format]));
const extensionOf = (filename: string) => /\.([a-z0-9]+)$/i.exec(filename)?.[1].toLowerCase() ?? '';

export const rawFormatOf = (filename: string): RawFormat | undefined => BY_EXT.get(extensionOf(filename));
export const isRawPreviewFile = (filename: string) => BY_EXT.has(extensionOf(filename));

/** "CR3 Embedded Preview", for the info panel. */
export const rawPreviewLabel = (filename: string) => `${extensionOf(filename).toUpperCase()} Embedded Preview`;

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
