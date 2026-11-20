export type CanvasColourSpace = 'srgb' | 'display-p3';

/**
 * Which colour space the editor's screen canvases use (ROADMAP K.1). Display P3 only where the browser can draw a
 * canvas in it and the screen can show it; everywhere else stays sRGB, exactly as before. Display P3 uses the same
 * tone curve as sRGB, so the sliders behave the same and wide-gamut colours are simply not clipped first.
 * Exports are unchanged (sRGB).
 */
export function canvasColourSpace(support: { p3Canvas: boolean; wideGamutScreen: boolean }): CanvasColourSpace {
  return support.p3Canvas && support.wideGamutScreen ? 'display-p3' : 'srgb';
}
