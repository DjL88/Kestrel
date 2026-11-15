/**
 * Camera RAW files Kestrel can open by reading the JPEG preview the camera stored inside them. This is NOT full RAW
 * decoding: the picture shown, edited and exported is that embedded preview. A file whose preview cannot be found is
 * reported as such, never faked. Support for each maker is only claimed after real files from the camera are tested.
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

export const PHOTO_EXTENSIONS = ['.jpg', '.jpeg', '.png', '.webp', ...RAW_FORMATS.map((format) => `.${format.ext}`)];
/** For file pickers. */
export const PHOTO_ACCEPT = [...PHOTO_EXTENSIONS, 'image/jpeg', 'image/png', 'image/webp'].join(',');
export const RAW_ACCEPT = PHOTO_EXTENSIONS.slice(4).join(',');
