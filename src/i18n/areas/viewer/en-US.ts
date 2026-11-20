import type { AreaTranslation } from '../../localise';
import type { source } from './source';

/** US English: only the words that differ from British English. */
export const enUS: AreaTranslation<typeof source> = {
  mask: {
    adjustments: { colour: 'Color' },
  },
};
