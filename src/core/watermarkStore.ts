import { NO_WATERMARK, type WatermarkOptions, type WatermarkPosition } from './watermark';

const POSITIONS: WatermarkPosition[] = ['top-left', 'top-right', 'bottom-left', 'bottom-right', 'centre', 'tiled'];
const clamp = (value: unknown, low: number, high: number, fallback: number) => typeof value === 'number' && Number.isFinite(value) ? Math.min(high, Math.max(low, value)) : fallback;

/** Read saved watermark settings back safely: anything missing or odd falls back to the defaults. */
export function parseWatermark(raw: string | null): WatermarkOptions {
  if (!raw) return NO_WATERMARK;
  try {
    const value = JSON.parse(raw) as Partial<WatermarkOptions>;
    const image = typeof value.imageData === 'string' && value.imageData.startsWith('data:image/') ? value.imageData : undefined;
    return {
      on: value.on === true,
      kind: value.kind === 'image' && image ? 'image' : 'text',
      text: typeof value.text === 'string' ? value.text.slice(0, 80) : '',
      imageData: image,
      position: POSITIONS.includes(value.position as WatermarkPosition) ? value.position as WatermarkPosition : NO_WATERMARK.position,
      size: clamp(value.size, 0.03, 0.5, NO_WATERMARK.size),
      opacity: clamp(value.opacity, 0.15, 1, NO_WATERMARK.opacity),
      tone: value.tone === 'dark' ? 'dark' : 'light',
    };
  } catch {
    return NO_WATERMARK;
  }
}
