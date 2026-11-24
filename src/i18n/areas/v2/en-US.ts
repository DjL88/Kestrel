import type { AreaTranslation } from '../../localise';
import type { source } from './source';

/** US English: only the words that differ from British English. */
export const enUS: AreaTranslation<typeof source> = {
  collage: {
    pageBackgroundColour: 'Page background color',
    backgroundColour: 'Background color',
    textColour: 'Text color',
  },
  watermarks: {
    tooMuch: 'The background is not one flat color, so nothing was removed.',
  },
  hub: {
    loadingBody: 'Checking local catalog copies and original folder links.',
    errorTitle: 'Could not open library catalog',
    errorBody: 'The local catalog index could not be read. Retry or check your storage folder in Settings.',
  },
  filmstrip: {
    autoCull: 'Auto-Cull & Analyze',
    autoCullRunning: 'Analyzing…',
    tileStates: { analysing: 'Analyzing' },
  },
  copilot: {
    noGenAiNote: 'Zero generative AI. Uses masking, denoise, tone, and color grading only.',
  },
  adjust: {
    colourHeading: 'Color & Clarity',
    tooltips: {
      temperature: 'Shifts color balance cooler (blue) or warmer (amber). Guided by white-balance anchors for color-blind accuracy.',
      vibrance: 'Boosts muted colors gently while protecting skin tones and already-vivid plumage.',
      saturation: 'Uniformly increases or decreases intensity across every color channel.',
    },
  },
  formats: {
    recentBorderColoursGroup: 'Recently used border colors',
    recentBorderColours: 'Recent colors',
    borderColourLabel: 'Border color',
  },
  enhance: {
    colourDenoise: 'Color noise',
  },
  overlays: {
    fontFavourites: 'Our favorites',
  },
  assist: {
    subtitle: 'Plain-English guidance designed for low-confidence and color-blind workflows.',
    colourConfidenceHeading: 'Color & Tone Reassurance',
    safeNote: 'Color notes come from measuring the photo itself on this device, not from how it looks on your screen.',
  },
  bursts: {
    flagBestNotRanked: 'Not ranked yet. Run Auto-cull & Analyze to find the best frame.',
  },
  settings: {
    assistance: {
      cvdLabel: 'Color-vision support',
      cvdDesc: 'Names the main colors in each photo in words, and points out color casts, very strong colors and red and green areas that many colorblind people find hard to tell apart. Also labels the ends of the Temperature and Tint sliders. Off unless you turn it on.',
    },
  },
};
