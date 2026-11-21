import type { AreaTranslation } from '../../localise';
import type { source } from './source';

/** US English: only the words that differ from British English (color). */
export const enUS: AreaTranslation<typeof source> = {
  intro: 'Optional. Use your own AI account, or a model on this computer, to look at this photo’s color and light. Kite44’s own check above always works without it.',
  slider: { colour: 'Color' },
  errors: {
    offline: 'You’re offline. Kite44’s own color check still works.',
  },
};
