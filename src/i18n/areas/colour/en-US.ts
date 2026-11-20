import type { AreaTranslation } from '../../localise';
import type { source } from './source';

/** US English: only the words that differ from British English (color, gray). */
export const enUS: AreaTranslation<typeof source> = {
  title: 'Color check',
  intro: 'Kestrel names the colors in this photo and points out anything that may look wrong, in words.',
  checking: 'Checking color…',
  unavailable: 'The color check isn’t available for this photo yet.',
  mainColours: 'Main colors',
  nothingToFix: 'Nothing looks wrong with the color in this small preview.',
  family: { grey: 'gray' },
  strength: { none: 'no color' },
  cast: {
    warm: 'Things that should be gray or white look a little yellow or orange (a warm cast).',
    cool: 'Things that should be gray or white look a little blue (a cool cast).',
    green: 'Things that should be gray or white look a little green.',
    magenta: 'Things that should be gray or white look a little pink or purple.',
  },
  muted: 'There is hardly any color in this photo. That is fine if you want it nearly black and white.',
  redGreen: (first, second) => `The ${first} and ${second} areas are about equally bright, so many color-blind people will find them hard to tell apart.`,
  editStronger: (percent) => `Your edit has made the colors ${percent}% stronger than the original.`,
  editWeaker: (percent) => `Your edit has made the colors ${percent}% softer than the original.`,
  fixSoften: 'Soften color',
};
