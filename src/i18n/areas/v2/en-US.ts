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
    fringe: {
      heading: "Color fringes",
      help: "Lenses can leave thin colored outlines on edges: red, cyan, blue or yellow towards the corners, and purple or green on dark edges against a bright sky. These controls take them away. The photo itself is never changed.",
      detect: "Fix lens color edges",
      corrected: "Lens color edges corrected.",
      clean: "No lens color edges found on this photo, so nothing was changed.",
      active: "Lens color edges are corrected on this photo.",
      redHelp: "Moves the red channel in or out from the centre. Set by Fix lens color edges; adjust by hand if a red or cyan outline remains.",
      blueHelp: "Moves the blue channel in or out from the centre. Set by Fix lens color edges; adjust by hand if a blue or yellow outline remains.",
      purpleHelp: "Takes the color out of purple and violet outlines beside strong edges, such as branches against a bright sky. Purple areas away from strong edges keep their color.",
      greenHelp: "Takes the color out of green outlines beside strong edges. Green areas away from strong edges keep their color.",
    },
    colourHeading: 'Color & Clarity',
    tooltips: {
      temperature: 'Shifts color balance cooler (blue) or warmer (amber). Guided by white-balance anchors for color-blind accuracy.',
      vibrance: 'Boosts muted colors gently while protecting skin tones and already-vivid plumage.',
      saturation: 'Uniformly increases or decreases intensity across every color channel.',
    },
  },
  layers: {
    centre: "Center",
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
      cvdDesc: 'Names the main colors in each photo in words. Points out color casts, very strong colors, and red and green areas that many colorblind people find hard to tell apart. Also labels the ends of the Temperature and Tint sliders. Off unless you turn it on.',
    },
  },
  keyboardKeys: {
    importedSkipped: (set, skipped) => `Imported. Key set: ${set}. Not recognized and skipped: ${skipped}.`,
    resetPad: 'Reset pad to the starting setup',
    padHelp: 'A pad or dial sends keys, like a keyboard. For each slot, say which key it sends (Learn, then press it on the pad) and what it should do. The starting keys match the SinLoon pad setup from InFlight Version 1. TourBox and other pads that send keys work the same way; TourBox has not been tested on a real device.',
  },
  panelWords: {
    selectToAdjust: 'Select a photo to adjust tone and color.',
    centreLeftRight: 'Center left / right',
    centreUpDown: 'Center up / down',
    centredPair: 'Centered pair',
  },
  models: {
    licence: 'License',
  },
  settingsMore: {
    forgetBody: 'Some things leave a small amount of data about you on InFlight’s servers: signing in, buying a license, using optional cloud help or sending a message. Turning off “help improve suggestions” already deletes what you shared. To have the rest erased, send a request with the email you signed in with. InFlight cannot yet erase this with one tap, so a person handles the request. You will be told what, if anything, must be kept, such as payment records the law requires.',
  },
  overlayKit: {
    centre: 'Center',
    fields: { colourProfile: 'Color profile' },
  },
  canvas: {
    zoomCentre: 'Zoom to center',
    centreFound: 'No clear subject, so zoomed to the center.',
  },
};
