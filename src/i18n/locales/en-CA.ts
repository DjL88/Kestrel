import type { Translation } from '../messages';

/**
 * Canadian English keeps British spellings such as "colour", "licence" and "catalogue", so it overrides almost nothing.
 * Dates and numbers follow en-CA through `Intl`.
 */
export const enCA: Translation = {
  settings: {
    calm: 'Reduced stimulation (no animations)',
  },
};
