import { canvasColourSpace, type CanvasColourSpace } from '../core/displayFidelity';

let chosen: CanvasColourSpace | undefined;

/** Can this browser draw a 2D canvas in Display P3? Checked once, by asking for one and reading back what it gave. */
function p3CanvasSupported(): boolean {
  try {
    const context = document.createElement('canvas').getContext('2d', { colorSpace: 'display-p3' });
    return context?.getContextAttributes?.().colorSpace === 'display-p3';
  } catch {
    return false;
  }
}

function wideGamutScreen(): boolean {
  try {
    return typeof matchMedia === 'function' && matchMedia('(color-gamut: p3)').matches;
  } catch {
    return false;
  }
}

/** The colour space for the editor's screen canvases: Display P3 where supported and visible, otherwise sRGB. */
export function displayCanvasColourSpace(): CanvasColourSpace {
  if (chosen === undefined) {
    chosen = typeof document === 'undefined' ? 'srgb' : canvasColourSpace({ p3Canvas: p3CanvasSupported(), wideGamutScreen: wideGamutScreen() });
  }
  return chosen;
}
