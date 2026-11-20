import type { AreaTranslation } from '../../localise';
import type { source } from './source';

/** US English: only the spellings that differ (color, center, analyze, canceled). */
export const enUS: AreaTranslation<typeof source> = {
  controls: { colour: 'Color' },
  critique: {
    opinions: {
      highlights: {
        detail: (f) => `${f.share} of the preview has all three color channels at maximum, compared with ${f.before} before editing. Check important highlights at 100%. Darkening the result cannot recover detail that was already clipped.`,
      },
      'colour-channels': {
        title: 'Bright colors may be clipping',
        detail: (f) => `${f.share} of the preview has at least one color channel at maximum, compared with ${f.before} before editing. This does not mean those pixels are pure white. Check saturated feathers, lights and other important colors at 100% before changing global highlights.`,
      },
      colour: {
        title: 'Colors are very strong',
        fix: 'Soften color',
      },
    },
  },
  auto: {
    paidBody: 'Automatic color and tone adjustments and local editing advice are here.',
    analysingButton: 'Analyzing…',
    analysing: 'Analyzing your photograph on this device…',
    couldNotAnalyse: 'Could not analyze this photo. Your edits have not changed.',
    tooSmall: 'This preview is too small to analyze. Your edits have not changed.',
    notAnalysed: 'This preview could not be analyzed. Your edits have not changed.',
  },
  edit: {
    denoiseTitle: 'Smooths colored speckle in high-ISO photos; not a claim of AI detail restoration',
    denoiseHelp: 'Smooths color speckle only. Edges and fine texture stay as they are.',
    placeHelp: 'Tap the subject. Press Enter on the photo to use the center.',
  },
  raw: {
    masterSaved: 'Saved a 16-bit TIFF made from the RAW sensor data, with the same edit as the screen. No color profile is embedded yet; the colors are sRGB.',
    masterCancelled: 'Export canceled; no file was written.',
    cancelledTask: 'Canceled',
    dngCancelled: 'Canceled; no file was written.',
  },
};
