/** Resizable filmstrip is a local device preference, never a photo-edit recipe. */
export const FILMSTRIP_SIZE_KEY = 'kestrel-filmstrip-height-v1';
export const DEFAULT_FILMSTRIP_HEIGHT = 140;

export function clampFilmstripHeight(height: number, viewportHeight: number): number {
  const maximum = Number.isFinite(viewportHeight)
    ? Math.max(80, Math.min(340, Math.floor(viewportHeight * 0.4)))
    : 280;
  if (!Number.isFinite(height)) return Math.min(DEFAULT_FILMSTRIP_HEIGHT, maximum);
  return Math.round(Math.max(80, Math.min(maximum, height)));
}

export function parseFilmstripHeight(raw: string | null, viewportHeight: number): number {
  if (raw === null) return clampFilmstripHeight(DEFAULT_FILMSTRIP_HEIGHT, viewportHeight);
  try {
    const value: unknown = JSON.parse(raw);
    return clampFilmstripHeight(typeof value === 'number' ? value : NaN, viewportHeight);
  } catch {
    return clampFilmstripHeight(DEFAULT_FILMSTRIP_HEIGHT, viewportHeight);
  }
}

/** Thumbnails use all available vertical space; virtualization stays in sync with the resize. */
export function filmstripTileGeometry(height: number): { width: number; height: number; stride: number } {
  const tileHeight = Math.max(48, Math.round(height - 22));
  const width = Math.round(Math.max(86, Math.min(190, tileHeight * 1.2)));
  return { width, height: tileHeight, stride: width + 8 };
}
