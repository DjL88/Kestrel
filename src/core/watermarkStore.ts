import { NO_WATERMARK, WATERMARK_FONTS, type WatermarkOptions, type WatermarkPosition } from './watermark';
import { isWatermarkAssetId } from './watermarkAssetVault';

const POSITIONS: WatermarkPosition[] = ['top-left', 'top-right', 'bottom-left', 'bottom-right', 'centre', 'tiled'];
const clamp = (value: unknown, low: number, high: number, fallback: number) => typeof value === 'number' && Number.isFinite(value) ? Math.min(high, Math.max(low, value)) : fallback;

/** Read saved watermark settings back safely: anything missing or odd falls back to the defaults. */
export function parseWatermark(raw: string | null): WatermarkOptions {
  if (!raw) return NO_WATERMARK;
  try {
    const value = JSON.parse(raw) as Partial<WatermarkOptions>;
    const image = typeof value.imageData === 'string' && /^data:image\/(png|jpeg|webp);base64,/.test(value.imageData) ? value.imageData : undefined;
    const imageAssetId = isWatermarkAssetId(value.imageAssetId) ? value.imageAssetId : undefined;
    return {
      on: value.on === true,
      kind: value.kind === 'image' && (image || imageAssetId) ? 'image' : 'text',
      text: typeof value.text === 'string' ? value.text.slice(0, 80) : '',
      imageData: image,
      ...(imageAssetId ? { imageAssetId } : {}),
      position: POSITIONS.includes(value.position as WatermarkPosition) ? value.position as WatermarkPosition : NO_WATERMARK.position,
      size: clamp(value.size, 0.03, 0.5, NO_WATERMARK.size),
      opacity: clamp(value.opacity, 0.15, 1, NO_WATERMARK.opacity),
      tone: value.tone === 'dark' || value.tone === 'light' ? value.tone : 'auto',
      font: WATERMARK_FONTS.some(entry => entry.id === value.font) ? value.font : 'inter',
    };
  } catch {
    return NO_WATERMARK;
  }
}

/** Never serialize renderer image bytes or data URLs into local settings/presets.
 * Historical inline marks are migrated to the local vault before this is called.
 */
export function watermarkForStorage(mark: WatermarkOptions): WatermarkOptions {
  const saved = { ...mark };
  delete saved.imageData;
  if (saved.kind === 'image' && !isWatermarkAssetId(saved.imageAssetId)) {
    throw new Error('Save the image watermark privately on this device before saving its preset.');
  }
  return saved;
}
